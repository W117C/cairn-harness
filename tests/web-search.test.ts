// M3 · web_search 的判卷：配置面（fail-closed / 坏 JSON fail loud）+ 传输面（离网，注入 fetchImpl）
// + 网络类对账（staticRisk=high / isNetworkCommandCall / isSideEffectTool 三格与生产同源）。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractHtmlResults, extractResults, loadSearchConfig, makeWebSearch, webSearchSpec } from "../src/tools/web-search";
import { sessionToolSpecs } from "../src/agent/session-provider";
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

  it("html provider：端点必填、无需 key", async () => {
    await writeCfg(JSON.stringify({ search: { provider: "html", endpoint: "https://search.example/html" } }));
    expect(loadSearchConfig(dir)).toMatchObject({ provider: "html", endpoint: "https://search.example/html" });
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

  it("非空 url 必须是 http(s)：javascript:/data: 丢掉，空 url 的无链接占位保留", () => {
    const r = extractResults({
      results: [
        { title: "js", url: "javascript:alert(1)" },
        { title: "data", url: "data:text/html,<b>x</b>" },
        { title: "ok", url: "https://ok.example/" },
        { title: "placeholder" },
      ],
    });
    expect(r.map((x) => x.title)).toEqual(["ok", "placeholder"]);
    expect(r[1]!.url).toBe("");
  });

  it("同一 URL 只留第一条；带用户名/密码的 URL 丢掉", () => {
    const r = extractResults({
      results: [
        { title: "a", url: "https://x.example/" },
        { title: "dup", url: "https://x.example/" },
        { title: "creds", url: "https://u:p@x.example/" },
        { title: "b", url: "https://y.example/" },
      ],
    });
    expect(r.map((x) => x.title)).toEqual(["a", "b"]);
  });

  it("HTML 结果页：相对链接按端点解析、脚本里的假链接不进来、同 URL 去重", () => {
    const html = '<html><head><style>.x{}</style><script>var a = "<a href=\'/evil\'>Evil</a>";</script></head><body>' +
      '<div><a href="/a">Alpha result</a><p>Alpha snippet</p></div>' +
      '<div><a href="https://b.example/b">Beta result</a><p>Beta snippet</p></div>' +
      '<div><a href="/c">Gamma result</a><p>Gamma snippet</p></div>' +
      '<div><a href="/a">Alpha duplicate</a><p>dup</p></div>' +
      '</body></html>';
    const r = extractHtmlResults(html, "https://search.example/api?q=x");
    expect(r.map((x) => x.title)).toEqual(["Alpha result", "Beta result", "Gamma result"]);
    expect(r[0]!.url).toBe("https://search.example/a");
    expect(r.every((x) => !x.url.includes("/evil"))).toBe(true);
  });

  it("HTML 的 <base href> 优先于端点 URL 解析相对链接", () => {
    const html = '<html><head><base href="https://cdn.example/base/"></head><body>' +
      '<div><a href="a">Alpha</a><p>alpha snippet</p></div>' +
      '<div><a href="https://b.example/b">Beta</a><p>beta snippet</p></div>' +
      '<div><a href="c">Gamma</a><p>gamma snippet</p></div>' +
      '</body></html>';
    const r = extractHtmlResults(html, "https://search.example/search?q=x");
    expect(r[0]!.url).toBe("https://cdn.example/base/a");
    expect(r[2]!.url).toBe("https://cdn.example/base/c");
  });

  it("DuckDuckGo 形状：摘要放在下一个 a.result__snippet，不把摘要当结果", () => {
    const html = '<html><body>' +
      '<div><h2><a class="result__a" href="https://a.example/">Alpha</a></h2><a class="result__snippet" href="https://a.example/">Alpha snippet</a></div>' +
      '<div><h2><a class="result__a" href="https://b.example/">Beta</a></h2><a class="result__snippet" href="https://b.example/">Beta snippet</a></div>' +
      '<div><h2><a class="result__a" href="https://c.example/">Gamma</a></h2><a class="result__snippet" href="https://c.example/">Gamma snippet</a></div>' +
      '</body></html>';
    const r = extractHtmlResults(html, "https://search.example/html");
    expect(r.map((x) => x.title)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(r.map((x) => x.snippet)).toEqual(["Alpha snippet", "Beta snippet", "Gamma snippet"]);
  });

  it("HTML 数值实体（&#x2F; / &#39;）在 URL 与标题里被解码", () => {
    const html = '<html><body>' +
      '<div><a href="https://a.example/&#x2F;x">Alpha &#x27;quoted&#x27;</a><p>one</p></div>' +
      '<div><a href="https://b.example/b">Beta</a><p>two</p></div>' +
      '<div><a href="https://c.example/c">Gamma</a><p>three</p></div>' +
      '</body></html>';
    const r = extractHtmlResults(html, "https://search.example/html");
    expect(r[0]!.url).toBe("https://a.example//x");
    expect(r[0]!.title).toBe("Alpha 'quoted'");
  });

  it("HTML 结果页抽不出（同主机/无摘要）⇒ 空数组，交给原文降级", () => {
    expect(extractHtmlResults('<a href="/a">A</a><a href="/b">B</a><a href="/c">C</a>', "https://s.example/")).toEqual([]);
  });

  it("标题/摘要里的 NUL/ESC 控制字符被清掉", () => {
    const r = extractResults({ results: [{ title: "a\u0000b", url: "https://x.example/", snippet: "s\u001b[31m" }] });
    expect(r[0]!.title).toBe("ab");
    expect(r[0]!.snippet).toBe("s[31m");
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

  it("无链接结果在清单里显示 (无链接)，不留空行", async () => {
    const tool = makeWebSearch({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response(JSON.stringify({ results: [{ title: "No link" }] }), { headers: { "content-type": "application/json" } }) as unknown as Response,
    });
    const r = await tool.run({ query: "x" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("1. No link\n   (无链接)");
  });

  it("html provider 走同一条 HTML 抽取：配置无需 API Key", async () => {
    const html = '<html><body>' +
      '<div><a href="/a">Alpha result</a><p>Alpha snippet</p></div>' +
      '<div><a href="https://b.example/b">Beta result</a><p>Beta snippet</p></div>' +
      '<div><a href="/c">Gamma result</a><p>Gamma snippet</p></div>' +
      '</body></html>';
    const tool = makeWebSearch({
      config: { provider: "html", endpoint: "https://search.example/html" },
      resolveHost: publicResolver,
      fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html" } }) as unknown as Response,
    });
    const r = await tool.run({ query: "x" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("Alpha result");
    expect(r.output).toContain("https://search.example/a");
  });

  it("requireResults 也接受 HTML 结果页（测试连接不把有效 HTML 判成失败）", async () => {
    const html = '<html><body>' +
      '<div><a href="/a">Alpha result</a><p>Alpha snippet</p></div>' +
      '<div><a href="https://b.example/b">Beta result</a><p>Beta snippet</p></div>' +
      '<div><a href="/c">Gamma result</a><p>Gamma snippet</p></div>' +
      '</body></html>';
    const tool = makeWebSearch({
      config: { provider: "html", endpoint: "https://search.example/html" },
      resolveHost: publicResolver,
      requireResults: true,
      fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html" } }) as unknown as Response,
    });
    const r = await tool.run({ query: "x" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("Alpha result");
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

  it("HTML 结果页抽成清单：不再降级为原文，相对链接按端点展开", async () => {
    const html = '<html><body>' +
      '<div><a href="/a">Alpha result</a><p>Alpha snippet</p></div>' +
      '<div><a href="https://b.example/b">Beta result</a><p>Beta snippet</p></div>' +
      '<div><a href="/c">Gamma result</a><p>Gamma snippet</p></div>' +
      '</body></html>';
    const tool = makeWebSearch({
      resolveHost: publicResolver,
      fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html" } }) as unknown as Response,
    });
    const r = await tool.run({ query: "x" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("Alpha result");
    expect(r.output).toContain("https://search.example/a");
    expect(r.output).toContain("Beta snippet");
    expect(r.output).not.toContain("不是结果 JSON");
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
    // 2026-10-25：提示改为可操作的设置路径（服务/地址/Key）——模型不需要从错误文案里学
    // 工具签名，用户需要知道去哪配。下文「一次出网都没有」仍独立钉住 fail-closed。
    expect(r.output).toContain("设置 → 联网搜索");
    expect(r.output).toContain("本工具不做默认厂商");
  });

  // 上一条的标题写着「不做默认厂商」，正文却只核对文案——回落一个厂商这个动作本身没人看得见
  // （ok:false 挡不住"照样发一次请求、再把失败原样报出来"那一支）。这一条钉的是那次请求没发生。
  it("没配端点时一次出网都没有：那句「本工具不做默认厂商」由请求计数钉住，不只由文案钉住", async () => {
    await rm(join(dir, ".agent", "config.json"));
    const seen: string[] = [];
    const tool = makeWebSearch({
      resolveHost: publicResolver,
      fetchImpl: (async (input: unknown) => {
        seen.push(String(input));
        return new Response("{}");
      }) as unknown as typeof fetch,
    });
    const r = await tool.run({ query: "x" }, ctx());
    expect(seen, "任何回落厂商的写法都会在这里留下一条 URL").toEqual([]);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("本工具不做默认厂商，没配即 fail-closed");
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
