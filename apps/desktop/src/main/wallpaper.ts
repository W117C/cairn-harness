// 壁纸媒体服务（2026-11-14 · 设计规格 §3.2）：
//
// 主进程是壁纸路径的**唯一持有者**。渲染层永远拿不到文件系统：媒体经
// `cairn-wallpaper://media/current` 取，白名单 = 设置里当前那一个绝对路径，
// 其余请求 404。这条边界让「壁纸」不变成一条任意读文件的通道。
//
// Range：`<video>` 会发 Range 请求；不支持就会缓冲异常 ⇒ 解析 Range 并回 206。
//
// 测试面：`open` 是注入的流工厂（判卷用假流，不碰真文件）；生产用
// `openWallpaperStream`（真文件 → ReadableStream）。
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { WALLPAPER_SCHEME } from "../../../../src/main/wallpaper-protocol";

export { WALLPAPER_SCHEME };

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov"]);
export const WALLPAPER_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const WALLPAPER_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export type WallpaperMediaKind = "image" | "video";

/** 扩展名 → 媒体类型；不认识的一律 null（不做「按内容猜类型」）。 */
export function wallpaperKindOf(path: string): WallpaperMediaKind | null {
  const ext = extname(path).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

export interface WallpaperPickResult {
  ok: boolean;
  kind?: WallpaperMediaKind;
  path?: string;
  error?: string;
}

/** 文件校验：类型 + 存在 + 大小上限。 */
export async function validateWallpaperFile(path: string): Promise<WallpaperPickResult> {
  const kind = wallpaperKindOf(path);
  if (kind === null) return { ok: false, error: "只支持图片或视频文件" };
  let size: number;
  try {
    const st = await stat(path);
    if (!st.isFile()) return { ok: false, error: "不是文件" };
    size = st.size;
  } catch {
    return { ok: false, error: "读不到文件" };
  }
  const cap = kind === "image" ? WALLPAPER_IMAGE_MAX_BYTES : WALLPAPER_VIDEO_MAX_BYTES;
  if (size > cap) {
    return { ok: false, error: kind === "image" ? "图片过大（上限 25MB）" : "视频过大（上限 2GB）" };
  }
  return { ok: true, kind, path };
}

export interface ByteRange {
  /** 闭区间起点。 */
  start: number;
  /** 闭区间终点。 */
  end: number;
}

/** 解析 `Range: bytes=a-b`；不支持的写法返回 null（调用方按 416 回）。 */
export function parseByteRange(header: string | null, size: number): ByteRange | null {
  if (header === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null) return null;
  const rawStart = m[1] ?? "";
  const rawEnd = m[2] ?? "";
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isInteger(start) || start < 0 || start >= size) return null;
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isInteger(end) || end < start) return null;
  return { start, end };
}

function contentTypeOf(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

/** 协议 handler：只服务 currentPath 那一个文件；其余一律 404。
 *  防御纵深（2026-11-17，Mimosa finding 收口）：settings.json 是用户可手改的文件——手改指向
 *  任意文件时，此前 handler 只 stat 就开流，等于把任意文件经 wallpaper:// 吐给渲染层。
 *  这里用**选文件时同一道闸**（validateWallpaperFile：媒体扩展名 + 常规文件 + 体积上限）重验；
 *  不合闸一律 404（与「壁纸没了」同一措辞，不泄露差异）。正常选取的文件行为不变。 */
export async function handleWallpaperMedia(opts: {
  currentPath: string | null;
  range: string | null;
  open: (path: string, start: number, end: number) => ReadableStream<Uint8Array>;
}): Promise<Response> {
  const path = opts.currentPath;
  if (path === null) return new Response("no wallpaper", { status: 404 });
  const verdict = await validateWallpaperFile(path);
  if (verdict.ok !== true) return new Response("no wallpaper", { status: 404 });
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return new Response("wallpaper gone", { status: 404 });
  }
  const range = parseByteRange(opts.range, size);
  if (opts.range !== null && range === null) return new Response("bad range", { status: 416 });
  const type = contentTypeOf(path);
  if (range === null) {
    return new Response(opts.open(path, 0, size - 1), {
      status: 200,
      headers: {
        "content-type": type,
        "content-length": String(size),
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      },
    });
  }
  return new Response(opts.open(path, range.start, range.end), {
    status: 206,
    headers: {
      "content-type": type,
      "content-length": String(range.end - range.start + 1),
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    },
  });
}

/** 生产用的流工厂（判卷注入假流，不碰真文件）。 */
export function openWallpaperStream(path: string, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
}

/**
 * 必须在 app ready **之前**调用：让这个 scheme 拿到标准/安全 origin 语义
 * （否则渲染层加载它会被当成不透明来源）。
 */
export function registerWallpaperScheme(
  register: (entry: {
    scheme: string;
    privileges: { standard: boolean; secure: boolean; supportFetchAPI: boolean; stream: boolean; bypassCSP: boolean };
  }) => void,
): void {
  register({
    scheme: WALLPAPER_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  });
}
