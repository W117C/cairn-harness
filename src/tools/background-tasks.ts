// 后台任务三件套（2026-11-05 业主裁「工具还不够，需要增加」· 对标 ZCode 的
// bash-background-* / task-output / task-stop 家族）：
//   run_shell(background:true) → 后台跑，立即返回任务号；task_output 读输出；task_stop 组杀。
// 生命周期 = 会话内进程级单例（跨轮共享——模型可以第 1 轮起 dev server、第 5 轮看日志），
// 会话取消（ctx.signal）逐任务组杀；app 退出还有 process.ts 的 liveTracked 兜底组杀。
// 输出帽与 run_shell 同一把尺（32KB 头尾环，run_shell 的 [truncated:] 语义原样复用）。
import { killGroup, sanitizedEnv, spawnTracked, type TrackedChild } from "./process.js";
import { createOutputRing } from "./output-ring.js";
import { ToolError, type Tool, type ToolContext, type ToolResult } from "./base.js";

/** 单任务输出帽（run_shell 同款 32KB；头+尾环）。 */
const BG_OUTPUT_LIMIT = 32 * 1024;
/** 后台任务没有 run_shell 的 60s 墙：给一个宽松总时长（30 分钟），超时组杀并明说。 */
export const BG_TIMEOUT_MS = 30 * 60_000;

export interface BackgroundTaskStatus {
  id: string;
  command: string;
  /** 终态（进行中 = exitCode null + done false）。 */
  exitCode: number | null;
  timedOut: boolean;
  stopped: boolean;
  done: boolean;
  /** 当前累计输出（帽内头尾环快照；overflow 时带截断注记）。 */
  output: string;
}

interface TaskEntry {
  command: string;
  handle: TrackedChild | null;
  ring: ReturnType<typeof createOutputRing>;
  exitCode: number | null;
  timedOut: boolean;
  stopped: boolean;
  done: boolean;
  finish: (code: number | null, why?: "timedOut" | "stopped") => void;
}

/** 一个实例是一个会话的可见任务域。 */
export class BackgroundTaskRegistry {
  private seq = 0;
  private tasks = new Map<string, TaskEntry>();

  /** 起一个后台任务：spawn 不等待；返回任务号（错误立返，不留悬空 promise）。 */
  start(command: string, workspace: string, signal?: AbortSignal, launch?: ToolContext["backgroundShellLaunch"]): { id: string } {
    const id = `bg_${String(++this.seq)}`;
    const ring = createOutputRing(BG_OUTPUT_LIMIT);
    const entry: TaskEntry = {
      command,
      handle: null,
      ring,
      exitCode: null,
      timedOut: false,
      stopped: false,
      done: false,
      finish: () => undefined,
    };
    const finish = (code: number | null, why?: "timedOut" | "stopped"): void => {
      if (entry.done) return;
      entry.done = true;
      entry.exitCode = code;
      entry.timedOut = why === "timedOut";
      entry.stopped = why === "stopped";
      entry.handle?.dispose();
    };
    entry.finish = finish;
    const collect = (chunk: Buffer): void => { entry.ring.push(chunk); };
    const handle = spawnTracked(launch?.executable ?? "bash", launch?.args ?? ["--norc", "-c", command], {
      cwd: workspace,
      env: launch?.env ?? sanitizedEnv(),
      timeoutMs: BG_TIMEOUT_MS,
      onTimeout: () => { finish(null, "timedOut"); },
    });
    entry.handle = handle;
    handle.child.stdout?.on("data", collect);
    handle.child.stderr?.on("data", collect);
    handle.child.on("error", (err) => {
      collect(Buffer.from("[后台命令启动失败] " + err.message + "\n"));
      finish(null);
    });
    handle.child.on("close", (code) => { finish(code); });
    // 会话取消 → 这一任务组杀（监听配对摘除，同 run_shell 的 C12 口径）。
    if (signal) {
      const onAbort = (): void => { if (!entry.done) { killGroup(handle.child); finish(null, "stopped"); } };
      if (signal.aborted) onAbort();
      else {
        signal.addEventListener("abort", onAbort, { once: true });
        handle.child.once("close", () => signal.removeEventListener("abort", onAbort));
        // spawn 'error' 路径同样要摘（close 未必触发）。
        handle.child.once("error", () => signal.removeEventListener("abort", onAbort));
        if (signal.aborted) onAbort();
      }
    }
    this.tasks.set(id, entry);
    return { id };
  }

  /** 读输出 + 状态（幂等快照：task_output 可反复调，读的是当前累计）。 */
  output(id: string): BackgroundTaskStatus | null {
    const entry = this.tasks.get(id);
    if (entry === undefined) return null;
    return {
      id,
      command: entry.command,
      exitCode: entry.exitCode,
      timedOut: entry.timedOut === true,
      stopped: entry.stopped,
      done: entry.done,
      output: entry.ring.read(),
    };
  }

