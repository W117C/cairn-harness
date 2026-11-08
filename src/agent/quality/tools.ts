// 质量档的工具面：只留最小可用集，并把返回压成 token 高效的结构。
//
// 依据：Anthropic 明确把「工具集臃肿 / 功能重叠」列为最常见失败模式；mini-SWE-agent 用
// 近 100 行、几乎只有 bash 的 harness 在 SWE-bench Verified 拿到 75.6–76.8%，说明
// 决定成败的不是工具数量。这里做两件事：摘表（policy.QUALITY_MINIMAL_TOOLS）与返回压缩。
import { TOOLS, type Tool } from "../../tools";
import type { ToolResult } from "../../tools/base";

const HEAD_LINES = 120;
const HEAD_CHARS = 6_000;
const TAIL_LINES = 40;
const TAIL_CHARS = 1_500;

/** 头尾保留 + 中间省略：失败摘要（`N failed`、stack 末行）通常在尾部，不能只留头。 */
export function compactToolOutput(output: string): string {
  if (output.length <= HEAD_CHARS + TAIL_CHARS && output.split("\n").length <= HEAD_LINES + TAIL_LINES) {
    return output;
  }
  const lines = output.split("\n");
  let head = lines.slice(0, HEAD_LINES).join("\n");
  if (head.length > HEAD_CHARS) head = head.slice(0, HEAD_CHARS);
  let tail = lines.slice(-TAIL_LINES).join("\n");
  if (tail.length > TAIL_CHARS) tail = tail.slice(-TAIL_CHARS);
  const elidedChars = Math.max(0, output.length - head.length - tail.length);
  const elidedLines = Math.max(0, lines.length - HEAD_LINES - TAIL_LINES);
  return (
    head +
    "\n\n[tool output compacted: " +
    String(elidedLines) +
    " line(s) / " +
    String(elidedChars) +
    " char(s) elided in the middle; rerun with a narrower query if you need that region]\n\n" +
    tail
  );
}

function wrap(tool: Tool): Tool {
  return {
    name: tool.name,
    async run(args, ctx): Promise<ToolResult> {
      const result = await tool.run(args, ctx);
      const output = compactToolOutput(result.output);
      return output === result.output ? result : { ...result, output };
    },
  };
}

/** 生成质量档的可执行工具表：白名单之外的键根本不进表（模型看得见也调不到）。 */
export function qualityToolTable(allowed: readonly string[]): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const name of allowed) {
    const tool = (TOOLS as Record<string, Tool | undefined>)[name];
    if (tool !== undefined) out[name] = wrap(tool);
  }
  return out;
}
