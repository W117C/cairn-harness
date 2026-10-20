// 「这次调用会不会改**本工作区的盘**」——一份判据，多处消费。
//
// 立这只模块的理由是四份清单已经各自漂移（本轮逐条读到）：
//   ① 权限门 `src/permissions/autonomy.ts` 的 `SIDE_EFFECT_TOOLS`：write_file / edit_file / run_shell / shell_rw / spawn_agent；
//   ② `src/agent/loop.ts` 的收束闸触发条件：内联 `name === "write_file" || name === "edit_file"`；
//   ③ `src/agent/worker-report.ts` 的 `WRITE_TOOLS`：`write_file` / `edit_file`（注释还自称「与 spec 同源」）；
//   ④ `src/agent/no-progress.ts` 的 `WRITE_TOOLS`：五个名字（另含 apply_patch / delete_file / move_file）。
// ②③ 少认了 shell ⇒ 「写过盘必须留验证证据」在**经 shell 落盘**这条路上是空的：
// 既不触发收束闸（证据恒 `absent`），也不使绿拍过期（绿拍之后用 shell 改盘仍报 `verified`，
// 而那份绿描述的不是即将合并的代码）。后者比前者更贵——它是能力 5 最忌的假绿。
//
// 为什么不重抄一张表：写向那半边复用权限门的 `isWriteCall`（MCP 走 server 注解，无注解按写管），
// shell 那半边复用执行面已在用的 `isReadOnlyShellCommand`（白名单命令集 + 写面元字符一票否决，
// 与 `shell_ro` 的放行判据同一份）。新增门内写向工具会自动进这张面；漏登记由
// `tests/write-face.test.ts` 的覆盖性棘轮抓（两个方向都断）。
import { isShellFamily } from "../permissions/risk";
import { isWriteCall } from "../permissions/autonomy";
import { isReadOnlyShellCommand } from "./worker-shell-tools";

/** 权限门算写向、但**不改本工作区盘**的名字：派生 worker 写的是它自己那块 worktree
 *  （改动经合并控制塔另路落地）。为它补一拍验证 = 白付一遍目标仓的全量测试。 */
const NOT_THIS_WORKSPACE: ReadonlySet<string> = new Set(["spawn_agent"]);

/** 只读的 shell 变体：它的执行面前置了同一份静态过滤——写向命令在 `shell_ro` 里根本不会被执行
 *  （返回 ok:false），所以它**永远**改不了盘。这条不是命名照顾，有配对用例钉着。 */
const STATICALLY_READONLY_SHELL: ReadonlySet<string> = new Set(["shell_ro"]);

export function mayHaveWrittenDisk(tool: string, args: Record<string, unknown>): boolean {
  if (isShellFamily(tool)) {
    if (STATICALLY_READONLY_SHELL.has(tool)) return false;
    const command = typeof args.command === "string" ? args.command : "";
    return !isReadOnlyShellCommand(command).ok;
  }
  return isWriteCall(tool) && !NOT_THIS_WORKSPACE.has(tool);
}
