/** 图片内容块的 token 计价：**base64 的字符数不是 token 数**。
 *
 *  2026-11-03 实测（会话 `会话 2026-11-03 12:32:49 #4`，第 13 步）：
 *  `[context_budget_exceeded] final estimated input 185657; available 183808` 把一轮请求挡在门外。
 *  逐项对账：文本投影 62,884 字符 + 组装开销 22,801 字符 = 85,685；硬闸算出的 371,314 字符
 *  （`185657 × 校准因子 2`）减去它就是 285,629 —— 而那一轮待发的两张 `render_image` 帧
 *  （107,273 + 106,656 字节）base64 后正好 285,240 字符。77% 的「上下文」是两张图的 base64，
 *  被当成正文按 chars/2 折成了 142,620 token。
 *
 *  真值在另一处：同一形态的上一请求（同样两张 ~106KB 图）provider 实报 inputTokens 15,939，
 *  模型思考里也明写了 "The screenshots show…" —— 图确实到了，也确实只值两千上下。
 *
 *  ⇒ 图片按**像素**计价，文本才走 chars/factor；两个估算口（触发侧 `estimateContextTokens`
 *  的加项、最终硬闸）共用本模块，否则又是两把尺。
 *
 *  为什么不是「按字节数打折」：PNG 的字节数由画面复杂度决定（同一张 900×1200 的空白页
 *  与噪点页能差 20 倍），而视觉编码器的开销只认像素网格。拿字节当代理只是把倍数改小，
 *  仍然是错的尺。
 */

import type { ProviderMessage } from "../providers";

/** 视觉 token 的折算比：tokens ≈ 宽 × 高 / 750。
 *
 *  取 750 而不是各家的精确公式（OpenAI 的 85 + 170×瓦片、Gemini 的 258/瓦片）：
 *  本仓的估算是**上界口径**（宁可多留余量，不要发出去再 400），750 这一档在
 *  常见视觉编码器里落在偏保守的一侧，且不依赖具体 adapter。 */
export const IMAGE_TOKEN_DIVISOR = 750;

/** 尺寸读不出来时的兜底（一张常见截图量级）。读不出就**不许当 0** ——
 *  「没有成本」会让硬闸对图片彻底失明，正是本次要修的那个形状。 */
export const IMAGE_TOKENS_FALLBACK = 1_600;

/** 只解头部这么多 base64 字符（≈ 6KB 原始字节）——够走完 PNG/GIF/WebP 头，
 *  JPEG 也够跳过常见的 EXIF/ICC 段。解不出尺寸就回退 `IMAGE_TOKENS_FALLBACK`。 */
const HEADER_B64_CHARS = 8_192;

export interface PixelSize {
  width: number;
  height: number;
}

/** 从 data URL 读像素尺寸（PNG / JPEG / GIF / WebP）；非 data URL 或读不出 ⇒ null。 */
export function imagePixelSize(dataUrl: string): PixelSize | null {
  if (typeof dataUrl !== "string") return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  if (!dataUrl.slice(0, comma).endsWith(";base64")) return null;
  let head: Buffer;
  try {
    head = Buffer.from(dataUrl.slice(comma + 1, comma + 1 + HEADER_B64_CHARS), "base64");
  } catch {
    return null;
  }
  return pngSize(head) ?? gifSize(head) ?? jpegSize(head) ?? webpSize(head);
}

/** 一张图片块的 token 估算：认得尺寸就按像素折算，认不出回退固定值。 */
export function estimateImageTokens(dataUrl: string): number {
  const size = imagePixelSize(dataUrl);
  if (size === null) return IMAGE_TOKENS_FALLBACK;
  return Math.max(1, Math.ceil((size.width * size.height) / IMAGE_TOKEN_DIVISOR));
}

/** 一组待发图片的总 token。`take` 之前就要知道这一轮带多重（触发侧与硬闸侧共用）。 */
export function sumImageTokens(images: readonly { dataUrl: string }[]): number {
  let total = 0;
  for (const image of images) total += estimateImageTokens(image.dataUrl);
  return total;
}

/** 消息序列里图片块的总 token（最终硬闸用：那里握的是装配好的 `msgs`）。 */
export function imageTokensOfMessages(messages: readonly ProviderMessage[]): number {
  let total = 0;
  for (const message of messages) {
    for (const part of message.contentParts ?? []) total += estimateImageTokens(part.dataUrl);
  }
  return total;
}

/** 消息序列里的图片张数（只用于错误文案：让「是多少张图撑的」在报错里一眼可读）。 */
export function imageCountOfMessages(messages: readonly ProviderMessage[]): number {
  let count = 0;
  for (const message of messages) count += message.contentParts?.length ?? 0;
  return count;
}

/** 把图片载荷换成空串的副本：字符口径只量文本，图片另行按 token 计。
 *
 *  换空串而不是删掉 `contentParts`：结构留在 JSON 里（几十个字符），
 *  好让「硬闸量的东西」与「真正发出去的东西」形状一致，不会因为少一层括号对不上。
 *  原数组不动——`msgs` 随后还要原样发给 transport。 */
export function withoutImagePayloads(messages: readonly ProviderMessage[]): ProviderMessage[] {
  return messages.map((message) => {
    if (message.contentParts === undefined || message.contentParts.length === 0) return message;
    return { ...message, contentParts: message.contentParts.map((part) => ({ ...part, dataUrl: "" })) };
  });
}

// ---- 头部解析（只读 magic + 尺寸字段，不做任何解码）----

function pngSize(buf: Buffer): PixelSize | null {
  if (buf.length < 24) return null;
  // 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function gifSize(buf: Buffer): PixelSize | null {
  if (buf.length < 10) return null;
  const magic = buf.toString("ascii", 0, 6);
  if (magic !== "GIF87a" && magic !== "GIF89a") return null;
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegSize(buf: Buffer): PixelSize | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 <= buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1]!;
    // 填充字节与无长度的标记
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = buf.readUInt16BE(i + 2);
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > buf.length) return null;
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}

function webpSize(buf: Buffer): PixelSize | null {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const b = buf.subarray(21, 25);
    const width = 1 + (((b[1]! & 0x3f) << 8) | b[0]!);
    const height = 1 + (((b[3]! & 0x0f) << 10) | (b[2]! << 2) | ((b[1]! & 0xc0) >> 6));
    return { width, height };
  }
  if (chunk === "VP8X") {
    const width = 1 + buf.readUIntLE(24, 3);
    const height = 1 + buf.readUIntLE(27, 3);
    return { width, height };
  }
  return null;
}
