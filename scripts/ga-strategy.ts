// G-A 编排策略对照（spec §7 G-A，最小档 1 case × 3 策略，真模型）。
// 三条策略只差「调度面」：单人 / 先并行只读调研再自己动手 / 整目标交给受限 supervise 循环。
// 用法（凭据一律走环境变量，不落任何文件）：
//   M0A_PROVIDER=glm CAIRN_API_KEY=… CAIRN_MODEL=… CAIRN_ENDPOINT=https://…/chat/completions CAIRN_GLM_TOOL_STREAM=0 \
//   node --import tsx scripts/ga-strategy.ts [--case <id>] [--arms solo,fanout,supervise] \
//     [--max-steps 12] [--max-requests 60] [--out outputs/ga-strategy-<date>]
// 口径备案（读数时必须带着）：
//  ① 系统提示是本脚本自带的短串，不是 app 的 BASE_SYSTEM（后者住在 src/main/agent-runner.ts，
//     纯 node 脚本 import 它会拉起 electron）。⇒ 本档量的是「显式下达策略指令后，派活是否划算」，
//     不是「BASE_SYSTEM 那句编排纪律够不够」。
//  ② 价表只认模型名：中转端点服务的模型名不在表内 ⇒ 折不出 $，只报 tokens（不把不可知折成 $0）。
import { execFile } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentEvent } from "../src/events";
import { createEventLog, replay } from "../src/events";
import type { GlmToolSpec } from "../src/providers/glm";
import { glmDefaultModelName } from "../src/providers/glm";
import { DEFAULT_MODEL_TABLE, findSpecByNameOrId } from "../src/providers/registry";
import { costUsd } from "../src/routing/pricing";
import { runLoop } from "../src/agent/loop";
import { runVerifyOutcome } from "../src/agent/verify";
import { Orchestrator } from "../src/agent/orchestrator";
import { createGlmSessionProvider, sessionToolSpecs } from "../src/agent/glm-session";
import { hasWorkerAttribution } from "../src/agent/context";
import { projectSession } from "../src/agent/tool-choice";
import { TOOLS, type Tool } from "../src/tools";
import { createWaitForAgentsTool } from "../src/tools/wait_for_agents";
import { loadCase, loadGymIndex, copyRepoAndApply, gymTempDir, type GymCase } from "../src/agent/gym/case";
import { changedFilesBetween, scoreCase } from "../src/agent/gym/score";

const run = promisify(execFile);
const ROOT = process.cwd();
const GYM = join(ROOT, "fixtures", "gym");
const argv = process.argv.slice(2);
const pick = (flag: string, dflt: string): string => {
  const i = argv.indexOf(flag);
  return i < 0 || argv[i + 1] === undefined ? dflt : String(argv[i + 1]);
};
const caseId = pick("--case", "order-pricing-triple-fix");
const arms = pick("--arms", "solo,fanout,supervise").split(",").map((a) => a.trim()).filter(Boolean);
const maxSteps = Number(pick("--max-steps", "12"));
const maxRequests = Number(pick("--max-requests", "60"));
const outDir = pick("--out", join("outputs", "ga-strategy-" + new Date().toISOString().slice(0, 10)));

const ORCH_TOOLS = ["spawn_agent", "wait_for_agents"];
/** 三臂唯一的差别就是这一句（其余任务文本逐字相同）——否则读数分不清策略与措辞。 */
const PRELUDE: Record<string, string> = {
  solo: "本次策略＝单人：不得派子代理，全部自己读完并改完。",
  fanout: "本次策略＝先并行调研再动手：先用 spawn_agent（mode=read）把三处 bug 涉及的阅读面并行派出去调研（每份任务书自包含：目标／涉及文件／要回答的问题），收队拿到回执后再自己动手改并自验。不得让 worker 写盘。",
  supervise: "本次策略＝受限 supervise：用 spawn_agent（mode=supervise，maxStages=3）把整个目标交给受限自适应循环执行，收队后按回执核对；没有客观判据支撑不得宣称完成。",
};

interface ArmReading {
  arm: string;
  score: number;
  verifyOk: boolean;
  changedFiles: string[];
  requests: number;
  toolCalls: number;
  byToolName: Record<string, { calls: number; failures: number }>;
  spawns: number;
  waitCalls: number;
  workerTerminals: Record<string, number>;
  writeSessionsWithoutVerifyPass: 0 | 1;
  verifyPasses: number;
  approvals: number;
  tokens: { mainIn: number; mainOut: number; workerIn: number; workerOut: number };
  usd: number | null;
  priceModel: string;
  seconds: number;
  capped: boolean;
  error: string | null;
  eventsPath: string;
}

function sumUsage(log: readonly AgentEvent[]): ArmReading["tokens"] {
  const t = { mainIn: 0, mainOut: 0, workerIn: 0, workerOut: 0 };
  for (const e of log) {
    if (e.type !== "usage") continue;
    if (hasWorkerAttribution(e)) { t.workerIn += e.inputTokens; t.workerOut += e.outputTokens; }
    else { t.mainIn += e.inputTokens; t.mainOut += e.outputTokens; }
  }
  return t;
}

