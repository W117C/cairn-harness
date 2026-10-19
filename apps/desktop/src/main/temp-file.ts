// v11 主界面批：⌘V 粘贴素材落临时文件（截图等）——此后走既有附件引用链（主进程复核）。
// 无顶层 electron import（判卷面跑 node）：electron 只在真落盘那一步动态取。
// 字节帽 20MB；文件名消毒（剥路径分隔符/控制字符，防穿越）。
export const MAX_TEMP_BYTES = 20 * 1024 * 1024;

/** 文件名消毒（纯函数，判卷面）：剥路径分隔符/控制字符、限 80 字符；空/全点 = "paste.bin"。 */
export function sanitizePasteName(raw: string): string {
  const cleaned = raw.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, "_").trim().slice(0, 80);
  if (cleaned === "" || /^_+$/.test(cleaned) || /^\.+$/.test(cleaned)) return "paste.bin";
  return cleaned;
}

/** 落盘到 <temp>/cairn-paste/<毫秒>-<消毒名>。校验先于 electron 动态导入（判卷可测失败面）。 */
export async function saveTempFile(name: string, bytes: unknown): Promise<{ ok: boolean; path?: string; error?: string }> {
  let buf: Buffer;
  if (bytes instanceof Uint8Array) {
    buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } else if (bytes instanceof ArrayBuffer) {
    buf = Buffer.from(bytes);
  } else {
    return { ok: false, error: "粘贴内容不是字节数据" };
  }
  if (buf.byteLength === 0) return { ok: false, error: "粘贴内容为空" };
  if (buf.byteLength > MAX_TEMP_BYTES) return { ok: false, error: "超过 20MB 上限" };

  const { app } = await import("electron");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const dir = join(app.getPath("temp"), "cairn-paste");
  // 毫秒 + 随机段：多文件并行粘贴同毫秒时旧命名会互相覆盖（两个附件指向同一路径）。
  const file = join(dir, `${String(Date.now())}-${randomUUID().slice(0, 8)}-${sanitizePasteName(name)}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, buf);
    return { ok: true, path: file };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 退出时回收粘贴临时目录（文件只在本次会话内被引用；上次崩溃留下的也一并清）。 */
export async function cleanupPasteTempFiles(): Promise<void> {
  try {
    const { app } = await import("electron");
    const { rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await rm(join(app.getPath("temp"), "cairn-paste"), { recursive: true, force: true });
  } catch {
    /* 临时目录清理失败不阻塞退出 */
  }
}
