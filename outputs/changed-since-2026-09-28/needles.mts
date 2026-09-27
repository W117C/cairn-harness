/** 第 162 页新锚点的针脚预跑：每根针在被改文件里必须**恰好命中一次**、改得动、且 expectFail 那条标题取得到。
 *  为什么每次新增都写一份而不是直接交笔（规则 223）：`--check-needles` 那道门要 6 秒且会把别人的在飞文本一起报，
 *  而这里只想在落笔前确认自己这几根的位置。用法：`node --import tsx outputs/changed-since-2026-09-28/needles.mts` */
import { readFileSync } from "node:fs";

const FILES = {
  lib: "scripts/lib/mutate-gates.ts",
  mv: "scripts/mutate-verify.mjs",
  test: "tests/mutate-verify-gates.test.ts",
};

const CASES: [string, string, string, string][] = [
  ["lib", "  const ids = entries.filter((e) => changed.has(e.src) || (e.test !== undefined && changed.has(e.test))).map((e) => e.id);",
    "  const ids = entries.filter((e) => changed.has(e.src)).map((e) => e.id);", "改被测源 ⇒ 选中"],
  ["lib", "  return { ids, faceCount: changed.size, pickedCount: ids.length, total: entries.length };",
    "  return { ids, faceCount: changed.size, pickedCount: ids.length, total: ids.length };", "两面都不在改动面"],
  ["lib", "  const changed = new Set(changedPaths.filter((p) => p !== \"\"));",
    "  const changed = new Set(changedPaths);", "git 输出的尾换行不算一个文件"],
  ["lib", "  return eq > 0 && (MUTATE_EQ_VALUE_FLAGS as readonly string[]).includes(arg.slice(0, eq));",
    "  return eq > 0;", "两条反向哨兵"],
  ["mv", "\nconst targets = [...new Set([...plan.targets, ...derived.ids])];",
    "\nconst targets = [...plan.targets];", "接线：派生出来的 id 真的并进 targets"],
  ["mv", "\n    derived = selectChangedEntries(MUTATIONS, changed);",
    "\n    derived = selectChangedEntries(MUTATIONS, []);", "接线：派生出来的 id 真的并进 targets"],
  ["mv", "\n    process.exit(2); // 取料坏 ≠ 空面",
    "\n    process.exit(0); // 取料坏 ≠ 空面", "rev 取不到 ⇒ exit 2 并点名那个 rev"],
  ["mv", "\n  const rows = sinceArg === null ? MUTATIONS : MUTATIONS.filter((m) => derived.ids.includes(m.id));",
    "\n  const rows = MUTATIONS.filter((m) => derived.ids.includes(m.id));", "派生可以只看名单不真跑"],
  ["lib", "const unknown = args.filter((a, i) => !consumed.has(i) && a.startsWith(\"--\") && !isKnownMutateFlag(a));",
    "const unknown: string[] = [];", "拼错/未实现的 flag 落进 unknown，且不混进 targets"],
];

let bad = 0;
for (const [key, needle, replacement, titleHint] of CASES) {
  const src = readFileSync(FILES[key as keyof typeof FILES], "utf8");
  const hits = src.split(needle).length - 1;
  const changed = src.replace(needle, replacement) !== src;
  const titled = readFileSync(FILES.test, "utf8").includes(titleHint) ||
    // 最后一条的标题在隔壁判卷文件里（`classify-unknown-flag-ignored` 钉的是 mutate-needles-check）
    readFileSync("tests/mutate-needles-check.test.ts", "utf8").includes(titleHint);
  if (hits !== 1 || !changed || !titled) bad++;
  console.log(`${hits === 1 && changed && titled ? "ok  " : "BAD "} ${String(hits)} 处｜${key}｜${needle.slice(0, 44)}｜标题「${titleHint}」=${String(titled)}`);
}
console.log(bad === 0 ? "9 根针脚：唯一命中、改得动、判卷标题取得到" : `${String(bad)} 条不合格`);
process.exit(bad === 0 ? 0 : 1);
