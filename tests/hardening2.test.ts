// H2 加固轮②回归（审查 B-1 + A-2）：git 破坏拦截按「有效二进制」判定 + 等人门可收束。
// 否定式验证锚点：摘除 spawnInternal/runChain 的 aborted 检查或 intercept 的换行归一化后，
// 对应用例必须变红（见提交说明的反向验证记录）。
import { describe, expect, it, vi } from "vitest";
import { interceptDestructiveGit } from "../src/agent/orchestrator";
import { ClarifyGate, PlanGate } from "../src/agent/gates";

describe("interceptDestructiveGit · 有效二进制判定（B-1）", () => {
  // —— 必须仍拦（旧口径已覆盖的回归基线）——
  it("字面 git 写向子命令全拦", () => {
    expect(interceptDestructiveGit("git push").ok).toBe(false);
    expect(interceptDestructiveGit("git merge main").ok).toBe(false);
    expect(interceptDestructiveGit("cat a && git rebase main").ok).toBe(false);
  });
  // —— 旧口径漏网，本批补拦 ——
  it("绝对路径 git 拦截（/usr/bin/git push）", () => {
    expect(interceptDestructiveGit("/usr/bin/git push --force").ok).toBe(false);
  });
  it("exec 包装 git 拦截（command / env / nohup）", () => {
    expect(interceptDestructiveGit("command git push").ok).toBe(false);
    expect(interceptDestructiveGit("env git reset --hard").ok).toBe(false);
    expect(interceptDestructiveGit("nohup git push origin main").ok).toBe(false);
  });
  it("换行分隔拦截（旧实现切段不认 \\n，整段首词是 echo 而漏放）", () => {
    expect(interceptDestructiveGit("echo hi\ngit push --force").ok).toBe(false);
  });
  it("shell -c 内嵌 git 拦截（引号内静态解析不可靠 → 整段 fail-closed）", () => {
    expect(interceptDestructiveGit(`bash -c 'git push --force'`).ok).toBe(false);
    expect(interceptDestructiveGit(`sh -c "git reset --hard HEAD~1"`).ok).toBe(false);
  });
  // —— 只读面不受影响 ——
  it("只读 git 与非 git 命令放行（含绝对路径 / 包装后的只读）", () => {
    expect(interceptDestructiveGit("git status").ok).toBe(true);
    expect(interceptDestructiveGit("/usr/bin/git log --oneline").ok).toBe(true);
    expect(interceptDestructiveGit("command git diff HEAD").ok).toBe(true);
    expect(interceptDestructiveGit("env git show HEAD").ok).toBe(true);
    expect(interceptDestructiveGit("echo hi\ngit status").ok).toBe(true);
    expect(interceptDestructiveGit("ls -la && cat README.md").ok).toBe(true);
    expect(interceptDestructiveGit(`bash -c 'echo no git here'`).ok).toBe(true);
  });
});

describe("等人门可收束（A-2）", () => {
  it("ClarifyGate：会话中止 → wait 立即拒绝（旧实现永久悬挂）", async () => {
    const gate = new ClarifyGate();
    const ac = new AbortController();
    const p = gate.wait("c1", { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow(/中止|取消/);
    expect(gate.pendingCount).toBe(0); // pending 已清，不泄漏
  });

  it("ClarifyGate：超时 → 拒绝；正常提交路径不受影响", async () => {
    const gate = new ClarifyGate();
    await expect(gate.wait("c2", { timeoutMs: 20 })).rejects.toThrow(/超时/);
    expect(gate.pendingCount).toBe(0);

    const gate2 = new ClarifyGate();
    const p = gate2.wait("c3");
    expect(gate2.submit("c3", { "问题": "答案" })).toBe(true);
    await expect(p).resolves.toEqual({ "问题": "答案" });
  });

  it("PlanGate：abort / 超时拒绝，approve 路径照常", async () => {
    const gate = new PlanGate();
    const ac = new AbortController();
    const p1 = gate.waitApproval("p1", { signal: ac.signal });
    ac.abort();
    await expect(p1).rejects.toThrow(/中止|取消/);

    const gate2 = new PlanGate();
    const p2 = gate2.waitApproval("p2", { timeoutMs: 20 });
    await expect(p2).rejects.toThrow(/超时/);

    const gate3 = new PlanGate();
    const p3 = gate3.waitApproval("p3");
    expect(gate3.approve("p3")).toBe(true);
    await expect(p3).resolves.toBe("approved");
  });

  it("已 abort 的 signal 传入时立即拒绝（addEventListener 不追认已 abort）", async () => {
    const gate = new ClarifyGate();
    const ac = new AbortController();
    ac.abort();
    await expect(gate.wait("c4", { signal: ac.signal })).rejects.toThrow();
    expect(gate.pendingCount).toBe(0);
  });

  it("无人值守形态：timeout 收束后 submit 返回 false（无人等待，不误挂）", async () => {
    const gate = new ClarifyGate();
    vi.useFakeTimers();
    try {
      const p = gate.wait("u1", { timeoutMs: 1000 });
      const assertion = expect(p).rejects.toThrow(/超时/);
      vi.advanceTimersByTime(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
    expect(gate.submit("u1", {})).toBe(false);
  });
});
