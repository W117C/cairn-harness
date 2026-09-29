/* 第 170 页未证③ 的取料：那批「零命中指针」到底分几类，修法因此不同。
 *
 * v3（前两版的错都记在下面的类 C 说明里）：
 *   判据不猜意图，而是**定位指针文字落在哪个用例体内**：
 *   ① 指针逐字出现在某条标题里 ⇒ 本应可选（不该出现在这一格）；
 *   ② 指针逐字出现在文件里、但落在某条 `it()` 的**语句体内** ⇒ 类 A「指针写的是断言/期望文本而不是标题」：
 *      可修＝把它换成**那条**标题里一段整份文件唯一的静态文字；
 *   ③ 指针在文件里逐字取不到（只有靠占位符展开才认得）⇒ 类 B「标题是拼出来的」：静态验不了，要人裁决；
 *   ④ 三者都不是 ⇒ 类 C：探针作废，回头查门的读数。
 *
 * 自证（必须过，否则本文件的结论一律作废）：本探针点出的 id 名单要与门自己那一格
 * （`--check-needles` 的「选择子：… 零命中 N 条…」）**完全一致**——规则 236：探针自己算一遍不等于门的数。
 * 用法：node --import tsx outputs/mutation-selector-scan-2026-09-28/zero-hit-fix-plan.mts [树路径] */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TREE = process.argv[2] !== undefined ? join(ROOT, process.argv[2]) : join(ROOT, ".worktrees/p169-staging");

const listOut = execFileSync("node", ["--import", "tsx", "scripts/mutate-verify.mjs", "--list"], { cwd: TREE, encoding: "utf8" });
const rows = listOut.split("\n").filter((s) => s !== "").map((line) => {
  const c = line.split("\t");
  return { id: String(c[0]), test: String(c[3]), expectFail: JSON.parse(String(c[4])) as string };
});

