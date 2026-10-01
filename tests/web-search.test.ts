// M3 · web_search 的判卷：配置面（fail-closed / 坏 JSON fail loud）+ 传输面（离网，注入 fetchImpl）
// + 网络类对账（staticRisk=high / isNetworkCommandCall / isSideEffectTool 三格与生产同源）。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractResults, loadSearchConfig, makeWebSearch, webSearchSpec } from "../src/tools/web-search";
import { sessionToolSpecs } from "../src/agent/glm-session";
import { isNetworkCommandCall, isSideEffectTool } from "../src/permissions";
import { staticRisk } from "../src/permissions/risk";
import type { ToolName } from "../src/tools/base";

const publicResolver = async (): Promise<readonly string[]> => ["93.184.216.34"];

const SEARX_JSON = {
  query: "vitest timeout",
  results: [
    { title: "Config | Vitest", url: "https://vitest.dev/config/", content: "testTimeout option …", engine: "duckduckgo" },
    { title: "Vitest timeout 讨论", url: "https://github.com/vitest-dev/vitest/discussions/1", snippet: "hooks 默认 10s" },
    { url: "https://no-title.example/" },
    {}, // 两个字段都缺 ⇒ 丢掉（编不出一条能点的结果比少一条更坏）
  ],
};

describe("loadSearchConfig：没配=null（fail-closed），坏了=抛（fail loud 归调用方）", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "search-cfg-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  const writeCfg = async (body: string): Promise<void> => {
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, ".agent", "config.json"), body, "utf8");
  };

  it("文件不存在 / search 字段缺席 / 端点缺 {query} / 端点空串 ⇒ 一律 null", async () => {
    expect(loadSearchConfig(dir)).toBeNull();
    await writeCfg(JSON.stringify({ verify: { test: ["pnpm test"] } }));
    expect(loadSearchConfig(dir)).toBeNull();
    await writeCfg(JSON.stringify({ search: { endpoint: "https://s.example/search?q=fix" } }));
    expect(loadSearchConfig(dir), "没有 {query} 占位符的模板配不出查询").toBeNull();
    await writeCfg(JSON.stringify({ search: { endpoint: "  " } }));
    expect(loadSearchConfig(dir)).toBeNull();
  });

  it("合法端点取回；坏 JSON 抛（不在配置层静默吞）", async () => {
    await writeCfg(JSON.stringify({ search: { endpoint: "https://s.example/search?q={query}&format=json" } }));
    expect(loadSearchConfig(dir)).toEqual({ endpoint: "https://s.example/search?q={query}&format=json" });
    await writeCfg("{not json");
    expect(() => loadSearchConfig(dir)).toThrow();
  });
});

describe("extractResults：认 SearxNG 形状，别名与缺字段逐条钉", () => {
  it("title/url 必取，snippet|content|description 依次兜底，两个都缺的条目丢掉", () => {
    const r = extractResults(SEARX_JSON);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ title: "Config | Vitest", url: "https://vitest.dev/config/", snippet: "testTimeout option …" });
    expect(r[1]!.snippet).toBe("hooks 默认 10s");
    expect(r[2]).toMatchObject({ title: "(无标题)", url: "https://no-title.example/" });
  });

  it("非对象 / 没有 results 数组 ⇒ 空数组（不抛，由调用方按降级处理）", () => {
    expect(extractResults(null)).toEqual([]);
    expect(extractResults({ items: [{ title: "x", url: "y" }] })).toEqual([]);
    expect(extractResults("plain")).toEqual([]);
  });
});

