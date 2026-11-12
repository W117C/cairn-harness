import type { Tool } from "./base.js";
import { read_file } from "./read_file.js";
import { read_image } from "./read_image.js";
import { render_image } from "./render_image.js";
import { run_shell } from "./run_shell.js";
import { write_file } from "./write_file.js";
import { edit_file } from "./edit_file.js";
import { apply_patch } from "./apply_patch.js";
import { grep } from "./grep.js";
import { glob } from "./glob.js";
import { lsp } from "./lsp.js";
import { clarify } from "./clarify.js";
import { propose_plan } from "./propose_plan.js";
import { todo_write } from "./todo_write.js";
import { task_output, task_stop } from "./background-tasks.js";
import { git_read } from "./git_read.js";
import { calc } from "./calc.js";
import { list_dir } from "./list_dir.js";
import { read_doc } from "./read_doc.js";
import { web_doc } from "./web_doc.js";
import { fs_ops } from "./fs_ops.js";

export * from "./base.js";

/** 工具注册表：agent loop 按名取用（M2a 起 9 工具；M2 起 +apply_patch = 10）。
 *  verify 不在此列——它是系统验证门，由 loop 的 verify 钩子处理（未接线 = fail-closed）。
 *  2026-11-05：+task_output / task_stop（后台任务三件套，run_shell 的 background 档）⇒ 15。
 *  2026-11-06：+git_read（只读三合一）⇒ 16；+calc（确定性算术）+ list_dir（目录总览）⇒ 18；
 *  +read_doc（pdf/docx/xlsx → 纯文本，零新增依赖原生解析）⇒ 19。
 *  2026-11-10：+web_doc（网络文档抓取→文本，复用 read_doc 解析器与 web_fetch 的 SSRF 闸）⇒ 20；
 *  +fs_ops（mkdir/move/rename/delete，快照 + 禁区闸齐全的文件生命周期）⇒ 21。 */
export const TOOLS: Record<Exclude<Tool["name"], "verify">, Tool> = {
  read_file,
  read_image,
  render_image,
  write_file,
  edit_file,
  apply_patch,
  run_shell,
  grep,
  glob,
  lsp,
  clarify,
  propose_plan,
  todo_write,
  task_output,
  task_stop,
  git_read,
  calc,
  list_dir,
  read_doc,
  web_doc,
  fs_ops,
};
