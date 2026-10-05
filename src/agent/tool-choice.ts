// W3b：工具/skill 选择面的可观测性——从既有事件流纯投影读数，不加模型面、不加决策。
// 为什么要它：spec §0 追加那条要求是「skill / MCP / 子代理的自动调用是能力要求」，而"自动"
// 至今只有反证（发货了没人调）没有读数；W1a 的收队工具落地后同理——模型会不会自己去收队，
// 必须一眼读出，否则下一轮又变成互相猜。
// 两条边界比读数本身重要：① 这里全是代理量不是准确率，事件流里没有"本该调哪个"的信息，
// 所以 unmeasurable 把撑不起的几条显式列出来，免得下游当分数读（真选对率要 W5a 靶场）；
// ② 分母为 0 的比率一律 null 不是 0（未证 ≠ 通过）。
import { stuckActionOf, stuckObservationOf } from "./stuck";
import { mayHaveWrittenDisk } from "./write-face";
import { hasWorkerAttribution } from "./context";
import { parseScopedToolName } from "./plugins/mcp";
import { isEnvVerifyCause, type AgentEvent, type ToolCallEvent } from "../events";

export const WAIT_TOOL_NAME = "wait_for_agents";

export interface ToolStat {
  calls: number;
  failures: number;
  /** 失败率；分母为 0 时 null */
  failRate: number | null;
}

export interface Rate {
  n: number;
  over: number;
  value: number | null;
}

/** 单会话贡献：只存原始计数，比率留到合并后再算——把 per-session 比率相加会得到
 *  「平均的平均」，那种数字看着精确其实什么都没说。 */
export interface SessionCounts {
  userTurns: number;
  toolCalls: number;
  workerCalls: number;
  /** 同 action + 同结果、与更早一次撞上（复用 stuck.ts 摘要，不另造检测器）。
   *  **两支串都取前 200 字**（`stuckActionOf` 截参数、`stuckObservationOf` 截结果）⇒
   *  这里能说的只有"比对窗口内相同"，不能说"逐字"（第 313 页；口径见 `tests/tool-choice.test.ts`）。 */
  repeats: number;
  repeatOver: number;
  spawns: number;
  results: number;
  waitCalls: number;
  spawnSessions: 0 | 1;
  spawnSessionsWithoutWait: 0 | 1;
  verifySelfCalls: number;
  verifyAutoBeats: number;
  verifyPasses: number;
  /** 代码红（判据 = `!isEnvVerifyCause(cause)`，含未归因——口径「cause 缺席 ⇒ 按 code 算」）。
   *  #102 之前这一档吃的是「任何 ok:false」，于是被拒／环境那两拍也记在这里。 */
  verifyFailures: number;
  /** 被拒那一拍（`cause === "skipped"`：有面未授权，命令一条都没执行）——分档只是计数，
   *  红/不红的界仍由 `src/events` 里那只 `isEnvVerifyCause` 判，这里不另立 cause 清单。 */
  verifyBlocked: number;
  /** 其余环境红（toolchain-missing / timeout / no-surface / hook-error / pkg-manager / not-run）。 */
  verifyEnv: number;
  writeSessions: 0 | 1;
  /** 写过盘却没有任何一次 verify 通过 ⇒「说了但没验」，W4c 假完成率的现成分子 */
  writeSessionsWithoutVerifyPass: 0 | 1;
  skillCalls: number;
  mcpCalls: number;
  runErrors: number;
  byToolName: Record<string, { calls: number; failures: number }>;
}

