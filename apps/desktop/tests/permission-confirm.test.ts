// 危险权限档确认闸判卷（2026-10-31）：命令面板循环与 composer 菜单同口径——
// 自动/完全允许必须先确认，确认前不落盘。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { permissionNeedsConfirm } from "../src/renderer/permission-labels";
import { permissionConfirmCopy } from "../src/renderer/components/PermissionMenu";

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
    expect(auto.title).toContain("自动");
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
    const src = read("../src/renderer/components/settings-sections.tsx");
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
