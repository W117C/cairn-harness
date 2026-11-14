import { open } from "node:fs/promises";

/** 一次 open 上的「量 + 读」：路径在 stat 与 read 之间被换掉时，量过的字节与读到的字节不会分家。
 *
 *  为什么需要它：多处调用点是 `stat(path)` 之后 `readFile(path)`——中间被换文件时，帽按 A 执行、
 *  却读了 B（CodeQL js/file-system-race）。这里的判据是**同一句柄**：先 fstat，再按 fstat 的
 *  size 定长读；文件变短读到多少算多少，变长也绝不多读一个字节。
 */
export type BoundedRead =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "missing" | "not-file" | "read-error" }
  | { ok: false; reason: "too-large"; size: number };

export async function readFileBounded(path: string, maxBytes: number): Promise<BoundedRead> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (err) {
    return { ok: false, reason: (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "read-error" };
  }
  try {
    const st = await handle.stat();
    if (!st.isFile()) return { ok: false, reason: "not-file" };
    if (st.size > maxBytes) return { ok: false, reason: "too-large", size: st.size };
    const buf = Buffer.allocUnsafe(st.size);
    let offset = 0;
    while (offset < buf.length) {
      const { bytesRead } = await handle.read(buf, offset, buf.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return { ok: true, bytes: buf.subarray(0, offset) };
  } catch {
    return { ok: false, reason: "read-error" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}
