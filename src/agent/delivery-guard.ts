/** 「承诺了却没交付」的判据（能力 12：交付断言）。
 *
 *  立这一格的动机是一次**实测到两次**的假绿（2026-10-17，模型 deepseek-chat）：
 *  任务书要求「写 pelican.html」，模型的全部工具调用只有一次 `propose_plan`
 *  （files 里白纸黑字写着 `create pelican.html`），然后**再没有第二个 tool_call**——
 *  收尾消息却写着「已完成任务，生成了 pelican.html 文件」。工作区里那个文件**从来不存在**。
 *  三次机会（模型自觉 / 收束闸 / 落盘前）没有一格看到这件事：
 *  收束闸的触发条件是 `wroteThisRun`（`src/agent/loop.ts`），而这次 run 一个字节都没写
 *  ⇒ 验证被整段跳过，于是「没写」反而成了**唯一不会被验证的路径**。
 *  这比写错更坏：写错至少有字节可判，「没写」连判据都够不着，而收尾话术看起来一模一样。
 *
 *  这一格只做**判断**：把「答应了哪些文件」与「实际写了哪些」对起来，差集就是幽灵交付。
 *  事件凭据判据是纯函数；调用方可额外给工作区，让最终文件状态覆盖 shell 等未结构化写入。
 *
 *  刻意不做：
 *   - 不猜文件名。承诺集只取模型自己在 `propose_plan` 里报的那些（它有 `action: create`），
 *     不从收尾的自然语言里正则抠路径——那句话恰恰是最不可信的那一句。
 *   - 不判内容对不对（那是 verify 面的事），只判**在不在**。
 */
import type { AgentEvent } from "../events";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";

/** 交付断言那一拍的哨兵 callId（**没有**配对的 tool_call：它不是模型调的工具，
 *  是 harness 在收束那一刻落的证据）。
 *  为什么单独一枚、不与自动验证拍共用：两件事的处置完全不同
 *  （验证红⇒去改代码；幽灵交付⇒去补写文件或收回说法），共用一枚 id 等于说它们是一回事。
 *  常量住在本文件（纯叶子模块）而不是 loop：`context.ts` 也要读它，而 loop 反过来 import
 *  context ⇒ 放 loop 会当场造出一个依赖圈。 */
export const DELIVERY_GUARD_CALL_ID = "harness-delivery-guard";

export const EMPTY_RUN_DELIVERY =
  "[delivery] 这一轮没有工具调用，也没有收尾消息。请继续完成任务，或明确说明实际阻塞点。";

/** 一次承诺：模型在方案里说要造/改的文件的路径。 */
export interface DeliveryPromise {
  path: string;
  action: string;
}

/** worker 的事件发生在隔离 worktree；合并到主工作区前不能兑现主会话的交付承诺。 */
function isWorkerEvent(event: AgentEvent): boolean {
  return "agent_id" in event && typeof event.agent_id === "string" && event.agent_id.length > 0;
}

/** 从最新且获批的方案里读 `action: create` 文件。
 *  待审批、拒绝或超时方案不构成交付承诺；较新的方案取代旧方案。 */
export function promisedCreates(events: readonly AgentEvent[]): DeliveryPromise[] {
  let active: { callId: string; files: unknown; approved: boolean | null } | null = null;
  for (const e of events) {
    if (isWorkerEvent(e)) continue;
    if (e.type === "plan_proposed") {
      active = { callId: e.callId, files: e.plan.files, approved: null };
    } else if (e.type === "plan_approved" && active?.callId === e.callId) {
      active.approved = e.approved;
    } else if (e.type === "tool_result" && active?.callId === e.callId && active.approved === null) {
      // 兼容没有单独 plan_approved 事件的旧日志：propose_plan 只会 ok=true 地返回已批准结果。
      active.approved = e.ok;
    }
  }
  if (active?.approved !== true) return [];

  const out: DeliveryPromise[] = [];
  if (!Array.isArray(active.files)) return out;
  for (const f of active.files) {
    if (typeof f !== "object" || f === null) continue;
    const path = (f as { path?: unknown }).path;
    const action = (f as { action?: unknown }).action;
    if (typeof path !== "string" || path.trim() === "") continue;
    if (typeof action !== "string" || action !== "create") continue;
    if (normPath(path) === null) continue;
    out.push({ path, action });
  }
  return out;
}

