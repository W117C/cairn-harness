// 附件缩略图（2026-10-18 desktop 扩展）：把图片附件渲染成 40px 的 data URL，
// 让 composer 的 chip 显示缩略图而不是统一文件图标。只在主进程动文件（nativeImage），
// 渲染层拿不到路径之外的任何东西。约束：仅图片扩展名、≤25MB、解码失败即退回图标（静默）。
import { statSync } from "node:fs";
import { nativeImage } from "electron";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

export function handleAttachmentThumb(path: string): { ok: boolean; dataUrl?: string; error?: string } {
  if (typeof path !== "string" || path === "") return { ok: false, error: "路径为空" };
  if (!IMAGE_EXT.test(path)) return { ok: false, error: "不是图片扩展名" };
  try {
    const st = statSync(path);
    if (!st.isFile()) return { ok: false, error: "不是文件" };
    if (st.size > 25 * 1024 * 1024) return { ok: false, error: "图片过大（>25MB）" };
  } catch {
    return { ok: false, error: "读不到文件" };
  }
  const img = nativeImage.createFromPath(path);
  if (img.isEmpty()) return { ok: false, error: "不是可解码的图片" };
  return { ok: true, dataUrl: img.resize({ width: 40 }).toDataURL() };
}
