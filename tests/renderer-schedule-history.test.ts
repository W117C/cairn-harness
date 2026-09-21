// 运行历史的「按状态筛」（§12.2.6 六态筛选）：筛选器是这段面板缺的最后一块。
// 三条口径：① 筛由 main 做（Scheduler.filterHistory 一直是那条逻辑的主人，此前只有验收脚本在调）；
// ② 界面只存「选了哪个状态」这一份 UI 态，改它就重新要一次快照，绝不在本地把 12 条再滤一遍；
// ③ 行上的状态给人读中文，机器 token 留在 journal（与 skipReasonLabel 同族）。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { HISTORY_FILTERS, HISTORY_STATES as MAIN_STATES, Scheduler } from '../src/main/scheduler';
import { HISTORY_STATES, HISTORY_STATE_LABELS } from '../src/renderer/projections';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

function section(start: string, end: string, extra = '') {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b) + extra;
}

const hist = [
  { task_id: 'T1', task_name: '每晨跑用例', occurrence_key: 'k1', due_at: 'd', decision: 'triggered', state: 'succeeded', at: '2026-09-20T01:00:00.000Z' },
  { task_id: 'T2', task_name: '夜间整理', occurrence_key: 'k2', due_at: 'd', decision: 'triggered', state: 'skipped', reason: 'overlap', at: '2026-09-20T02:00:00.000Z' },
];

function renderFace(cache: unknown, filter: string) {
  const context: any = {
    esc: (s: unknown) => String(s),
    skipReasonLabel: (r: string) => 'R(' + r + ')',
    WEEKDAY_CN: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    HISTORY_STATES,
    HISTORY_STATE_LABELS,
  };
  runInNewContext(
    section('/* 定时任务面板的纯渲染部分', '/* 记忆面板：两层')
      + '\nscheduleCache = ' + JSON.stringify(cache) + ';\nschedHistFilter = ' + JSON.stringify(filter) + ';',
    context,
  );
  return context.scheduleViewHTML() as string;
}

const snap = { tasks: [], history: hist, running: 0, queued: 0, cap: 2, startupDone: true, tzNotes: {} };

it('筛选值清单与 main 的 HISTORY_FILTERS 逐字同集（两份清单必然漂移，对表锁住）', () => {
  expect([...HISTORY_STATES]).toEqual([...HISTORY_FILTERS]);
  expect([...MAIN_STATES, 'all'].sort()).toEqual([...HISTORY_FILTERS].sort());
});

it('七个筛选值都有中文标签，没有一个把裸 token 印到屏幕上', () => {
  expect(Object.keys(HISTORY_STATE_LABELS).sort()).toEqual([...HISTORY_STATES].sort());
  for (const s of HISTORY_STATES) expect(HISTORY_STATE_LABELS[s]).not.toBe(s);
});

it('行上写中文状态、段头带筛选下拉且当前值选中', () => {
  const html = renderFace(snap, 'all');
  expect(html).toContain('成功');
  expect(html).toContain('跳过');
  expect(html, 'class 仍留机器值（配色按它来），文字才是中文').toContain('sched-state succeeded');
  expect(html).not.toMatch(/<span class="sched-state succeeded">succeeded</);
  for (const s of HISTORY_STATES) expect(html).toContain('<option value="' + s + '"');
  expect(html).toContain('<option value="all" selected>');
});

it('筛中时段头点名「只看 X」，筛空了说的是「这个状态下」而不是「暂无运行历史」', () => {
  const failedOnly = renderFace({ ...snap, history: [] }, 'failed');
  expect(failedOnly).toContain('只看 失败');
  expect(failedOnly).toContain('这个状态下暂无记录');
  expect(renderFace({ ...snap, history: [] }, 'all'), '整段没有记录时才说「暂无运行历史」').toContain('暂无运行历史');
});

/* ---- 请求面：筛选值随快照一起要，main 才是筛的那一方 ---- */

function loadFace(filter: string, snapshot: () => Promise<unknown>) {
  const ctx: any = {
    api: { scheduleSnapshot: snapshot },
    scheduleCache: null,
    scheduleLoading: false,
    schedHistFilter: filter,
    __p: null,
  };
  runInNewContext(section('  async function loadSchedule(force) {', "  /* 记忆快照随 agent:state")
    + "\n__p = (async () => { await loadSchedule(true); })();", ctx);
  return ctx;
}

it('要快照时把当前筛选值递过去（不是恒传 all 的哑控件）', async () => {
  const snapshot = vi.fn(async () => ({ tasks: [], history: [] }));
  const ctx = loadFace('failed', snapshot);
  await ctx.__p;
  expect(snapshot).toHaveBeenCalledWith('failed');
});

it('换筛选 = 丢开缓存 + 重新要快照 + 重画；未知值与同值不动桥', async () => {
  const loadSchedule = vi.fn(async () => {});
  const renderSide = vi.fn();
  const ctx: any = {
    HISTORY_STATES, schedHistFilter: 'all', scheduleCache: { tasks: [], history: [] }, loadSchedule, renderSide,
    sidePagesHost: null,
  };
  runInNewContext(section('  /* 运行历史的状态筛选：界面只存', '  /* 打开标签页时刷新对应快照'), ctx);
  await ctx.setSchedHistFilter('skipped');
  expect(ctx.schedHistFilter).toBe('skipped');
  expect(ctx.scheduleCache, '本地留着一份再过滤 = 第二份事实源，必须先丢开').toBeNull();
  expect(loadSchedule).toHaveBeenCalledWith(true);
  expect(renderSide).toHaveBeenCalledTimes(1);
  loadSchedule.mockClear();
  await ctx.setSchedHistFilter('skipped');
  await ctx.setSchedHistFilter('Mars/NotAState');
  await ctx.setSchedHistFilter(undefined as unknown as string);
  expect(loadSchedule, '同值与非法值都不该再发一次请求').not.toHaveBeenCalled();
  expect(ctx.schedHistFilter, '非法值不能污染界面态').toBe('skipped');
});

it('filterHistory 仍在 main：面板那条路就是它的调用方（不是又写一份谓词）', () => {
  const rows = hist as unknown as Parameters<typeof Scheduler.filterHistory>[0];
  expect(Scheduler.filterHistory(rows, 'all')).toHaveLength(2);
  expect(Scheduler.filterHistory(rows, 'succeeded').map((h) => h.task_id)).toEqual(['T1']);
});