export interface ToolChoiceReadings {
  schema: 1;
  sessions: number;
  /** 一轮 = 一条 user_message（会话可多轮） */
  userTurns: number;
  toolCalls: number;
  byTool: Record<string, ToolStat>;
  /** 子代理侧发起的调用（tool_call 带 agent_id）：主会话与 worker 混看会把"谁在用"糊掉 */
  workerCalls: number;
  /** 同 action + 同结果（前 200 字窗口，同上）与更早一次撞上 */
  repeat: Rate;
  orchestration: {
    spawns: number;
    /** 到达终态（agent_result）的 worker 数 */
    results: number;
    /** spawns − results：没等到终态会话就结束了 */
    orphans: number;
    waitCalls: number;
    spawnSessions: number;
    /** 派过 worker 却没调过收队工具的会话数——W1a 有没有被用起来就读这一行 */
    spawnSessionsWithoutWait: number;
  };
  verification: {
    selfCalls: number;
    autoBeats: number;
    passes: number;
    /** 代码红（含未归因）。#102 起被拒／环境两拍不再进这一格。 */
    failures: number;
    /** 被拒那一拍数（`cause === "skipped"`：有面未授权，命令一条都没执行）。 */
    blocked: number;
    /** 其余环境红那一拍数（工具链缺失／超时／无可验面／钩子抛错／包管理器／没跑完）。 */
    env: number;
    writeSessions: number;
    /** 写过盘却没有任何一次**主会话** verify 通过（说了但没验），W4c 假完成率的现成分子。
     *  worker 侧的验证证据由 agent_id 摘掉（withAgentId 已覆盖 verify_result）——
     *  归因面少这一类，这里就会假绿。 */
    writeSessionsWithoutVerifyPass: number;
  };
  plugins: { skillCalls: number; mcpCalls: number };
  runErrors: number;
  /** 事件流支撑不起、但不写出来就会被当成"没这个问题"的几条 */
  unmeasurable: string[];
}

export const UNMEASURABLE: readonly string[] = [
  "选对率：事件流里没有「本该调哪个工具/skill」的判据，要 W5a 靶场的分叉回放当 ground truth",
  "skill/MCP 在场但未用：日志不记当时有哪些可用（session_meta 无此字段），只数得到调了的",
  "参数质量：不看 args 语义，重复探测只按「action 串与结果串各取前 200 字」相同判",
  "单次调用耗时：主流事件类型上没有时间戳字段",
];

/** 一个会话 → 原始计数。纯函数、幂等、不读盘不读设置。callId→tool_call 先建索引，
 *  不在 tool_result 分支里线性 find——万条事件的会话会被这条投影自己拖死。 */
