// 「注释里的函数头」那格的形状探针：行注释与块注释在 FN_HEAD 下**不是**同一种输入。
// 行注释里的 `function ghost() {` 前面是 `//`，而 FN_HEAD 要求 `^`／`\n` 后跟空白 ⇒ 原文也匹配不上
// （这条夹具因此对「索引建在涂白文本上」零分辨力——第 472 页落地时被变异门当场抓住的一格）。
// 块注释里另起一行的那条才会在原文里匹配上；涂白之后它才消失。
import { blankComments, extractLiterals } from "../../scripts/prose-needle-scan";

const FN_HEAD = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>)/g;
const headsOf = (text: string): string[] => [...text.matchAll(FN_HEAD)].map((m) => m[1] ?? m[2] ?? "(top)");
const cases: Record<string, string> = {
  "行注释": `const before = "A";\n// function ghost() {\nconst after = "B";`,
  "块注释（另起一行）": `const before = "A";\n/*\nfunction ghost() {\n*/\nconst after = "B";`,
  "块注释（同行开头）": `/* function ghost() { */\nconst after = "B";`,
};
for (const [label, text] of Object.entries(cases)) {
  console.log(
    label + "  原文命中=" + JSON.stringify(headsOf(text)) +
    "  涂白命中=" + JSON.stringify(headsOf(blankComments(text))) +
    "  chunks=" + JSON.stringify(extractLiterals("g.ts", text).map((c) => [c.fn, c.chunk])),
  );
}
