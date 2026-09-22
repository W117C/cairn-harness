// 转录虚拟化的「挂载收敛」判据：打开会话时滚到底，测高之后的那一拍必须把末尾单元也挂上。
//
// 为什么在 vm 里跑源码而不是只靠真窗口：panels-check 的 B20 相实测过「盘上 30 条、#eventCount 30、
// 审阅页读得到、转录只有 8 张卡、未挂载区占位 190.273px」——mount 自己停在半挂载态。真窗口里这条
// 受宿主 rAF/遮挡影响会漂（AGENTS.md 记的假红主因），而这段是纯 DOM 算术：给它一个可控假 DOM
// 就能确定性复现，不必每次改渲染都花一轮真启动。假 DOM 只实现 mountHistory 真用到的那几件事。
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CHILD_IMPORT } from "./renderer-vm-module";

const SOURCE = readFileSync(new URL("../src/renderer/history-window.js", import.meta.url), "utf8");

/** 整模块剥成脚本（不止分组段）：mountHistory 要连 windowRange 一起跑。 */
function moduleScript(): string {
  if (!SOURCE.includes(CHILD_IMPORT)) throw new Error("history-window.js 的准入 import 改形了——同步本文件的剥法");
  return SOURCE.replaceAll("export function ", "function ").replaceAll(CHILD_IMPORT, "");
}

const UNIT_REAL = 78;     // 单元真实高度缺省值（mount 里再 +12 margin ⇒ 90）
const VIEW = 640;         // 视口高
/** 高度不齐才有虚拟化那味道：末尾那条是截断卡（实测 190.273px），头几条是用户气泡。 */
const realHeightOf = (index: number, total: number): number =>
  index === 0 ? 40 : index === total - 1 ? 190 : UNIT_REAL;

type FakeEl = Record<string, unknown> & {
  kind: string;
  children: FakeEl[];
  parent: FakeEl | null;
  style: Record<string, string>;
  attrs: Record<string, string>;
  mounted: boolean;
  index: number;
};

