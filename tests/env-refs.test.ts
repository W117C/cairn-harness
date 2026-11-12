// $VAR 间接引用（roadmap 2026-11-10）：expandEnvRefs 纯函数 + providers.json baseURL 接线。
// 边界（src/env-refs.ts 头注释同源）：只认全大写 ${VAR}；缺变量不编值（原样保留 + 报 missing）；
// 接线面收窄在用户私有配置——随仓分发的 .agent/config.json 刻意不接（克隆配置读 env = 渗漏通道）。
import { describe, expect, it } from "vitest";
import { expandEnvRefs, hasEnvRef } from "../src/env-refs";
import { parseCustomProviders } from "../src/providers/provider-config";

describe("expandEnvRefs", () => {
  it("展开存在的变量；内嵌段也展开", () => {
    expect(expandEnvRefs("https://${GW_HOST}/v1", { GW_HOST: "gw.corp" }).value).toBe("https://gw.corp/v1");
    expect(expandEnvRefs("${A}-x-${B}", { A: "1", B: "2" }).value).toBe("1-x-2");
  });

  it("缺变量原样保留 + 报 missing（不编空值）；重复名去重", () => {
    const r = expandEnvRefs("https://${GW_HOST}/v1/${GW_HOST}", {});
    expect(r.value).toBe("https://${GW_HOST}/v1/${GW_HOST}");
    expect(r.missing).toEqual(["GW_HOST"]);
  });

  it("空串变量按缺处理（「没配」不许伪装成「配了空值」）", () => {
    const r = expandEnvRefs("${EMPTY}/x", { EMPTY: "" });
    expect(r.value).toBe("${EMPTY}/x");
    expect(r.missing).toEqual(["EMPTY"]);
  });

  it("只认全大写名：小写与混合不展开（不抢别的模板语法的语义）", () => {
    expect(expandEnvRefs("${path}", {}).value).toBe("${path}");
    expect(expandEnvRefs("${Path}", {}).value).toBe("${Path}");
    expect(expandEnvRefs("${Gw_Host}", {}).value).toBe("${Gw_Host}");
  });
});

describe("providers.json baseURL 的 $VAR 接线", () => {
  const validModel = { id: "m1", model: "model-one" };

  it("baseURL 里的 ${VAR} 展开后再过 URL/https 校验，落盘 spec 拿到的是展开值", () => {
    const r = parseCustomProviders(
      { version: 1, providers: [{ id: "corp", protocol: "openai", baseURL: "https://${GW_HOST}/v1", apiKeyEnv: "CORP_KEY", models: [validModel] }] },
      { GW_HOST: "gw.corp.example" },
    );
    expect(r.ok).toBe(true);
    expect(r.ok ? r.file.providers[0]?.baseURL : "").toBe("https://gw.corp.example/v1");
  });

  it("缺变量 = 配置问题 fail-loud（不把字面 ${VAR} 交给拨号面）", () => {
    const r = parseCustomProviders(
      { version: 1, providers: [{ id: "corp", protocol: "openai", baseURL: "https://${GW_HOST}/v1", apiKeyEnv: "CORP_KEY", models: [validModel] }] },
      {},
    );
    expect(r.ok ? false : r.problems.some((p) => p.kind === "base-url" && p.message.includes("GW_HOST"))).toBe(true);
  });
});
