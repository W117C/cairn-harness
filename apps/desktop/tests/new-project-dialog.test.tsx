// P1-3 判卷：新建项目 Dialog（brief 第四节）。
// 纯函数 validateProjectName + SSR 真 HTML。钉：模板卡 = 主进程目录四张（名称口径同 templateCatalog()，
// 不另写死一份）、名字实时错误行、位置行 home 短写（~/Cairn Projects）与「将创建在：」预览、
// 零路径手输、每钮 tooltip（P1-6 审计的 Dialog 面）。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NewProjectDialog, templateNavigationTarget, validateProjectName } from "../src/renderer/components/NewProjectDialog";
import { templateCatalog } from "../../../src/main/project-templates";
import { STR } from "../src/renderer/strings";

const TEMPLATES = templateCatalog();

describe("validateProjectName（纯函数）", () => {
  it("空 / 全空白 ⇒ 请先起名（不是抛，也不是放过）", () => {
    expect(validateProjectName("", [])).toBe(STR.newProject.nameEmpty);
    expect(validateProjectName("   ", [])).toBe(STR.newProject.nameEmpty);
  });

  it("斜杠 / 反斜杠 / 控制字符 ⇒ 非法（目录分隔符会逃出父目录）", () => {
    expect(validateProjectName("a/b", [])).toBe(STR.newProject.nameInvalid);
    expect(validateProjectName("a\\b", [])).toBe(STR.newProject.nameInvalid);
    expect(validateProjectName("a\u0000b", [])).toBe(STR.newProject.nameInvalid);
    expect(validateProjectName("a\nb", [])).toBe(STR.newProject.nameInvalid);
  });

  it("与在场项目重名 ⇒ 报重名（前后空白不算差异）", () => {
    expect(validateProjectName("my-site", ["my-site"])).toBe(STR.newProject.nameTaken);
    expect(validateProjectName("  my-site  ", ["my-site"])).toBe(STR.newProject.nameTaken);
  });

  it("正常名字 ⇒ null（唯一放行的返回值）", () => {
    expect(validateProjectName("  my-site  ", ["other"])).toBeNull();
    expect(validateProjectName("中文名字", [])).toBeNull();
  });
});

describe("templateNavigationTarget（单选组方向键）", () => {
  it("左右/上下方向键循环移动，Home/End 落到首尾，其他键不劫持", () => {
    expect(templateNavigationTarget("ArrowRight", 0, 4)).toBe(1);
    expect(templateNavigationTarget("ArrowLeft", 0, 4)).toBe(3);
    expect(templateNavigationTarget("ArrowDown", 2, 4)).toBe(3);
    expect(templateNavigationTarget("ArrowUp", 3, 4)).toBe(2);
    expect(templateNavigationTarget("Home", 2, 4)).toBe(0);
    expect(templateNavigationTarget("End", 1, 4)).toBe(3);
    expect(templateNavigationTarget("Enter", 1, 4)).toBeNull();
    expect(templateNavigationTarget("ArrowRight", 0, 0)).toBeNull();
  });
});

function dialogHtml(over: Partial<Parameters<typeof NewProjectDialog>[0]> = {}): string {
  const props = {
    templates: TEMPLATES,
    existingNames: [],
    onClose: () => undefined,
    onPickDirectory: () => Promise.resolve(null),
    onCreate: async () => undefined,
    ...over,
  } as Parameters<typeof NewProjectDialog>[0];
  return renderToStaticMarkup(<NewProjectDialog {...props} />);
}

describe("新建项目 Dialog（真 HTML）", () => {
  it("模板卡 = 目录四张：名称与一句话说明逐一在场；radio 语义 + 首张默认选中", () => {
    const html = dialogHtml();
    expect(TEMPLATES).toHaveLength(4); // 主进程目录当前四张（数量变了这里先红，提醒同步口径）
    for (const t of TEMPLATES) {
      expect(html).toContain(t.name);
      expect(html, `模板说明缺失：${t.id}`).toContain(t.description);
    }
    expect(html).toContain('role="radiogroup"');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(4);
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1); // 首张默认选中，恰一张
  });

  it("模板单选组只有一个 Tab 停点：选中卡 tabIndex=0，其余卡 -1", () => {
    const html = dialogHtml();
    const radios = html.match(/<button[^>]*role="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(TEMPLATES.length);
    expect(radios.filter((radio) => radio.includes('tabindex="0"'))).toHaveLength(1);
    expect(radios.filter((radio) => radio.includes('tabindex="-1"'))).toHaveLength(TEMPLATES.length - 1);
    expect(radios.find((radio) => radio.includes('aria-checked="true"'))).toContain('tabindex="0"');
  });

  it("名字框在场带 aria-label；名字为空 ⇒ 创建钮禁用（不摆误触），且不先跳错误行", () => {
    const html = dialogHtml();
    expect(html).toContain(`aria-label="${STR.newProject.nameLabel}"`);
    expect(html).toContain(STR.newProject.namePlaceholder);
    const createAt = html.lastIndexOf(`>${STR.common.create}</button>`);
    const btn = html.slice(html.lastIndexOf("<button", createAt), createAt);
    expect(btn).toContain('disabled=""');
    expect(html).not.toContain('role="alert"'); // 还没输入过：不抢跑报错
  });

  it("位置行：默认 ~/Cairn Projects 短写 + 「将创建在：」预览；全程零路径手输（只有一个输入框=名字）", () => {
    const html = dialogHtml();
    expect(html).toContain(STR.newProject.defaultParent);
    expect(html).toContain("将创建在：");
    expect(html).toContain(`${STR.newProject.defaultParent}/`);
    expect((html.match(/<input/g) ?? []).length).toBe(1); // 唯一的输入框是名字（位置只展示 + 系统选择器）
    expect(html).not.toContain("/Users/"); // 不把绝对路径糊上屏
  });

  it("每个按钮都有 title 或 aria-label（brief 第九节；tooltip-audit 同判据）", () => {
    const html = dialogHtml();
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(5);
    for (const b of buttons) {
      expect(b.includes("title=") || b.includes("aria-label="), `按钮缺提示：${b}`).toBe(true);
    }
  });
});