/** 只接受工作区相对路径，并收敛斜杠与 `.` / `..` 片段。 */
function normPath(p: string): string | null {
  const value = p.trim().replace(/\\/g, "/");
  if (value === "" || value.startsWith("/") || /^[A-Za-z]:\//.test(value)) return null;
  const normalized = posix.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function addPath(paths: Set<string>, path: unknown): void {
  if (typeof path !== "string") return;
  const normalized = normPath(path);
  if (normalized !== null) paths.add(normalized);
}

/** 从事件流里读**实际落盘**的文件（纯函数，零 IO）。
 *  只认四类真实凭据，不认模型的自述：
 *   ① `tool_result` 上的 `artifact.path`（渲染/产物面回报）；
 *   ② `write_file` / `edit_file` 成功的 `tool_call.args.path`；
 *   ③ `tool_result.changedPaths` 给出的多文件写入路径；
 *   ④ `tool_result` 里带 `change: created|modified` 的那一条的配对调用路径。 */
export function deliveredPaths(events: readonly AgentEvent[]): Set<string> {
  const out = new Set<string>();
  const callPath = new Map<string, string>();
  for (const e of events) {
    if (isWorkerEvent(e)) continue;
    if (e.type === "tool_call") {
      const p = (e.args as { path?: unknown }).path;
      if (typeof p === "string" && (e.name === "write_file" || e.name === "edit_file")) {
        const normalized = normPath(p);
        if (normalized !== null) callPath.set(e.id, normalized);
      }
      continue;
    }
    if (e.type !== "tool_result") continue;
    const art = (e as { artifact?: { path?: unknown } }).artifact;
    if (e.ok === true && typeof art?.path === "string") addPath(out, art.path);
    if (e.ok === true) for (const p of e.changedPaths ?? []) addPath(out, p);
    // 写工具成功即视为落盘（`change` 是它的回执字段，有它更能确认，没有也不否认）
    const c = (e as { change?: unknown }).change;
    if (e.ok === true && (c === "created" || c === "modified")) {
      const p = callPath.get(e.callId);
      if (p !== undefined) addPath(out, p);
    }
  }
  return out;
}

export interface PhantomDelivery {
  /** 承诺了要新建、但整条 run 结束都没落盘的文件。 */
  missing: string[];
}

/** 缺省只保留当前用户轮次的主会话事件；统计并行开销时可保留本轮 worker 子流。
 * worker 的 user_message 不能开启父会话的新轮次。
 *
 * **轮中插话（`kind: "steering"`）也不算新轮次**（2026-10-23，第 9 点）：用户在 run 跑到一半时
 * 补的一句话，是插进**同一轮**的下一拍请求里的，不是重新发起任务。把它当成 run 起点会让
 * 它之前那一段的承诺与证据整段静默失效——那条判据本是交付断言/幽灵交付/空转/进化信号/
 * 收尾复核共同的轮界取料口，错一格就是**假绿**（实测形状见 `SteeringOrigin` 的注释）。
 *
 * 判据按 `kind` 分支，不用「content 里有没有某句话」这类文本启发式：后者在用户真的打出
 * 那句话时会把正常的新轮次判成插话。 */
export function eventsForCurrentRun(
  events: readonly AgentEvent[],
  options: { includeWorkers?: boolean } = {},
): AgentEvent[] {
  let start = 0;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.type === "user_message" && !isWorkerEvent(event) && !isSteeringMessage(event)) start = i;
  }
  const current = events.slice(start);
  return options.includeWorkers === true ? current : current.filter((event) => !isWorkerEvent(event));
}

/** 轮中插话的判定（单一出口）：消费端要问「这条开不开新轮」时只走这里，别各写一份 kind 比较。 */
export function isSteeringMessage(event: AgentEvent): boolean {
  return event.type === "user_message" && event.origin?.kind === "steering";
}

