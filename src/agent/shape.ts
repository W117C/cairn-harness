// M2b 任务 7（§7.4 = §6.2 同一份规则表）：工具结果类型化整形规则。
// 代码→命中行+签名、日志→尾部+错误行、文档→大纲；进摘要输入的工具结果一律 2k 截断。
// 纯函数、零依赖；prune 与摘要序列化共用（§6.6 约定）。

export const SUMMARY_INPUT_TRUNCATE = 2_000;

/** 工具结果类型（类型化裁剪的键）。 */
export type ResultKind = "code" | "log" | "doc" | "generic";

const CODE_EXT = new Set([
  "ts", "tsx", "js", "mjs", "cjs", "jsx", "py", "rs", "go", "java", "c", "h", "cpp", "hpp",
  "rb", "php", "swift", "kt", "scala", "sh", "sql", "css", "scss", "html", "vue", "sol", "toml", "yaml", "yml",
]);
const LOG_TOOLS = new Set(["run_shell", "verify"]);

function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

/** 类型判定：read_file 路径后缀 → code/doc；run_shell/verify 输出 → log；其余 generic。 */
export function classifyResult(toolName: string, args: Record<string, unknown>, output: string): ResultKind {
  if (LOG_TOOLS.has(toolName)) return "log";
  if (toolName === "read_file" || toolName === "grep" || toolName === "glob" || toolName === "edit_file" || toolName === "write_file" || toolName === "lsp") {
    const p = typeof args.path === "string" ? args.path : "";
    const ext = extOf(p);
    if (CODE_EXT.has(ext)) return "code";
    if (ext === "md" || ext === "txt" || ext === "rst") return "doc";
    return "generic";
  }
  void output;
  return "generic";
}

const ERROR_LINE = /(^|\n)(.*\b(?:error|ERROR|Error|错误|失败|FAILED|FAIL|fatal|FATAL)\b.*)/g;

/** 代码：命中行（grep 输出保结构截尾）+ 签名行（def/class/function/接口行）。 */
export function shapeCode(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  const lines = output.split("\n");
  const sig: string[] = [];
  for (const l of lines) {
    if (/^\s*(export\s+)?(async\s+)?(function|class|interface|def|struct|impl|fn|type|const\s+\w+\s*=\s*(async\s+)?(function|\())\b/.test(l)) {
      sig.push(l);
      if (sig.join("\n").length >= maxChars) break;
    }
  }
  const head = lines.slice(0, 6).join("\n");
  const body = sig.length > 0 ? sig.join("\n") : lines.slice(0, Math.max(3, Math.floor(maxChars / 40))).join("\n");
  const shaped = head + "\n" + body;
  return shaped.length > maxChars ? shaped.slice(0, maxChars) + "\n…[代码整形截断]" : shaped + "\n…[代码整形:签名行]";
}

/** 日志：尾部 + 错误行（错误行在前，尾部保留最后 N 行）。 */
export function shapeLog(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  const lines = output.split("\n");
  const errs: string[] = [];
  ERROR_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ERROR_LINE.exec(output)) !== null && errs.length < 10) errs.push(m[2].slice(0, 300));
  const tailCount = Math.max(5, Math.floor(maxChars / 80));
  const tail = lines.slice(-tailCount).join("\n");
  const head = errs.length > 0 ? "[错误行]\n" + errs.join("\n") + "\n[尾部]\n" : "[尾部]\n";
  const shaped = head + tail;
  return shaped.length > maxChars ? shaped.slice(0, maxChars) + "\n…[日志整形截断]" : shaped;
}

/** 文档：大纲（markdown 标题/列表锚点），不足补开头。 */
export function shapeDoc(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  const lines = output.split("\n");
  const outline = lines.filter((l) => /^#{1,6}\s|^\s*[-*]\s|^\s*\d+\.\s/.test(l));
  let shaped = "[大纲]\n" + outline.join("\n");
  if (shaped.length > maxChars) shaped = shaped.slice(0, maxChars) + "\n…[文档大纲截断]";
  else shaped += "\n[开头]\n" + lines.slice(0, 10).join("\n");
  return shaped;
}

/** 类型化整形入口（prune 打桩前的原文压缩 + 摘要序列化的共用通道）。 */
export function shapeResult(kind: ResultKind, output: string, maxChars: number): string {
  switch (kind) {
    case "code":
      return shapeCode(output, maxChars);
    case "log":
      return shapeLog(output, maxChars);
    case "doc":
      return shapeDoc(output, maxChars);
    default:
      return output.length > maxChars ? output.slice(0, maxChars) + "\n…[截断]" : output;
  }
}

/** 进摘要输入的统一 2k 截断（OC/CL 同值；摘要序列化调用）。 */
export function summaryTruncate(s: string): string {
  return s.length > SUMMARY_INPUT_TRUNCATE ? s.slice(0, SUMMARY_INPUT_TRUNCATE) + "…(截断)" : s;
}
