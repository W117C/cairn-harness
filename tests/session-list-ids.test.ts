// 只读会话 id 清单（2026-10-21 评审修）：用量/日志通道不应为了知道"有哪些会话"
// 整份读文件数行，也不应把 pins/feedback sidecar 当会话。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isSessionInRoot, listSessionIds } from "../src/main/sessions";

const dir = mkdtempSync(join(tmpdir(), "cairn-session-ids-"));
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe("listSessionIds / isSessionInRoot", () => {
  it("只列真会话：事件文件 + 空会话在；pins/feedback sidecar 与非文件不在", async () => {
    const root = join(dir, "root");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "alpha.jsonl"), JSON.stringify({ type: "user_message", content: "一" }) + "\n");
    writeFileSync(join(root, "empty.jsonl"), "");
    writeFileSync(join(root, "pins.jsonl"), JSON.stringify({ sessionId: "alpha", eventId: 1, pinned: true }) + "\n");
    writeFileSync(join(root, "feedback.jsonl"), JSON.stringify({ sessionId: "alpha", eventId: 1, rating: "up" }) + "\n");
    mkdirSync(join(root, "not-a-session.jsonl"));
    const ids = (await listSessionIds(root)).sort();
    expect(ids).toEqual(["alpha", "empty"]);
    expect(await isSessionInRoot(root, "alpha")).toBe(true);
    expect(await isSessionInRoot(root, "empty")).toBe(true);
    expect(await isSessionInRoot(root, "pins")).toBe(false);
    expect(await isSessionInRoot(root, "missing")).toBe(false);
  });

  it("目录不存在 ⇒ 空清单（不抛，调用方按空工作区处理）", async () => {
    expect(await listSessionIds(join(dir, "nope"))).toEqual([]);
  });
});
