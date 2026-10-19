// 视图三档（蓝本 §3.4，必抄 #4：同一份工具调用痕迹，按信任程度分级展示）。
//   Normal   工具调用折叠为摘要，完整文字回复
//   Thinking 折叠的工具调用 + Claude 的思考（**仅在本会话产出过思考后才进环**——蓝本原文）
//   Verbose  每次工具调用、中间步骤全展开 + 思考
// Ctrl+O 循环；本模块是环的唯一事实源（App 的快捷键与 Stream 的默认展开态共用）。
export type ViewMode = "normal" | "thinking" | "verbose";

/** 环的构成：没产出过思考就没有 Thinking 档（不摆一个永远空的档位）。 */
export function viewModesFor(hasThinking: boolean): readonly ViewMode[] {
  return hasThinking ? (["normal", "thinking", "verbose"] as const) : (["normal", "verbose"] as const);
}

/** 下一个档位（Ctrl+O）。cur 不在当前环里（如思考被清掉后停在 thinking）⇒ 收敛到环首的下一档，不卡死。 */
export function nextViewMode(cur: ViewMode, hasThinking: boolean): ViewMode {
  const modes = viewModesFor(hasThinking);
  const i = modes.indexOf(cur);
  return modes[(i + 1) % modes.length] ?? "normal";
}

/** toast 文案（单一源；切换时闪一条，不留常驻态）。 */
export const VIEW_LABEL: Record<ViewMode, string> = {
  normal: "Normal · 工具折叠为摘要",
  thinking: "Thinking · 附思考正文",
  verbose: "Verbose · 工具全展开",
};
