import { createServer, type ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { readBodyCapped } from "../src/net";
import { checkUpdate } from "../src/main/updater";
import { makeWebFetch } from "../src/tools/web_fetch";

function response(chunks: Uint8Array[], close = false, headers: Record<string, string> = {}) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (close) controller.close();
    },
    cancel,
  });
  return { res: new Response(body, { headers }), body, cancel };
}

describe("正文读取超限仍保留完整前缀", () => {
  it.each([
    ["one chunk", [Buffer.from("abcdefghij")]],
    ["multiple chunks", [Buffer.from("abc"), Buffer.from("defghij")]],
  ] as const)("%s：越界块里仍在预算内的字节不能丢", async (_name, chunks) => {
    const s = response([...chunks]);
    expect(await readBodyCapped(s.res, 8)).toEqual({ text: "abcdefgh", bytes: 10, capped: true });
    expect(s.cancel).toHaveBeenCalledTimes(1);
    expect(s.body.locked).toBe(false);
  });

  it.each([
    { cap: 3, text: "A" },
    { cap: 4, text: "A中" },
  ])("跨块 UTF-8 在 $cap 字节截断：只交付完整字符", async ({ cap, text }) => {
    const bytes = Buffer.from("A中B");
    const s = response([bytes.subarray(0, 2), bytes.subarray(2)]);
    expect(await readBodyCapped(s.res, cap)).toEqual({ text, bytes: 5, capped: true });
    expect(s.body.locked).toBe(false);
  });

  it("恰好等于上限并完整结束：不误标截断，原文不变且释放读锁", async () => {
    const s = response([Buffer.from("abc"), Buffer.from("defgh")], true);
    expect(await readBodyCapped(s.res, 8)).toEqual({ text: "abcdefgh", bytes: 8, capped: false });
    expect(s.body.locked).toBe(false);
    expect(s.cancel).not.toHaveBeenCalled();
  });

  it("读取抛错：保留原错误并释放读锁", async () => {
    const reason = new Error("body transport failed");
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(reason); } });
    await expect(readBodyCapped(new Response(body), 8)).rejects.toBe(reason);
    expect(body.locked).toBe(false);
  });

  it("默认严格声明长度闸：不获取 reader，拒绝时也取消正文", async () => {
    const s = response([Buffer.from("abcdefghij")], false, { "content-length": "10" });
    const reader = vi.spyOn(s.body, "getReader");
    await expect(readBodyCapped(s.res, 8)).rejects.toThrow("body 超上限");
    expect(reader).not.toHaveBeenCalled();
    expect(s.cancel).toHaveBeenCalledTimes(1);
    expect(s.body.locked).toBe(false);
  });

  it("仅提供 text 的传输替身也执行字节上限，不把半个中文字符补成乱码", async () => {
    const res = { headers: new Headers(), text: async () => "A中B" } as unknown as Response;
    expect(await readBodyCapped(res, 3)).toEqual({ text: "A", bytes: 5, capped: true });
  });
});

describe("网页截断和更新清单严格上限各按原契约执行", () => {
  it.each([false, true])("超大网页，声明长度=%s：返回可用前缀并明示不完整", async (declared) => {
    const payload = "useful document starts here\n" + "x".repeat(3 * 1024 * 1024);
    const s = response([Buffer.from(payload)], false, {
      "content-type": "text/plain", ...(declared ? { "content-length": String(Buffer.byteLength(payload)) } : {}),
    });
    const tool = makeWebFetch({ resolveHost: async () => ["8.8.8.8"], fetchImpl: async () => s.res });
    const result = await tool.run({ url: "https://example.com/document" }, { workspace: process.cwd() });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("useful document starts here");
    expect(result.output).toContain("页面可能不完整");
    expect(Buffer.byteLength(result.output)).toBeLessThan(34 * 1024);
    expect(s.cancel).toHaveBeenCalledTimes(1);
    expect(s.body.locked).toBe(false);
  });

  it("超限网页的前缀全为空白时，只报告前缀不可用，不能断言整页为空", async () => {
    const payload = " ".repeat(2 * 1024 * 1024) + "real content beyond the cap";
    const tool = makeWebFetch({ resolveHost: async () => ["8.8.8.8"], fetchImpl: async () => new Response(payload) });
    const result = await tool.run({ url: "https://example.com/document" }, { workspace: process.cwd() });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("前缀");
    expect(result.output).toContain("页面可能不完整");
  });

  it.each([false, true])("更新清单超过 1MiB，声明长度=%s：仍拒绝，即使截断前缀是合法 JSON", async (declared) => {
    const payload = JSON.stringify({ version: "9.9.9", url: "https://example.com/download" }) + " ".repeat(1024 * 1024);
    const s = response([Buffer.from(payload)], false, declared ? { "content-length": String(Buffer.byteLength(payload)) } : {});
    const result = await checkUpdate({ manifestUrl: "https://example.com/manifest.json", currentVersion: "1.0.0", fetchImpl: async () => s.res });
    expect(result.state).toBe("error");
    if (result.state === "error") expect(result.message).toContain("上限");
    expect(s.cancel).toHaveBeenCalledTimes(1);
  });

  it("正常更新清单仍能发现新版", async () => {
    const manifest = { version: "2.0.0", url: "https://example.com/download" };
    expect(await checkUpdate({ manifestUrl: "https://example.com/manifest.json", currentVersion: "1.0.0", fetchImpl: async () => new Response(JSON.stringify(manifest)) }))
      .toMatchObject({ state: "available", version: "2.0.0", url: manifest.url });
  });

  it("真实 HTTP 声明 3MiB 但不结束正文：取到有界前缀后立即关闭连接", async () => {
    let outgoing: ServerResponse | undefined;
    const server = createServer((_req, res) => {
      outgoing = res;
      res.writeHead(200, { "content-type": "text/plain", "content-length": String(3 * 1024 * 1024) });
      res.write("useful HTTP document\n" + "x".repeat(2 * 1024 * 1024 + 64 * 1024));
    });
    await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server has no TCP port");
      const tool = makeWebFetch({
        resolveHost: async () => ["8.8.8.8"],
        fetchImpl: async (_url, init) => fetch(`http://127.0.0.1:${String(address.port)}/document`, init),
      });
      const result = await tool.run({ url: "https://example.com/document" }, { workspace: process.cwd() });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("useful HTTP document");
      expect(result.output).toContain("页面可能不完整");
      await expect.poll(() => outgoing?.destroyed).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    }
  });
});
