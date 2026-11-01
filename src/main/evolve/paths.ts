// Evolve 的目录常量唯一事实源：Episode / playbook / assignment / experiment 四个存储共用。
// 单独成文件是为了避免 assignment-store ↔ episode-store 的循环 import。
import { join } from "node:path";

export const EVOLVE_DIR = ".agent/evolve";

export function evolveDirFor(workspace: string): string {
  return join(workspace, EVOLVE_DIR);
}
