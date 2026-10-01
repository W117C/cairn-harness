// M2 验收证人（真数据，不是我编的补丁）：把本仓真实提交的 `git diff -U3` 喂给 apply_patch，
// 在一次性 scratch 树里重建「改前」状态，应用后逐文件比两件事：
//   ① 落盘内容与 `git show <sha>:<path>` 逐字节相同；
//   ② 回执里的 +a −b 与 `git diff --numstat` 该文件的数字相同（PLAN §M2 验收原文：与 git diff --stat 一致）。
// 拒绝面（删除/改名/二进制/纯模式段/补丁超限）单独计数并逐条带出处——它们是设计边界，不算失败。
//
// 两条分母纪律（本仓点过名的同类错误，各自在这里都栽过一次）：
//   · 第一版只按 hunk 个数设哨兵，路径解析整块坏掉（568 个文件全停在 "?"）却没被抓住 ⇒ 现在逐字段钉；
//   · `git` 默认 `core.quotePath=true` 把非 ASCII 路径转义成带引号的八进制 ⇒ 中文路径整个退出分母
//     （检查面先例 cfa91e1）。这里统一 `-c core.quotePath=false`，并打印「多字节路径文件」计数自证没瞎。
//   · 回执清单按 LIST_CAP=20 截断：截断的提交里，清单外的文件**不逐文件核数**（总数格另核）；
//     把「没打印」读成「数字不符」会产假读数（第二版实测 39 处全属此因）。
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { apply_patch, PATCH_LIMIT_BYTES } from "../../src/tools/apply_patch";

const N = Number(process.argv[2] ?? 200);
const MIN_HUNKS = 3; // PLAN §M2 验收要求「≥3 段 hunk 的补丁」

const git = (args: string[], silent = false): string =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: silent ? ["ignore", "pipe", "ignore"] : undefined,
  });

interface Numstat {
  path: string;
  add: number;
  rem: number;
  binary: boolean;
}
const numstatOf = (sha: string): Numstat[] =>
  git(["diff", "--numstat", `${sha}^`, sha])
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const [a, r, ...rest] = l.split("\t");
      return { path: rest.join("\t"), add: Number(a), rem: Number(r), binary: a === "-" };
    });

/** 只保留本工具该应用的段：update/create 且有 hunk；删除/改名/二进制整段剔掉（并计数）。
 *  返回 keptPaths：比对只拿「真的进了这笔补丁的文件」做分母——把被设计性拒掉的删除/改名段
 *  也算进分母，得到的只是探针自己的假不吻合（第一版就栽在这里，报了 14 处假不符）。 */
