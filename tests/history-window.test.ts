import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

// Execute the shipped browser module without requiring a TS declaration shim.
const source = readFileSync(new URL('../src/renderer/history-window.js', import.meta.url), 'utf8');
const module = runInNewContext(source.replaceAll('export function ', 'function ') + '\n({ projectHistory, windowRange });');

it('retains every historical message and selects bounded windows at either end and middle', () => {
  const events = Array.from({ length: 10000 }, (_, i) => ({ type: 'user_message', content: 'sentinel-' + i }));
  const rows = module.projectHistory(events);
  const offsets = Array.from({ length: rows.length + 1 }, (_, i) => i * 120);
  for (const [top, expected] of [[0, 'sentinel-0'], [600000, 'sentinel-5000'], [1199400, 'sentinel-9999']]) {
    const range = module.windowRange(offsets, top, 600);
    expect(range.end - range.start).toBeGreaterThan(0);
    expect(range.end - range.start).toBeLessThanOrEqual(80);
    expect(rows.slice(range.start, range.end).map((r: { text: string }) => r.text)).toContain(expected);
  }
  expect(rows).toHaveLength(10000);
});

it('restores complete assistant messages, merges deltas and pairs results without mutating events', () => {
  const events = [
    { type: 'assistant_message', content: 'standalone' },
    { type: 'assistant_delta', text: 'draft' },
    { type: 'usage', inputTokens: 1 },
    { type: 'assistant_message', content: 'final' },
    { type: 'tool_call', id: 'a', name: 'read_file', args: { path: 'a' } },
    { type: 'user_message', content: 'interleaved' },
    { type: 'tool_result', callId: 'a', ok: false, output: 'failure-sentinel' },
  ];
  const original = JSON.stringify(events);
  const rows = module.projectHistory(events);
  expect(rows.map((r: { text: string }) => r.text)).toEqual(['standalone', 'final', 'read_file', 'interleaved']);
  expect(rows[2]).toMatchObject({ result: 'failure-sentinel', ok: false });
  expect(JSON.stringify(events)).toBe(original);
});

it('keeps historical approval and plan decisions as inert data and handles empty history', () => {
  const events = [{ type: 'plan_approved', approved: false }, { type: 'approval_resolved', askId: 'a' }];
  expect(module.projectHistory(events).map((r: { kind: string }) => r.kind)).toEqual(['record', 'record']);
  expect(module.windowRange([0], 0, 600)).toEqual({ start: 0, end: 0 });
});
