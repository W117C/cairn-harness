// 面板重绘时的用户态保全（capture/restore 这一对）。
// 为什么要有：renderSide 只在 HTML 变了时才重写 innerHTML，而「变了」通常只是多一条评论、多一行工具。
// 面板从只读变成可写（diff 卡的行级评审）之后，送完一条意见就把用户正在审的那屏补丁塌回折叠态，
// 等于每次修正都要重新点开、重新找位置——这是返工，不是刷新。
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

/** NodeList 的形状用数组冒充（够用：forEach + 下标）。
 *  attrOpen 恒 false = 模拟「用户手点开、但 HTML 属性没写 open」——
 *  读属性而不是读实时属性的实现会在这里现形。 */
function fakeSection(open: boolean[], attrOpen = false) {
  const nodes = open.map((o, i) => ({ open: o, hasAttribute: () => attrOpen, idx: i }));
  return { querySelectorAll: () => nodes };
}
const openOf = (sec: any) => sec.querySelectorAll().map((d: any) => d.open);

function load() {
  const ctx: any = {};
  const a = source.indexOf('/* 重绘时的用户态保全。');
  const b = source.indexOf('function renderSide() {', a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  expect(source.indexOf('/* 重绘时的用户态保全。', a + 1), '起点标记出现两次 ⇒ 切片悄悄撑大').toBe(-1);
  runInNewContext(source.slice(a, b), ctx);
  return ctx;
}

const ctx = load();

it('抓到的是用户实时展开的那几项（读 .open，不是 hasAttribute("open")）', () => {
  expect(ctx.capturePanelState(fakeSection([true, false, true], false))).toEqual([0, 2]);
});

it('全折叠时是空集，restore 收空集直接不动手', () => {
  const opened = ctx.capturePanelState(fakeSection([false, false]));
  expect(opened).toEqual([]);
  const after = fakeSection([false, false]);
  ctx.restorePanelState(after, opened);
  expect(openOf(after)).toEqual([false, false]);
});

it('按同序号展开回来（重绘后的 DOM 是全新的，只能靠序号对上）', () => {
  const st = ctx.capturePanelState(fakeSection([true, false, true], false));
  const after = fakeSection([false, false, false], false);   // innerHTML 重写 ⇒ 全新节点
  ctx.restorePanelState(after, st);
  expect(openOf(after)).toEqual([true, false, true]);
});

it('重绘后折叠块变少 ⇒ 多余序号丢掉不抛（少一列是常态，不能红在这里）', () => {
  const after = fakeSection([false, false]);
  ctx.restorePanelState(after, [1, 7]);
  expect(openOf(after)).toEqual([false, true]);
});

it('快照缺失时什么都不做（调用方没抓到也不能崩在恢复这一步）', () => {
  const after = fakeSection([false]);
  expect(() => ctx.restorePanelState(after, null)).not.toThrow();
  expect(openOf(after)).toEqual([false]);
});

/* 接线半边：这两个函数各自正确不等于 renderSide 真用了它们——
   「抓了不还原」与「压根没抓」是同一种缺陷的两副面孔。 */
it('renderSide 的重写分支成对使用这一对（先抓 → 再写 → 后还）', () => {
  const a = source.indexOf('function renderSide() {');
  const body = source.slice(a, a + 1800);
  const cap = body.indexOf('capturePanelState(section)');
  const write = body.indexOf('section.innerHTML = html;');
  const res = body.indexOf('restorePanelState(section, kept)');
  expect(cap).toBeGreaterThanOrEqual(0);
  expect(res).toBeGreaterThanOrEqual(0);
  expect(cap).toBeLessThan(write);
  expect(write).toBeLessThan(res);
});