function selectPatch(full: string, keep: string[]): { patch: string; keptPaths: string[]; dropped: string[] } {
  const sections: string[] = [];
  let cur: string[] = [];
  for (const line of full.split("\n")) {
    if (line.startsWith("diff --git ") && cur.length > 0) {
      sections.push(cur.join("\n"));
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length > 0) sections.push(cur.join("\n"));
  const dropped: string[] = [];
  const kept: string[] = [];
  const keptPaths: string[] = [];
  for (const s of sections) {
    const first = s.split("\n")[0] ?? "";
    const m = / b\/(.*)$/.exec(first);
    const path = m?.[1] ?? "?";
    const isUpdateOrCreate = /^--- (a\/.+|\/dev\/null)/m.test(s) && /^\+\+\+ b\/.+/m.test(s);
    const hasHunk = /^@@ /m.test(s);
    const counts = keep.includes(path);
    if (isUpdateOrCreate && hasHunk && counts) {
      kept.push(s);
      keptPaths.push(path);
    } else {
      dropped.push(
        `${path}（${!isUpdateOrCreate ? "段形状不在本工具范围内（删除/改名/二进制）" : !hasHunk ? "无内容 hunk（纯模式段）" : "numstat 里没有它"}）`,
      );
    }
  }
  return { patch: kept.join("\n"), keptPaths, dropped };
}

const reportCount = (out: string, path: string): { add: number; rem: number } | null => {
  const m = new RegExp(`\\s${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\+(\\d+) −(\\d+)`).exec(out);
  return m === null ? null : { add: Number(m[1]), rem: Number(m[2]) };
};

const head = git(["rev-parse", "--short", "HEAD"]).trim();
const shas = git(["log", "--no-merges", "--pretty=%H", "-n", String(N)]).trim().split("\n").filter(Boolean);
console.log(`取料：HEAD=${head}｜非 merge 提交 ${String(shas.length)} 笔（HEAD 往回）｜门槛：可应用段 ≥${String(MIN_HUNKS)} hunk`);

let tried = 0;
let okCount = 0;
let byteMismatch = 0;
let countMismatch = 0;
let unlisted = 0;
let applyFailed = 0;
let oversize = 0;
let hunkTotal = 0;
let fileTotal = 0;
let multibyteFiles = 0;
const probeNotes: string[] = [];
const applyFailures: string[] = [];
const countFailures: string[] = [];
const byteFailures: string[] = [];

for (const sha of shas) {
  let full = "";
  try {
    full = git(["diff", "--unified=3", "--no-color", `${sha}^`, sha]);
  } catch {
    continue;
  }
  const ns = numstatOf(sha).filter((x) => !x.binary);
  const keep = ns.map((x) => x.path);
  const { patch, keptPaths } = selectPatch(full, keep);
  const compared = ns.filter((x) => keptPaths.includes(x.path));
  const hunks = (patch.match(/^@@ /gm) ?? []).length;
  if (hunks < MIN_HUNKS) continue;
  tried++;
  hunkTotal += hunks;

  if (Buffer.byteLength(patch, "utf8") > PATCH_LIMIT_BYTES) {
    oversize++; // 设计边界：超上限的补丁本工具明确拒收（含出处），不进应用分母
    probeNotes.push(`${sha.slice(0, 7)} 补丁 ${String(Buffer.byteLength(patch, "utf8"))} 字节 > ${String(PATCH_LIMIT_BYTES)} 上限（设计性拒绝）`);
    continue;
  }

  const dir = await mkdtemp(join(tmpdir(), "m2-realgit-"));
  try {
    // 重建「改前」状态：只铺本补丁涉及的文件的旧内容（新建段没有旧内容，不铺）。
    for (const path of keptPaths) {
      let old: string | null = null;
      try {
        old = git(["show", `${sha}^:${path}`], true);
      } catch {
        old = null;
      }
      if (old === null) continue;
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), old, "utf8");
    }
    const r = await apply_patch.run({ patch }, { workspace: dir, emit: async () => {}, snapshot: false, callId: sha.slice(0, 7) });
    if (!r.ok) {
      applyFailed++;
      applyFailures.push(`${sha.slice(0, 7)} 应用失败：${r.output.slice(0, 300)}`);
      continue;
    }
    okCount++;
    fileTotal += compared.length;
    const truncated = r.output.includes("未列");
    for (const x of compared) {
      if (/[^\u0000-\u007f]/u.test(x.path)) multibyteFiles++;
      let want: string | null = null;
      try {
        want = git(["show", `${sha}:${x.path}`], true);
      } catch {
        want = null;
      }
      if (want === null) {
        probeNotes.push(`${sha.slice(0, 7)} ${x.path} 应用后拿不到 git 的改后内容（探针自身缺口，不计入字节比对）`);
        continue;
      }
      const got = await readFile(join(dir, x.path), "utf8").catch(() => null);
      if (got !== want) {
        byteMismatch++;
        const g = got ?? "";
        let at = 0;
        while (at < Math.min(g.length, want.length) && g[at] === want[at]) at++;
        byteFailures.push(
          `${sha.slice(0, 7)} ${x.path} 逐字节不符：第 ${String(at)} 字节起分叉｜git 侧 ${JSON.stringify(want.slice(at, at + 60))}｜工具侧 ${JSON.stringify(g.slice(at, at + 60))}`,
        );
      }
      const rep = reportCount(r.output, x.path);
      if (rep === null) {
        if (truncated) unlisted++; // 清单按 20 个文件截断：没打印 ≠ 数字不符；总数格另核
        else {
          countMismatch++;
          countFailures.push(`${sha.slice(0, 7)} ${x.path} 回执里没有该文件的行数行（清单没截断却找不到它）`);
        }
      } else if (rep.add !== x.add || rep.rem !== x.rem) {
        countMismatch++;
        countFailures.push(`${sha.slice(0, 7)} ${x.path} 行数读数与 git 不一致：回执 +${String(rep.add)} −${String(rep.rem)}｜numstat +${String(x.add)} −${String(x.rem)}`);
      }
    }
    // 总数格：清单会截断，但汇总的 `+X −Y` 不截断，拿它对着 numstat 的总和再核一遍。
    const sumAdd = compared.reduce((n, x) => n + x.add, 0);
    const sumRem = compared.reduce((n, x) => n + x.rem, 0);
    const total = /\+(\d+) −(\d+) 行/.exec(r.output);
    if (total === null) {
      countMismatch++;
      countFailures.push(`${sha.slice(0, 7)} 回执里没有总行数格`);
    } else if (Number(total[1]) !== sumAdd || Number(total[2]) !== sumRem) {
      countMismatch++;
      countFailures.push(`${sha.slice(0, 7)} 总数与 numstat 之和不符：回执 +${total[1]} −${total[2]}｜git +${String(sumAdd)} −${String(sumRem)}`);
    }
  } catch (e) {
    applyFailed++;
    applyFailures.push(`${sha.slice(0, 7)} 抛错：${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

console.log("—— 结果 ——");
console.log(`合格提交（可应用段 ≥${String(MIN_HUNKS)} hunk）：${String(tried)} 笔｜应用成功：${String(okCount)}｜应用失败：${String(applyFailed)}｜超上限拒绝：${String(oversize)}（设计边界）`);
console.log(`覆盖 hunk 合计 ${String(hunkTotal)}｜逐字节比对文件 ${String(fileTotal)}（其中多字节路径 ${String(multibyteFiles)}，分母含中文路径自证）｜回执清单截断未逐文件核数的：${String(unlisted)} 个（总数格已另核）`);
console.log(`内容逐字节与 git 不符：${String(byteMismatch)} 处`);
console.log(`行数读数与 git numstat 不符：${String(countMismatch)} 处`);
for (const f of applyFailures.slice(0, 10)) console.log(`  [应用失败] ${f}`);
for (const f of countFailures.slice(0, 15)) console.log(`  [行数不符] ${f}`);
for (const f of byteFailures.slice(0, 15)) console.log(`  [字节不符] ${f}`);
for (const f of probeNotes.slice(0, 10)) console.log(`  [探针注记] ${f}`);
if (probeNotes.length > 10) console.log(`  [探针注记] …另有 ${String(probeNotes.length - 10)} 条未列`);
process.exit(byteMismatch === 0 && countMismatch === 0 && applyFailed === 0 ? 0 : 1);
