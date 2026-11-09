// M2f 辅助对话（sidechat）IPC 面——拆分面（同 provider-key-inject 先例）：实现从 agent-runner.ts
// 搬来本轻模块，装配根按原路径继续导出，调用方零改动。
// 独立会话：own JSONL 文件组 + own loop + own 上下文；写向工具从工具表摘除（只读白名单硬闸）。
// 主会话零打扰：sidechat 只读主会话 JSONL，永不 append 它（唯一写主会话的路径是用户显式 /promote）。
// 本模块不反向依赖装配根：它需要装配根的三处活状态（事件推送、最近 run 日志、当前工作区），
// 由装配根启动时 `setSidechatHandlerDeps` 注入（同 settings-handlers 的 `setSettingsHostDeps` 形态）。
import type { AgentEvent } from "../events";
import type { Summarizer } from "../agent/compaction";
import { createSessionSummarizer } from "../agent/session-provider";
import { promoteToMain, runSidechatTurn, type SidechatModel } from "../agent/sidechat";
import { isEventRef, type EventRef } from "../events";
import { glob } from "../tools/glob";
import { grep } from "../tools/grep";
import { read_file } from "../tools/read_file";
import type { Tool } from "../tools";
import { evaluate } from "../permissions";
import { gatedTool, readOnlyGateSession } from "./tool-gates";
import type { SidechatPanelSnapshot } from "./ipc-protocol";
import {
  createSidechatSession, listSidechatSessions, pathOf, readSessionEvents, readSidechatEvents,
  sessionExists, sidechatDir, sidechatEventsPath, workspaceOfSessionsRoot,
} from "./sessions";
import { getSessionsDir, requireSessionsDir, resolveSessionRoot } from "./session-handlers";
import { store } from "./settings-handlers";

export interface SidechatHandlerDeps {
  /** 事件推给壳（`hooks.onEvent` 的活转发：钩子可在首场 run 之后才注册/取消注册）。 */
  onEvent: (e: AgentEvent, logPath?: string) => void;
  /** 「最近一次 run 的日志路径」（装配根的可变状态，活读）。 */
  lastLogPath: () => string | null;
  /** 当前工作区（与 handleAgentRun 同一份解析）。 */
  currentWorkspace: () => Promise<string>;
}

let deps: SidechatHandlerDeps | null = null;
/** 装配根启动时注入（可重入：判卷 `vi.resetModules` 重组时按新装配根重注）。 */
export function setSidechatHandlerDeps(d: SidechatHandlerDeps): void {
  deps = d;
}
function D(): SidechatHandlerDeps {
  if (!deps) throw new Error("sidechat-handlers: 装配根未注入依赖（唯一入口 setSidechatHandlerDeps）");
  return deps;
}

// ---- M2f：辅助对话（sidechat）IPC 面 ----
// 独立会话：own JSONL 文件组 + own loop + own 上下文；写向工具从工具表摘除（只读白名单硬闸）。
// 主会话零打扰：sidechat 只读主会话 JSONL，永不 append 它（唯一写主会话的路径是用户显式 /promote）。

/** 选模型：CAIRN_API_KEY 在场 → GLM（createSidechatProvider 缺省）；否则 fail-closed。 */
function resolveSidechatModel(explicit?: SidechatModel): { model?: SidechatModel; error?: string } {
  if (explicit) return { model: explicit };
  if (process.env.CAIRN_API_KEY) return {}; // 缺省 = GLM 暗卷
  return { error: "无 CAIRN_API_KEY：sidechat 真实模型不可用（fail-closed，可注入脚本模型）" };
}

/** M2g §7.5：sidechat 自身历史压缩用的摘要器（与主会话**同一实现**，参数独立配置）。
 *  CAIRN_API_KEY → GLM；否则 undefined（走既有 overflow 紧急截断）。 */
function resolveSidechatSummarizer(): ReturnType<typeof createSessionSummarizer> | undefined {
  if (process.env.CAIRN_API_KEY) return createSessionSummarizer();
  return undefined;
}

