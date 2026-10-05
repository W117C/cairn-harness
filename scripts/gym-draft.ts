// 靶场草稿生成器（待办 #47）：把一条真会话的 events.jsonl 转成 `fixtures/gym/drafts/<id>/`。
// 缺省只打印计划（dry run），`--apply` 才落盘；**永远不落进 cases/**，也永远不碰
// `scripts/frozen-sha256.json`——冻结判据是本仓第一纪律里唯一必须由人做的那一步。
// 用法：
//   node --import tsx scripts/gym-draft.ts <events.jsonl> [--id 名] [--out 目录] [--apply]
//   node --import tsx scripts/gym-draft.ts <留档目录> [--apply]     # #109：基准留档目录一把转（不吃 --id/--out）
//   node --import tsx scripts/gym-draft.ts --check <草稿目录>        # 人补件核对（不齐 ⇒ 退出码 1）
// 那个「留档目录」就是 `scripts/loop-eval.ts` 每跑一片红写在 `outputs/<臂>/failures/<日期>/` 的那一批
// （`scripts/lib/failed-trace-keep.ts`）——基准的失败轨迹到这里终于有了**一条命令**的取料口，
// 而草稿的生产仍旧只有 `renderDraft` 这一份，没有第二条平行通路。
import { replay } from "../src/events";
import { draftFromEvents, renderDraft, draftDirFor, promoteBlockers } from "../src/agent/gym/draft";
import { collectRelFiles } from "../src/agent/gym/score";
import { caseIdOfTrace, TRACE_SUFFIX } from "./lib/failed-trace-keep";
import type { Dirent } from "node:fs";
import { join, resolve, sep } from "node:path";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";

const ROOT = resolve(import.meta.dirname, "..");
const CASES_ROOT = join(ROOT, "fixtures", "gym", "cases");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const opt = (name: string): string | undefined => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : undefined;
};

const eventsPath = positional[0] ?? "";

// 认不出的 flag 一律拒跑：本脚本缺省语义是「读一条会话并可能写盘」，把拼错的 `--chek` 当成
// 「不是核对模式」走下去，等于用户以为自己核过了、其实生成了一遍草稿。
const unknownFlags = args.filter((a) => a.startsWith("--") && !["--apply", "--check"].includes(a) && !a.startsWith("--id") && !a.startsWith("--out"));
if (unknownFlags.length > 0) {
  console.error(`[gym-draft] 未知参数：${unknownFlags.join(" ")} —— 不把拼错的 flag 静默当成缺省模式`);
  process.exit(2);
}

// 核对模式：不读会话，只看一条草稿目录离 promote 还差什么（不齐 ⇒ 退出码 1，能进脚本链）。
if (flags.has("--check")) {
  const abs = resolve(eventsPath);
  const st = await stat(abs).catch(() => null);
  if (st === null || !st.isDirectory()) {
    console.error(`[gym-draft --check] 目录不存在或不是目录：${abs}`);
    process.exit(2);
  }
  const names = [...(await collectRelFiles(abs))].sort();
  const blockers = promoteBlockers(names);
  console.log(`[gym-draft --check] ${abs}（盘上 ${String(names.length)} 个文件）`);
  for (const b of blockers) console.log("  ⛔ " + b);
  if (blockers.length === 0) {
    console.log("  ✅ 四件齐（task.md / repo/ / negative.json / expect.json）⇒ 可 promote：");
    console.log("     移进 fixtures/gym/cases/ + 在 index.json 追加一条 + 把新文件登记进 scripts/frozen-sha256.json（这三步永远是人的动作）");
  }
  process.exit(blockers.length === 0 ? 0 : 1);
}

if (eventsPath === "") {
  console.error('用法：node --import tsx scripts/gym-draft.ts (<events.jsonl>|<留档目录> [--apply] | --check <草稿目录>)');
  console.error('     （--id／--out 只对单文件那一支有意义：给目录时每份转录按自己的靶名落一份草稿）');
  process.exit(2);
}

const APPLY = flags.has("--apply");

/** cases/ 守卫（两条路共用一份定义）：草稿进 cases/ 就等于把一份没核过的观察当成判据跑
 *  （A3 的 sha256 walk 只走 cases，因此它还会伪装成"已冻结"）。
 *  这条判断与 `casePathProblem` 是同一件事的两端，各自都要在。 */
function refusesInsideCases(dest: string): boolean {
  return dest === CASES_ROOT || dest.startsWith(CASES_ROOT + sep);
}

/** 一份转录 → 一份草稿（缺省 dry run）。单文件模式与目录模式**共用这一份**，
 *  免得两条路各自的「写哪三个文件」漂成两个样子（同一谓词两份副本那一族）。 */
