// sequencer 动态探针（第 250 页登记两格的交卷）：runLoop 驱动一条 pipeline，
// ① 量 runLoop 节拍下的状态事件（条数/ok/体积/折叠形状）；② 查方案门 id 时序反常
// （第 250 页：无决策者时 300ms 内已决议——本探针并发抢答，看抢没抢得过）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

import { runLoop } from "../../src/agent/loop.js";
import { orchestratorForApproval } from "../../src/agent/orchestrator.js";
import type { AgentEvent, ProviderMessage } from "../../src/events/index.js";

const work = await mkdtemp(join(tmpdir(), "seq-dynamic-"));
const repo = join(work, "repo");
await mkdir(repo, { recursive: true });
const g = (...a: string[]) => exec("git", a, { cwd: repo });
await g("init");
await g("config", "user.email", "probe@test.local");
await g("config", "user.name", "Probe");
await writeFile(join(repo, "README.md"), "line1\n", "utf8");
await g("add", ".");
await g("commit", "-m", "init");

const log: AgentEvent[] = [];
const requests: ProviderMessage[][] = [];
let decided: { id: string; outcome: string } | null = null;
let approvedSeen = false;

const run = runLoop({
  workspace: repo,
  userMessage: "跑一条两环 pipeline 探针",
  mode: "auto",
  maxSteps: 12,
  events: { async append(e) { log.push(e); } },
  provider: {
    async *stream(messages: ProviderMessage[]) {
      requests.push(messages);
      const n = requests.length;
      if (n === 1) {
        yield {
          type: "tool_call",
          id: "pc1",
          name: "spawn_agent",
          args: { mode: "pipeline", stages: [{ role: "implement", task: "stage-1 探针" }, { role: "review", task: "stage-2 探针" }] },
        } as never;
      } else {
        yield { type: "assistant_message", content: "pipeline 已请求，等待编排侧收敛（探针假模型）" } as never;
      }
    },
  },
} as never);

// 并发抢答：见 approval_requested 即路由 decideWorkerApproval（10ms 间隔，赢不赢都记下）
const poller = (async () => {
  for (let i = 0; i < 3000; i++) {
    const apr = log.find((e) => (e as { type?: string }).type === "approval_requested") as { id?: string } | undefined;
    if (apr?.id) {
      const orch = orchestratorForApproval(apr.id);
      if (orch !== null) {
        const r = orch.decideWorkerApproval(apr.id, true, "once");
        decided = { id: apr.id, outcome: JSON.stringify(await r) };
        approvedSeen = true;
        return;
      }
      decided = { id: apr.id, outcome: "orchestratorForApproval 路由不到（owner 未注册或已清）" };
      return;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  decided = { id: "(未见)", outcome: "30 秒内没有 approval_requested" };
})();
await run;
await poller;

// 等链收敛：4 秒无新事件即终态（上限 30 秒）
let last = -1;
let quiet = 0;
for (let i = 0; i < 60 && quiet < 4; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (log.length === last) quiet += 1;
  else { quiet = 0; last = log.length; }
}

console.log("方案门抢答：", JSON.stringify(decided), "| 抢答器看到 approved 路径:", approvedSeen);
const types = new Map<string, number>();
for (const e of log) types.set(e.type, (types.get(e.type) ?? 0) + 1);
console.log("事件类型分布：", JSON.stringify([...types.entries()]));

const status = log.filter((e) => e.type === "tool_result" && String((e as { callId?: string }).callId ?? "").startsWith("pipeline-")) as Array<{ callId: string; ok?: boolean; output?: string }>;
console.log(`\n状态事件（callId "pipeline-*"）＝ ${status.length} 条`);
for (const s of status) console.log(`  · callId=${s.callId} ok=${String(s.ok)} ${(s.output ?? "").slice(0, 80)}`);

const approval = log.find((e) => (e as { type?: string }).type === "approval_resolved") as { id?: string; approved?: boolean; reason?: string } | undefined;
console.log("\napproval_resolved 原文：", JSON.stringify(approval)?.slice(0, 300));

const spawnReceipt = log.filter((e) => e.type === "tool_result" && (e as { callId?: string }).callId === "pc1") as Array<{ ok?: boolean; output?: string }>;
console.log(`spawn 回执（callId=pc1）＝ ${spawnReceipt.length} 条，ok=[${spawnReceipt.map((r) => String(r.ok)).join(",")}]`);
for (const r of spawnReceipt) console.log("  回执正文：", (r.output ?? "").slice(0, 200));

await rm(work, { recursive: true, force: true });
