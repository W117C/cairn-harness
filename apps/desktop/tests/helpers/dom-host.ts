// 判卷用的最小 DOM 宿主（2026-11-03，随 ErrorStrip「停留即走」判卷一起引入）。
//
// 为什么自己造：桌面端 vitest 是 node 环境，本仓**不装 jsdom / happy-dom / testing-library /
// react-test-renderer**（见 tests/render-texture、render-structure 等文件的头注）。很多判卷因此
// 只能走「SSR 结构 + 源码哨兵」两面；而「到点自己消失 / 悬停时不消失」是**定时器行为**，SSR
// 里根本没有 effect，源码哨兵又只能钉「文件里出现过 setTimeout」——那种断言对「计时器被删掉」
// 的变异是**恒真**的，等于没判。所以这里补一个最小的真宿主：React 18 的 createRoot 只用到
// document / 节点树 / addEventListener 这几件东西，够用就行。
//
// 覆盖范围（只到判卷需要的那一层，不假装是浏览器）：
//   · document：createElement / createElementNS / createTextNode / createComment /
//     createDocumentFragment / body / documentElement / activeElement；
//   · 节点树：appendChild / insertBefore / removeChild / childNodes / parentNode /
//     textContent（可读**可写**——React 用 `node.textContent = …` 塞纯文本）；
//   · 事件：addEventListener / removeEventListener / dispatchEvent（React 的合成事件从
//     根容器上派发）；window 上补齐 React 会摸的 HTMLIFrameElement 空类。
// 不覆盖（判卷也不依赖）：布局与几何（getBoundingClientRect 恒 0）、样式计算
// （getComputedStyle 恒空）、选择器（querySelector 恒 null）、事件冒泡的真实路径。
//
// 事件怎么派：React 把 handler 挂在宿主节点自己的 `__reactProps$<非确定性 hash>` 上，
// 所以打事件走 reactPropsOf()（按前缀取，不写死 hash）+ callReactHandler()。
export function installDomHost(): void {
  const doc = documentRef();
  const win = windowRef(doc);
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = doc;
  g.window = win;
  for (const name of [
    "HTMLElement", "Element", "Node", "Document", "DocumentFragment", "HTMLIFrameElement",
    "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLButtonElement",
    "HTMLAnchorElement", "SVGElement", "Event", "MouseEvent", "KeyboardEvent", "FocusEvent",
    "navigator", "requestAnimationFrame", "cancelAnimationFrame",
  ]) {
    if (win[name] === undefined) continue;
    // Node 自带 navigator / requestAnimationFrame 这类**只读取值器**，直接赋值会抛
    // 「has only a getter」⇒ 一律走 defineProperty 覆盖。
    Object.defineProperty(g, name, { value: win[name], writable: true, configurable: true, enumerable: true });
  }
}

/** React 是否已经把这个节点当成可提交的宿主（判卷用来看「挂上了没有」）。 */
export function reactPropsOf(node: unknown): Record<string, unknown> | null {
  if (node === null || typeof node !== "object") return null;
  for (const key of Object.keys(node as object)) {
    if (key.startsWith("__reactProps")) return (node as Record<string, Record<string, unknown>>)[key] ?? null;
  }
  return null;
}

/** 调 React 的合成 handler（click / mouseenter / focus 都走这条）。 */
export function fire(container: ElementNode, type: string, props: Record<string, unknown> | null = reactPropsOf(container)): void {
  const handler = props?.[type];
  if (typeof handler !== "function") throw new Error(`该节点没有 ${type} handler`);
  const event = {
    type,
    target: container,
    currentTarget: container,
    nativeEvent: { type },
    defaultPrevented: false,
    preventDefault(): void { this.defaultPrevented = true; },
    stopPropagation(): void {},
    persist(): void {},
  };
  (handler as (e: unknown) => void)(event);
}

export interface ElementNode {
  nodeType: number;
  childNodes: ElementNode[];
  parentNode: ElementNode | null;
  ownerDocument: unknown;
  textContent: string;
  tagName?: string;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  hasAttribute(k: string): boolean;
  removeAttribute(k: string): void;
  addEventListener(t: string, fn: unknown): void;
  removeEventListener(t: string, fn: unknown): void;
  dispatchEvent(ev: { type: string }): boolean;
  focus(): void;
  blur(): void;
  getBoundingClientRect(): Record<string, number>;
  appendChild(c: ElementNode): ElementNode;
  insertBefore(c: ElementNode, ref: ElementNode | null): ElementNode;
  removeChild(c: ElementNode): ElementNode;
  [k: string]: unknown;
}

class ShNode {
  nodeType: number;
  childNodes: ElementNode[] = [];
  parentNode: ElementNode | null = null;
  ownerDocument: unknown = null;

  constructor(nodeType: number) { this.nodeType = nodeType; }

  appendChild(c: ElementNode): ElementNode {
    if (c.parentNode !== null) c.parentNode.removeChild(c);
    this.childNodes.push(c);
    c.parentNode = this as unknown as ElementNode;
    return c;
  }

