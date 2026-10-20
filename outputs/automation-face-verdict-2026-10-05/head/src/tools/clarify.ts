// 澄清门工具：模型发起澄清 → clarify_requested 事件 → 挂起等人填表 →
// 提交值逐字成为 tool_result（挂回原 tool_use id）。规格 §5.2：1–4 问/卡、每问 2–4 选项。
import type { ClarifyQuestion, ClarifyRequestedEvent } from "../events";
import { ToolError, type Tool, type ToolResult } from "./base.js";

const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/** 校验并规整 questions 入参；违规一律 ToolError（loop 转成 ok:false 的 tool_result）。 */
export function parseClarifyQuestions(args: Record<string, unknown>): ClarifyQuestion[] {
  const raw = args.questions;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_QUESTIONS) {
    throw new ToolError(`clarify: questions 必须是 1–${String(MAX_QUESTIONS)} 个问题的数组`);
  }
  return raw.map((q, i) => {
    if (typeof q !== "object" || q === null) {
      throw new ToolError(`clarify: 第 ${String(i + 1)} 个问题必须是对象`);
    }
    const o = q as Record<string, unknown>;
    if (typeof o.question !== "string" || o.question.trim().length === 0) {
      throw new ToolError(`clarify: 第 ${String(i + 1)} 个问题缺少非空 question`);
    }
    const out: ClarifyQuestion = { question: o.question };
    if (o.header !== undefined) {
      if (typeof o.header !== "string") throw new ToolError(`clarify: header 必须是字符串`);
      out.header = o.header;
    }
    if (o.multiSelect !== undefined) {
      if (typeof o.multiSelect !== "boolean") throw new ToolError(`clarify: multiSelect 必须是布尔`);
      out.multiSelect = o.multiSelect;
    }
    if (o.options !== undefined) {
      if (!Array.isArray(o.options) || o.options.length < MIN_OPTIONS || o.options.length > MAX_OPTIONS) {
        throw new ToolError(
          `clarify: 第 ${String(i + 1)} 个问题的 options 必须是 ${String(MIN_OPTIONS)}–${String(MAX_OPTIONS)} 个`,
        );
      }
      out.options = o.options.map((opt, j) => {
        if (typeof opt !== "object" || opt === null) {
          throw new ToolError(`clarify: 第 ${String(i + 1)} 个问题的第 ${String(j + 1)} 个选项必须是对象`);
        }
        const lo = opt as Record<string, unknown>;
        const label = lo.label;
        if (typeof label !== "string" || label.trim().length === 0) {
          throw new ToolError(`clarify: 第 ${String(i + 1)} 个问题的第 ${String(j + 1)} 个选项缺少非空 label`);
        }
        const parsed: { label: string; description?: string } = { label };
        const desc = lo.description;
        if (desc !== undefined) {
          if (typeof desc !== "string") throw new ToolError(`clarify: 选项 description 必须是字符串`);
          parsed.description = desc;
        }
        return parsed;
      });
    }
    return out;
  });
}

export const clarify: Tool = {
  name: "clarify",
  async run(args, ctx): Promise<ToolResult> {
    const questions = parseClarifyQuestions(args);
    if (!ctx.emit || ctx.callId === undefined || !ctx.clarify) {
      throw new ToolError("clarify: 无澄清通道（fail-closed：需要 emit/callId/clarify 门接线）");
    }
    // 顺序即正确性：先登记等待（广播事件可能立刻引来提交），再落事件，再挂起
    const waiting = ctx.clarify.wait(ctx.callId);
    const event: ClarifyRequestedEvent = { type: "clarify_requested", callId: ctx.callId, questions };
    await ctx.emit(event);
    const answers = await waiting;
    // 提交值逐字回传：tool_result.output = JSON.stringify(提交对象)
    return { ok: true, output: JSON.stringify(answers) };
  },
};
