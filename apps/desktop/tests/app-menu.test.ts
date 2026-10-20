// 原生菜单栏判卷（蓝本 §5.2 · 必抄 #6 的相邻面）：菜单树是**纯数据**（menu-template.ts 只 import type），
// 所以这里能直接遍历它，不需要起 Electron。
//
// 钉三件事，每件都对应一类真实事故：
// ① 命令覆盖：`MENU_COMMAND_IDS` 里每条命令都必须真的挂进菜单（少一条 = 菜单里少一项，
//    渲染层那张 Record 反而齐全，永远不会有人发现）；菜单里也不许出现表外的 id。
// ② 不双发：渲染层拥有键位的项必须 `registerAccelerator:false`——否则菜单 push 与渲染层 keydown
//    各走一次，⌘N 建两个会话。
// ③ 键位不撞：同一 accelerator 出现在两项上，菜单会静默只认第一项，第二项永远点不到（也就永远显示成快捷键）。
import { describe, expect, it } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { MENU_ITEM_ID_PREFIX, appMenuTemplate } from "../src/main/menu-template";
import { MENU_COMMAND_IDS, type MenuCommandId } from "../src/shared/menu-commands";

const deps = { send: () => undefined, closeWindow: () => undefined };

/** 深度收集（submenu 是数组，本项目没有动态子菜单）。 */
function walk(items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = [];
  for (const item of items) {
    out.push(item);
    if (Array.isArray(item.submenu)) out.push(...walk(item.submenu));
  }
  return out;
}

const flat = walk(appMenuTemplate(deps));
const commandIds = flat
  .map((i) => i.id)
  .filter((id): id is string => typeof id === "string" && id.startsWith(MENU_ITEM_ID_PREFIX))
  .map((id) => id.slice(MENU_ITEM_ID_PREFIX.length));

describe("原生菜单栏（§5.2）", () => {
  it("命令表 ↔ 菜单项一一对应（少挂一条 = 那个动作在菜单里不存在）", () => {
    expect([...commandIds].sort()).toEqual([...MENU_COMMAND_IDS].sort());
    // 同一条命令不许挂两次（重复项在 macOS 上表现为两个入口互相抢 accelerator）
    expect(new Set(commandIds).size).toBe(commandIds.length);
  });

  it("每条命令都真的接了出口（click 可调用；挂个空壳等于菜单点了没反应）", () => {
    // 2026-10-20 修：旧实现只**抽一条**真跑（new-session）⇒ 一个 `click: () => undefined`
    // 的空壳照样全绿（menu-template.ts 里那只未被使用的 `cmd()` 帮手正是这个形状，
    // 离"菜单点了没反应"只差一次编辑）。现在**逐条**点：每一条都必须把**自己的** id 递到 send。
    const sent: string[] = [];
    const items = walk(appMenuTemplate({ ...deps, send: (id: MenuCommandId) => sent.push(id) }));
    const owned = items.filter((i) => typeof i.id === "string" && i.id.startsWith(MENU_ITEM_ID_PREFIX));
    expect(owned.length).toBeGreaterThan(0);
    for (const item of owned) {
      expect(typeof item.click, `${item.id} 没有 click`).toBe("function");
      (item.click as () => void)();
    }
    // 逐条对账：每个菜单项点了都恰好递出自己的 id，且不多不少（不许串台）
    expect(sent.sort()).toEqual([...commandIds].sort());
  });

  it("渲染层拥有键位的项一律 registerAccelerator:false（Linux/Windows 上防双发）", () => {
    // ⚠️ **这一格在 macOS 上是空操作**（2026-10-20 独立评审追出，HIGH）：
    // Electron 自己的 typings 把 `registerAccelerator` 标成 `@platform linux,win32`
    // ⇒ macOS 上系统照样注册那些 accelerator ⇒ 键被菜单吃掉、渲染层 keydown 不响。
    // macOS 上的防线**不是这一格**，而是渲染层那道**共享命令门**（src/renderer/command-gate.ts）：
    // 菜单转发过来的命令与 keydown 走同一道门（浮层在不在 / 要不要让给输入框）。
    // 这一格仍然要钉：Linux/Windows 上它是防双发的唯一一道。
    const owned = flat.filter((i) => typeof i.id === "string" && i.id.startsWith(MENU_ITEM_ID_PREFIX));
    expect(owned.length).toBeGreaterThan(0);
    for (const item of owned) expect(item.registerAccelerator).toBe(false);
  });

  it("accelerator 不撞（撞了第二项永远点不到、却照样显示成快捷键）", () => {
    const used = new Map<string, string>();
    for (const item of flat) {
      if (item.accelerator === undefined) continue;
      const key = String(item.accelerator);
      const label = String(item.label ?? item.role ?? "?");
      expect(used.has(key), `${key} 重复：${used.get(key) ?? "?"} / ${label}`).toBe(false);
      used.set(key, label);
    }
  });

  it("⌘W 属于「关闭会话」；「关闭窗口」不给快捷键（窗口走红绿灯）", () => {
    const closeSession = flat.find((i) => i.id === MENU_ITEM_ID_PREFIX + "close-session");
    expect(closeSession?.accelerator).toBe("CmdOrCtrl+W");
    const closeWindow = flat.find((i) => i.label === "关闭窗口");
    expect(closeWindow).toBeDefined();
    expect(closeWindow?.accelerator).toBeUndefined();
  });

  it("顶层菜单树对齐蓝本：文件 / 编辑 / 视图 / 前往 / 窗口 / 帮助", () => {
    const labels = appMenuTemplate(deps).map((i) => i.label ?? i.role);
    // macOS 首位是 App 菜单（role 装载），其余六组是我们自己的分组。
    expect(labels.slice(-6)).toEqual(["文件", "编辑", "视图", "前往", "窗口", "帮助"]);
  });
});