const TITLE_RE = /^\s*(?:it|test)(?:\.\w+)?\s*\(\s*(["`'])((?:\\.|(?!\1)[^\\])*)\1/gmu;
const PLACEHOLDER = /(\$\{[\s\S]*?\}|\$[A-Za-z_]\w*|%[sdijfovc#])/gu;

/** 从 `it(` 的左括号起做花括号配平，拿到这条用例的语句范围（够定位「指针落在哪条用例体内」）。 */
const statementRange = (text: string, openParenIdx: number): [number, number] => {
  let depth = 0;
  for (let i = openParenIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return [openParenIdx, i];
    }
  }
  return [openParenIdx, text.length];
};

const fileCache = new Map<string, string | null>();
const textOf = (rel: string): string | null => {
  if (!fileCache.has(rel)) {
    try {
      fileCache.set(rel, readFileSync(join(TREE, rel), "utf8"));
    } catch {
      fileCache.set(rel, null);
    }
  }
  return fileCache.get(rel) ?? null;
};

const piecesOf = (title: string): string[] => title.split(PLACEHOLDER).map((s) => s.trim()).filter((s) => s.length >= 6);

const buckets: Record<string, string[]> = { A_指针写的是断言文字: [], B_标题是拼出来的: [], C_探针取不到: [], D_本应可选: [] };
const badIds: string[] = [];

for (const r of rows) {
  if (r.expectFail === "" || !r.test.endsWith(".test.ts")) continue;
  const text = textOf(r.test);
  if (text === null) continue;
  const titles = [...text.matchAll(TITLE_RE)];
  if (titles.length === 0) continue;
  const literalHits = titles.filter((m) => String(m[2]).includes(r.expectFail)).length;
  if (literalHits === 1) continue;
  badIds.push(r.id);

  const at = text.indexOf(r.expectFail);
  if (at === -1) {
    buckets.B_标题是拼出来的?.push(`- ${r.id}｜文件：${r.test}｜指针（逐字取不到，只有靠占位符展开才认得）：${r.expectFail}`);
    continue;
  }
  if (literalHits > 1) {
    buckets.D_本应可选?.push(`- ${r.id}｜指针逐字命中 ${String(literalHits)} 条标题（选择子不唯一）：${r.expectFail}`);
    continue;
  }
  // 指针落在文件里、却不在任何标题里 ⇒ 找它所属的那条用例
  const owners = titles
    .map((m) => ({ title: String(m[2]), range: statementRange(text, text.indexOf("(", m.index)) }))
    .filter((o) => o.range[0] <= at && at <= o.range[1]);
  const owner = owners[0];
  if (owner === undefined) {
    buckets.C_探针取不到?.push(`- ${r.id}｜指针在文件第 ${String(text.slice(0, at).split("\n").length)} 行，却不在任何 it() 体内：${r.expectFail}`);
    continue;
  }
  const cands = piecesOf(owner.title).filter((p) => titles.filter((t) => String(t[2]).includes(p)).length === 1);
  const best = cands.sort((a, b) => b.length - a.length)[0];
  buckets.A_指针写的是断言文字?.push(
    `- ${r.id}｜指针落在用例「${owner.title}」体内（第 ${String(text.slice(0, at).split("\n").length)} 行）` +
      (best === undefined ? "｜但该标题没有整份文件唯一的静态段 ⇒ 改不动，要人裁决" : `｜候选新指针：${best}`),
  );
}

const needleOut = execFileSync("node", ["--import", "tsx", "scripts/mutate-verify.mjs", "--check-needles"], { cwd: TREE, encoding: "utf8" });
const cellLine = needleOut.split("\n").find((l) => l.includes("选择子：")) ?? "";
const gateIds = [...cellLine.matchAll(/([a-z0-9][a-z0-9-]*)\((\d+)\)/gu)].map((m) => String(m[1])).sort();
const probeIds = [...badIds].sort();
const agree = gateIds.length === probeIds.length && gateIds.every((v, i) => v === probeIds[i]);

const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: TREE, encoding: "utf8" }).trim();
const doc = [
  "# 零命中指针的分类（09-28 v3；前两版的错也记在这里）",
  "",
  `取料树：${TREE.replace(ROOT, ".")} @ ${sha}；表长 ${String(rows.length)} 条；异常 ${String(badIds.length)} 条。`,
  `与门那一格对齐：**${agree ? "一致" : "不一致 ⇒ 本文件全部结论作废"}**（门点出 ${String(gateIds.length)} 条）。`,
  "",
  "v1 的错：候选取自「同文件里任意一条唯一标题」⇒ 把锚点配到**别的用例**上（守错格，规则 224）。",
  "v2 的错：用「标题静态段按顺序都出现在指针里」认意图 ⇒ 11 条全被判成「认不出意图」，因为它们的指针根本不是标题文字。",
  "v3 的判据：指针逐字落在哪条 `it()` 的**语句体内**，就认那条为意图；取不到逐字才归「标题是拼出来的」。",
  "",
  `⇒ 分类：**A 指针写的是断言文字（可机械改指）${String(buckets.A_指针写的是断言文字?.length ?? 0)} 条** ／ ` +
    `B 标题是拼出来的（要人裁决）${String(buckets.B_标题是拼出来的?.length ?? 0)} 条 ／ ` +
    `C 探针取不到 ${String(buckets.C_探针取不到?.length ?? 0)} 条 ／ D 多命中 ${String(buckets.D_本应可选?.length ?? 0)} 条`,
  "",
  ...Object.entries(buckets).filter(([, v]) => (v?.length ?? 0) > 0).flatMap(([k, v]) => [`## ${k}`, ...(v ?? []), ""]),
  "## 执行时配套的判据（缺一条就别自称改对了）",
  "1. 只改 `expectFail` 字符串，不动实现、不动判卷标题；候选段必须取自**指针所属那条用例**的标题。",
  "2. 改完跑 `--check-needles`：那一格「零命中 N 条」只准调低（水位，规则 235），并逐条单跑确认仍然**被杀死**（不是变成守别的用例）。",
  "3. 改指之后 selector 模式下 `-t` 吃的是新串，所以候选段必须与那条标题**逐字一致的一段**（规则 234：指针脆在标题的字面形状上）。",
  "4. 元锚点自己也在名单里（`loose-pointer-counts-literal`）⇒ 改它的指针要同笔跟着改它指到的引用（规则 235）。",
  "",
].join("\n");
writeFileSync(join(ROOT, "outputs/mutation-selector-scan-2026-09-28/zero-hit-plan-2026-09-28.md"), doc + "\n");
console.log(`异常 ${String(badIds.length)}｜A=${String(buckets.A_指针写的是断言文字?.length ?? 0)} B=${String(buckets.B_标题是拼出来的?.length ?? 0)} C=${String(buckets.C_探针取不到?.length ?? 0)} D=${String(buckets.D_本应可选?.length ?? 0)}｜与门一致=${String(agree)}`);
