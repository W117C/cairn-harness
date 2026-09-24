import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { relative, resolve, sep } from "node:path";
import { sanitizedEnv } from "./process.js";

// 统一用 @vscode/ripgrep 自带的预编译二进制（本机 PATH 没有 rg，禁 spawn("rg")）。
// 不能静态 import：该包会被打进 Electron main bundle，__dirname 丢失后其平台二进制
// require.resolve 失败（panels-check B1 抓到的 ERR）。运行时从真实 node_modules 解析。
const nodeRequire = createRequire(import.meta.url);
let cachedRgPath: string | null = null;

/** 统一用 @vscode/ripgrep 自带的预编译二进制路径（懒解析 + 缓存）。 */
export function rgBinary(): string {
  if (cachedRgPath === null) {
    const mod = nodeRequire("@vscode/ripgrep") as { rgPath: string };
    cachedRgPath = mod.rgPath;
  }
  return cachedRgPath;
}

/**
 * 阴性结果的说明（grep 与 glob 共用一份政策句，各自填自己**真跳过**了什么）。
 *
 * 为什么要有这句：两个工具的零命中原本只回「无命中」/「无匹配文件」三个字加 `ok:true`，
 * 而 rg 的默认扫描面**不包括** `.gitignore` 忽略的条目（grep 还跳过隐藏文件；glob 带
 * `--hidden` 但额外排掉 `.git`/`node_modules`/`dist`）。模型把这种阴性读成「仓库里没有
 * 这个东西」，于是改完一处不去改调用方——这是"返工"的正面来源。
 * 括号里那句逃生口是**实测**的：显式给出的路径不受忽略规则挡
 * （`rg PATTERN .` 看不见 `gen/x.ts`，`rg PATTERN gen` 与 `rg PATTERN .env` 都看得见），
 * 所以不需要新增工具参数，也不需要 `--no-ignore`（那会把 node_modules 一并拽进扫描面）。
 * ⚠️ 但它**只挡 `.gitignore` 那一类**：本仓自己用 `--glob` 排掉的那三类目录（glob 工具排的
 * `.git`/`node_modules`/`dist`）**不让位**（2026-09-24 实测：把 `node_modules` 显式作为搜索根
 * 传进那条命令，返回空且退出码 0）。所以调用方若有自建排除，必须在被点名时自己撤掉那一条
 * （glob 现在就是这么做的），否则这句会把模型指去一条走不通的路——而它恰恰是为不再走冤枉路才写的。
 * 参数化的只有「这个工具跳过了什么」那半句——写错一次就等于让说明本身变成谎。
 */
export function rgNegativeNote(skipped: string): string {
  return (
    `这不是「仓库里没有」——本次扫描${skipped}。` +
    "怀疑目标在其中时，把 path 显式指到那个目录/文件再搜一次（显式路径不受忽略规则挡）。"
  );
}

export interface RawMatch {
  /** workspace 相对路径（统一输出口径）。 */
  path: string;
  line: number; // 1-based
  text: string; // 原始行文本（不含行尾换行）
  /** rg `--context` 带出的邻行（命中行为缺省）。
   *  不新写一个收集器：邻行与命中行同流同序，分开收会丢掉「哪条是命中」这一层信息。 */
  ctx?: true;
}

function toRelative(workspace: string, p: string): string {
  const rel = relative(resolve(workspace), resolve(p));
  return rel.split(sep).join("/");
}

/** 输出累积上限（C10，审查 P2）：rg 全量 stdout 无上限拼接在大仓库可 OOM——达到上限即杀进程
 *  并报错（fail-visible），不静默截断。32MB ≈ 数万条 --json 事件，正常检索远达不到。 */
const RG_OUTPUT_CAP_BYTES = 32 * 1024 * 1024;
/** 子进程超时（C10）：无超时 + 无 kill = 大仓库长挂。60s 与 run_shell 既有超时同量级。 */
const RG_TIMEOUT_MS = 60_000;

/** 跑 rg --json，把 match 事件收成 RawMatch[]；子进程失败抛错（含 stderr 摘要）。 */
export function runRgJson(workspace: string, args: string[]): Promise<RawMatch[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(rgBinary(), args, { cwd: workspace, env: sanitizedEnv() }); // D1：env 消毒
    let stdout = "";
    let stderr = "";
    let settled = false;
    let bytes = 0;
    const killWith = (msg: string): void => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rejectPromise(new Error(msg));
    };
    const timer = setTimeout(() => killWith(`grep: rg 超时（${String(RG_TIMEOUT_MS / 1000)}s，已终止——查询面过大或输出异常）`), RG_TIMEOUT_MS);
    timer.unref?.();
    const onFail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(err instanceof Error ? err : new Error(String(err)));
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdout += d;
      bytes += Buffer.byteLength(d);
      if (bytes > RG_OUTPUT_CAP_BYTES) killWith(`grep: rg 输出超过 ${String(RG_OUTPUT_CAP_BYTES / 1024 / 1024)}MB 上限，已终止（请收窄查询范围）`);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => { stderr += d; });
    child.on("error", onFail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && code !== 1) {
        // rg 退出码：0=有命中，1=无命中，2+=出错
        rejectPromise(new Error(`grep: rg 退出码 ${code}${stderr ? ": " + stderr.slice(0, 200) : ""}`));
        return;
      }
      const matches: RawMatch[] = [];
      for (const line of stdout.split("\n")) {
        if (!line) continue;
        let obj: { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
        try { obj = JSON.parse(line); } catch { continue; } // 坏行跳过，不让单条坏 JSON 炸整个输出
        if ((obj.type !== "match" && obj.type !== "context") || !obj.data) continue;
        const p = obj.data.path?.text ?? "";
        const lineNo = obj.data.line_number ?? 0;
        const text = obj.data.lines?.text ?? "";
        if (!p || lineNo < 1) continue;
        matches.push({
          path: toRelative(workspace, p),
          line: lineNo,
          text: text.replace(/\n$/, ""),
          ...(obj.type === "context" ? { ctx: true as const } : {}),
        });
      }
      resolvePromise(matches);
    });
  });
}
