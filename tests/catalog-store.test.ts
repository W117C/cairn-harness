// 目录 IO 壳的判卷：三个来源（内置快照 / 本地缓存 / 联网）的优先级与**回退理由**。
// 这里钉的是纪律 2：「读数来源必须可分辨，回退必须说得出理由」。所以每条用例都同时断言两件事——
// 拿到了哪一份数据，以及 note 里有没有把为什么写成给用户看的话。
// 测试数据一律落 mkdtemp（仓规：测试绝不写工作区，也绝不写家目录）。
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCatalog, DEFAULT_CACHE_MAX_AGE_MS } from "../src/main/catalog-store";
import type { CatalogSnapshot } from "../src/providers/catalog";

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "cairn-catalog-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function snapshot(generatedAt?: string): CatalogSnapshot {
  return {
    version: 1,
    source: "models.dev",
    ...(generatedAt !== undefined ? { generatedAt } : {}),
    providers: [
      {
        id: "deepseek",
        name: "DeepSeek",
        apiBaseURL: "https://api.deepseek.com",
        envKeys: ["DEEPSEEK_API_KEY"],
        models: [{ id: "deepseek-chat", contextWindow: 1_000_000, pricing: { inputPerMTok: 0.15, outputPerMTok: 0.6 } }],
      },
    ],
  };
}

/** 布置一个 scratch：写内置快照（可省略）+ 预置缓存（可省略），返回 store 选项。 */
function layout(opts: { snap?: CatalogSnapshot | string | null; cache?: CatalogSnapshot; dir?: string } = {}) {
  const d = opts.dir ?? scratch();
  const snapshotPath = join(d, "catalog-snapshot.json");
  if (opts.snap !== null && opts.snap !== undefined) {
    writeFileSync(snapshotPath, typeof opts.snap === "string" ? opts.snap : JSON.stringify(opts.snap), "utf8");
  }
  const cacheDir = join(d, "cache");
  if (opts.cache !== undefined) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "models-dev.json"), JSON.stringify(opts.cache), "utf8");
  }
  return { dir: cacheDir, snapshotPath };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

/** 上游 models.dev 形状的最小样本（与 catalog-store 的解析面一致）。 */
const LIVE = {
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    api: "https://api.deepseek.com",
    env: ["DEEPSEEK_API_KEY"],
    models: { "deepseek-chat": { id: "deepseek-chat", limit: { context: 1_000_000 }, cost: { input: 0.15, output: 0.6 } } },
  },
};

describe("loadCatalog：三个来源的优先级", () => {
  it("没有缓存、不刷新 ⇒ 用内置快照，且不写 note（这是正常路径，不是降级）", async () => {
    const r = await loadCatalog({ refresh: "never" }, layout({ snap: snapshot("2026-10-01T00:00:00Z") }));
    expect(r.origin).toBe("snapshot");
    expect(r.generatedAt).toBe("2026-10-01T00:00:00Z");
    expect(r.note).toBeUndefined();
    expect(r.catalog.providers[0].id).toBe("deepseek");
  });

  it("有缓存 ⇒ 用缓存（缓存比内置快照新）", async () => {
    const r = await loadCatalog({ refresh: "never" }, layout({ snap: snapshot("2026-01-01T00:00:00Z"), cache: snapshot("2026-10-06T00:00:00Z") }));
    expect(r.origin).toBe("cache");
    expect(r.generatedAt).toBe("2026-10-06T00:00:00Z");
  });

  it("auto + 缓存仍新鲜 ⇒ 根本不联网，并说明「未刷新」", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(LIVE));
    const now = Date.parse("2026-10-06T12:00:00Z");
    const r = await loadCatalog(
      { refresh: "auto" },
      { ...layout({ snap: snapshot("2026-01-01T00:00:00Z"), cache: snapshot("2026-10-06T00:00:00Z") }), fetchImpl, now: () => now },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.origin).toBe("cache");
    expect(r.note).toContain("未刷新");
  });

  it("auto + 缓存过期 ⇒ 联网，用 live，并把新的那份写回缓存", async () => {
    const store = layout({ snap: snapshot("2026-01-01T00:00:00Z"), cache: snapshot("2026-09-01T00:00:00Z") });
    const r = await loadCatalog(
      { refresh: "auto" },
      { ...store, fetchImpl: async () => jsonResponse(LIVE), now: () => Date.parse("2026-10-06T12:00:00Z") },
    );
    expect(r.origin).toBe("live");
    expect(r.generatedAt).toBe("2026-10-06T12:00:00.000Z");
    const written = JSON.parse(readFileSync(join(store.dir, "models-dev.json"), "utf8")) as CatalogSnapshot;
    expect(written.providers[0].models[0].contextWindow).toBe(1_000_000);
    // 过了 TTL 的那份缓存不该再被当成新鲜：再跑一次 auto 会继续联网
    expect(Date.parse("2026-10-06T12:00:00Z") - Date.parse("2026-09-01T00:00:00Z")).toBeGreaterThan(DEFAULT_CACHE_MAX_AGE_MS);
  });
});

