// 一次性**量法**（不是尺）：模型可见文案里的「能力断言」有多少条从来没被判卷点过。
//
// 起因＝第 308 页那一格：`unionNote` 那句「本图只按名字连边、不认 import」从第 305 页起就是假话，
// 而同一句里真话那半（`并集`）被点过 11 次、假话那半 0 次 ⇒ 「这句文案有人判」这个印象是真的，
// 被绕开的正是"按分句配证人"。要判断这一格是孤例还是一张表，先得有个分母。
//
// 取料＝`typescript` 的 AST（措辞拍表必漏，见 `scripts/probe-promise-recall.ts` 头部那条同款教训）；
// 受众＝挂在 `console.*` 实参位上的字面量算给运维看的，不进这一格（同一条教训）。
// 证人＝`tests/**` 里有没有出现过该句里那段最长的连续中文（≥6 字）。
// 这条代理判据**故意宽松**：它只用来分"有人点过 / 没人点过"，不用来判对错——
// 所以命中数低不等于缺陷，命中数 0 才值得逐条把原句读一遍。
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

// 第一版关键词表里有「必须」「不能」，读出来 93 条里一大半是**抛错文案**（`x 必须是非空字符串`）——
// 那些话不是"harness 承诺自己做什么"，而是"调用者给错了"。这一格要的是**能力断言**，
// 所以只留「说 harness 自己会/不会/只能/已经做了 X」的那批措辞。
const CLAIM_MARKS = ["不认", "不支持", "不采", "不做", "不会", "只能", "已按", "永远不", "做不到", "不翻页", "不覆盖"] as const;

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + "/" + e.name;
    if (e.isDirectory()) {
      if (/node_modules|\.worktrees|dist|renderer|preload/.test(rel)) continue;
      walk(rel, acc);
    } else if (e.name.endsWith(".ts")) acc.push(rel);
  }
  return acc;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  // 带插值的模板串：取原文（含 `${…}`）做关键词探测——断言的措辞一定在字面片段里。
  if (ts.isTemplateExpression(node)) return node.getText().slice(1, -1);
  return null;
}

function inConsole(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  for (let i = 0; i < 6 && cur; i++, cur = cur.parent) {
    if (ts.isCallExpression(cur)) {
      const txt = cur.expression.getText().slice(0, 20);
      if (/^console\.[a-z]+$/u.test(txt)) return true;
      return false;
    }
  }
  return false;
}

const longestRun = (s: string): string => {
  const runs = s.match(/[一-鿿]{4,}/gu) ?? [];
  return runs.sort((a, b) => b.length - a.length)[0] ?? "";
};

const testCorpus = walk("tests").map((p) => readFileSync(resolve(ROOT, p), "utf8"));
const srcFiles = walk("src");

type Row = { file: string; line: number; mark: string; text: string; key: string; witnesses: number };
const rows: Row[] = [];
for (const rel of srcFiles) {
  const text = readFileSync(resolve(ROOT, rel), "utf8");
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    const body = literalText(node);
    if (body !== null && !inConsole(node)) {
      for (const mark of CLAIM_MARKS) {
        if (!body.includes(mark)) continue;
        const flat = body.replace(/\s+/g, " ").slice(0, 120);
        const key = longestRun(body);
        const witnesses = key.length >= 6 ? testCorpus.filter((t) => t.includes(key)).length : -1;
        rows.push({
          file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          mark, text: flat, key, witnesses,
        });
        break;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const scored = rows.sort((a, b) => a.witnesses - b.witnesses || a.file.localeCompare(b.file));
const zero = scored.filter((r) => r.witnesses === 0);
const nocode = scored.filter((r) => r.witnesses === -1);
console.log(`取料：src 文件 ${String(srcFiles.length)} 个｜tests 语料 ${String(testCorpus.length)} 份`);
console.log(`候选断言字面量=${String(scored.length)} 条｜其中"判卷 0 次"=${String(zero.length)} 条｜无可比对片段=${String(nocode.length)} 条`);
console.log(`\n== 判卷点过 0 次的那 ${String(zero.length)} 条（逐条要把原句读一遍才叫判定）==`);
for (const r of zero) console.log(`  ${r.file}:${String(r.line)} [${r.mark}] ${r.text}`);
console.log("\n== 对照：判卷点过的那几条里最密的 8 条 ==");
for (const r of scored.filter((x) => x.witnesses > 0).slice(-8)) console.log(`  w=${String(r.witnesses)} ${r.file}:${String(r.line)} ${r.key.slice(0, 24)}`);
