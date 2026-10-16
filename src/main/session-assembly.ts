// 会话/编排器装配面：**唯一的编排器构造口**（`buildSessionOrchestrator`）＋崩溃恢复兜底
// （`ensureSessionOrchestrator`）＋worker 的 shell 出口（`workerShellRunnerFor`）。
// 结构债审查报告 #2 的第三缝。抽因同前两刀（`demo-scripted.ts` / `provider-assembly.ts`）：
// 装配根该是「谁接谁」的接线表，这三支却是「怎么把编排器造出来 / 这条会话该不该建」的**机制**。
//
// 边界怎么划的（本刀最容易划歪的一处）：`orchestratorExtras` **留在装配根、按回调注入**，
// 不跟着搬。它是**策略面**——按设置盘决定接哪些开关（maxBudgetUsd / impactAnalysis / autoVerify /
// routingBandit / routingCascade / promptCache），且要摸 verifyExec、价键派生、插件运行时三个域；
// 搬进来就得把这三个域一起拽进来（或再注入两个纯助手），本模块当场从「机制」变成「半个装配根」。
// 「注入纯助手/政策口避反向 import」是本仓既有先例（见 `setGoalHandlerDeps({ budgetPriceKeyOf })`），
// 不是本笔新立的规矩。判据：装配根仍**只**接策略与活状态，本模块只做构造与查找。
//
// 本模块**不反向依赖装配根**（同 state-handlers / scheduler-runtime 那一族）：四处模块级活状态
// 按回调注入。
import { existsSync } from "node:fs";
import { join } from "node:path";
import { affectedFilesOf } from "../agent/impact/index.js";
import { Orchestrator, type OrchestratorOptions } from "../agent/orchestrator";
import { recoveryParentMode } from "../agent/recovery";
import type { VerifyTrustResolver } from "../agent/verify-trust";
import { createEventLog, replay, type AgentEvent } from "../events";
import { loadPermissionRules } from "../permissions";
import { globalPermissionsPath } from "../permissions/rules";
import { resolveSafeMode } from "./compact-and-report";
import type { MainModelSelection } from "./provider-runtime";
import type { RoutingFlagOverrides } from "./routing-flags";
import { runInSandbox, type SandboxStatus } from "./sandbox";
import { mapSandboxTestCommandForWorkspace } from "./sandbox-test-command";
import { requireSessionsDir } from "./session-handlers";
import { pathOf } from "./sessions";
import { store } from "./settings-handlers";
import { currentWorkspace } from "./state-handlers";

/** 编排器扩展接线的**策略口**（实现在装配根；签名逐字同那一支）。
 *  第三参收成一张对象的老口径不变：S3 信任闸那两个面（调用方断言 + 生产问人）必须一起递。 */
export type OrchestratorExtras = (
  sandbox: SandboxStatus | null,
  runModel: MainModelSelection | undefined,
  trust: { trustedRepo: boolean; verifyTrust: VerifyTrustResolver | null },
  over: RoutingFlagOverrides,
) => Promise<
  Pick<OrchestratorOptions, "agentRoleFor" | "workerSummarizer" | "budget" | "routing" | "banditStatePath" | "promptCache" | "impactAnalysis" | "workerVerify" | "workerHooks">
>;

/** 装配根注入的活状态与策略口（唯一入口 `setSessionAssemblyDeps`）。 */
export interface SessionAssemblyDeps {
  /** 会话级编排器：**活状态**——worker 的审批应答/取消路由要在父 turn 结束后仍可达（§4.4.3 前车之鉴）。 */
  activeOrchestrator: () => Orchestrator | null;
  /** 同上，写回（构造成功后才落）。 */
  setActiveOrchestrator: (o: Orchestrator) => void;
  /** 「最近一次 run 的日志路径」（装配根的可变状态，活读）。 */
  lastLogPath: () => string | null;
  /** 事件推送（装配根 `hooks.onEvent` 的活读；装配根那份解包成同一个口）。 */
  onEvent: (e: AgentEvent) => void;
  /** 沙箱自检结果（装配根的可变状态，活读）。 */
  sandboxState: () => SandboxStatus;
  orchestratorExtras: OrchestratorExtras;
}

