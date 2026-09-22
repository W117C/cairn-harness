// 浮层开着时背景整块 inert：这条判据的离线观测者（2026-09-22）。
//
// 起因：`a11y-check` 新相实测出「设置浮层打开的那一刻，背景仍有 56 个可聚焦元素」，
// 修法落在 app.js 尾部的 `syncModalBackdrop` + 一个 MutationObserver。
// 但这条判据原本**只由慢门观测**：mutate-verify 只消费 vitest 文件，
// 于是「inert 判据退回取 MODAL_DISMISS」「观测器漏掉 subtree:true」两类回归连锚点都挂不上——
// 这两件事本轮各实踩过一次（前者红 56，后者读数纹丝不动）。
//
// 判法沿用 tests/renderer-modal-dismiss.test.ts：按标记切 app.js 尾段进 vm 跑，
// 标记找不到就 throw——改名不能把这条判据抹成空转。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function syncModalBackdrop() {');
if (start < 0) throw new Error('app.js 里找不到 syncModalBackdrop —— 改名了要同步这条判据');
const slice = source.slice(start); // 这段就是文件尾，切到尾不吞别的实现
if (!slice.includes('syncModalBackdrop();')) throw new Error('切到的尾段不含自装调用 —— 判据会空转');

const APP_SEL = 'body > .app';
const DIALOG_SEL = '[role="dialog"][aria-modal="true"].show';

/** 只认「对话框」那一种元素的 `matches`：观测器的 records 谓词就靠它筛。 */
class FakeEl {
  attrs: Record<string, string> = {};
  constructor(readonly id: string, private readonly isDialog = false) {}
  matches(sel: string) { return this.isDialog && sel === '[role="dialog"][aria-modal="true"]'; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  hasAttribute(k: string) { return k in this.attrs; }
}

interface Observer { fire(records: unknown[]): void }

function boot(init: { shown: boolean; appExists?: boolean }) {
  const app = new FakeEl('app');
  const dialog = new FakeEl('dialog', true);
  const body = new FakeEl('body');
  const unrelated = new FakeEl('unrelated');
  const state = { shown: init.shown };
  const lookups: string[] = [];
  const observed: { target: unknown; options: Record<string, unknown> }[] = [];
  const observers: Observer[] = [];
  let reads = 0; // 「一次同步 = 一次取料」的标尺
  const ctx: Record<string, unknown> = {
    Element: FakeEl,
    document: {
      body,
      querySelector(sel: string) {
        lookups.push(sel);
        if (sel === APP_SEL) return init.appExists === false ? null : app;
        if (sel === DIALOG_SEL) { reads += 1; return state.shown ? dialog : null; }
        return null;
      },
    },
    MutationObserver: class implements Observer {
      constructor(private readonly cb: (records: unknown[]) => void) { observers.push(this); }
      observe(target: unknown, options: Record<string, unknown>) { observed.push({ target, options }); }
      fire(records: unknown[]) { this.cb(records); }
    },
  };
  const api = runInNewContext(slice + ';({ syncModalBackdrop })', ctx) as {
    syncModalBackdrop: () => void;
  };
  return { api, app, dialog, body, unrelated, state, lookups, observed, observers, reads: () => reads };
}

describe('浮层开着时背景整块 inert（app.js 尾段）', () => {
  it('浮层开着 ⇒ body > .app 同时挂上 inert 与 aria-hidden', () => {
    const { app } = boot({ shown: true });
    expect(app.attrs.inert).toBe('');
    expect(app.attrs['aria-hidden']).toBe('true');
  });

  it('一支都没开着 ⇒ 背景不锁（负控：只测「锁上了」会放过「永远锁死背景」那种做法）', () => {
    const { app } = boot({ shown: false });
    expect(app.hasAttribute('inert')).toBe(false);
    expect(app.hasAttribute('aria-hidden')).toBe(false);
  });

  it('开↔关来回都要重刷：关掉的浮层不能把背景留在锁死态', () => {
    const b = boot({ shown: true });
    expect(b.app.hasAttribute('inert')).toBe(true);
    b.state.shown = false;
    b.api.syncModalBackdrop();
    expect(b.app.hasAttribute('inert')).toBe(false);
    b.state.shown = true;
    b.api.syncModalBackdrop();
    expect(b.app.attrs.inert).toBe('');
  });

  it('inert 只落在背景，对话框自己一个属性都不被写（写它就等于把浮层锁死）', () => {
    const { app, dialog } = boot({ shown: true });
    expect(Object.keys(app.attrs).sort()).toEqual(['aria-hidden', 'inert']);
    expect(Object.keys(dialog.attrs)).toEqual([]);
  });

  it('判据不取收起表：只查「背景 + 开着的那个选择器」，一次都不按 id 找浮层', () => {
    // 静态预览里 #onboardOverlay 的登记在 window.agent 桥接段内（整段提前 return），
    // 靠登记表判 ⇒ 未登记的浮层自动漏在锁外——就是本轮那条红 56。
    const b = boot({ shown: true });
    expect(b.lookups).toEqual([APP_SEL, DIALOG_SEL]);
  });

  it('观测必须带 subtree:true 且盯的是 body：只盯 body 自己时子元素改 class 一次也不回调', () => {
    const { observed, body } = boot({ shown: false });
    expect(observed).toHaveLength(1);
    expect(observed[0]!.target).toBe(body);
    expect(observed[0]!.options.subtree).toBe(true);
    expect(observed[0]!.options.attributeFilter).toEqual(['class']);
  });

  it('只有对话框（或 body）的 class 改动才触发重刷，无关元素的不触发', () => {
    const b = boot({ shown: false });
    expect(b.observers).toHaveLength(1);
    const obs = b.observers[0]!;
    const base = b.reads();
    obs.fire([{ target: b.unrelated }]);
    expect(b.reads()).toBe(base); // 没重刷
    obs.fire([{ target: b.dialog }]);
    expect(b.reads()).toBe(base + 1); // 重刷了一次
    b.state.shown = true;
    obs.fire([{ target: b.dialog }]);
    expect(b.app.attrs.inert).toBe(''); // 重刷后按新状态把背景锁上
  });

  it('body 自己的 class 改动也算触发（同一份谓词的另一支）', () => {
    const b = boot({ shown: false });
    const base = b.reads();
    b.observers[0]!.fire([{ target: b.body }]);
    expect(b.reads()).toBe(base + 1);
  });

  it('背景节点不存在时不炸（取不到就返回，不给整段添异常路径）', () => {
    expect(() => boot({ shown: true, appExists: false })).not.toThrow();
  });
});
