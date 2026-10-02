// 三卡共享纯函数（M2-5）：只做数据组形/校验，不碰 React 与 IPC——组件与测试共用同一份语义。
import type { ClarifyAnswerMap, ClarifyQuestion, PlanFileChange } from "../../../../../src/events";

/**
 * 澄清表单值 ⇒ 可提交的 ClarifyAnswerMap（key = 问题原文）。
 * 校验语义：带 options 的问题必答——单选缺选（非 string/空串）、多选空数组都抛「必答」
 * （错误文案带问题原文，组件原样展示给用户）；自由项（无 options）可空，空则不进提交值
 * （空串对模型是噪音）。值原样透传不做二次整形：选中项本就是 label 原文。
 */
export function clarifyFormValues(
  questions: readonly ClarifyQuestion[],
  values: Readonly<Record<string, string | string[]>>,
): ClarifyAnswerMap {
  const out: ClarifyAnswerMap = {};
  for (const q of questions) {
    const raw = values[q.question];
    const hasOptions = Array.isArray(q.options) && q.options.length > 0;
    if (hasOptions) {
      if (q.multiSelect === true) {
        const picked = Array.isArray(raw) ? raw : [];
        if (picked.length === 0) throw new Error(`「${q.question}」必答`);
        out[q.question] = [...picked];
      } else {
        if (typeof raw !== "string" || raw === "") throw new Error(`「${q.question}」必答`);
        out[q.question] = raw;
      }
    } else if (typeof raw === "string" && raw.trim() !== "") {
      out[q.question] = raw;
    }
  }
  return out;
}

/** 方案卡的文件变更行：`action  path — summary`（action 与 path 间两空格，测试钉死的列面）。 */
export function planFileLines(files: readonly PlanFileChange[]): string[] {
  return files.map((f) => `${f.action}  ${f.path} — ${f.summary}`);
}
