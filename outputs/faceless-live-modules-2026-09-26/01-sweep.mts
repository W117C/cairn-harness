// 复跑读数（只读，不改盘）：桌面层那笔删除里，哪些**还被在树上的代码引用**的实现被摘掉了判卷面。
//
// 动因（第 78 页）：`tests/updater.test.ts` 在工作树已删，而 `src/main/updater.ts`（176 行，含
// "manifest 只允许 https"、semver 方向、`isSafeExternalUrl` 三道安全判据）**仍被 `settings-handlers.ts` 与
// `ipc-protocol.ts` 引用** ⇒ 工作树里它一条测试都没有。这不是一条孤例问题，是"删判卷面没同批删实现/摘锚点"
// 的一族 ⇒ 先把规模量出来，再决定谁去补。
//
// 三态自报（规则 104）：`取料失败`（git 读不到／HEAD 缺失）与 `扫到有料` 都必须红着退出，
// 只有"跑成了且分类完整"才退 0——**不**把"活实现无判卷面 ≥1"算成退出码红：那属别人未提交的删除，
// 在这里红会变成跨会话假红（规则 89/103），它需要的是点名与清单。
// 用法：node --import tsx outputs/faceless-live-modules-2026-09-26/01-sweep.mts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const git = (args: string[]): string => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

// ---- 取料：工作树里被删掉的测试面
const deletedTests = git(["status", "--porcelain"])
  .split("\n")
  .filter((l) => l.startsWith(" D ") && l.slice(3).trim().startsWith("tests/"))
  .map((l) => l.slice(3).trim());

// HEAD 里还在吗？（不在 ⇒ 那不是"删除"，是本来就没有，读数口径要分清）
const inHead = new Set(git(["ls-tree", "-r", "--name-only", "HEAD", "--", "tests"]).split("\n").filter(Boolean));
const trulyDeleted = deletedTests.filter((p) => inHead.has(p));
if (deletedTests.length > 0 && trulyDeleted.length === 0) {
  console.log("**取料失败**：`git status` 报了删除而 HEAD 的 tests 清单里一条都对不上 ⇒ 尺不可信，别读后面的数");
  process.exit(1);
}

/** 从一份测试源码里抽出它引的仓内模块（`../src/...`、`./helpers/...`）。
 *  只要相对导入：判卷面与实现的关系在这仓里全部走相对路径。 */
function importedModules(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/from\s+"((?:\.\.|\.\/)[^"]+)"/g)) out.push(m[1]!);
  return out;
}
const toRepoRel = (testPath: string, spec: string): string =>
  relative(ROOT, resolve(dirname(join(ROOT, testPath)), spec)).split("\\").join("/");

// ---- 在树上的实现（含未跟踪的新实现，删除案里也要能看见"没人测的新码"）
const trackedTs = git(["ls-files", "--", "src", "scripts"]).split("\n").filter(Boolean);
const diskTs = [...new Set([...trackedTs, ...git(["ls-files", "--others", "--exclude-standard", "--", "src"]).split("\n").filter(Boolean)])]
  .filter((p) => /\.(ts|mts)$/.test(p) && existsSync(join(ROOT, p)));
// 还在盘上的测试面（未跟踪的也算——它们同样能证伪"没尺"）
const diskTests = [...new Set([
  ...git(["ls-files", "--", "tests"]).split("\n").filter(Boolean),
  ...git(["ls-files", "--others", "--exclude-standard", "--", "tests"]).split("\n").filter(Boolean),
])].filter((p) => /\.test\.ts$/.test(p) && existsSync(join(ROOT, p)));
const importersOf = new Map<string, string[]>();
for (const f of [...diskTs, ...diskTests]) {
  for (const spec of importedModules(readFileSync(join(ROOT, f), "utf8"))) {
    const rel = toRepoRel(f, spec);
    // 归一到实际存在的文件（`./x.js` → `x.ts` 这类 ESM 写法在本仓不出现，但 `.ts` 后缀会被写上）
    const cand = [rel, rel.replace(/\.js$/, ".ts"), rel + ".ts", join(rel, "index.ts")];
    for (const c of cand) {
      if ((diskTs.includes(c) || diskTests.includes(c)) && c !== f) {
        const list = importersOf.get(c) ?? [];
        list.push(f);
        importersOf.set(c, list);
        break;
      }
    }
  }
}

