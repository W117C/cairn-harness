/**
 * 桌面主进程的落盘日志（2026-10-30 · 第 800 页）。
 *
 * 缺口：打包后的 Cairn 从 Finder 启动，主进程的 console 输出进不了任何用户可打开的文件；
 * 进程起不来、IPC 报错、调度器装配失败这些「应用级」故障只剩一句白屏。设置页说「对照日志」
 * 却没有任何东西可对照。会话日志（SessionLogDialog）只覆盖某一场会话的 JSONL，不覆盖壳。
 *
 * 本模块只做三件事：一行一条的格式、按大小轮转、把 console 分流到文件。**日志失败绝不
 * 影响产品**——所有 fs 异常都在这里吞掉（日志写不出来是次要故障，不该把主进程带崩）。
 * 轮转口径：main.log 超过上限后，旧文件依次改名为 main.1.log … main.N.log，只留 keep 份。
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/** 单个日志文件上限。2 MiB ≈ 数万行启动/错误记录，足够定位一次事故，也不会无限长。 */
export const APP_LOG_MAX_BYTES = 2 * 1024 * 1024;
/** 保留份数：main.log + main.1.log。 */
export const APP_LOG_KEEP = 2;

export type AppLogLevel = "info" | "warn" | "error";

export interface AppLog {
  /** 当前文件绝对路径（UI 与菜单只展示目录，不把路径发给渲染层）。 */
  readonly file: string;
  write(level: AppLogLevel, message: string): void;
}

/** 一行一条：ISO 时间（含毫秒）+ 级别 + 正文。多行正文（stack）原样保留，便于直接读。 */
export function formatAppLogLine(at: Date, level: AppLogLevel, message: string): string {
  return `${at.toISOString()} [${level}] ${message}\n`;
}

/** 把任意 console 参数折成一行可读文本；对象循环引用等异常退回 String，绝不抛出。 */
export function formatLogArgument(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function createAppLog(opts: {
  dir: string;
  maxBytes?: number;
  keep?: number;
  /** 测试注入；默认真实时间。 */
  now?: () => Date;
}): AppLog {
  const maxBytes = opts.maxBytes ?? APP_LOG_MAX_BYTES;
  const keep = Math.max(1, opts.keep ?? APP_LOG_KEEP);
  const file = join(opts.dir, "main.log");
  const now = opts.now ?? (() => new Date());
  let dirReady = false;

  const ensureDir = (): void => {
    if (dirReady) return;
    mkdirSync(opts.dir, { recursive: true });
    dirReady = true;
  };

  /** 超过上限才轮转；轮转失败也继续写当前文件（宁可超长，也不丢这一条）。 */
  const rotateIfNeeded = (): void => {
    try {
      if (!existsSync(file)) return;
      if (statSync(file).size < maxBytes) return;
      for (let i = keep - 1; i >= 1; i -= 1) {
        const from = i === 1 ? file : join(opts.dir, `main.${String(i - 1)}.log`);
        const to = join(opts.dir, `main.${String(i)}.log`);
        if (existsSync(from)) renameSync(from, to);
      }
    } catch {
      /* 轮转是优化，不是正确性；写不进去由 write 的 catch 兜底。 */
    }
  };

  return {
    file,
    write(level, message) {
      const line = formatAppLogLine(now(), level, message);
      try {
        ensureDir();
        rotateIfNeeded();
        appendFileSync(file, line);
      } catch {
        /* 日志失败不影响产品。 */
      }
    },
  };
}

type ConsoleLike = Pick<Console, "log" | "info" | "warn" | "error">;

/** 把 console 的四个常用级别分流到文件，同时保留原输出（终端/冒烟仍可读）。 */
export function teeConsole(log: AppLog, target: ConsoleLike = console): void {
  const routes: readonly [keyof ConsoleLike, AppLogLevel][] = [
    ["log", "info"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ];
  for (const [method, level] of routes) {
    const original = target[method].bind(target) as (...args: unknown[]) => void;
    target[method] = ((...args: unknown[]) => {
      log.write(level, args.map(formatLogArgument).join(" "));
      original(...args);
    }) as ConsoleLike[typeof method];
  }
}
