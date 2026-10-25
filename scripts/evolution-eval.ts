// 配对评价的 TCB 入口（首期）：固定任务集、固定配置，baseline 与 candidate 逐任务各跑一遍。
//
// 真实执行面**不在本脚本里**：`--runner <path>` 指向一个 Node/TS 脚本，逐个 run 接收
//   EVOLUTION_VERSION / EVOLUTION_TASK_JSON / EVOLUTION_SPLIT / EVOLUTION_WORKSPACE
// 并输出一行 JSON：{ ok, costUsd, tokens, durationMs, artifactDigest, failureReason }。
// 缺 runner、任务集解析失败、记录版本不符 ⇒ 退出 2（跑不了 ≠ 通过）；runner 自身失败 ⇒ 该 run
// 记为 ok=null（unmeasurable），由 evaluator 拒绝晋升。
//
// 用法：
//   node --import tsx scripts/evolution-eval.ts \
//     --tasks fixtures/bench/tasks.json \
//     --baseline 1.1.0 --candidate 1.2.0 \
//     --workspace /tmp/evo-ws --record /tmp/evo-ws/modules/candidates/<id>/1.2.0.json \
//     --validation B9-refactor-rename,B10-refactor-dedupe \
//     --runner <path-to-runner>.ts --out /tmp/evo-eval.json
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseTaskSetJson } from "../src/agent/eval/task-set";
import {
  digestText,
  parseCandidateRecord,
  writeCandidateRecord,
} from "../src/main/evolution/candidate-record";
import { evaluatePaired, type EvalRunOutput, type EvalTask } from "../src/main/evolution/evaluator";

const argv = process.argv.slice(2);
const pick = (flag: string, dflt: string): string => {
  const eq = flag + "=";
  const withEq = argv.find((a) => a.startsWith(eq));
  if (withEq !== undefined) return withEq.slice(eq.length);
  const i = argv.indexOf(flag);
  return i < 0 || argv[i + 1] === undefined ? dflt : String(argv[i + 1]);
};

const TASKS_FILE = pick("--tasks", "");
const BASELINE = pick("--baseline", "");
const CANDIDATE = pick("--candidate", "");
const WORKSPACE = resolve(pick("--workspace", process.cwd()));
const RECORD = pick("--record", "");
const RUNNER = pick("--runner", "");
const OUT = pick("--out", "");
const VALIDATION = new Set(pick("--validation", "").split(",").map((s) => s.trim()).filter(Boolean));
const CONFIG_DIGEST = pick("--config-digest", "") || null;
const TIMEOUT_MS = Number(pick("--timeout-ms", "600000"));
const MIN_COST = Number(pick("--min-cost-improvement", "0.05"));

function refuse(message: string): never {
  console.error("[evolution-eval] " + message);
  process.exit(2);
}

if (TASKS_FILE === "") refuse("缺 --tasks（固定任务集）");
if (BASELINE === "") refuse("缺 --baseline");
if (CANDIDATE === "") refuse("缺 --candidate");
if (RUNNER === "") refuse("缺 --runner（真实执行面必须由 TCB 注入；本脚本不内置模型调用）");
if (!Number.isFinite(MIN_COST) || MIN_COST < 0 || MIN_COST >= 1) refuse("--min-cost-improvement 须在 [0,1)");
if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS <= 0) refuse("--timeout-ms 须为正数");

let rawTasks: string;
try {
  rawTasks = await readFile(resolve(TASKS_FILE), "utf8");
} catch (err) {
  refuse("任务集读不了：" + (err instanceof Error ? err.message : String(err)));
}
const parsed = parseTaskSetJson(rawTasks);
if (parsed.errors.length > 0) {
  refuse("任务集解析失败：\n  " + parsed.errors.join("\n  "));
}
if (parsed.tasks.length === 0) refuse("任务集解析后为空——空分母不许出数");
for (const id of VALIDATION) {
  if (!parsed.tasks.some((task) => task.id === id)) refuse("--validation 指定了任务集里不存在的 id：" + id);
}
const tasks: EvalTask[] = parsed.tasks.map((task) => ({
  id: task.id,
  split: VALIDATION.has(task.id) ? "validation" : "search",
}));
const taskSetDigest = digestText(rawTasks);

