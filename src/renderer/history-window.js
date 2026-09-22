// Read-only historical projection. Keep data, not detached DOM trees.
// R1b B1：这里只做「展示单元」分组，不再认识渲染语义、也不再携带文本/JSON——
// 文本化与建节点统一由 app.js 的单一渲染器完成（依据 agent-plan §10.1 第 4 条前半句
// 「对话流是全部卡片的默认宿主」：同一事件流不得有第二套呈现）。

/**
 * 事件流 → 展示单元。unit.ids 是该单元覆盖的事件下标。
 * 三类单元：user（一条用户消息）/ turn（一段模型正文 + 其后跟随的工具与验证，
 * 与 live 的「工具组嵌进当前 ai 消息」同构）/ card（其余单事件，各自一条）。
 * 合并条件：流序上紧邻 + 同 agent 桶 + 同类；且 turn 内的第二条模型消息另起单元
 * （live 里 assistant_message 会收束正文壳，见 app.js 的 aiTextMsg/finalizeAi）。
 * worker 子流的执行细节**不进主对话流**（§4.4.4）：与 live 的 renderEvent 问同一句
 * （entersMainConversation，projections.ts），否则同一份流刷新前藏在父泡里、刷新后
 * 凭空长出一排单元——两支必须同源，不然「第二套呈现」以时序差的形式回来。
 */
import { entersMainConversation } from './projections';

const AI_TEXT_TYPES = new Set(["assistant_message", "assistant_delta"]);
const TOOL_TYPES = new Set(["tool_call", "tool_result", "verify_result"]);

export function projectUnits(events) {
  const units = [];
  events.forEach((e, i) => {
    if (e.type === "usage" || e.type === "session_meta") return;
    if (!entersMainConversation(e)) return;
    const agent = typeof e.agent_id === "string" && e.agent_id !== "" ? e.agent_id : "main";
    const prev = units[units.length - 1];
    if (e.type === "user_message") {
      units.push({ key: agent + "|user", kind: "user", ids: [i] });
      return;
    }
    if (AI_TEXT_TYPES.has(e.type) || TOOL_TYPES.has(e.type)) {
      const joinable = prev && prev.kind === "turn" && prev.agent === agent
        && !(AI_TEXT_TYPES.has(e.type) && prev.textClosed);
      if (joinable) {
        prev.ids.push(i);
        if (e.type === "assistant_message") prev.textClosed = true;
        return;
      }
      units.push({ key: agent + "|turn", kind: "turn", agent, ids: [i], textClosed: e.type === "assistant_message" });
      return;
    }
    units.push({ key: agent + "|card", kind: "card", ids: [i] });
  });
  return units.map(({ key, kind, ids }) => ({ key, kind, ids }));
}

export function windowRange(offsets, top, height, overscan = 500, max = 80) {
  const n = offsets.length - 1;
  const locate = value => {
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (offsets[mid + 1] <= value) lo = mid + 1; else hi = mid; }
    return Math.min(lo, Math.max(0, n - 1));
  };
  if (!n) return { start: 0, end: 0 };
  const start = locate(Math.max(0, top - overscan));
  return { start, end: Math.min(n, start + max, locate(top + height + overscan) + 1) };
}

export function mountHistory({ container, scroller, units, renderUnit }) {
  const doc = container.ownerDocument;
  // Native anchoring competes with our measured-height anchor when recycling rows.
  const previousAnchor = scroller.style.overflowAnchor;
  scroller.style.overflowAnchor = 'none';
  const spacer = () => { const d = doc.createElement('div'); d.setAttribute('aria-hidden', 'true'); d.style.flexShrink = '0'; return d; };
  const before = spacer(), after = spacer();
  container.append(before, after);
  const heights = units.map(() => 120);
  let offsets = [], mounted = new Map(), frame = 0, disposed = false;
  const rebuild = () => { offsets = [0]; for (const h of heights) offsets.push(offsets[offsets.length - 1] + h); };
  rebuild();
  const origin = () => before.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(draw); };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  function draw() {
    frame = 0;
    if (disposed) return;
    // 用户是否贴在底部：测高回修会改变总高度，若不记住这个状态，"打开会话落在末尾"
    // 会在第一次测高后被挪走（实测万条会话停在距底 88.5px，最后一条消息被切一半）。
    const wasAtBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 1;
    const base = origin(), top = Math.max(0, scroller.scrollTop - base);
    const anchor = windowRange(offsets, top, 0, 0).start;
    const oldAnchor = offsets[anchor] || 0;
    let changed = false;
    for (const [i, node] of mounted) {
      const h = node.getBoundingClientRect().height + 12;
      if (h > 12 && Math.abs(heights[i] - h) > 1) { heights[i] = h; changed = true; }
    }
    if (changed) rebuild();
    const correctedTop = scroller.scrollTop + (offsets[anchor] || 0) - oldAnchor;
    const range = windowRange(offsets, Math.max(0, correctedTop - base), scroller.clientHeight);
    for (const [i, node] of mounted) {
      if (i < range.start || i >= range.end) { observer?.unobserve(node); node.remove(); mounted.delete(i); }
    }
    let next = after;
    let nullUnit = false;
    for (let i = range.end - 1; i >= range.start; i--) {
      let node = mounted.get(i);
      if (!node) {
        node = renderUnit(units[i], i);
        // 渲染器交不出壳（那一格里没有任何可显示的东西）时按 0 高记账并跳过：一格的损失只能是自己，
        // 不能让整窗跟着死——旧写法在 node.style 上抛 TypeError，异常出在 rAF 回调里无人观测，
        // 循环从这里往前的全部单元都不再挂载（现象：贴底却只剩半截转录）。
        if (!node) { heights[i] = 0; nullUnit = true; continue; }
        node.style.margin = '0 0 12px';
        node.style.flexShrink = '0';
        mounted.set(i, node);
        observer?.observe(node);
      }
      if (node.nextSibling !== next) container.insertBefore(node, next);
      next = node;
    }
    // 占位高在挂载循环之后才算：循环里可能刚把某一格改判成 0 高。
    if (nullUnit) rebuild();
    before.style.height = offsets[range.start] + 'px';
    after.style.height = (offsets[units.length] - offsets[range.end]) + 'px';
    scroller.scrollTop = wasAtBottom ? scroller.scrollHeight : correctedTop;
    if (changed) schedule();
  }
  scroller.addEventListener('scroll', schedule, { passive: true });
  observer?.observe(scroller);
  draw();
  return {
    destroy() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      scroller.removeEventListener('scroll', schedule);
      for (const node of mounted.values()) node.remove();
      scroller.style.overflowAnchor = previousAnchor;
      mounted.clear(); before.remove(); after.remove();
    },
    refresh: schedule,
  };
}
