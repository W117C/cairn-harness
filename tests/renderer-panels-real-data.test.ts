// R1a 桥接层行为：底栏事件数按「当前展示会话」计数（重放不再显示 0），
// 且抽屉面板数据源在会话打开/新事件到达时刷新——同时保住既有不变量：
// 重放不得产生 live 副作用（real.events 仍为 0、无 toast/审批卡/定时器）。
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
    className: '', textContent: '', innerHTML: '', dataset: {}, style: {}, children: [] as any[],
    appendChild(node: any) { this.children.push(node); },
    append(...nodes: any[]) { this.children.push(...nodes); },
    querySelectorAll: () => [],
  };
}
function boot() {
  const requests: ReturnType<typeof deferred>[] = [];
  let onEvent!: (event: any) => void;
  const els: Record<string, ReturnType<typeof element>> = { '#eventCount': element(), '#tokenTotal': element() };
  const context = {
    api: {
      onEvent: (fn: typeof onEvent) => { onEvent = fn; },
      openSession: vi.fn((_id: string) => { const d = deferred(); requests.push(d); return d.promise; }),
      run: vi.fn(async () => ({ ok: true })),
    },
    real: { id: null as string | null, running: false, events: 0, usageIn: 0, usageOut: 0, historyPending: false, cards: new Map(), toolGroup: null },
    selectedId: null, sessions: [], sending: false,
    streamInner: element(), document: { createElement: element }, revealObserver: { unobserve: vi.fn() },
    $: vi.fn((s: string) => els[s] ?? element()), render: vi.fn(), closeSbMenus: vi.fn(), scrollStream: vi.fn(),
    syncRunButton: vi.fn(), runControl: { isRunning: () => false, cancel: null as (() => void) | null },
    // DT-02：refreshPanels 现在顺带同步标题栏上下文（工作区名进了标题栏）。
    // 与 renderSide 同一处置——切片外的 UI 同步函数在上下文里声明为桩。
    syncTitlebar: vi.fn(),
    // worker 审批卡同步（同一拍、另一切片）：本判据只关心面板数据，卡面由 projections 单测判。
    syncWorkerAskCards: vi.fn(),
    toast: vi.fn(), askCard: vi.fn(), setInterval: vi.fn(), clearInterval: vi.fn(), setTimeout: vi.fn(),
    mountHistory: vi.fn(() => ({ destroy: vi.fn() })),
    // 抽屉刷新：桥接层只负责喂数据 + 请求重绘，渲染函数留在原型段
    renderSide: vi.fn(), projectPanelData: vi.fn((_events: unknown[], _workspace: string | null) => ({ workspace: null, files: [], tree: [], terminal: [], merge: [] })),
    send: undefined as unknown as () => Promise<void>,
    selectSession: undefined as unknown as (id: string, force?: boolean) => Promise<void>,
    promptInput: { value: '' }, settingsReady: Promise.resolve(),
    workspaceSaving: false, workspaceDirty: false, workspaceError: '', configuredWorkspace: '/Users/me/coding-suite',
    activeFileDoc: null, openView: vi.fn(), finalizePending: vi.fn(), appendUser: vi.fn(), ensureAi: vi.fn(),
    setRunning: vi.fn(), PERM_MAP: { standard: 'default' }, permMode: { id: 'standard' }, loadSessions: vi.fn(),
  };
  runInNewContext(
    projection.slice(0, projection.indexOf('export function windowRange')).replaceAll('export function ', 'function ') + '\n' +
    section('  let historyWindow = null;', '  /* ---------- 真实运行目录：') +
    section('  function clearTranscript()', '  /* ---------- 会话列表 ---------- */') +
    section('  function tokStr()', '  async function initSandboxState()') +
    section('  function renderEvent(e)', '  /* ---------- 审批（') +
    section('  /* ---------- 事件订阅 ---------- */', '  const _newChatBtn'),
    context,
  );
  return { context, els, requests, emit: (event: any) => onEvent(event) };
}
const user = (content: string) => ({ type: 'user_message', content });
const usage = { type: 'usage', inputTokens: 7, outputTokens: 3 };
const live = (event: any, session_id = 'a') => ({ ...event, session_id });

it('重放会话后底栏事件数 = 会话事件行数（裸整数），且 real.events 仍为 0', async () => {
  const b = boot(), opened = b.context.selectSession('a');
  b.requests[0].resolve({ events: [user('一'), user('二'), usage, user('三')] });
  await opened;
  expect(b.els['#eventCount'].textContent).toBe('4');
  expect(b.context.real.events).toBe(0);
  expect(b.els['#tokenTotal'].textContent).toBe('10');
});

it('会话打开时刷新抽屉投影与重绘（面板不再是原型演示数据）', async () => {
  const b = boot(), opened = b.context.selectSession('a');
  b.requests[0].resolve({ events: [user('一')] });
  await opened;
  expect(b.context.projectPanelData).toHaveBeenCalled();
  expect(b.context.renderSide).toHaveBeenCalled();
  expect(b.context.projectPanelData.mock.calls.at(-1)?.[1]).toBe('/Users/me/coding-suite');
});

it('运行中新到达的事件继续累加底栏计数', async () => {
  const b = boot();
  b.context.real.id = 'a';
  b.context.real.running = true;
  b.emit(live(user('实')));
  b.emit(live(usage));
  expect(b.els['#eventCount'].textContent).toBe('2');
});

it('原型演示常量不得回流渲染层（审阅 / 终端假数据源已删除）', () => {
  for (const dead of ['const REVIEW =', 'TERMINAL_SEEDS', 'src/auth/session.ts']) {
    expect(source, '渲染层仍引用了 ' + dead).not.toContain(dead);
  }
});
