// 原生菜单栏装配（Electron 侧唯一碰 electron 的那一半）：模板在 ./menu-template.ts
// （纯数据，可被判卷直接遍历），这里只做 buildFromTemplate + setApplicationMenu。
// 菜单是进程级的，单窗口应用一次装够；不做「每窗口一套」——那个复杂度换来的是零收益。
import { Menu } from "electron";
import { appMenuTemplate, type AppMenuDeps } from "./menu-template";

export function installAppMenu(deps: AppMenuDeps): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(deps)));
}
