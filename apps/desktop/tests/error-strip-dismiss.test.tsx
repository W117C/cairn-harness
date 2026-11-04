// 错误条「停留即走」判卷（2026-11-03 业主裁决）。
//
// 业主原话：「这个需要优化，不要常驻，停留几秒就自己消失」（截图：一条 RunRequest.model 未登记 的红条）。
// 本文件之前那条口径「关闭钮（只由用户关闭，不自动消失）」作废——见 ErrorStrip.tsx 文件头。
//
// 三条钉死的契约（§1 到点走 / §2 换消息重计时 / §3 悬停与聚焦暂停），加两条小钉（§4 时长刻度、
// §5 接线与动效纪律）。本仓桌面端无 jsdom（见 tests/helpers/dom-host.ts 头注），所以这里自己装
// 一个最小 DOM 宿主 + **真** createRoot 挂载：时序行为必须真跑 effect 才算判过，SSR 里没有 effect，
// 源码哨兵对「把计时器删掉」这种变异又是恒真的。§5 的源码/样式哨兵只钉「接线在不在」，不算行为证据。
//
// 本文件顶部必须最先 import 装宿主模块（见 helpers/dom-host-install.ts 头注）。
import "./helpers/dom-host-install";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fire, reactPropsOf, type ElementNode } from "./helpers/dom-host";
import { AUTO_DISMISS_MS, ErrorStrip } from "../src/renderer/components/ErrorStrip";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const HOLD_MS = 2000;      // §3 里模拟「鼠标停着读一会儿」的时长
const STEP_MS = 500;       // 每次推时钟的步长

type StripProps = { message: string; onDismiss: () => void };

/** 让 React 的提交跑干净：连让几轮微任务，再包一次 act。
 *  act 在这里只当「同步冲洗」用——假时钟不伪造 queueMicrotask/setImmediate，调度器照常跑，
 *  act 结束时的同步冲洗把剩余工作一次做完，于是断言读到的一定是提交完的状态。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await act(async () => { await Promise.resolve(); });
}

/** 推时钟 + 冲洗。 */
async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

/** 真挂载一条错误条，返回宿主与两个动作：put=换 props 重渲染，unmount=卸载。 */
async function mountErrorStrip(onDismiss: () => void, message = "RunRequest.model 未登记") {
  const host = globalThis.document.createElement("div") as unknown as HTMLElement & ElementNode;
  (globalThis.document.body as unknown as ElementNode).appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host as unknown as Element);
    root.render(createElement(ErrorStrip, { message, onDismiss }) as ReactNode);
  });
  const put = async (props: StripProps): Promise<void> => {
    await act(async () => { root?.render(createElement(ErrorStrip, props) as ReactNode); });
  };
  // 卸载要把计时器一并拆掉，否则前面用例的残留 effect 会在后面再点一次 onDismiss。
  const unmount = async (): Promise<void> => { await act(async () => { root?.unmount(); }); };
  return { host, put, unmount };
}

const stripNode = (host: ElementNode): ElementNode => host.childNodes[host.childNodes.length - 1] as ElementNode;

// 假时钟只伪造「时间」这一类（setTimeout/Date），**不**碰 setImmediate/queueMicrotask：
// React 调度器靠它们排工作，一起冻住会踩到 React 的「Should not already be working」。
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
});
afterEach(() => {
  vi.useRealTimers();
  // 每个用例卸载后清干净 body：宿主树是全局的，留着会跨用例串台。
  (globalThis.document.body as unknown as ElementNode).childNodes.length = 0;
});

