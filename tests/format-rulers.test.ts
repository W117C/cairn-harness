/** 第 940 页：token 与字节的「尺」只准有 `derived/format-tokens.ts` 与 `derived/format-bytes.ts` 两处实现。
 *  动因：这两把尺在本仓被反复手抄——用量环 vs 时间线（k/m 两套写法）、用量页 vs 环（1.4万 vs 14.0k）、
 *  模型菜单 vs 浮层（128k vs 128.0k）、附件行 vs 日志窗（512 vs 512 B / 1024 KB）。每修一处就补一条判据，
 *  但「下一个人再抄一份」没有机械拦截。这一把就是那个拦截：任何组件/派生模块里出现 k/m/KB/MB 的拼装、
 *  `Intl` 紧凑记法或 `/1000` 取整，都当场红。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const RENDERER = join(ROOT, "apps/desktop/src/renderer");

/** 允许实现这两把尺的文件（相对 renderer 根）。 */
const ALLOWED = new Set(["derived/format-tokens.ts", "derived/format-bytes.ts"]);

/** 一条「自己拼数字刻度」的痕迹。 */
const PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "token-k", re: /\$\{[^}]*toFixed\(1\)\}k/gu },
  { name: "token-m", re: /\$\{[^}]*toFixed\(1\)\}m/gu },
  { name: "token-M", re: /toFixed\([^)]*\)\}M/gu },
  // 只认「模板里拼出来的数字 + 单位」：`${n} KB` 这种。错误文案里写「不能超过 1 MB」不算刻度。
  { name: "byte-unit", re: /`[^`]*\$\{[^}]*\}[^`]*\b(?:KB|MB)\b/gu },
  { name: "intl-compact", re: /notation:\s*"compact"/gu },
  { name: "round-k", re: /Math\.round\([^)]*\/\s*1000\)/gu },
  // 直接渲染字节数（`{e.size}`）：与附件行 2.1 KB 是两种写法，必须走 formatBytes。
  { name: "raw-bytes", re: /\{[a-z][A-Za-z0-9_]*\.size\}/gu },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { if (name !== "node_modules" && name !== "mimosa") walk(p); continue; }
      if (/\.(?:ts|tsx)$/u.test(name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe("token / 字节刻度只有两处实现（第 940 页）", () => {
  it("组件与派生模块里没有第三把尺", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(RENDERER)) {
      const rel = file.slice(RENDERER.length + 1);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const { name, re } of PATTERNS) {
        for (const m of text.matchAll(re)) {
          const line = text.slice(0, m.index ?? 0).split("\n").length;
          hits.push(`${rel}:${String(line)} [${name}] ${m[0].trim()}`);
        }
      }
    }
    expect(hits, "这些地方自己拼了 k/m/KB/MB 刻度（该读 derived/format-tokens 或 derived/format-bytes）：\n" + hits.join("\n")).toEqual([]);
  });

  it("两把尺本身还在（别把允许名单变成空保护）", () => {
    const tokens = readFileSync(join(RENDERER, "derived/format-tokens.ts"), "utf8");
    const bytes = readFileSync(join(RENDERER, "derived/format-bytes.ts"), "utf8");
    expect(tokens).toContain("export function formatTokens");
    expect(bytes).toContain("export function formatBytes");
  });
});
