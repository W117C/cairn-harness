import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
// 同一个真函数注进 vm，而不是在测试里重写一遍准入判据：两支渲染器共用一个实现是本判据的**内容**。
// 剥法也来自同一处（三份 vm 切片共用）。
import { entersMainConversation, groupedScript, PANEL_DIRTY_TYPES, terminalRowState, toolArgsSummary, unansweredToolCalls } from './renderer-vm-module';

// R1b B1 后：重放走「单元分组（history-window）+ 单一渲染器（app.js renderEvent）」。
// 本文件锁的是会话切换/重放编排那一层：挂载请求、去重、快照对账、重放无副作用。
const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const projection = readFileSync(new URL('../src/renderer/history-window.js', import.meta.url), 'utf8');
const grouped = groupedScript(projection);
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
/** 单元 → 可读签名（ids 指回事件数组，避免在测试里重写一遍分组逻辑）。 */
function shape(units: any[], events: any[]) {
  return units.map((u) => u.ids.map((i: number) => events[i]?.content ?? events[i]?.text ?? events[i]?.name ?? events[i]?.type).join(''));
}
function boot() {
  const requests: ReturnType<typeof deferred>[] = [];
  let onEvent!: (event: any) => void;
  let units: any[] = [];
  const destroyed = vi.fn();
  const context = {
    api: {
      onEvent: (fn: typeof onEvent) => { onEvent = fn; },
      openSession: vi.fn((_id: string) => { const d = deferred(); requests.push(d); return d.promise; }),
      run: vi.fn(async () => ({ ok: true })),
    },
    real: { id: null as string | null, running: false, events: 0, usageIn: 0, usageOut: 0, historyPending: false, askCards: new Map(), runStart: 0 },
    selectedId: null, sessions: [], sending: false,
    streamInner: element(), document: { createElement: element }, revealObserver: { unobserve: vi.fn() },
    entersMainConversation,
    // showHistory 写、tool_call 分支读；termBodyHTML 读 panelLive（缺席 ≠ 运行中）
    unansweredToolCalls, historyUnanswered: new Set(), terminalRowState, panelLive: false,
    toolArgsSummary,
    PANEL_DIRTY_TYPES,
    $: vi.fn(element), render: vi.fn(), closeSbMenus: vi.fn(), syncStatusbar: vi.fn(), scrollStream: vi.fn(),
    toast: vi.fn(), askCard: vi.fn(), setInterval: vi.fn(), clearInterval: vi.fn(), setTimeout: vi.fn(),
    // Exercise the shipped grouping and the inert mount contract; only layout is stubbed.
    mountHistory: vi.fn((options: any) => {
      units = options.units;
      expect(typeof options.renderUnit).toBe('function');
      return { destroy: destroyed };
    }),
    send: undefined as unknown as () => Promise<void>,
    selectSession: undefined as unknown as (id: string, force?: boolean) => Promise<void>,
    promptInput: { value: 'send me' }, settingsReady: Promise.resolve(),
    workspaceSaving: false, workspaceDirty: false, workspaceError: '', configuredWorkspace: null,
    activeFileDoc: null, openView: vi.fn(), finalizePending: vi.fn(), appendUser: vi.fn(), ensureAi: vi.fn(),
    refreshPanels: vi.fn(), syncRunButton: vi.fn(),
    runControl: { isRunning: () => false, cancel: null as (() => void) | null },
    setRunning: vi.fn(), PERM_MAP: { standard: 'default' }, permMode: { id: 'standard' }, loadSessions: vi.fn(),
  };
  runInNewContext(
    grouped + '\n' +
    section('  let historyWindow = null;', '  /* ---------- 真实运行目录：') +
    section('  function clearTranscript()', '  /* ---------- 会话列表 ---------- */') +
    section('  function renderEvent(e)', '  /* ---------- 审批（') +
    section('  /* ---------- 事件订阅 ---------- */', '  const _newChatBtn'),
    context,
  );
  return { context, requests, emit: (event: any) => onEvent(event), units: () => units, destroyed };
}
const user = (content: string) => ({ type: 'user_message', content });
const usage = { type: 'usage', inputTokens: 7, outputTokens: 3 };
const live = (event: any, session_id = 'a') => ({ ...event, session_id });

