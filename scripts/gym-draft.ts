// 靶场草稿生成器（待办 #47）：把一条真会话的 events.jsonl 转成 `fixtures/gym/drafts/<id>/`。
// 缺省只打印计划（dry run），`--apply` 才落盘；**永远不落进 cases/**，也永远不碰
// `scripts/frozen-sha256.json`——冻结判据是本仓第一纪律里唯一必须由人做的那一步。
// 用法：
//   node --import tsx scripts/gym-draft.ts <events.jsonl> [--id 名] [--out 目录] [--apply]
//   node --import tsx scripts/gym-draft.ts --check <草稿目录>        # 人补件核对（不齐 ⇒ 退出码 1）
import { replay } from "../src/events";
import { draftFromEvents, renderDraft, draftDirFor, promoteBlockers } from "../src/agent/gym/draft";
import { collectRelFiles } from "../src/agent/gym/score";
import { basename, extname, join, resolve, sep } from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";

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
  console.error('用法：node --import tsx scripts/gym-draft.ts (<events.jsonl> [--id 名] [--out 目录] [--apply] | --check <草稿目录>)');
  process.exit(2);
}
const log = await replay(eventsPath);
const id = opt("id") ?? (basename(eventsPath, extname(eventsPath)).replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+/, "") || "session");
const draft = draftFromEvents(log);
const dest = opt("out") !== undefined ? resolve(opt("out")!) : resolve(draftDirFor(join(ROOT, "fixtures", "gym"), id));

// 落点守卫：草稿进 cases/ 就等于把一份没核过的观察当成判据跑（A3 的 sha256 walk 只走 cases，
// 因此它还会伪装成"已冻结"）。这条判断与 `casePathProblem` 是同一件事的两端，各自都要在。
const insideCases = dest === CASES_ROOT || dest.startsWith(CASES_ROOT + sep);
if (insideCases) {
  console.error(`[gym-draft] 拒绝写进 cases/（${dest}）：草稿不是判据。核完 repo/ 与 negative.json 后由人 promote。`);
  process.exit(1);
}

const files = renderDraft(draft, id);
console.log(`[gym-draft] 源会话 ${eventsPath}`);
console.log(`[gym-draft] 落点 ${dest}${flags.has("--apply") ? "（--apply：写盘）" : "（dry run，加 --apply 才写）"}`);
for (const [name, body] of Object.entries(files)) {
  console.log(`  · ${name}（${String(body.split("\n").length)} 行）`);
  if (flags.has("--apply")) {
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, name), body, "utf8");
  }
}
console.log(`还缺（逐条人给，缺一不 promote）：`);
for (const m of draft.missing) console.log("  - " + m);
if (!flags.has("--apply")) console.log("[gym-draft] 未写盘（dry run）。要落盘加 --apply；promote 与 sha256 登记永远是人的动作。");
else console.log(`[gym-draft] 已写草稿。promote 前请把 repo/ 与 negative.json 补进 ${dest}，再把目录移入 cases/ 并登记 scripts/frozen-sha256.json。`);