/** 临时靶仓 git 化：write/supervise 臂要建 worktree，必须是个 git 仓库（solo 臂同样 git 化，
 *  否则三臂环境不同形）。全在 mkdtemp 目录里，不碰用户仓库。 */
async function gitInit(dir: string): Promise<void> {
  await run("git", ["init", "-q"], { cwd: dir });
  await run("git", ["config", "user.email", "ga@local"], { cwd: dir });
  await run("git", ["config", "user.name", "ga"], { cwd: dir });
  await writeFile(join(dir, ".gitignore"), ".agents/\nnode_modules/\n", "utf8");
  await run("git", ["add", "-A"], { cwd: dir });
  await run("git", ["commit", "-qm", "ga baseline"], { cwd: dir });
}

async function runArm(arm: string, c: GymCase, budget: { left: number }): Promise<ArmReading> {
  const usesOrchestrator = arm !== "solo";
  const sessionDir = await gymTempDir("ga-" + arm + "-");
  const workDir = join(sessionDir, "work");
  await copyRepoAndApply(c.repoDir, workDir, []);
  await gitInit(workDir);
  const eventsPath = join(sessionDir, "events.jsonl");
  const log = createEventLog(eventsPath);
  const abort = new AbortController();
  let requests = 0;
  let capped = false;
  let approvals = 0;

  const orch = usesOrchestrator
    ? new Orchestrator({
        logPath: eventsPath,
        workspace: workDir,
        parentMode: "auto",
        safeMode: "off",
        emit: async (e: AgentEvent) => {
          await log.append(e);
          // 无人值守：授权卡到即批（supervise 契约 / 租约相交都算），批不批本身记一笔数。
          // orch 在这个闭包里还没赋值完，故走 holder（闭包只在 spawn 之后被调，holder 必已就绪）。
          if (e.type === "approval_requested") { approvals++; orchHolder?.decideWorkerApproval(e.id, true, "once"); }
        },
      })
    : null;
  let orchHolder: Orchestrator | null = orch;

  const baseFace = sessionToolSpecs({ mode: "auto" });
  const specs: GlmToolSpec[] = usesOrchestrator
    ? baseFace.specs
    : baseFace.specs.filter((s) => !ORCH_TOOLS.includes(s.function.name));
  const execTools: Record<string, Tool> = { ...(TOOLS as unknown as Record<string, Tool>) };
  if (orch) {
    execTools.spawn_agent = {
      name: "spawn_agent",
      async run(args, ctx) {
        return await orch.spawn(args as Parameters<Orchestrator["spawn"]>[0], { callId: ctx.callId });
      },
    } as Tool;
    execTools.wait_for_agents = createWaitForAgentsTool(() => orch);
  }

  const provider = createGlmSessionProvider(eventsPath, {
    system: "你是桌面编程 agent：先读再改，改完必验；只说做过的事实，没做过的不说。",
    workspace: workDir,
    requestFace: () => ({ tools: specs, note: baseFace.note }),
    emit: (e: AgentEvent) => log.append(e),
  });
  const metered = {
    stream(messages: Parameters<typeof provider.stream>[0], tools: Parameters<typeof provider.stream>[1], call?: { signal?: AbortSignal }) {
      requests++;
      if (requests > budget.left) { capped = true; abort.abort(); }
      return provider.stream(messages, tools, { signal: abort.signal });
    },
  };

  const started = Date.now();
  let error: string | null = null;
  try {
    await runLoop({
      provider: metered,
      events: log,
      workspace: workDir,
      mode: "auto",
      maxSteps,
      userMessage: c.task.trim() + "\n\n" + (PRELUDE[arm] ?? "") + "\n",
      verify: { maxAttempts: 2, run: () => runVerifyOutcome(workDir) },
      tools: execTools,
      signal: abort.signal,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const seconds = (Date.now() - started) / 1000;

  const stream = await replay(eventsPath);
  const counts = projectSession(stream);
  const tokens = sumUsage(stream);
  const workerTerminals: Record<string, number> = {};
  for (const e of stream) {
    if (e.type === "agent_result" && hasWorkerAttribution(e)) {
      const k = String((e as Extract<AgentEvent, { type: "agent_result" }>).status ?? "?");
      workerTerminals[k] = (workerTerminals[k] ?? 0) + 1;
    }
  }
  const outcome = await runVerifyOutcome(workDir);
  const changed = (await changedFilesBetween(c.repoDir, workDir)).filter((f) => !f.startsWith(".git/"));
  const score = scoreCase(c.expect, { verifyOk: outcome.ok, changedFiles: changed });

  // $：只认模型名查表；查不到就报 null（不拿 $0 冒充实付）。
  const modelName = glmDefaultModelName();
  const spec = findSpecByNameOrId(DEFAULT_MODEL_TABLE, modelName);
  const all = { inputTokens: tokens.mainIn + tokens.workerIn, outputTokens: tokens.mainOut + tokens.workerOut };
  const usd = spec ? costUsd(spec.id, all) : null;

  const keepDir = join(ROOT, outDir);
  await mkdir(keepDir, { recursive: true });
  const kept = join(keepDir, arm + ".events.jsonl");
  await copyFile(eventsPath, kept).catch(() => undefined);
  await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);

  return {
    arm, score, verifyOk: outcome.ok, changedFiles: changed, requests,
    toolCalls: counts.toolCalls, byToolName: counts.byToolName,
    spawns: counts.spawns, waitCalls: counts.waitCalls, workerTerminals,
    writeSessionsWithoutVerifyPass: counts.writeSessionsWithoutVerifyPass,
    verifyPasses: counts.verifyPasses, approvals, tokens, usd, priceModel: modelName,
    seconds, capped, error, eventsPath: kept,
  };
}

const index = await loadGymIndex(GYM);
const entry = index.cases.find((x) => x.id === caseId);
if (!entry) { console.error("[ga] 无此 case: " + caseId); process.exit(1); }
const gcase = await loadCase(GYM, entry);
if (!process.env.CAIRN_API_KEY || !process.env.CAIRN_ENDPOINT) {
  console.log("[ga] 暗卷缺席（无 CAIRN_API_KEY / CAIRN_ENDPOINT）——显式跳过，不出数（未证 ≠ 通过）");
  process.exit(0);
}
console.log(`[ga] case=${caseId} 臂=${arms.join("/")} maxSteps=${maxSteps} 请求帽=${maxRequests}`);

const readings: ArmReading[] = [];
const budget = { left: maxRequests };
for (const arm of arms) {
  const r = await runArm(arm, gcase, budget);
  budget.left -= r.requests;
  readings.push(r);
  const tok = r.tokens.mainIn + r.tokens.mainOut + r.tokens.workerIn + r.tokens.workerOut;
  console.log(
    `[ga] ${arm.padEnd(9)} score=${r.score} verify=${r.verifyOk ? "ok" : "FAIL"} 请求=${String(r.requests)}`
    + ` tokens=${String(tok)}（主 ${String(r.tokens.mainIn)}/${String(r.tokens.mainOut)}｜worker ${String(r.tokens.workerIn)}/${String(r.tokens.workerOut)}）`
    + ` $=${r.usd === null ? "价表无此模型名（" + r.priceModel + "）" : r.usd.toFixed(4)}`
    + ` spawn=${String(r.spawns)} wait=${String(r.waitCalls)} 工具=${String(r.toolCalls)} 写而不验=${String(r.writeSessionsWithoutVerifyPass)}`
    + ` ${String(Math.round(r.seconds))}s${r.capped ? " [帽]" : ""}${r.error ? " [err] " + r.error.slice(0, 120) : ""}`,
  );
}

const md = [
  "# G-A 编排策略对照（最小档）",
  "",
  "- case: `" + caseId + "`（" + gcase.expect.mustChangeFiles.join(", ") + "）",
  "- 端点/模型: env 注入的第三方中转 + `" + glmDefaultModelName() + "` ⇒ **不得当作官方 glm 档位读数引用**",
  "- 系统提示：脚本自带短串（非 BASE_SYSTEM）；三臂仅策略句不同 ⇒ 量的是「显式下令后派活是否划算」",
  "- n=1／臂 ⇒ 只出单次读数，不宣称趋势",
  "",
  "| 臂 | 分数 | verify | 请求 | tokens(总) | 主/worker | $ | spawn | wait | 工具调用 | 写而不验 | worker 终态 | 秒 |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...readings.map((r) => {
    const tok = r.tokens.mainIn + r.tokens.mainOut + r.tokens.workerIn + r.tokens.workerOut;
    return "| " + [
      r.arm, String(r.score), r.verifyOk ? "ok" : "FAIL", String(r.requests), String(tok),
      String(r.tokens.mainIn + r.tokens.mainOut) + " / " + String(r.tokens.workerIn + r.tokens.workerOut),
      r.usd === null ? "未知" : r.usd.toFixed(4), String(r.spawns), String(r.waitCalls), String(r.toolCalls),
      String(r.writeSessionsWithoutVerifyPass),
      Object.entries(r.workerTerminals).map(([k, v]) => k + "×" + String(v)).join(" ") || "—",
      String(Math.round(r.seconds)),
    ].join(" | ") + " |";
  }),
  "",
  "事件流证据：`" + outDir + "/<arm>.events.jsonl`（临时靶仓已销毁；改动文件见 JSON 里 changedFiles）。",
].join("\n") + "\n";

await mkdir(join(ROOT, outDir), { recursive: true });
await writeFile(join(ROOT, outDir, "readings.json"), JSON.stringify({ caseId, arms: readings }, null, 2) + "\n", "utf8");
await writeFile(join(ROOT, outDir, "report.md"), md, "utf8");
console.log("[ga] 报告写出 " + join(outDir, "report.md"));
process.exit(0);
