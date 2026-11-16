// 危险权限档确认闸判卷（2026-10-31）：命令面板循环与 composer 菜单同口径——
// 自动/完全允许必须先确认，确认前不落盘。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { permissionNeedsConfirm } from "../src/renderer/permission-labels";
import { PermissionConfirm, permissionConfirmCopy } from "../src/renderer/components/PermissionMenu";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("permissionNeedsConfirm：危险档才问", () => {
  it("auto / full-access 且真的换档 ⇒ 问；其余不问", () => {
    expect(permissionNeedsConfirm("guided", "auto")).toBe(true);
    expect(permissionNeedsConfirm("auto", "full-access")).toBe(true);
    expect(permissionNeedsConfirm("full-access", "read-only")).toBe(false);
    expect(permissionNeedsConfirm("read-only", "default")).toBe(false);
    expect(permissionNeedsConfirm("auto", "auto")).toBe(false);
  });

  it("两档确认文案是同一处单一来源", () => {
    const auto = permissionConfirmCopy("auto");
    const full = permissionConfirmCopy("full-access");
    expect(auto.title).toContain("智能审批");
    expect(full.title).toContain("完全允许");
    expect(full.desc).toContain("不再出审批卡");
    expect(auto.desc).not.toBe(full.desc);
  });
});

describe("接线：命令面板 + ConfirmScrims", () => {
  it("workbench 只接线；use-permission-confirm 先置待确认态，确认前不落盘", () => {
    const workbench = read("../src/renderer/state/workbench.ts");
    const hook = read("../src/renderer/state/use-permission-confirm.ts");
    expect(workbench).toContain("permissionGuard.cycle(nextPermissionMode(mode));");
    expect(workbench).toContain("permissionGuard,");
    expect(hook).toContain("if (permissionNeedsConfirm(input.mode, next)) {");
    expect(hook).toContain("setPermissionConfirm(next);");
    expect(hook).toContain("apply(next);");
  });

  it("ConfirmScrims 用 ConfirmDialog 渲染权限确认，并调用 permissionGuard.apply", () => {
    const src = read("../src/renderer/panes/ConfirmScrims.tsx");
    expect(src).toContain("permissionConfirmCopy(permissionGuard.permissionConfirm)");
    expect(src).toContain("<ConfirmDialog");
    expect(src).toContain("permissionGuard.apply(m)");
    expect(src).toContain("confirmLabel={STR.permissionMenu.confirmOk}");
  });

  it("设置页选择危险档也先确认（同一文案来源）", () => {
    // 第 1069 页：PermissionsSection 按区拆分至 settings/，源文钉随正文走（三断言全保留、不放宽）。
    const src = read("../src/renderer/components/settings/PermissionsSection.tsx");
    expect(src).toContain("permissionConfirmCopy(confirmMode)");
    expect(src).toContain("setConfirmMode(id)");
    expect(src).toContain("props.onSave({ mode: m })");
  });

  it("composer 的内联确认仍走同一份文案", () => {
    const src = read("../src/renderer/components/PermissionMenu.tsx");
    expect(src).toContain("const copy = permissionConfirmCopy(props.mode);");
    expect(src).toContain("onConfirm={() => {");
  });
});

// 第 1311 页：确认卡顶替列表后，被点的行随列表卸载——焦点、Esc、弹层语义都不能掉在地上。
describe("内联确认卡的焦点与语义", () => {
  const menu = read("../src/renderer/components/PermissionMenu.tsx");
  const shell = read("../src/renderer/components/ComposerPermissionMenu.tsx");

  it("确认卡自己吃 Esc（只退一层）并默认落在安全项「取消」", () => {
    expect(menu).toContain('if (e.key === "Escape")');
    expect(menu).toContain("e.stopPropagation()");
    expect(menu).toContain("cancelRef.current?.focus()");
    expect(menu).toContain("ref={cancelRef}");
    expect(menu).toContain("ref={okRef}");
  });

  it("取消回列表把焦点交回被点的那一行", () => {
    expect(menu).toContain("returnModeRef.current = target");
    expect(menu).toContain(".perm-item[data-mode=");
  });

  it("确认卡在场时弹层不再是 menu：role 与 haspopup 随内容改口", () => {
    expect(shell).toContain('role={confirming === null ? "menu" : "alertdialog"}');
    expect(shell).toContain('aria-haspopup={confirming === null ? "menu" : "dialog"}');
    expect(shell).toContain("onConfirmingChange={setConfirming}");
  });

  it("embedded 卡不再重复声明 alertdialog（宿主弹层承担语义）", () => {
    const hosted = renderToStaticMarkup(
      createElement(PermissionConfirm, { mode: "auto", embedded: true, onCancel: () => undefined, onConfirm: () => undefined }),
    );
    expect(hosted).toContain("perm-confirm");
    expect(hosted).not.toContain('role="alertdialog"');
    const standalone = renderToStaticMarkup(
      createElement(PermissionConfirm, { mode: "auto", onCancel: () => undefined, onConfirm: () => undefined }),
    );
    expect(standalone).toContain('role="alertdialog"');
  });
});
