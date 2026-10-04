// 子进程执行公共设施（M0 复盘 P1-1 / P1-2）。
//
// P1-1 env 消毒：模型写的命令（run_shell）、verify 脚本、LSP server 都以子进程形态运行。
//   `spawn` 不传 env = 继承 process.env，而主进程会把 BYOK key 解密后写进
//   process.env.CAIRN_API_KEY（agent-runner.ts），于是子进程里一条 `env` / `printenv`
//   就能把明文 key 读出来，经 tool_result 落进事件流再回传给模型。
//   沙箱路径早已消毒（sandboxEnv），本模块把同一套消毒推广到**所有**子进程。
//
// P1-2 进程组回收：`bash -c <cmd>` 的直接子进程是 bash，`pnpm test` / `tsc` 是它的孙进程。
//   只 kill 直接子进程会留下孤儿，而且孙进程持有 stdout 管道时 'close' 永不触发 →
//   调用方的 Promise 永久挂起（工具调用与 agent loop 一起卡死）。
//   `detached: true` 让子进程自成进程组组长，超时用 kill(-pid) 一次收掉整棵树；
//   同时超时回调**先同步 settle**，不依赖 'close'。
import { spawn, type ChildProcess } from "node:child_process";

/** env 白名单：只传这些；名字含 KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL 的一律剥除（双保险）。 */
const ENV_ALLOW = ["PATH", "HOME", "TERM", "SHELL", "LANG", "TMPDIR", "USER"] as const;
const ENV_SECRET_RE = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

/** 子进程环境：白名单 + 密钥名剥除。传 tmpDir 时覆盖 TMPDIR（沙箱路径用于写收敛）。 */
export function sanitizedEnv(tmpDir?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ENV_ALLOW) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  for (const k of Object.keys(env)) {
    if (ENV_SECRET_RE.test(k)) delete env[k];
  }
  if (tmpDir !== undefined) env.TMPDIR = tmpDir;
  return env;
}

/** 杀整棵进程树：detached 子进程是组长，负 pid 命中整组；组不存在/已退出则兜底杀直接子进程。 */
export function killGroup(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
  const pid = child.pid;
  if (pid !== undefined) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // 组不存在（未 detached / 已退出）→ 兜底
    }
  }
  try {
    child.kill(signal);
  } catch {
    // 已退出
  }
}

export interface TrackedSpawnOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** true = 把 file 当 shell 串交给 /bin/sh 执行（插件 hook 的 shell 形态）。 */
  shell?: boolean;
  /** 超时触发：先同步回调（调用方据此立即 settle，不等 'close'），再杀整棵进程树。 */
  onTimeout: () => void;
}

export interface TrackedChild {
  child: ChildProcess;
  /** 正常收尾时调用：清掉超时定时器。 */
  dispose(): void;
}

/** 存活 tracked 子进程注册表（D8，审查 P2）：will-quit 统一组杀——旧实现退出只停调度器，
 *  在跑的 bash/sandbox-exec 成孤儿。child 'close' 时自动出册；注册表只持有存活进程。 */
const liveTracked = new Set<ChildProcess>();

/** 组杀全部存活 tracked 子进程（app will-quit 兜底；幂等，无存活进程时零行为）。 */
export function killAllTrackedChildren(): void {
  for (const child of liveTracked) killGroup(child);
  liveTracked.clear();
}

/** 启动子进程并纳入「进程组 + 超时强杀 + 超时强制 settle」管理。 */
export function spawnTracked(file: string, args: readonly string[], opts: TrackedSpawnOptions): TrackedChild {
  // fail-closed：省略 `env` 不等于"继承主进程"——主进程里正躺着解密后的 BYOK key（P1-1 同一格）。
  // 旧实现把消毒责任交给每个调用点"记得传"，而类型是可选参数 ⇒ 第 5 个调用点一忘就静默漏。
  const env = opts.env ?? sanitizedEnv();
  const child =
    opts.shell === true
      ? spawn(file, { cwd: opts.cwd, env, detached: true, shell: true })
      : spawn(file, [...args], { cwd: opts.cwd, env, detached: true });
  const timer = setTimeout(() => {
    opts.onTimeout();
    killGroup(child);
  }, opts.timeoutMs);
  liveTracked.add(child);
  child.once("close", () => liveTracked.delete(child));
  return { child, dispose: (): void => clearTimeout(timer) };
}
