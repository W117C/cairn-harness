// 进程内串行的**入链顺序**（2026-10-22 实测存活）：链键要等 `realpath`，两次 `realpath` 的回程
// 顺序不受调用顺序保证。旧实现「先 await realpath 再读 chains」在回程颠倒时让**后来的调用先入链**，
// 于是第二个 mutation 抢在第一个之前跑完——串行只在对的文件系统时序下成立。
// 这条判卷把「回程快慢」变成可控输入：同一目录的两个写法，让第一次调用的 realpath 慢 30ms 回来。
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: async (p: Parameters<typeof actual.realpath>[0]) => {
      if (String(p).endsWith("slow-link")) await new Promise((resolve) => setTimeout(resolve, 30));
      return actual.realpath(p);
    },
  };
});

describe("withSessionMutation：入链按调用顺序，与 realpath 回程快慢无关", () => {
  it("第一次调用的 realpath 慢 30ms ⇒ 第二个 mutation 仍排在它后面（旧实现会抢跑）", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "cairn-mutation-order-")));
    try {
      const root = join(dir, "sessions");
      await mkdir(root, { recursive: true });
      const slowLink = join(dir, "slow-link");
      await symlink(root, slowLink); // 同一目录的另一种写法：realpath 要绕一次符号链接
      // 先确认两种写法确实指向同一个根（否则这条判卷量的就不是「同一个链」）。
      expect(await realpath(slowLink)).toBe(root);

      const { withSessionMutation } = await import("../src/main/session-repository");
      const order: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
      let markStarted!: () => void;
      const started = new Promise<void>((resolveGate) => { markStarted = resolveGate; });
      const first = withSessionMutation(slowLink, async () => {
        order.push("first-start");
        markStarted();
        await gate;
        order.push("first-end");
      });
      const second = withSessionMutation(root, async () => { order.push("second"); });

      await started; // 第一段真的开跑
      // 旧实现此刻 order 已经是 ["second","first-start"]：回程颠倒 ⇒ 第二个先入链。
      expect(order).toEqual(["first-start"]);
      release();
      await Promise.all([first, second]);
      expect(order).toEqual(["first-start", "first-end", "second"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