export function projectSession(events: readonly AgentEvent[]): SessionCounts {
  const out: SessionCounts = {
    userTurns: 0, toolCalls: 0, workerCalls: 0, repeats: 0, repeatOver: 0,
    spawns: 0, results: 0, waitCalls: 0, spawnSessions: 0, spawnSessionsWithoutWait: 0,
    verifySelfCalls: 0, verifyAutoBeats: 0, verifyPasses: 0, verifyFailures: 0,
    verifyBlocked: 0, verifyEnv: 0,
    writeSessions: 0, writeSessionsWithoutVerifyPass: 0,
    skillCalls: 0, mcpCalls: 0, runErrors: 0, byToolName: {},
  };
  const callsById = new Map<string, ToolCallEvent>();
  const seen = new Set<string>();
  let mainWrites = 0;
  let mainVerifyPass = false;

  for (const e of events) {
    switch (e.type) {
      case "user_message":
        out.userTurns++;
        break;
      case "error":
        // 事件类型名是 "error"（RunErrorEvent），不是 "run_error"：写成后者这条 case 永不命中，
        // runErrors 会静默成 0 —— 一个看着像读数的假零，比不给读数更坏。由测钉住。
        out.runErrors++;
        break;
      case "agent_spawned":
        out.spawns++;
        break;
      case "agent_result":
        out.results++;
        break;
      case "verify_result":
        // 归因：withAgentId 已把 verify_result 纳入子流装饰面 ⇒ worker 的验证证据带 agent_id，
        // 不替主会话销账。缺了这条，「写过盘没验」在任何开了 worker 自动验证的会话上都会假绿。
        if (e.ok) {
          out.verifyPasses++;
          if (!hasWorkerAttribution(e)) mainVerifyPass = true;
        }
        // 红那一档只收代码红（#102）。判据是 `src/events` 里那一只 `isEnvVerifyCause`——与
        // worker-report / loop / 沉淀四处出口同一份表，这里不抄第二份 cause 清单。
        // 被拒／环境拍在事件流里与代码红**同形**（都是 ok:false），分开靠的是 `cause`：
        // 那一拍一条命令都没执行（被拒）或压根跑不了（环境），记进 `failures` 就是给
        // 看这屏数的人一个假的红计数（读数不驱动闸，但闸外的人只读得到它）。
        else if (!isEnvVerifyCause(e.cause)) out.verifyFailures++;
        else if (e.cause === "skipped") out.verifyBlocked++;
        else out.verifyEnv++;
        if (e.auto === true) out.verifyAutoBeats++;
        break;
      case "tool_call": {
        out.toolCalls++;
        callsById.set(e.id, e);
        if (hasWorkerAttribution(e)) out.workerCalls++;
        const stat = out.byToolName[e.name] ?? { calls: 0, failures: 0 };
        stat.calls++;
        out.byToolName[e.name] = stat;
        if (e.name === "skill") out.skillCalls++;
        if (parseScopedToolName(e.name) !== null) out.mcpCalls++;
        if (e.name === WAIT_TOOL_NAME) out.waitCalls++;
        if (e.name === "verify") out.verifySelfCalls++;
        break;
      }
      case "tool_result": {
        const call = callsById.get(e.callId);
        if (call === undefined) break; // 旁路 result（harness 自动拍等）没有配对调用：不计数
        const stat = out.byToolName[call.name];
        // 带 gate 的失败 = 权限判定拦下的，不是工具跑挂了。混在一起计会让「模型选错工具」的读数
        // 被人拒批的次数污染（历史上正是这个口径把每次拒批都算成一次工具失败）。
        if (stat !== undefined && !e.ok && e.gate === undefined) stat.failures++;
        // 「写过盘」= 这一笔**成功**、且统一写向判据说它会改本工作区的盘（`./write-face`，
        // 与 loop 的收束闸、worker-report 的 lastWrite 同一只谓词）。
        // 旧形状是在 tool_call 分支内联比 write_file/edit_file，两处都偏：
        // 少认 shell ⇒「假完成率」分子恒 0；多认失败的 write_file ⇒ 没落盘也算写过。
        if (e.ok && !hasWorkerAttribution(call) && mayHaveWrittenDisk(call.name, call.args ?? {})) mainWrites++;
        out.repeatOver++;
        const key = stuckActionOf(call.name, call.args) + "\n" + stuckObservationOf(e.output);
        if (seen.has(key)) out.repeats++; // 第 2 次及以后都算一次重复探测：每次都是整轮 token + 零新信息
        seen.add(key);
        break;
      }
      default:
        break;
    }
  }
  out.spawnSessions = out.spawns > 0 ? 1 : 0;
  out.spawnSessionsWithoutWait = out.spawns > 0 && out.waitCalls === 0 ? 1 : 0;
  out.writeSessions = mainWrites > 0 ? 1 : 0;
  out.writeSessionsWithoutVerifyPass = mainWrites > 0 && !mainVerifyPass ? 1 : 0;
  return out;
}

const rate = (n: number, over: number): Rate => ({ n, over, value: over > 0 ? n / over : null });

/** 多会话合并：先加原始计数，最后才算比率。 */
export function projectToolChoice(sessions: readonly (readonly AgentEvent[])[]): ToolChoiceReadings {
  const a = projectSession([]);
  for (const ev of sessions) {
    const c = projectSession(ev);
    a.userTurns += c.userTurns;
    a.toolCalls += c.toolCalls;
    a.workerCalls += c.workerCalls;
    a.repeats += c.repeats;
    a.repeatOver += c.repeatOver;
    a.spawns += c.spawns;
    a.results += c.results;
    a.waitCalls += c.waitCalls;
    a.spawnSessions += c.spawnSessions;
    a.spawnSessionsWithoutWait += c.spawnSessionsWithoutWait;
    a.verifySelfCalls += c.verifySelfCalls;
    a.verifyAutoBeats += c.verifyAutoBeats;
    a.verifyPasses += c.verifyPasses;
    a.verifyFailures += c.verifyFailures;
    a.verifyBlocked += c.verifyBlocked;
    a.verifyEnv += c.verifyEnv;
    a.writeSessions += c.writeSessions;
    a.writeSessionsWithoutVerifyPass += c.writeSessionsWithoutVerifyPass;
    a.skillCalls += c.skillCalls;
    a.mcpCalls += c.mcpCalls;
    a.runErrors += c.runErrors;
    for (const [name, v] of Object.entries(c.byToolName)) {
      const t = a.byToolName[name] ?? { calls: 0, failures: 0 };
      t.calls += v.calls;
      t.failures += v.failures;
      a.byToolName[name] = t;
    }
  }
  const byTool: Record<string, ToolStat> = {};
  for (const [name, v] of Object.entries(a.byToolName)) {
    byTool[name] = { calls: v.calls, failures: v.failures, failRate: rate(v.failures, v.calls).value };
  }
  return {
    schema: 1,
    sessions: sessions.length,
    userTurns: a.userTurns,
    toolCalls: a.toolCalls,
    byTool,
    workerCalls: a.workerCalls,
    repeat: rate(a.repeats, a.repeatOver),
    orchestration: {
      spawns: a.spawns,
      results: a.results,
      orphans: Math.max(0, a.spawns - a.results),
      waitCalls: a.waitCalls,
      spawnSessions: a.spawnSessions,
      spawnSessionsWithoutWait: a.spawnSessionsWithoutWait,
    },
    verification: {
      selfCalls: a.verifySelfCalls,
      autoBeats: a.verifyAutoBeats,
      passes: a.verifyPasses,
      failures: a.verifyFailures,
      blocked: a.verifyBlocked,
      env: a.verifyEnv,
      writeSessions: a.writeSessions,
      writeSessionsWithoutVerifyPass: a.writeSessionsWithoutVerifyPass,
    },
    plugins: { skillCalls: a.skillCalls, mcpCalls: a.mcpCalls },
    runErrors: a.runErrors,
    unmeasurable: [...UNMEASURABLE],
  };
}

