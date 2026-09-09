import type { Tool } from "./base.js";
import { read_file } from "./read_file.js";
import { run_shell } from "./run_shell.js";
import { write_file } from "./write_file.js";
import { clarify } from "./clarify.js";
import { propose_plan } from "./propose_plan.js";

export * from "./base.js";

/** 工具注册表：agent loop 按名取用。
 *  verify 不在此列——它是系统验证门，由 loop 的 verify 钩子处理（未接线 = fail-closed）。 */
export const TOOLS: Record<Exclude<Tool["name"], "verify">, Tool> = {
  read_file,
  write_file,
  run_shell,
  clarify,
  propose_plan,
};
