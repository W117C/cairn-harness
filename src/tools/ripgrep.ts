import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { relative, resolve, sep } from "node:path";

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

export interface RawMatch {
  /** workspace 相对路径（统一输出口径）。 */
  path: string;
  line: number; // 1-based
  text: string; // 原始行文本（不含行尾换行）
}

function toRelative(workspace: string, p: string): string {
  const rel = relative(resolve(workspace), resolve(p));
  return rel.split(sep).join("/");
}

/** 跑 rg --json，把 match 事件收成 RawMatch[]；子进程失败抛错（含 stderr 摘要）。 */
export function runRgJson(workspace: string, args: string[]): Promise<RawMatch[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(rgBinary(), args, { cwd: workspace });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => { stdout += d; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => { stderr += d; });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
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
        if (obj.type !== "match" || !obj.data) continue;
        const p = obj.data.path?.text ?? "";
        const lineNo = obj.data.line_number ?? 0;
        const text = obj.data.lines?.text ?? "";
        if (!p || lineNo < 1) continue;
        matches.push({ path: toRelative(workspace, p), line: lineNo, text: text.replace(/\n$/, "") });
      }
      resolvePromise(matches);
    });
  });
}
