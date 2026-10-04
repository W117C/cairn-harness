import { readFileSync } from "node:fs";
import ts from "typescript";

// 三对候选针脚先在 skills.ts 的现读文本上过两道检查，形状照抄门里那一把尺
// （`scripts/mutate-verify.mjs` 的 `mutantSyntaxProblem`：transpileModule 只报语法诊断，不做类型检查）：
//   ① 旧串逐字命中，且**只命中一次**（命中 2 处时 replace 只改第一处 ⇒ 得人工复认）；
//   ② 改完仍是合法源（否则变异会红在装载阶段，不算分辨力证据）。
// 提前跑这一趟是因为 `scripts/mutate-verify.mjs` 正被隔壁的 M0→CAIRN 改名占着，落不了库，
// 等它让位时要一次贴得上，不能贴完才发现针脚本身是坏的。
const src = readFileSync("src/agent/plugins/skills.ts", "utf8");

const cases = [
  {
    id: "routing-truncation-marker-hides-count",
    old: 'if (dropped > 0) parts.push("另有 " + String(dropped) + " 条未列出");',
    neu: 'if (dropped > 0) parts.push("条目未全列出");',
  },
  {
    id: "routing-dropped-counts-listed-not-missing",
    old: "  const droppedCount = Math.max(0, total - listed);",
    neu: "  const droppedCount = listed;",
  },
  {
    id: "skill-routing-ignores-disable-model-invocation",
    old: "  const invocable = skills.filter(modelInvocable);",
    neu: "  const invocable = skills;",
  },
];

const syntaxProblem = (mutated: string): string | null => {
  const diags = ts.transpileModule(mutated, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, allowJs: true },
  }).diagnostics ?? [];
  const errs = diags.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length === 0) return null;
  return "语法错：" + ts.flattenDiagnosticMessageText(errs[0]?.messageText ?? "", " ");
};

for (const c of cases) {
  const hits = src.split(c.old).length - 1;
  const out = src.replace(c.old, c.neu);
  const changed = out !== src;
  const syntax = syntaxProblem(out);
  console.log(c.id + " 命中=" + String(hits) + " 产出变了=" + String(changed) + " 语法=" + (syntax ?? "ok"));
}
