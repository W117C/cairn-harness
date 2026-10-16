// 用户实测反馈 ①（保存状态不明 + 回对话页选不到刚加的模型）的判卷。
// 这两条都是**先复现、再修**的：修之前它们各自红过一条。
//
//   ①-a 全新安装的缺省通道是 demo，而 demo 分支曾交回**空模型面** ⇒ 模型选择器永远什么都看不到，
//        用户即使在设置里加好了自己的模型也选不上。
//   ①-b 设置页表单原本「先存钥匙、再写配置」，而钥匙白名单的判据是「provider 已装上」⇒ 首次添加
//        必然在第一步被拒，现象就是「点了保存不知道成没成」。
//        修法是**改顺序而不是放宽判据**：先装（可逆）→ 再存钥匙 → 后落盘 → 失败回滚。
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commitCustomProvider, prepareCustomProvider } from "../src/main/provider-setup";
import { customProvidersPath } from "../src/main/custom-provider-store";
import { buildProviderInfo, resolveMainModel, selectionProviderId, knownProviders } from "../src/main/provider-runtime";
import { installCustomProviders, installedCustomProviders, effectiveModelTable, findSpecByNameOrId, resolveModel } from "../src/providers/registry";
import { deriveCustomProviders, parseCustomProviders } from "../src/providers/provider-config";
import { isProviderId, putProviderKey, setProviderKeyBackend } from "../src/main/provider-keys";

/** 内存保险柜替身：让「白名单」成为唯一的拒绝理由（真后端要 AES 密钥，本文件不重复那套装置）。 */
function useMemoryVault(): Map<string, string> {
  const vault = new Map<string, string>();
  setProviderKeyBackend({
    name: "memory",
    isAvailable: () => true,
    set: async (p: string, v: string) => {
      vault.set(p, v);
    },
    get: async (p: string) => vault.get(p) ?? null,
    delete: async (p: string) => vault.delete(p),
    storedProviders: async () => [...vault.keys()],
  });
  return vault;
}