async function emitDraft(eventsFile: string, dest: string, caseId: string): Promise<void> {
  const draft = draftFromEvents(await replay(eventsFile));
  const files = renderDraft(draft, caseId);
  console.log(`[gym-draft] 源会话 ${eventsFile}`);
  console.log(`[gym-draft] 落点 ${dest}${APPLY ? "（--apply：写盘）" : "（dry run，加 --apply 才写）"}`);
  for (const [name, body] of Object.entries(files)) {
    console.log(`  · ${name}（${String(body.split("\n").length)} 行）`);
    if (APPLY) {
      await mkdir(dest, { recursive: true });
      await writeFile(join(dest, name), body, "utf8");
    }
  }
  console.log("还缺（逐条人给，缺一不 promote）：");
  for (const m of draft.missing) console.log("  - " + m);
}

/** 留档目录里的转录（递归找 `*.events.jsonl`）。运行缓存那两支不进面。 */
async function findTraces(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [] as Dirent[])) {
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".git") await walk(join(d, e.name));
        continue;
      }
      if (e.isFile() && e.name.endsWith(TRACE_SUFFIX)) out.push(join(d, e.name));
    }
  };
  await walk(dir);
  return out.sort();
}

const asStat = await stat(eventsPath).catch(() => null);
if (asStat?.isDirectory()) {
  // 目录那一支就是 #109 的接线：`outputs/<臂>/failures/<日期>/` 里那些留档，一条命令转成一收件箱草稿。
  // `--id`／`--out` 对「一批各按自己靶名」的转录没有定义——静默只听第一个（或把 N 份草稿写进同一个目录）
  // 正是 #63c 点过的"悄悄只听一个"那一族 ⇒ 当场拒跑，不猜。
  if (opt("id") !== undefined || opt("out") !== undefined) {
    console.error("[gym-draft] 给的是目录 ⇒ 不接受 --id/--out（每份转录按自己的名字落一份草稿）。");
    process.exit(2);
  }
  const found = await findTraces(resolve(eventsPath));
  if (found.length === 0) {
    console.error(`[gym-draft] 目录里没有 *${TRACE_SUFFIX}：${resolve(eventsPath)} ⇒ 这是「没取到料」，不是「没有失败」`);
    process.exit(2);
  }
  let drafted = 0;
  let already = 0;
  for (const f of found) {
    const caseId = caseIdOfTrace(f);
    const dest = resolve(draftDirFor(join(ROOT, "fixtures", "gym"), caseId));
    if (refusesInsideCases(dest)) {
      console.error(`[gym-draft] 拒绝写进 cases/（${dest}）：草稿不是判据。核完 repo/ 与 negative.json 后由人 promote。`);
      process.exit(1);
    }
    // 已在场 ⇒ 不覆盖（同 `src/agent/gym/draft.ts` 落盘那一跳的第③条：人可能已经补了件）。
    if (await stat(dest).then((s) => s.isDirectory()).catch(() => false)) {
      already += 1;
      console.log(`[gym-draft] 跳过 ${caseId}：草稿已在场 ⇒ 不覆盖（人可能已往里补 repo/ 与 negative.json）`);
      continue;
    }
    await emitDraft(f, dest, caseId);
    drafted += 1;
  }
  console.log(`[gym-draft] 目录扫完：候选 ${String(found.length)} 份转录 · ${APPLY ? "写出" : "计划写出"} ${String(drafted)} 条草稿 · 已在场不覆盖 ${String(already)} 条`);
  console.log("[gym-draft] 落点 fixtures/gym/drafts/<id>/（**不是判据**）。逐条核对：node --import tsx scripts/gym-draft.ts --check <那条草稿目录>；promote 与 sha256 登记永远是人的动作。");
  process.exit(0);
}

const singleId = opt("id") ?? caseIdOfTrace(eventsPath);
const singleDest = opt("out") !== undefined ? resolve(opt("out")!) : resolve(draftDirFor(join(ROOT, "fixtures", "gym"), singleId));
if (refusesInsideCases(singleDest)) {
  console.error(`[gym-draft] 拒绝写进 cases/（${singleDest}）：草稿不是判据。核完 repo/ 与 negative.json 后由人 promote。`);
  process.exit(1);
}
await emitDraft(eventsPath, singleDest, singleId);
if (!APPLY) console.log("[gym-draft] 未写盘（dry run）。要落盘加 --apply；promote 与 sha256 登记永远是人的动作。");
else console.log(`[gym-draft] 已写草稿。promote 前请把 repo/ 与 negative.json 补进 ${singleDest}，再把目录移入 cases/ 并登记 scripts/frozen-sha256.json。`);