let deps: SessionAssemblyDeps | null = null;
/** 装配根启动时注入（可重入：判卷 `vi.resetModules` 重组时按新装配根重注）。 */
export function setSessionAssemblyDeps(d: SessionAssemblyDeps): void {
  deps = d;
}
function D(): SessionAssemblyDeps {
  if (!deps) throw new Error("session-assembly: 装配根未注入依赖（唯一入口 setSessionAssemblyDeps）");
  return deps;
}

/** worker 的 shell 出口：沙箱可用时走 `runInSandbox`，不可用/未接线时落回裸执行。
 *
 *  口径与主会话 run_shell 那道门（:461）逐条对齐：那里是 `s.sandbox !== null && s.sandbox.available`
 *  才进沙箱，否则原样落回 `original.run`——worker 这边不做更严的判断，否则非 macOS 宿主上
 *  worker 一条命令都发不出去。
 *  缺省断网：主会话那条路的 `networkProfileFor` 要审批上下文，worker 门里没有这条通道，
 *  于是按 profile 缺省（无 network 规则 ⇒ 闭箱全断）取 deny。worker 要联网只能回主会话发。
 *
 *  导出是为了让「装不装」这个决定本身可判：守卫原文钉在源文本上钉不住**可用态那条路是不是真的通**
 *  （实测：把可用态整条路改成 `return undefined`、守卫一字不动，那 7 条判卷全绿——而那正是本仓
 *  反复栽的形状，worker 悄悄退回 Seatbelt 之外）。断网那一格仍留源文本：证它要真起一次 Seatbelt。 */
export function workerShellRunnerFor(sandbox: SandboxStatus | null): OrchestratorOptions["workerShell"] {
  if (sandbox === null || !sandbox.available) return undefined;
  return async (command, ctx) => {
    const mapped = mapSandboxTestCommandForWorkspace(command, ctx.workspace);
    return runInSandbox(mapped, { cwd: ctx.workspace, network: "deny" });
  };
}

/** **唯一的编排器构造口**：两处调用者（runAgent 现场 / 崩溃恢复兜底）只递各自不同的那几件
 *  （logPath / workspace / 父档位 / emit / 沙箱 / 已加载的规则库 + 可选注入模型），
 *  其余口径全在这里，结构上没法再各写一份。
 *
 *  为什么收成一处（2026-09-24 实测）：P0-2 当年给 runAgent 那处补上 `rules` / `sandboxAvailable`
 *  （注释原话：「否则项目级 deny/ask 规则对 worker 全表失效」），兜底那处**没跟着改**；
 *  而它当时谁都到不了，所以缺件不可见。本会话把崩溃恢复修到可达之后，那处差异立刻变成
 *  「重派出来的 worker 不带项目规则、也不知道沙箱可用性」跑。⇒ 同族出口副本：两处构造迟早漂。
 *  判据：`tests/orchestrator-construction-sites.test.ts`（AST 数构造点 = 1 且本口被调 2 次）。 */