describe("loadCatalog：失败必须说得出理由", () => {
  it("刷新抛异常 ⇒ 回退缓存，note 写明刷新失败的原因", async () => {
    const r = await loadCatalog(
      { refresh: "force" },
      {
        ...layout({ snap: snapshot("2026-01-01T00:00:00Z"), cache: snapshot("2026-10-06T00:00:00Z") }),
        fetchImpl: async () => {
          throw new Error("The operation was aborted due to timeout");
        },
      },
    );
    expect(r.origin).toBe("cache");
    expect(r.note).toContain("刷新失败");
    expect(r.note).toContain("timeout");
  });

  it("刷新失败且没有缓存 ⇒ 回退内置快照，note 同时带上原因", async () => {
    const r = await loadCatalog(
      { refresh: "force" },
      { ...layout({ snap: snapshot("2026-01-01T00:00:00Z") }), fetchImpl: async () => jsonResponse({}, 503) },
    );
    expect(r.origin).toBe("snapshot");
    expect(r.note).toContain("503");
  });

  it("数据源返回重定向 ⇒ 当失败处理（不跟随，防把请求带到别处）", async () => {
    const r = await loadCatalog(
      { refresh: "force" },
      { ...layout({ snap: snapshot() }), fetchImpl: async () => jsonResponse("", 302) },
    );
    expect(r.note).toContain("重定向");
    expect(r.origin).toBe("snapshot");
  });

  it("上游返回的不是目录形状 ⇒ 当失败，不把半截数据当成新目录", async () => {
    const r = await loadCatalog(
      { refresh: "force" },
      { ...layout({ snap: snapshot() }), fetchImpl: async () => jsonResponse({ oops: true }) },
    );
    expect(r.origin).toBe("snapshot");
    expect(r.note).toContain("刷新失败");
  });

  it("内置快照缺失 ⇒ 记账后继续（目录是帮填表的辅助，不该拖垮任务）", async () => {
    const r = await loadCatalog({ refresh: "never" }, layout({ snap: null }));
    expect(r.origin).toBe("snapshot");
    expect(r.catalog.providers).toEqual([]);
    expect(r.note).toContain("内置快照不存在");
  });

  it("内置快照损坏 ⇒ 记账后继续，note 说明是哪一步坏的", async () => {
    const r = await loadCatalog({ refresh: "never" }, layout({ snap: "{ 这不是 JSON" }));
    expect(r.note).toContain("内置快照读取失败");
    expect(r.catalog.providers).toEqual([]);
  });

  it("缓存损坏 + 快照正常 ⇒ 用快照并说明缓存坏在哪", async () => {
    const store = layout({ snap: snapshot("2026-01-01T00:00:00Z") });
    mkdirSync(store.dir, { recursive: true });
    writeFileSync(join(store.dir, "models-dev.json"), "not json at all", "utf8");
    const r = await loadCatalog({ refresh: "never" }, store);
    expect(r.origin).toBe("snapshot");
    expect(r.note).toContain("本地缓存损坏");
  });
});
