// LSP 状态面（第 995 页）：这个工作区到底配了几台语言服务器、每台实测支持哪几支、
// 哪台起不来、哪台还在等授权——一条命令看清楚，而不是等模型逐支试错。
//   node --import tsx scripts/lsp-status.ts --workspace <dir> [--json]
// 与 `lsp` 工具的 `operation:"servers"` 读的是**同一份事实**（`lspServerStatus`）：
// 两边各写一套状态口径，迟早有一套装得像是真的。这里一个进程都不会起（读状态不是起进程的理由）。
// 口径边界（别把这条读丢了）：**「在跑 / 已标记不可用」是当前进程的事实**。起没起、崩没崩不住在盘上，
// 所以换进程读同一份工作区只会看到「没起过」——配置与授权是真的，运行态是本进程的。
// 把运行态落盘（带 pid 存活判定）是下一批的事。
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { formatLspStatus, lspServerStatus, type LspStatus } from "../src/tools/lsp.js";

export interface LspStatusArgs {
  workspace: string;
  json: boolean;
}

/** 参数解析单独出口：判卷要能在不碰文件系统的情况下钉「默认取当前目录、`--json` 认字面」。 */
export function parseArgs(argv: readonly string[]): LspStatusArgs {
  let workspace = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--workspace") {
      const v = argv[i + 1];
      if (typeof v !== "string" || v === "") throw new Error("用法：--workspace 后面要跟一个目录");
      workspace = v;
      i++;
    } else throw new Error("lsp-status: 不认识的参数 \"" + String(a) + "\"（可用：--workspace <dir> [--json]）");
  }
  return { workspace: resolve(workspace), json };
}

export async function runLspStatus(argv: readonly string[]): Promise<{ status: LspStatus; text: string }> {
  const { workspace, json } = parseArgs(argv);
  const status = await lspServerStatus(workspace);
  return { status, text: json ? JSON.stringify(status, null, 2) : formatLspStatus(status) };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  runLspStatus(process.argv.slice(2))
    .then(({ text }) => { console.log(text); })
    .catch((err: unknown) => {
      console.error("[lsp-status] " + (err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    });
}
