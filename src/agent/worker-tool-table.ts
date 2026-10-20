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
import { evaluate, gateBase, getPlanState, planGateBlocks, rememberDecision, scopeKey, type AskScope, type AutonomySession, type EvaluateDecision, type ToolResultWithAudit } from "../permissions";
import { WORKER_IMPACT_TOOL } from "./orchestrator-config";
import type { Orchestrator } from "./orchestrator";
import type { WorkerHandle } from "./orchestrator-types";
import { makeShellRo, makeShellRw, type WorkerShellRunner } from "./worker-shell-tools";

/** worker 工具执行表（三重硬闸之一）：read mode = 只读面；write mode = worktree 可写面 +
 *  remember（重定向主 checkout）。spawn_agent/run_shell/merge/commit 在任何模式都不在表内。 */
export function buildWorkerToolTable(
  w: WorkerHandle,
  orch: Orchestrator,
  opts: { impactAnalysis?: boolean; shell?: WorkerShellRunner } = {},
): Record<string, Tool> {
  const table: Record<string, Tool> = {
    read_file: gatedWorkerTool("read_file", read_file, w, orch),
    grep: gatedWorkerTool("grep", grep, w, orch),
    glob: gatedWorkerTool("glob", glob, w, orch),
    lsp: gatedWorkerTool("lsp", lsp, w, orch),
    // shell 是 worker 唯一的命令出口，而主会话那道沙箱门只认 `run_shell` 这个名字
    // （agent-runner 的 `name === "run_shell"` 分支）——`shell_ro`/`shell_rw` 走的是本文件
    // 另一扇门，不注入就等于 worker 整支都在 Seatbelt 之外。宿主有沙箱就注入沙箱版。
    shell_ro: gatedWorkerTool("shell_ro", makeShellRo(opts.shell), w, orch),
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
        // worker 写侧不落 D7 快照：worktree 本身就是可回滚副本（§10.10），再抄一份原件会把
        // 合并那一刻的脏文件面撑大（实测：漏掉 snapshot:false 时 mergeWorker 直接判红）。
        const r = await edit_file.run(args, { ...ctx, snapshot: false });
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
        const r = await write_file.run(args, { ...ctx, snapshot: false }); // 同上：worker 不落 D7 快照
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
    table.shell_rw = gatedWorkerTool("shell_rw", makeShellRw(opts.shell), w, orch, { autonomy: w.toolAutonomy });
    // remember 走**共用那份范围裁决**（`permissions/rememberDecision`），不是通用 evaluate：
    // 旧形状 worker 的 remember 只过 evaluate，而 `remember` 不在 SIDE_EFFECT_TOOLS 里
    // ⇒ 既不是写向（方案门/只读档都不管它）、风险也是 none ⇒ **L4-pass 放行**。
    // 后果（2026-10-20 独立评审实测）：worker 一次 `remember {scope:"global"}` **连卡都不出**，
    // 就把模型控制的文本写进了全局层——而全局索引会被注入到**每一个项目**的每一场会话
    // （跨项目注入），主会话对同一件事却是要问人的。**同一个工具、同一个出口，两个结论。**
    // 口径与主会话逐条一致（共用那一份函数，不是各写一份）：方案门 → 只读档 → 全局层要人点头；
    // 项目层免批（2026-10-15 业主裁决）。
    table.remember = gatedWorkerTool("remember", rememberMain, w, orch, {
      decide: (args, auto) => {
        const decision = rememberDecision({
          scope: args.scope,
          mode: auto.mode,
          // 方案门的**活委托**（每次调用现读当前态）——与主会话同一份读法
          // （`src/main/agent-runner.ts` 的 `isPlanBlocked: () => planGateBlocks(getPlanState())`）。
          // 传闭包而不是快照：快照会把方案门退回成一次性开关，那正是
          // `tests/plan-required.test.ts` 那条复发闸要挡的写法。
          isPlanBlocked: () => planGateBlocks(getPlanState()),
        });
        if (decision === "allow") return evaluate("remember" as never, args, auto);
        if (decision === "deny") {
          return {
            verdict: "deny",
            layer: "L0-hard",
            reason: planGateBlocks(getPlanState())
              ? "方案门：先批后写（当前没有已批准的方案）"
              : "只读档拒写向工具（记忆写入也是写）",
          };
        }
        return {
          verdict: "ask",
          layer: "L3-mode",
          reason: "全局层记忆写入要逐次审批（跨项目回注：它会被注入到每个项目的每场会话）",
          risk: "medium",
          riskReasons: ["remember{scope:\"global\"}：写入全局记忆索引（跨项目、跨会话生效）"],
        };
      },
    });
  }
  return table;
}

