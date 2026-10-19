// 设置页分区搜索判卷（2026-10-18 补）。
//
// 缺口：九个设置分区只能靠肉眼扫。⌘K 命令面板能「跳到某分区」，但那是**导航**，
// 不是「在设置里找东西」——而且它跳过去就关，用户看不到还有什么别的分区。
// 现在导航列顶部一行搜索，边打边收窄。
//
// 两条纪律（本判卷钉住）：
// ① 口径诚实：匹配的是**分区名 + 同义词**（SECTION_KEYWORDS），不是每个开关的标签。
//    不把「全文搜索」说成有的样子——所以词表单独一份，SECTIONS 形状不动
//    （它的形状被壳导航与命令面板消费，加字段要连带改两处与它们的判据）。
// ② 顺序保序：结果按 SECTIONS 原序返回，不让匹配度重排（用户对固定顺序有肌肉记忆）。
import { describe, expect, it } from "vitest";
import { filterSections, SECTION_KEYWORDS, SECTIONS } from "../src/renderer/components/settings-nav";

const ALL = SECTIONS.map((s) => s.id);

describe("filterSections（分区搜索）", () => {
  it("空查询 = 全量、且保序", () => {
    expect(filterSections("")).toEqual(ALL);
    expect(filterSections("   ")).toEqual(ALL);
  });

  it("按分区名直命中", () => {
    expect(filterSections("通用")).toEqual(["general"]);
    expect(filterSections("快捷键")).toEqual(["shortcuts"]);
    expect(filterSections("关于")).toEqual(["about"]);
  });

  it("按同义词命中（分区名里没有的字）", () => {
    // 「模型」在 provider 的分区名里没有（它叫「模型与 Provider」——其实有，换一个真的没有的）
    expect(filterSections("密钥")).toContain("provider");
    expect(filterSections("预算")).toContain("advanced");
    expect(filterSections("定时")).toContain("automation");
    expect(filterSections("技能")).toContain("skills");
    expect(filterSections("诊断")).toContain("about");
  });

  it("大小写不敏感（provider 名里带英文）", () => {
    expect(filterSections("provider")).toContain("provider");
    expect(filterSections("PROVIDER")).toContain("provider");
    expect(filterSections("prompt")).toContain("advanced");
  });

  it("短查询也命中（词含查询或查询含词，双向子串）", () => {
    expect(filterSections("遥")).toContain("advanced"); // 「遥测」
    expect(filterSections("暗")).toContain("general"); // 「暗」
    expect(filterSections("记忆")).toEqual(expect.arrayContaining(["advanced", "memory"]));
  });

  it("无命中返回空数组（调用方据此显示「没有匹配」而不是空导航）", () => {
    expect(filterSections("zzzz不存在的词")).toEqual([]);
  });

  it("结果顺序恒等于 SECTIONS 原序（不按匹配度重排）", () => {
    const got = filterSections("的"); // 故意宽泛，命中多项
    const expected = ALL.filter((id) => got.includes(id));
    expect(got).toEqual(expected);
  });

  it("每个分区的词表都非空（漏一个 = 那个分区搜不到同义词）", () => {
    for (const s of SECTIONS) {
      expect(SECTION_KEYWORDS[s.id]?.trim(), `${s.id} 词表为空`).not.toBe("");
    }
  });

  it("词表覆盖全部 SectionId（新增分区若忘配词表，这里红）", () => {
    for (const s of SECTIONS) {
      expect(Object.keys(SECTION_KEYWORDS)).toContain(s.id);
    }
  });
});
