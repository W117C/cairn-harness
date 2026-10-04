// 只读探针（#100 取证）：对盘上既有快照文件跑本仓自己的 redactSecrets 判据，
// 只回报「文件名 + 命中与否 + 命中类别/级别计数」——**绝不打印任何凭据值**。
// 不写盘、不起服务、不改动任何被扫文件。
//
// @ts-nocheck — 本文件是本任务唯一可写的 scratch 目录（outputs/…），不在 tsconfig.json 的
// include（src/scripts/tests）里，故相对导入 src/ 不参与项目解析；tsx 运行时照常解析。
// 根级 scripts/probe-snapshot-copy-restore.ts 同族探针不受此限。
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { redactSecrets } from "../../src/agent/security/scan";

const ROOTS = [
  ".agent/snapshots",
  "fixtures/todo-app/.agent/snapshots",
  ".worktrees/head-cert-f01c448/fixtures/todo-app/.agent/snapshots",
];

const CAP = 512 * 1024; // 单文件读帽，避免把大二进制整块吃进来

async function walk(dir: string, out: string[]): Promise<void> {
  let ents;
  try {
    ents = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) out.push(p);
  }
}

let files = 0;
let unreadable = 0;
let hitFiles = 0;
let blockedFiles = 0;
const byCategory = new Map<string, number>();
const samples: string[] = [];

for (const root of ROOTS) {
  const found: string[] = [];
  await walk(root, found);
  console.log(`# ${root}: ${String(found.length)} files`);
  for (const f of found) {
    files++;
    const st = await stat(f).catch(() => null);
    if (st === null || st.size === 0 || st.size > CAP) {
      unreadable++;
      continue;
    }
    const buf = await readFile(f).catch(() => null);
    if (buf === null) {
      unreadable++;
      continue;
    }
    // 含 NUL 视为二进制，不进文本判据（与 read_file 同一口径）
    if (buf.subarray(0, 8000).includes(0)) continue;
    let r;
    try {
      r = redactSecrets(buf.toString("utf8"));
    } catch {
      unreadable++;
      continue;
    }
    if (r.findings.length === 0) continue;
    hitFiles++;
    if (r.blocked) blockedFiles++;
    for (const fid of r.findings) {
      byCategory.set(fid.category + "/" + fid.severity, (byCategory.get(fid.category + "/" + fid.severity) ?? 0) + 1);
    }
    if (samples.length < 25) samples.push(relative(".", f) + "  hits=" + String(r.findings.length) + " blocked=" + String(r.blocked));
  }
}

console.log("\n=== 汇总（只计数，不含任何值）===");
console.log("scanned files      :", String(files));
console.log("skipped/ unreadable:", String(unreadable));
console.log("FILES WITH HITS    :", String(hitFiles));
console.log("FILES blocked      :", String(blockedFiles));
console.log("category/severity  :", JSON.stringify([...byCategory.entries()]));
console.log("first hit filenames (names only):");
for (const s of samples) console.log("  ", s);