describe("错误条不常驻：停留 AUTO_DISMISS_MS 即自己消失（业主 2026-11-03）", () => {
  it("到点调用 onDismiss，一次且仅一次；在此之前一直不消失", async () => {
    const onDismiss = vi.fn();
    const { unmount } = await mountErrorStrip(onDismiss);

    await tick(AUTO_DISMISS_MS - STEP_MS);
    expect(onDismiss).not.toHaveBeenCalled();          // 还没到点，条还在

    await tick(STEP_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);        // 到点一次

    await tick(AUTO_DISMISS_MS * 2);
    expect(onDismiss).toHaveBeenCalledTimes(1);        // 不重复点
    await unmount();
  });

  it("换消息重新计时：新错误从头走整段，旧的那笔账不顶用", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { put, unmount } = await mountErrorStrip(first, "RunRequest.model 未登记");

    await tick(AUTO_DISMISS_MS - STEP_MS);
    // 新错误顶上：整条换成新 onDismiss，倒计时从整段重新起
    await put({ message: "预览失败（spec）", onDismiss: second });
    await tick(STEP_MS);
    expect(first).not.toHaveBeenCalled();              // 关键：不是「按老账到点」
    expect(second).not.toHaveBeenCalled();

    await tick(AUTO_DISMISS_MS - STEP_MS);
    expect(second).toHaveBeenCalledTimes(1);           // 从换消息那一刻起整段走满
    expect(first).not.toHaveBeenCalled();
    await unmount();
  });

  it("载荷每帧新建对象也不许把倒计时归零（否则条永远不走＝换个姿势常驻）", async () => {
    const onDismiss = vi.fn();
    const { put, unmount } = await mountErrorStrip(onDismiss, "同样一条错");

    await tick(AUTO_DISMISS_MS / 2);
    for (let i = 0; i < 5; i++) {
      await put({ message: "同样一条错", onDismiss });  // 同内容、新 props 对象
      await tick(STEP_MS);
    }
    expect(onDismiss).not.toHaveBeenCalled();          // 5 次喂新对象共走了 2.5s，账没归零
    await tick(AUTO_DISMISS_MS / 2 + STEP_MS);         // 从挂载算起已越过整段
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("悬停暂停倒计时：鼠标按在条上读着，不被抽走；移开后接着剩下的时间走", async () => {
    const onDismiss = vi.fn();
    const { host, unmount } = await mountErrorStrip(onDismiss);
    const strip = stripNode(host);

    await tick(AUTO_DISMISS_MS / 2);
    await act(async () => { fire(strip, "onMouseEnter"); });                 // 鼠标停上来
    await tick(HOLD_MS);                               // 读了 2s
    await tick(AUTO_DISMISS_MS);                       // 远超原定到点时刻
    expect(onDismiss).not.toHaveBeenCalled();          // 还在读，不许抽走

    await act(async () => { fire(strip, "onMouseLeave"); });                 // 移开：接着剩下的 3.25s 走
    await tick(AUTO_DISMISS_MS / 2 - STEP_MS);
    expect(onDismiss).not.toHaveBeenCalled();
    await tick(STEP_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("键盘焦点进入条内（Tab 到了关闭钮）同样暂停——a11y 底线，不是可选项", async () => {
    const onDismiss = vi.fn();
    const { host, unmount } = await mountErrorStrip(onDismiss);
    const strip = stripNode(host);

    await tick(AUTO_DISMISS_MS / 2);
    await act(async () => { fire(strip, "onFocusCapture"); });               // 焦点落进条内
    await tick(AUTO_DISMISS_MS * 2);
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => { fire(strip, "onBlurCapture"); });                // 焦点离开，接着剩下的走
    await tick(AUTO_DISMISS_MS / 2);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("悬停后换消息，新错误仍有完整的阅读时间", async () => {
    const onDismiss = vi.fn();
    const { host, put, unmount } = await mountErrorStrip(onDismiss);
    await tick(4000);
    await act(async () => { fire(stripNode(host), "onMouseEnter"); });
    await put({ message: "另一条错误", onDismiss });
    await act(async () => { fire(stripNode(host), "onMouseLeave"); });
    await tick(AUTO_DISMISS_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();
    await tick(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("鼠标离开时焦点仍在条内，继续暂停", async () => {
    const onDismiss = vi.fn();
    const { host, unmount } = await mountErrorStrip(onDismiss);
    const strip = stripNode(host);
    await act(async () => { fire(strip, "onMouseEnter"); fire(strip, "onFocusCapture"); });
    await act(async () => { fire(strip, "onMouseLeave"); });
    await tick(AUTO_DISMISS_MS * 2);
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => { fire(strip, "onBlurCapture"); });
    await tick(AUTO_DISMISS_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await unmount();
  });
});

describe("时长与接线", () => {
  it("时长刻度落在业主说的「几秒」里（6s 读完一条、8s 起就该走）", () => {
    expect(AUTO_DISMISS_MS).toBeGreaterThanOrEqual(6000);
    expect(AUTO_DISMISS_MS).toBeLessThanOrEqual(8000);
  });

  it("接线在组件里：计时器 + 悬停/聚焦暂停钩子；关闭钮保留（用户仍可主动关）", () => {
    const src = read("../src/renderer/components/ErrorStrip.tsx");
    // 2026-11-03 同批：时序逻辑抽到 useAutoDismiss 与提示条共用（同一段逻辑不许抄两份）。
    expect(src).toContain("useAutoDismiss(");
    expect(src).toContain("{...containerProps}");
    const hook = read("../src/renderer/components/useAutoDismiss.ts");
    expect(hook).toContain("setTimeout(");
    expect(hook).toContain("onMouseEnter:");
    expect(hook).toContain("onMouseLeave:");
    expect(hook).toContain("onFocusCapture:");
    expect(hook).toContain("onBlurCapture:");
    expect(src).toContain("onClick={props.onDismiss}");
    // 旧口径作废并注明被推翻的日期：允许注释里**引用**旧口径当撤销记录（那正是要留下的证据），
    // 但断言不许在实现代码里看到它对当代行为的表述——所以钉「注释行不是现在的口径」这两条。
    expect(src).toContain("2026-11-03");
    expect(src).toContain("推翻本条早先的");
    expect(src).toMatch(/业主 2026-11-03 指定|2026-11-03 业主裁决/);
  });

  it("动效纪律：只复用既有令牌/关键帧，不许本轮新造；reduced-motion 有让路", () => {
    const styles = read("../src/renderer/styles.css");
    // 令牌定义在 tokens.css（响应档 --t-instant/--t-fast/… 的唯一定义处），关键帧在 styles.css。
    const tokens = read("../src/renderer/tokens.css");
    const at = styles.indexOf("\n.error-strip {");
    const rule = styles.slice(at, styles.indexOf("}", at));
    expect(rule).toContain("animation: sp-flash-in var(--t-");
    const animation = rule.match(/animation: ([^;]+);/)?.[1] ?? "";
    const used = [...animation.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const token of used) {
      // 「本来就在表里」＝定义处存在，且**不在** styles.css 的 .error-strip 规则里现定义
      expect(`${tokens}${styles}`, token).toContain(`${token}:`);
      expect(rule, token).not.toContain(`${token}:`);
    }
    expect(styles).toContain("@keyframes sp-flash-in");     // 关键帧本来就有（不是本轮加的）
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation-duration: 0\.01ms !important/);
  });

  it("真挂载确实渲染成了 alert，handler 就在节点上（不是空跑）", async () => {
    const onDismiss = vi.fn();
    const { host, unmount } = await mountErrorStrip(onDismiss, "RunRequest.model 未登记");
    const strip = stripNode(host);
    expect(strip.tagName).toBe("DIV");
    expect(strip.getAttribute("role")).toBe("alert");
    expect(reactPropsOf(strip)?.onMouseEnter).toBeTypeOf("function");
    expect(host.textContent).toBe("RunRequest.model 未登记");
    await unmount();
  });
});
