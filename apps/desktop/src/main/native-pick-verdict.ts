// 原生面板人工验收的**判读**（纯函数：把面板返回折算成 verdict + 一条人能看懂的说明）。
//
// 抽出来的理由：面板本体不可自动化，但「读出来的结果算不算通过」这层逻辑可以判——
// 这样人工那一步只剩「点一下」，不用再靠人肉解释读数。
export type NativePickVerdict = "PASS(selected)" | "PASS(canceled)" | "TIMEOUT" | "FAIL(empty)";

export interface NativePickResultLike {
  canceled?: boolean;
  filePaths?: string[];
  timeout?: boolean;
}

export function verdictOf(result: NativePickResultLike): NativePickVerdict {
  if (result.timeout === true) return "TIMEOUT";
  if (result.canceled === true) return "PASS(canceled)";
  const first = result.filePaths?.[0];
  return typeof first === "string" && first !== "" ? "PASS(selected)" : "FAIL(empty)";
}

export function verdictReason(verdict: NativePickVerdict): string {
  switch (verdict) {
    case "PASS(selected)": return "面板把选中的路径交回来了";
    case "PASS(canceled)": return "取消是合法结果（不是错误）";
    case "TIMEOUT": return "没人操作：这一跳没验到，不等于通过";
    case "FAIL(empty)": return "面板返回空（既没选中也没取消）";
  }
}
