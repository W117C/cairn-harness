// M2 验收锚的机器证明（task-7）：mock 全链路「审批→执行→打断」headless 判卷。
// 通道：M3A_MAIN_SCRIPT=<绝对路径>（scriptedMainModelPath 第一优先，agent-runner.ts createProvider
// 顶部一行消费）⇒ 主模型按 fixtures/agents/main-approval-demo.jsonl 回放；fixture 里 run_shell
// 是写副作用工具，default 档必经 appAskGate（agent-runner.ts 头注语义：read-only 拒副作用 /
// default 询问 / auto 放行）。args.model 缺席 ⇒ 零 worker spawn（不进 M3A_AGENTS_DEMO 通道）。
// host 装配手法沿 kernel-host.test.ts：mkdtemp 工作区、seed settings provider=demo、outbox 收集、
// env 清场与还原。两用例共用同一份 fixture 路径常量，各用独立工作区（同一个 marker 文件名，互不串扰）。
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createKernelHost, type KernelHost } from "../src/main/kernel-host";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, "fixtures", "agents", "main-approval-demo.jsonl");

const root = mkdtempSync(join(tmpdir(), "cairn-approval-"));
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
  "M0A_PROVIDER", "CAIRN_MODEL", "M0B_WORKSPACE",
] as const;
const ambientBackup = ambientKeys.map((k) => [k, process.env[k]] as const);
for (const k of ambientKeys) delete process.env[k];
process.env.M3A_MAIN_SCRIPT = script; // 脚本化主模型第一优先通道；不带 M3A_AGENTS_DEMO（显式只设一个更干净）

const outbox: (readonly [string, unknown])[] = [];
// M3 T1 多工作区装配式：每场 run 的工作区由「会话→工作区归属」给出（createSession 指工作区），
// 不再走 RunRequest.workspace 产品位——审批/打断两场各落各的工作区，隔离语义不变。
const host: KernelHost = createKernelHost({
  workspaces: [wsApprove, wsCancel],
  activeWorkspace: wsApprove,
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
      const created = await host.createSession(wsApprove);
      const runP = host.run({ message: "建标记", mode: "default", sessionId: created.id });
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
      const created = await host.createSession(wsCancel);
      const runP = host.run({ message: "建标记（随即打断）", mode: "default", sessionId: created.id });
      const ask = await awaitRunShellAsk();
      expect((await host.cancel(created.id)).ok).toBe(true);
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

  it(
    "每会话取消：取消 A 不影响 B；A 返回 aborted:true 且 onAskDone fail-closed",
    async () => {
      // M3 T2（每会话取消）。M3A_MAIN_SCRIPT 是进程级通道且逐 run 读取（createProvider 顶部，
      // agent-runner.ts:1379）⇒ 同进程并发两场 run 共用同一份审批剧本：A/B 各自的 provider
      // 实例各自从头回放、各自把 run_shell 送审（独立 askId，共享 appAskGate 只登记不串场）。
      // 这把隔离判据顶到最狠处：两场都停在门等待时取消 A——M2 全局缝（handleRunCancel abort
      // 的是最后注册的 interactiveRunAbort = B 的 runAbort）会杀错 B 而 A 挂死；会话级 cancel 只许收 A。
      rmSync(join(wsApprove, "approval-marker.tmp"), { force: true }); // 场 1 留下的 marker 清场（单独跑本例时本就不在）
      outbox.length = 0;
      const a = await host.createSession(wsCancel);
      const b = await host.createSession(wsApprove);
      expect(b.id).not.toBe(a.id);
      const runA = host.run({ message: "建标记（将被打断）", mode: "default", sessionId: a.id });
      const askA = await awaitRunShellAsk(); // A 先飞：第一张 run_shell 审批卡必属 A
      const runB = host.run({ message: "建标记（照常跑完）", mode: "default", sessionId: b.id });
      await vi.waitFor(
        () =>
          expect(
            outbox.filter(([c, p]) => c === "onAsk" && (p as { tool?: string }).tool === "run_shell").length,
          ).toBeGreaterThanOrEqual(2),
        { timeout: 10_000, interval: 200 },
      );
      const askB = outbox
        .map(([, p]) => p as { askId: string; tool: string })
        .find((p) => p.tool === "run_shell" && p.askId !== askA.askId)!;
      // 双双停在门等待 → 会话级取消 A
      expect((await host.cancel(a.id)).ok).toBe(true);
      // A 收束且带 aborted 真值（kernel-host 判 controller.signal.aborted 的 desktop 扩展字段）
      const resA = await settleWithin(runA, 20_000, "A（取消场）run");
      expect(resA.aborted, JSON.stringify(resA)).toBe(true);
      // 门等待即时收束的实证（勘误窗口裁决）：AskGate onAbort 落 onAskDone reason=user；
      // settleWithin 20s 本身就是「非延迟收束」的界——若取消够不着门等待，这里要等 60s 超时才收。
      await vi.waitFor(() => expect(outbox.some(([c]) => c === "onAskDone")).toBe(true));
      const doneOf = (askId: string) =>
        outbox
          .filter(([c]) => c === "onAskDone") // 先按通道过滤：onAsk 载荷同带 askId（无 outcome），不能混扫
          .map(([, p]) => p as { askId: string; outcome: string; reason: string })
          .find((p) => p.askId === askId);
      const doneA = doneOf(askA.askId);
      expect(doneA?.outcome).toBe("rejected");
      expect(["user", "timeout", "unattended"]).toContain(doneA?.reason);
      expect(doneA?.reason).toBe("user"); // 收束来源是取消（abort），不是门超时
      // fail-closed：A 的 pending 同步出表 ⇒ 同一 askId 不可再决议
      expect(host.decide(askA.askId, true)).toBe(false);
      // A 无 marker（门未放行，工具未执行）
      expect(existsSync(join(wsCancel, "approval-marker.tmp"))).toBe(false);
      // B 完全不受影响：审批照常可决议、run 照常 ok、marker 落 B 的工作区
      expect(host.decide(askB.askId, true)).toBe(true);
      const resB = await settleWithin(runB, 20_000, "B（照常场）run");
      expect(resB.ok, JSON.stringify(resB)).toBe(true);
      expect(resB.aborted).toBeUndefined(); // aborted 当且仅当该会话 controller 被 abort
      expect(existsSync(join(wsApprove, "approval-marker.tmp"))).toBe(true);
      const doneB = doneOf(askB.askId);
      expect(doneB?.outcome).toBe("approved");
      expect(doneB?.reason).toBe("user");
      // B 的会话流完整可读（归属表解析 + 取消未向 B 注入任何事件）
      const openedB = await host.openSession(b.id);
      expect(openedB.events.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