it('ignores background and unattributed transcript/usage but counts every live delivery', async () => {
  const b = boot(), opened = b.context.selectSession('a');
  const hist = [user('a history'), usage];
  b.requests[0].resolve({ events: hist });
  await opened;
  b.emit(live(user('b message'), 'b'));
  b.emit(live(usage, 'b'));
  b.emit(live({ type: 'compaction' }, 'b'));
  b.emit(usage);
  expect(shape(b.units(), hist)).toEqual(['a history']);
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
  expect(shape(b.units(), [user('new history'), user('current generation')])).toEqual(['new history', 'current generation']);
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
  const snapshot = [user('old'), usage, ...incoming.slice(0, overlap)];
  b.requests[0].resolve({ events: snapshot });
  await opened;
  // 对账后不得重复投递：old + 未落盘的 during open/tail（usage 无宿主，不成单元）
  expect(shape(b.units(), snapshot.concat(overlap === 3 ? [] : incoming.slice(overlap)))).toEqual(['old', 'during open', 'tail']);
  expect(b.context.real).toMatchObject({ usageIn: 14, usageOut: 6, events: 4, historyPending: false });
});

it('retains repeated identical usage/deltas by occurrence and continues snapshot assistant/tool rows', async () => {
  const b = boot(), opened = b.context.selectSession('a');
  const delta = { type: 'assistant_delta', callId: 'c', text: 'x' };
  for (const e of [delta, usage, usage, delta]) b.emit(live(e));
  const snapshot = [user('old'), delta, usage];
  b.requests[0].resolve({ events: snapshot });
  await opened;
  expect(b.units().length).toBe(2);
  expect(b.context.real.usageIn).toBe(14);
  b.emit(live({ type: 'assistant_message', content: 'final' }));
  b.emit(live({ type: 'tool_call', id: 'tool', name: 'Read', args: { path: 'file' } }));
  b.emit(live({ type: 'tool_result', callId: 'tool', ok: true, output: 'complete output' }));
  // 快照 + live 尾巴对账后：old 一条、正文+工具一条（同单元），不再各写一份渲染器
  expect(b.units().length).toBe(2);
  expect(b.context.real.usageIn).toBe(14);
});

