// sequencer 动态探针·生产装配层（第 254 页指明的路径）：把 spawn_agent 按 agent-runner 的
// 生产形状（run(args,ctx) → orch.spawn(args,{callId: ctx.callId})）接进 runLoop 的 tools，
// 取 runLoop 节拍下的状态事件实测读数，交第 250 页登记的两格。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile);

import { Orchestrator, scriptedWorkerModel, orchestratorForApproval, type AgentEvent, type SpawnArgs } from "../../src/agent/orchestrator.js";
import { runLoop } from "../../src/agent/loop.js";

const work = await mkdtemp(join(tmpdir(), "seq-prod-"));
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
const orch = new Orchestrator({
  logPath: join(work, "events.jsonl"),
  workspace: repo,
  parentMode: "default",
  emit: async (e) => { log.push(e as AgentEvent); },
  modelFor: () => scriptedWorkerModel([
    { type: "assistant_message", content: "stage done（探针假模型，一步收工）" },
  ] as never),
});

// 生产形状镜像（agent-runner.ts:976-982）：run(args, ctx) → orch.spawn(args, { callId: ctx.callId })
const spawnAgentTool = {
  name: "spawn_agent",
  async run(args: SpawnArgs, ctx: { callId?: string }) {
    return await orch.spawn(args, { callId: ctx.callId });
  },
};

let seq = 0;
const provider = {
  async *stream(_messages: unknown[]) {
    seq += 1;
    if (seq === 1) {
      yield {
        type: "tool_call",
        id: "pc1",
        name: "spawn_agent",
        args: { mode: "pipeline", stages: [{ role: "implement", task: "stage-1 探针" }, { role: "review", task: "stage-2 探针" }] },
      } as never;
    } else {
      yield { type: "assistant_message", content: "pipeline 已请求，等编排侧收敛（探针假模型）" } as never;
    }
  },
};

// 并发抢答：见 approval_requested 即路由 decideWorkerApproval（10ms 间隔，输赢都记）
let decided: { id: string; outcome: string } | null = null;
const poller = (async () => {
  for (let i = 0; i < 3000; i++) {
    const apr = log.find((e) => (e as { type?: string }).type === "approval_requested") as { id?: string } | undefined;
    if (apr?.id) {
      const o = orchestratorForApproval(apr.id);
      if (o === null) { decided = { id: apr.id, outcome: "路由不到（owner 未注册）" }; return; }
      const r = await o.decideWorkerApproval(apr.id, true, "once");
      decided = { id: apr.id, outcome: JSON.stringify(r) };
      return;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  decided = { id: "(未见)", outcome: "30 秒内没有 approval_requested" };
})();

await runLoop({
  workspace: repo,
  userMessage: "跑一条两环 pipeline 探针",
  mode: "auto",
  maxSteps: 10,
  events: { async append(e) { log.push(e as AgentEvent); } },
  tools: { spawn_agent: spawnAgentTool } as never,
  provider: provider as never,
  userMessageSkill: undefined,
} as never);
await poller;

// 等链收敛：4 秒无新事件即终态（上限 30 秒）
let last = -1;
let quiet = 0;
for (let i = 0; i < 60 && quiet < 4; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (log.length === last) quiet += 1;
  else { quiet = 0; last = log.length; }
}

console.log("方案门抢答：", JSON.stringify(decided));
const types = new Map<string, number>();
for (const e of log) types.set(e.type, (types.get(e.type) ?? 0) + 1);
console.log("事件类型分布：", JSON.stringify([...types.entries()]));

const status = log.filter((e) => e.type === "tool_result" && String((e as { callId?: string }).callId ?? "").startsWith("pipeline-")) as Array<{ callId: string; ok?: boolean; output?: string }>;
console.log(`\n状态事件（callId "pipeline-*"）＝ ${status.length} 条`);
for (const s of status) console.log(`  · callId=${s.callId} ok=${String(s.ok)} ${(s.output ?? "").slice(0, 80)}`);

const spawnReceipt = log.filter((e) => e.type === "tool_result" && (e as { callId?: string }).callId === "pc1") as Array<{ ok?: boolean; output?: string }>;
console.log(`\nspawn 回执（callId=pc1）＝ ${spawnReceipt.length} 条，ok=[${spawnReceipt.map((r) => String(r.ok)).join(",")}]`);
for (const r of spawnReceipt) console.log("  回执正文：", (r.output ?? "").slice(0, 160));

await rm(work, { recursive: true, force: true });