/** sidechat 的显式只读执行面（三条白名单；lsp 见 `SIDECHAT_TOOL_WHITELIST` 的理由）。
 *
 *  为什么不能让它继续用全局 `TOOLS`：sidechat 不跑 runAgent、没有 run scope，于是
 *  ① 首场主 run **之前**，`TOOLS` 还是未包装的裸实现 ⇒ 敏感路径判据一次也不跑；
 *  ② 首场之后，`TOOLS` 已被 installAppTools 换成 `gatedTool` 闭包 ⇒ 侧聊每次读都撞
 *     「工具门未接线（fail-closed）」。同一间旁路，前后两种错法。
 *  这里从**原始实现**建表，并显式带一份只读门会话（规则库照载、无审批门）：
 *  不借主会话档位、也不随主会话安装时序变化。 */
function sidechatToolTable(workspace: string): {
  tools: Record<string, Tool>;
  atRefGate: (ref: string) => boolean;
} {
  const session = readOnlyGateSession(workspace);
  return {
    tools: {
      read_file: gatedTool("read_file", read_file, undefined, undefined, session),
      grep: gatedTool("grep", grep, undefined, undefined, session),
      glob: gatedTool("glob", glob, undefined, undefined, session),
    },
    // @ 引用不是工具调用：用同一只读会话跑 evaluate，项目 deny/敏感路径都在这里生效。
    // 「需要问人」在旁路没有审批门 ⇒ 等同拒绝（与 gatedTool 的 fail-closed 同口径）。
    atRefGate: (ref) => evaluate("read_file", { path: ref }, session.autonomy).verdict === "approve",
  };
}

export async function handleSidechatCreate(parentSessionId: string, name?: string): Promise<{ id: string }> {
  return { id: await createSidechatSession(requireSessionsDir(), parentSessionId, name) };
}

