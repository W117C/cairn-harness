// 变异验证器的"可判性闸门"：把「并发在飞」与「变异表退化」分成两种信号。
// 动因（2026-09-19 实跑）：另一会话正在改判卷测试文件时，本门把两条正常条目报成
// 「基线就不是全绿」+「变异存活」——真回归信号被并发噪声伪装掉了。
import { describe, expect, it } from "vitest";
import { entryDisposition, type HeadState } from "../scripts/lib/mutate-gates";

const clean: HeadState = "clean";
const dirty: HeadState = "dirty";
const untracked: HeadState = "untracked";

const info = (srcState: HeadState, testState: HeadState) => ({
  srcRel: "src/a.ts",
  srcState,
  testRel: "tests/a.test.ts",
  testState,
});

describe("entryDisposition（变异条目开跑前的可判性判定）", () => {
  it("两者都相对 HEAD 干净 → run（正常判定）", () => {
    expect(entryDisposition(info(clean, clean))).toEqual({ kind: "run" });
  });

  it("被测源文件在飞 → refused，理由说清是回滚兜底问题", () => {
    const r = entryDisposition(info(dirty, clean));
    expect(r.kind).toBe("refused");
    expect(r.why).toContain("src/a.ts");
    expect(r.why).toContain("相对 HEAD 有改动");
  });

  it("被测源文件未跟踪 → 同样 refused，但理由区分于在飞（未跟踪无 HEAD 可回滚）", () => {
    const r = entryDisposition(info(untracked, clean));
    expect(r.kind).toBe("refused");
    expect(r.why).toContain("未跟踪");
  });

  it("源文件干净、**判卷测试文件在飞** → unverified（不得冒充变异存活或基线红）", () => {
    const r = entryDisposition(info(clean, dirty));
    expect(r.kind).toBe("unverified");
    expect(r.why).toContain("tests/a.test.ts");
    expect(r.why).toContain("判卷");
  });

  it("未跟踪的判卷文件同样走 unverified，不静默开跑", () => {
    expect(entryDisposition(info(clean, untracked)).kind).toBe("unverified");
  });

  it("源文件优先：两个都在飞时报 refused 不报 unverified（前者是崩溃风险，后者只是噪声）", () => {
    expect(entryDisposition(info(dirty, dirty)).kind).toBe("refused");
  });
});
