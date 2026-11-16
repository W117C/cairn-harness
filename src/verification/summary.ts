// 一页总判：把各道门的结果折成**一个** verdict。
//
// 为什么要有：「全部做完了吗」不该靠翻九个日志回答。任何一道门没跑（missing）或没过（fail），
// 总判就不是 pass——**没跑不等于通过**，这条和标准对照报告同一条纪律。
export type GateVerdict = "pass" | "fail" | "missing";

export interface GateResult {
  gate: string;
  verdict: GateVerdict;
  detail?: string;
}

export interface SummaryVerdict {
  verdict: "pass" | "fail" | "incomplete";
  gates: GateResult[];
  failed: string[];
  missing: string[];
}

export function summarise(gates: readonly GateResult[]): SummaryVerdict {
  const failed = gates.filter((g) => g.verdict === "fail").map((g) => g.gate);
  const missing = gates.filter((g) => g.verdict === "missing").map((g) => g.gate);
  return {
    verdict: failed.length > 0 ? "fail" : missing.length > 0 ? "incomplete" : "pass",
    gates: [...gates],
    failed,
    missing,
  };
}

/** 把子进程退出码折算成 verdict（没跑 = missing，不是 0）。 */
export function verdictOfExit(code: number | null): GateVerdict {
  if (code === null) return "missing";
  return code === 0 ? "pass" : "fail";
}