/** 跑一轮 sidechat（own loop）。事件只落 sidechat 自己的 JSONL；主会话文件字节不变。 */
export async function handleSidechatAsk(
  sidechatId: string,
  message: string,
  over: { parentSessionId?: string; model?: SidechatModel; summarizer?: Summarizer; onEvent?: (e: AgentEvent) => void } = {},
): Promise<{ ok: boolean; error?: string; events?: AgentEvent[] }> {
  try {
    const dir = requireSessionsDir();
    const parentId = over.parentSessionId ?? (await store().get()).currentSession ?? "";
    const picked = resolveSidechatModel(over.model);
    if (picked.error) return { ok: false, error: picked.error };
    // 旁路的工作区必须跟**父会话**走。旧实现用 `currentWorkspace()`（= 最近一次 run 的工作区）：
    // 在 B 打开会话却没在 B 跑过 run 时，规则库、@ 引用与投影仍读 A——一个项目的问题被另一个
    // 项目的文件回答。父会话根由宿主解析器给出（单例形态缺省就是唯一根）；解析不到 = 显式失败。
    let workspace = await D().currentWorkspace();
    let mainLogPath = parentId !== "" ? pathOf(dir, parentId) : (D().lastLogPath() ?? "");
    if (parentId !== "") {
      const root = await resolveSessionRoot(parentId);
      if (root === null || !(await sessionExists(root, parentId))) {
        return { ok: false, error: `父会话不存在: ${parentId}` };
      }
      const derivedWorkspace = workspaceOfSessionsRoot(root);
      if (derivedWorkspace === null) {
        return { ok: false, error: `父会话根不是标准 <workspace>/.agent/sessions 布局，拒绝猜测工作区: ${root}` };
      }
      workspace = derivedWorkspace;
      mainLogPath = pathOf(root, parentId);
    }
    // 规则库读不出/解析不了 ⇒ readOnlyGateSession 抛错，这一轮显式失败（fail-closed）。
    const face = sidechatToolTable(workspace);
    const events = await runSidechatTurn({
      sidechatDir: sidechatDir(dir, sidechatId),
      mainLogPath,
      workspace,
      tools: face.tools,
      atRefGate: face.atRefGate,
      message,
      ...(picked.model ? { model: picked.model } : {}),
      ...(over.summarizer ? { summarizer: over.summarizer } : { summarizer: resolveSidechatSummarizer() }),
      onEvent: (e) => over.onEvent?.(e),
    });
    return { ok: true, events };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** /promote：sidechat 结论 → 主会话一条 user_message（带 origin）；过输出扫描。 */
export async function handleSidechatPromote(req: {
  sidechatId: string;
  parentSessionId: string;
  sourceEventIds: number[];
  sourceEventRefs?: EventRef[];
  note?: string;
  content?: string;
}): Promise<{ ok: boolean; error?: string; event?: AgentEvent }> {
  try {
    const hasIds = Array.isArray(req.sourceEventIds) && req.sourceEventIds.length > 0;
    const hasRefs = req.sourceEventRefs !== undefined && req.sourceEventRefs.length > 0;
    if (hasIds && hasRefs) return { ok: false, error: "promote: 数字 id 与来源引用不能混用（歧义 fail closed）" };
    if (hasRefs && !req.sourceEventRefs!.every((ref) => isEventRef(ref))) {
      return { ok: false, error: "promote: 来源引用形状非法" };
    }
    const dir = requireSessionsDir();
    // 提升是**写主会话**：必须落父会话自己的根。用单例根会在启动工作区造一条同 id 幽灵会话，
    // 真父会话里看不到这次提升（2026-10-21 独立评审实测）。
    const root = await resolveSessionRoot(req.parentSessionId);
    if (root === null || !(await sessionExists(root, req.parentSessionId))) {
      return { ok: false, error: `父会话不存在: ${req.parentSessionId}` };
    }
    const mainLogPath = pathOf(root, req.parentSessionId);
    const res = await promoteToMain({
      mainLogPath,
      sidechatLogPath: sidechatEventsPath(dir, req.sidechatId),
      sidechatId: req.sidechatId,
      sourceEventIds: req.sourceEventIds,
      ...(req.sourceEventRefs !== undefined ? { sourceEventRefs: req.sourceEventRefs } : {}),
      ...(req.note !== undefined ? { note: req.note } : {}),
      ...(req.content !== undefined ? { content: req.content } : {}),
    });
    if (!res.ok) return { ok: false, error: res.error };
    // 上屏：主会话活流（renderer 渲染为 promote 卡）
    if (res.event) D().onEvent(res.event, mainLogPath);
    return { ok: true, event: res.event };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** sidechat 面板快照（纯投影）：会话清单 + 各自最近消息 + 已提升记录（由主会话 origin 反向投影）。 */
export async function handleSidechatState(parentSessionId?: string): Promise<SidechatPanelSnapshot> {
  const dir = getSessionsDir();
  if (!dir) return { parentSessionId: null, sessions: [], promoted: [] };
  const parent = parentSessionId ?? (await store().get()).currentSession ?? null;
  const infos = await listSidechatSessions(dir, parent ?? undefined);
  const sessions = [] as SidechatPanelSnapshot["sessions"];
  for (const info of infos) {
    let events: AgentEvent[] = [];
    try {
      events = await readSidechatEvents(dir, info.id);
    } catch {
      events = [];
    }
    const messages: SidechatPanelSnapshot["sessions"][number]["messages"] = [];
    let usage = { inputTokens: 0, outputTokens: 0, usageCount: 0, compactionCount: 0 };
    events.forEach((e, i) => {
      if (e.type === "user_message") messages.push({ eventId: i + 1, role: "user", text: e.content });
      else if (e.type === "assistant_message") messages.push({ eventId: i + 1, role: "assistant", text: e.content });
      else if (e.type === "usage") {
        usage.inputTokens += e.inputTokens;
        usage.outputTokens += e.outputTokens;
        usage.usageCount++;
      } else if (e.type === "compaction") usage.compactionCount++;
    });
    sessions.push({ id: info.id, parentId: info.parentId, lines: info.lines, mtimeMs: info.mtimeMs, messages, usage });
  }
  // 已提升：主会话里带 origin 的 user_message（反向投影，零新增事件类型）
  const promoted: SidechatPanelSnapshot["promoted"] = [];
  if (parent) {
    try {
      // 已提升记录的来源是父会话的根（可能是另一个项目）；找不到才退回单例根。
      const root = await resolveSessionRoot(parent).catch(() => null);
      const parentRoot = root !== null && (await sessionExists(root, parent).catch(() => false)) ? root : dir;
      const mainEvents = await readSessionEvents(parentRoot, parent);
      mainEvents.forEach((e, i) => {
        // 只投影 sidechat 提升记录；goal 续跑轮不是"提升"，它的面在 goal 芯片里。
        if (e.type === "user_message" && e.origin?.kind === "sidechat") {
          promoted.push({
            eventId: i + 1,
            sessionId: e.origin.session_id,
            sourceEventIds: e.origin.source_event_ids,
            ...(e.origin.note !== undefined ? { note: e.origin.note } : {}),
          });
        }
      });
    } catch {
      /* 主会话不存在：无已提升记录 */
    }
  }
  return { parentSessionId: parent, sessions, promoted };
}

