// W4b：worker「代码能跑」这句话的机器凭据（事件流纯投影）。
// 合并准入今天不跑任何测试（逐条核过 orchestrator.ts:1840-1858 + worktree.ts:206-244），
// 而回传体里唯一的"结论"就是模型的散文 ⇒ 必须有一个不问模型、只看子流次序的证据位。
import { describe, expect, it } from "vitest";
import { workerVerificationEvidence } from "../src/agent/worker-report";
import type { AgentEvent } from "../src/events";

const call = (id: string, name: string): AgentEvent => ({ type: "tool_call", id, name, args: {} });
const result = (id: string, ok: boolean): AgentEvent => ({ type: "tool_result", callId: id, ok, output: ok ? "written" : "denied" });
const beat = (ok: boolean): AgentEvent => ({ type: "verify_result", callId: "v", ok, attempt: 1, maxAttempts: 3, results: [] });
const write = (id: string): AgentEvent[] => [call(id, "write_file"), result(id, true)];

describe("workerVerificationEvidence 四态", () => {
  it("空流 / 只写不验 ⇒ absent", () => {
    expect(workerVerificationEvidence([])).toBe("absent");
    expect(workerVerificationEvidence([...write("w1")])).toBe("absent");
  });

  it("写完补一拍绿的 ⇒ verified", () => {
    expect(workerVerificationEvidence([...write("w1"), beat(true)])).toBe("verified");
  });

  it("最后拍是红的 ⇒ failed（不粉饰）", () => {
    expect(workerVerificationEvidence([...write("w1"), beat(false)])).toBe("failed");
  });

  it("验过之后又写了盘 ⇒ stale（那份绿证据描述的不是即将合并的代码）", () => {
    expect(workerVerificationEvidence([beat(true), ...write("w1")])).toBe("stale");
    expect(workerVerificationEvidence([...write("w1"), beat(true), ...write("w2")])).toBe("stale");
  });

  it("看最后一次验证拍：红→写→绿的轨迹算 verified", () => {
    expect(workerVerificationEvidence([...write("w1"), beat(false), ...write("w2"), beat(true)])).toBe("verified");
  });

  it("被拒的写（ok:false）不构成过期证据", () => {
    expect(workerVerificationEvidence([beat(true), call("w1", "write_file"), result("w1", false)])).toBe("verified");
  });

  it("edit_file 与 write_file 同权（都改盘）", () => {
    expect(workerVerificationEvidence([beat(true), call("e1", "edit_file"), result("e1", true)])).toBe("stale");
  });

  // 本条原先叫「非写向工具的 tool_result（shell / read）不影响判定」，并断言 `shell_rw` 之后仍是
  // `verified`。那个前提错了，而且权限层自己就是反证：`SIDE_EFFECT_TOOLS` 认 shell_rw 为写向
  // （注释原文「shell_rw 可执行任意非 git 命令，必须计入写向」）——只有 loop 与这里两份两名字清单不认。
  // 后果正是能力 5 最忌的假绿：绿拍之后用 shell 改盘，证据仍标 `verified`，而那份绿描述的不是即将合并的代码。
  // 收窄后的判据（`src/agent/write-face.ts`）：shell 看**命令形状**（复用执行面同一份只读静态过滤），
  // 证不出只读就算写向 ⇒ 下面三种形状各钉一格。
  it("绿拍之后只读工具/只读命令 ⇒ 仍算 verified（不许把每次 ls 都判成过期）", () => {
    expect(workerVerificationEvidence([beat(true), call("r1", "read_file"), result("r1", true)])).toBe("verified");
    expect(
      workerVerificationEvidence([
        beat(true),
        { type: "tool_call", id: "s1", name: "run_shell", args: { command: "ls -la" } },
        result("s1", true),
      ]),
    ).toBe("verified");
  });

  it("绿拍之后 shell 改盘 ⇒ stale（旧断言在这一格给的是假绿）", () => {
    expect(
      workerVerificationEvidence([
        beat(true),
        { type: "tool_call", id: "s1", name: "shell_rw", args: { command: "printf 'x' >> src/app.ts" } },
        result("s1", true),
      ]),
    ).toBe("stale");
  });
});
