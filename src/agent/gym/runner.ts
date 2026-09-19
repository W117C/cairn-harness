// M5a 反事实回放跑器（§m5-proposal 步骤 3）：
//   模式① 从头跑：task.md → 新会话 → runLoop → verify → score
//   模式② 分叉重跑：forkSession 从事件点派生 → 续跑 → verify → score（同一段历史，换个策略会怎样）
// 模型注入：scripted（明卷，确定性，剧本 = case 内 script.jsonl 冻结）/ real（暗卷 GLM，需 M0_API_KEY）。
// 临时目录纪律：mkdtemp 后必须 realpath（macOS /tmp 实为 /private/tmp）。
import { cp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../../events";
import { createEventLog, forkSession, replay } from "../../events";
import type { ModelOutput, Provider } from "../../providers";
import { streamGlm } from "../../providers/glm";
import { runLoop } from "../loop";
import { runVerifyOutcome } from "../verify";
import { changedFilesBetween, scoreCase } from "./score";
import { copyRepoAndApply, gymTempDir, type GymCase } from "./case";
import { createRoundScriptedProvider } from "./script";
import { probeAssembly, type AssemblyReport } from "./probe";

export type GymModelKind = "scripted" | "real" | "probe";

export interface GymCaseResult {
  caseId: string;
  score: number;
  verifyOk: boolean;
  changedFiles: string[];
  inputTokens: number;
  outputTokens: number;
  turns: number;
  eventsPath: string;
  sessionDir: string;
  forked: boolean;
  /** 仅 `model: "probe"`：这次 run 的上下文装配账（可缓存 / 易变 system / 历史）。 */
  assembly?: AssemblyReport;
}

/** 探针用的基线系统提示。注意：这是**探针自己的**固定串，不等于 app 的真实提示
 *  （真实提示更长）⇒ 由此算出的 cacheableBytes 是可缓存前缀的**下界**。
 *  要量真实装配就把 app 的 systemPrefix 传进 probeAssembly。 */
export const GYM_PROBE_SYSTEM = "你是桌面编程 agent：先读再改，改完必验。";

/** 明卷确定性 usage：按冻结剧本内容折算（input = 每行 JSON 字节/4，output = assistant 文本字符/4）。
 *  同剧本必同 usage——B1「同 case 两次跑逐字段一致」的 usage 面；剧本冻结，改剧本 = 改基线。 */
export async function scriptedUsageOf(scriptPath: string): Promise<{ inputTokens: number; outputTokens: number }> {
  const raw = await readFile(scriptPath, "utf8");
  let inputTokens = 0;
  let outputTokens = 0;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    inputTokens += Math.max(1, Math.round(Buffer.byteLength(t, "utf8") / 4));
    const e = JSON.parse(t) as AgentEvent;
    if (e.type === "assistant_message") {
      outputTokens += Math.max(1, Math.round(Array.from(e.content).length / 4));
    }
  }
  return { inputTokens, outputTokens };
}

/** 明卷剧本 provider：按轮复放 script.jsonl（一次请求一轮，见 ./script.ts），序列跑完即停。 */
function createGymScriptedProvider(scriptPath: string): Provider {
  return createRoundScriptedProvider(scriptPath);
}

/** 暗卷 GLM provider（主会话同款接线；无 key 时 streamGlm 拨号失败，由调用方显式跳过）。 */
function createRealGlmProvider(task: string): Provider {
  let gen: AsyncIterable<ModelOutput> | null = null;
  return {
    stream(messages, _tools, call) {
      if (!gen) {
        gen = streamGlm([{ role: "user", content: task }], {}, undefined, call);
      }
      return gen;
    },
  };
}

function sumUsage(log: AgentEvent[]): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const e of log) {
    if (e.type === "usage") {
      inputTokens += e.inputTokens;
      outputTokens += e.outputTokens;
    }
  }
  return { inputTokens, outputTokens };
}

