// diff 卡的行级评审写端：「评」→ card_action(comment) → main 注入 worker 子流。
// 读端（评论上屏）在 renderer-merge-review.test.ts；这一份判的是三件容易各自漂移的事：
// ① 补丁按文件切段（行号是每文件各自的，挂错文件比不评论更坏）；
// ② 载荷只组形状、合法性归 main（两份规则必然漂移）；
// ③ 回条三面如实说——尤其 injected=false（只落流、它已不再读）绝不说成「已送进子流」。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { cardActionForComment, parsePatchFiles } from '../src/renderer/projections';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

/* ---------- ① 补丁切段 ---------- */

const twoFiles = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  ' const keep = 1',
  '-const old = 2',
  '+const next = 2',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -40,0 +41,2 @@',
  '+export const x = 1',
  '+export const y = 2',
].join('\n');

it('多文件补丁按文件切段（切段不过滤：每段含自己的文件头行）', () => {
  const segs = parsePatchFiles(twoFiles);
  expect(segs.map(s => s.path)).toEqual(['src/a.ts', 'src/b.ts']);
  expect(segs[1].lines.map(l => l.text)).toEqual([
    'diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts',
    '@@ -40,0 +41,2 @@', '+export const x = 1', '+export const y = 2',
  ]);
});

it('新文件侧行号逐段独立：b.ts 的 + 行是 41、42，不接在 a.ts 后面', () => {
  const segs = parsePatchFiles(twoFiles);
  // 文件头 +++ 也以 + 开头，但它没有新文件侧行号（parsePatchLines 已判）——界面据 newLine 给不给按钮
  expect(segs[0].lines.filter(l => l.text.startsWith('+') && l.newLine !== null).map(l => l.newLine)).toEqual([2]);
  expect(segs[1].lines.filter(l => l.text.startsWith('+') && l.newLine !== null).map(l => l.newLine)).toEqual([41, 42]);
});

it('两份文件头不一致时以 +++ 为准（unified 规范里新文件侧的权威是 +++，diff --git 只是 git 的扩展行）', () => {
  const segs = parsePatchFiles([
    'diff --git a/old.ts b/old.ts',
    'rename from old.ts',
    'rename to new.ts',
    '--- a/old.ts',
    '+++ b/new.ts',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  ].join('\n'));
  expect(segs).toHaveLength(1);
  expect(segs[0].path).toBe('new.ts');
});

it('没有 +++ 头时退回 diff --git 的 b/ 侧（二进制段就是这个形状）', () => {
  const segs = parsePatchFiles('diff --git a/img/x.png b/img/y.png\nBinary files a/img/x.png and b/img/y.png differ\n');
  expect(segs).toHaveLength(1);
  expect(segs[0].path).toBe('img/y.png');
});

it('删除的文件（+++ /dev/null）不丢段，也没有新文件侧行号可评', () => {
  const segs = parsePatchFiles([
    'diff --git a/gone.ts b/gone.ts',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-const x = 1',
    '-const y = 2',
  ].join('\n'));
  expect(segs).toHaveLength(1);
  expect(segs[0].path).toBe('gone.ts');
  expect(segs[0].lines.filter(l => l.newLine !== null), '删除行不该被编出一个新行号').toEqual([]);
});

it('光秃秃的 hunk（没有文件头）成一段空 path——界面据此不给评论入口', () => {
  const segs = parsePatchFiles('@@ -1 +1 @@\n-a\n+b');
  expect(segs).toHaveLength(1);
  expect(segs[0].path).toBe('');
  expect(segs[0].lines).toHaveLength(3);
  // 行号确实存在（+b 是第 1 行），但 path 空 ⇒ 不给出口：挂到无名文件上的评论无处可查
  expect(segs[0].lines[2].newLine).toBe(1);
});

it('整段没有文件头时只切一段，不逐行造段（每行一段 = 假的可评面）', () => {
  const segs = parsePatchFiles('plain text without headers\nsecond line');
  expect(segs).toHaveLength(1);
  expect(segs[0].lines).toHaveLength(2);
});

it('末行换行不额外造段，也不丢行（split 出来的空尾行归在同一段里）', () => {
  const withTail = parsePatchFiles('@@ -1 +1 @@\n-a\n+b\n');
  expect(withTail).toHaveLength(1);
  expect(withTail[0].lines.map(l => l.text)).toEqual(['@@ -1 +1 @@', '-a', '+b', '']);
});

/* ---------- ② 载荷只组形状 ---------- */

it('cardActionForComment 组出 main 要的四面，且不判合法性', () => {
  expect(cardActionForComment('wt-7', 'src/a.ts', 12, '')).toEqual({
    cardId: 'diff:wt-7', sourceEventId: 0, cardType: 'diff', action: 'comment',
    payload: { path: 'src/a.ts', line: 12, body: '' }, scope: 'once', targetAgentId: 'wt-7',
  });
});

it('diff_comment 在面板脏集里（送出去的评论不当场回画 = 用户点了没反应）', () => {
  const m = /const PANEL_DIRTY = \{([^}]*)\};/.exec(source);
  expect(m, "PANEL_DIRTY 字面量形状变了：本判据要跟着改，不许静默通过").not.toBeNull();
  expect(m![1], 'diff_comment 必须进脏集').toContain('diff_comment:');
});

/* ---------- ③ 桥：三面回条 ---------- */

