import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_TOKENS_FALLBACK,
  estimateImageTokens,
  imageCountOfMessages,
  imagePixelSize,
  imageTokensOfMessages,
  sumImageTokens,
  withoutImagePayloads,
} from "../src/agent/image-budget";
import { createImageChannel } from "../src/agent/image-channel";
import { createMockSummarizer } from "../src/agent/compaction";
import { createSessionProvider } from "../src/agent/session-provider";
import { createEventLog, type EventLog } from "../src/events";

vi.mock("../src/agent/memory/inject", async () =>
  (await import("./helpers/memory-inject-mock")).memoryInjectMock({ project: null, global: null }));

let dir: string;
let log: EventLog | undefined;
afterEach(async () => {
  await log?.close?.();
  log = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** 造一张只有头部是真的 PNG data URL：尺寸字段可读，其余字节填 pad（用来复现 106KB 量级的帧）。
 *  没有任何东西会真去解码它——判卷要的是「载荷有多长」，不是「图好不好看」。 */
function pngDataUrl(width: number, height: number, padBytes = 0): string {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  head[24] = 8; // bit depth
  head[25] = 6; // RGBA
  const body = padBytes > 0 ? Buffer.alloc(padBytes, 0x41) : Buffer.alloc(0);
  return "data:image/png;base64," + Buffer.concat([head, body]).toString("base64");
}

function gifDataUrl(width: number, height: number): string {
  const buf = Buffer.alloc(13);
  buf.write("GIF89a", 0, "ascii");
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return "data:image/gif;base64," + buf.toString("base64");
}

function jpegDataUrl(width: number, height: number): string {
  const buf = Buffer.alloc(21);
  buf[0] = 0xff; buf[1] = 0xd8; // SOI
  buf[2] = 0xff; buf[3] = 0xc0; // SOF0
  buf.writeUInt16BE(17, 4); // 段长
  buf[6] = 8; // 精度
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  buf[11] = 3; // 分量数
  return "data:image/jpeg;base64," + buf.toString("base64");
}

function webpDataUrl(width: number, height: number): string {
  const buf = Buffer.alloc(30);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(22, 4);
  buf.write("WEBP", 8, "ascii");
  buf.write("VP8X", 12, "ascii");
  buf.writeUInt32LE(10, 16);
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return "data:image/webp;base64," + buf.toString("base64");
}

describe("图片块按像素计价（base64 字符数不是 token 数）", () => {
  it("四种容器的尺寸都读得出", () => {
    expect(imagePixelSize(pngDataUrl(900, 1200))).toEqual({ width: 900, height: 1200 });
    expect(imagePixelSize(gifDataUrl(320, 200))).toEqual({ width: 320, height: 200 });
    expect(imagePixelSize(jpegDataUrl(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imagePixelSize(webpDataUrl(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it("读不出尺寸时兜底 1,600，而不是 0（0 会让硬闸对图片彻底失明）", () => {
    expect(imagePixelSize("data:image/png;base64,AAAA")).toBeNull();
    expect(imagePixelSize("https://example.com/a.png")).toBeNull();
    expect(estimateImageTokens("data:image/png;base64,AAAA")).toBe(IMAGE_TOKENS_FALLBACK);
    expect(IMAGE_TOKENS_FALLBACK).toBeGreaterThan(0);
  });

  it("900×1200 的帧 ≈ 1,440 token；同一张图再长 100KB 也不会跟着涨", () => {
    const small = pngDataUrl(900, 1200);
    const big = pngDataUrl(900, 1200, 100_000);
    expect(estimateImageTokens(small)).toBe(1_440);
    expect(estimateImageTokens(big)).toBe(1_440); // 字节数变了，像素没变 ⇒ 计价不动
    expect(big.length).toBeGreaterThan(small.length * 50); // 但 base64 长度确实翻了
  });

  it("文本口径只量文本：载荷换成空串，结构留下，原数组不动", () => {
    const messages = [
      { role: "system" as const, content: "SYS" },
      { role: "user" as const, content: "看图", contentParts: [{ type: "image" as const, dataUrl: pngDataUrl(900, 1200, 5_000) }] },
    ];
    const stripped = withoutImagePayloads(messages);
    expect(stripped[1]?.contentParts?.[0]?.dataUrl).toBe("");
    expect(messages[1]?.contentParts?.[0]?.dataUrl.length).toBeGreaterThan(5_000); // 原数组没被改
    expect(imageTokensOfMessages(messages)).toBe(1_440);
    expect(imageCountOfMessages(messages)).toBe(1);
    expect(sumImageTokens([{ dataUrl: pngDataUrl(900, 1200) }, { dataUrl: pngDataUrl(900, 1200) }])).toBe(2_880);
  });
});

describe("识图不再把请求挤爆硬闸", () => {
  it("includes a pending frame in the overflow cut and sends it with the current tool result", async () => {
    dir = await mkdtemp(join(tmpdir(), "image-budget-overflow-"));
    const path = join(dir, "events.jsonl");
    log = createEventLog(path);
    const current = "latest ".repeat(3_400);
    await log.append({ type: "user_message", content: "retain the active screenshot" });
    for (let index = 0; index < 8; index++) await log.append({ type: "assistant_message", content: "small note" });
    await log.append({ type: "tool_call", id: "old", name: "read_file", args: { path: "old.ts" } });
    await log.append({ type: "tool_result", callId: "old", ok: true, output: "older ".repeat(800) });
    await log.append({ type: "user_message", content: "continue" });
    await log.append({ type: "tool_call", id: "current", name: "read_file", args: { path: "current.ts" } });
    await log.append({ type: "tool_result", callId: "current", ok: true, output: current });
    const channel = createImageChannel();
    const dataUrl = pngDataUrl(900, 1200);
    channel.push([{ type: "image", dataUrl }]);
    const sent: { current?: string | null; images?: readonly { dataUrl: string }[] }[] = [];
    const provider = createSessionProvider(path, {
      map: false, workspace: dir, imageChannel: channel,
      compaction: { config: { inputLimit: 10_000, maxOutputReserve: 2_000 } },
      transport: async function* (messages) {
        sent.push({ current: messages.find((message) => message.tool_call_id === "current")?.content,
          images: messages.at(-1)?.contentParts });
        yield { type: "assistant_message", content: "ok" };
      },
    });
    for await (const _ of provider.stream([])) { /* drain */ }
    expect(sent).toEqual([{ current, images: [{ type: "image", dataUrl }] }]);
    expect(channel.size()).toBe(0);
  });

  it("两张 106KB 的帧照常发得出去（旧口径会把它们折成 7 万 token）", async () => {
    dir = await mkdtemp(join(tmpdir(), "image-budget-"));
    const path = join(dir, "events.jsonl");
    log = createEventLog(path);
    await log.append({ type: "user_message", content: "TASK" });

    const channel = createImageChannel();
    const frames = [pngDataUrl(900, 1200, 106_401), pngDataUrl(900, 1200, 106_104)];
    channel.push(frames.map((dataUrl) => ({ type: "image" as const, dataUrl })));
    // 这轮请求的 base64 载荷本来就比任何小窗口的字符预算大——旧口径（chars/4）在这里必红。
    expect(frames.reduce((n, f) => n + f.length, 0)).toBeGreaterThan(250_000);

    const seen: unknown[] = [];
    const provider = createSessionProvider(path, {
      map: false, workspace: dir, ctxWindow: 6_000, imageChannel: channel,
      transport: async function* (messages) {
        seen.push(messages);
        yield { type: "assistant_message" as const, content: "ok" };
      },
    });
    for await (const _ of provider.stream([])) { /* drain */ }

    expect(seen).toHaveLength(1);
    const withImages = (seen[0] as { contentParts?: unknown[] }[]).filter((m) => m.contentParts !== undefined);
    expect(withImages).toHaveLength(1);
    expect(withImages[0]?.contentParts).toHaveLength(2);
    // 发出去之后才清空：同一张图不会在两轮里各付一遍。
    expect(channel.size()).toBe(0);
  });

  it("硬闸拦下时图不被吞：盒里还是那两张，重试能原样再送", async () => {
    dir = await mkdtemp(join(tmpdir(), "image-budget-"));
    const path = join(dir, "events.jsonl");
    log = createEventLog(path);
    await log.append({ type: "user_message", content: "T".repeat(60_000) }); // 文本自己就超窗

    const channel = createImageChannel();
    channel.push([{ type: "image", dataUrl: pngDataUrl(900, 1200, 20_000) }]);

    const provider = createSessionProvider(path, {
      map: false, workspace: dir, ctxWindow: 2_000, imageChannel: channel,
      transport: async function* () { yield { type: "assistant_message" as const, content: "never" }; },
    });
    await expect(async () => { for await (const _ of provider.stream([])) { /* drain */ } })
      .rejects.toThrow("context_budget_exceeded");
    expect(channel.size()).toBe(1);
  });

  it("触发侧也看得见图：只靠图片的重量就能把压缩叫起来", async () => {
    dir = await mkdtemp(join(tmpdir(), "image-budget-"));
    const path = join(dir, "events.jsonl");
    log = createEventLog(path);
    await log.append({ type: "user_message", content: "TASK" });
    // 文本约 20k token（80KB/4），单看文本够不着 40k 窗口的 0.9 线（28,627）。
    await log.append({ type: "assistant_message", content: "A".repeat(80_000) });
    await log.append({ type: "user_message", content: "继续" });

    const channel = createImageChannel();
    // 两张 2000×2000 ≈ 5,334 token/张 ⇒ 加上文本才越过阈值。
    channel.push([{ type: "image", dataUrl: pngDataUrl(2_000, 2_000) }, { type: "image", dataUrl: pngDataUrl(2_000, 2_000) }]);

    const emitted: string[] = [];
    const provider = createSessionProvider(path, {
      map: false, workspace: dir, ctxWindow: 40_000, imageChannel: channel,
      compaction: { summarizer: createMockSummarizer("图片帧已压缩：鹈鹕骑车的结构检查已完成。") },
      emit: async (event) => { emitted.push(event.type); },
      transport: async function* () { yield { type: "assistant_message" as const, content: "ok" }; },
    });
    for await (const _ of provider.stream([])) { /* drain */ }
    expect(emitted).toContain("compaction");
  });
});
