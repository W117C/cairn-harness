// 判卷 · 编排器只有**一处构造点**，且两处调用者都吃同一份底座。
//
// 为什么静态判这条而不是写行为用例：本会话刚把崩溃恢复那条兜底构造修到可达（见 PROGRESS 能力 49），
// 一比对现场就发现它比 runAgent 少传 `rules` / `sandboxAvailable` / `semanticLease`——
// P0-2 当年补这三件时只改了 runAgent 那一处，注释原话就是「否则项目级 deny/ask 规则对 worker 全表失效」。
// 少了 `rules` 的那条 worker 要真跑起来才暴露，而它需要模型（花真钱），所以行为面钉不住这一格；
// **结构面**能钉：两处构造 = 迟早漂，一处构造 + 一份底座 = 漂不动。
// 走 AST 而不是按行数字符串（记忆规则 79：注释里出现的 `new Orchestrator(` 不算构造点）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "src/main/agent-runner.ts");

function countSites(sourceText: string): { news: number; factoryCalls: number } {
  const sf = ts.createSourceFile("agent-runner.ts", sourceText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  let news = 0;
  let factoryCalls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Orchestrator") news++;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "buildSessionOrchestrator") factoryCalls++;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { news, factoryCalls };
}

describe("编排器只有一个构造口，且现场与崩溃恢复两条路都走它", () => {
  const src = readFileSync(SRC, "utf8");
  const found = countSites(src);

  it("agent-runner 里 `new Orchestrator(` 恰好一处（多于一个 = 两份口径迟早漂）", () => {
    expect(found.news, "构造点数量 = " + String(found.news) + "；两处构造点必漂移（P0-2 就是只改了一处）").toBe(1);
  });

  it("唯一的构造口被两个调用者共用：runAgent 现场 + 崩溃恢复兜底", () => {
    expect(found.factoryCalls, "`buildSessionOrchestrator` 调用点 = " + String(found.factoryCalls) + "（应 2：现场 + 恢复）").toBe(2);
  });

  // 尺自己也要可证伪（规则 65）：临时在源里加第二处构造 ⇒ 上面第一条必须红。
  it("这条判据本身有分辨力：多一处构造就报数", () => {
    const withExtra = src + "\nfunction __probe(): void { void new Orchestrator({} as never); }\n";
    expect(countSites(withExtra).news, "加了第二处构造而判据没动 ⇒ 这条判据是恒真的").toBeGreaterThan(1);
  });
});
