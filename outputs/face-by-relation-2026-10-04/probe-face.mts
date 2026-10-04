// 两棵树、两个面：把「跟踪面 vs 盘面对」量成一张可对账的表（第 354 页的证人）。
// 只读；跑法：node --import tsx outputs/face-by-relation-2026-10-04/probe-face.mts
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const trees: Array<[string, string]> = [
  ["主树（脏，164 项在飞）", "/Users/ze/Downloads/Cairn/deepseek harness"],
  ["干净 HEAD 验证树", "/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-013fb97"],
];

const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

const walkJsonl = (root: string, dir: string): string[] => {
  const out: string[] = [];
  const rec = (d: string): void => {
    let names: string[];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = `${d}/${n}`;
      let isDir = false;
      try { isDir = readdirSync(p).length >= 0; } catch { isDir = false; }
      if (isDir) rec(p);
      else if (n.endsWith(".jsonl")) out.push(p.replace(root + "/", ""));
    }
  };
  rec(`${root}/fixtures`);
  return out.sort();
};

for (const [label, root] of trees) {
  const tracked = git(root, ["ls-files", "--", "fixtures"]).split("\n").filter((p) => p.endsWith(".jsonl")).sort();
  const disk = walkJsonl(root, root);
  const leak = disk.filter((p) => !new Set(tracked).has(p));
  console.log(`${label}：跟踪面 ${String(tracked.length)}｜盘面 ${String(disk.length)}｜盘有而跟踪没有 ${String(leak.length)}${leak.length ? " ← " + leak.slice(0, 3).join("、") : ""}`);
}