function makeDom(unitCount: number) {
  const listeners = new Map<string, Array<() => void>>();
  const frames: Array<() => void> = [];
  let scrollTop = 0;

  const heightOf = (el: FakeEl): number => {
    if (el.attrs["aria-hidden"] === "true") return Number.parseFloat(el.style.height || "0") || 0;
    if (el.kind === "inner" || el.kind === "scroller") return el.children.reduce((a, c) => a + heightOf(c), 0);
    return el.mounted ? Number(el.realHeight ?? UNIT_REAL) + 12 : 0;
  };
  const layoutY = (el: FakeEl): number => {
    const parent = el.parent;
    if (!parent) return 0;
    let y = 0;
    for (const sib of parent.children) {
      if (sib === el) break;
      y += heightOf(sib);
    }
    return y + layoutY(parent);
  };
  const doc: Record<string, unknown> = { createElement: (t: string) => makeNode(t) };
  const makeNode = (kind: string): FakeEl => {    const el = {
      kind, index: -1, children: [], parent: null, style: {}, attrs: {}, mounted: false,
    } as FakeEl;
    el.setAttribute = (k: string, v: string) => { el.attrs[k] = v; };
    el.getAttribute = (k: string) => el.attrs[k] ?? null;
    el.append = (...nodes: FakeEl[]) => { for (const n of nodes) { n.parent = el; el.children.push(n); } };
    el.insertBefore = (child: FakeEl, ref: FakeEl | null) => {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      const at = ref ? el.children.indexOf(ref) : el.children.length;
      el.children.splice(at < 0 ? el.children.length : at, 0, child);
      child.parent = el;
    };
    el.remove = () => {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
      el.parent = null;
    };
    Object.defineProperty(el, "nextSibling", {
      get: () => (el.parent ? el.parent.children[el.parent.children.indexOf(el) + 1] ?? null : null),
    });
    Object.defineProperty(el, "ownerDocument", { get: () => doc });
    el.getBoundingClientRect = () => ({ top: layoutY(el) - scrollTop, height: heightOf(el) });
    return el;
  };

  const scroller = makeNode("scroller");
  const inner = makeNode("inner");
  scroller.children = [inner];
  inner.parent = scroller;
  scroller.style.overflowAnchor = "";
  scroller.addEventListener = (type: string, fn: () => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  };
  scroller.removeEventListener = (type: string, fn: () => void) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
  };
  scroller.getBoundingClientRect = () => ({ top: 0, height: VIEW });
  Object.defineProperty(scroller, "clientHeight", { get: () => VIEW });
  Object.defineProperty(scroller, "scrollHeight", { get: () => heightOf(inner) });
  Object.defineProperty(scroller, "scrollTop", {
    get: () => scrollTop,
    set: (v: number) => {
      const next = Math.max(0, Math.min(v, heightOf(inner) - VIEW));
      if (next === scrollTop) return;
      scrollTop = next;
      for (const fn of listeners.get("scroll") ?? []) fn();
    },
  });

  const units = Array.from({ length: unitCount }, (_, i) => ({ key: "u" + String(i), kind: "card", ids: [i] }));
  const renderUnit = (_unit: unknown, index: number) => {
    const el = makeNode("unit");
    el.index = index;
    el.realHeight = realHeightOf(index, unitCount);
    el.mounted = true;
    return el;
  };
  return {
    scroller, inner, units, renderUnit, doc,
    raf: (fn: () => void) => { frames.push(fn); return frames.length; },
    runFrames: (max = 40): number => {
      let n = 0;
      while (frames.length && n < max) { (frames.shift() as () => void)(); n++; }
      return n;
    },
    mountedIndexes: (): number[] =>
      inner.children.filter((c) => c.kind === "unit").map((c) => Number(c.index)),
    spacerHeights: (): number[] =>
      inner.children.filter((c) => c.attrs["aria-hidden"] === "true").map((c) => Number.parseFloat(c.style.height || "0") || 0),
    setScrollTop: (v: number) => { scroller.scrollTop = v; },
  };
}

function mountInVm(dom: ReturnType<typeof makeDom>) {
  const history = runInNewContext(
    moduleScript() + "\n;({ mountHistory })",
    {
      document: dom.doc, requestAnimationFrame: dom.raf, ResizeObserver: undefined,
      entersMainConversation: () => true, console,
    },
  ) as { mountHistory: (a: { container: FakeEl; scroller: FakeEl; units: unknown[]; renderUnit: (u: unknown, i: number) => FakeEl }) => { destroy: () => void } };
  return history.mountHistory({
    container: dom.inner, scroller: dom.scroller, units: dom.units, renderUnit: dom.renderUnit,
  });
}

describe("mountHistory 的挂载收敛（虚拟化最后一拍）", () => {
  it("打开会话滚到底 ⇒ 每个单元都得在 DOM 里（测高后不许把尾巴留在未挂载区）", () => {
    const dom = makeDom(11);
    const handle = mountInVm(dom);
    dom.runFrames();
    dom.setScrollTop(999_999);   // = showHistory 末尾那句 scrollStream(true)
    dom.runFrames();
    const mounted = dom.mountedIndexes();
    const missing = Array.from({ length: 11 }, (_, i) => i).filter((i) => !mounted.includes(i));
    const spacers = dom.spacerHeights();
    handle.destroy();
    expect({ missing, tailSpacer: spacers[spacers.length - 1] ?? 0 }).toEqual({ missing: [], tailSpacer: 0 });
  });

  it("反向对照：会话一长就必须真的虚拟化（不许为了上一条把 400 个单元全挂上）", () => {
    const dom = makeDom(400);
    const handle = mountInVm(dom);
    dom.runFrames();
    const mounted = dom.mountedIndexes();
    handle.destroy();
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(80);   // windowRange 的 max=80：窗口有界
    expect(mounted).not.toContain(0);          // 打开即贴底 ⇒ 头顶那些单元必须在未挂载区
  });
});