const dirs: string[] = [];
afterEach(() => {
  setProviderKeyBackend(null);
  installCustomProviders([]);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CONFIG = {
  version: 1,
  providers: [
    {
      id: "deepseek",
      label: "DeepSeek",
      protocol: "openai",
      baseURL: "https://api.deepseek.com/v1",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      models: [{ id: "chat", model: "deepseek-chat", contextWindow: 131_072, reasoningEfforts: ["low", "high"] }],
    },
  ],
};

function installDeepseek(): void {
  const parsed = parseCustomProviders(CONFIG);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  installCustomProviders(deriveCustomProviders(parsed.file));
}

describe("①-a 缺省通道是 demo 时，模型面也必须有真模型", () => {
  it("未装任何自定义家时：模型面是内置档位全量（而不是空数组）", () => {
    const info = buildProviderInfo(resolveMainModel({ configuredKind: "demo", settingsModel: "" }));
    expect(info.kind).toBe("demo");
    expect(info.models.length).toBeGreaterThan(0);
    expect(info.models.some((m) => m.id === "openai-standard")).toBe(true);
  });

  it("装了自定义家之后：它的模型出现在模型面里（用户回对话页就能选到）", () => {
    installDeepseek();
    const info = buildProviderInfo(resolveMainModel({ configuredKind: "demo", settingsModel: "" }));
    const custom = info.models.find((m) => m.id === "deepseek-chat");
    expect(custom).toBeDefined();
    expect(custom?.provider).toBe("deepseek");
    // 能力面也跟着走：用户声明了 low/high，选择器据此知道能调档位
    expect(custom?.capability.thinking.supported).toBe(true);
    expect(custom?.capability.thinking.values).toEqual(["off", "low", "high"]);
  });

  it("从 demo 直接选一条自定义模型 ⇒ 解析成那家 provider（不是回落 demo）", () => {
    installDeepseek();
    const selection = resolveMainModel({ configuredKind: "demo", settingsModel: "", requestModel: "deepseek-chat" });
    expect(selectionProviderId(selection)).toBe("deepseek");
    if (selection.kind === "demo") throw new Error("不该回落 demo");
    expect(selection.spec.model).toBe("deepseek-chat");
  });

  it("providers 清单里既有内置也有自定义（设置页据此渲染下拉，不再写死在渲染层）", () => {
    expect(knownProviders().map((p) => p.id)).toEqual(["glm", "openai", "anthropic", "gemini"]);
    installDeepseek();
    const list = knownProviders();
    expect(list.map((p) => p.id)).toContain("deepseek");
    expect(list.find((p) => p.id === "deepseek")?.custom).toBe(true);
    expect(list.find((p) => p.id === "openai")?.custom).toBe(false);
    // 选择器与设置页拿的是同一份清单
    expect(buildProviderInfo(resolveMainModel({ configuredKind: "demo", settingsModel: "" })).providers).toEqual(list);
  });
});

describe("①-b 首次添加一家：判据不动、改顺序", () => {
  it("白名单仍是「已装上」：未装时拒收（既有判据没被放宽）", async () => {
    expect(isProviderId("deepseek")).toBe(false);
    // 保留名与未知 id 照样拒（这条判据是本仓既有契约，不该为了修 bug 把它放宽成来者不拒）
    expect(isProviderId("demo")).toBe(false);
    expect(isProviderId("unknown")).toBe(false);
    const vault = useMemoryVault();
    const rejected = await putProviderKey("deepseek", "sk-test");
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toContain("未知 provider"); // 拒的理由是白名单（不是没有后端）
    expect(vault.size).toBe(0); // 拒了就真的没存
  });

  it("装上之后同一把钥匙就存得进（正是「先装、再存钥匙」这一步的意义）", async () => {
    const vault = useMemoryVault();
    installDeepseek();
    expect(isProviderId("deepseek")).toBe(true);
    expect(await putProviderKey("deepseek", "sk-test")).toEqual({ ok: true });
    expect(vault.get("deepseek")).toBe("sk-test");
  });

  it("两段式：prepare 只算不写，commit 才落盘，中途可以整体不要", async () => {
    const ws = mkdtempSync(join(tmpdir(), "cairn-2phase-"));
    dirs.push(ws);
    const prepared = prepareCustomProvider(ws, {
      id: "deepseek",
      label: "DeepSeek",
      protocol: "openai",
      baseURL: "https://api.deepseek.com/v1",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      models: [{ id: "deepseek-chat", contextWindow: 131_072 }],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    // ① prepare 之后：文件还不存在（这一步零副作用）
    expect(() => readFileSync(customProvidersPath(ws), "utf8")).toThrow();
    // ② 装上：此刻钥匙面才放行这一家
    installCustomProviders(prepared.derived);
    expect(isProviderId("deepseek")).toBe(true);
    // ③ 落盘
    const wrote = await commitCustomProvider(prepared);
    expect(wrote.ok).toBe(true);
    expect(readFileSync(customProvidersPath(ws), "utf8")).toContain("deepseek-chat");
  });

  it("commit 之前反悔 ⇒ 注册表回滚成原样，磁盘上干干净净", async () => {
    const ws = mkdtempSync(join(tmpdir(), "cairn-2phase-"));
    dirs.push(ws);
    const prepared = prepareCustomProvider(ws, {
      id: "deepseek",
      protocol: "openai",
      baseURL: "https://api.deepseek.com/v1",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      models: [{ id: "deepseek-chat", model: "deepseek-chat" }],
    });
    if (!prepared.ok) throw new Error(prepared.error);
    const previous = installedCustomProviders();
    installCustomProviders(prepared.derived);
    installCustomProviders(previous); // 失败回滚（桌面 handler 走的就是这一句）
    expect(isProviderId("deepseek")).toBe(false);
    expect(installedCustomProviders()).toEqual([]);
    expect(() => readFileSync(customProvidersPath(ws), "utf8")).toThrow();
  });
});

describe("⑥ worker 面也看得见自定义家（spawn_agent 的模型参数）", () => {
  it("按 id / 按上游名反查都能命中自定义模型（worker 拿到的 spec 带着真 provider）", () => {
    installDeepseek();
    const table = effectiveModelTable();
    expect(findSpecByNameOrId(table, "deepseek-chat")?.provider).toBe("deepseek");
    expect(findSpecByNameOrId(table, "deepseek-chat")?.model).toBe("deepseek-chat");
    expect(resolveModel(table, "deepseek-chat")?.id).toBe("deepseek-chat");
  });

  it("worker 与会话两条路径都不许再用内置四家的静态表（回归哨兵）", () => {
    // 2026-10-06：orchestrator 曾用 DEFAULT_MODEL_TABLE 做 worker 档位反查与级联梯子，
    // session-provider 曾用它查上下文窗口 —— 那三处都看不见自定义家，正是用户撞到的"配了却用不上"。
    // 这条哨兵钉住"别再退回去"。
    const files = ["src/agent/orchestrator.ts", "src/agent/session-provider.ts"];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src.includes("DEFAULT_MODEL_TABLE"), `${f} 又用回了内置静态表`).toBe(false);
      expect(src.includes("effectiveModelTable")).toBe(true);
    }
  });
});

describe("写设置通道与读设置通道必须同口径（用户实测：保存成功后设为当前被打回）", () => {
  it("已装上的自定义 provider 可以写进 settings；它的模型也可以", async () => {
    const { initSettingsStore, setSettings, getSettings } = await import("../src/main/settings-handlers");
    const ws = mkdtempSync(join(tmpdir(), "cairn-set-"));
    dirs.push(ws);
    initSettingsStore(join(ws, "settings.json"));
    installDeepseek();
    // 旧实现这两行都会抛：`未知 provider: deepseek` / `未知模型: "deepseek-chat"`
    const next = await setSettings({ provider: "deepseek", model: "deepseek-chat" });
    expect(next.provider).toBe("deepseek");
    expect(next.model).toBe("deepseek-chat");
    expect((await getSettings()).provider).toBe("deepseek");
  });

  it("没装上的 id 仍然拒（闸门没有被拆掉，只是换了判据）", async () => {
    const { initSettingsStore, setSettings } = await import("../src/main/settings-handlers");
    const ws = mkdtempSync(join(tmpdir(), "cairn-set-"));
    dirs.push(ws);
    initSettingsStore(join(ws, "settings.json"));
    installCustomProviders([]);
    await expect(setSettings({ provider: "nobody-installed-me" })).rejects.toThrow("未知 provider");
  });

  it("回归哨兵：这三处不许再用只有内置四家的静态表", () => {
    const files = [
      "src/main/settings-handlers.ts",
      "src/main/run-request.ts",
      "src/main/doctor.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src.includes("DEFAULT_MODEL_TABLE"), `${f} 又用回了内置静态表`).toBe(false);
      expect(src.includes("PROVIDER_KINDS as readonly string[]"), `${f} 又用回了内置 provider 清单`).toBe(false);
    }
  });
});

describe("在界面上选过模型 ⇒ 就算缺省通道是 demo 也要用它（用户实测：点了切不动）", () => {
  it("settings.model 命中档位表 ⇒ 解析成那家 provider", () => {
    const sel = resolveMainModel({ configuredKind: "demo", settingsModel: "openai-standard" });
    expect(selectionProviderId(sel)).toBe("openai");
    if (sel.kind === "demo") throw new Error("不该回落 demo");
    expect(sel.spec.id).toBe("openai-standard");
  });

  it("选的是自定义家的模型也认", () => {
    installDeepseek();
    const sel = resolveMainModel({ configuredKind: "demo", settingsModel: "deepseek-chat" });
    expect(selectionProviderId(sel)).toBe("deepseek");
  });

  it("没有 settings.model ⇒ 照旧回落 demo（缺省行为不变）", () => {
    expect(resolveMainModel({ configuredKind: "demo", settingsModel: "" }).kind).toBe("demo");
    expect(resolveMainModel({ configuredKind: "demo", settingsModel: "not-in-table" }).kind).toBe("demo");
  });

  it("遗留的环境变量仍然不许复活真 provider（原守卫没被拆）", () => {
    const sel = resolveMainModel({ configuredKind: "demo", settingsModel: "", legacyEnvModel: "glm-5.3" });
    expect(sel.kind).toBe("demo");
  });
});

describe("settings 里 provider 与 model 分属两家：认模型自带的那家（用户实测：整份设置被卡死）", () => {
  it("provider=openai + 自定义家的模型 ⇒ 解析成那家（旧实现抛「不匹配」）", () => {
    installDeepseek();
    const sel = resolveMainModel({ configuredKind: "openai", settingsModel: "deepseek-chat" });
    expect(selectionProviderId(sel)).toBe("deepseek");
  });

  it("内置之间不一致也认模型自带的那家", () => {
    const sel = resolveMainModel({ configuredKind: "openai", settingsModel: "anthropic-cheap" });
    expect(selectionProviderId(sel)).toBe("anthropic");
  });

  it("显式 requestModel 与 forcedKind 冲突仍然严格抛错（那两条守卫没被放宽）", () => {
    expect(() =>
      resolveMainModel({ configuredKind: "openai", forcedKind: "glm", settingsModel: "", requestModel: "openai-standard" }),
    ).toThrow();
  });
});