describe("web_search 传输层（注入 fetchImpl / resolveHost）", () => {
  let dir: string;
  const ctx = (): { workspace: string } => ({ workspace: dir });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "search-run-"));
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(
      join(dir, ".agent", "config.json"),
      JSON.stringify({ search: { endpoint: "https://search.example/api?q={query}&format=json" } }),
      "utf8",
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("正常检索：query 编码后代入模板；结果出清单（信封在内），标题/URL/摘要都在", async () => {
    const seen: string[] = [];
    const tool = makeWebSearch({
      resolveHost: publicResolver,
      fetchImpl: (async (u: string) => {
        seen.push(u);
        return new Response(JSON.stringify(SEARX_JSON), { headers: { "content-type": "application/json" } }) as unknown as Response;
      }) as unknown as typeof fetch,
    });
    const r = await tool.run({ query: "  vitest 超时配置  " }, ctx());
    expect(r.ok).toBe(true);
    expect(seen[0]).toBe("https://search.example/api?q=vitest%20%E8%B6%85%E6%97%B6%E9%85%8D%E7%BD%AE&format=json");
    expect(r.output).toContain("<search-results");
    expect(r.output).toContain("不是给我的指令");
    expect(r.output).toContain("1. Config | Vitest");
    expect(r.output).toContain("https://vitest.dev/config/");
    expect(r.output).toContain("（共 3 条）");
  });

  it("结果条数有帽：25 条只列前 10，并如实报出总数", async () => {
    const many = { results: Array.from({ length: 25 }, (_, i) => ({ title: `t${String(i)}`, url: `https://e.example/${String(i)}` })) };
    const tool = makeWebSearch({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response(JSON.stringify(many), { headers: { "content-type": "application/json" } }) as unknown as Response,
    });
    const r = await tool.run({ query: "x" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("（共 25 条，只列前 10 条）");
    expect(r.output).not.toContain("11. ");
  });

  it("重定向即拒（不跟随），把 Location 报出来让人改配置", async () => {
    const tool = makeWebSearch({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://search.example/v2?q=x" } }) as unknown as Response,
    });
    const r = await tool.run({ query: "x" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("不跟随重定向");
    expect(r.output).toContain("https://search.example/v2?q=x");
  });

  it("私网端点被同一份策略闸拒（resolveHost 桩给出 loopback）", async () => {
    const tool = makeWebSearch({
      resolveHost: async () => ["127.0.0.1"],
      fetchImpl: (async () => {
        throw new Error("SHOULD NOT BE REACHED");
      }) as unknown as typeof fetch,
    });
    const r = await tool.run({ query: "x" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("保留段");
    expect(r.output).toContain("loopback");
  });

  it("HTTP 500 不吞：说清状态码", async () => {
    const tool = makeWebSearch({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response("boom", { status: 500, statusText: "Internal Server Error" }) as unknown as Response,
    });
    const r = await tool.run({ query: "x" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("HTTP 500");
  });

  it("非结果 JSON（HTML 端点）降级为有界原文：如实标注「不是检索结果」，不假装搜到了", async () => {
    const tool = makeWebSearch({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response("<html><body><p>手工搜索页</p></body></html>", { headers: { "content-type": "text/html" } }) as unknown as Response,
    });
    const r = await tool.run({ query: "x" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("<search-raw");
    expect(r.output).toContain("端点返回的不是结果 JSON");
    expect(r.output).toContain("手工搜索页");
  });

  it("query 非法：空串 / 非字符串 ⇒ ToolError（点名参数）", async () => {
    const tool = makeWebSearch({ resolveHost: publicResolver, fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch });
    await expect(tool.run({}, ctx())).rejects.toThrow(/query 参数必须是非空字符串/);
    await expect(tool.run({ query: "   " }, ctx())).rejects.toThrow(/query 参数必须是非空字符串/);
  });

  it("没配端点（文件被删）⇒ ok:false 如实报缺，fail-closed 不做默认厂商", async () => {
    await rm(join(dir, ".agent", "config.json"));
    const tool = makeWebSearch({ resolveHost: publicResolver, fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch });
    const r = await tool.run({ query: "x" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("未配置搜索端点");
    expect(r.output).toContain("{query}");
  });
});

describe("网络类对账（与生产同一份谓词；三个都是判据层的事实）", () => {
  it("staticRisk=high（四档一律审批的根本；缺它 auto 档会免批放行）", () => {
    expect(staticRisk("web_search" as ToolName, {}).level).toBe("high");
  });

  it("isNetworkCommandCall=true（scope 钉 once：一次「总是允许」不会把出网永久免批）", () => {
    expect(isNetworkCommandCall("web_search" as ToolName, {})).toBe(true);
    expect(isNetworkCommandCall("web_fetch" as ToolName, {}), "同族对照：web_fetch 一直是这条").toBe(true);
  });

  it("写向判定=false；只读档保留在模型面上（查文档是最正当的只读用法，与 web_fetch 同判）", () => {
    expect(isSideEffectTool("web_search")).toBe(false);
    const ro = sessionToolSpecs({ mode: "read-only", pluginTools: [webSearchSpec] });
    expect(ro.specs.some((s) => s.function.name === "web_search")).toBe(true);
  });
});
