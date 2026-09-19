// 主会话系统提示词的纪律面（能力 2/5 的「说一次、每轮都吃」成本面）。
// 为什么值得锁：BASE_SYSTEM 此前从未有测——删掉任何一条纪律都不会红，而每条都对应一个真实返工面。
// 同时它每轮重送（静态段），所以体积也要有上界，不能靠不断加句子来"教"模型。
import { describe, expect, it } from "vitest";
import { BASE_SYSTEM } from "../src/main/agent-runner";

const rule = (n: number): string => {
  const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith(String(n) + ")"));
  if (line === undefined) throw new Error("缺第 " + String(n) + ") 条纪律");
  return line;
};

describe("BASE_SYSTEM 纪律面", () => {
  it("六条纪律编号连续（缺号=模型读到断号，会以为后面的约束可省）", () => {
    for (let i = 1; i <= 6; i++) expect(rule(i).length).toBeGreaterThan(0);
    expect(BASE_SYSTEM).not.toContain("7)");
  });

  it("先红后绿写进纪律：修 bug 必须先有跑到红的复现，没红过不得宣称修好（能力 5 的正面）", () => {
    const r4 = rule(4);
    expect(r4).toContain("复现");
    expect(r4).toMatch(/跑到红/);
    expect(r4).toMatch(/没有红过的复现就不要宣称/);
  });

  it("补丁优先写进纪律：改已有文件用 edit_file，write_file 只用于新建（能力 2「补丁级 diff」）", () => {
    const r3 = rule(3);
    expect(r3).toContain("edit_file");
    expect(r3).toContain("write_file");
    expect(r3).toMatch(/只用于新建/);
  });

  it("两条纪律不互斥：明确「第 4 条是新增用例，不是改判卷文件」", () => {
    const r6 = rule(6);
    expect(r6).toContain("判卷");
    expect(r6).toMatch(/新增/);
  });

  it("静态段体积有上界（每轮重送的固定成本，随轮数放大）", () => {
    expect(Buffer.byteLength(BASE_SYSTEM, "utf8")).toBeLessThan(1400);
  });
});
