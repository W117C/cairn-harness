import type { Tool } from "./base.js";
import { read_file } from "./read_file.js";
import { run_shell } from "./run_shell.js";
import { write_file } from "./write_file.js";

export * from "./base.js";

/** 工具注册表：agent loop 按名取用。 */
export const TOOLS: Record<Tool["name"], Tool> = { read_file, write_file, run_shell };
