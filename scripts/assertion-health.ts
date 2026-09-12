// 断言体检（从 gates.ts 抽出，便于单测——gates.ts 顶层有 `await main()`，直接 import 会跑起全套门禁）。
// 判据面：空断言 / 恒真式 / 暗卷段零断言 / **析取式弱断言（H-1，AST 级）** / 未证计数（H-2）。
import ts from "typescript";

/** 空断言：check/assert/ok 的第一或第二实参字面量 true。 */
const EMPTY_ASSERT = /(?:check|assert|ok)\s*\(\s*(?:[^()]*,\s*true\s*\)|true\s*,)/;
/** 恒真式：`X || true` / `X === null || true`。 */
const TAUTOLOGY = /\|\|\s*true\b/;
const HAS_ASSERTION = /(?:check|assert|ok)\s*\(/;

/** 断言函数名（与 HAS_ASSERTION / EMPTY_ASSERT 同一套口径）。 */
const ASSERT_NAMES: ReadonlySet<string> = new Set(["check", "assert", "ok", "assertEqual", "expectEqual"]);

/**
 * 显式豁免注释：`// gates:disjunction-ok <理由>`。
 * 必须给出理由——豁免本身是**可审计的**（体检清单会列出行号与原文），不接受无声放行。
 */
const DISJUNCTION_OK = /gates:disjunction-ok\s+\S/;

export interface ScanHit {
  file: string;
  line: number;
  kind: "empty-assert" | "tautology" | "dark-no-assert" | "disjunction";
  text: string;
}

/** 扫描一个脚本源码：空断言 / 恒真式 / 无断言段（纯函数，可单测）。 */
export function scanAssertionHealth(file: string, src: string): ScanHit[] {
  const hits: ScanHit[] = [];
  const lines = src.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, ""); // 去注释（行内块注释 + 行注释），避免注释/文档串里的示例误伤
    if (EMPTY_ASSERT.test(line)) hits.push({ file, line: i + 1, kind: "empty-assert", text: raw.trim() });
    else if (TAUTOLOGY.test(line)) hits.push({ file, line: i + 1, kind: "tautology", text: raw.trim() });
  });
  // 暗卷段零断言：以顶层 async function 为粒度，段内无 check/assert/ok 即报警
  const fnRe = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  const marks: { name: string; start: number; headerLine: number }[] = [];
  for (let m = fnRe.exec(src); m !== null; m = fnRe.exec(src)) {
    marks.push({ name: m[1]!, start: m.index, headerLine: src.slice(0, m.index).split("\n").length });
  }
  for (let k = 0; k < marks.length; k++) {
    const cur = marks[k]!;
    const end = k + 1 < marks.length ? marks[k + 1]!.start : src.length;
    const body = src.slice(cur.start, end);
    // 段头注释（函数声明前 3 行）或函数名含暗卷标记
    const headerFrom = Math.max(0, cur.headerLine - 4);
    const header = lines.slice(headerFrom, cur.headerLine).join("\n");
    if (!DARK_SEGMENT.test(cur.name) && !DARK_SEGMENT.test(header)) continue;
    if (!HAS_ASSERTION.test(body)) {
      hits.push({ file, line: cur.headerLine, kind: "dark-no-assert", text: "function " + cur.name + "（暗卷段内无 check/assert）" });
    }
  }
  return hits;
}

/**
 * H-1：析取式弱断言（AST 级，纯函数，可单测）。
 *
 * 为什么这算弱断言：断言条件里出现 `A || B`，只要任一项成立整条断言就成立。
 * 若其中一项是「前置条件不满足」（如 `!kf.has(4)`、`!process.env.M0_API_KEY`），
 * 那么条件不满足时这条断言**恒真、什么也没测**——比字面恒真式更隐蔽：
 * 旧的恒真式扫描（只认把 true 直接写在 `||` 右侧这种字面写法）对它们完全无感。
 *
 * 实测：scripts/ 下 738 条断言中 5 条含 `||`，2 条是合法析取（「被拦」有两种合理表现），
 * 3 条是条件逃逸——其中 `agents-check` 的 J7c 因禁入名单不含 shell_rw 而**永真**。
 */
export function scanDisjunctions(file: string, src: string): ScanHit[] {
  const hits: ScanHit[] = [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const lines = src.split("\n");
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ASSERT_NAMES.has(n.expression.text)) {
      const a0 = n.arguments[0];
      if (a0 !== undefined) {
        const ors: ts.BinaryExpression[] = [];
        const walk = (m: ts.Node): void => {
          if (ts.isBinaryExpression(m) && m.operatorToken.kind === ts.SyntaxKind.BarBarToken) ors.push(m);
          ts.forEachChild(m, walk);
        };
        walk(a0);
        if (ors.length > 0) {
          const line = sf.getLineAndCharacterOfPosition(a0.getStart(sf)).line + 1;
          // 豁免注释可写在断言所在行（行尾）或**其上 3 行内**——本仓习惯把理由写在断言上方。
          const window = lines.slice(Math.max(0, line - 4), line).join("\n");
          if (!DISJUNCTION_OK.test(window)) {
            hits.push({
              file,
              line,
              kind: "disjunction",
              text: "断言含 ||（任一析取项成立即通过）：" + a0.getText(sf).replace(/\s+/g, " "),
            });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

// 注意：下面这个「暗盒/暗卷段」识别正则**刻意放在文件末尾**——它的注释里含有段名关键字，
// 若放在函数声明上方，会被 scanAssertionHealth 的「段头注释命中段名」逻辑误报为
// 「该段内无断言」（自伤式误报）。
const DARK_SEGMENT = /(暗卷|暗盒|darkBox)/;

/** H-2：各门用 `UNVERIFIED=<n>` 标记行上报「未证」数（连网/凭据限制，未跑到的断言 ≠ 通过）。 */
const UNVERIFIED_MARK = /^UNVERIFIED=(\d+)$/m;

export function countUnverified(output: string): number {
  let n = 0;
  for (const m of output.matchAll(new RegExp(UNVERIFIED_MARK.source, "gm"))) n += Number(m[1] ?? 0);
  return n;
}
