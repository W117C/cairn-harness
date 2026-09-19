/** 某文件相对 HEAD 的状态：干净 / 有工作树改动 / 未跟踪。 */
export type HeadState = "clean" | "dirty" | "untracked";

export interface EntryInfo {
  srcRel: string;
  srcState: HeadState;
  testRel: string;
  testState: HeadState;
}

export interface Disposition {
  kind: "run" | "refused" | "unverified";
  why?: string;
}

/**
 * 变异条目开跑前该做什么。三支分开，是因为它们的**后果不同**：
 * - `refused`：被测源文件不在 HEAD 里或有改动 ⇒ 突变中途崩溃没有 HEAD 可回滚，必须拒绝（调用方保持抛死）。
 * - `unverified`：源文件没问题，但**判卷测试文件**在飞 ⇒ 这条此刻量不出东西。它既不是"变异存活"
 *   （那会误判断言无分辨力）也不是"基线红"（那会误判 HEAD 坏了）——多会话并发下这一支不分开，
 *   真回归信号就会被别人的在飞编辑伪装掉（2026-09-19 实跑踩过：两条正常条目报成一死一红）。
 *   判卷文件只读不写，所以它不需要 refused 级别的兜底。
 * - `run`：两边都干净。
 */
export function entryDisposition(info: EntryInfo): Disposition {
  if (info.srcState !== "clean") {
    const why = info.srcState === "untracked"
      ? `${info.srcRel} 未跟踪（不在 HEAD 里）—— 变异中途崩溃无回滚兜底，拒绝`
      : `${info.srcRel} 相对 HEAD 有改动——属在飞改动集，拒绝变异`;
    return { kind: "refused", why };
  }
  if (info.testState !== "clean") {
    const how = info.testState === "untracked" ? "未跟踪" : "相对 HEAD 有改动";
    return { kind: "unverified", why: `判卷文件 ${info.testRel} ${how}——该条不可判（并发在飞不得伪装成变异表退化）` };
  }
  return { kind: "run" };
}
