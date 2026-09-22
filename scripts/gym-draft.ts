// 靶场草稿生成器（待办 #47）：把一条真会话的 events.jsonl 转成 `fixtures/gym/drafts/<id>/`。
// 缺省只打印计划（dry run），`--apply` 才落盘；**永远不落进 cases/**，也永远不碰
// `scripts/frozen-sha256.json`——冻结判据是本仓第一纪律里唯一必须由人做的那一步。
// 用法：node --import tsx scripts/gym-draft.ts <events.jsonl> [--id 名] [--out 目录] [--apply]
import { replay } from "../src/events";
import { draftFromEvents, renderDraft, draftDirFor } from "../src/agent/gym/draft";
import { basename, extname, join, resolve, sep } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

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
if (eventsPath === "") {
  console.error('用法：node --import tsx scripts/gym-draft.ts <events.jsonl> [--id 名] [--out 目录] [--apply]');
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
