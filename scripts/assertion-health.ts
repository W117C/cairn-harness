// 断言体检（从 gates.ts 抽出，便于单测——gates.ts 顶层有 `await main()`，直接 import 会跑起全套门禁）。
// 判据面：空断言 / 恒真式 / 暗卷段零断言 / **析取式弱断言（H-1，AST 级）** / 未证计数（H-2）。
import ts from "typescript";

const HAS_ASSERTION = /(?:check|assert|ok)\s*\(/;

/** 断言函数名（与 HAS_ASSERTION / scanEmptyAsserts 同一套口径）。 */
const ASSERT_NAMES: ReadonlySet<string> = new Set(["check", "assert", "ok", "assertEqual", "expectEqual"]);

/** 恒真式（AST 级）：`X || true` / `true || X` —— 一支是字面量 true，整条条件恒成立。 */
function isOrWithLiteralTrue(b: ts.BinaryExpression): boolean {
  return b.operatorToken.kind === ts.SyntaxKind.BarBarToken
    && (b.left.kind === ts.SyntaxKind.TrueKeyword || b.right.kind === ts.SyntaxKind.TrueKeyword);
}

export function scanTautologies(file: string, src: string): ScanHit[] {
  const hits: ScanHit[] = [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const lines = src.split("\n");
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && isOrWithLiteralTrue(node)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      hits.push({ file, line, kind: "tautology", text: (lines[line - 1] ?? node.getText(sf)).trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/**
 * 空断言（AST 级，取代旧的字面正则 `EMPTY_ASSERT`）。条件位只有前两个实参：
 *  ① `args[0]` 是字面量 `true` ⇒ cond-first 签名（`check(true, "永远绿")`、`assert(true)`）；
 *  ② `args[1]` 是字面量 `true` ⇒ label-first 签名（`check("x", true)`，也含带 detail 的
 *     `check("x", true, "…")` —— 旧正则要求 true 出现在**尾部**，这一支本来就在网外）。
 *
 * 判据是**按位置**而不是按实参个数：本仓断言签名至少三套（cond-first、label-first、
 * 三参等值 `check(name, actual, expected)`），等值签名里第三位是**期望值**、第二位是 actual。
 * 旧正则"最后一个实参是不是 true"把等值那一族整批判成空断言（实测 `scripts/sidebar-probe.ts`
 * 三条里中两条、漏一条——漏的那条只因参数里带括号才侥幸），同时又会放过 label-first 带 detail 的真空断言。
 *
 * 两支都从"按行正则"改成 AST 的另一半原因：**注释里的示例会被当成代码**。旧写法只 strip
 * 行内块注释与行注释，块注释的续行（` * …`）不在它眼里 ⇒ 在本文件的文档注释里举一个
 * `check("x", true)` 的例子，就能把整张门表判红（写这段时当场踩到，实测 3 条自命中）。
 * "体检命中"是判红的，判据越界与漏判一样贵——它教人来忽略红的含义。
 */
export function scanEmptyAsserts(file: string, src: string): ScanHit[] {
  const hits: ScanHit[] = [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const lines = src.split("\n");
  const isTrueLit = (n: ts.Node): boolean => n.kind === ts.SyntaxKind.TrueKeyword;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      const args = node.arguments;
      if (ASSERT_NAMES.has(name)) {
        const hollow = (args.length > 0 && isTrueLit(args[0]!))
          || (args.length >= 2 && isTrueLit(args[1]!));
        if (hollow) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          hits.push({ file, line, kind: "empty-assert", text: (lines[line - 1] ?? node.getText(sf)).trim() });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

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
  const hits: ScanHit[] = [...scanEmptyAsserts(file, src), ...scanTautologies(file, src)];
  const lines = src.split("\n");
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
      // H3（审查 P1-17）：条件实参不再固定取 arguments[0]——本仓至少两套断言签名
      //（cond-first 与 label-first `check(label, cond, ...)`），只扫第一实参会让 label-first
      // 门（tools-check/prune-check/map-check）里的析取弱断言全部落在网外。改为扫描前两个实参
      //（标签是字符串字面量不含二元表达式）。
      for (const a of n.arguments.slice(0, 2)) {
        const ors: ts.BinaryExpression[] = [];
        const walk = (m: ts.Node): void => {
          // 闭包/内嵌函数体内的 || 是业务逻辑不是断言条件——不下潜（全量下潜会把
          // check(label, async () => {...}) 里的实现代码误报为弱断言，实测 3 条假阳）。
          if (ts.isFunctionExpression(m) || ts.isArrowFunction(m) || ts.isFunctionDeclaration(m)) return;
          if (ts.isBinaryExpression(m) && m.operatorToken.kind === ts.SyntaxKind.BarBarToken) ors.push(m);
          ts.forEachChild(m, walk);
        };
        walk(a);
        if (ors.length > 0) {
          const line = sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1;
          // 豁免注释可写在断言所在行（行尾）或**其上 3 行内**——本仓习惯把理由写在断言上方。
          const window = lines.slice(Math.max(0, line - 4), line).join("\n");
          if (!DISJUNCTION_OK.test(window)) {
            hits.push({
              file,
              line,
              kind: "disjunction",
              text: "断言含 ||（任一析取项成立即通过）：" + a.getText(sf).replace(/\s+/g, " "),
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

/**
 * 切片判卷的「边界标记」：字符串字面量以注释标点开头的取值/切片调用。
 *
 * 为什么要闸：这类测试读 `src/renderer/app.js` 的**源码文本**，用 `indexOf(标记)` 切一段进 vm 跑。
 * 标记若是一句注释，则"改一句注释"等于"改判卷的取料面"——实测代价：本仓一次删注释改动
 * 让 3 个文件 18 条测试红（`expected -1 to be greater than 43470`），而那 18 条与产品行为一字无关。
 * 更坏的一格是**静默**的：标记还在但位置挪了 ⇒ 切片悄悄变小，测得更少而门仍绿。
 * 规矩：边界一律用代码标识（`function xxx`、`const NAME =`）。
 *
 * 只认「喂给切片调用」的那些字面量：tests/ 里以注释标点开头的字面量共 64 条，其中 17 条是
 * 喂给被测码的 fixture 文本（docs-check 举的病样、prune 的 `// `、edit-file-hint 的规则片段），
 * 那是正当用途，不该报——按 callee 名筛掉它们，而不是靠豁免名单放行。
 */
const SLICE_CALLEES: ReadonlySet<string> = new Set([
  "indexOf", "lastIndexOf", "slice", "substring", "substr", "search", "section",
]);
const COMMENT_OPEN = /^\s*(?:\/\/|\/\*)/;

export interface BoundaryHit {
  file: string;
  line: number;
  /** 切片调用读到的那句标记原文（棘轮清单按它记账，不按文件——文件级豁免会让同一个文件再加一条）。 */
  marker: string;
}

export function scanCommentBoundaries(file: string, src: string): BoundaryHit[] {
  const hits: BoundaryHit[] = [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (SLICE_CALLEES.has(name)) {
        for (const a of n.arguments) {
          if ((ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && COMMENT_OPEN.test(a.text)) {
            hits.push({
              file,
              line: sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1,
              marker: a.text,
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

/**
 * 绿而零输出的门：跑完了，但我们一个字都没看见。
 *
 * "它检查了、什么都没发现" 与 "它根本没检查" 在这道门的对外表现上同形——退出码都是 0。
 * 本仓对"未证 ≠ 通过"已经立了规矩（`UNVERIFIED=<n>` 那条链），沉默是同一族里更宽的一格，
 * 所以按未证计（`DSH_STRICT_UNVERIFIED=1` 下直接判红），不新造一档。
 *
 * 不建豁免名单：登记表会让未登记的那一个静默漏在机制外。外部工具本就"干净即沉默"的（tsc），
 * 由那道门自己补一行结论 —— 汇总每次跑都点名，所以漏网的是响的，不是暗的。
 */
export function silentGreenGate(code: number, output: string): boolean {
  return code === 0 && output.trim() === "";
}

/**
 * 一道门的未证总数 = 自己上报的（`UNVERIFIED=<n>`）+ 绿而零输出补的一格。
 *
 * 刻意做成一个函数而不是在调用方两处相加：汇总行与耗时账本（`pnpm facts` 读的 `unverified`）
 * 必须同口径。分两处算过一次，账本里那一格漏掉静默项，`pnpm facts` 于是显示"零未证"，
 * 而屏幕上写着未证 1——本仓管这叫两条记账面（真钱面与审计面各说各话）。
 */
export function gateUnverified(code: number, output: string): number {
  return countUnverified(output) + (silentGreenGate(code, output) ? 1 : 0);
}
