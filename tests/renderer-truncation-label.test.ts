// 截断卡的标题面：`turn_truncated` 的 outcome 必须各说各的，且不能退化成英文类型名。
//
// 起因（2026-09-21）：这条事件第一次上屏时只有一张通用卡顶着「助手输出被截断」——两种原因的
// 下一步完全不同（篇幅用尽＝把同一句续写下去；内容策略＝换说法绕开），只看标题等于让用户猜。
// 同一天还撞过更前置的一次：EVENT_LABELS 没收这一条，标题直接是 `turn_truncated`
// （那条由 tests/event-type-coverage.test.ts 管，这里管的是「收了之后说得对不对」）。
//
// 判法沿用 tests/renderer-compact-chip.test.ts 那份：把 app.js 的 EVENT_LABELS+eventLabel
// 切出来在 vm 里跑。两个取料标记找不到就 throw——改名不能把这条判据抹成空转。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const start = source.indexOf('const EVENT_LABELS = {');
if (start < 0) throw new Error('app.js 里找不到 EVENT_LABELS —— 改名了要同步这条判据');
const end = source.indexOf('/** 通用记录卡', start);
if (end < 0) throw new Error('app.js 里找不到「通用记录卡」那段 —— 同上');

const { eventLabel } = runInNewContext(source.slice(start, end) + ';({ eventLabel })') as {
  eventLabel: (e: Record<string, unknown>) => string;
};

const cut = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'turn_truncated',
  callId: 'm1',
  outcome: 'output_budget',
  stop_reason: 'max_tokens',
  output_tokens: 4096,
  ...over,
});

describe('截断卡标题（eventLabel 的 turn_truncated 支）', () => {
  it('两种原因各说各的（下一步不同，不许并成一句）', () => {
    const budget = eventLabel(cut({}));
    const blocked = eventLabel(cut({ outcome: 'content_blocked', stop_reason: 'SAFETY' }));
    expect(budget).toContain('没写完就被收走');
    expect(blocked).toContain('被内容策略中止');
    expect(budget).not.toBe(blocked);
    expect(budget).not.toContain('内容策略');
    expect(blocked).not.toContain('没写完');
  });

  it('线上停止原因与已用输出 token 都上屏（离帽多远是唯一可行动的数字）', () => {
    expect(eventLabel(cut({}))).toContain('max_tokens');
    expect(eventLabel(cut({}))).toContain('4096');
  });

  it('负控：provider 没报 token ⇒ 不落那半句（缺席不等于 0）', () => {
    const e = cut({});
    delete e.output_tokens;
    expect(eventLabel(e)).not.toContain('输出 token');
  });

  it('标题里不出现原始英文类型名（今天撞的那件事的正面锁）', () => {
    expect(eventLabel(cut({}))).not.toContain('turn_truncated');
  });

  it('其他类型的标题不受这一支影响（零回归）', () => {
    expect(eventLabel({ type: 'goal_stopped' })).toBe('长任务目标已停');
    expect(eventLabel({ type: 'agent_result', status: 'failed' })).toBe('worker 结果 · failed');
    expect(eventLabel({ type: 'some_unknown_type' })).toBe('some_unknown_type');
  });
});
