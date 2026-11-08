// 取消窗口：runInSandbox 先检查 abort，再 await mkdir(<cwd>/.tmp)，之后才挂 abort 监听。
// 若取消落在 mkdir 期间，旧实现错过监听 ⇒ 仍然 spawn，命令跑到超时才收。这里把 mkdir 变成
// 可控的等待点，取消必须让这一轮**根本不 spawn**。
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ onMkdir: null as null | (() => void) }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      const hook = hooks.onMkdir;
      hooks.onMkdir = null;
      hook?.();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return actual.mkdir(...args);
    },
  };
});

import { runInSandbox } from "../src/main/sandbox";

describe("沙箱取消（spawn 前）", () => {
  it("mkdir 期间取消 ⇒ 不启动命令，直接以取消收束", async () => {
    const ac = new AbortController();
    hooks.onMkdir = () => ac.abort();
    const started = Date.now();
    const r = await runInSandbox("sleep 30", {
      cwd: tmpdir(),
      signal: ac.signal,
      timeoutMs: 1_500,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("取消");
    expect(r.timedOut).toBe(false);
  });
});
