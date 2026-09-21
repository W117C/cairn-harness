// 模态收起表的三条语义：数组序即优先级、逐浮层登记且去重、按选择器**惰性**取元素。
//
// 起因（2026-09-22）：`d4a91a6` 把 Escape 从两支写死的 if 收成一张 `MODAL_DISMISS` 表，
// `bcf9008` 又把表里的元素改成用时 querySelector。但那张表的**行为**在 vitest 里零判据——
// 唯一消费者 `tests/renderer-workspace.test.ts` 只是把它切进 vm 当模块绑料（判的是工作目录），
// 真按键那条押在 panels-check B21 上。门不是离线观测者：mutate-verify 只能消费 vitest 文件，
// 于是「安全确认被别的浮层抢走这次按键」「同一个浮层登记两次」这两类回归连锚点都挂不上。
//
// 判法沿用 tests/renderer-truncation-label.test.ts：按标记切 app.js 一段进 vm 跑，
// 两个取料标记找不到就 throw——改名不能把这条判据抹成空转。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const start = source.indexOf('const MODAL_DISMISS = [');
if (start < 0) throw new Error('app.js 里找不到 MODAL_DISMISS —— 改名了要同步这条判据');
const end = source.indexOf('/* Escape 分层收起', start);
if (end < 0) throw new Error('app.js 里找不到「Escape 分层收起」那段 —— 同上');
const slice = source.slice(start, end);

interface FakeEl {
  sel: string;
  classList: { contains: (name: string) => boolean };
}

/** 每次 querySelector 现算：元素什么时候出现、什么时候带上 `show`，都由测试当场决定——
    这正是"惰性取元素"能被判住的原因（写死成求值时抓引用，本文件第一条就会 ReferenceError）。 */
function boot(shownAtBoot: string[] = []) {
  const shown = new Set(shownAtBoot);
  const elements = new Map<string, FakeEl>();
  const lookups: string[] = [];
  const ctx: Record<string, unknown> = {
    document: {
      querySelector(sel: string) {
        lookups.push(sel);
        let el = elements.get(sel);
        if (!el) {
          el = { sel, classList: { contains: (name: string) => name === 'show' && shown.has(sel) } };
          elements.set(sel, el);
        }
        return el;
      },
    },
    closeRisk: vi.fn(),
    closeSettings: vi.fn(),
  };
  const api = runInNewContext(slice + ';({ MODAL_DISMISS, registerModalDismiss, openModal })', ctx) as {
    MODAL_DISMISS: { sel: string; close: () => void }[];
    registerModalDismiss: (sel: string, close: () => void) => void;
    openModal: () => { el: FakeEl; close: () => void } | null;
  };
  const show = (sel: string) => shown.add(sel);
  const hide = (sel: string) => shown.delete(sel);
  return { api, ctx, show, hide, lookups, shown };
}

describe('模态收起表（Escape 与焦点圈共用的那一张）', () => {
  it('数组序即优先级：两支同时开着 ⇒ 交出去的是安全确认那一支', () => {
    const { api, ctx } = boot(['#riskScrim', '#settingsOverlay']);
    const open = api.openModal();
    expect(open?.el.sel).toBe('#riskScrim');
    open?.close();
    expect(ctx.closeRisk).toHaveBeenCalledTimes(1);
    expect(ctx.closeSettings).not.toHaveBeenCalled();
  });

  it('自己登记的浮层才有键盘退路；登记前表完全不认它（第四支被漏掉的那件事）', () => {
    const { api, show } = boot();
    show('#onboardOverlay');
    expect(api.openModal()).toBeNull();
    const later = vi.fn();
    api.registerModalDismiss('#onboardOverlay', later);
    const open = api.openModal();
    expect(open?.el.sel).toBe('#onboardOverlay');
    open?.close();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('同一选择器重复登记不加长表，也不夺走已有那一行的 close', () => {
    const { api } = boot(['#onboardOverlay']);
    const first = vi.fn();
    const hijack = vi.fn();
    api.registerModalDismiss('#onboardOverlay', first);
    const len = api.MODAL_DISMISS.length;
    api.registerModalDismiss('#onboardOverlay', hijack);
    expect(api.MODAL_DISMISS).toHaveLength(len);
    api.openModal()?.close();
    expect(first).toHaveBeenCalledTimes(1);
    expect(hijack).not.toHaveBeenCalled();
  });

  it('惰性：求值时元素不在也能好使——注册之后才出现的浮层照样被查到', () => {
    const { api, show, lookups } = boot();
    api.registerModalDismiss('#historyOverlay', vi.fn());
    expect(api.openModal()).toBeNull();
    expect(lookups).toContain('#historyOverlay');
    show('#historyOverlay');
    expect(api.openModal()?.el.sel).toBe('#historyOverlay');
  });

  it('负控：一支都没开着 ⇒ null（Escape 才落到芯片看板那一支）', () => {
    const { api, show, hide } = boot(['#riskScrim']);
    hide('#riskScrim');
    expect(api.openModal()).toBeNull();
    show('#settingsOverlay');
    expect(api.openModal()?.el.sel).toBe('#settingsOverlay');
  });
});
