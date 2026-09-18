import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

// R1b B1：history-window 只做「展示单元」分组，渲染语义归 app.js 的单一渲染器。
// Execute the shipped browser module without requiring a TS declaration shim.
const source = readFileSync(new URL('../src/renderer/history-window.js', import.meta.url), 'utf8');
const module = runInNewContext(source.replaceAll('export function ', 'function ') + '\n({ projectUnits, windowRange });');
const kinds = (events: unknown[]) => module.projectUnits(events as never[]).map((u: { kind: string }) => u.kind);
const ids = (events: unknown[]) => module.projectUnits(events as never[]).map((u: { ids: number[] }) => u.ids);

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

it('worker 子流事件按 agent_id 自成单元，不把主 loop 的工具组从中间劈开', () => {
  const events = [
    { type: 'tool_call', id: 'm1', name: 'read_file', args: {} },
    { type: 'tool_call', id: 'w1', name: 'grep', args: {}, agent_id: 'w-a' },
    { type: 'tool_result', callId: 'm1', ok: true, output: 'main' },
  ];
  const units = module.projectUnits(events as never);
  expect(units.map((u: { key: string }) => u.key)).toEqual(['main|turn', 'w-a|turn', 'main|turn']);
  expect(units[1].ids).toEqual([1]);
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
  module.projectUnits(events as never);
  expect(JSON.stringify(events)).toBe(original);
});

it('空历史 → 空单元集；窗口算法仍bounded', () => {
  expect(module.projectUnits([])).toEqual([]);
  expect(module.windowRange([0], 0, 600)).toEqual({ start: 0, end: 0 });
  const events = Array.from({ length: 10000 }, (_, i) => ({ type: 'user_message', content: 'sentinel-' + String(i) }));
  const units = module.projectUnits(events as never);
  expect(units).toHaveLength(10000);
  const offsets = Array.from({ length: units.length + 1 }, (_, i) => i * 120);
  for (const top of [0, 600000, 1199400]) {
    const range = module.windowRange(offsets, top, 600);
    expect(range.end - range.start).toBeGreaterThan(0);
    expect(range.end - range.start).toBeLessThanOrEqual(80);
    expect(units.slice(range.start, range.end).map((u: { ids: number[] }) => u.ids[0])).toContain(top === 0 ? 0 : top === 600000 ? 5000 : 9999);
  }
});