function existsInWorkspace(workspace: string, path: string): boolean {
  try {
    const root = realpathSync(workspace);
    const candidate = resolve(root, ...path.split("/"));
    const lexical = relative(root, candidate);
    if (lexical === "" || lexical === ".." || lexical.startsWith(".." + sep) || isAbsolute(lexical)) return false;
    const actual = realpathSync(candidate);
    const real = relative(root, actual);
    if (real === "" || real === ".." || real.startsWith(".." + sep) || isAbsolute(real)) return false;
    return statSync(actual).isFile();
  } catch {
    return false;
  }
}

/** 给模型与日志收口共用的诊断文案，不推断整轮是否改过其它文件。 */
export function describePhantomDelivery(phantom: PhantomDelivery): string {
  return "[delivery] 最新获批方案承诺创建的文件目前不存在：" + phantom.missing.join("、") + "。"
    + "请补齐这些文件；如果确实无法交付，说明实际阻塞点，不要把计划描述成已完成结果。";
}

/** 幽灵交付判定。除事件凭据外，可选地检查工作区里的最终文件状态，以覆盖 shell 等未结构化写工具。 */
export function findPhantomDelivery(
  events: readonly AgentEvent[],
  workspace?: string,
): PhantomDelivery | null {
  const current = eventsForCurrentRun(events);
  const promised = promisedCreates(current);
  if (promised.length === 0) return null;
  const delivered = deliveredPaths(current);
  const missing = [...new Set(promised.map((p) => normPath(p.path))
    .filter((p): p is string => p !== null
      && (workspace === undefined ? !delivered.has(p) : !existsInWorkspace(workspace, p))))];
  if (missing.length === 0) return null;
  return { missing };
}

export interface EmptyRun {
  /** 本轮的工具调用次数（0 = 一个工具都没调）。 */
  toolCalls: number;
}

/** 空转判定（纯函数）：本轮一个工具都没调，且没有正文 ⇒ 这轮什么都没做。
 *
 *  动机是区分「真的零输出」与「正常流式回答」：真 provider 主要落 `assistant_delta`，
 *  不能把非空 delta 当成没有正文。只有零工具且零非空正文时才算空转。
 *
 *  为什么不直接判「零 tool_call 就红」：只读问答（`clarify` 之类）本来就零工具，
 *  那是正常收束。所以只对**有工具面可用却一个都没用、且没收尾话**的那一类出声，
 *  并且措辞指向下一件该做的事，不替模型下结论。
 *
 *  **被截断的那一轮不算空转**（2026-10-17 实测抓到）：模型说话说到一半被收走时
 *  （`turn_truncated`，输出预算／内容策略），事件流上同样是零工具、零收尾消息，
 *  而那一轮模型**正在交付**——它只是没说完。把它判成空转，等于在最需要接着说下去的
 *  那一刻，给模型一句「你什么都没做」：既冤枉，又把下一轮引到错误的方向。
 *  所以这里显式排除它，让截断那一支按它自己的口径记账（见 `turn-truncated` 判卷）。 */
export function findEmptyRun(events: readonly AgentEvent[]): EmptyRun | null {
  const current = eventsForCurrentRun(events);
  let toolCalls = 0;
  let hasAssistantText = false;
  for (const e of current) {
    if (e.type === "tool_call") toolCalls++;
    else if (e.type === "assistant_message") hasAssistantText ||= e.content.trim() !== "";
    else if (e.type === "assistant_delta") hasAssistantText ||= e.text.trim() !== "";
    // 被截断的那一轮：模型**正在交付**，只是没说完。它同样「零工具零收尾」，
    // 但把「还没说完」判成「什么都没做」既冤枉又误导下一轮 ⇒ 显式让路给截断那一支。
    else if (e.type === "turn_truncated") return null;
  }
  // 收尾消息在最后一个 tool_call 之后 ⇒ 那是「做完之后的说明」，不是空转。
  if (toolCalls > 0) return null;
  if (hasAssistantText) return null;
  return { toolCalls };
}