it('history is inert, untruncated and does not increment live event count or replay side effects', async () => {
  const b = boot();
  const events = [
    ...Array.from({ length: 10000 }, (_, i) => user('sentinel-' + String(i))),
    { type: 'assistant_delta', text: 'historical draft' },
    { type: 'assistant_message', content: 'historical final' },
    { type: 'plan_proposed', callId: 'p', plan: { goal: 'never ask' } },
    { type: 'approval_requested', id: 'a-1', tool: 'run_shell', args_digest: '', risk: 'none' },
    { type: 'compaction', tokens_before: 1, tokens_after: 2 }, usage,
  ];
  for (let i = 0; i < 2; i++) {
    const opened = b.context.selectSession('a', true);
    b.requests[i].resolve({ events });
    await opened;
    const u = b.units();
    // 1 万条 user 消息各自成单元；其后 delta+message 合一条、plan/approval/compaction 各一条
    expect(u).toHaveLength(10004);
    expect(u[0].ids).toEqual([0]);
    expect(u[5000].ids).toEqual([5000]);
    expect(u[9999].ids).toEqual([9999]);
    expect(u[10003].kind).toBe('card');
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
  expect(b.context.real).toMatchObject({ usageIn: 7, usageOut: 3, historyPending: false });
  expect(b.context.toast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('read failed'));
});

it('孤儿 tool_result 的分支不许静默 break：事实要落成卡，那一格要有壳（#31 根因之一半）', () => {
  /* 为什么这条写在源码形状上而不是 vm 里跑：appendRecordCard 要真 DOM（insertAdjacentHTML）且依赖
     切片外的 RECORD_CHEV，vm 那支跑不起来；真行为由 panels-check 的 B24 相在真窗口里判。
     这一条只钉一件事：找不到可并入调用时，控制流**必须**流向一张记录卡，而不是 `break` 掉。
     旧写法 `if (!item) break;` 让那条结果从转录里无声消失，还连带 buildUnit 返回 null ⇒
     mountHistory 在 rAF 里抛 TypeError ⇒ 同窗后面的单元全不挂载（量测见
     outputs/impact-third-ring-audit-2026-09-22.md「第七读数」）。 */
  const a = source.indexOf("      case 'tool_result': {");
  const b = source.indexOf("      case 'clarify_requested'", a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  const body = source.slice(a, b);
  expect(body).not.toMatch(/if\s*\(\s*!item\s*\)\s*\{?\s*break/);      // 无声消失那一支已撤（写成 `{ break; }` 也算破）
  const orphan = /if\s*\(\s*!item\s*\)\s*\{([\s\S]*?)\n\s*\}/.exec(body);
  expect(orphan, "not-found 那一支必须还在（撤了它＝把结果当成不该显示）").not.toBeNull();
  expect(orphan?.[1]).toContain('appendRecordCard(');                // 且落成一格有壳的卡
  expect(orphan?.[1]).toMatch(/out\s*\|\|/);                          // 卡里要带结果原文（缺席≠空输出，是两句话）
  const title = /appendRecordCard\([\s\S]*?'([^']*)'/.exec(orphan?.[1] ?? '')?.[1] ?? '';
  expect(title).not.toContain('tool_result');   // 原始英文类型名不许上屏
  expect(title).toContain('未能并入调用');
});

it('单元渲染不出壳时必须出声：跳过是虚拟化的权利，静默不是', () => {
  /* 配套的另一半：mountHistory 现在遇到 null 只按 0 高跳过（一格不再拖死整窗）——崩溃没了，
     但「事实看不见」这件事也同时变得无声。所以 buildUnit 交出 null 前必须 console.error，
     且要点名是哪几号事件（panels-check 的 B25 收 console.error，漏一格就红）。
     这条钉的是出声那一支还在、且带得出事件类型；行为侧（真收到）由 B25 的通道自检验证。 */
  const a = source.indexOf('  function buildUnit(unit) {');
  const b = source.indexOf('  /* ---------- 会话列表', a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  const branch = /if\s*\(\s*!first\s*\)\s*\{([\s\S]*?)\n\s*\}/.exec(source.slice(a, b));
  expect(branch, "!first 那一支必须还在（撤了它＝又回到静默丢事实）").not.toBeNull();
  expect(branch?.[1]).toContain('console.error(');
  expect(branch?.[1], '出声要带事件类型，否则红了也查不到是哪一型').toContain('historyEvents');
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
  expect(b.context.real).toMatchObject({ id: 'b', usageIn: 7, usageOut: 3, events: 1, historyPending: false });
  expect(b.context.toast).not.toHaveBeenCalled();
});

/* ---------- 子流准入（§4.4.4 的界面那一半，live 那一支） ----------
 * 上面「重放」那几段走的是 showHistory → projectUnits；跑动中（real.running 为真）走的是
 * 逐条 renderEvent。两条渲染路必须问同一句，否则同一份流刷新前藏在父泡里、刷新后凭空长出单元。
 * 判据本身（哪些类型算子流细节）在 tests/renderer-child-admission.test.ts；这里只证接线。 */
it('live：worker 的执行细节不落地，但它的钱照记、父自己的事件照画', async () => {
  const b = boot(), opened = b.context.selectSession('a');
  b.requests[0].resolve({ events: [] });
  await opened;
  b.context.real.running = true; // 跑动中 ⇒ onEvent 走逐条 renderEvent 那一支（不是整段重投）
  for (const e of [
    { type: 'assistant_message', content: '子模型说的', agent_id: 'w-a' },
    { type: 'tool_call', id: 'w1', name: 'grep', args: {}, agent_id: 'w-a' },
    { type: 'tool_result', callId: 'w1', ok: true, output: 'worker', agent_id: 'w-a' },
    { type: 'error', message: 'worker 炸了', agent_id: 'w-a' },
    { type: 'turn_truncated', callId: 'w1', stop_reason: 'max_tokens', agent_id: 'w-a' },
  ]) b.emit(live(e));
  expect(b.context.ensureAi).not.toHaveBeenCalled();
  expect(b.context.appendUser).not.toHaveBeenCalled();
  expect(b.context.finalizePending).not.toHaveBeenCalled();

  // 钱不跟着藏：worker 的 usage 带归因，底栏仍必须记——少报成本比多画几行更坏
  b.emit(live({ type: 'usage', agent_id: 'w-a', inputTokens: 5, outputTokens: 2 }));
  expect(b.context.real).toMatchObject({ usageIn: 5, usageOut: 2 });

  // 反向对照：不带归因的同一类型照常上屏（判据认 agent_id，不是把整类事件掐死）
  b.emit(live({ type: 'user_message', content: '父的用户消息' }));
  expect(b.context.appendUser).toHaveBeenCalled();

  // 隐藏渲染 ≠ 假装没收到：real.events 的语义仍是「live 投递计数」
  expect(b.context.real.events).toBe(7);
});
