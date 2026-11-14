// 附件缩略图（2026-10-18 desktop 扩展）：把图片附件渲染成 40px 的 data URL，
// 让 composer 的 chip 显示缩略图而不是统一文件图标。只在主进程动文件（nativeImage），
// 渲染层拿不到路径之外的任何东西。约束：仅图片扩展名、≤25MB、解码失败即退回图标（静默）。
import { open } from "node:fs/promises";
import { nativeImage } from "electron";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const MAX_THUMB_BYTES = 25 * 1024 * 1024;

export async function handleAttachmentThumb(
  path: string,
  decodeImage: (buf: Buffer) => { isEmpty(): boolean; resize(opts: { width: number }): { toDataURL(): string } } = (buf) => nativeImage.createFromBuffer(buf),
): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  if (typeof path !== "string" || path === "") return { ok: false, error: "路径为空" };
  if (!IMAGE_EXT.test(path)) return { ok: false, error: "不是图片扩展名" };
  let buf: Buffer;
  try {
    // 同一句柄上量、读、复查：stat 与 read 之间路径被换掉时，「量过的字节」与「读到的字节」
    // 不会分家（CodeQL js/file-system-race；与 mutation-lock / read_doc 同一条修法）。
    const handle = await open(path, "r");
    try {
      const st = await handle.stat();
      if (!st.isFile()) return { ok: false, error: "不是文件" };
      if (st.size > MAX_THUMB_BYTES) return { ok: false, error: "图片过大（>25MB）" };
      const raw = Buffer.allocUnsafe(st.size);
      let offset = 0;
      while (offset < raw.length) {
        const { bytesRead } = await handle.read(raw, offset, raw.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      buf = raw.subarray(0, offset);
      if (buf.byteLength > MAX_THUMB_BYTES) return { ok: false, error: "图片过大（>25MB）" };
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch {
    return { ok: false, error: "读不到文件" };
  }
  const img = decodeImage(buf);
  if (img.isEmpty()) return { ok: false, error: "不是可解码的图片" };
  return { ok: true, dataUrl: img.resize({ width: 40 }).toDataURL() };
}