/** worker 工具门：evaluate 管线（档位/风险/规则全生效）→ ask 走 worker 审批协议（与 turn 解耦）。
 *  M3b：可传独立 autonomy（write mode 文件面/shell 面用 toolAutonomy=auto——worktree 完全可写 §4.4.5；
 *  critical 静态风险与 ask/deny 规则仍全生效）。
 *
 *  `decide` 是**裁决口的替换**（不是叠加）：默认走通用 `evaluate`；
 *  需要「同一次调用按别的口径判」时（remember 的 scope 语义——`evaluate` 不认 scope，
 *  而 `remember` 又不是写向工具 ⇒ 方案门/只读档/全局层审批全都不管它），
 *  那一族自己给出一个 `EvaluateDecision`，**留痕仍走同一条门**（同一张卡、同一个 verdict 出口）。 */
function gatedWorkerTool(
  name: string,
  inner: Tool,
  w: WorkerHandle,
  orch: Orchestrator,
  opts: { autonomy?: AutonomySession; decide?: (args: Record<string, unknown>, auto: AutonomySession) => EvaluateDecision } = {},
): Tool {
  return {
    name,
    async run(args, ctx) {
      const auto = opts.autonomy ?? w.autonomy;
      const d: EvaluateDecision = opts.decide ? opts.decide(args, auto) : evaluate(name as never, args, auto);
      if (d.verdict === "deny") {
        return {
          ok: false,
          output: "[permission denied] " + name + "：" + d.reason,
          gate: { ...gateBase(d, auto.mode), verdict: "denied" as const },
        } as ToolResultWithAudit;
      }
      let approvedScope: AskScope | undefined;
      if (d.verdict === "ask") {
        const r = await orch.requestWorkerApproval(w, name, args, d.risk, d.riskReasons);
        if (!r.approved) {
          return {
            ok: false,
            output: "[permission denied] " + name + " 未获批准（worker 审批协议；单次拒绝不杀 worker）" + (r.note ? "：" + r.note : ""),
            gate: { ...gateBase(d, auto.mode), verdict: "rejected" as const },
          } as ToolResultWithAudit;
        }
        approvedScope = r.scope;
        if (r.scope === "session_kind") {
          ((opts.autonomy ?? w.autonomy).sessionScopes as Set<string>).add(scopeKey(name as never, args));
        }
        // scope=always 在 decideWorkerApproval 已拒绝（worker 永不写 always）；此处不会收到
      }
      // worker 出口今天什么审计都不挂（approval_* 落了流，但结果侧读不到「谁放行的」）——补上。
      // 批准不代表仍在运行：等审批期间的取消必须在真实执行前再次检查。
      const res = ctx.signal?.aborted
        ? { ok: false, output: "[cancelled] 会话已取消，工具没有执行" }
        : await inner.run(args, ctx);
      return {
        ...res,
        gate: d.verdict === "ask"
          ? { ...gateBase(d, auto.mode), verdict: "approved" as const, ...(approvedScope !== undefined ? { scope: approvedScope } : {}) }
          : { ...gateBase(d, auto.mode), verdict: "auto-approved" as const },
      } as ToolResultWithAudit;
    },
  };
}
