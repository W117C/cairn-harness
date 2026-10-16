// 识图通道的判卷：三个适配器的 wire 形状 + read_image 工具的三道闸（界内/字节帽/magic number）
// + 图片不进事件日志（事件流是重放契约，base64 进去会让会话文件大一个量级）。
//
// 为什么值得锁：识图此前的失败模式是**静默的**——模型在回执里看到「已附上」，请求体里却没有图，
// 于是它照着不存在的东西继续推理。这类失败只有把 wire 形状钉住才看得见。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES, read_image, sniffImageMime } from "../src/tools/read_image";
import { toAnthropicBody } from "../src/providers/anthropic";
import { toGeminiBody } from "../src/providers/gemini";
import { toOpenAiWireMessages } from "../src/providers/openai";
import type { ProviderMessage } from "../src/providers";
import { createImageChannel } from "../src/agent/image-channel";

// 一张 1×1 的 PNG（最小的合法 PNG：magic number 完整，字节数够过空文件闸）。
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_DATA_URL = "data:image/png;base64," + PNG_1X1.toString("base64");

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "read-image-"));
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});
const ctx = (): { workspace: string } => ({ workspace: ws });

describe("sniffImageMime：判据是 magic number，不是后缀名", () => {
  it("四种认得的格式各判对各的 MIME", () => {
    expect(sniffImageMime(PNG_1X1)).toBe("image/png");
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]))).toBe("image/jpeg");
    expect(sniffImageMime(Buffer.from("GIF89a....", "latin1"))).toBe("image/gif");
    // RIFF....WEBP：第 8-12 字节必须是 WEBP，总长 12 才够判
    const webp = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP", "latin1")]);
    expect(webp.length).toBe(12);
    expect(sniffImageMime(webp)).toBe("image/webp");
  });
  it("非图片（含 .png 后缀的任意字节）一律判不出", () => {
    expect(sniffImageMime(Buffer.from("PNG but actually text", "utf8"))).toBeNull();
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull(); // 截断的 PNG
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });
});

describe("read_image：三道闸", () => {
  it("界内图片读出 data URL，回执说清是哪一个文件", async () => {
    writeFileSync(join(ws, "a.png"), PNG_1X1);
    const r = await read_image.run({ path: "a.png" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.images).toHaveLength(1);
    expect(r.images?.[0]?.dataUrl).toBe(PNG_DATA_URL);
    expect(r.output).toContain("a.png");
    expect(r.output).toContain("image/png");
  });

  it("越界路径（绝对路径 / ..）被 resolveInWorkspace 拒", async () => {
    await expect(read_image.run({ path: "/etc/hosts" }, ctx())).rejects.toThrow(/workspace/);
    await expect(read_image.run({ path: "../outside.png" }, ctx())).rejects.toThrow();
  });

  it("超字节帽拒读并给出实际大小（不许静默截断——截断出来的图是坏的）", async () => {
    writeFileSync(join(ws, "big.png"), Buffer.concat([PNG_1X1, Buffer.alloc(MAX_IMAGE_BYTES)]));
    await expect(read_image.run({ path: "big.png" }, ctx())).rejects.toThrow(/MB/);
  });

  it("非图片拒读并指向 read_file（后缀名不作为判据）", async () => {
    writeFileSync(join(ws, "fake.png"), "just text, not a png");
    await expect(read_image.run({ path: "fake.png" }, ctx())).rejects.toThrow(/read_file/);
  });

  it("空文件拒读", async () => {
    writeFileSync(join(ws, "empty.png"), Buffer.alloc(0));
    await expect(read_image.run({ path: "empty.png" }, ctx())).rejects.toThrow();
  });
});

describe("三个适配器的 wire 形状", () => {
  const textOnly: ProviderMessage = { role: "user", content: "hi" };
  const withImage: ProviderMessage = { role: "user", content: "看这张", contentParts: [{ type: "image", dataUrl: PNG_DATA_URL }] };
  const imageOnly: ProviderMessage = { role: "user", content: null, contentParts: [{ type: "image", dataUrl: PNG_DATA_URL }] };

  it("OpenAI：纯文本逐字保持 content 字符串（不换 parts 形状，前缀缓存与网关兼容性都不动）", () => {
    expect(toOpenAiWireMessages([textOnly])).toEqual([{ role: "user", content: "hi" }]);
  });
  it("OpenAI：带图换成 text + image_url 两块，顺序文本在前", () => {
    expect(toOpenAiWireMessages([withImage])).toEqual([
      { role: "user", content: [{ type: "text", text: "看这张" }, { type: "image_url", image_url: { url: PNG_DATA_URL } }] },
    ]);
  });
  it("OpenAI：无文本时只发 image_url（不塞空 text 块）", () => {
    expect(toOpenAiWireMessages([imageOnly])).toEqual([
      { role: "user", content: [{ type: "image_url", image_url: { url: PNG_DATA_URL } }] },
    ]);
  });

  it("Anthropic：带图换成 text + image（base64 source 拆出 media_type 与 data）", () => {
    const body = toAnthropicBody([withImage], { model: "m", maxTokens: 100, stream: false });
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "看这张" }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1.toString("base64") } }] },
    ]);
  });
  it("Anthropic：纯文本逐字保持字符串", () => {
    const body = toAnthropicBody([textOnly], { model: "m", maxTokens: 100, stream: false });
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });
  it("Anthropic：非 data URL 不猜——换成一句说明，不发空 image 块", () => {
    const body = toAnthropicBody([{ role: "user", content: null, contentParts: [{ type: "image", dataUrl: "https://example.com/a.png" }] }], { model: "m", maxTokens: 100, stream: false });
    const blocks = (body.messages as { content: { type: string }[] }[])[0]!.content;
    expect(blocks.every((b) => b.type === "text")).toBe(true);
    expect(JSON.stringify(blocks)).toContain("data URL");
  });

  it("Gemini：带图换成 text + inlineData（mimeType + data）", () => {
    const body = toGeminiBody([withImage]);
    const parts = (body.contents as { role: string; parts: Record<string, unknown>[] }[])[0]!.parts;
    expect(parts).toEqual([
      { text: "看这张" },
      { inlineData: { mimeType: "image/png", data: PNG_1X1.toString("base64") } },
    ]);
  });
  it("Gemini：纯文本逐字保持单个 text part", () => {
    const body = toGeminiBody([textOnly]);
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });
});

describe("image-channel：只活一次", () => {
  it("push → take 取空（同一张图不重复付 token）", () => {
    const ch = createImageChannel();
    ch.push([{ type: "image", dataUrl: PNG_DATA_URL }]);
    expect(ch.size()).toBe(1);
    expect(ch.take()).toHaveLength(1);
    expect(ch.take()).toHaveLength(0);
    expect(ch.size()).toBe(0);
  });
  it("push 复制内容：调用方后续改写不影响已入盒的图", () => {
    const ch = createImageChannel();
    const arr = [{ type: "image" as const, dataUrl: PNG_DATA_URL }];
    ch.push(arr);
    arr[0]!.dataUrl = "data:image/png;base64,MUTATED";
    expect(ch.take()[0]!.dataUrl).toBe(PNG_DATA_URL);
  });
  it("空 take 不产出块（不读图的会话消息序列逐字不变）", () => {
    expect(createImageChannel().take()).toEqual([]);
  });
});
