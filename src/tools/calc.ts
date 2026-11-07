// 确定性计算器（2026-11-06 业主「完善工具层」第三批）：算术是模型的已知弱点，
// 预算/测量/统计场景一枚确定性工具消灭算术幻觉。**零 eval、零子进程、零正则执行**——
// 手写字符扫描器 + 递归下降解析器，接受面显式枚举（数字/四则/幂/括号/一元负号/pi/e），
// 其余一律拒。非写向、不出网：全档放行（与 git_read 同档）。
import { ToolError, type Tool, type ToolResult } from "./base.js";

/** 表达式长度帽：防模型贴一整篇进来的浪费；计算面不需要长输入。 */
const CALC_MAX_CHARS = 1_000;

type Token = { kind: "num"; value: number } | { kind: "op"; value: string } | { kind: "const"; value: number };

/** 手写扫描器：逐字符走，认识的形状当场折算，不认识的当场点名（不吞进解析器再报含糊的「语法错误」）。
 *  导出只为判卷（承诺面证人直接钉函数本体；同 planDecisionFor/approvalDecisionFor 先例）。 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\n") { i += 1; continue; }
    if (ch >= "0" && ch <= "9") {
      let j = i + 1;
      let dots = 0;
      while (j < input.length && ((input[j]! >= "0" && input[j]! <= "9") || input[j] === ".")) {
        if (input[j] === ".") dots += 1;
        j += 1;
      }
      const text = input.slice(i, j);
      if (dots > 1) throw new ToolError(`calc: 「${text}」不是一个数（多的小数点）`);
      tokens.push({ kind: "num", value: Number(text) });
      i = j;
      continue;
    }
    if (ch === "*" && input[i + 1] === "*") { tokens.push({ kind: "op", value: "**" }); i += 2; continue; }
    if ("+-*/%()".includes(ch)) { tokens.push({ kind: "op", value: ch }); i += 1; continue; }
    if (ch === "p" && input.slice(i, i + 2) === "pi") { tokens.push({ kind: "const", value: Math.PI }); i += 2; continue; }
    if (ch === "e" && !(input[i + 1] !== undefined && /[a-z0-9_]/i.test(input[i + 1]!))) {
      tokens.push({ kind: "const", value: Math.E });
      i += 1;
      continue;
    }
    throw new ToolError(`calc: 不认识的字符「${ch}」（位置 ${String(i)}）——只支持数字与 + - * / % ** ( ) pi e`);
  }
  if (tokens.length === 0) throw new ToolError("calc: 表达式为空");
  return tokens;
}

/** 递归下降（precedence climbing）：expr → term → factor(幂,右结合) → unary → primary。 */
function parse(tokens: readonly Token[]): number {
  let pos = 0;
  const eat = (value: string): boolean => {
    const t = tokens[pos];
    if (t !== undefined && t.kind === "op" && t.value === value) { pos += 1; return true; }
    return false;
  };
  const parseExpr = (): number => {
    let left = parseTerm();
    for (;;) {
      if (eat("+")) left += parseTerm();
      else if (eat("-")) left -= parseTerm();
      else return left;
    }
  };
  const parseTerm = (): number => {
    let left = parseFactor();
    for (;;) {
      if (eat("*")) left *= parseFactor();
      else if (eat("/")) {
        const right = parseFactor();
        if (right === 0) throw new ToolError("calc: 除以零不给结果——这种边界要显式面对，不是给 Infinity 装没事");
        left /= right;
      } else if (eat("%")) {
        const right = parseFactor();
        if (right === 0) throw new ToolError("calc: 模零不给结果");
        left %= right;
      } else return left;
    }
  };
  const parseFactor = (): number => {
    const base = parseUnary();
    if (eat("**")) return Math.pow(base, parseFactor()); // 右结合
    return base;
  };
  const parseUnary = (): number => {
    if (eat("-")) return -parseUnary();
    if (eat("+")) return parseUnary();
    return parsePrimary();
  };
  const parsePrimary = (): number => {
    const t = tokens[pos];
    if (t === undefined) throw new ToolError("calc: 表达式在中途结束（缺右操作数或括号）");
    pos += 1;
    if (t.kind === "num" || t.kind === "const") return t.value;
    if (t.value === "(") {
      const v = parseExpr();
      if (!eat(")")) throw new ToolError("calc: 括号不闭合");
      return v;
    }
    throw new ToolError(`calc: 「${String(t.value)}」出现在不该出现的位置`);
  };
  const result = parseExpr();
  if (pos !== tokens.length) throw new ToolError("calc: 表达式末尾有多余内容（检查括号或运算符）");
  return result;
}

/** 结果格式化：JS 浮点伪影（0.30000000000000004）清到 12 位有效数字，整值不带小数点。 */
function format(n: number): string {
  if (!Number.isFinite(n)) throw new ToolError("calc: 结果不是有限数（溢出或非法输入）");
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(12)));
}

export const calc: Tool = {
  name: "calc",
  async run(args): Promise<ToolResult> {
    const expr = typeof args.expression === "string" ? args.expression.trim() : "";
    if (expr === "") throw new ToolError("calc: expression 参数必须是非空字符串");
    if (expr.length > CALC_MAX_CHARS) throw new ToolError(`calc: 表达式超过 ${String(CALC_MAX_CHARS)} 字符（拆成几步算）`);
    const value = parse(tokenize(expr));
    return { ok: true, output: `${expr} = ${format(value)}` };
  },
};
