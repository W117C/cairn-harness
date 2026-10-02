// M2 验收锚的机器证明（task-7）：mock 全链路「审批→执行→打断」headless 判卷。
// 通道：M3A_MAIN_SCRIPT=<绝对路径>（scriptedMainModelPath 第一优先，agent-runner.ts createProvider
// 顶部一行消费）⇒ 主模型按 fixtures/agents/main-approval-demo.jsonl 回放；fixture 里 run_shell
// 是写副作用工具，default 档必经 appAskGate（agent-runner.ts 头注语义：read-only 拒副作用 /
// default 询问 / auto 放行）。args.model 缺席 ⇒ 零 worker spawn（不进 M3A_AGENTS_DEMO 通道）。
// host 装配手法沿 kernel-host.test.ts：mkdtemp 工作区、seed settings provider=demo、outbox 收集、
// env 清场与还原。两用例共用同一份 fixture 路径常量，各用独立工作区（同一个 marker 文件名，互不串扰）。
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createKernelHost, type KernelHost } from "../src/main/kernel-host";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "fixtures", "agents", "main-approval-demo.jsonl");

const root = mkdtempSync(join(tmpdir(), "m0-approval-"));
const wsApprove = join(root, "ws-approve");
const wsCancel = join(root, "ws-cancel");
mkdirSync(wsApprove, { recursive: true });
mkdirSync(wsCancel, { recursive: true });
// seed settings：provider=demo ⇒ 不拨号不花钱（spec §3.2 / agent-runner resolveRunModel）
const userData = join(root, "userData");
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));

// 剧本/通道 env 的外部残留会劫持判卷（M3A_MAIN_SCRIPT 优先级最高；M0A_PROVIDER 强推真 provider
// 会拨号；M0B_WORKSPACE 会把 run 的工作区拽走）——进门前清场，出门后还原。
const ambientKeys = [
  "M3A_MAIN_SCRIPT", "M3A_AGENTS_DEMO", "M1B_GATE_FLOW", "M1C_AUTONOMY_SCRIPT", "M2A_LSP_DEMO",
  "M0A_PROVIDER", "M0_MODEL", "M0B_WORKSPACE",
] as const;
const ambientBackup = ambientKeys.map((k) => [k, process.env[k]] as const);
for (const k of ambientKeys) delete process.env[k];
process.env.M3A_MAIN_SCRIPT = script; // 脚本化主模型第一优先通道；不带 M3A_AGENTS_DEMO（显式只设一个更干净）

const outbox: (readonly [string, unknown])[] = [];
const host: KernelHost = createKernelHost({
  workspace: root, // 会话根 = <root>/.agent/sessions；每场 run 的工作区走 RunRequest.workspace 产品位
  userDataDir: userData,
  outbox: (channel, payload) => {
    outbox.push([channel, payload]);
  },
});

afterAll(async () => {
  delete process.env.M3A_MAIN_SCRIPT;
  for (const [k, v] of ambientBackup) {
    if (v !== undefined) process.env[k] = v;
  }
});

/** 等 outbox 里出现 run_shell 的审批卡并取回 payload（AskPayload: { askId, tool, args, … }）。 */
async function awaitRunShellAsk(): Promise<{ askId: string; tool: string }> {
  await vi.waitFor(() =>
    expect(outbox.some(([c, p]) => c === "onAsk" && (p as { tool?: string }).tool === "run_shell")).toBe(true),
  );
  const entry = outbox.find(([c]) => c === "onAsk")!;
  return entry[1] as { askId: string; tool: string };
}

/** 悬挂 promise 防护：runP 必须在 ms 内收束（settle），否则判红并给可读信息。 */
function settleWithin<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(what + " 未在 " + ms + "ms 内收束（悬挂 promise 防护）")), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}

describe("审批→执行→打断 全链路（M3A_MAIN_SCRIPT 剧本 + default 档 appAskGate）", () => {
  it(
    "审批→执行：ask 到达 → decide(approved) → run ok 且 marker 落工作区",
    async () => {
      outbox.length = 0;
      const created = await host.createSession();
      const runP = host.run({ message: "建标记", mode: "default", sessionId: created.id, workspace: wsApprove });
      const ask = await awaitRunShellAsk();
      expect(ask.tool).toBe("run_shell");
      expect(host.decide(ask.askId, true)).toBe(true);
      const res = await settleWithin(runP, 20_000, "approve 场 run");
      expect(res.ok, JSON.stringify(res)).toBe(true);
      expect(existsSync(join(wsApprove, "approval-marker.tmp"))).toBe(true);
      // 全链路留痕：审批卡有始有终（批准决议 reason=user，AskOutcomePayload）
      const done = outbox.find(([c]) => c === "onAskDone")?.[1] as
        | { askId: string; outcome: string; reason: string }
        | undefined;
      expect(done?.askId).toBe(ask.askId);
      expect(done?.outcome).toBe("approved");
      expect(done?.reason).toBe("user");
    },
    30_000,
  );

  it(
    "打断：ask 等待期 runCancel → run 收束（无 marker；onAskDone reason ∈ user|timeout|unattended）",
    async () => {
      outbox.length = 0;
      const created = await host.createSession();
      const runP = host.run({ message: "建标记（随即打断）", mode: "default", sessionId: created.id, workspace: wsCancel });
      const ask = await awaitRunShellAsk();
      expect((await host.cancel()).ok).toBe(true);
      // 硬判据一：run 收束（promise settle；20s 兜底防悬挂）。返回形状按真实取消语义不钉死
      // （task-7 勘误窗口 1：ok:false+error 或 ok:true+aborted 均可能），只要求是 RunResponse 形。
      const res = await settleWithin(runP, 20_000, "cancel 场 run");
      expect(typeof res.ok).toBe("boolean");
      // 硬判据二：不产生 marker（门未放行，工具未执行）
      expect(existsSync(join(wsCancel, "approval-marker.tmp"))).toBe(false);
      // 硬判据三：outbox 有 onAskDone 且 reason ∈ {user, timeout, unattended}
      await vi.waitFor(() => expect(outbox.some(([c]) => c === "onAskDone")).toBe(true));
      const done = outbox.find(([c]) => c === "onAskDone")![1] as
        { askId: string; outcome: string; reason: string };
      expect(done.askId).toBe(ask.askId);
      expect(["user", "timeout", "unattended"]).toContain(done.reason);
      // fail-closed：取消即按拒绝收束（pending 同步出表）⇒ 同一 askId 不可再决议
      expect(host.decide(ask.askId, true)).toBe(false);
    },
    30_000,
  );
});
