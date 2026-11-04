// 用户自己声明「某模型支持哪些思考档 / 首选哪一档」的判卷（2026-11-03，业主原话：
// 「让用户可以自己配置模型思考能力」）。
//
// 声明落在**与 provider 配置同一层**（工作区 `.agent/providers.json` 的 models[]）：`reasoningEfforts`
// 是既有字段（能力表开门的唯一证据），本次新增 `reasoningDefault`（首选档）。三件事分开钉：
//   ① 归一化纯函数——认不出的档位名不静默、首选档不许越出支持集（否则界面与能力表会各猜一次）；
//   ② 配置校验——非法档位**拒收**（收下不用 = 让用户以为生效了）；**老配置逐字无反还**；
//   ③ 声明真的进 capability——档位表与首选档由**同一条声明**算出来，并过得了 validateThinkingEffort。
// 反向自证：把 capabilities.ts 里声明那一行换成硬编码 "off" ⇒ ③ 变红（读数见
// `.tmp/audit-design/thinking/REVERSE.md`）。
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACTIVE_REASONING_EFFORTS, normalizeThinkingDeclaration } from "../src/providers/reasoning";
import {
  deriveCustomProviders,
  parseCustomProviders,
  type CustomProviderProblem,
} from "../src/providers/provider-config";
import { installCustomProviders } from "../src/providers/registry";
import { capabilityForModel, validateThinkingEffort } from "../src/providers/capabilities";
import { commitCustomProvider, prepareCustomProvider } from "../src/main/provider-setup";
import { customProvidersPath } from "../src/main/custom-provider-store";

const BASE_MODEL = { id: "chat", model: "deepseek-chat", contextWindow: 131_072 };

function configWith(model: Record<string, unknown>): unknown {
  return {
    version: 1,
    providers: [
      {
        id: "myprovider",
        label: "我的模型",
        protocol: "openai",
        baseURL: "https://api.example.com/v1",
        apiKeyEnv: "MYPROVIDER_API_KEY",
        models: [model],
      },
    ],
  };
}

function problemsOf(raw: unknown): readonly CustomProviderProblem[] {
  const r = parseCustomProviders(raw);
  if (r.ok) throw new Error("本用例期望校验失败，实际却通过了");
  return r.problems;
}

/** 解析 → 派生 → **装上**（装上才算进 `effectiveModelTable()`，capability 才看得见）。 */
function install(raw: unknown): void {
  const parsed = parseCustomProviders(raw);
  if (!parsed.ok) throw new Error("本用例期望校验通过，实际失败：" + JSON.stringify(parsed.problems));
  installCustomProviders(deriveCustomProviders(parsed.file));
}

const capOf = (): ReturnType<typeof capabilityForModel> => capabilityForModel({ id: "myprovider-chat", provider: "myprovider" });

describe("声明归一化（纯函数：档位表与首选档只有这一个出处）", () => {
  it("四档里挑、去重、按低→高排；「off」写在列表里等于没写", () => {
    const d = normalizeThinkingDeclaration(["high", "low", "high", "off"], "high");
    expect(d.levels).toEqual(["low", "high"]); // 低→高（不是书写顺序）
    expect(d.default).toBe("high");
    expect(d.unknown).toEqual([]);
    expect(ACTIVE_REASONING_EFFORTS).toEqual(["low", "medium", "high", "max"]); // 可挑的四档
  });

  it("认不出的档位名原样回传（判错还是忽略由调用方定，这里不替它决定）", () => {
    const d = normalizeThinkingDeclaration(["turbo", "low"], undefined);
    expect(d.levels).toEqual(["low"]);
    expect(d.unknown).toEqual(["turbo"]);
  });

  it("各家词汇照旧映射（minimal→low、xhigh→high）；空声明 = 不支持", () => {
    expect(normalizeThinkingDeclaration(["minimal", "xhigh"], undefined).levels).toEqual(["low", "high"]);
    const empty = normalizeThinkingDeclaration([], undefined);
    expect(empty.levels).toEqual([]);
    expect(empty.default).toBe("off"); // 空 = 不支持：首选档只能是「关」
  });

  it("首选档越出支持集 ⇒ 落回 off（宁可关着，不偷偷发更大的档）", () => {
    const d = normalizeThinkingDeclaration(["low"], "high");
    expect(d.preferred).toBe("high"); // 声明里写了什么照实回传（配置层据此判错）
    expect(d.default).toBe("off"); // 但生效的首选档不许越界
    expect(normalizeThinkingDeclaration(["low", "high"], "off").default).toBe("off");
  });
});

