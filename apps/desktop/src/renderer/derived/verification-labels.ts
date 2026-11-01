// 验证状态的四个词（第 944 页）：已验证 / 验证失败 / 证据已过期 / 未验证。
// 此前两处各一套：编排面 `EVIDENCE_LABEL` 写「验证失败、验证过期」，交付卡 `STATUS_LABEL`
// 写「验证未过、证据已过期」——同样四个状态、两套说法。这里只留一套，取两处各自最准的那个词。
// 交付卡多一档「无需验证」（本轮没有文件改动），单独一个常量，不塞进四值表。

export type VerificationState = "verified" | "failed" | "stale" | "absent";

export const VERIFICATION_LABEL: Readonly<Record<VerificationState, string>> = {
  verified: "已验证",
  failed: "验证失败",
  stale: "证据已过期",
  absent: "未验证",
};

/** 交付卡专用：本轮没有文件改动，验证不是「没做」而是「不需要」。 */
export const VERIFICATION_NOT_REQUIRED = "无需验证";

/** 任意字符串 → 那四个词之一；认不出的原样返回（状态来自事件流，不替它编词）。 */
export function verificationLabel(state: string): string {
  return VERIFICATION_LABEL[state as VerificationState] ?? state;
}
