import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

// R1b B3：折叠此前是两套委托处理器（卡片认 data-card-toggle，工具认 .ti-head/.tg-head 类名）。
// 合并成一个处理器 + 一个属性名后，真正的风险是**就近优先级**：点一个工具项的头，
// 只能收这个项，不能把整个「执行过程」组一起收掉。本文件就测这条。
const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

type N = {
  cls: string[]; attrs: Record<string, string>; parent?: N;
  toggled: number; aria: string[];
  closest: (sel: string) => N | undefined;
};
function node(cls: string[], attrs: Record<string, string> = {}, parent?: N): N {
  const n: N = { cls, attrs, parent, toggled: 0, aria: [], closest: () => undefined };
  n.closest = (sel: string) => closest(n, sel);
  return n;
}
function hasClass(n: N, c: string) { return n.cls.includes(c); }
function closest(n: N | undefined, sel: string): N | undefined {
  const want = sel.split(',').map((s) => s.trim());
  for (let cur = n; cur; cur = cur.parent) {
    if (want.some((w) => (w.startsWith('[') ? w.slice(1, -1) in cur!.attrs : hasClass(cur, w.slice(1))))) return cur;
  }
  return undefined;
}
/** 把节点变成可被处理器操作的壳：classList.toggle 记次数，setAttribute 记 aria-expanded。 */
function wire(n: N): N {
  (n as N & { classList: unknown }).classList = {
    toggle(c: string, on?: boolean) {
      n.toggled++;
      const want = on ?? !hasClass(n, c);
      if (want) { if (!hasClass(n, c)) n.cls.push(c); return true; }
      n.cls = n.cls.filter((x) => x !== c);
      return false;
    },
    contains: (c: string) => hasClass(n, c),
    add: (c: string) => { if (!hasClass(n, c)) n.cls.push(c); },
  };
  (n as N & { setAttribute: unknown }).setAttribute = (k: string, v: string) => { n.attrs[k] = v; n.aria.push(v); };
  return n;
}

function bootHandler() {
  const handlers: ((e: unknown) => void)[] = [];
  const followCard = vi.fn();
  const context: Record<string, unknown> = {
    document: { addEventListener: (type: string, fn: (e: unknown) => void) => { if (type === 'click') handlers.push(fn); } },
    followCard,
  };
  const a = source.indexOf('/* 折叠的唯一实现');
  const b = source.indexOf('\nrender();', a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  runInNewContext(source.slice(a, b), context);
  return { click: (target: N) => handlers.forEach((fn) => fn({ target: { closest: (sel: string) => closest(target, sel) } })), followCard, count: handlers.length };
}

const head = (cls: string, box: N): N => wire(node([cls, 'card-head'], { 'data-tool-toggle': '', 'aria-expanded': 'false' }, box));

it('折叠委托处理器只剩一个，且只认一个属性名', () => {
  const { count } = bootHandler();
  expect(count).toBe(1);
  // 旧属性名不得再出现在任何生产代码里（注释里的历史回顾除外）。
  expect(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).not.toContain('data-card-toggle');
});

it('点工具项的头：只收这个项，不收整个执行过程组', () => {
  const { click } = bootHandler();
  const group = wire(node(['toolgroup', 'collapsed']));
  const item = wire(node(['tool-item', 'collapsed'], {}, group));
  const tgHead = head('tg-head', group);
  const tiHead = head('ti-head', item);
  click(tiHead);
  expect(item.toggled).toBe(1);
  expect(group.toggled).toBe(0);
  expect(tiHead.attrs['aria-expanded']).toBe('true');
  // 组头保持初始未展开态：说明点内层项没有连带改外层（就近优先级正确）
  expect(tgHead.aria).toEqual([]);
  expect(tgHead.attrs['aria-expanded']).toBe('false');
});

it('点组头：收整组，不动里面的工具项', () => {
  const { click } = bootHandler();
  const group = wire(node(['toolgroup', 'collapsed']));
  const item = wire(node(['tool-item', 'collapsed'], {}, group));
  const tgHead = head('tg-head', group);
  click(tgHead);
  expect(group.toggled).toBe(1);
  expect(item.toggled).toBe(0);
});

it('点卡片头：收卡片并触发右栏情境跟随', () => {
  const { click, followCard } = bootHandler();
  const card = wire(node(['card', 'collapsed']));
  const h = head('card-head', card);
  h.attrs['data-card'] = 'diff';
  click(h);
  expect(card.toggled).toBe(1);
  expect(followCard).toHaveBeenCalledTimes(1);
});

it('非折叠头（如普通按钮）不产生任何副作用', () => {
  const { click, followCard } = bootHandler();
  const box = wire(node(['msg', 'ai']));
  const plain = wire(node(['icon-btn'], {}, box));
  click(plain);
  expect(box.toggled).toBe(0);
  expect(followCard).not.toHaveBeenCalled();
});
