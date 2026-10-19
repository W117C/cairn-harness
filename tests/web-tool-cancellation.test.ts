import { createServer, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeWebFetch } from "../src/tools/web_fetch";
import { makeWebSearch } from "../src/tools/web-search";
import type { HostResolver } from "../src/tools/web-fetch-policy";
import type { Tool, ToolResult } from "../src/tools/base";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const tools = [
  { name: "web_fetch", args: { url: "https://example.com/document" }, make: makeWebFetch },
  { name: "web_search", args: { query: "document" }, make: makeWebSearch },
] as const;

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), "web-tool-cancel-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".agent"));
  await writeFile(join(dir, ".agent", "config.json"), JSON.stringify({ search: { endpoint: "https://search.example/api?q={query}" } }));
  return dir;
}

function observe(tool: Tool, args: Record<string, unknown>, dir: string, signal?: AbortSignal) {
  let settled = false;
  const pending = tool.run(args, { workspace: dir, signal }).then((result) => { settled = true; return result; });
  return { pending, settled: () => settled };
}

function expectCancelled(result: ToolResult, reason: Error) {
  expect(result.ok).toBe(false);
  expect(result.output).toMatch(/^\[cancelled\]/u);
  expect(result.output).toContain(reason.message);
}

describe.each(tools)("$name 的会话取消", ({ args, make }) => {
  it("进入前已取消：不解析 DNS，也不发请求", async () => {
    const dir = await workspace();
    const controller = new AbortController();
    const reason = new Error("stopped before web tool");
    controller.abort(reason);
    const resolveHost = vi.fn<HostResolver>().mockResolvedValue(["8.8.8.8"]);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("must not fetch"));
    expectCancelled(await make({ resolveHost, fetchImpl }).run(args, { workspace: dir, signal: controller.signal }), reason);
    expect(resolveHost).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["resolved", "rejected"] as const)("DNS 尚未返回时取消：等待立即收束，晚到的 %s 不会启动新请求或变成未处理异常", async (late) => {
    const dir = await workspace();
    const controller = new AbortController();
    const reason = new Error("stopped during DNS lookup");
    const dns = deferred<readonly string[]>();
    const entered = deferred<void>();
    const resolveHost: HostResolver = async () => { entered.resolve(); return dns.promise; };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("must not fetch after DNS"));
    const run = observe(make({ resolveHost, fetchImpl }), args, dir, controller.signal);
    try {
      await entered.promise;
      controller.abort(reason);
      await nextTurn();
      expect(run.settled()).toBe(true);
      expectCancelled(await run.pending, reason);
      if (late === "resolved") dns.resolve(["8.8.8.8"]);
      else dns.reject(new Error("late DNS failure"));
      await nextTurn();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally { dns.resolve(["8.8.8.8"]); await run.pending; }
  });

  it("DNS 返回前一刻取消：不跨越等待边界发起连接", async () => {
    const dir = await workspace();
    const controller = new AbortController();
    const reason = new Error("stop as DNS returns");
    const resolveHost: HostResolver = async () => { controller.abort(reason); return ["8.8.8.8"]; };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("must not connect"));
    expectCancelled(await make({ resolveHost, fetchImpl }).run(args, { workspace: dir, signal: controller.signal }), reason);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("响应与取消同时返回：取消未消费的正文，不报告成功", async () => {
    const dir = await workspace();
    const controller = new AbortController();
    const reason = new Error("stop as response arrives");
    const response = new Response("late document");
    if (!response.body) throw new Error("fixture response has no body");
    const cancel = vi.spyOn(response.body, "cancel");
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(reason); return response; });
    const result = await make({ resolveHost: async () => ["8.8.8.8"], fetchImpl }).run(args, { workspace: dir, signal: controller.signal });
    expectCancelled(result, reason);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("停滞守卫也覆盖挂起的 DNS，不依赖解析器自行支持 signal", async () => {
    const dir = await workspace();
    const dns = deferred<readonly string[]>();
    const entered = deferred<void>();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("must not fetch after stall"));
    vi.useFakeTimers();
    const run = observe(make({ resolveHost: async () => { entered.resolve(); return dns.promise; }, fetchImpl }), args, dir);
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(30_001);
      expect(run.settled()).toBe(true);
      const result = await run.pending;
      expect(result.ok).toBe(false);
      expect(result.output).toContain("停滞超时");
      dns.resolve(["8.8.8.8"]);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { dns.resolve(["8.8.8.8"]); await run.pending; vi.useRealTimers(); }
  });

  it("没有会话 signal 时，仍正常返回网页或检索内容", async () => {
    const dir = await workspace();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("normal document", { headers: { "content-type": "text/plain" } }));
    const result = await make({ resolveHost: async () => ["8.8.8.8"], fetchImpl }).run(args, { workspace: dir });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("normal document");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["headers", "body", "gzip"] as const)("真实 HTTP 的 %s 阶段取消：请求 signal 中止，连接关闭并保留原因", async (phase) => {
    const dir = await workspace();
    const controller = new AbortController();
    const reason = new Error("user cancelled real HTTP " + phase);
    const entered = deferred<void>();
    const headersReceived = deferred<void>();
    let outgoing: ServerResponse | undefined;
    const server = createServer((_req, res) => {
      outgoing = res;
      if (phase !== "headers") {
        res.writeHead(200, { "content-type": "text/plain", ...(phase === "gzip" ? { "content-encoding": "gzip" } : {}) });
        res.flushHeaders();
        if (phase === "gzip") res.write(gzipSync("streaming document ".repeat(1_000)));
      }
      entered.resolve();
    });
    await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
    cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => { server.close(() => { resolve(); }); }); });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server has no port");
    let requestSignal: AbortSignal | null | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      requestSignal = init?.signal;
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/document`, init);
      headersReceived.resolve();
      return response;
    };
    const run = observe(make({ resolveHost: async () => ["8.8.8.8"], fetchImpl }), args, dir, controller.signal);
    try {
      await (phase === "headers" ? entered.promise : headersReceived.promise);
      if (phase !== "headers") await nextTurn(); // 确保已进入正文读取。
      controller.abort(reason);
      expect(requestSignal?.aborted).toBe(true);
      await expect.poll(run.settled).toBe(true);
      expectCancelled(await run.pending, reason);
      await expect.poll(() => outgoing?.destroyed).toBe(true);
    } finally { outgoing?.end(phase === "gzip" ? undefined : "fixture cleanup"); await run.pending; }
  });
});

it("web_fetch 在清理重定向正文时取消，不再解析下一跳", async () => {
  const dir = await workspace();
  const controller = new AbortController();
  const reason = new Error("stop while cancelling redirect body");
  const body = new ReadableStream<Uint8Array>({ cancel() { controller.abort(reason); } });
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(body, { status: 302, headers: { location: "https://example.com/next" } }))
    .mockResolvedValue(new Response("must not follow redirect"));
  const resolveHost = vi.fn<HostResolver>().mockResolvedValue(["8.8.8.8"]);
  const result = await makeWebFetch({ resolveHost, fetchImpl }).run({ url: "https://example.com/start" }, { workspace: dir, signal: controller.signal });
  expectCancelled(result, reason);
  expect(resolveHost).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it.each([302, 503])("web_search 提前返回 HTTP %s 时，清理未消费的正文", async (status) => {
  const dir = await workspace();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status, headers: { location: "https://search.example/next" } }));
  const result = await makeWebSearch({ resolveHost: async () => ["8.8.8.8"], fetchImpl }).run({ query: "document" }, { workspace: dir });
  expect(result.ok).toBe(false);
  expect(result.output).toContain("HTTP " + String(status));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
