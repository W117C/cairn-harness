/**
 * ⑦ 「按名字枚举前缀词」收不完 —— 三条结构性候选的代价量测。
 * 一次性读数脚本：不进门禁、不被任何判据消费，只为把「往哪走」变成可裁的数字。
 *
 * 问的不是哪条更聪明，而是换掉白名单后：⑴ 15 支缺口收回几支；⑵ 本仓天天在跑的真命令被牵连几支。
 * 跑法：node --import tsx outputs/measure-prefix-word-candidates-2026-09-22.mts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandForms, EXEC_WRAPPERS, tokenize } from "../src/permissions/command-shape";
import {
  UNBOUNDED_PREFIX_WORDS, DENY_VARIANTS, GLOBAL_OPT_VARIANTS, PREFIX_WORD_VARIANTS,
  GLOBAL_OPT_MUST_STAY_CLEAN, PREFIX_WORD_MUST_STAY_CLEAN, ALLOW_CASES,
} from "../scripts/lib/shell-bypass-cases";

/** 量测靶子 = 探针那条用户手写 deny。today 的口径与 `rules.ts:matchSegment` 一致（形态 startsWith pattern）。 */
const PATTERN = "git push --force";
const P = tokenize(PATTERN);
const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const starts = (cmd: string) => cmd.startsWith(PATTERN);

const hitToday = (cmd: string) => commandForms(cmd).some(starts);
/** 候选 A 的本体：从任意位置起后缀（首词不必登记；pattern 须连续出现在该位置） */
const hitOnlyA = (cmd: string) => {
  const t = tokenize(cmd);
  for (let i = 0; i + P.length <= t.length; i++) if (eq(t.slice(i, i + P.length), P)) return true;
  return false;
};
/** 候选 B 的本体：pattern 的词按序出现即可，中间允许插别的词；参数 = 词距上限 */
const hitOnlyB = (maxGap: number) => (cmd: string) => {
  const t = tokenize(cmd);
  let prev = -1;
  for (const w of P) {
    const k = t.indexOf(w, prev + 1);
    if (k < 0) return false;
    if (k - prev - 1 > maxGap) return false; // 词距上限：防「grep -e git -e push … --force」把参数当命令
    prev = k;
  }
  return true;
};
/** 候选 C：不看 pattern，只要首词不在已知表里就升 ask（「未知前缀词升 ask」的字面实现） */
const hitC = (cmd: string) => {
  const t = tokenize(cmd);
  return t.length > 1 && !EXEC_WRAPPERS.has(t[0]!) && !t[0]!.includes("=");
};

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(ROOT + "package.json", "utf8")).scripts as Record<string, string>;
const mockCmds: string[] = [];
for (const line of readFileSync(ROOT + "fixtures/mock/todo-fix.jsonl", "utf8").split("\n").filter(Boolean)) {
  let e: { type?: string; args?: { command?: unknown } };
  try { e = JSON.parse(line); } catch { continue; }
  if (e.type === "tool_call" && typeof e.args?.command === "string") mockCmds.push(e.args.command);
}
/** 「真命令语料」= 本仓自己天天在跑的 shell 行，不是我挑出来的 */
const REAL = [...new Set([...Object.values(pkg), ...mockCmds])];
const LEAK = UNBOUNDED_PREFIX_WORDS;
const FIXED = [...DENY_VARIANTS, ...GLOBAL_OPT_VARIANTS, ...PREFIX_WORD_VARIANTS];
const NEG = [...new Set([...GLOBAL_OPT_MUST_STAY_CLEAN, ...PREFIX_WORD_MUST_STAY_CLEAN, ...ALLOW_CASES.map(([c]) => c)])];

console.log(`真命令语料 = package.json scripts(${Object.keys(pkg).length}) + mock 剧本(${mockCmds.length})，去重 ${REAL.length} 支\n`);
const row = (name: string, hit: (c: string) => boolean) => {
  const over = REAL.filter(hit);
  const neg = NEG.filter(hit);
  console.log(
    `${name}｜缺口收回 ${LEAK.filter(hit).length}/${LEAK.length}｜已收口 ${FIXED.filter(hit).length}/${FIXED.length}` +
    `｜真语料牵连 ${over.length}/${REAL.length}${over.length ? " " + JSON.stringify(over.slice(0, 5)) : ""}` +
    `｜负控牵连 ${neg.length}/${NEG.length}${neg.length ? " " + JSON.stringify(neg) : ""}`,
  );
};
const hitA = (c: string) => hitToday(c) || hitOnlyA(c);
const hitB = (g = Number.MAX_SAFE_INTEGER) => (c: string) => hitToday(c) || hitOnlyB(g)(c);
row("今天（按名字白名单）        ", hitToday);
row("A = 今天 + 任意位置起后缀  ", hitA);
row("B = 今天 + 词按序(无界)    ", hitB());
row("B′ = 今天 + 词按序(词距≤2)", hitB(2));

/** 「不是替换是叠加」：单独换成 A 会倒退的那些（basename / 载荷递归 / 链式段都住在今天那一支里） */
const regress = FIXED.filter((c) => hitToday(c) && !hitOnlyA(c));
console.log(`\n⚠ 单独换成 A（丢掉今天的形态集）会倒退 ${regress.length} 支：${JSON.stringify(regress)}`);
console.log(`  ⇒ A/B 只能作**叠加**，不能作替换——basename 取基名、` + "`shell -c`" + ` 载荷递归、链式段拆分都在今天那一支里。`);

const upC = REAL.filter(hitC);
console.log(`\n候选 C 首词不在表即升 ask｜真语料 ${REAL.length} 支里 ${upC.length} 支出卡（${Math.round((upC.length / REAL.length) * 100)}%），例：${JSON.stringify(upC.slice(0, 4))}`);
console.log(`  这口径下 \`pnpm test\` 自己都要出卡——C 作为字面政策已死；可用的只有「A/B 命中 + 首词未知 ⇒ 升 ask 而非 deny」。`);

console.log("\n形似的非恶意六支（牵连面在这儿露出来）：");
for (const c of [
  "echo git push --force", "echo 'git push --force'", 'grep -rn "git push --force" src',
  "git commit -m 'git push --force 已禁用'", "printf git push --force",
  "grep -e git -e push src --force",
]) console.log(`  ${JSON.stringify(c).padEnd(44)} 今天=${hitToday(c)} A=${hitA(c)} B=${hitB()(c)} B′=${hitB(2)(c)} C=${hitC(c)}`);
console.log("\n真危险但今天漏的那类（词序对、中间插了东西）：");
for (const c of ["git push --no-verify --force", "git push origin --force", "git --no-pager push --force"]) {
  console.log(`  ${JSON.stringify(c).padEnd(44)} 今天=${hitToday(c)} A=${hitA(c)} B=${hitB()(c)} B′=${hitB(2)(c)}`);
}
console.log("\n注：真语料对 A/B 的「牵连 0」近乎空读——那 41 支里根本没有 pattern 字样，");
console.log("     它只量得出 C 的 ask 率。A/B 的牵连证据是上面两块（负控 1 支 + 形似六支）。");
