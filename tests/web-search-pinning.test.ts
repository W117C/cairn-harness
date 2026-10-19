import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type RequestOptions, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWebSearch } from "../src/tools/web-search";
import type { WebFetchImpl } from "../src/tools/web_fetch";

const hooks = vi.hoisted(() => ({ http: vi.fn(), https: vi.fn() }));
vi.mock("node:http", async (original) => ({ ...await original<typeof import("node:http")>(), request: hooks.http }));
vi.mock("node:https", async (original) => ({ ...await original<typeof import("node:https")>(), request: hooks.https }));

const nativeFetch = globalThis.fetch;
const dirs: string[] = [];
const servers: Server[] = [];
const wire: { url: URL; options: RequestOptions; secure: boolean }[] = [];
let fixture: { status: number; headers: Record<string, string>; body: string };

beforeEach(() => {
  wire.length = 0;
  fixture = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ results: [{ title: "pinned result", url: "https://example.com/result" }] }) };
  const request = (secure: boolean) => (url: URL, options: RequestOptions, callback: (message: IncomingMessage) => void) => {
    wire.push({ url, options, secure });
    return Object.assign(new EventEmitter(), { end() {
      // HTTP 传输替身提供真实字节流，只有连接建立由本测试截获，绝不访问外网。
      const message = Object.assign(Readable.from([Buffer.from(fixture.body)]), { statusCode: fixture.status, statusMessage: "fixture", headers: fixture.headers });
      // 与真实 ClientRequest 一样，响应在 end() 返回后的 I/O 回调交付。
      setImmediate(() => {
        callback(message as unknown as IncomingMessage);
      });
    } });
  };
  hooks.http.mockReset().mockImplementation(request(false));
  hooks.https.mockReset().mockImplementation(request(true));
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(fixture.body, { status: fixture.status, headers: fixture.headers }));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  }));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function config(endpoint: string, allowLocalEndpoint = false) {
  const dir = await mkdtemp(join(tmpdir(), "search-pinning-"));
  dirs.push(dir);
  await mkdir(join(dir, ".agent"));
  await writeFile(join(dir, ".agent", "config.json"), JSON.stringify({ search: { endpoint, ...(allowLocalEndpoint ? { allowLocalEndpoint: true } : {}) } }));
  return dir;
}

async function pinnedAddresses(hostname = wire[0]?.url.hostname) {
  const lookup = wire[0]?.options.lookup;
  if (!lookup || !hostname) throw new Error("connection did not provide a pinned DNS lookup");
  return new Promise<string[]>((resolve, reject) => {
    lookup(hostname, { all: true }, (error, result) => {
      if (error) return reject(error);
      if (typeof result === "string") return reject(new Error("all=true must return address records"));
      resolve(result.map((record) => record.address));
    });
  });
}

