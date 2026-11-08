// 跨会话用量账本的 host 端到端判卷（2026-10-21 批 131）：
// 扫全部已登记工作区、排除 UI sidecar（pins/feedback 与事件同用 .jsonl）、坏行如实计数、
// 文件长大后再问一次会重读（不是拿缓存冒充新数）。
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createKernelHost } from "../src/main/kernel-host";

const dir = mkdtempSync(join(tmpdir(), "cairn-usage-host-"));
const ws = join(dir, "ws");
const userData = join(dir, "userData");
const sessions = join(ws, ".agent", "sessions");
mkdirSync(sessions, { recursive: true });
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));

afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const line = (row: unknown): string => JSON.stringify(row) + "\n";
const host = createKernelHost({
  workspaces: [ws],
  activeWorkspace: ws,
  userDataDir: userData,
  outbox: () => undefined,
});

const alpha = join(sessions, "alpha.jsonl");
writeFileSync(alpha, [
  line({ type: "session_meta", session_id: "alpha" }),
  line({ type: "user_message", content: "一" }),
  line({ type: "tool_call", id: "t1", name: "read_file", args: {} }),
  line({ type: "usage", inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 5 }),
].join(""));
const beta = join(sessions, "beta.jsonl");
writeFileSync(beta, [
  line({ type: "session_meta", session_id: "beta" }),
  line({ type: "user_message", content: "二" }),
  line({ type: "user_message", content: "子任务", agent_id: "w1" }),
  line({ type: "tool_call", id: "t2", name: "write_file", args: {}, agent_id: "w1" }),
  line({ type: "usage", inputTokens: 50, outputTokens: 5, agent_id: "w1" }),
  '{"type":"usage",oops\n',
].join(""));
// sidecar：首行没有 type、有 sessionId/eventId ⇒ 不是会话，不许进账。
writeFileSync(join(sessions, "pins.jsonl"), line({ sessionId: "alpha", eventId: 2, pinned: true }));

describe("host.usageLedger", () => {
  it("跨会话汇总 + 排除 sidecar + 坏行计数", async () => {
    const r = await host.usageLedger();
    if (!r.ok) throw new Error(r.error);
    expect(r.sessions).toBe(2);
    expect(r.workspaces).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.badLines).toBe(1);
    expect(r.totals).toEqual({
      inputTokens: 150,
      outputTokens: 15,
      cacheReadTokens: 5,
      usageCount: 2,
      toolSteps: 1, // 主会话一条；worker 的 write_file 不计
      rounds: 2,     // 两条主会话 user_message；worker 的任务描述不计
    });
  });

  it("文件增长后再问一次：是重读后的新数（缓存按 size/mtime 失效）", async () => {
    appendFileSync(alpha, line({ type: "usage", inputTokens: 25, outputTokens: 3 }));
    const r = await host.usageLedger();
    if (!r.ok) throw new Error(r.error);
    expect(r.totals.inputTokens).toBe(175);
    expect(r.totals.usageCount).toBe(3);
    expect(r.sessions).toBe(2);
  });
});

describe("usageLedger 不依赖 metadata sidecar（2026-10-21 评审修）", () => {
  it("metadata 损坏也照样出账（账本只需要 id 清单 + 日志）", async () => {
    writeFileSync(join(sessions, "session-metadata.json"), "{ broken");
    const r = await host.usageLedger();
    if (!r.ok) throw new Error(r.error);
    expect(r.sessions).toBe(2);
    expect(r.totals.usageCount).toBeGreaterThan(0);
  });
});
