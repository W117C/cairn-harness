// 会话日志尾部判卷（2026-10-21 批 132）：有界读取、按行裁、从中间切开的那行丢掉。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readSessionLogTail, SESSION_LOG_MAX_BYTES } from "../src/main/session-log";

const dir = mkdtempSync(join(tmpdir(), "cairn-session-log-"));
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe("readSessionLogTail", () => {
  it("整份小于上限：默认取最后 400 行，不标截断", async () => {
    const file = join(dir, "small.jsonl");
    const body = ["{\"n\":1}", "{\"n\":2}", "{\"n\":3}"].join("\n") + "\n";
    writeFileSync(file, body);
    const r = await readSessionLogTail(file);
    expect(r.text).toBe("{\"n\":1}\n{\"n\":2}\n{\"n\":3}");
    expect(r.lines).toBe(3);
    expect(r.truncated).toBe(false);
    expect(r.bytes).toBe(Buffer.byteLength(body));
  });

  it("行数超限：只留尾部并标截断（首行不再出现）", async () => {
    const file = join(dir, "lines.jsonl");
    writeFileSync(file, Array.from({ length: 10 }, (_, i) => `line-${i}`).join("\n") + "\n");
    const r = await readSessionLogTail(file, 3);
    expect(r.text).toBe("line-7\nline-8\nline-9");
    expect(r.lines).toBe(3);
    expect(r.truncated).toBe(true);
  });

  it("字节超限：从窗口中间切开的半行丢掉，UTF-8 不出现替换字符", async () => {
    const file = join(dir, "large.jsonl");
    const rows = Array.from({ length: 4000 }, (_, i) => `会话-${i}-${"x".repeat(80)}`);
    writeFileSync(file, rows.join("\n") + "\n");
    expect(rows.join("\n").length).toBeGreaterThan(SESSION_LOG_MAX_BYTES);
    const r = await readSessionLogTail(file, 400);
    expect(r.truncated).toBe(true);
    expect(r.text).not.toContain("\ufffd");
    expect(r.text.startsWith("会话-")).toBe(true);
    expect(r.lines).toBe(400);
  });

  it("空文件：0 行、空正文，不假装有内容", async () => {
    const file = join(dir, "empty.jsonl");
    writeFileSync(file, "");
    const r = await readSessionLogTail(file);
    expect(r).toMatchObject({ text: "", lines: 0, truncated: false, bytes: 0 });
  });

  it("行数上限被夹到 2000（渲染层传多大都不把整份读进来）", async () => {
    const file = join(dir, "clamp.jsonl");
    writeFileSync(file, Array.from({ length: 2100 }, (_, i) => `r${i}`).join("\n"));
    const r = await readSessionLogTail(file, 99999);
    expect(r.lines).toBe(2000);
    expect(r.text.startsWith("r100\n")).toBe(true);
  });

  it("读不了的文件 reject（由 IPC 面转成 fail-visible，不返回空日志）", async () => {
    await expect(readSessionLogTail(join(dir, "nope.jsonl"))).rejects.toBeTruthy();
  });
});
