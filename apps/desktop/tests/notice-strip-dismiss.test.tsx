// 普通提示条「停留即走」判卷（2026-11-03 业主：截图里「权限档已切到…」那条常驻）。
//
// 与 error-strip-dismiss.test.tsx 同一套真 DOM + 假时钟宿主：时序行为必须真跑 effect，
// SSR 与源码哨兵对「删掉计时器」都是恒真的。这里只钉提示条自己的三件事：
// ① 到点走且只走一次；② 换消息重新计时；③ 悬停/聚焦暂停（a11y 底线）。
// 另加两条接线哨兵：WorkbenchView 的两处 lastNotice 都走 NoticeStrip；编辑分支的常驻说明条不动。
import "./helpers/dom-host-install";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fire, type ElementNode } from "./helpers/dom-host";
import { NOTICE_DISMISS_MS, NoticeStrip } from "../src/renderer/components/NoticeStrip";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const STEP_MS = 500;

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await act(async () => { await Promise.resolve(); });
}
async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

type Props = { message: string; onDismiss: () => void };

async function mountNotice(onDismiss: () => void, message = "权限档已切到「完全允许」") {
  const host = globalThis.document.createElement("div") as unknown as HTMLElement & ElementNode;
  (globalThis.document.body as unknown as ElementNode).appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host as unknown as Element);
    root.render(createElement(NoticeStrip, { message, onDismiss }) as ReactNode);
  });
  const put = async (props: Props): Promise<void> => {
    await act(async () => { root?.render(createElement(NoticeStrip, props) as ReactNode); });
  };
  const unmount = async (): Promise<void> => { await act(async () => { root?.unmount(); }); };
  const strip = (): ElementNode => host.childNodes[host.childNodes.length - 1] as ElementNode;
  return { host, put, unmount, strip };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
});
afterEach(() => {
  vi.useRealTimers();
  (globalThis.document.body as unknown as ElementNode).childNodes.length = 0;
});

describe("提示条不常驻：停留 NOTICE_DISMISS_MS 即自己消失", () => {
  it("到点调用 onDismiss，一次且仅一次；在此之前一直在", async () => {
    const onDismiss = vi.fn();
    const { unmount } = await mountNotice(onDismiss);
    await tick(NOTICE_DISMISS_MS - STEP_MS);
    expect(onDismiss).not.toHaveBeenCalled();
    await tick(STEP_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await tick(NOTICE_DISMISS_MS * 2);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("换一条新提示重新计时：旧的倒计时不顶用", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { put, unmount } = await mountNotice(first, "已引用：a.ts");
    await tick(NOTICE_DISMISS_MS - STEP_MS);
    await put({ message: "已引用：b.ts", onDismiss: second });
    await tick(STEP_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    await tick(NOTICE_DISMISS_MS - STEP_MS);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    await unmount();
  });

  it("悬停暂停、移开后接着剩下的时间走", async () => {
    const onDismiss = vi.fn();
    const { strip, unmount } = await mountNotice(onDismiss);
    await tick(NOTICE_DISMISS_MS / 2);
    await act(async () => { fire(strip(), "onMouseEnter"); });
    await tick(NOTICE_DISMISS_MS * 2);
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => { fire(strip(), "onMouseLeave"); });
    await tick(NOTICE_DISMISS_MS / 2 - STEP_MS);
    expect(onDismiss).not.toHaveBeenCalled();
    await tick(STEP_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("键盘焦点进入条内同样暂停（a11y 底线）", async () => {
    const onDismiss = vi.fn();
    const { strip, unmount } = await mountNotice(onDismiss);
    await tick(NOTICE_DISMISS_MS / 2);
    await act(async () => { fire(strip(), "onFocusCapture"); });
    await tick(NOTICE_DISMISS_MS * 2);
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => { fire(strip(), "onBlurCapture"); });
    await tick(NOTICE_DISMISS_MS / 2);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("关闭钮仍在：点了立刻收走，不用等倒计时", async () => {
    const onDismiss = vi.fn();
    const { strip, unmount } = await mountNotice(onDismiss);
    const button = strip().childNodes.find((n) => (n as ElementNode).tagName?.toLowerCase() === "button") as ElementNode | undefined;
    expect(button, "提示条缺关闭钮").toBeDefined();
    await act(async () => { fire(button as ElementNode, "onClick"); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await unmount();
  });
});

describe("接线哨兵", () => {
  it("两处 lastNotice 都走 NoticeStrip；编辑分支的常驻说明条不许被改成自动消失", () => {
    const src = read("../src/renderer/panes/WorkbenchView.tsx");
    expect((src.match(/<NoticeStrip message=\{lastNotice\}/g) ?? []).length).toBe(2);
    // 原文件有三条 .notice-strip：两条 lastNotice 已换组件，只剩编辑分支那一条。
    expect((src.match(/className="notice-strip"/g) ?? []).length).toBe(1);
    // 「正在新分支里编辑第 N 轮消息」是模式指示，不是回执——它必须留到用户离开分支。
    expect(src).toContain("正在新分支里编辑第 {editCtx.round} 轮消息");
  });

  it("时长刻度：4s 档（toast 默认档），不跟错误条的 6.5s 混用", () => {
    expect(NOTICE_DISMISS_MS).toBe(4000);
  });
});
