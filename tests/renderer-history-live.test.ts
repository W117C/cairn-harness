import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const projection = readFileSync(new URL('../src/renderer/history-window.js', import.meta.url), 'utf8');
function section(start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}
function deferred() {
  let resolve!: (value: { events: any[] }) => void, reject!: (error: Error) => void;
  const promise = new Promise<{ events: any[] }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function element() {
  return {
    className: '', textContent: '', innerHTML: '', dataset: {}, style: {},
    children: [] as any[],
    appendChild(node: any) { this.children.push(node); },
    append(...nodes: any[]) { this.children.push(...nodes); },
    querySelectorAll: () => [],
  };
}
function boot() {
  const requests: ReturnType<typeof deferred>[] = [];
  let onEvent!: (event: any) => void;
  let rows: any[] = [];
  const destroyed = vi.fn();
  const context = {
    api: {
      onEvent: (fn: typeof onEvent) => { onEvent = fn; },
      openSession: vi.fn((_id: string) => { const d = deferred(); requests.push(d); return d.promise; }),
      run: vi.fn(async () => ({ ok: true })),
    },
    real: { id: null as string | null, running: false, events: 0, usageIn: 0, usageOut: 0, historyPending: false, cards: new Map(), toolGroup: null },
    selectedId: null, sessions: [], sending: false,
    streamInner: element(), document: { createElement: element }, revealObserver: { unobserve: vi.fn() },
    $: vi.fn(element), render: vi.fn(), closeSbMenus: vi.fn(), syncStatusbar: vi.fn(), scrollStream: vi.fn(),
    syncRunButton: vi.fn(), runControl: { isRunning: () => false, cancel: null as (() => void) | null },
    toast: vi.fn(), askCard: vi.fn(), setInterval: vi.fn(), clearInterval: vi.fn(), setTimeout: vi.fn(),
    // Exercise the shipped projection and inert DOM row builder; only layout is stubbed.
    mountHistory: vi.fn((options: any) => {
      rows = options.rows;
      for (const row of rows) options.renderRow(row);
      return { destroy: destroyed };
    }),
    send: undefined as unknown as () => Promise<void>,
    selectSession: undefined as unknown as (id: string, force?: boolean) => Promise<void>,
    promptInput: { value: 'send me' }, settingsReady: Promise.resolve(),
    workspaceSaving: false, workspaceDirty: false, workspaceError: '', configuredWorkspace: null,
    activeFileDoc: null, openView: vi.fn(), finalizePending: vi.fn(), appendUser: vi.fn(), ensureAi: vi.fn(),
    refreshPanels: vi.fn(),
    setRunning: vi.fn(), PERM_MAP: { standard: 'default' }, permMode: { id: 'standard' }, loadSessions: vi.fn(),
  };
  runInNewContext(
    projection.slice(0, projection.indexOf('export function windowRange')).replaceAll('export function ', 'function ') + '\n' +
    section('  let historyWindow = null;', '  /* ---------- 真实运行目录：') +
    section('  function clearTranscript()', '  /* ---------- 会话列表 ---------- */') +
    section('  function renderEvent(e)', '  /* ---------- 审批（') +
    section('  /* ---------- 事件订阅 ---------- */', '  const _newChatBtn ='), context,
  );
  return { context, requests, emit: (event: any) => onEvent(event), rows: () => rows, destroyed };
}
const user = (content: string) => ({ type: 'user_message', content });
const usage = { type: 'usage', inputTokens: 7, outputTokens: 3 };
const live = (event: any, session_id = 'a') => ({ ...event, session_id });

it('ignores background and unattributed transcript/usage but counts every live delivery', async () => {
  const b = boot(), opened = b.context.selectSession('a');
  b.requests[0].resolve({ events: [user('a history'), usage] });
  await opened;
  b.emit(live(user('b message'), 'b'));
  b.emit(live(usage, 'b'));
  b.emit(live({ type: 'compaction' }, 'b'));
  b.emit(usage);
  expect(b.rows().map(r => r.text)).toEqual(['a history']);
  expect(b.context.real).toMatchObject({ usageIn: 7, usageOut: 3, events: 4 });
  expect(b.context.toast).not.toHaveBeenCalled();
  // A foreground run still uses real-time accounting, not historical accounting.
  b.context.real.running = true;
  b.emit(live(usage));
  expect(b.context.real).toMatchObject({ usageIn: 14, usageOut: 6, events: 5 });
});

it('rapid A/B/A switching rejects stale successes and failures, including pending ownership', async () => {
  const b = boot();
  const first = b.context.selectSession('a');
  b.emit(live(user('first generation')));
  const second = b.context.selectSession('b');
  const third = b.context.selectSession('a');
  b.emit(live(user('current generation')));
  b.requests[0].resolve({ events: [user('stale')] });
  b.requests[1].reject(new Error('stale failure'));
  await Promise.all([first, second]);
  expect(b.context.real.historyPending).toBe(true);
  expect(b.context.mountHistory).not.toHaveBeenCalled();
  b.requests[2].resolve({ events: [user('new history')] });
  await third;
  expect(b.rows().map(r => r.text)).toEqual(['new history', 'current generation']);
  expect(b.context.real).toMatchObject({ id: 'a', historyPending: false, events: 2 });
  expect(b.context.toast).not.toHaveBeenCalled();
});

it.each([0, 1, 3])('reconciles snapshot overlap of %i buffered records without duplicate usage or lost messages', async (overlap) => {
  const b = boot(), opened = b.context.selectSession('a');
  const incoming = [user('during open'), usage, user('tail')];
  for (const e of incoming) b.emit(live(e));
  b.emit(live(usage, 'other'));
  await b.context.send();
  expect(b.context.api.run).not.toHaveBeenCalled();
  expect(b.context.promptInput.value).toBe('send me');
  b.requests[0].resolve({ events: [user('old'), usage, ...incoming.slice(0, overlap)] });
  await opened;
  expect(b.rows().map(r => r.text)).toEqual(['old', 'during open', 'tail']);
  expect(b.context.real).toMatchObject({ usageIn: 14, usageOut: 6, events: 4, historyPending: false });
});

it('retains repeated identical usage/deltas by occurrence and continues snapshot assistant/tool rows', async () => {
  const b = boot(), opened = b.context.selectSession('a');
  const delta = { type: 'assistant_delta', callId: 'c', text: 'x' };
  for (const e of [delta, usage, usage, delta]) b.emit(live(e));
  b.requests[0].resolve({ events: [user('old'), delta, usage] });
  await opened;
  expect(b.rows().map(r => r.text)).toEqual(['old', 'xx']);
  expect(b.context.real.usageIn).toBe(14);
  b.emit(live({ type: 'assistant_message', content: 'final' }));
  b.emit(live({ type: 'tool_call', id: 'tool', name: 'Read', args: { path: 'file' } }));
  b.emit(live({ type: 'tool_result', callId: 'tool', ok: true, output: 'complete output' }));
  expect(b.rows().map(r => r.text)).toEqual(['old', 'final', 'Read']);
  expect(b.rows()[2]).toMatchObject({ result: 'complete output', ok: true });
  expect(b.context.real.usageIn).toBe(14);
});

it('history is inert, untruncated and does not increment live event count or replay side effects', async () => {
  const b = boot();
  const events = [
    ...Array.from({ length: 10000 }, (_, i) => user('sentinel-' + i)),
    { type: 'assistant_delta', text: 'historical draft' },
    { type: 'assistant_message', content: 'historical final' },
    { type: 'plan_proposed', plan: { goal: 'never ask' } },
    { type: 'approval_requested', askId: 'ask' },
    { type: 'compaction' }, usage,
  ];
  for (let i = 0; i < 2; i++) {
    const opened = b.context.selectSession('a', true);
    b.requests[i].resolve({ events });
    await opened;
    expect(b.rows()).toHaveLength(10004);
    expect(b.rows()[0].text).toBe('sentinel-0');
    expect(b.rows()[5000].text).toBe('sentinel-5000');
    expect(b.rows()[9999].text).toBe('sentinel-9999');
    expect(b.context.real).toMatchObject({ usageIn: 7, usageOut: 3, events: 0 });
  }
  expect(b.destroyed).toHaveBeenCalledTimes(1);
  // 面板刷新是重放的合法副作用（数据换源，不产生 live 行为）；其余 live 副作用必须为零。
  expect(b.context.refreshPanels).toHaveBeenCalledTimes(2);
  for (const spy of [b.context.toast, b.context.askCard, b.context.setInterval, b.context.setTimeout, b.context.ensureAi, b.context.appendUser]) {
    expect(spy).not.toHaveBeenCalled();
  }
});

it('failed history reads retain received live events and release the send barrier', async () => {
  const b = boot(), opened = b.context.selectSession('a');
  b.emit(live(user('survives')));
  b.emit(live(usage));
  b.requests[0].reject(new Error('read failed'));
  await opened;
  expect(b.rows().map(r => r.text)).toEqual(['survives']);
  expect(b.context.real).toMatchObject({ usageIn: 7, usageOut: 3, historyPending: false });
  expect(b.context.toast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('read failed'));
});

it('late old-session history cannot replace an already mounted newer session or its usage', async () => {
  const b = boot();
  const first = b.context.selectSession('a');
  const second = b.context.selectSession('b');
  b.requests[1].resolve({ events: [user('b history'), usage] });
  await second;
  b.emit(live(user('b live'), 'b'));
  b.requests[0].resolve({ events: [user('late a'), usage, usage] });
  await first;
  expect(b.rows().map(r => r.text)).toEqual(['b history', 'b live']);
  expect(b.context.real).toMatchObject({ id: 'b', usageIn: 7, usageOut: 3, events: 1, historyPending: false });
  expect(b.context.toast).not.toHaveBeenCalled();
});
