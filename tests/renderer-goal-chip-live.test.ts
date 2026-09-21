// goal 芯片的两支投递面。panels-check B7 只能测到「空闲时提交目标」那一支：api.onEvent 在
// 快照已挂载且 !real.running 时走 showHistory 整段重投（app.js:2955），删掉 renderEvent 镜像里
// 的 syncGoalChip 实测**全绿**（负控做过）——而 goal 自动续跑恰恰发生在 real.running 为真的时段，
// 那时每条事件都走 renderEvent(e)（app.js:2957），芯片只能靠这一支自己变。
// 事件进哪一支由 renderer-history-live.test.ts 锁，芯片跟不跟由这里锁。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { goalRelevant, traceGoal } from '../src/agent/goal-trace';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

function section(start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}

function node() {
  const classes = new Set<string>();
  const attrs: Record<string, string> = {};
  return {
    textContent: '',
    classes,
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c: string) => classes.has(c),
    },
    setAttribute: (k: string, v: string) => { attrs[k] = v; },
    getAttribute: (k: string) => attrs[k] ?? '',
  };
}

function boot() {
  const nodes: Record<string, ReturnType<typeof node>> = {};
  const rc = { replay: false };
  const real = { id: 'a' };
  const inner = vi.fn();
  const context: any = {
    $: (sel: string) => (nodes[sel] ??= node()),
    real, rc, goalRelevant, traceGoal,
    showHistory: vi.fn(),
    renderEvent: inner,
  };
  runInNewContext(
    section("  const ctxGoal = $('#ctxGoal');", '  function goalStateHTML(t) {') + '\n' +
    section('  const _showHistoryForGoal = showHistory;', '})();'),
    context,
  );
  const chip = () => nodes['#goalChipLabel'].textContent;
  const aria = () => nodes['#ctxGoal'].getAttribute('aria-label');
  const warn = () => nodes['#ctxGoal'].classes.has('warn');
  return {
    chip,
    aria,
    warn,
    inner,
    live: (e: any) => context.renderEvent(e),
    snapshot: (events: any[]) => context.showHistory(events),
    replay: (on: boolean) => { rc.replay = on; },
    into: (id: string) => { real.id = id; },
  };
}

const setObjective = '把 tests/ 失败用例修绿';
const goalSet = () => ({ type: 'goal_set', objective: setObjective, max_turns: 8, max_usd: 0 });
const goalTurn = () => ({ type: 'user_message', content: '续跑一轮', origin: { kind: 'goal' } });
const goalStopped = (reason = '达到轮次上限') => ({ type: 'goal_stopped', reason, turn: 2, evidence: 'unknown' });
const notGoal = () => ({ type: 'usage', inputTokens: 1, outputTokens: 2 });

it('live 尾巴（续跑期每一轮）：芯片跟着轮次自己变，不等整段重投', () => {
  const b = boot();
  expect(b.chip()).toBe('设目标');
  b.live(goalSet());
  expect(b.chip()).toBe('目标 1/8');
  expect(b.warn()).toBe(true);
  expect(b.aria()).toContain(setObjective);
  expect(b.aria()).toContain('自动续跑中');
  b.live(goalTurn());
  expect(b.chip(), '第 2 轮到了，芯片必须在 renderEvent 这一支跟上').toBe('目标 2/8');
  expect(b.aria()).toContain('第 2/8 轮');
});

it('快照重投那一支同样要跟，且换到无目标的会话时归零', () => {
  const b = boot();
  b.snapshot([goalSet(), goalTurn()]);
  expect(b.chip()).toBe('目标 2/8');
  b.snapshot([]);
  expect(b.chip(), '整段里没有 goal_set ⇒ 不许留着上一条会话的读数').toBe('设目标');
  expect(b.warn()).toBe(false);
});

it('goal_stopped 改口并摘掉 warn（停了还在闪「续跑中」是骗用户）', () => {
  const b = boot();
  b.live(goalSet());
  b.live(goalTurn());
  b.live(goalStopped('美元闸 $0.50 已用满'));
  expect(b.chip()).toBe('目标已停 2/8');
  expect(b.warn()).toBe(false);
  expect(b.aria()).toContain('已停（第 2/8 轮）——美元闸 $0.50 已用满');
});

it('重放期间不得二次累加镜像（showHistory 已经整段筛过）', () => {
  const b = boot();
  b.snapshot([goalSet(), goalTurn()]);
  expect(b.chip()).toBe('目标 2/8');
  b.replay(true);
  b.live(goalTurn());
  b.live(goalTurn());
  expect(b.chip(), 'rc.replay 为真时 renderEvent 只画不记账，否则轮次虚增').toBe('目标 2/8');
});

it('切会话后芯片不再认上一条会话的目标；每条事件都原样交给被包住的渲染器', () => {
  const b = boot();
  b.live(goalSet());
  b.live(notGoal());
  expect(b.chip()).toBe('目标 1/8');
  b.into('b');
  b.snapshot([]); // 打开会话的唯一入口：整段重筛，不带上一条的读数
  expect(b.chip()).toBe('设目标');
  // 镜像只做侧信道：live 两支都必须继续走原渲染器，一次不吞
  expect(b.inner).toHaveBeenCalledTimes(2);
});
