// 会话收束面的两类产物 + 安全模式解析——拆分面（同 provider-key-inject 先例）：实现从
// agent-runner.ts 搬来本轻模块，装配根按原路径继续导出，调用方零改动。
//   · M1d 手动压缩：摘要器 CAIRN_API_KEY → GLM；缺 key 且 M1D_COMPACTION_DEMO=1 → 冻结 mock；
//     否则 fail-closed 报错，绝不静默压缩。
//   · M2f 安全快筛 hook：验证门收敛后从事件流重建变更集 → 一条 security_report 事件；不阻断主流程。
//   · M3b 安全模式解析：显式 env 优先，缺省读设置页（默认 report）。
// 本模块零装配根依赖：钩子引擎与事件管线都由调用方以参数递进来。
import { createEventLog, replay, type AgentEvent } from "../events";
import { runCompaction, createMockSummarizer, compactionCardPayload } from "../agent/compaction";
import { createGlmSummarizer } from "../agent/session-provider";
import type { HookEngine } from "../agent/plugins/hooks";
import { buildSecurityReport } from "../agent/security/scan";
import { store } from "./settings-handlers";

// ---- M1d：/compact 手动入口（压缩必出卡，走 BUILTIN_PROMPTS 内置模板）----
// 摘要器：CAIRN_API_KEY 在场 → GLM 暗卷；缺 key 且 M1D_COMPACTION_DEMO=1 → 冻结 mock（演示通道，
// M1a M0A_MOCK_DELTA 同族先例）；否则 fail-closed 报错，绝不静默压缩。
// 演示通道同时收小 tail 预算（演示会话只有十几条事件，默认预算会把全部事件留在 tail 内无可压缩）。
const DEMO_SUMMARY = [
  "## Objective",
  "- 修复 fixtures/todo-app 中失败的测试（completedCount 未过滤 done 项），由 agent 按 mock 剧本完成。",
  "",
  "## Important Details",
  "- 事件流在 out 会话日志中；权限走 auto 档，写文件与跑测试均已批准。",
  "",
  "## Work State",
  "### Completed",
  "- read_file 读源码 → write_file 修复 completedCount 过滤 → run_shell 跑 vitest（3 passed）。",
  "",
  "### Active",
  "- 无。",
  "",
  "### Blocked",
  "- 无。",
  "",
  "## Next Move",
  "- 继续下一个任务即可；靶子已恢复全绿。",
  "",
  "## Relevant Files",
  "- fixtures/todo-app/src/todo.ts（写，修复点）",
  "- fixtures/todo-app/tests/todo.test.ts（读，判卷用例）",
].join("\n");

/** §9.5 PreCompact 的发出口径（手动压缩与会话自动/溢出压缩两条生产者共用这一处）。
 *  无钩子引擎 = 零行为；阻断只告警——§9.5 表里 PreCompact 没有阻断语义，
 *  把它当闸门用等于让插件悄悄关掉压缩链（那必须是一行的可见输出，不是静默）。 */
export async function firePreCompactHook(hooks: HookEngine | undefined, trigger: "manual" | "auto"): Promise<void> {
  if (!hooks) return;
  const r = await hooks.run("PreCompact", { event: "PreCompact", trigger });
  for (const msg of r.errors) console.warn("[hooks] PreCompact:", msg);
  if (r.blocked) console.warn("[hooks] PreCompact 返回阻断（该事件无阻断语义，已忽略）：" + (r.blockReason ?? ""));
}

/** 对一份会话日志执行手动压缩（trigger=manual, reason=user_request）。
 *  emit = 会话管线（落盘+推送同路，M1b 坑十八口径）；缺省直接落盘（headless/脚本）。 */
export async function compactSessionLog(
  logPath: string,
  emit?: (e: AgentEvent) => Promise<void>,
  hooks?: HookEngine,
): Promise<{ ok: boolean; error?: string; event?: AgentEvent; cardPayload?: Record<string, unknown> }> {
  const events = await replay(logPath);
  if (events.length === 0) return { ok: false, error: "会话为空，无可压缩" };
  // §9.5 PreCompact 的生产端在 runCompaction 里（唯一）——这里只把「谁去跑钩子」递下去。
  // 原先是本函数自己 run 一次，而自动压缩档没人发 ⇒ `PreCompact(auto)` 的 matcher 永不命中；
  // 两处各发又会变成 SessionEnd 那种双生产者。trigger 取 §9.5 表里的枚举值 manual/auto。
  const demo = process.env.M1D_COMPACTION_DEMO === "1";
  const summarizer = process.env.CAIRN_API_KEY
    ? createGlmSummarizer()
    : demo
      ? createMockSummarizer(DEMO_SUMMARY)
      : undefined;
  if (!summarizer) return { ok: false, error: "无 CAIRN_API_KEY，手动压缩不可用（fail-closed，不静默压缩）" };
  const outcome = await runCompaction({
    events,
    trigger: "manual",
    reason: "user_request",
    summarizer,
    onPreCompact: (trigger) => firePreCompactHook(hooks, trigger),
    ...(demo ? { config: { tailMinTokens: 150, tailMaxTokens: 300 } } : {}),
  });
  if (!outcome.ok) return { ok: false, error: outcome.why };
  if (emit) await emit(outcome.event);
  else await createEventLog(logPath).append(outcome.event);
  return { ok: true, event: outcome.event, cardPayload: compactionCardPayload(outcome.event) };
}

// ---- M2f：产出代码安全 report 的触发点（验证门收敛后 hook；默认 report，off 不跑）----
// 只做静态快筛（零 token、本地）：从事件流写动作重建变更集 → findings → 一条 security_report 事件。
// 不阻断主流程（loop 已收束，报告只是事后审计事件）；无写动作 / 未收敛 / off → 零行为。
export function shouldRunSecurityReport(safeMode: string, events: AgentEvent[]): boolean {
  if (safeMode !== "report") return false;
  return events.some((e) => e.type === "verify_result" && e.ok);
}

/** 验证门收敛后的安全快筛 hook：产出报告事件（经 emit 落盘 + 上屏）。返回是否产出。 */
export async function runSecurityReportHook(
  logPath: string,
  safeMode: string,
  emit: (e: AgentEvent) => Promise<void>,
): Promise<boolean> {
  try {
    const events = await replay(logPath);
    if (!shouldRunSecurityReport(safeMode, events)) return false;
    const report = buildSecurityReport(events, { scannedAt: new Date().toISOString() });
    if (!report) return false;
    await emit(report);
    return true;
  } catch (err) {
    console.warn("[security] 快筛失败（不阻断主流程）:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** M3b：产出代码安全模式解析（编排器与验收脚本共用口径）：显式 env 优先，缺省读设置页（默认 report）。 */
export async function resolveSafeMode(): Promise<"off" | "report" | "gate"> {
  const env = process.env.M1E_SAFE_MODE;
  if (env === "off" || env === "report" || env === "gate") return env;
  if (env !== undefined) delete process.env.M1E_SAFE_MODE; // 非法值清除（fail-visible 于下一次 get）
  const safeMode = (await store().get()).safeMode;
  return safeMode === "off" || safeMode === "gate" ? safeMode : "report";
}
