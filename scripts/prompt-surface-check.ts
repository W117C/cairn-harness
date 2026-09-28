/** `pnpm prompt-surface-check` —— 模型可见文本 ↔ 工具面 的可达性门（任务 #13）。
 *
 * fail-visible：逐条 ✅/❌ 打印实测读数；取料面为空直接红（真空通过是本仓最忌的假绿）。
 * 反向对照：`-- --self-test` 用两份合成文本证明这把尺**有分辨力**（dead 与 odd 各咬一处），
 * 而不是只证明它今天没红。
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { BASE_SYSTEM } from "../src/main/agent-runner";
import { TOOL_NAMES } from "../src/tools/base";
import { PERMISSION_MODES } from "../src/permissions/modes";
import { sessionToolSpecs } from "../src/agent/glm-session";
import {
  promptSurfaceCell,
  promptSurfaceFindings,
  toolNameTokens,
  unhitExemptions,
  type PromptSurfaceExempt,
} from "../src/agent/prompt-surface";

/** 存量豁免：逐条带理由，**只准调低**（新增一根就红）。清法是拆 per-mode 提示词（见任务 #16），不是把名单加长。
 *  理由的形状：这三把在 read-only 档确实拿不到，而那句文本是「若要写/若要派活该怎么做」的**说明**，
 *  不是「你现在可以调它」的承诺；权限层另有拒绝兜底。 */
export const PROMPT_SURFACE_EXEMPT: PromptSurfaceExempt = [
  { token: "edit_file", mode: "read-only", why: "纪律 3 是「怎么改文件」的条件说明；read-only 档拿不到该工具，由权限层拒绝兜底（拆 per-mode 文本见任务 #16）" },
  { token: "write_file", mode: "read-only", why: "同上：`write_file` 只用于新建文件那句是条件说明，read-only 不装配它" },
  { token: "wait_for_agents", mode: "read-only", why: "编排段整段对 read-only 档不适用（该档没有 spawn 面）；段首已写「派子代理时」这一前置条件" },
];

export function tablesByMode(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of PERMISSION_MODES) out[m] = sessionToolSpecs({ mode: m }).specs.map((s) => s.function.name);
  return out;
}

export function proseFaces(): { name: string; text: string }[] {
  return [{ name: "BASE_SYSTEM", text: String(BASE_SYSTEM) }];
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const selfTest = argv.includes("--self-test");
  const tables = tablesByMode();
  const faces = proseFaces();
  const counts = Object.entries(tables).map(([m, t]) => `${m}=${String(t.length)}`).join(" ");
  console.log(`[prompt-surface] 取料：文本面 ${String(faces.length)} 份（${faces.map((f) => f.name).join("、")}）｜工具面 ${counts}｜工具名单 ${String(TOOL_NAMES.length)} 个`);

  if (selfTest) return selfTestRun();

  const findings = promptSurfaceFindings(faces, tables, TOOL_NAMES, PROMPT_SURFACE_EXEMPT);
  const cell = promptSurfaceCell(findings);
  console.log(`  ${findings.length === 0 ? "✅" : "❌"} ${cell}`);
  for (const f of findings) {
    console.log(`  ❌ ${f.kind === "dead" ? "死引用" : "不可达承诺"}：${f.face} 里的 \`${f.token}\` 在 ${f.modes.join(",")} 档拿不到`);
  }
  // 豁免的账：先按**不豁免**跑一遍拿原始发现，再判每条豁免是不是真挡住了（同一份谓词，两处共用）。
  const raw = promptSurfaceFindings(faces, tables, TOOL_NAMES, []);
  const stale = unhitExemptions(PROMPT_SURFACE_EXEMPT, raw);
  console.log(`  ℹ️  存量豁免 ${String(PROMPT_SURFACE_EXEMPT.length)} 条，其中本次真命中 ${String(PROMPT_SURFACE_EXEMPT.length - stale.length)} 条（命中方清，只准调低）`);
  for (const e of stale) {
    console.log(`  ❌ 豁免过期：\`${e.token}@${e.mode}\` 已经不命中了 ⇒ 该条要从表里删掉（留着它就会放过同名的新问题）`);
  }
  // 反向读数：形状判据本身要有产出，否则「0 发现」可能只是尺坏了。
  const tokens = [...new Set(faces.flatMap((f) => toolNameTokens(f.text, TOOL_NAMES)))];
  console.log(`  ℹ️  文本里点到的工具名 ${String(tokens.length)} 个：${tokens.join(" ")}`);
  const newIssues = findings.length;
  console.log(newIssues === 0 && stale.length === 0 ? "[prompt-surface] 全部通过 ✅" : "[prompt-surface] 有要处理的格子 ❌");
  // 取料坏了也算红：一个工具名都没在文本里认出来 ⇒ 多半是面/名单没读到，而不是提示词突然不提工具了。
  if (tokens.length === 0) console.log("  ❌ 文本面一个工具名都没认出来 ⇒ 取料可疑，不许读成「没有承诺」");
  return newIssues === 0 && stale.length === 0 && tokens.length > 0 ? 0 : 1;
}

/** 合成料证明这把尺**能分辨**，不是只证明它今天没红（规则 222/226）。 */
function selfTestRun(): number {
  const tables = { auto: ["edit_file", "verify"], read: ["verify"] };
  const dead = promptSurfaceFindings([{ name: "t", text: "用 no_such_tool 去做" }], tables, TOOL_NAMES, []);
  const odd = promptSurfaceFindings([{ name: "t", text: "改文件用 edit_file" }], tables, TOOL_NAMES, []);
  // 负控的用料必须**都在合成面上**：上一版拿 `clarify` 当「都在面上」的例子，
  // 而它压根不在那两份合成表里 ⇒ 被判 dead，把负控自己变成了发现（尺没错，是我喂错了）。
  const clean = promptSurfaceFindings([{ name: "t", text: "先 verify 再把结论收在一句里" }], tables, TOOL_NAMES, []);
  const waived = promptSurfaceFindings([{ name: "t", text: "改文件用 edit_file" }], tables, TOOL_NAMES,
    [{ token: "edit_file", mode: "read", why: "test" }]);
  const lines = [
    [dead.some((f) => f.kind === "dead" && f.token === "no_such_tool"), "死引用那一档要能报出来"],
    [odd.some((f) => f.kind === "odd" && f.token === "edit_file" && f.modes.join() === "read"), "共用文本对缺席档要报不可达"],
    [clean.length === 0, "都在面上时不许造红（负控）"],
    [waived.length === 0, "豁免要真能消掉那一条"],
  ] as const;
  let bad = 0;
  for (const [ok, what] of lines) {
    if (!ok) bad += 1;
    console.log(`  ${ok ? "✅" : "❌"} 自检：${what}`);
  }
  let threw = false;
  try { promptSurfaceFindings([{ name: "t", text: "x" }], {}, TOOL_NAMES, []); } catch { threw = true; }
  console.log(`  ${threw ? "✅" : "❌"} 自检：工具面一格都没取到时要抛，不许印 0`);
  if (!threw) bad += 1;
  console.log(bad === 0 ? "[prompt-surface] --self-test 全造得红 ✅" : `[prompt-surface] --self-test 有 ${String(bad)} 条不红 ❌`);
  return bad === 0 ? 0 : 1;
}

// 入口判定：单测 import 本模块不得把门跑起来（同款写法见 scripts/no-progress-check.ts、model-surface-check.ts）。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(main());
}