  insertBefore(c: ElementNode, ref: ElementNode | null): ElementNode {
    if (c.parentNode !== null) c.parentNode.removeChild(c);
    const at = ref === null ? -1 : this.childNodes.indexOf(ref);
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, c);
    c.parentNode = this as unknown as ElementNode;
    return c;
  }

  removeChild(c: ElementNode): ElementNode {
    const at = this.childNodes.indexOf(c);
    if (at >= 0) this.childNodes.splice(at, 1);
    c.parentNode = null;
    return c;
  }

  get firstChild(): ElementNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): ElementNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }

  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v: string) {
    this.childNodes = [];
    if (v !== "" && v !== null && v !== undefined) {
      const t = new ShText(String(v));
      t.ownerDocument = this.ownerDocument;
      this.appendChild(t as unknown as ElementNode);
    }
  }
}

class ShText extends ShNode {
  nodeValue: string;
  constructor(text: string) {
    super(3);
    this.nodeValue = text;
    // 文本节点不是元素：元素侧那几个方法给成 no-op，好让它和元素共一份节点形状
    //（调用点按 tagName 分派，文本节点永远走不到那几个方法；形状只为让真 DOM 调用不炸）。
    Object.assign(this, {
      tagName: "#text",
      setAttribute(): void {}, getAttribute: () => null, hasAttribute: () => false, removeAttribute(): void {},
      addEventListener(): void {}, removeEventListener(): void {}, dispatchEvent: () => true,
      focus(): void {}, blur(): void {},
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
    });
  }
  get textContent(): string { return this.nodeValue; }
  set textContent(v: string) { this.nodeValue = v; }
}

class ShComment extends ShNode {
  nodeValue = "";
  constructor() { super(8); }
  get textContent(): string { return ""; }
  set textContent(_v: string) { /* 注释没有文本 */ }
}

class ShElement extends ShNode {
  tagName: string;
  nodeName: string;
  localName: string;
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners: Record<string, unknown[]> = {};

  constructor(tag: string) {
    super(1);
    this.tagName = String(tag).toUpperCase();
    this.nodeName = this.tagName;
    this.localName = String(tag).toLowerCase();
  }

  setAttribute(k: string, v: string): void { this.attributes[k] = String(v); }
  getAttribute(k: string): string | null { return k in this.attributes ? this.attributes[k] : null; }
  hasAttribute(k: string): boolean { return k in this.attributes; }
  removeAttribute(k: string): void { delete this.attributes[k]; }
  addEventListener(t: string, fn: unknown): void { (this.listeners[t] ??= []).push(fn); }
  removeEventListener(t: string, fn: unknown): void {
    this.listeners[t] = (this.listeners[t] ?? []).filter((f) => f !== fn);
  }
  dispatchEvent(ev: { type: string }): boolean {
    for (const fn of this.listeners[ev.type] ?? []) (fn as (e: unknown) => void)(ev);
    return true;
  }
  focus(): void { (this.ownerDocument as { activeElement: unknown }).activeElement = this; }
  blur(): void {
    const d = this.ownerDocument as { activeElement: unknown; body: unknown };
    if (d.activeElement === this) d.activeElement = d.body;
  }
  getBoundingClientRect(): Record<string, number> {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
  get children(): ElementNode[] { return this.childNodes.filter((c) => c.nodeType === 1); }

  get className(): string { return this.attributes.class ?? ""; }
  set className(v: string) { this.attributes.class = v; }
}

function windowRef(doc: unknown): Record<string, unknown> {
  let nextFrame = 0;
  const win: Record<string, unknown> = {
    document: doc,
    navigator: { userAgent: "cairn-test-host" },
    addEventListener(): void {},
    removeEventListener(): void {},
    dispatchEvent(): boolean { return true; },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    matchMedia: () => ({ matches: false, addEventListener(): void {}, removeEventListener(): void {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "", animationName: "" }),
    requestAnimationFrame: (cb: (t: number) => void): number => {
      const id = ++nextFrame;
      globalThis.setTimeout(() => cb(Date.now()), 0);
      return id;
    },
    cancelAnimationFrame(): void {},
  };
  win.window = win;
  win.self = win;
  win.top = win;
  win.parent = win;
  // React 会在提交阶段做 `el instanceof win.HTMLIFrameElement` 这类判断（getActiveElementDeep），
  // 右侧不是对象就抛「Right-hand side of 'instanceof' is not an object」⇒ 宿主类必须补齐。
  for (const name of [
    "HTMLElement", "Element", "Node", "Document", "DocumentFragment", "HTMLIFrameElement",
    "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLButtonElement",
    "HTMLAnchorElement", "SVGElement", "Event", "MouseEvent", "KeyboardEvent", "FocusEvent",
  ]) {
    win[name] = class {};
  }
  return win;
}

function documentRef(): Record<string, unknown> {
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null };
  const lambda = {
    createElement: (tag: string): ShElement => {
      const el = new ShElement(tag);
      el.ownerDocument = doc;
      return el;
    },
    createTextNode: (text: string): ShText => {
      const node = new ShText(text);
      node.ownerDocument = doc;
      return node;
    },
    createComment: (): ShComment => new ShComment(),
    createDocumentFragment: (): ShNode => new ShNode(11),
  };
  doc.createElement = lambda.createElement;
  doc.createElementNS = (_ns: string, tag: string) => lambda.createElement(tag);
  doc.createTextNode = lambda.createTextNode;
  doc.createComment = lambda.createComment;
  doc.createDocumentFragment = lambda.createDocumentFragment;
  doc.documentElement = lambda.createElement("html");
  doc.body = lambda.createElement("body");
  doc.head = lambda.createElement("head");
  doc.getElementById = () => null;
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  doc.addEventListener = (): void => {};
  doc.removeEventListener = (): void => {};
  return doc;
}
