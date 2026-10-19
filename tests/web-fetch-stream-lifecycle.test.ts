import { randomBytes } from "node:crypto";
import { createServer, get, type IncomingMessage, type ServerResponse } from "node:http";
import { setImmediate as nextTurn, setTimeout as wait } from "node:timers/promises";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { decodeResponseBody, makeWebFetch } from "../src/tools/web_fetch";

const codecs = [
  { encoding: "gzip", encode: gzipSync },
  { encoding: "deflate", encode: deflateSync },
  { encoding: "br", encode: brotliCompressSync },
];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function stream(encoding: string) {
  let outgoing!: ServerResponse;
  const server = createServer((_req, res) => {
    outgoing = res;
    res.writeHead(200, { "content-type": "text/plain", "content-encoding": encoding });
    res.flushHeaders();
  });
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not get a TCP port");
  const message = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(`http://127.0.0.1:${String(address.port)}/document`, { agent: false }, resolve);
    request.once("error", reject);
  });
  const socket = message.socket;
  const headers = new Headers({ "content-encoding": encoding, "content-type": "text/plain" });
  const decoded = decodeResponseBody(message, headers);
  cleanups.push(async () => {
    if (!decoded.locked) await decoded.cancel().catch(() => {});
    message.destroy();
    socket.destroy();
    await nextTurn();
  });
  return {
    socket, message, decoded, headers,
    write: (bytes: Buffer) => { outgoing.write(bytes); },
    end: (bytes: Buffer) => { outgoing.end(bytes); },
  };
}

async function collect(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks);
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

async function expectClosed(s: Awaited<ReturnType<typeof stream>>): Promise<void> {
  // TCP 先关闭，IncomingMessage 的 aborted/close 在后续 I/O 回合到达。
  await expect.poll(() => s.message.closed).toBe(true);
  expect(s.message.destroyed).toBe(true);
  expect(s.socket.destroyed).toBe(true);
}

describe("压缩网页流的取消与背压", () => {
  it.each(codecs)("$encoding：消费方取消后，HTTP 输入和 socket 都关闭", async ({ encoding, encode }) => {
    const s = await stream(encoding);
    const reader = s.decoded.getReader();
    try {
      // 压缩数据完整但 HTTP 传输尚未结束，模拟仍在下载的响应。
      s.write(encode(Buffer.from("document content ".repeat(20_000))));
      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(first.value?.byteLength).toBeGreaterThan(0);
      await reader.cancel();
      await expectClosed(s);
    } finally { reader.releaseLock(); }
  });

  it("尚未收到第一块数据时取消，也会终止整条下载解码链", async () => {
    const s = await stream("gzip");
    await s.decoded.cancel();
    await expectClosed(s);
  });

  it("消费方暂不读取时，上游保留背压；恢复读取后仍完整交付", async () => {
    const payload = randomBytes(2 * 1024 * 1024);
    const encoded = gzipSync(payload);
    const s = await stream("gzip");
    let sent = 0;
    // IncomingMessage 仍走生产解码函数，只把网络输入换成按需供给的字节块。
    s.message._read = () => {
      if (sent === encoded.length) { s.message.complete = true; s.message.push(null); return; }
      const end = Math.min(sent + 4_096, encoded.length);
      const chunk = encoded.subarray(sent, end);
      sent = end;
      s.message.push(chunk);
    };
    await wait(250);
    expect(sent, "消费方未读时，不应把整份压缩响应灌进内部缓冲区").toBeLessThan(encoded.length);
    expect(await collect(s.decoded)).toEqual(payload);
    expect(sent).toBe(encoded.length);
  });

  it.each(codecs)("$encoding：正常结束仍交付原文", async ({ encoding, encode }) => {
    const s = await stream(encoding);
    const payload = Buffer.from("中文文档与完整正文\n".repeat(128));
    s.end(encode(payload));
    expect(await collect(s.decoded)).toEqual(payload);
  });

  it.each(codecs)("$encoding：损坏的正文仍返回可读的编码错误", async ({ encoding }) => {
    const s = await stream(encoding);
    s.end(Buffer.from("invalid compressed document"));
    await expect(collect(s.decoded)).rejects.toThrow(`响应内容解码失败（content-encoding: ${encoding}）`);
  });

  it.each(codecs)("$encoding：web_fetch 达到 2MiB 读取上限后，返回可用正文并终止上游", async ({ encoding, encode }) => {
    const s = await stream(encoding);
    const tool = makeWebFetch({
      resolveHost: async () => ["8.8.8.8"],
      fetchImpl: async () => new Response(s.decoded, { status: 200, headers: s.headers }),
    });
    s.write(encode(Buffer.from("document starts here\n" + "x".repeat(3 * 1024 * 1024))));
    const result = await tool.run({ url: "https://example.com/large-document" }, { workspace: process.cwd() });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("document starts here");
    expect(result.output).toContain("页面可能不完整");
    await expectClosed(s);
  });
});
