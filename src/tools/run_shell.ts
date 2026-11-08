import { ToolError, type Tool, type ToolResult } from "./base.js";
import { annotateExecCause } from "../agent/verify.js";
import { killGroup, sanitizedEnv, spawnTracked } from "./process.js";
import { createOutputRing } from "./output-ring.js";
import { shellRedirectReceipt, snapshotShellRedirects } from "./snapshot.js";
import { backgroundTasksFor } from "./background-tasks.js";

// 输出上限 32KB；只在 ctx.workspace 下执行；超时 60s 强杀。
// 超限后的「头 + 尾环」截断在 output-ring（与 verify 共用——两处都得留住尾部结论）。
const SHELL_OUTPUT_LIMIT = 32 * 1024;
const SHELL_TIMEOUT_MS = 60_000;

/** `.agent/` 是系统区（权限/记忆/插件配置）。重定向目标那条闸只看 `>`/`>>` 的操作数，
 *  `tee` / `cp` / `sed -i` / `python -c "open('.agent/...','w')"` 都不产生重定向 ⇒ 旧实现
 *  根本看不见。这里在 spawn 前做一道保守的词法闸：命令串里出现 `.agent` 路径段就整条拒跑。
 *  认不出目标的写面宁可不跑，也不让一条 shell 命令改写自己的权限/信任表。 */
