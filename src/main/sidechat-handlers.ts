// M2f 辅助对话（sidechat）IPC 面——拆分面（同 provider-key-inject 先例）：实现从 agent-runner.ts
// 搬来本轻模块，装配根按原路径继续导出，调用方零改动。
// 独立会话：own JSONL 文件组 + own loop + own 上下文；写向工具从工具表摘除（只读白名单硬闸）。
// 主会话零打扰：sidechat 只读主会话 JSONL，永不 append 它（唯一写主会话的路径是用户显式 /promote）。
// 本模块不反向依赖装配根：它需要装配根的三处活状态（事件推送、最近 run 日志、当前工作区），
// 由装配根启动时 `setSidechatHandlerDeps` 注入（同 settings-handlers 的 `setSettingsHostDeps` 形态）。
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "../events";
import { createMockSummarizer, type Summarizer } from "../agent/compaction";
import { createGlmSummarizer } from "../agent/glm-session";
import { promoteToMain, runSidechatTurn, scriptedSidechatModel, type SidechatModel } from "../agent/sidechat";
import type { SidechatPanelSnapshot } from "./ipc-protocol";
import {
  createSidechatSession, listSidechatSessions, pathOf, readSessionEvents, readSidechatEvents,
  sidechatDir, sidechatEventsPath,
} from "./sessions";
import { getSessionsDir, requireSessionsDir } from "./session-handlers";
import { store } from "./settings-handlers";

export interface SidechatHandlerDeps {
  /** 事件推给壳（`hooks.onEvent` 的活转发：钩子可在首场 run 之后才注册/取消注册）。 */
  onEvent: (e: AgentEvent) => void;
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

/** 演示剧本落点（装配根时是 `join(DEMO_DIR, "sidechat-demo.jsonl")`；本模块自带同一份式子）。 */
const SIDECHAT_DEMO_FIXTURE = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "fixtures", "demo", "sidechat-demo.jsonl");

// ---- M2f：辅助对话（sidechat）IPC 面 ----
// 独立会话：own JSONL 文件组 + own loop + own 上下文；写向工具从工具表摘除（只读白名单硬闸）。
// 主会话零打扰：sidechat 只读主会话 JSONL，永不 append 它（唯一写主会话的路径是用户显式 /promote）。

/** M2F_SIDECHAT_DEMO 演示剧本（env 门控；缺省零行为）——截图/演示用，不进验收链。
 *  M2g：剧本外置为 fixtures/demo/sidechat-demo.jsonl（冻结 sha 在 scripts/frozen-demo-sha256.json）；
 *  读不到时回退这份内联常量并告警（fail-visible，不静默换剧本）。 */
const SIDECHAT_DEMO_INLINE = [
  {
    type: "assistant_message",
    content:
      "旁路只读调查（不改主会话）：我读了 src/agent/loop.ts 与 src/agent/context.ts。" +
      "结论：runLoop 的上下文来自 projectContext(seen) 投影，压缩只产出 compaction 事件、事件流零删改（loop.ts:67 / context.ts:46）。",
  },
] as Parameters<typeof scriptedSidechatModel>[0];

function sidechatDemoScript(): ReturnType<typeof scriptedSidechatModel> {
  let script: Parameters<typeof scriptedSidechatModel>[0] = SIDECHAT_DEMO_INLINE;
  try {
    const raw = readFileSync(SIDECHAT_DEMO_FIXTURE, "utf8");
    const parsed = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as Parameters<typeof scriptedSidechatModel>[0][number]);
    if (parsed.length > 0) script = parsed;
  } catch (err) {
    console.warn("[sidechat] 演示剧本读取失败，回退内联常量:", err instanceof Error ? err.message : String(err));
  }
  return scriptedSidechatModel(script);
}