// ---- 分类
// 三个维度要分开，混了就得出反向结论（第 78 页第一次跑就混了）：
//   importers：实现是否还被**判卷面以外**的代码引用（不是 ⇒ 只是"忘了删实现"）
//   tests：盘上**还有没有别的测试**引用它（有 ⇒ 只是少了一面，不是没尺）
const faceless = new Map<string, { via: string[]; importers: string[]; tests: string[] }>();
for (const t of trulyDeleted) {
  let headSrc = "";
  try { headSrc = git(["show", `HEAD:${t}`]); } catch { continue; }
  for (const spec of importedModules(headSrc)) {
    const rel = toRepoRel(t, spec);
    const alive = [rel, rel.replace(/\.js$/, ".ts"), rel + ".ts"].find((c) => diskTs.includes(c));
    if (alive === undefined) continue; // 实现也删了 ⇒ 正常
    const all = importersOf.get(alive) ?? [];
    const row = faceless.get(alive) ?? { via: [], importers: [], tests: [] };
    row.via.push(t);
    row.importers = [...new Set([...row.importers, ...all.filter((i) => !i.startsWith("tests/"))])];
    row.tests = [...new Set([...row.tests, ...all.filter((i) => i.startsWith("tests/"))])];
    faceless.set(alive, row);
  }
}
const rows = [...faceless.entries()].sort((a, b) => b[1].importers.length - a[1].importers.length);
const noJudge = rows.filter(([, v]) => v.importers.length > 0 && v.tests.length === 0);
const fewerJudges = rows.filter(([, v]) => v.importers.length > 0 && v.tests.length > 0);
const orphan = rows.filter(([, v]) => v.importers.length === 0);

console.log(`删除的判卷面：${String(trulyDeleted.length)} 个（git status 报 ${String(deletedTests.length)}，HEAD 里查得到 ${String(trulyDeleted.length)}）`);
console.log(`实现仍在树上的：${String(rows.length)} 份｜还被引用 ${String(noJudge.length + fewerJudges.length)} 份（其中**盘上已无任何测试引用** ${String(noJudge.length)} 份）、没人引用 ${String(orphan.length)} 份`);
console.log("");
console.log("=== A 真无判卷：实现还在被用，而盘上没有任何测试引用它（这一族要么补尺，要么同批摘实现+锚点）===");
// 自检两条（规则 74/104：新读数面每次跑都要自带正负控，否则"读到 0"就是没尺）：
//   正控：`src/agent/prune.ts` 一定还有测试在引（它有自己的判卷面）⇒ 认不出它＝取料面坏了
//   交叉：A 的每一行再用"整份文本搜文件名"独立复核一次（导入图之外的引用也算证据，如 barrel/动态 import）
const selfCheckTests = importersOf.get("src/agent/prune.ts")?.filter((i) => i.startsWith("tests/")) ?? [];
if (selfCheckTests.length === 0) {
  console.log("**读数不可信**：正控失败——连 `src/agent/prune.ts` 的判卷面都没认出来，取料面坏了，别读 A/B/C");
  process.exit(1);
}
for (const [src, v] of noJudge) {
  const stem = src.split("/").pop()!.replace(/\.ts$/, "");
  const mentions = diskTests.filter((t) => readFileSync(join(ROOT, t), "utf8").includes(stem));
  console.log(`  ${src}  ← 被 ${String(v.importers.length)} 处引用（如 ${v.importers.slice(0, 2).join("、")}）｜失去的判卷面：${v.via.join("、")}` +
    (mentions.length > 0 ? `｜**两把尺有分歧**：文本搜索在 ${mentions.slice(0, 3).join("、")} 里还认到这个文件名，需人工复判` : ""));
}
if (noJudge.length === 0) console.log("  （无）");
console.log("");
console.log("=== B 只是少了一面：盘上还有别的测试在引用它 ⇒ 不算缺尺，只登记规模 ===");
for (const [src, v] of fewerJudges.slice(0, 12)) {
  console.log(`  ${src}  剩余判卷面 ${String(v.tests.length)} 个｜失去：${v.via.slice(0, 2).join("、")}`);
}
if (fewerJudges.length > 12) console.log(`  …另有 ${String(fewerJudges.length - 12)} 份`);
console.log("");
console.log("=== C 没人引用、实现还留着（这一族是「忘了删实现」，不是「忘了测」）===");
for (const [src] of orphan.slice(0, 25)) console.log("  " + src);
if (orphan.length > 25) console.log(`  …另有 ${String(orphan.length - 25)} 份`);
console.log("");
console.log(noJudge.length + fewerJudges.length + orphan.length === rows.length
  ? "分类完整（三份集合互斥且并起来＝全部）✅"
  : "**分类不完整**：互斥/覆盖检查失败，上面的数不要引用");
process.exit(noJudge.length + fewerJudges.length + orphan.length === rows.length ? 0 : 1);
