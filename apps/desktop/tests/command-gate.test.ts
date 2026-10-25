// 命令动作的**统一前置门**（2026-10-20 独立评审追出的 HIGH 的修法这一半）。
//
// 缺陷形状：macOS 上 `registerAccelerator:false` 是**空操作**（Electron 自己的 typings 标着
// `@platform linux,win32`）⇒ 菜单里那把"渲染层拥有键位"的项照样被系统注册 ⇒
// macOS 把键交给菜单、渲染层 keydown 根本不响 ⇒ **菜单路径绕过了 keydown 那道浮层门**。
// 实测形状：确认卡开着时按 ⌘W ⇒ 会话被关掉，而那张卡还开着。
//
// 修法：键盘路径与菜单路径走**同一道门**（`src/renderer/command-gate.ts`）。
// 本份判卷是**行为面**：DOM 以**可注入的假身**喂进去（桌面端那套 vitest 是 node 环境、
// 不装 jsdom ⇒ 判据要能不依赖真 DOM 才跑得起来），判断本身是纯函数。
// 另配一条**接线钉**：App 的两条入口都必须走这道门（不许各写一份判断）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  CARET_YIELDING_COMMANDS,
  commandAllowed,
  overlayBlocked,
  readGateInput,
  type GateDom,
} from "../src/renderer/command-gate";
import { readAppSurface } from "./helpers/app-surface";

/** 判卷要模拟「焦点在输入框」⇒ 需要浏览器里的 `Element` 全局（桌面端那套 vitest 是 node 环境，没有）。
 *  给它一个最小替身：`closest` 命中 = 可编辑元素。装完复原（不污染别的用例）。 */
class FakeElement {
  constructor(private readonly hit: boolean) {}
  closest(): object | null {
    return this.hit ? {} : null;
  }
}
const g = globalThis as unknown as { Element?: unknown };
const hadElement = "Element" in g;
g.Element = FakeElement;
afterAll(() => {
  if (hadElement) g.Element = (globalThis as unknown as { Element?: unknown }).Element;
  else delete g.Element;
});

/** 假 DOM：只回答门真正问的两件事（有没有模态面、焦点在不在可编辑元素）。 */
function fakeDom(opts: { modal?: boolean; editable?: boolean } = {}): GateDom {
  return {
    querySelector: (selectors: string) => (opts.modal === true && selectors.includes("modal-surface") ? {} : null),
    activeElement: opts.editable === true ? new FakeElement(true) : null,
  };
}

function appSrc(): string {
  return readAppSurface();
}

describe("命令门：浮层与焦点（键盘路径与菜单路径共用）", () => {
  it("读法：模态面在场 ⇒ 读成在场；不在场 ⇒ 读成不在场", () => {
    expect(readGateInput(false, fakeDom()), "没有浮层时不该挡").toEqual({
      paletteOpen: false,
      modalSurfaceOpen: false,
      editableTarget: false,
    });
    expect(readGateInput(false, fakeDom({ modal: true })).modalSurfaceOpen).toBe(true);
    expect(readGateInput(true, fakeDom()).paletteOpen).toBe(true);
  });

  it("浮层挡着：模态面在场 或 面板开着", () => {
    expect(overlayBlocked(readGateInput(false, fakeDom()))).toBe(false);
    expect(overlayBlocked(readGateInput(false, fakeDom({ modal: true })))).toBe(true);
    expect(overlayBlocked(readGateInput(true, fakeDom()))).toBe(true);
  });

  it("模态面在场 ⇒ 菜单命令不动作（那正是 ⌘W 关掉会话、而确认卡还开着那个形状）", () => {
    const blocked = readGateInput(false, fakeDom({ modal: true }));
    expect(commandAllowed("close-session", blocked)).toBe(false);
    expect(commandAllowed("new-session", blocked)).toBe(false);
    const open = readGateInput(false, fakeDom());
    expect(commandAllowed("close-session", open)).toBe(true);
  });

  it("面板开着 ⇒ 菜单命令不动作", () => {
    expect(commandAllowed("palette", readGateInput(true, fakeDom()))).toBe(false);
  });

  it("移动光标的命令在输入框里让给文本编辑（⌘↑/⌘↓ 不劫持光标）", () => {
    const inInput = readGateInput(false, fakeDom({ editable: true }));
    for (const id of CARET_YIELDING_COMMANDS) {
      expect(commandAllowed(id, inInput), `${id} 在输入框里不该劫持`).toBe(false);
    }
    // 别的命令**不**让路（⌘K/⌘N 在输入框里照样是应用级动作）
    expect(commandAllowed("palette", inInput)).toBe(true);
    expect(commandAllowed("new-session", inInput)).toBe(true);
    const notInInput = readGateInput(false, fakeDom());
    expect(commandAllowed("jump-top", notInInput), "焦点不在输入框时 ⌘↑ 该动").toBe(true);
  });

  it("接线：App 的**两条入口**都走这道门（键盘路径 + 菜单路径）", () => {
    const src = appSrc();
    expect(src, "键盘路径必须走共享门").toContain("overlayBlocked(readGateInput(");
    expect(src, "菜单路径必须走共享门").toContain("commandAllowed(id as string, readGateInput(");
    // 反向对照：这两处不许各写一份自己的判断（那就又漂了）
    expect(src, "App.tsx 不许自己判模态面（要走共享门）").not.toContain("document.querySelector('[data-modal-surface");
  });
});
