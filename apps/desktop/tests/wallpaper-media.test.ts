// 壁纸媒体服务判卷（2026-11-14 · 设计规格 §3.2）：
// 扩展名分类、文件校验、Range 解析、协议只服务当前那一个文件。
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  handleWallpaperMedia,
  parseByteRange,
  validateWallpaperFile,
  wallpaperKindOf,
} from "../src/main/wallpaper";

async function tempFile(name: string, bytes: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cairn-wallpaper-"));
  const p = join(dir, name);
  await writeFile(p, Buffer.alloc(bytes, 7));
  return p;
}

describe("壁纸媒体", () => {
  it("扩展名分类：图片/视频/其它", () => {
    expect(wallpaperKindOf("/a/b.png")).toBe("image");
    expect(wallpaperKindOf("/a/b.JPEG")).toBe("image");
    expect(wallpaperKindOf("/a/b.mp4")).toBe("video");
    expect(wallpaperKindOf("/a/b.webm")).toBe("video");
    expect(wallpaperKindOf("/a/b.txt")).toBeNull();
    expect(wallpaperKindOf("/a/b")).toBeNull();
  });

  it("校验：存在的图片通过，缺文件与错扩展名被拒", async () => {
    const p = await tempFile("a.png", 16);
    const ok = await validateWallpaperFile(p);
    expect(ok.ok).toBe(true);
    expect(ok.kind).toBe("image");
    expect(ok.path).toBe(p);
    const gone = await validateWallpaperFile(join(tmpdir(), "cairn-nope-xyz.png"));
    expect(gone.ok).toBe(false);
    expect(gone.error).toBeTruthy();
    const bad = await tempFile("a.txt", 4);
    const rejected = await validateWallpaperFile(bad);
    expect(rejected.ok).toBe(false);
  });

  it("Range 解析：闭区间、开放尾、越界与畸形", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=100-", 1000)).toEqual({ start: 100, end: 999 });
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange("bytes=abc", 1000)).toBeNull();
    expect(parseByteRange("bytes=2000-3000", 1000)).toBeNull();
    expect(parseByteRange("bytes=50-10", 1000)).toBeNull();
  });

  it("协议只服务当前选中的那一个文件", async () => {
    const p = await tempFile("a.mp4", 32);
    const open = (_path: string, start: number, end: number): ReadableStream<Uint8Array> =>
      Readable.toWeb(Readable.from([Buffer.alloc(end - start + 1, 3)])) as ReadableStream<Uint8Array>;
    const none = await handleWallpaperMedia({ currentPath: null, range: null, open });
    expect(none.status).toBe(404);
    const ok = await handleWallpaperMedia({ currentPath: p, range: null, open });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-length")).toBe("32");
    const partial = await handleWallpaperMedia({ currentPath: p, range: "bytes=0-9", open });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 0-9/32");
    const bad = await handleWallpaperMedia({ currentPath: p, range: "bytes=999-", open });
    expect(bad.status).toBe(416);
  });

  it("防御纵深（2026-11-17）：手改 settings 指向非媒体文件 ⇒ 404，不把任意文件经 wallpaper:// 吐给渲染层", async () => {
    const open = (): ReadableStream<Uint8Array> => Readable.toWeb(Readable.from([Buffer.alloc(4, 3)])) as ReadableStream<Uint8Array>;
    // 手改指向的普通文件（如配置/密钥）：过不了选文件那道闸 ⇒ 与「壁纸没了」同一 404 措辞。
    const txt = await tempFile("secret.txt", 16);
    const rejected = await handleWallpaperMedia({ currentPath: txt, range: null, open });
    expect(rejected.status).toBe(404);
    // 指向不存在的路径同理（选完被删也 404）。
    const gone = await handleWallpaperMedia({ currentPath: join(tmpdir(), "cairn-nope-xyz.mp4"), range: null, open });
    expect(gone.status).toBe(404);
  });
});