const pct = (v: number | null): string => (v === null ? "未证" : (v * 100).toFixed(1) + "%");

/** 打印面：把 unmeasurable 印在同一屏——读数与它的边界分开放，下游就只剩读数。 */
export function formatToolChoice(r: ToolChoiceReadings): string {
  const lines: string[] = [
    "工具/skill 选择读数（代理量，不是准确率）：会话 " + String(r.sessions) +
      " · 轮 " + String(r.userTurns) + " · 工具调用 " + String(r.toolCalls) +
      "（其中子代理侧 " + String(r.workerCalls) + "）",
  ];
  const rows = Object.entries(r.byTool).sort((x, y) => y[1].calls - x[1].calls || x[0].localeCompare(y[0]));
  const width = Math.max(4, ...rows.map(([n]) => n.length));
  for (const [name, s] of rows) {
    lines.push("  " + name.padEnd(width) + "  调用 " + String(s.calls).padStart(4) + "  失败 " + String(s.failures).padStart(3) + "  " + pct(s.failRate));
  }
  lines.push("  重复探测        " + String(r.repeat.n) + "/" + String(r.repeat.over) + " = " + pct(r.repeat.value) + "（同 action + 结果前 200 字相同，两支都截断）");
  const o = r.orchestration;
  lines.push("  编排            spawn " + String(o.spawns) + " · 终态 " + String(o.results) + " · 未收敛 " + String(o.orphans) +
    " · 收队调用 " + String(o.waitCalls) + " · 派过 worker 的会话 " + String(o.spawnSessions) +
    " → 其中没调过收队工具的 " + String(o.spawnSessionsWithoutWait) + " ← W1a 是否真被用起来就读这行");
  const v = r.verification;
  // 三种结局分开设（#102）：这一屏的受众就是「读这些数的人」，被拒与环境拍混进 `failures`
  // 时他们看到的红数是假的（判据仍只有 `isEnvVerifyCause` 那一只，分档不进第二份表）。
  lines.push("  验证            自调 " + String(v.selfCalls) + " · 自动拍 " + String(v.autoBeats) +
    " · 通过 " + String(v.passes) + " · 失败 " + String(v.failures) + "（代码红）" +
    " · 被拒 " + String(v.blocked) + "（有面未授权，命令一条都没执行）" +
    " · 环境 " + String(v.env) + "（工具链缺失／超时／无可验面／钩子抛错／包管理器／没跑完）" +
    " · 写过盘的会话 " + String(v.writeSessions) + " → 其中没有任何一次通过的 " + String(v.writeSessionsWithoutVerifyPass) + "（假完成率分子）");
  lines.push("  插件            skill 调用 " + String(r.plugins.skillCalls) + " · MCP 调用 " + String(r.plugins.mcpCalls) +
    " · run_error " + String(r.runErrors));
  lines.push("  ⚠️ 这套读数答不出的（别把它当分数读）：");
  for (const u of r.unmeasurable) lines.push("     · " + u);
  return lines.join("\n");
}
