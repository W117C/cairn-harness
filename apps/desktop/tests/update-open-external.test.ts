// 「发现新版本」→ 可点动作 → 主进程 openExternal（运行期判卷；不拿源码 grep 冒充）。
//
// 实测缺陷（P1）：旧实现的 checkUpdate 只把检查结果的 version 拼成「发现新版本 X」
// ⇒ manifest 里的下载页 URL 与更新说明被静默丢掉；渲染层对 openExternal 零调用点
// ⇒ 用户看到"有新版"却无处可去。本文件把这条链拆成四段真跑（每段都执行真代码）：
//   ① 触发「检查更新」：checkUpdateState() 真调 window.agent.checkUpdate()，
//      available 变体的 url / notes 原样带进读数（不丢）。
//   ② 渲染更新面板：UpdateOffer 的真实渲染结果里有版本、更新说明、动作与 URL。
//   ③ 点击动作：点真实按钮 ⇒ window.agent.openExternal 收到的就是那条 url，
//      且不经渲染层自己开浏览器（window.open 零调用）。
//   ④ 主进程拒绝：错误原因被带回并渲染成可见告警（role=alert），不被吞掉。
//
// 环境说明：桌面端 vitest 是 node 环境（无 jsdom / 无 testing-library），
// 所以「点击」用组件真实返回的元素树（UpdateOffer 是无 hook 的纯函数组件，
// 直接调用得到的树与 React 渲染出的树逐字同构），再取真实 onClick 执行。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { UpdateOffer, checkUpdateState, withOpenError } from "../src/renderer/components/SettingsPanel";

const DOWNLOAD_URL = "https://downloads.example.com/cairn/2.0.0/cairn.dmg";
const VERSION = "2.0.0";
const NOTES = "修好了启动崩溃，并换了图标";
/** 主进程拒绝时的原文（apps/desktop/src/main/index.ts 的 http(s) 白名单拒绝语）。 */
const REJECTED = "仅允许打开 http(s) 链接";

let checkUpdate: Mock<() => Promise<unknown>>;
let openExternal: Mock<(url: string) => Promise<{ ok: boolean; error?: string }>>;
let windowOpen: Mock<() => void>;

beforeEach(() => {
  checkUpdate = vi.fn<() => Promise<unknown>>(async () => ({ state: "unconfigured" }));
  openExternal = vi.fn<(url: string) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true }));
  windowOpen = vi.fn<() => void>();
  (globalThis as unknown as { window: unknown }).window = { agent: { checkUpdate, openExternal }, open: windowOpen };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

/** available 态的主进程载荷。 */
const available = (): unknown => ({ state: "available", currentVersion: "1.0.0", version: VERSION, url: DOWNLOAD_URL, notes: NOTES });

type El = ReactElement<{ children?: unknown; onClick?: () => unknown }>;

/** 元素树里找第一个 button（组件元素的 props.children 也要钻进去）。 */
function findButton(node: unknown): El | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (node === null || typeof node !== "object") return null;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === "button") return el as unknown as El;
  return findButton(el.props?.children);
}

/** 取真实按钮的真实 onClick 并执行（不模拟、不替换）。 */
async function clickButton(tree: unknown): Promise<void> {
  const btn = findButton(tree);
  if (btn === null) throw new Error("更新面板里没有可点动作");
  const handler = btn.props.onClick;
  if (typeof handler !== "function") throw new Error("按钮没有 onClick");
  await handler();
}

describe("更新区：发现新版本 → 有去处（运行期）", () => {
  it("① 触发「检查更新」：url 与 notes 原样带进读数（旧实现只剩一句「发现新版本 X」）", async () => {
    checkUpdate.mockResolvedValue(available());
    const state = await checkUpdateState();
    expect(checkUpdate).toHaveBeenCalledTimes(1);
    expect(state.kind).toBe("available");
    if (state.kind !== "available") throw new Error("应是 available 读数");
    expect(state.version).toBe(VERSION);
    expect(state.url).toBe(DOWNLOAD_URL);
    expect(state.notes).toBe(NOTES);
  });

  it("② 渲染更新面板：版本、更新说明、动作与 URL 都在（URL 没被丢）", () => {
    const html = renderToStaticMarkup(
      createElement(UpdateOffer, { version: VERSION, url: DOWNLOAD_URL, notes: NOTES, error: null, onError: () => undefined }),
    );
    expect(html).toContain(VERSION);
    expect(html).toContain(NOTES);
    expect(html).toContain(DOWNLOAD_URL);
    expect(html).toContain("打开下载页");
  });

  it("③ 点「打开下载页」：window.agent.openExternal 收到的就是那条 url（不经渲染层自己开浏览器）", async () => {
    const errors: string[] = [];
    await clickButton(
      UpdateOffer({ version: VERSION, url: DOWNLOAD_URL, notes: NOTES, error: null, onError: (m: string) => { errors.push(m); } }),
    );
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(DOWNLOAD_URL);
    expect(windowOpen).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("④ 主进程拒绝：错误原因被带回，并渲染成可见告警（不吞）", async () => {
    checkUpdate.mockResolvedValue(available());
    openExternal.mockResolvedValue({ ok: false, error: REJECTED });
    const errors: string[] = [];
    const state = await checkUpdateState();
    await clickButton(
      UpdateOffer({ version: VERSION, url: DOWNLOAD_URL, notes: NOTES, error: null, onError: (m: string) => { errors.push(m); } }),
    );
    // 拒绝原因原样带回（没被吞、没被改写）
    expect(errors).toEqual([REJECTED]);
    // 面板把这条原因并进读数（withOpenError），再交给同一张卡渲染＝错误面可见
    const after = withOpenError(state, errors[0]);
    expect(after.kind).toBe("available");
    if (after.kind !== "available") throw new Error("应是 available 读数");
    expect(after.openError).toBe(REJECTED);
    const html = renderToStaticMarkup(
      createElement(UpdateOffer, { version: after.version, url: after.url, notes: after.notes, error: after.openError, onError: () => undefined }),
    );
    expect(html).toContain(REJECTED);
    expect(html).toContain('role="alert"');
  });

  it("⑤ 非 available 态：读数与旧措辞一一对应（未配置 / 出错 / 已是最新）", async () => {
    checkUpdate.mockResolvedValue({ state: "unconfigured" });
    expect((await checkUpdateState()).kind).toBe("unconfigured");
    checkUpdate.mockResolvedValue({ state: "error", message: "更新源不可达" });
    const failed = await checkUpdateState();
    expect(failed.kind === "error" && failed.message).toBe("更新源不可达");
    checkUpdate.mockResolvedValue({ state: "up-to-date", currentVersion: "1.0.0", manifestVersion: "1.0.0" });
    expect((await checkUpdateState()).kind).toBe("up-to-date");
  });
});

// 接线守卫（补上「面板真的用上了这条通道」那一段——上面的运行期用例证明的是行为，
// 这里证明的是行为挂在面板上；不是拿 grep 代替运行期断言）。
describe("接线守卫：面板真的用上了更新通道", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/SettingsPanel.tsx", import.meta.url)), "utf8");

  it("面板渲染 UpdateOffer、检查走 checkUpdateState、点击走 openUpdateUrl", () => {
    expect(src).toContain("<UpdateOffer");
    expect(src).toContain("checkUpdateState()");
    expect(src).toContain("openUpdateUrl(props.url, props.onError)");
  });

  it("渲染层不自己开外链：没有 window.open( 调用，也没有 location.href 赋值", () => {
    expect(src).not.toMatch(/window\.open\s*\(/);
    expect(src).not.toMatch(/location\s*\.\s*href\s*=/);
  });
});