describe("配置校验：非法档位被拒（收下不用 = 让用户以为生效了）", () => {
  it("reasoningEfforts 里的非法档位 ⇒ 判错，并交出允许的取值清单", () => {
    const ps = problemsOf(configWith({ ...BASE_MODEL, reasoningEfforts: ["low", "turbo"] }));
    const hit = ps.find((p) => p.where.endsWith(".reasoningEfforts"));
    expect(hit?.kind).toBe("model");
    expect(hit?.message).toContain("turbo");
    expect(hit?.message).toContain("medium"); // 允许的取值要能读出来，不是「只支持四档」这种读不出名的句子
  });

  it("首选档不在声明的档位里 ⇒ 判错（不静默落回 off——用户写的东西得有个交代）", () => {
    const ps = problemsOf(configWith({ ...BASE_MODEL, reasoningEfforts: ["low"], reasoningDefault: "high" }));
    const hit = ps.find((p) => p.where.endsWith(".reasoningDefault"));
    expect(hit?.kind).toBe("model");
    expect(hit?.message).toContain("low");
  });

  it("没声明档位却写了首选档 ⇒ 判错（不支持思考时首选档无从谈起）", () => {
    const ps = problemsOf(configWith({ ...BASE_MODEL, reasoningDefault: "high" }));
    expect(ps.some((p) => p.where.endsWith(".reasoningDefault"))).toBe(true);
  });
});

describe("老配置逐字无反还", () => {
  it("没写 reasoningDefault 的老配置：解析形状不变，首选档仍是 off", () => {
    install(configWith({ ...BASE_MODEL, reasoningEfforts: ["low", "high"] }));
    const cap = capOf();
    expect(cap.thinking.supported).toBe(true);
    expect(cap.thinking.values).toEqual(["off", "low", "high"]);
    expect(cap.thinking.default).toBe("off"); // 声明了支持 ≠ 替用户打开（思考要花钱）——旧行为不变
    expect(validateThinkingEffort({ id: "myprovider-chat", provider: "myprovider" }, undefined)).toBe("off");
  });

  it("完全没声明思考（今天绝大多数自定义家的形状）：整段能力保持「不支持」", () => {
    install(configWith(BASE_MODEL));
    const cap = capOf();
    expect(cap.thinking.supported).toBe(false);
    expect(cap.thinking.values).toEqual(["off"]);
    expect(cap.thinking.default).toBe("off");
    expect(() => validateThinkingEffort({ id: "myprovider-chat", provider: "myprovider" }, "high")).toThrow(/不支持 thinking/);
  });
});

describe("声明真的进 capability（档位表 + 首选档同一条声明算出来）", () => {  it("声明 [low,high] + 首选 high ⇒ 能力表出这三档、默认档就是声明的首选档", () => {
    install(configWith({ ...BASE_MODEL, reasoningEfforts: ["high", "low"], reasoningDefault: "high" }));
    const cap = capOf();
    expect(cap.thinking.supported).toBe(true);
    expect(cap.thinking.values).toEqual(["off", "low", "high"]); // 声明外的 medium 不许选
    expect(cap.thinking.default).toBe("high"); // ★ 声明说了算
    const spec = { id: "myprovider-chat", provider: "myprovider" };
    expect(validateThinkingEffort(spec, undefined)).toBe("high"); // 不发档时发出去的就是它
    expect(validateThinkingEffort(spec, "low")).toBe("low");
    expect(() => validateThinkingEffort(spec, "medium")).toThrow(/不支持 thinking/);
  });

  it("声明了四档但首选档写成 off ⇒ 首选档就是 off（用户明说要关着）", () => {
    install(configWith({ ...BASE_MODEL, reasoningEfforts: ["low", "medium", "high", "max"], reasoningDefault: "off" }));
    expect(capOf().thinking.default).toBe("off");
    expect(capOf().thinking.values).toEqual(["off", "low", "medium", "high", "max"]);
  });
});

describe("落盘形状：桌面表单存下去的那条路（prepare → 写盘 → 从文件读回来）", () => {
  it("界面声明的档位与首选档真写进 providers.json，且落盘的是规范化后的形状", async () => {
    const ws = mkdtempSync(join(tmpdir(), "cairn-thinking-"));
    try {
      const prepared = prepareCustomProvider(ws, {
        id: "myprovider",
        protocol: "openai",
        baseURL: "https://api.example.com/v1",
        apiKeyEnv: "MYPROVIDER_API_KEY",
        models: [{ id: "chat", model: "gpt-x", contextWindow: 131_072, reasoningEfforts: ["high", "low"], reasoningDefault: "high" }],
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(await commitCustomProvider(prepared)).toEqual({ ok: true });
      const onDisk = JSON.parse(readFileSync(customProvidersPath(ws), "utf8")) as {
        providers: { models: { reasoningEfforts?: readonly string[]; reasoningDefault?: string }[] }[];
      };
      // 低→高（不是表单/探测给的书写顺序），首选档跟着一起落 —— 「用户声明」这一笔真的到了盘上。
      expect(onDisk.providers[0]?.models[0]?.reasoningEfforts).toEqual(["low", "high"]);
      expect(onDisk.providers[0]?.models[0]?.reasoningDefault).toBe("high");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

afterEach(() => {
  installCustomProviders([]); // 装上是进程级状态：用完还原，别漏给下一个用例
});
