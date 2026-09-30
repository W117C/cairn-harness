// sequencer 动态探针·失败链（250/256 页两格的最后一块）：stage-1 worker 无模型响应即失败
// ⇒ 观察整链 failed 的 ok=false 状态事件真实形状，与折叠推演（ok 首条占位）对照。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile);

import { Orchestrator, scriptedWorkerModel, orchestratorForApproval, type AgentEvent, type SpawnArgs } from "../../src/agent/orchestrator.js";
import { runLoop } from "../../src/agent/loop.js";

const work = await mkdtemp(join(tmpdir(), "seq-fail-"));
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
  modelFor: (a: SpawnArgs) => {
    const task = String(a.task ?? "");
    if (task.includes("stage-1")) return scriptedWorkerModel([] as never); // 空脚本 ⇒ worker 失败
    return scriptedWorkerModel([{ type: "assistant_message", content: "stage-2 done" }] as never);
  },
});

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
        id: "pf1",
        name: "spawn_agent",
        args: { mode: "pipeline", stages: [{ role: "implement", task: "stage-1 探针（会失败）" }, { role: "review", task: "stage-2 探针" }] },
      } as never;
    } else {
      yield { type: "assistant_message", content: "pipeline 已请求（探针假模型）" } as never;
    }
  },
};

let decided: { id: string; outcome: string } | null = null;
const poller = (async () => {
  for (let i = 0; i < 3000; i++) {
    const apr = log.find((e) => (e as { type?: string }).type === "approval_requested") as { id?: string } | undefined;
    if (apr?.id) {
      const o = orchestratorForApproval(apr.id);
      if (o === null) { decided = { id: apr.id, outcome: "路由不到" }; return; }
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
  userMessage: "跑一条会失败的 pipeline 探针",
  mode: "auto",
  maxSteps: 10,
  events: { async append(e) { log.push(e as AgentEvent); } },
  tools: { spawn_agent: spawnAgentTool } as never,
  provider: provider as never,
} as never);
await poller;

let last = -1;
let quiet = 0;
for (let i = 0; i < 60 && quiet < 4; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (log.length === last) quiet += 1;
  else { quiet = 0; last = log.length; }
}

console.log("方案门抢答：", JSON.stringify(decided));
const status = log.filter((e) => e.type === "tool_result" && String((e as { callId?: string }).callId ?? "").startsWith("pipeline-")) as Array<{ callId: string; ok?: boolean; output?: string }>;
console.log(`\n失败链状态事件 ＝ ${status.length} 条`);
for (const s of status) console.log(`  · callId=${s.callId} ok=${String(s.ok)} ${(s.output ?? "").slice(0, 80)}`);
const results = log.filter((e) => e.type === "agent_result") as Array<{ ok?: boolean; agent_id?: string }>;
console.log(`agent_result：${results.length} 条，ok=[${results.map((r) => String(r.ok)).join(",")}]`);

await rm(work, { recursive: true, force: true });
