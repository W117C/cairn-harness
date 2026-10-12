// 声明式 provider 配置的判卷。这里钉三件事：
//   ① 三条安全线是**判错**而不是提示（https-only / key 只写变量名 / 不认识的字段拒收）；
//   ② 校验一次收齐所有问题（用户改一次配置要看到全部错，不是改一处跑一次）；
//   ③ 派生期缺窗口、缺价的处理是「保守 + 出声」，不是「悄悄补一个数」。
import { describe, expect, it } from "vitest";
import {
  deriveCustomProviders,
  isLocalHostname,
  parseCustomProviders,
  type CustomProviderProblem,
  type CustomProvidersFile,
} from "../src/providers/provider-config";
import type { ModelSpec } from "../src/providers/registry";

const GOOD = {
  version: 1,
  providers: [
    {
      id: "deepseek",
      label: "DeepSeek",
      protocol: "openai",
      baseURL: "https://api.deepseek.com/v1",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      models: [
        {
          id: "chat",
          model: "deepseek-chat",
          tier: "standard",
          contextWindow: 131072,
          maxOutputTokens: 8192,
          price: { inputPerMTok: 0.28, outputPerMTok: 0.42 },
          reasoningEfforts: ["low", "high"],
        },
      ],
    },
  ],
};

function problemsOf(raw: unknown): readonly CustomProviderProblem[] {
  const r = parseCustomProviders(raw);
  if (r.ok) throw new Error("本用例期望校验失败，实际却通过了");
  return r.problems;
}
function kindsOf(raw: unknown): string[] {
  return problemsOf(raw).map((p) => p.kind);
}
function okFile(raw: unknown): CustomProvidersFile {
  const r = parseCustomProviders(raw);
  if (!r.ok) throw new Error("本用例期望校验通过，实际失败：" + JSON.stringify(r.problems));
  return r.file;
}
/** 在 GOOD 的基础上只改一处，用来做「单点破坏」用例。 */
function mutate(fn: (f: Record<string, unknown>, p: Record<string, unknown>, m: Record<string, unknown>) => void): unknown {
  const copy = JSON.parse(JSON.stringify(GOOD)) as { providers: Record<string, unknown>[] };
  const p = copy.providers[0];
  const m = (p.models as Record<string, unknown>[])[0];
  fn(copy as unknown as Record<string, unknown>, p, m);
  return copy;
}

const TABLE: readonly ModelSpec[] = [
  { id: "glm-flash", provider: "glm", model: "glm-x", tier: "cheap", ctxWindow: 8_000 },
  { id: "glm-standard", provider: "glm", model: "glm-y", tier: "standard", ctxWindow: 200_000 },
];

describe("好配置：解析通过并派生", () => {
  it("派生出的档位 id = <provider>-<model>，provider 指向自定义 id，tier 缺省 standard", () => {
    const file = okFile(GOOD);
    const [d] = deriveCustomProviders(file, { builtinTable: TABLE });
    expect(d.id).toBe("deepseek");
    expect(d.label).toBe("DeepSeek");
    expect(d.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
    expect(d.specs).toEqual([
      {
        id: "deepseek-chat", provider: "deepseek", model: "deepseek-chat", tier: "standard", ctxWindow: 131072,
        reasoningEfforts: ["low", "high"],
      },
    ]);
    expect(d.prices).toEqual({ "deepseek-chat": { inputPerMTok: 0.28, outputPerMTok: 0.42 } });
    expect(d.warnings).toEqual([]);
  });

  it("registryId 可以显式指定全局档位 id", () => {
    const raw = mutate((_f, _p, m) => {
      m.registryId = "my-deepseek-standard";
    });
    const [d] = deriveCustomProviders(okFile(raw), { builtinTable: TABLE });
    expect(d.specs[0].id).toBe("my-deepseek-standard");
    expect(d.prices["my-deepseek-standard"]).toBeDefined();
  });

  it("tier 给了就用给的；缺省是 standard", () => {
    const raw = mutate((_f, _p, m) => {
      m.tier = "cheap";
    });
    const [d] = deriveCustomProviders(okFile(raw), { builtinTable: TABLE });
    expect(d.specs[0].tier).toBe("cheap");
  });
});

describe("三条安全线：判错，而不是提示", () => {
  it("http 且不是本地地址 ⇒ 拒（只许 https）", () => {
    const raw = mutate((_f, p) => {
      p.baseURL = "http://api.example.com/v1";
    });
    expect(kindsOf(raw)).toContain("insecure-endpoint");
  });

  it("localhost 但没显式放行 ⇒ 拒（不默认允许把请求发向内网）", () => {
    const raw = mutate((_f, p) => {
      p.baseURL = "http://localhost:11434/v1";
    });
    expect(kindsOf(raw)).toContain("insecure-endpoint");
  });

  it("localhost + allowLocalEndpoint: true ⇒ 放行（本地模型的正常路径）", () => {
    const raw = mutate((_f, p) => {
      p.baseURL = "http://127.0.0.1:11434/v1";
      p.allowLocalEndpoint = true;
    });
    const [d] = deriveCustomProviders(okFile(raw), { builtinTable: TABLE });
    expect(d.allowLocalEndpoint).toBe(true);
  });

  it("https 的内网地址也要显式放行（https 不等于「就该发过去」）", () => {
    const raw = mutate((_f, p) => {
      p.baseURL = "https://192.168.1.10:8443/v1";
    });
    expect(kindsOf(raw)).toContain("insecure-endpoint");
  });

  it("把 key 的值写进配置文件 ⇒ 判错并给出「写变量名」的指引", () => {
    const raw = mutate((_f, p) => {
      p.apiKey = "sk-abcdef";
    });
    const ps = problemsOf(raw);
    expect(ps.map((p) => p.kind)).toContain("key-field");
    expect(ps.find((p) => p.kind === "key-field")?.message).toContain("apiKeyEnv");
  });

  it("不认识的字段一律拒（收下不用 = 让人以为生效了）", () => {
    const raw = mutate((_f, p) => {
      p.stream_idle_timeout_ms = 300000;
    });
    const ps = problemsOf(raw);
    expect(ps.map((p) => p.kind)).toContain("unknown-field");
    expect(ps[0].where).toContain("stream_idle_timeout_ms");
  });

  it("isLocalHostname 认回环与私网，不认公网域名", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("[::1]")).toBe(true);
    expect(isLocalHostname("10.0.0.5")).toBe(true);
    expect(isLocalHostname("192.168.1.1")).toBe(true);
    expect(isLocalHostname("172.16.3.4")).toBe(true);
    expect(isLocalHostname("172.32.3.4")).toBe(false);
    expect(isLocalHostname("api.deepseek.com")).toBe(false);
  });
});

