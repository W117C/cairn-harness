import type { Tool } from "./base.js";
import { read_file } from "./read_file.js";
import { read_image } from "./read_image.js";
import { run_shell } from "./run_shell.js";
import { write_file } from "./write_file.js";
import { edit_file } from "./edit_file.js";
import { apply_patch } from "./apply_patch.js";
import { grep } from "./grep.js";
import { glob } from "./glob.js";
import { lsp } from "./lsp.js";
import { clarify } from "./clarify.js";
import { propose_plan } from "./propose_plan.js";

export * from "./base.js";

/** 工具注册表：agent loop 按名取用（M2a 起 9 工具；M2 起 +apply_patch = 10）。
 *  verify 不在此列——它是系统验证门，由 loop 的 verify 钩子处理（未接线 = fail-closed）。 */
export const TOOLS: Record<Exclude<Tool["name"], "verify">, Tool> = {
  read_file,
  read_image,
  write_file,
  edit_file,
  apply_patch,
  run_shell,
  grep,
  glob,
  lsp,
  clarify,
  propose_plan,
};
