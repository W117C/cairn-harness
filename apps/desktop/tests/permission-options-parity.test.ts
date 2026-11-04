// 设置页的权限档选项必须覆盖核心档位表的**全部**档位，顺序一致（新增档位不许只活在芯片菜单里）。
import { describe, expect, it } from "vitest";
import { MODE_OPTIONS } from "../src/renderer/components/settings-sections";
import { SELECTABLE_PERMISSION_MODES } from "../../../src/permissions/modes";

describe("设置页权限档 = 核心档位表", () => {
  it("四档全覆盖且顺序一致（缺一档 ⇒ 设置页选不到它，已存值也不会有选中项）", () => {
    expect(MODE_OPTIONS.map((o) => o.id)).toEqual([...SELECTABLE_PERMISSION_MODES]);
    // guided 只作旧值兼容，2026-11-03 起不再是可选档。
    expect(MODE_OPTIONS.map((o) => o.id)).not.toContain("guided");
  });

  it("最松档带警示文案（danger 档不许静默可选）", () => {
    const full = MODE_OPTIONS.find((o) => o.id === "full-access");
    expect(full, "设置页缺 full-access").toBeDefined();
    expect(full!.warn ?? "").toMatch(/最松档/);
  });
});
