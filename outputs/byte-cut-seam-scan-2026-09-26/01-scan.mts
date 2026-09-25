// 一次性读数（不是门、不是判据）：#56 问的是「字节缝的静态判据还差哪些形状」。
// 已有的棘轮（`tests/utf8-text-safety.test.ts` 的 `scanUtf8Hazards`）只认两形：
//   ① `on("data")` 里把回调自己的 chunk 就地 `toString("utf8")` / `String(chunk)`；
//   ② `.slice(0, <标识符且名字以 BYTES 结尾>)`。
// 这一支把**候选面**摊开打印（无类型检查器 ⇒ 分不清接收者是 string 还是 Buffer ⇒ 由人逐条读），
// 用来回答"加宽判据值不值得"，而不是直接断言任何东西。跑法：
//   node --import tsx outputs/byte-cut-seam-scan-2026-09-26/01-scan.mts
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { trackedScriptFiles } from "../../scripts/lib/scan-scope.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const files = trackedScriptFiles(ROOT, "src") ?? [];
if (files.length === 0) {
  console.error("拿不到 src 清单 ⇒ 没有尺，不读成干净");
  process.exit(1);
}

type Hit = { shape: string; where: string; recv: string; arg: string };
const hits: Hit[] = [];
let missing = 0;

const argIsByteish = (text: string): boolean =>
  /BYTES$/u.test(text.trim()) || /1024/u.test(text) || /^\d{4,}$/u.test(text.trim());

for (const rel of files) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) { missing++; continue; }
  const text = readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const where = (n: ts.Node) => rel + ":" + String(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const recv = node.expression.expression.getText(sf).slice(0, 44);
      const arg = node.arguments[1]?.getText(sf) ?? node.arguments[0]?.getText(sf) ?? "";
      const head0 = node.arguments[0] !== undefined && node.arguments[0].getText(sf).trim() === "0";
      // B/C：`slice|substring|substr(0, X)`，X 看起来是字节帽（*BYTES / *1024 / 四位数以上）
      if ((name === "slice" || name === "substring" || name === "substr") && head0 && argIsByteish(arg)) {
        hits.push({ shape: name + "(0, 字节样帽)", where: where(node), recv, arg: arg.slice(0, 44) });
      }
      // D：Buffer 侧的 `subarray(0, X)` —— 切在字节上就是合法用法，但要看得见有几处、切的是不是模型文本
      if (name === "subarray" && argIsByteish(arg)) {
        hits.push({ shape: "subarray(字节帽)", where: where(node), recv, arg: arg.slice(0, 44) });
      }
      // E：`toString("utf8")` 的接收者不是 Buffer.from(...) 字面量时，切点由谁定？
      if (name === "toString" && /"utf8"|'utf8'/u.test(node.getText(sf))) {
        hits.push({ shape: 'toString("utf8")', where: where(node), recv, arg: "" });
      }
    }
    // F：定长正则切块
    if (ts.isRegularExpressionLiteral(node) && /\.\{1,\d+\}/u.test(node.getText(sf))) {
      hits.push({ shape: "正则定长切块", where: where(node), recv: node.getText(sf), arg: "" });
    }
    ts.forEachChild(node, visit);
  };
  sf.statements.forEach(visit);
}

const byShape = new Map<string, Hit[]>();
for (const h of hits) byShape.set(h.shape, [...(byShape.get(h.shape) ?? []), h]);
console.log("扫描面：src 已跟踪 " + String(files.length) + " 支（不在盘 " + String(missing) + " 支，属桌面层在飞删除）");
for (const [shape, list] of [...byShape.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log("\n## " + shape + " — " + String(list.length) + " 处");
  for (const h of list) console.log("   " + h.where + "  ⟨" + h.recv + "⟩  arg=" + h.arg);
}
