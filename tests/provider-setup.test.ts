// 桌面表单核心的判卷（无 Electron）。这里钉两条最容易出事的边界：
//   ① 「拉取」必须**零副作用**（用户点一下不该动他的配置文件）；
//   ② 「保存」**绝不覆盖读不懂的现有文件**（那是用户手写的东西），且 upsert 要保住别的家。
// 测试数据一律 mkdtemp（仓规：测试不写工作区、不写家目录）。
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverForProviderSetup, saveCustomProvider, suggestSetupDefaults, prepareCustomProvider } from "../src/main/provider-setup";
import { customProvidersPath } from "../src/main/custom-provider-store";
import type { CatalogReadout } from "../src/providers/catalog";

const dirs: string[] = [];
function workspace(initial?: string): string {
  const ws = mkdtempSync(join(tmpdir(), "cairn-setup-"));
  dirs.push(ws);
  if (initial !== undefined) {
    mkdirSync(join(ws, ".agent"), { recursive: true });
    writeFileSync(customProvidersPath(ws), initial, "utf8");
  }
  return ws;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const upstream = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CATALOG: CatalogReadout = {
  catalog: {
    version: 1,
    source: "models.dev",
    generatedAt: "2026-10-06T00:00:00Z",
    providers: [
      {
        id: "deepseek",
        name: "DeepSeek",
        apiBaseURL: "https://api.deepseek.com",
        envKeys: ["DEEPSEEK_API_KEY"],
        models: [{ id: "deepseek-chat", contextWindow: 131_072, pricing: { inputPerMTok: 0.28, outputPerMTok: 0.42 } }],
      },
    ],
  },
  origin: "cache",
};

describe("discoverForProviderSetup：拉取不改文件", () => {
  it("探测 + 目录补齐；返回行、缺口、目录来源", async () => {
    const ws = workspace();
    const r = await discoverForProviderSetup(
      { baseURL: "https://api.deepseek.com/v1", protocol: "openai", keyEnv: "DEEPSEEK_API_KEY", keyValue: "sk-x" },
      {
        fetchImpl: (async () => upstream({ object: "list", data: [{ id: "deepseek-chat" }] })) as unknown as typeof fetch,
        loadCatalogImpl: async () => CATALOG,
      },
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.rows.map((x) => x.id)).toEqual(["deepseek-chat"]);
    // 窗口与价来自目录，模态/推理档位没有人给 ⇒ 缺口里必须有
    expect(r.rows[0].contextWindow).toBe(131_072);
    expect(r.rows[0].price?.inputPerMTok).toBe(0.28);
    expect(r.missing).toContain("reasoningEfforts");
    expect(r.catalogOrigin).toBe("cache");
    expect(r.matchedProviderId).toBe("deepseek");
    // 拉取零副作用：工作区里仍然没有那个文件
    expect(() => readFileSync(customProvidersPath(ws), "utf8")).toThrow();
  });

  it("缺钥匙 ⇒ 把「配哪条命令」原样交回来（表单直接显示）", async () => {
    const r = await discoverForProviderSetup(
      { baseURL: "https://api.deepseek.com/v1", protocol: "openai", keyEnv: "DEEPSEEK_API_KEY" },
      { loadCatalogImpl: async () => CATALOG, env: {} },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no-key");
      expect(r.message).toContain("export DEEPSEEK_API_KEY=");
    }
  });

  it("上游 401 ⇒ 原样报 http 失败（表单据此提示去核对钥匙）", async () => {
    const r = await discoverForProviderSetup(
      { baseURL: "https://api.deepseek.com/v1", protocol: "openai", keyEnv: "K", keyValue: "bad" },
      { fetchImpl: (async () => upstream({ error: "bad key" }, 401)) as unknown as typeof fetch, loadCatalogImpl: async () => CATALOG },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("http");
  });
});

describe("saveCustomProvider：upsert 且不覆盖读不懂的文件", () => {
  const entry = {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai" as const,
    baseURL: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    // 故意不写 model：调用方不必把 id 抄两遍（保存时会补成 model = id）
    models: [{ id: "deepseek-chat", contextWindow: 131_072, price: { inputPerMTok: 0.28, outputPerMTok: 0.42 } }],
  };

  it("新写一家 ⇒ 文件落地且能被我们自己的校验读回", async () => {
    const ws = workspace();
    const r = await saveCustomProvider(ws, entry);
    if (!r.ok) throw new Error(r.error);
    expect(r.providers).toEqual(["deepseek"]);
    const written = JSON.parse(readFileSync(customProvidersPath(ws), "utf8")) as {
      providers: { id: string; models: { id: string; model?: string }[] }[];
    };
    expect(written.providers[0].id).toBe("deepseek");
    // 写进文件时上游调用名是显式的（schema 严格，不靠"读的时候再补"）
    expect(written.providers[0].models[0].model).toBe("deepseek-chat");
    expect(r.derived[0].specs[0].id).toBe("deepseek-chat");
  });

  it("upsert 保住别的家，并就地替换同名那家", async () => {
    const ws = workspace(
      JSON.stringify({
        version: 1,
        providers: [
          { id: "moonshot", protocol: "openai", baseURL: "https://api.moonshot.cn/v1", apiKeyEnv: "MOONSHOT_API_KEY", models: [{ id: "kimi", model: "kimi" }] },
          { id: "deepseek", protocol: "openai", baseURL: "https://old.example.com/v1", apiKeyEnv: "OLD_KEY", models: [{ id: "old", model: "old" }] },
        ],
      }),
    );
    const r = await saveCustomProvider(ws, entry);
    if (!r.ok) throw new Error(r.error);
    expect([...r.providers].sort()).toEqual(["deepseek", "moonshot"]);
    const written = JSON.parse(readFileSync(customProvidersPath(ws), "utf8")) as {
      providers: { id: string; baseURL: string }[];
    };
    expect(written.providers.find((p) => p.id === "moonshot")?.baseURL).toBe("https://api.moonshot.cn/v1");
    expect(written.providers.find((p) => p.id === "deepseek")?.baseURL).toBe("https://api.deepseek.com/v1");
  });

  it("现有文件是坏 JSON ⇒ 拒绝写（不拿我们的 upsert 盖掉用户手写的东西）", async () => {
    const ws = workspace("{ 这不是 JSON");
    const r = await saveCustomProvider(ws, entry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("不是合法 JSON");
    expect(readFileSync(customProvidersPath(ws), "utf8")).toBe("{ 这不是 JSON"); // 原样不动
  });

  it("现有文件校验不过 ⇒ 拒绝写并交出问题清单", async () => {
    const ws = workspace(JSON.stringify({ version: 1, providers: [{ id: "openai", protocol: "openai", baseURL: "http://x", apiKeyEnv: "k", models: [] }] }));
    const r = await saveCustomProvider(ws, entry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems?.length ?? 0).toBeGreaterThan(0);
  });

  it("要写进去的条目自己不合法 ⇒ 拒绝写（错误信息带字段路径）", async () => {
    const ws = workspace();
    const r = await saveCustomProvider(ws, { ...entry, id: "openai" }); // 占用内置名
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems?.[0].kind).toBe("provider-id");
      expect(r.problems?.[0].where).toBe("providers[0].id"); // 空文件起手 ⇒ 新条目就是第 0 项
    }
  });
});

describe("表单默认值推导：与命令行同一套", () => {
  it("地址 → id → 变量名", () => {
    expect(suggestSetupDefaults("https://api.deepseek.com/v1")).toEqual({
      providerId: "deepseek",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
    expect(suggestSetupDefaults("https://api.openai.com/v1").note).toContain("内置");
  });
});

describe("本地端点：加 allowLocalEndpoint 之后必须能存（用户实测那条路）", () => {
  const localEntry = {
    id: "localllm",
    protocol: "openai" as const,
    baseURL: "http://127.0.0.1:8080/v1",
    apiKeyEnv: "LOCAL_KEY",
    models: [{ id: "local-model", model: "local-model" }],
  };

  it("不加 allowLocalEndpoint ⇒ 按规矩拒（两条：只允许 https + 这是本地地址）", () => {
    const ws = workspace();
    const r = prepareCustomProvider(ws, localEntry);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const messages = (r.problems ?? []).map((p) => p.message).join(" ");
    expect(messages).toContain("https");
    expect(messages).toContain("本地");
  });

  it("显式加上 ⇒ 通过（表单现在会把它带上）", () => {
    const ws = workspace();
    const r = prepareCustomProvider(ws, { ...localEntry, allowLocalEndpoint: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.derived[0].specs[0].id).toBe("localllm-local-model");
  });
});