function tail(text: string, max = 400): string {
  return text.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim().slice(-max);
}

function runOne(version: string, task: EvalTask): EvalRunOutput {
  const spec = parsed.tasks.find((item) => item.id === task.id)!;
  const r = spawnSync(process.execPath, ["--import", "tsx", resolve(RUNNER)], {
    encoding: "utf8",
    // runner 从仓库根执行（`--import tsx` 要按仓库的 node_modules 解析）；
    // 被评价的工作区只经 EVOLUTION_WORKSPACE 传进去，不靠 cwd 猜。
    cwd: process.cwd(),
    timeout: TIMEOUT_MS,
    env: {
      ...process.env,
      EVOLUTION_VERSION: version,
      EVOLUTION_TASK_JSON: JSON.stringify(spec),
      EVOLUTION_SPLIT: task.split,
      EVOLUTION_WORKSPACE: WORKSPACE,
    },
  });
  const output = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) {
    return {
      ok: null,
      costUsd: null,
      tokens: null,
      durationMs: null,
      artifactDigest: null,
      failureReason: "runner exit=" + String(r.status ?? "null") + " · " + tail(output),
    };
  }
  const line = (r.stdout ?? "").trim().split("\n").filter(Boolean).pop();
  if (line === undefined) {
    return { ok: null, costUsd: null, tokens: null, durationMs: null, artifactDigest: null, failureReason: "runner 没有输出 JSON" };
  }
  let value: Record<string, unknown>;
  try {
    const parsedLine: unknown = JSON.parse(line);
    if (typeof parsedLine !== "object" || parsedLine === null || Array.isArray(parsedLine)) throw new Error("not an object");
    value = parsedLine as Record<string, unknown>;
  } catch (err) {
    return { ok: null, costUsd: null, tokens: null, durationMs: null, artifactDigest: null, failureReason: "runner 输出不是 JSON 对象：" + tail(line) };
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    ok: typeof value.ok === "boolean" ? value.ok : null,
    costUsd: num(value.costUsd),
    tokens: num(value.tokens),
    durationMs: num(value.durationMs),
    artifactDigest: typeof value.artifactDigest === "string" ? value.artifactDigest : null,
    failureReason: typeof value.failureReason === "string" ? value.failureReason : null,
  };
}

const result = await evaluatePaired({
  baselineVersion: BASELINE,
  candidateVersion: CANDIDATE,
  tasks,
  run: async ({ version, task }) => runOne(version, task),
  minCostImprovement: MIN_COST,
  configDigest: CONFIG_DIGEST,
});

const report = {
  baselineVersion: BASELINE,
  candidateVersion: CANDIDATE,
  taskSet: { digest: taskSetDigest, tasks: tasks.length, validation: VALIDATION.size },
  configDigest: CONFIG_DIGEST,
  result,
};
const text = JSON.stringify(report, null, 2) + "\n";

if (RECORD !== "") {
  let record;
  try {
    record = parseCandidateRecord(JSON.parse(await readFile(resolve(RECORD), "utf8")) as unknown);
  } catch (err) {
    refuse("候选档案读不了：" + (err instanceof Error ? err.message : String(err)));
  }
  if (record.version !== CANDIDATE) refuse("候选档案版本 " + record.version + " 与 --candidate " + CANDIDATE + " 不一致");
  record.runs = result.candidateRuns;
  record.evaluation = { status: result.status, decision: result.decision, reason: result.reason };
  await writeCandidateRecord(WORKSPACE, record);
}

if (OUT !== "") {
  await writeFile(resolve(OUT), text, "utf8");
} else {
  process.stdout.write(text);
}

console.log("[evolution-eval] " + result.status + " / " + result.decision + " · " + result.reason);