describe("结构校验：一次收齐所有问题", () => {
  it("多处错同时返回，且每处都能定位到字段路径", () => {
    const raw = mutate((f, p, m) => {
      f.version = 2;
      p.id = "OpenAI";
      p.protocol = "mistral";
      m.contextWindow = -1;
    });
    const ps = problemsOf(raw);
    expect(ps.map((p) => p.kind).sort()).toEqual(["model", "protocol", "provider-id", "shape"].sort());
    expect(ps.map((p) => p.where)).toContain("version");
    expect(ps.map((p) => p.where)).toContain("providers[0].id");
    expect(ps.map((p) => p.where)).toContain("providers[0].protocol");
    expect(ps.map((p) => p.where)).toContain("providers[0].models[0].contextWindow");
  });

  it("内置 provider 的名字不能占用（否则路由/注入面分不清谁是内置的）", () => {
    const raw = mutate((_f, p) => {
      p.id = "openai";
    });
    expect(kindsOf(raw)).toContain("provider-id");
    expect(problemsOf(raw)[0].message).toContain("内置");
  });

  it("provider id 重复、同一 provider 内模型 id 重复都拒", () => {
    const dupProvider = {
      version: 1,
      providers: [GOOD.providers[0], { ...GOOD.providers[0], label: "复制品" }],
    };
    expect(kindsOf(dupProvider)).toContain("duplicate");
    const dupModel = mutate((_f, _p, m) => {
      // 塞第二条同 id 模型
      (_p.models as unknown[]).push({ ...m });
    });
    expect(kindsOf(dupModel)).toContain("duplicate");
  });

  it("models 缺省 / 空数组 / 缺 model 字段 / 价是负数都拒", () => {
    expect(kindsOf(mutate((_f, p) => delete p.models))).toContain("model");
    expect(kindsOf(mutate((_f, p) => (p.models = [])))).toContain("model");
    expect(kindsOf(mutate((_f, _p, m) => delete m.model))).toContain("model");
    expect(
      kindsOf(
        mutate((_f, _p, m) => {
          m.price = { inputPerMTok: -1 };
        }),
      ),
    ).toContain("model");
  });

  it("顶层不是对象 / providers 不是数组 ⇒ shape 错", () => {
    expect(kindsOf(null)).toEqual(["shape"]);
    expect(kindsOf({ version: 1 })).toContain("shape");
  });

  it("空 providers 数组是合法的（没有自定义 provider 的人不必删文件）", () => {
    const file = okFile({ version: 1, providers: [] });
    expect(deriveCustomProviders(file)).toEqual([]);
  });
});

describe("派生：缺窗口、缺价都是「保守 + 出声」", () => {
  it("没给 contextWindow ⇒ 用档位表里最小的那个（低估只会提前压缩），并报警告", () => {
    const raw = mutate((_f, _p, m) => {
      delete m.contextWindow;
    });
    const [d] = deriveCustomProviders(okFile(raw), { builtinTable: TABLE });
    expect(d.specs[0].ctxWindow).toBe(8_000);
    expect(d.warnings.join("\n")).toContain("没给 contextWindow");
    expect(d.warnings.join("\n")).toContain("8000");
  });

  it("没给 price ⇒ 不进价表，并明说美元闸对它不生效（绝不按 $0 算）", () => {
    const raw = mutate((_f, _p, m) => {
      delete m.price;
    });
    const [d] = deriveCustomProviders(okFile(raw), { builtinTable: TABLE });
    expect(d.prices).toEqual({});
    expect(d.warnings.join("\n")).toContain("没给 price");
    expect(d.warnings.join("\n")).toContain("不生效");
  });

  it("全局档位 id 撞内置表 ⇒ 跳过那条模型并出声（不许悄悄覆盖内置行）", () => {
    const raw = mutate((_f, _p, m) => {
      m.registryId = "glm-flash";
    });
    const [d] = deriveCustomProviders(okFile(raw), { builtinTable: TABLE });
    expect(d.specs).toEqual([]);
    expect(d.warnings.join("\n")).toContain("重复");
  });

  it("两条模型之间也不能撞 id", () => {
    const raw = mutate((_f, p, m) => {
      (p.models as unknown[]).push({ ...m, id: "chat2", registryId: "same-id" });
      m.registryId = "same-id";
    });
    const [d] = deriveCustomProviders(okFile(raw), { builtinTable: TABLE });
    expect(d.specs.map((s) => s.id)).toEqual(["same-id"]);
    expect(d.warnings.join("\n")).toContain("重复");
  });
});
