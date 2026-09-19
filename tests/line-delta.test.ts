// 行级增减纯函数（能力 2 的「改动范围最小」要先可度量，才谈得上约束）。
import { describe, expect, it } from "vitest";
import { contentLines, isNearCopyRewrite, lineDelta } from "../src/tools/line-delta";

const L = (n: number, tag = "x") => Array.from({ length: n }, (_, i) => `${tag}${String(i)}`).join("\n");

describe("lineDelta：写盘到底动了多少行", () => {
  it("空串是 0 行；结尾换行不额外算一行", () => {
    expect(contentLines("")).toHaveLength(0);
    expect(contentLines("a\nb")).toHaveLength(2);
    expect(contentLines("a\nb\n")).toHaveLength(2);
  });

  it("新建文件：只加不减", () => {
    expect(lineDelta("", L(3))).toEqual({ added: 3, removed: 0 });
  });

  it("原地改一行 = +1 −1（旧行确实消失了才算 removed）", () => {
    expect(lineDelta("a\nb\nc", "a\nB\nc")).toEqual({ added: 1, removed: 1 });
  });

  it("重抄时漏抄两行 ⇒ removed=2 如实报出（这就是「丢代码」的信号）", () => {
    expect(lineDelta(L(5), L(3))).toEqual({ added: 0, removed: 2 });
  });

  it("重复行按多重集算，不按集合（三行相同删掉两行要报 −2）", () => {
    expect(lineDelta("a\na\na", "a")).toEqual({ added: 0, removed: 2 });
    expect(lineDelta("a", "a\na\na")).toEqual({ added: 2, removed: 0 });
  });

  it("整段搬位置不算增减（口径备案：内容一行没丢，git 式 LCS 会报全删全加）", () => {
    expect(lineDelta("a\nb\nc\nd", "c\nd\na\nb")).toEqual({ added: 0, removed: 0 });
  });

  it("结尾换行被抹掉不改变行数（字节数才是那类改动的可见面）", () => {
    expect(lineDelta("a\nb\n", "a\nb")).toEqual({ added: 0, removed: 0 });
  });
});

describe("isNearCopyRewrite：整份重写但其实只是小改", () => {
  it("40 行原文件只动 4 行 ⇒ 该用 edit_file", () => {
    expect(isNearCopyRewrite(40, 4)).toBe(true);
  });

  it("同一文件动 5 行 ⇒ 不再提示（阈值之上就是真改写）", () => {
    expect(isNearCopyRewrite(40, 5)).toBe(false);
  });

  it("39 行的小文件即使只动 1 行也不提示（重写与补丁的成本差可忽略，提示只是噪声）", () => {
    expect(isNearCopyRewrite(39, 0)).toBe(false);
    expect(isNearCopyRewrite(40, 0)).toBe(true);
  });
});