export async function buildSessionOrchestrator(a: {
  logPath: string;
  workspace: string;
  parentMode: OrchestratorOptions["parentMode"];
  emit: OrchestratorOptions["emit"];
  sandbox: SandboxStatus | null;
  rules: ReturnType<typeof loadPermissionRules>;
  modelFor?: OrchestratorOptions["modelFor"];
  /** 本 run 已解析的模型选择（逐请求指定的档位在这里）；缺省 = 按 env + 设置盘现算（同一把纯函数）。 */
  runModel?: MainModelSelection;
  /** S3 信任闸（调用方断言那一层）：true = 这个仓的命令由**调用方**担保（判卷/脚本/自有靶子），
   *  不经信任表也不发审批卡。缺省 false。 */
  trustedRepo?: boolean;
  /** S3 信任闸的生产接线（本场 run 的「查表 + 首问」组合口）。null = 没有可问的门
   *  （恢复路径 / 非交互装配）⇒ worker 那条 verify 保持 fail-closed 拒绝，与今日逐字同形。
   *  注意它**不是**「父会话批过就给 worker 免问」的通道：键的第一维是 worker 自己的 repoDir。 */
  verifyTrust?: VerifyTrustResolver | null;
  /** M5b 路由开关 runtime override（CLI `--bandit/--cascade` 一族）。缺席 = 用 settings
   *  （恢复路径走的就是缺席那支，与今日逐字同形）。 */
  routing?: RoutingFlagOverrides;
}): Promise<Orchestrator> {
  const s = await store().get();
  const workerShell = workerShellRunnerFor(a.sandbox);
  return new Orchestrator({
    logPath: a.logPath,
    workspace: a.workspace,
    parentMode: a.parentMode,
    emit: a.emit,
    rules: a.rules,
    sandboxAvailable: a.sandbox ? a.sandbox.available : null,
    ...(workerShell ? { workerShell } : {}),
    safeMode: await resolveSafeMode(), // M3b §11.6：off 不跑 / report 只标 / gate 红标 + 二次确认
    // B1 语义合并闸：影响面开启时，spawn 的写租约判定多问一层「波及集相交」——
    // 两个 worker 各改各的文件（glob 不相交）但改动波及同一批调用点，合并时同样会打架。
    ...(s.impactAnalysis ? { semanticLease: (globs: string[]) => affectedFilesOf(a.workspace, globs) } : {}),
    ...(await D().orchestratorExtras(a.sandbox, a.runModel, { trustedRepo: a.trustedRepo ?? false, verifyTrust: a.verifyTrust ?? null }, a.routing ?? {})), // M3c：插件角色 / worker 压缩摘要器 / 成本闸 / W4a worker 收束闸
    ...(a.modelFor ? { modelFor: a.modelFor } : {}),
  });
}

/** M3c 会话编排器兜底（崩溃恢复「重派」路径）：无 activeOrchestrator 时按**这条会话的现场**建一个，
 *  保证恢复卡的按钮真实可达。两处此前只在内存里，于是这个分支谁都到不了（实测读数见
 *  `tests/recovery-parent-mode.test.ts` 最后一格：重启后点重派得到「无可用事件管线」）：
 *  ① 日志出处原先只读 `lastLogPath`（只有 run 会写）⇒ 现在优先用设置盘里**已持久化**的
 *     `currentSession`（`handleSessionOpen` 落它就是为了重启还原），拿不到才退回 lastLogPath；
 *  ② 父档位原先读设置盘的 `mode`——那个键的语义是「**新对话**开始时使用的权限档」，拿它当一条
 *     已存在会话的父档，等于把一条 read-only 会话重派成 auto 帽子下的可写会话（§11.7.6 单调继承
 *     的三道闸一起被换松一档）⇒ 改由 `recoveryParentMode` 从事件流的权限留痕里读回来。 */
export async function ensureSessionOrchestrator(): Promise<Orchestrator | null> {
  const existing = D().activeOrchestrator();
  if (existing) return existing;
  const sessionId = (await store().get()).currentSession;
  const logPath = sessionId ? pathOf(requireSessionsDir(), sessionId) : D().lastLogPath();
  if (!logPath || !existsSync(logPath)) return null; // 宁可不建，也不给不存在的会话凭空开一条流
  const log = createEventLog(logPath);
  const workspace = await currentWorkspace();
  const orch = await buildSessionOrchestrator({
    logPath,
    workspace,
    parentMode: recoveryParentMode(await replay(logPath).catch(() => []), (await store().get()).mode),
    emit: async (e: AgentEvent) => {
      await log.append(e);
      D().onEvent(e);
    },
    sandbox: D().sandboxState(),
    rules: loadPermissionRules(join(workspace, ".agent", "permissions.json"), globalPermissionsPath()),
  
  });
  D().setActiveOrchestrator(orch);
  return orch;
}