function assertShellCommandNotAgentArea(command: string): void {
  if (/(^|[\\/'"\s])\.agent([\\/'"\s]|$)/iu.test(command)) {
    throw new ToolError("run_shell: .agent/ 是系统区（权限/记忆/插件配置），命令里出现 .agent 路径一律拒跑");
  }
}

export const run_shell: Tool = {
  name: "run_shell",
  async run(args, ctx): Promise<ToolResult> {
    const command = args.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new Error("run_shell: command 参数必须是非空字符串");
    }
    assertShellCommandNotAgentArea(command);
    // #99：重定向覆写在**跑之前**留一份原件——三个内容写工具一直有这一格，`> file` 这一面绕得开它。
    // 排在 spawn 之前是有意的：先拍后跑，拍不到的那一条只在回执里点名，命令照跑（不改审批语义）。
    // 这里唯一的「拒」是 `.agent/` 那条既有地板（assertNotAgentArea 抛出 ⇒ 命令根本没 spawn）。
    const plan = await snapshotShellRedirects(ctx.workspace, command, {
      callId: ctx.callId,
      enabled: ctx.snapshot !== false, // worker 写侧显式关掉（worktree 天然可回滚），与三个内容写工具同口径
    });
    // 后台档（2026-11-05 · 对标 ZCode/Claude 的后台任务三件套）：快照纪律照旧（先拍后跑），
    // spawn 不等待，立即把任务号交回模型（task_output 读 / task_stop 停）。
    // 审批语义不变：还是 run_shell 这一格门；后台只是执行形态，不是绕门的后门。
    if (args.background === true) {
      if (ctx.signal?.aborted) return { ok: false, output: "[cancelled] 会话已取消，工具没有执行" };
      const { id } = backgroundTasksFor(ctx).start(command, ctx.workspace, ctx.signal, ctx.backgroundShellLaunch);
      // 重定向回执与前台同一只函数：后台命令跑 30 分钟、覆写文件时，模型也要看得到
      // 「覆盖前快照」的指针，而不是只有 snapshotId 一个裸号（前台路径同一纪律）。
      return {
        ok: true,
        output: `后台任务已启动：${id} —— 用 task_output（{"task_id":"${id}"}）读输出；task_stop 停止。命令：${command}` + shellRedirectReceipt(plan),
        ...(plan.ids.length > 0 ? { snapshotId: plan.ids[0]! } : {}),
      };
    }
    return await new Promise<ToolResult>((settle) => {
      const ring = createOutputRing(SHELL_OUTPUT_LIMIT);
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      const collect = (chunk: Buffer): void => ring.push(chunk);
      /** 收束（幂等）：超时路径与 'close' 路径都会走到这里，先到先算。
       *  超时必须主动收束——孙进程持有 stdout 时 'close' 永不触发（P1-2）。 */
      const finish = (code: number | null): void => {
        if (settled) return;
        settled = true;
        handle.dispose();
        let output = ring.read();
        // 墙钟数字由 `SHELL_TIMEOUT_MS` 说话，不在此重写一遍字面量：改帽而文案还说 60s，
        // 模型就是照着一句假话决定「再等一下」还是「换路」（verify／ripgrep 那两支本来就是插值的）。
        if (timedOut) output += "\n[error: run_shell 超时（" + String(SHELL_TIMEOUT_MS / 1000) + "s），已强制终止]";
        if (cancelled) output += "\n[error: run_shell 随会话取消终止]";
        if (code !== 0 && !timedOut && !cancelled) output += `\n[exit code: ${String(code)}]`;
        // 快照事实排在最后：命令自己的输出与结论是模型第一眼要看的，这一句是「这次覆写能不能回滚」。
        output += shellRedirectReceipt(plan);
        const res: ToolResult = {
          ok: code === 0 && !timedOut && !cancelled,
          output: output.replace(/\n+$/, ""),
          // 退出码与「是否超时」在这里落进结构，而不是只留在 `[exit code: N]` 那句正文里：
          // 取消这一支不走 annotateExecCause，所以两个字段必须由本处自己写，否则下游又要回去匹配文案。
          exitCode: cancelled ? null : code,
          timedOut,
          // 结构化字段只装得下一条 ⇒ 取第一条（与 apply_patch 多文件那一刀同口径），
          // 全部路径都在正文那行 [覆盖前快照] 里，事件流的读者按正文取证。
          ...(plan.ids.length > 0 ? { snapshotId: plan.ids[0]! } : {}),
        };
        // 归因走 verify 那一只谓词（`classifyVerifyFailure`，同正则同枚举）：127 与「包管理器自身报错」
        // 这两类「命令根本没跑成」对模型必须点名，否则它会照着一条环境红去改本来正确的代码
        // （取消这一支不贴——它的原因已经写在 `[error: … 随会话取消终止]` 那行了）。
        settle(cancelled ? res : annotateExecCause(res, { timedOut, exitCode: code }));
      };
      // env 消毒：spawn 不传 env 会继承 process.env，而主进程把 BYOK key 写进了
      // process.env.CAIRN_API_KEY —— 一条 `env` 就能把明文 key 读进事件流（P1-1）。
      // 前台沙箱（foregroundShellLaunch，同审批面）：直接 spawn sandbox-exec + 参数表，
      // 命令串保持模型原文（`.agent` 闸与快照面看到的都是用户命令，宿主包装不进闸）。
      const launch = ctx.foregroundShellLaunch;
      const handle = spawnTracked(launch?.executable ?? "bash", launch?.args ?? ["-c", command], {
        cwd: ctx.workspace,
        env: launch?.env ?? sanitizedEnv(),
        timeoutMs: SHELL_TIMEOUT_MS,
        onTimeout: () => {
          timedOut = true;
          finish(null);
        },
      });
      // C12（审查 P2）：会话取消 → 立即组杀在途 shell（旧实现只能等 60s 超时才收束）。
      if (ctx.signal) {
        const onAbort = (): void => {
          if (settled) return;
          cancelled = true;
          killGroup(handle.child);
          finish(null);
        };
        if (ctx.signal.aborted) onAbort();
        else {
          ctx.signal.addEventListener("abort", onAbort, { once: true });
          // 审查 D-8：正常完成路径必须摘掉监听——ctx.signal 是整个 run 级别的，一个 run 里
          // 第 11 次 shell 调用起 Node 打 MaxListenersExceededWarning，且每次的 onAbort 闭包
          // （含 child 引用与 ≤32KB 输出缓冲）被 signal 拖到 run 结束才释放。
          // 与 B7 的 onRootAbort「注册必配对摘除」同口径。
          handle.child.once("close", () => ctx.signal?.removeEventListener("abort", onAbort));
        }
      }
      handle.child.stdout?.on("data", collect);
      handle.child.stderr?.on("data", collect);
      handle.child.on("error", (err) => {
        if (settled) return;
        settled = true;
        handle.dispose();
        // spawn 失败（bash 找不到 / cwd 不存在 / EACCES …）= **命令根本没跑成**，不是「跑失败了」。
        // 走同一条归因谓词（classifyVerifyFailure：exitCode=null ⇒ not-run），
        // 与超时、取消两条出口一样把 exitCode / timedOut 落进结构——
        // 否则这一条是**唯一一条结构面缺席的失败支**（下游只能回去匹配「run_shell: 」那句文案，
        // 那正是本仓判为不可当判据的形状：文案面一变，判定就跟着漂）。
        settle(
          annotateExecCause({ ok: false, output: `run_shell: ${err.message}` }, { timedOut: false, exitCode: null }),
        );
      });
      handle.child.on("close", (code) => finish(code));
    });
  },
};
