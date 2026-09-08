import type { ToolName } from "../tools";

export type PermissionMode = "read-only" | "default" | "auto";
export type Decision = "allow" | "ask" | "deny";

// 原始判定：read_file 只读，任何档都放行；write_file / run_shell 有副作用。
//   read-only：副作用工具一律 deny
//   default  ：副作用工具 ask（交互模式下问人）
//   auto     ：全放行
export function checkPermission(mode: PermissionMode, tool: ToolName): Decision {
  if (tool === "read_file") return "allow";
  if (mode === "read-only") return "deny";
  if (mode === "default") return "ask";
  return "allow";
}

// 实际执行前的门：非交互模式下 ask 一律按 deny（fail-closed）。
export function gate(mode: PermissionMode, tool: ToolName, interactive: boolean): Decision {
  const decision = checkPermission(mode, tool);
  if (decision === "ask" && !interactive) return "deny";
  return decision;
}
