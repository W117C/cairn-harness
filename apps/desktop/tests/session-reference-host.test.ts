// KernelHost 的来源身份接线（计划 Task 4 红面）。
//   ① openSession 回传 SessionRef + SessionView（本地 raw 仍在 events）；
//   ② 两个登记根同名会话：无 workspace 一律拒绝歧义，显式 workspace 各读各的；
//   ③ 队列 / 分叉 / 注释的显式根只落目标根，另一个根一个字节不变；
//   ④ 并发打开两个根的同名会话，各自拿到自己的正文（晚到应答不改别的根）。
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createKernelHost } from "../src/main/kernel-host";
import { handleSessionFork, handleFeedbackSubmit } from "../../../src/main/session-handlers";

function sessionBody(marker: string): string {
  return JSON.stringify({ type: "user_message", content: marker }) + "\n";
}

function setup(): {
  host: ReturnType<typeof createKernelHost>;
  A: string; B: string; rootA: string; rootB: string; userData: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "cairn-ref-host-"));
  const userData = join(dir, "userData");
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));
  for (const name of ["A", "B"]) mkdirSync(join(dir, name), { recursive: true });
  const A = realpathSync(join(dir, "A"));
  const B = realpathSync(join(dir, "B"));
  const rootA = join(A, ".agent", "sessions");
  const rootB = join(B, ".agent", "sessions");
  for (const [root, marker] of [[rootA, "A_BODY"], [rootB, "B_BODY"]] as const) {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "same.jsonl"), sessionBody(marker));
  }
  const host = createKernelHost({ workspaces: [A, B], activeWorkspace: A, userDataDir: userData, outbox: () => undefined });
  return { host, A, B, rootA, rootB, userData };
}

const bodyOf = (events: readonly { type: string; content?: string }[]): string =>
  events.filter((e) => e.type === "user_message").map((e) => e.content ?? "").join("\n");

describe("KernelHost 的来源身份", () => {
  it("openSession 回传 SessionRef + SessionView；显式 workspace 各读各的", async () => {
    const { host, A, B } = setup();
    const a = await host.openSession("same", A);
    const b = await host.openSession("same", B);
    expect(a.session).toEqual({ workspace: A, sessionId: "same" });
    expect(b.session).toEqual({ workspace: B, sessionId: "same" });
    expect(bodyOf(a.events)).toBe("A_BODY");
    expect(bodyOf(b.events)).toBe("B_BODY");
    expect(a.view.localEvents.map((e) => e.type)).toEqual(["user_message"]);
    expect(a.view.entries.map((e) => e.ref)).toEqual([{ workspace: A, sessionId: "same", eventId: 1 }]);
  });

  it("无 workspace 且两个根同名 ⇒ 拒绝，不扫到第一个就用", async () => {
    const { host } = setup();
    await expect(host.openSession("same")).rejects.toThrow(/多个工作区/);
    await expect(host.queueGet("same")).rejects.toThrow(/多个工作区/);
  });

  it("并发打开两个根：各自拿到自己的正文", async () => {
    const { host, A, B } = setup();
    const [a, b] = await Promise.all([host.openSession("same", A), host.openSession("same", B)]);
    expect(bodyOf(a.events)).toBe("A_BODY");
    expect(bodyOf(b.events)).toBe("B_BODY");
  });

  it("队列与分叉的显式根只落目标根", async () => {
    const { host, B, rootA, rootB } = setup();
    expect(await host.queueSet("same", [{ text: "q", attachments: [] }], B)).toEqual({ ok: true });
    expect((await host.queueGet("same", B)).items).toHaveLength(1);
    expect(existsSync(join(rootA, "same.queue.json"))).toBe(false);

    const forked = await handleSessionFork("same", 1, false, rootB);
    expect(forked.ok).toBe(true);
    expect(existsSync(join(rootB, "same-f1.jsonl"))).toBe(true);
    expect(existsSync(join(rootA, "same-f1.jsonl"))).toBe(false);
  });

  it("注释的显式根：目标根能写；无归属时歧义拒绝", async () => {
    const { rootB } = setup();
    expect(await handleFeedbackSubmit({ sessionId: "same", eventId: 1, rating: "up" }, rootB)).toEqual({ ok: true });
    const ambiguous = await handleFeedbackSubmit({ sessionId: "same", eventId: 1, rating: "up" });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.error).toMatch(/多个工作区/);
  });
});