describe("搜索连接必须使用已校验的地址快照", () => {
  it.each(["http", "https"])("%s 默认传输绑定公网校验结果，保留原主机名，不交给全局 fetch 再解析", async (protocol) => {
    const dir = await config(`${protocol}://search.example/api?q={query}`);
    const resolveHost = vi.fn(async () => ["8.8.8.8", "1.1.1.1"]);
    const result = await makeWebSearch({ resolveHost }).run({ query: "document" }, { workspace: dir });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("pinned result");
    expect(resolveHost).toHaveBeenCalledExactlyOnceWith("search.example");
    expect(wire).toHaveLength(1);
    expect(wire[0]?.url.hostname).toBe("search.example");
    expect(wire[0]?.secure).toBe(protocol === "https");
    expect(await pinnedAddresses()).toEqual(["8.8.8.8", "1.1.1.1"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("解析器原数组随后改变也不能改写已校验的连接地址", async () => {
    const dir = await config("https://search.example/api?q={query}");
    const addresses = ["8.8.8.8"];
    const resolveHost = vi.fn(async () => addresses);
    expect((await makeWebSearch({ resolveHost }).run({ query: "x" }, { workspace: dir })).ok).toBe(true);
    addresses[0] = "127.0.0.1";
    expect(await pinnedAddresses()).toEqual(["8.8.8.8"]);
    expect(resolveHost).toHaveBeenCalledTimes(1);
  });

  it("注入传输也得到同一份已校验地址，不能只得到一个待重新解析的 URL", async () => {
    const dir = await config("https://search.example/api?q={query}");
    const addresses = ["8.8.8.8"];
    const fetchImpl = vi.fn<WebFetchImpl>().mockImplementation(async (_url, _init, pinned) => {
      addresses[0] = "127.0.0.1";
      expect(pinned).toEqual(["8.8.8.8"]);
      return new Response(fixture.body);
    });
    const result = await makeWebSearch({ resolveHost: async () => addresses, fetchImpl }).run({ query: "x" }, { workspace: dir });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([["127.0.0.1"], ["8.8.8.8", "127.0.0.1"]])("未许可本地端点时，DNS 返回 %j 仍在连接前拒绝", async (...addresses) => {
    const dir = await config("https://search.example/api?q={query}");
    const result = await makeWebSearch({ resolveHost: async () => addresses }).run({ query: "x" }, { workspace: dir });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("loopback");
    expect(wire).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("显式许可本地域名时仍只解析一次，并把本地地址固定到连接", async () => {
    const dir = await config("http://localhost/search?q={query}", true);
    const resolveHost = vi.fn(async () => ["127.0.0.1"]);
    const result = await makeWebSearch({ resolveHost }).run({ query: "x" }, { workspace: dir });
    expect(result.ok).toBe(true);
    expect(resolveHost).toHaveBeenCalledExactlyOnceWith("localhost");
    expect(await pinnedAddresses()).toEqual(["127.0.0.1"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { host: "127.0.0.1", address: "127.0.0.1" },
    { host: "[::1]", address: "::1" },
  ])("显式许可本地 IP $host 时不多做 DNS 查询", async ({ host, address }) => {
    const dir = await config(`http://${host}/search?q={query}`, true);
    const resolveHost = vi.fn(async () => { throw new Error("IP literal should not use DNS"); });
    expect((await makeWebSearch({ resolveHost }).run({ query: "x" }, { workspace: dir })).ok).toBe(true);
    expect(resolveHost).not.toHaveBeenCalled();
    expect(await pinnedAddresses()).toEqual([address]);
  });

  it.each([[], ["not-an-IP"]])("本地许可也不放过无效解析结果 %j", async (...addresses) => {
    const dir = await config("http://local-search.example/api?q={query}", true);
    const result = await makeWebSearch({ resolveHost: async () => addresses }).run({ query: "x" }, { workspace: dir });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/解析|IP/u);
    expect(wire).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(["file:///tmp/search?q={query}", "data:text/plain,{query}"])("本地许可不改变协议限制：%s", async (endpoint) => {
    const dir = await config(endpoint, true);
    const resolveHost = vi.fn(async () => ["127.0.0.1"]);
    const result = await makeWebSearch({ resolveHost }).run({ query: "x" }, { workspace: dir });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("协议");
    expect(resolveHost).not.toHaveBeenCalled();
    expect(wire).toHaveLength(0);
  });

  it("维持原生 fetch 拒绝 URL 用户名/密码的限制，避免换传输时意外开启凭据发送", async () => {
    const dir = await config("https://user:fixture-password@search.example.invalid/api?q={query}");
    vi.mocked(globalThis.fetch).mockImplementation(nativeFetch);
    const result = await makeWebSearch({ resolveHost: async () => ["8.8.8.8"] }).run({ query: "x" }, { workspace: dir });
    expect(result.ok).toBe(false);
    expect(result.output).not.toContain("fixture-password");
    expect(wire).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("重定向仍拒绝且不连接 Location，即使 Location 指向本地服务", async () => {
    fixture.status = 302;
    fixture.headers.location = "http://127.0.0.1/private";
    const dir = await config("https://search.example/api?q={query}");
    const result = await makeWebSearch({ resolveHost: async () => ["8.8.8.8"] }).run({ query: "x" }, { workspace: dir });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("不跟随重定向");
    expect(wire).toHaveLength(1);
  });

  it("搜索解码失败时标明搜索工具及编码原因", async () => {
    fixture.headers["content-encoding"] = "gzip";
    fixture.body = "invalid gzip bytes";
    const dir = await config("https://search.example/api?q={query}");
    const result = await makeWebSearch({ resolveHost: async () => ["8.8.8.8"] }).run({ query: "x" }, { workspace: dir });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("web_search: 响应内容解码失败");
    expect(result.output).not.toContain("web_fetch:");
  });

  it.each([200, 302])("真实 HTTP 本地端点在显式许可后保留原 Host，并正确处理 HTTP %s", async (status) => {
    const actual = await vi.importActual<typeof import("node:http")>("node:http");
    hooks.http.mockImplementation(actual.request);
    let host = "";
    const server = createServer((req, res) => {
      host = req.headers.host ?? "";
      res.writeHead(status, { "content-type": "application/json", ...(status === 302 ? { location: "http://127.0.0.1/private" } : {}) });
      res.end(fixture.body);
    });
    servers.push(server);
    await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server has no TCP port");
    const dir = await config(`http://local-search.example:${String(address.port)}/api?q={query}`, true);
    const resolveHost = vi.fn(async () => ["127.0.0.1"]);
    const result = await makeWebSearch({ resolveHost }).run({ query: "local" }, { workspace: dir });
    expect(result.ok).toBe(status === 200);
    if (status === 302) expect(result.output).toContain("不跟随重定向");
    expect(host).toBe(`local-search.example:${String(address.port)}`);
    expect(resolveHost).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
