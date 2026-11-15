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
/** 收束后等进程真正退出的宽限。守卫要在进程死后读盘，但孙进程可能占着管道让 'close' 迟到；
 *  SIGKILL 已经发出，到点就不再等，直接复查（复查本身会按基线复原）。 */
const EXIT_GRACE_MS = 1000;

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
  /** 收束链：所有终止路径（close / timeout / stop / 会话取消 / 整表回收）都汇到这里，只跑一次；
   *  done 在跑后复查之后才置真——读到的 done 一定意味着守卫结论已经进了输出环。 */
  settle: (code: number | null, why?: "timedOut" | "stopped") => Promise<void>;
}

/** 所有会话可见任务域（退出收束整表用；dispose 后摘除，不随会话数泄漏）。 */
const allRegistries = new Set<BackgroundTaskRegistry>();

/** 一个实例是一个会话的可见任务域。 */
export class BackgroundTaskRegistry {
  private seq = 0;
  private tasks = new Map<string, TaskEntry>();

  /** 起一个后台任务：spawn 不等待；返回任务号（错误立返，不留悬空 promise）。
   *  `onExit`（可选）：正常退出后、标记 done 之前跑的收尾校验；返回一句话就拼进该任务的输出环。
   *  run_shell 用它接判卷面的跑后字节复查（后台命令也要有地板；否则「后台」就是绕开守卫的门）。 */
  start(
    command: string,
    workspace: string,
    signal?: AbortSignal,
    launch?: ToolContext["backgroundShellLaunch"],
    onExit?: () => Promise<string | null>,
  ): { id: string } {
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
      settle: async () => undefined,
    };
    /** 'close' 是否已发生：已发生就不再等，否则最多等 EXIT_GRACE_MS（孙进程占管道时 'close' 可能永不到）。 */
    let exited = false;
    let resolveExit: () => void = () => undefined;
    const exitSeen = new Promise<void>((resolve) => { resolveExit = resolve; });
    let chain: Promise<void> | null = null;
    const settle = (code: number | null, why?: "timedOut" | "stopped"): Promise<void> => {
      // 只跑一次：先到的终止原因说了算（close 之后才到的 stop 不会把「已退出」改写成「已停止」）。
      if (chain !== null) return chain;
      entry.exitCode = code;
      entry.timedOut = why === "timedOut";
      entry.stopped = why === "stopped";
      entry.handle?.dispose();
      chain = (async (): Promise<void> => {
        if (!exited) await Promise.race([exitSeen, new Promise<void>((resolve) => setTimeout(resolve, EXIT_GRACE_MS))]);
        if (onExit !== undefined) {
          try {
            const note = await onExit();
            if (note !== null && note !== "") collect(Buffer.from("\n" + note + "\n"));
          } catch (err: unknown) {
            collect(Buffer.from("\n[后台任务收尾校验失败] " + (err instanceof Error ? err.message : String(err)) + "\n"));
          }
        }
        entry.done = true;
      })();
      return chain;
    };
    entry.settle = settle;
    const collect = (chunk: Buffer): void => { entry.ring.push(chunk); };
    const handle = spawnTracked(launch?.executable ?? "bash", launch?.args ?? ["--norc", "-c", command], {
      cwd: workspace,
      env: launch?.env ?? sanitizedEnv(),
      timeoutMs: BG_TIMEOUT_MS,
      // 超时也走同一条收束链：spawnTracked 随后组杀，settle 等 close（有宽限）再跑复查。
      onTimeout: () => { void settle(null, "timedOut"); },
    });
    entry.handle = handle;
    handle.child.stdout?.on("data", collect);
    handle.child.stderr?.on("data", collect);
    handle.child.on("error", (err) => {
      collect(Buffer.from("[后台命令启动失败] " + err.message + "\n"));
      exited = true;
      resolveExit();
      void settle(null);
    });
    handle.child.on("close", (code) => {
      exited = true;
      resolveExit();
      // 先复查再标记 done：task_output 读到 done 时，判卷面要么没被动过，要么那句守卫说明已经进环。
      void settle(code);
    });
    // 会话取消 → 这一任务组杀（监听配对摘除，同 run_shell 的 C12 口径）。
    if (signal) {
      const onAbort = (): void => { if (!entry.done) { killGroup(handle.child); void settle(null, "stopped"); } };
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
    allRegistries.add(this);
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

  /** 组杀一个任务；返回杀之前那一下的输出快照（模型据此收尾）。
   *  收束链跑完才返回：停止回执里的守卫说明不能落在「已停止」之后才到。 */
  async stop(id: string): Promise<BackgroundTaskStatus | null> {
    const entry = this.tasks.get(id);
    if (entry === undefined) return null;
    if (!entry.done && entry.handle !== null) {
      killGroup(entry.handle.child);
      await entry.settle(entry.exitCode, "stopped");
    }
    return this.output(id);
  }

  /** 现存任务号（task_output/task_stop 的错误句里点名，模型不猜）。 */
  ids(): string[] {
    return [...this.tasks.keys()];
  }

  /** 整表回收（run 清理口子调用；幂等）。表先摘掉，但每个任务的收束链照跑——
   *  判卷面复查是盘面责任，不因「没人再读这个任务了」而跳过。 */
  disposeAll(): void {
    void this.settleAll();
    this.tasks.clear();
    allRegistries.delete(this);
  }

  /** 收束本表所有在跑任务：组杀 → 等退出（有宽限）→ 跑后复查，全部完成才返回。
   *  应用退出用它：`will-quit` 的同步杀组会抢在复查前面，判卷面就没人复原了。 */
  async settleAll(): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const [, entry] of this.tasks) {
      if (!entry.done && entry.handle !== null) {
        killGroup(entry.handle.child);
        waits.push(entry.settle(entry.exitCode, "stopped"));
      }
    }
    await Promise.all(waits);
  }
}

/** 退出前的整表收束：杀组并等每个任务的跑后复查落盘，再让进程退。 */
export async function settleAllBackgroundTasks(): Promise<void> {
  await Promise.all([...allRegistries].map((registry) => registry.settleAll()));
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

export function stopBackgroundTask(logPath: string, id: string): Promise<BackgroundTaskStatus | null> {
  return sessionTasks.get(logPath)?.stop(id) ?? Promise.resolve(null);
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
    const t = await backgroundTasks.stop(id.trim());
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
