// 压缩芯片的按钮面（app.js 里的 agent:compact 接线）。门 0 的 A2/A3 只证「渲染层引用了这条桥」，
// 证不到「按下去传的是屏幕上这条会话的 id、回条的实测读数上了屏、被拒不报成功」。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

function section(start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}

function node() {
  const listeners: Record<string, ((e: never) => void)[]> = {};
  return {
    disabled: false,
    innerHTML: '',
    addEventListener: (type: string, fn: (e: never) => void) => { (listeners[type] ??= []).push(fn); },
    fire: (type: string, e: unknown = { preventDefault() {} }) => {
      for (const fn of listeners[type] ?? []) fn(e as never);
    },
    setAttribute: () => {},
  };
}

function boot(compact: (id?: string) => Promise<unknown>) {
  const nodes: Record<string, ReturnType<typeof node>> = {};
  const real = { id: '会话甲', running: false, usageIn: 1200, usageOut: 300 };
  const toast = vi.fn();
  const registerPop = vi.fn();
  runInNewContext(
    section("  const ctxCompact = $('#ctxCompact');", "  /* 目标态镜像：showHistory 全量筛"),
    { $: (sel: string) => (nodes[sel] ??= node()), real, api: { compact }, toast, registerPop, togglePop: vi.fn(), closeAllPops: vi.fn() },
  );
  return {
    toast,
    real,
    panel: () => nodes['#compactPanel'],
    body: () => nodes['#compactPanelBody'],
    /** 面板渲染函数是 registerPop 的第三个入参（打开时现读现算，不存第二份态）。 */
    render: () => (registerPop.mock.calls[0]?.[2] as () => void)(),
  };
}

it('按下去传的是屏幕上这条会话的 id，回条的实测读数原样上屏', async () => {
  const compact = vi.fn(async () => ({ ok: true, cardPayload: { tokensBefore: 5000, tokensAfter: 800, compressedCount: 12 } }));
  const b = boot(compact);
  b.panel().fire('submit');
  await vi.waitFor(() => expect(b.toast).toHaveBeenCalled());
  expect(compact).toHaveBeenCalledWith('会话甲');
  const msg = String(b.toast.mock.calls[0]?.[0]);
  expect(msg).toContain('12 条事件');
  expect(msg, '省多少取主进程实测的 before/after，不许自己估').toContain('5000 → 800');
  expect(msg).toContain('省 4200');
});

it('主进程拒绝 ⇒ 原话上屏，不报成功', async () => {
  const b = boot(async () => ({ ok: false, error: '该会话正在运行，先停止再压缩' }));
  b.panel().fire('submit');
  await vi.waitFor(() => expect(b.toast).toHaveBeenCalled());
  const msg = String(b.toast.mock.calls[0]?.[0]);
  expect(msg).toContain('该会话正在运行，先停止再压缩');
  expect(msg).not.toContain('已压缩');
});

it('面板读数取自本会话累计用量；运行中把「先停止再压缩」摊在面板上', () => {
  const b = boot(async () => ({ ok: true, cardPayload: {} }));
  b.render();
  expect(b.body().innerHTML).toContain('1200 + 300');
  expect(b.body().innerHTML).not.toContain('先停止再压缩');
  b.real.running = true;
  b.render();
  expect(b.body().innerHTML).toContain('先停止再压缩');
});
