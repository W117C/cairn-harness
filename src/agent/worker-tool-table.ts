import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { edit_file } from "../tools/edit_file";
import { glob } from "../tools/glob";
import { grep } from "../tools/grep";
import { createImpactQueryTool } from "../tools/impact-query";
import { lsp } from "../tools/lsp";
import { read_file } from "../tools/read_file";
import { remember } from "../tools/remember";
import { run_shell } from "../tools/run_shell";
import { write_file } from "../tools/write_file";
import type { Tool } from "../tools/base";
import { evaluate, scopeKey, type AutonomySession, type EvaluateDecision } from "../permissions";
import { WORKER_IMPACT_TOOL } from "./orchestrator-config";
import type { Orchestrator } from "./orchestrator";
import type { WorkerHandle } from "./orchestrator-types";
import { shell_ro, shell_rw } from "./worker-shell-tools";

/** worker 工具执行表（三重硬闸之一）：read mode = 只读面；write mode = worktree 可写面 +
 *  remember（重定向主 checkout）。spawn_agent/run_shell/merge/commit 在任何模式都不在表内。 */
export function buildWorkerToolTable(
  w: WorkerHandle,
  orch: Orchestrator,
  opts: { impactAnalysis?: boolean } = {},
): Record<string, Tool> {
  const table: Record<string, Tool> = {
    read_file: gatedWorkerTool("read_file", read_file, w, orch),
    grep: gatedWorkerTool("grep", grep, w, orch),
    glob: gatedWorkerTool("glob", glob, w, orch),
    lsp: gatedWorkerTool("lsp", lsp, w, orch),
    shell_ro: gatedWorkerTool("shell_ro", shell_ro, w, orch),
  };
  // 影响面读端与主会话同一份实现；这里不传 cacheDir ⇒ 用缺省应用数据目录（绝不写用户仓库）。
  // 刻意**不**接写侧 per-edit 钩子：worker 的 worktree 是仓库副本，缓存按绝对路径键 ⇒ 每个 worker
  // 冷启动重建整图，且 N 个 worker 的波及面在合并回主树那一刻才真正有意义（读端按需查已够）。
  if (opts.impactAnalysis === true) {
    table[WORKER_IMPACT_TOOL] = gatedWorkerTool(WORKER_IMPACT_TOOL, createImpactQueryTool(), w, orch);
  }
  if (w.mode === "write") {
    delete table.shell_ro;
    // 文件面快照包装（M2f 裁决 6：写前快照只服务 findings 绝对行号换算，内存态随 worker 释放）
    const snapshotEdit: Tool = {
      name: "edit_file",
      async run(args, ctx) {
        const rel = typeof args.path === "string" ? args.path : "";
        const oldString = typeof args.old_string === "string" ? args.old_string : "";
        let pre: string | null = null;
        if (rel !== "" && oldString !== "") {
          try {
            pre = await readFile(join(ctx.workspace, rel), "utf8"); // ctx.workspace = worktree（loop 锁定）
            w.snapshots.set(rel, pre);
          } catch {
            pre = null; // 读不到 = 首次编辑前文件不存在；锚点缺失 → findings 降级为相对行号（fail-visible 于行号语义）
          }
        }
        const r = await edit_file.run(args, ctx);
        if (r.ok && pre !== null) {
          const idx = pre.indexOf(oldString);
          if (idx >= 0) {
            const anchor = pre.slice(0, idx).split("\n").length; // 1-based：old_string 首字符所在行
            const list = w.editAnchors.get(rel) ?? [];
            list.push(anchor);
            w.editAnchors.set(rel, list);
          }
        }
        return r;
      },
    };
    const clearAnchorsWrite: Tool = {
      name: "write_file",
      async run(args, ctx) {
        const r = await write_file.run(args, ctx);
        if (r.ok && typeof args.path === "string") {
          w.editAnchors.delete(args.path); // 整文件重写：旧锚点失效（write op 行号 = 文件行号，无需锚点）
          w.snapshots.set(args.path, typeof args.content === "string" ? args.content : "");
        }
        return r;
      },
    };
    // remember 重定向（任务书裁决 2）：worker 文件写 worktree、记忆写主 checkout——ctx.workspace 换主根。
    const rememberMain: Tool = {
      name: "remember",
      async run(args, ctx) {
        return await remember.run(args, { ...ctx, workspace: orch.mainWorkspace });
      },
    };
    table.write_file = gatedWorkerTool("write_file", clearAnchorsWrite, w, orch, { autonomy: w.toolAutonomy });
    table.edit_file = gatedWorkerTool("edit_file", snapshotEdit, w, orch, { autonomy: w.toolAutonomy });
    table.shell_rw = gatedWorkerTool("shell_rw", shell_rw, w, orch, { autonomy: w.toolAutonomy });
    table.remember = gatedWorkerTool("remember", rememberMain, w, orch); // 记忆面走 clampTier 档位（主 checkout 是共享面）
  }
  return table;
}

/** worker 工具门：evaluate 管线（档位/风险/规则全生效）→ ask 走 worker 审批协议（与 turn 解耦）。
 *  M3b：可传独立 autonomy（write mode 文件面/shell 面用 toolAutonomy=auto——worktree 完全可写 §4.4.5；
 *  critical 静态风险与 ask/deny 规则仍全生效）。 */
function gatedWorkerTool(name: string, inner: Tool, w: WorkerHandle, orch: Orchestrator, opts: { autonomy?: AutonomySession } = {}): Tool {
  return {
    name,
    async run(args, ctx) {
      const d: EvaluateDecision = evaluate(name as never, args, opts.autonomy ?? w.autonomy);
      if (d.verdict === "deny") {
        return { ok: false, output: "[permission denied] " + name + "：" + d.reason };
      }
      if (d.verdict === "ask") {
        const r = await orch.requestWorkerApproval(w, name, args, d.risk, d.riskReasons);
        if (!r.approved) {
          return {
            ok: false,
            output: "[permission denied] " + name + " 未获批准（worker 审批协议；单次拒绝不杀 worker）" + (r.note ? "：" + r.note : ""),
          };
        }
        if (r.scope === "session_kind") {
          ((opts.autonomy ?? w.autonomy).sessionScopes as Set<string>).add(scopeKey(name as never, args));
        }
        // scope=always 在 decideWorkerApproval 已拒绝（worker 永不写 always）；此处不会收到
      }
      return await inner.run(args, ctx);
    },
  };
}
