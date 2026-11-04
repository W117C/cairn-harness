// 第 950 页：设置页的五个档位必须与词表逐个对上。
//
// 这里出过一次真事故（写在 `settings-sections.tsx#MODE_OPTIONS` 的注释里）：2026-10-24 加了第五档
// `full-access`，只补进了芯片/菜单的词表 `MODE_LABEL`，设置页仍只列四档 ⇒ 用户从设置页永远选不到
// 最松档，而且用芯片切过去之后四个单选项**全不选中**（看起来像"没生效"）。词表两份、互相不锁。
//
// 判据：`MODE_OPTIONS` 的 id 集合必须**恰好等于** `MODE_LABEL` 的键集合（不多不少、不重复）。
import { describe, expect, it } from "vitest";
import { SELECTABLE_PERMISSION_MODES } from "../../../src/permissions/modes";
import { MODE_LABEL } from "../src/renderer/permission-labels";
import { MODE_OPTIONS } from "../src/renderer/components/settings-sections";

describe("设置页档位与词表逐个对上（第 950 页）", () => {
  it("不多不少：id 集合相等", () => {
    const listed = MODE_OPTIONS.map((m) => m.id).sort();
    const vocab = [...SELECTABLE_PERMISSION_MODES].sort();
    expect(listed).toEqual(vocab);
  });

  it("不重复：每个档位在设置页只出现一次", () => {
    const ids = MODE_OPTIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["read-only", "default", "auto", "full-access"]);
    expect(MODE_OPTIONS.map((m) => m.label)).toEqual(["只读", "需要审批", "智能审批", "完全允许"]);
    expect(MODE_LABEL.guided.label).toBe("智能审批");
  });

  it("每一项都有人话标题与说明（空串不许混过去）", () => {
    for (const m of MODE_OPTIONS) {
      expect(m.label.trim(), m.id).not.toBe("");
      expect(m.desc.trim(), m.id).not.toBe("");
    }
  });
});