async function computeResult(
  c: GymCase,
  workDir: string,
  eventsPath: string,
  sessionDir: string,
  model: GymModelKind,
  scriptPath: string | null,
  forked: boolean,
): Promise<GymCaseResult> {
  const outcome = await runVerifyOutcome(workDir);
  const changed = await changedFilesBetween(c.repoDir, workDir);
  const score = scoreCase(c.expect, { verifyOk: outcome.ok, changedFiles: changed });
  const log = await replay(eventsPath);
  const usage =
    model === "real" ? sumUsage(log) : scriptPath !== null ? await scriptedUsageOf(scriptPath) : sumUsage(log);
  const turns = log.filter((e) => e.type === "tool_call").length;
  return {
    caseId: c.id,
    score,
    verifyOk: outcome.ok,
    changedFiles: changed,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    turns,
    eventsPath,
    sessionDir,
    forked,
  };
}

export interface RunCaseOptions {
  model: GymModelKind;
  /** 分叉续跑剧本（模式② 换策略）；缺省沿用 case 原剧本。 */
  resumeScript?: string;
}

/** 模式① 从头跑：task.md → 新会话 → 跑 loop → 跑 verify。 */
export async function runCase(c: GymCase, opts: RunCaseOptions): Promise<GymCaseResult> {
  const sessionDir = await gymTempDir("gym-run-");
  const workDir = join(sessionDir, "work");
  await copyRepoAndApply(c.repoDir, workDir, []);
  const eventsPath = join(sessionDir, "events.jsonl");
  const events = createEventLog(eventsPath);
  const scriptPath = opts.model !== "real" ? opts.resumeScript ?? join(c.dir, "script.jsonl") : null;
  // 探针档：走真会话 provider（composeTurnMessages / 压缩 / 预算全在链上），只换掉出网 transport。
  const probe = opts.model === "probe"
    ? await probeAssembly({ caseId: c.id, eventsPath, workspace: workDir, system: GYM_PROBE_SYSTEM, scriptPath: scriptPath!, mode: "default" })
    : null;
  const provider = probe
    ? probe.provider
    : opts.model === "real"
      ? createRealGlmProvider(c.task)
      : createGymScriptedProvider(scriptPath!);
  await runLoop({
    provider,
    events,
    workspace: workDir,
    mode: "auto",
    userMessage: c.task,
    verify: { maxAttempts: 1, run: () => runVerifyOutcome(workDir) },
  });
  const result = await computeResult(c, workDir, eventsPath, sessionDir, opts.model, scriptPath, false);
  return probe ? { ...result, assembly: probe.report() } : result;
}

/** 模式② 分叉重跑：从父会话事件点 forkSession 派生新会话，复用父会话的 repo 状态续跑（反事实）。 */
export async function forkCase(
  c: GymCase,
  parent: GymCaseResult,
  eventId: string,
  opts: RunCaseOptions,
): Promise<GymCaseResult> {
  if (opts.model === "probe") {
    throw new Error("forkCase: 探针档只做从头跑（gym-run --model probe）——分叉续跑的装配基线含父会话状态，量出来不是同一条链");
  }
  const sessionDir = await gymTempDir("gym-fork-");
  const fork = await forkSession(parent.eventsPath, eventId, join(sessionDir, "fork"));
  const workDir = join(sessionDir, "work");
  await cp(join(parent.sessionDir, "work"), workDir, { recursive: true, force: true });
  const events = createEventLog(fork.eventsPath);
  const scriptPath = opts.model === "scripted" ? opts.resumeScript ?? join(c.dir, "script.jsonl") : null;
  const provider = opts.model === "real" ? createRealGlmProvider(c.task) : createGymScriptedProvider(scriptPath!);
  await runLoop({
    provider,
    events,
    workspace: workDir,
    mode: "auto",
    userMessage: c.task,
    verify: { maxAttempts: 1, run: () => runVerifyOutcome(workDir) },
  });
  return await computeResult(c, workDir, fork.eventsPath, sessionDir, opts.model, scriptPath, true);
}

/** 清理单个 run 的会话目录。 */
export async function cleanupRun(r: GymCaseResult): Promise<void> {
  await rm(r.sessionDir, { recursive: true, force: true }).catch(() => {});
}
