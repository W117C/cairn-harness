// 一次性读数（不是判据、不进任何门）：#59 衍生那条「凡告诉模型少说了东西的文案，必须要么给下一步、要么明说取不到」
// 能不能挂在**措辞**上。跑法：node --import tsx outputs/half-sentence-net-2026-09-26/01-measure.mts
//
// 结论（2026-09-26，第 74 页）：**不能**——按措辞收料的分母里 96/103 是散文（`轮次上限低于 X`、
// `turn_truncated` 这种事件名、`worker 轮次上限` 这种规格说明），把它们当"半句话"要求补下一步，
// 等于让下一轮去改 96 处说明书。⇒ 这条判据只能挂在结构上（`byteCapNotice` 的 `nextStep` 实参），
// 那份窄读数住在 `scripts/probe-promise-recall.ts` 的 ⚪ 格，这里只留被否决的宽版本与其分母。
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { trackedScriptFiles } from "../../scripts/lib/scan-scope.js";
import { TOOL_NAMES } from "../../src/tools/base.js";
import { INJECTED_TOOLS } from "../../src/agent/tool-surface.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const files = trackedScriptFiles(ROOT, "src") ?? [];
if (files.length === 0) {
  console.error("拿不到 src 清单 ⇒ 没有尺，不读成干净");
  process.exit(1);
}

const MARKS = ["截断", "truncated", "未列出", "仅显示", "仅读取", "已丢弃", "dropped", "上限"];
const RESUME = /(offset|limit|再调一次|按这个相对路径|再跑一次|继续读|重新跑|收窄|再查|用 grep|read_file|grep|glob|lsp)/u;
const UNREACHABLE = /(读不到|取不到|不可得)/u;
const CALLABLE = [...TOOL_NAMES, ...INJECTED_TOOLS.map((t) => t.name)];

type Site = { where: string; text: string; hasNextHop: boolean; saysUnreachable: boolean };
const sites: Site[] = [];
let missing = 0;

function enclosingFn(node: ts.Node): string {
  let cur: ts.Node = node;
  for (;;) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isSourceFile(cur)) return "<module>";
    cur = cur.parent;
  }
}

for (const rel of files) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) { missing++; continue; }
  const text = readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const lit = (node as { text: string }).text;
      if (MARKS.some((m) => lit.includes(m))) {
        const flat = lit.replace(/\s+/g, " ").slice(0, 120);
        sites.push({
          where: rel + ":" + String(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1) +
            " [" + enclosingFn(node) + "]",
          text: flat,
          hasNextHop: RESUME.test(flat) || CALLABLE.some((n) => flat.includes(n)),
          saysUnreachable: UNREACHABLE.test(flat),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  sf.statements.forEach(visit);
}

const half = sites.filter((s) => !s.hasNextHop && !s.saysUnreachable);
console.log("扫描面：src 已跟踪 " + String(files.length) + " 支（不在盘 " + String(missing) + " 支）");
console.log("含「截断/上限/未列出…」的字符串字面量：" + String(sites.length) + " 处｜其中既没下一步也没说取不到：" +
  String(half.length) + " 处（" + Math.round((half.length / Math.max(1, sites.length)) * 100) + "%）");
console.log("\n⇒ 这就是否决宽版本的数：**分母的绝大多数是散文/事件名/规格说明**，不是交付给模型的截断提示。");
console.log("前 20 处（逐字读它们是不是'该给下一步'的那一类）：");
for (const h of half.slice(0, 20)) console.log("   " + h.where + "「" + h.text + "」");
