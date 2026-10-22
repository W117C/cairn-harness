// 会话日志 host 面判卷（2026-10-21 批 132）：只认真实会话、路径由归属解析、
// sidecar 与不存在 id 都 fail-visible。
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createKernelHost } from "../src/main/kernel-host";

const dir = mkdtempSync(join(tmpdir(), "cairn-log-host-"));
const ws = join(dir, "ws");
const userData = join(dir, "userData");
const sessions = join(ws, ".agent", "sessions");
mkdirSync(sessions, { recursive: true });
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const line = (row: unknown): string => JSON.stringify(row) + "\n";
writeFileSync(join(sessions, "alpha.jsonl"), [
  line({ type: "user_message", content: "一" }),
  line({ type: "assistant_message", content: "回" }),
  line({ type: "error", message: "boom" }),
].join(""));
writeFileSync(join(sessions, "pins.jsonl"), line({ sessionId: "alpha", eventId: 1, pinned: true }));

const host = createKernelHost({
  workspaces: [ws],
  activeWorkspace: ws,
  userDataDir: userData,
  outbox: () => undefined,
});

describe("host.sessionLog", () => {
  it("读尾部并返回真实路径；tailLines 生效", async () => {
    const r = await host.sessionLog("alpha", 2);
    if (!r.ok) throw new Error(r.error);
    expect(r.path).toBe(realpathSync(join(sessions, "alpha.jsonl")));
    expect(r.text).toBe(["{\"type\":\"assistant_message\",\"content\":\"回\"}", "{\"type\":\"error\",\"message\":\"boom\"}"].join("\n"));
    expect(r.lines).toBe(2);
    expect(r.truncated).toBe(true);
  });

  it("sidecar 不是会话：拒绝，不把 pins.jsonl 当日志读", async () => {
    const r = await host.sessionLog("pins", 10);
    expect(r.ok).toBe(false);
  });

  it("不存在的会话：fail-visible", async () => {
    const r = await host.sessionLog("nope", 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("会话不存在");
  });
});
