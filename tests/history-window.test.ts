import { expect, it } from 'vitest';
// R1b B1：history-window 只做「展示单元」分组，渲染语义归 app.js 的单一渲染器。
// 直接按 ESM 导入（`history-window.d.ts` 提供声明，event-type-coverage.test.ts 同样这么导）。
// 旧写法是 readFileSync + runInNewContext 把 `export function` 抹成 `function` 再 eval——那是
// 还没有 .d.ts 时的权宜，代价是**模块一旦有 import 就整块语法失败**，且在 VM 里注入判据桩
// 等于给「子流准入」造第二份实现（本文件的存在理由恰恰是不许有第二套呈现）。
import { projectUnits, windowRange } from '../src/renderer/history-window.js';

const kinds = (events: unknown[]) => projectUnits(events as never[]).map((u: { kind: string }) => u.kind);
const ids = (events: unknown[]) => projectUnits(events as never[]).map((u: { ids: number[] }) => u.ids);

it('一个单元恰好一条 .msg 的等价物：连续同类合并，异类即断', () => {
  const events = [
    { type: 'user_message', content: 'u1' },
    { type: 'assistant_delta', text: 'a' },
    { type: 'assistant_delta', text: 'b' },
    { type: 'tool_call', id: 'c1', name: 'read_file', args: {} },
    { type: 'tool_result', callId: 'c1', ok: true, output: 'x' },
    { type: 'user_message', content: 'u2' },
  ];
  expect(ids(events)).toEqual([[0], [1, 2, 3, 4], [5]]);
  expect(kinds(events)).toEqual(['user', 'turn', 'user']);
});

it('正文之后的第二条模型消息另起单元（与 live 的 ensureAi 同语义）', () => {
  const events = [
    { type: 'assistant_message', content: 'first' },
    { type: 'tool_call', id: 'c', name: 'grep', args: {} },
    { type: 'assistant_message', content: 'second' },
  ];
  expect(ids(events)).toEqual([[0, 1], [2]]);
});

it('worker 子流的**可见**事件按 agent_id 自成单元，不把主 loop 的工具组从中间劈开', () => {
  // verify_result 是刻意留在主流的带归因事件（合并/丢弃决策的证据面）——它进得来，
  // 但必须另起一桶，否则父的 turn 单元会把它吞进自己的工具组（归因即消失）。
  const events = [
    { type: 'tool_call', id: 'm1', name: 'read_file', args: {} },
    { type: 'verify_result', callId: 'm2', ok: true, kind: 'test', summary: 'worker 验过' } as never,
    { type: 'tool_result', callId: 'm1', ok: true, output: 'main' },
  ];
  // 不带 agent_id：与父同桶，一条单元收全部
  expect(ids(events)).toEqual([[0, 1, 2]]);
  const withAgent = [{ ...events[0] }, { ...events[1], agent_id: 'w-a' }, { ...events[2] }];
  const units = projectUnits(withAgent as never);
  expect(units.map((u: { key: string }) => u.key)).toEqual(['main|turn', 'w-a|turn', 'main|turn']);
  expect(units[1].ids).toEqual([1]);
});

it('worker 子流的执行细节（正文/工具/错误/截断）根本不进单元集', () => {
  const events = [
    { type: 'tool_call', id: 'm1', name: 'read_file', args: {} },
    { type: 'assistant_message', content: '子模型说的话', agent_id: 'w-a' },
    { type: 'assistant_delta', text: '子模型的字', agent_id: 'w-a' },
    { type: 'tool_call', id: 'w1', name: 'grep', args: {}, agent_id: 'w-a' },
    { type: 'tool_result', callId: 'w1', ok: true, output: 'worker', agent_id: 'w-a' },
    { type: 'error', message: 'worker 炸了', agent_id: 'w-a' },
    { type: 'turn_truncated', callId: 'w1', stop_reason: 'max_tokens', agent_id: 'w-a' },
    { type: 'tool_result', callId: 'm1', ok: true, output: 'main' },
  ];
  // 只剩父的首尾两条 ⇒ 一条单元；父的工具组既没被劈开也没被灌进子的事件
  expect(ids(events)).toEqual([[0, 7]]);
  // 反向对照：同一批事件摘掉 agent_id 就一条不落（判据认归因，不认类型黑名单）
  const untagged = events.map((e) => ({ ...e, agent_id: undefined }));
  const flat = ids(untagged).flat();
  expect(flat).toHaveLength(8);
  expect(new Set(flat).size).toBe(8);
});

it('usage / session_meta 无宿主，不产单元也不切断当前单元', () => {
  const events = [
    { type: 'assistant_delta', text: 'a' },
    { type: 'usage', inputTokens: 1, outputTokens: 2 },
    { type: 'session_meta', schema: 1 },
    { type: 'assistant_delta', text: 'b' },
  ];
  // usage / session_meta 被跳过但不断链：两条 delta 仍同属一个单元
  expect(ids(events)).toEqual([[0, 3]]);
});

it('其余事件一律 card 类且各自成单元', () => {
  const events = [{ type: 'plan_approved', approved: false }, { type: 'security_report', findings: [] }, { type: 'error', message: 'boom' }];
  expect(kinds(events)).toEqual(['card', 'card', 'card']);
  expect(ids(events)).toEqual([[0], [1], [2]]);
});

it('分组不改写事件流本体', () => {
  const events = [{ type: 'user_message', content: 'x' }, { type: 'tool_call', id: 'c', name: 't', args: { p: 1 } }];
  const original = JSON.stringify(events);
  projectUnits(events as never);
  expect(JSON.stringify(events)).toBe(original);
});

it('空历史 → 空单元集；窗口算法仍bounded', () => {
  expect(projectUnits([])).toEqual([]);
  expect(windowRange([0], 0, 600)).toEqual({ start: 0, end: 0 });
  const events = Array.from({ length: 10000 }, (_, i) => ({ type: 'user_message', content: 'sentinel-' + String(i) }));
  const units = projectUnits(events as never);
  expect(units).toHaveLength(10000);
  const offsets = Array.from({ length: units.length + 1 }, (_, i) => i * 120);
  for (const top of [0, 600000, 1199400]) {
    const range = windowRange(offsets, top, 600);
    expect(range.end - range.start).toBeGreaterThan(0);
    expect(range.end - range.start).toBeLessThanOrEqual(80);
    expect(units.slice(range.start, range.end).map((u: { ids: number[] }) => u.ids[0])).toContain(top === 0 ? 0 : top === 600000 ? 5000 : 9999);
  }
});
