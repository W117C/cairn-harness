// Read-only historical projection. Keep data, not detached DOM trees.
export function projectHistory(events) {
  const rows = [];
  const calls = new Map();
  let pending = null;
  for (const e of events) {
    if (e.type === 'assistant_delta') {
      if (!pending) { pending = { kind: 'ai', text: '' }; rows.push(pending); }
      pending.text += e.text || '';
      continue;
    }
    if (e.type === 'assistant_message') {
      if (pending) pending.text = e.content || pending.text;
      else rows.push({ kind: 'ai', text: e.content || '' });
      pending = null;
      continue;
    }
    if (e.type === 'usage' || e.type === 'session_meta') continue;
    pending = null;
    if (e.type === 'user_message') rows.push({ kind: 'user', text: e.content || '（来自 sidechat 提升）' });
    else if (e.type === 'tool_call') {
      const row = { kind: 'tool', text: String(e.name || 'tool'), detail: JSON.stringify(e.args ?? {}, null, 2), result: null, ok: null };
      rows.push(row);
      calls.set(e.id || e.callId, row);
    } else if (e.type === 'tool_result') {
      const row = calls.get(e.callId || e.id);
      if (row) { row.result = String(e.output ?? ''); row.ok = !!e.ok; calls.delete(e.callId || e.id); }
      else rows.push({ kind: 'record', text: '工具结果', detail: String(e.output ?? '') });
    } else {
      // Historical records never re-run approval handlers, toasts, or usage accounting.
      rows.push({ kind: 'record', text: e.type, detail: JSON.stringify(e, null, 2) });
    }
  }
  return rows;
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

export function mountHistory({ container, scroller, rows, renderRow }) {
  const doc = container.ownerDocument;
  // Native anchoring competes with our measured-height anchor when recycling rows.
  const previousAnchor = scroller.style.overflowAnchor;
  scroller.style.overflowAnchor = 'none';
  const spacer = () => { const d = doc.createElement('div'); d.setAttribute('aria-hidden', 'true'); d.style.flexShrink = '0'; return d; };
  const before = spacer(), after = spacer();
  container.append(before, after);
  const heights = rows.map(() => 120);
  let offsets = [], mounted = new Map(), frame = 0, disposed = false;
  const rebuild = () => { offsets = [0]; for (const h of heights) offsets.push(offsets[offsets.length - 1] + h); };
  rebuild();
  const origin = () => before.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(draw); };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  function draw() {
    frame = 0;
    if (disposed) return;
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
    before.style.height = offsets[range.start] + 'px';
    after.style.height = (offsets[rows.length] - offsets[range.end]) + 'px';
    let next = after;
    for (let i = range.end - 1; i >= range.start; i--) {
      let node = mounted.get(i);
      if (!node) {
        node = renderRow(rows[i], i);
        node.style.margin = '0 0 12px';
        node.style.flexShrink = '0';
        mounted.set(i, node);
        observer?.observe(node);
      }
      if (node.nextSibling !== next) container.insertBefore(node, next);
      next = node;
    }
    scroller.scrollTop = correctedTop;
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
