import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeWebSearch, webSearchSpec } from "../src/tools/web-search";
import { pinnedHttpFetch } from "../src/tools/web_fetch";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "search-providers-")); await mkdir(join(dir, ".agent")); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
const configure = async (search: unknown) => { await writeFile(join(dir, ".agent", "config.json"), JSON.stringify({ search })); };

it("points unconfigured users to the desktop form and describes templates only as CLI compatibility", async () => {
  const missing = await makeWebSearch().run({ query: "test" }, { workspace: dir });
  expect(missing).toMatchObject({ ok: false });
  expect(missing.output).toContain("设置 → 联网搜索");
  expect(missing.output).toContain("API Key");
  expect(missing.output).not.toContain("{query}");
  expect(webSearchSpec.description).toContain("兼容旧 {query} URL 模板");
  expect(webSearchSpec.description).toContain("API Key");
  expect(webSearchSpec.parameters.properties.query.description).not.toContain("模板");
});

it("SearXNG converts a service URL to /search?q=...&format=json without needing a template", async () => {
  await configure({ provider: "searxng", endpoint: "https://search.example/subpath/" });
  const seen: string[] = [];
  const result = await makeWebSearch({ resolveHost: async () => ["8.8.8.8"], fetchImpl: async (url) => {
    seen.push(url); return new Response('{"results":[{"title":"test","url":"https://example.com"}]}');
  } }).run({ query: "hello 世界" }, { workspace: dir });
  expect(result.ok).toBe(true);
  const request = new URL(seen[0]!);
  expect(request.pathname).toBe("/subpath/search");
  expect(request.searchParams.get("q")).toBe("hello 世界");
  expect(request.searchParams.get("format")).toBe("json");
});

it.each(["brave", "tavily"] as const)("%s uses its API authentication, wire method and result format", async (provider) => {
  vi.stubEnv(provider === "brave" ? "BRAVE_SEARCH_API_KEY" : "TAVILY_API_KEY", "private-api-key");
  await configure({ provider, endpoint: provider === "brave" ? "https://api.search.brave.com/res/v1/web/search" : "https://api.tavily.com/search" });
  const seen: RequestInit[] = [];
  const result = await makeWebSearch({ resolveHost: async () => ["8.8.8.8"], fetchImpl: async (_url, init) => {
    seen.push(init);
    const results = [{ title: "provider-result", url: "https://example.com", description: "useful" }];
    return new Response(JSON.stringify(provider === "brave" ? { web: { results } } : { results }));
  } }).run({ query: "test query" }, { workspace: dir });
  expect(result.ok).toBe(true);
  expect(result.output).toContain("provider-result");
  const headers = new Headers(seen[0]!.headers);
  expect(headers.get(provider === "brave" ? "X-Subscription-Token" : "Authorization")).toBe(provider === "brave" ? "private-api-key" : "Bearer private-api-key");
  if (provider === "tavily") {
    expect(seen[0]!.method).toBe("POST");
    expect(JSON.parse(String(seen[0]!.body))).toMatchObject({ query: "test query", max_results: 10 });
  }
  expect(result.output).not.toContain("private-api-key");
});

it("pinning transport actually sends POST JSON through the pinned socket", async () => {
  let method: string | undefined;
  let body = "";
  const server = createServer((req, res) => {
    method = req.method;
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => { res.end('{"results":[]}'); });
  });
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test port");
    const res = await pinnedHttpFetch(`http://local-search.invalid:${address.port}/search`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"query":"hello"}',
    }, ["127.0.0.1"]);
    await res.text();
    expect(method).toBe("POST");
    expect(body).toBe('{"query":"hello"}');
  } finally { await new Promise<void>((resolve, reject) => { server.close((e) => { if (e) reject(e); else resolve(); }); }); }
});

it.each(["redirect", "http", "results", "raw"] as const)("never returns a reflected API key through %s output", async (shape) => {
  vi.stubEnv("CAIRN_SEARCH_API_KEY", "no-leak-key+/?");
  await configure({ provider: "custom", endpoint: "https://search.example" });
  const result = await makeWebSearch({ resolveHost: async () => ["8.8.8.8"], fetchImpl: async () => {
    if (shape === "redirect") return new Response(null, { status: 302, headers: { location: "https://elsewhere.example/?key=no-leak-key%2B%2F%3F" } });
    if (shape === "http") return new Response(null, { status: 401, statusText: "no-leak-key+/?" });
    if (shape === "results") return new Response('{"results":[{"title":"no-leak-key+/?","url":"https://example.com"}]}');
    return new Response("no-leak-key+/?");
  } }).run({ query: "test" }, { workspace: dir });
  expect(result.output).not.toContain("no-leak-key+/?");
  expect(result.output).not.toContain("no-leak-key%2B%2F%3F");
});