function fakeEl(id: string): any {
  return {
    id, hidden: true, textContent: '', value: '', focused: false,
    listeners: {} as Record<string, ((e: any) => void)[]>,
    dataset: {} as Record<string, string>,
    addEventListener(type: string, fn: (e: any) => void) { (this.listeners[type] ||= []).push(fn); },
    focus() { this.focused = true; },
    contains() { return false; },
    setAttribute() {},
    fire(type: string, e: any = {}) { (this.listeners[type] || []).forEach((f: (ev: any) => void) => f(e)); },
  };
}

/** 只装载桥那一段（IIFE 内的一块，切片测法与定时面板同源）。 */
function loadBridge(reply: unknown, rows: Record<string, string> = { path: 'src/a.ts', line: '12' }) {
  const els: Record<string, any> = {};
  for (const id of ['cmtPop', 'cmtHead', 'cmtBody', 'cmtErr']) els[id] = fakeEl(id);
  const toasts: string[] = [];
  const cardAction = vi.fn(async () => reply);
  const ctx: any = {
    $: (sel: string) => els[sel.replace('#', '')],
    registerPop: (popEl: any, chipEl: any) => ({ popEl, chipEl }),
    closeAllPops: () => { for (const k of Object.keys(els)) els[k].hidden = true; },
    showPop: (popEl: any) => { popEl.hidden = false; },
    toast: (s: string) => toasts.push(s),
    cardActionForComment,
    api: { cardAction },
  };
  const a = source.indexOf('  /* ---------- diff 卡行级评审');
  const b = source.indexOf('  /* 目标态镜像：showHistory 全量筛', a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  // 起点标记必须唯一：同前缀的第二处（比如一段指路注释）会让 indexOf 落在更早的那一处，
  // 切片悄悄撑大 ⇒ 测的就不再是这一段（本仓的「marker 漂移」形状）。
  expect(source.indexOf('  /* ---------- diff 卡行级评审', a + 1), '起点标记出现两次').toBe(-1);
  runInNewContext(source.slice(a, b), ctx);
  const btn = {
    closest: (sel: string) => (sel === '.ln-row' ? { dataset: rows } : sel === '.merge-col' ? { dataset: { agent: 'wt-7' } } : null),
    setAttribute() {}, contains: () => true,
  };
  return {
    ctx, els, toasts, cardAction,
    open: () => ctx.openCommentPop(btn),
    submit: async () => { els.cmtPop.fire('submit', { preventDefault() {} }); await new Promise((r) => setTimeout(r, 0)); },
  };
}

it('坐标齐 ⇒ 弹框、点名「评哪个文件的哪一行 → 哪个 worker」、发一次 card_action', async () => {
  const t = loadBridge({ ok: true, injected: true });
  t.open();
  expect(t.els.cmtPop.hidden).toBe(false);
  expect(t.els.cmtHead.textContent).toBe('评 src/a.ts 第 12 行 → wt-7');
  expect(t.els.cmtBody.focused, '弹完不聚焦 = 键盘用户还得自己找过去').toBe(true);
  await t.submit();
  expect(t.cardAction).toHaveBeenCalledWith({
    cardId: 'diff:wt-7', sourceEventId: 0, cardType: 'diff', action: 'comment',
    payload: { path: 'src/a.ts', line: 12, body: '' }, scope: 'once', targetAgentId: 'wt-7',
  });
  expect(t.toasts.join('\n')).toContain('已送进 wt-7 的子流');
});

it('行上没带 path ⇒ 不弹框、不发请求（宁可不给入口）', async () => {
  const t = loadBridge({ ok: true, injected: true }, { path: '', line: '12' });
  t.open();
  expect(t.els.cmtPop.hidden, '缺坐标还弹框 = 送出一条必然撞墙的请求').toBe(true);
  expect(t.toasts.join('\n')).toContain('评审框不弹');
  await t.submit();
  expect(t.cardAction).not.toHaveBeenCalled();
});

it('行号不是整数 ⇒ 同样不弹（line 0 与非数字都是必然拒的单）', () => {
  for (const line of ['0', 'x']) {
    const t = loadBridge({ ok: true, injected: true }, { path: 'src/a.ts', line });
    t.open();
    expect(t.els.cmtPop.hidden).toBe(true);
  }
});

it('main 拒（ok:false）⇒ 判因原样回显成未送达，不说送达', async () => {
  const t = loadBridge({ ok: false, error: 'comment 需要 payload{path, line>=1, body 非空}' });
  t.open();
  await t.submit();
  expect(t.els.cmtErr.hidden).toBe(false);
  expect(t.els.cmtErr.textContent).toContain('comment 需要 payload{path, line>=1, body 非空}');
  expect(t.toasts.join('\n')).not.toContain('已送进');
  expect(t.els.cmtPop.hidden, '被拒不收起弹框：让用户能改完再发').toBe(false);
});

it('injected=false ⇒ 说「只落进事件流、它已不再读」，绝不写成已送达', async () => {
  const t = loadBridge({ ok: true, injected: false, error: 'worker 已终态且 worktree 已收尾，评论仅落流（不注入）' });
  t.open();
  await t.submit();
  const all = t.toasts.join('\n');
  expect(all).toContain('只落进了事件流');
  expect(all).toContain('worker 已终态且 worktree 已收尾');
  expect(all).not.toContain('已送进 wt-7 的子流');
});

it('通道抛错也走未送达，不静默', async () => {
  const t = loadBridge({ ok: true, injected: true });
  t.cardAction.mockRejectedValueOnce(new Error('IPC 通道未接'));
  t.open();
  await t.submit();
  expect(t.els.cmtErr.textContent).toContain('IPC 通道未接');
});