/** 选模型：CAIRN_API_KEY 在场 → GLM（createSidechatProvider 缺省）；演示通道 → 脚本；否则 fail-closed。 */
function resolveSidechatModel(explicit?: SidechatModel): { model?: SidechatModel; error?: string } {
  if (explicit) return { model: explicit };
  if (process.env.CAIRN_API_KEY) return {}; // 缺省 = GLM 暗卷
  if (process.env.M2F_SIDECHAT_DEMO === "1") return { model: sidechatDemoScript() };
  return { error: "无 CAIRN_API_KEY：sidechat 真实模型不可用（fail-closed，可注入脚本模型）" };
}

/** M2g §7.5：sidechat 自身历史压缩用的摘要器（与主会话**同一实现**，参数独立配置）。
 *  CAIRN_API_KEY → GLM；演示通道 → 冻结 mock；都没有 → undefined（走既有 overflow 紧急截断）。 */
function resolveSidechatSummarizer(): ReturnType<typeof createGlmSummarizer> | undefined {
  if (process.env.CAIRN_API_KEY) return createGlmSummarizer();
  if (process.env.M2F_SIDECHAT_DEMO === "1") {
    return createMockSummarizer("## Objective\n- 旁路会话自身历史压缩（演示通道，冻结摘要）。\n");
  }
  return undefined;
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
    const mainLogPath = parentId !== "" ? pathOf(dir, parentId) : (D().lastLogPath() ?? "");
    const picked = resolveSidechatModel(over.model);
    if (picked.error) return { ok: false, error: picked.error };
    const events = await runSidechatTurn({
      sidechatDir: sidechatDir(dir, sidechatId),
      mainLogPath,
      workspace: await D().currentWorkspace(),
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
  note?: string;
  content?: string;
}): Promise<{ ok: boolean; error?: string; event?: AgentEvent }> {
  try {
    const dir = requireSessionsDir();
    const mainLogPath = pathOf(dir, req.parentSessionId);
    const res = await promoteToMain({
      mainLogPath,
      sidechatLogPath: sidechatEventsPath(dir, req.sidechatId),
      sidechatId: req.sidechatId,
      sourceEventIds: req.sourceEventIds,
      ...(req.note !== undefined ? { note: req.note } : {}),
      ...(req.content !== undefined ? { content: req.content } : {}),
    });
    if (!res.ok) return { ok: false, error: res.error };
    // 上屏：主会话活流（renderer 渲染为 promote 卡）
    if (res.event) D().onEvent(res.event);
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
      const mainEvents = await readSessionEvents(dir, parent);
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

/** M2F_SIDECHAT_DEMO=1：主 run 收束后跑 3 轮 sidechat + 一次 promote（截图/演示通道，缺省零行为）。 */
export async function runSidechatDemo(sessionId: string | undefined, parentLogPath: string, pipeline: (e: AgentEvent) => Promise<void>): Promise<void> {
  try {
    const dir = requireSessionsDir();
    const parentId = sessionId ?? (await store().get()).currentSession ?? "demo";
    const id = await createSidechatSession(dir, parentId, "旁路调查");
    const questions = [
      "主会话现在在改哪个文件？",
      "压缩之后上下文是怎么重组的？",
      "总结一句可提升的结论。",
    ];
    for (const q of questions) {
      await handleSidechatAsk(id, q, { parentSessionId: parentId, model: sidechatDemoScript() });
    }
    const events = await readSidechatEvents(dir, id);
    const lastAssistant = [...events.keys()].filter((i) => events[i].type === "assistant_message").pop();
    if (lastAssistant !== undefined) {
      const res = await promoteToMain({
        mainLogPath: parentLogPath,
        sidechatLogPath: sidechatEventsPath(dir, id),
        sidechatId: id,
        sourceEventIds: [lastAssistant + 1],
        note: "旁路结论提升（演示）",
      });
      if (res.ok && res.event) await pipeline(res.event);
    }
  } catch (err) {
    console.warn("[sidechat] 演示通道失败:", err instanceof Error ? err.message : String(err));
  }
}