  /** 组杀一个任务；返回杀之前那一下的输出快照（模型据此收尾）。 */
  stop(id: string): BackgroundTaskStatus | null {
    const entry = this.tasks.get(id);
    if (entry === undefined) return null;
    if (!entry.done && entry.handle !== null) {
      killGroup(entry.handle.child);
      entry.finish(entry.exitCode, "stopped");
    }
    return this.output(id);
  }

  /** 现存任务号（task_output/task_stop 的错误句里点名，模型不猜）。 */
  ids(): string[] {
    return [...this.tasks.keys()];
  }

  /** 整表回收（run 清理口子调用；幂等）。 */
  disposeAll(): void {
    for (const [, entry] of this.tasks) {
      if (!entry.done && entry.handle !== null) {
        killGroup(entry.handle.child);
        entry.finish(entry.exitCode, "stopped");
      }
    }
    this.tasks.clear();
  }
}

const sessionTasks = new Map<string, BackgroundTaskRegistry>();
const runTasks = new WeakMap<AbortSignal, BackgroundTaskRegistry>();

/** 工具和桌面使用同一份注册表。会话日志是可信宿主传入的路径。 */
export function backgroundTasksFor(ctx: ToolContext): BackgroundTaskRegistry {
  const session = ctx.sessionLogPath;
  if (session !== undefined) {
    const registry = sessionTasks.get(session) ?? new BackgroundTaskRegistry();
    sessionTasks.set(session, registry);
    return registry;
  }
  if (ctx.signal === undefined) throw new ToolError("后台命令需要会话或运行作用域");
  const registry = runTasks.get(ctx.signal) ?? new BackgroundTaskRegistry();
  runTasks.set(ctx.signal, registry);
  return registry;
}

export function listBackgroundTasks(logPath: string): BackgroundTaskStatus[] {
  const registry = sessionTasks.get(logPath);
  return registry === undefined ? [] : registry.ids().flatMap((id) => registry.output(id) ?? []);
}

export function stopBackgroundTask(logPath: string, id: string): BackgroundTaskStatus | null {
  return sessionTasks.get(logPath)?.stop(id) ?? null;
}

export function forgetBackgroundTasks(logPath: string, renamedLogPath?: string): void {
  const registry = sessionTasks.get(logPath);
  if (registry === undefined) return;
  sessionTasks.delete(logPath);
  if (renamedLogPath === undefined) registry.disposeAll();
  else sessionTasks.set(renamedLogPath, registry);
}

/** 工具：读后台任务输出。 */
export const task_output: Tool = {
  name: "task_output",
  async run(args, ctx): Promise<ToolResult> {
    const id = args.task_id;
    if (typeof id !== "string" || id.trim() === "") {
      throw new ToolError("task_output: task_id 参数必须是非空字符串（如 bg_1）");
    }
    const backgroundTasks = backgroundTasksFor(ctx);
    const t = backgroundTasks.output(id.trim());
    if (t === null) {
      const known = backgroundTasks.ids();
      throw new ToolError(
        "task_output: 没有这个任务号：" + id +
        (known.length > 0 ? "（现存：" + known.join("、") + "）" : "（本会话还没起过后台任务）"),
      );
    }
    const status = t.done
      ? (t.exitCode === 0 ? "已结束（退出码 0）" : t.timedOut ? "已超时终止（30 分钟帽）" : t.stopped ? "已被 task_stop 停止" : `已结束（退出码 ${String(t.exitCode)}）`)
      : "仍在运行";
    return {
      ok: true,
      output: `${status}\n${t.output.trim() === "" ? "（还没有输出）" : t.output}`,
    };
  },
};

/** 工具：停止后台任务（进程组组杀，不留孤儿）。 */
export const task_stop: Tool = {
  name: "task_stop",
  async run(args, ctx): Promise<ToolResult> {
    const id = args.task_id;
    if (typeof id !== "string" || id.trim() === "") {
      throw new ToolError("task_stop: task_id 参数必须是非空字符串（如 bg_1）");
    }
    const backgroundTasks = backgroundTasksFor(ctx);
    const t = backgroundTasks.stop(id.trim());
    if (t === null) {
      const known = backgroundTasks.ids();
      throw new ToolError(
        "task_stop: 没有这个任务号：" + id +
        (known.length > 0 ? "（现存：" + known.join("、") + "）" : "（本会话还没起过后台任务）"),
      );
    }
    const tail = t.output.trim() === "" ? "（无输出）" : t.output.slice(-600);
    return { ok: true, output: `已停止 ${id}。停止前输出（尾 600 字）：\n${tail}` };
  },
};
