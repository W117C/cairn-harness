// sequencer 状态事件读数探针（第 245 页登记的「单独一页读数」；第 248 页取料）。
// 跑一条真 2-stage pipeline（scriptedWorkerModel 假模型、真 sequencer），回答三个问题：
//  ① 状态事件（callId "pipeline-*"）每链发几条、ok 怎么分布、各多大；
//  ② 若改成挂 chain.callId，折叠后每链合并成几条、ok 首条占位会不会翻转；
//  ③ spawn 回执（callId = 模型那次调用）与状态事件在同一 id 下并排长什么样。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile);

import { Orchestrator, scriptedWorkerModel, type AgentEvent } from "../../src/agent/orchestrator.js";
import { createEventLog } from "../../src/events/index.js";

const work = await mkdtemp(join(tmpdir(), "seq-status-"));
const repo = join(work, "repo");
await mkdir(repo, { recursive: true });
const g = (...a: string[]) => exec("git", a, { cwd: repo });
await g("init");
await g("config", "user.email", "probe@test.local");
await g("config", "user.name", "Probe");
await writeFile(join(repo, "README.md"), "line1\n", "utf8");
await g("add", ".");
await g("commit", "-m", "init");

const logPath = join(work, "events.jsonl");
const events: AgentEvent[] = [];
const orch = new Orchestrator({
  logPath,
  workspace: repo,
  parentMode: "default",
  emit: async (e) => {
    events.push(e as AgentEvent);
    await createEventLog(logPath).append(e as AgentEvent);
  },
  modelFor: () => scriptedWorkerModel([
    { type: "assistant_message", content: "stage done（探针假模型，一步收工）" },
  ] as never),
});

// 2-stage pipeline：每 stage 一个 worker，假模型立即收工；方案门到了就批（m3c 同款 decideWorkerApproval）
const CALL_ID = "probe-call-1";
await orch.spawn(
  { mode: "pipeline", stages: [{ role: "implement", task: "stage-1 探针" }, { role: "review", task: "stage-2 探针" }] },
  { callId: CALL_ID },
);
for (let i = 0; i < 20; i++) {
  const apr = events.find((e) => (e as { type?: string }).type === "approval_requested") as { id?: string } | undefined;
  if (apr?.id !== undefined) {
    const d = (orch as unknown as { decideWorkerApproval: (id: string, ok: boolean, how: string) => Promise<{ ok: boolean }> }).decideWorkerApproval(apr.id, true, "once");
    console.log("方案门批准：", JSON.stringify(await d));
    break;
  }
  await new Promise((r) => setTimeout(r, 300));
}

// 等链收敛：5 秒无新事件即认为终态（上限 30 秒）
let last = -1;
let quiet = 0;
for (let i = 0; i < 60 && quiet < 5; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (events.length === last) quiet += 1;
  else { quiet = 0; last = events.length; }
}

const types = new Map<string, number>();
for (const e of events) types.set(e.type, (types.get(e.type) ?? 0) + 1);
console.log("事件类型分布：", JSON.stringify([...types.entries()]));

const status = events.filter((e) => e.type === "tool_result" && String((e as { callId?: string }).callId ?? "").startsWith("pipeline-")) as Array<{ callId: string; ok?: boolean; output?: string }>;
console.log(`\n状态事件（callId "pipeline-*"）＝ ${status.length} 条`);
const byChain = new Map<string, typeof status>();
for (const s of status) {
  const chainId = String(s.callId).slice("pipeline-".length);
  byChain.set(chainId, [...(byChain.get(chainId) ?? []), s]);
}
for (const [cid, list] of byChain) {
  const oks = list.map((s) => (s.ok === false ? "false" : "true")).join(",");
  const bytes = list.map((s) => (s.output ?? "").length);
  console.log(`  链 ${cid}: ${list.length} 条 | ok=[${oks}] | 字节=[${bytes.join(",")}]`);
  for (const s of list) console.log(`    · ok=${String(s.ok)} ${(s.output ?? "").slice(0, 90)}`);
}

// 折叠模拟：状态事件若直接挂 chain.callId，与 spawn 回执（callId=CALL_ID）同 id
const spawnReceipts = events.filter((e) => e.type === "tool_result" && (e as { callId?: string }).callId === CALL_ID) as Array<{ callId: string; ok?: boolean; output?: string }>;
console.log(`\nspawn 回执（callId=${CALL_ID}）＝ ${spawnReceipts.length} 条，ok=[${spawnReceipts.map((r) => String(r.ok)).join(",")}]`);
for (const [cid, list] of byChain) {
  const merged = [...spawnReceipts, ...list]; // 事件序近似：spawn 回执在前
  const foldedOk = merged[0]?.ok;
  const totalBytes = merged.reduce((a, m) => a + (m.output ?? "").length + 2, 0);
  console.log(`  若挂 chain.callId（${cid}）：${merged.length} 条折成 1 条 | 折叠后 ok=${String(foldedOk)}（首条占位）| 合计 ≈${totalBytes} 字节`);
}

await rm(work, { recursive: true, force: true });
