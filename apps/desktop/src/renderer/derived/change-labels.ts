// 文件改动的三个词（第 942 页）：新建 / 修改 / 变更。
// 此前三处各写一份——`ChangeSummaryCard` 的 CHANGE_LABEL、`Inspector` 的 CHANGE_WORD、
// `PaneDock` 里两处内联三元。同一套词三份手抄，改一处就有一面开始说旧话。
// 「变更」是缺省：change 字段缺席时（老日志/投影没给）不许猜成新建或修改。

export type FileChangeKind = "created" | "modified" | "unknown";

export const CHANGE_LABEL: Readonly<Record<FileChangeKind, string>> = {
  created: "新建",
  modified: "修改",
  unknown: "变更",
};

/** 任意字符串 → 那三个词之一；认不出的一律「变更」（不猜）。 */
export function changeLabel(kind: string): string {
  return CHANGE_LABEL[kind as FileChangeKind] ?? CHANGE_LABEL.unknown;
}

/** 方案里的动作词（create / edit / delete）：`PlanCard` 的徽标与 `PaneDock` 的变更清单共用。
 *  第 942 页并进来的第二套词——它和「文件改动」不是一回事（方案动作没有「变更」这一档）。 */
export type PlanActionKind = "create" | "edit" | "delete";

export const PLAN_ACTION_LABEL: Readonly<Record<PlanActionKind, string>> = {
  create: "新建",
  edit: "修改",
  delete: "删除",
};

/** 任意字符串 → 动作词；认不出的原样返回（方案动作是模型给的，不替它编一个）。 */
export function planActionLabel(action: string): string {
  return PLAN_ACTION_LABEL[action as PlanActionKind] ?? action;
}
