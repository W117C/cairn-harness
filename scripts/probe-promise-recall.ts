// 探针（**不是门**，不在 gate-manifest 里）：每一处「把模型指去别处取回原文」的承诺，
// 必须有一次"照那句话真做一遍"的可达性判定；没有判定的新面 ⇒ 红。
//
// 为什么会有这一支：任务 #33（`scripts/probe-prune-recall.ts`）证到底的那条缺陷不是 prune 独有的，
// 而是一整族的**形状**——harness 在被剪/被截/被帽的那一处对模型说「全文见 X」，
// 而 X 是不是模型真够得着的东西，**从来没被判过**。第一次手扫（第 52/53 页）就是按措辞拍的表，
// 而拍出来的表必然漏：本探针换成 AST 收料后，8 处面里有 3 处是手抄清单上根本没有的
// （`orchestrator-join` 的"再 wait 一次"、`agent-runner` 的"原文可从附件目录回取"、`context` 的"全文见事件流"）。
// ⇒ **挂现状不挂手抄表**（同族：规则 64/122）：新加一句承诺字面量会自动进清单，逼着加它的人给判定。
//
// 三态规矩（与 `replay:prune-promise` 同一条）：
//   ① 面在、最后一跳做得到 ⇒ 绿
//   ② 面在、做不到 ⇒ 红（活缺陷：模型照做就是白跑一轮）
//   ③ 面在、没人给过判定 ⇒ 红（**本探针的存在理由**：没判过的承诺等于没扫过）
// 另有"清单为空 = 没有尺"：AST 一个面都没扫到 ⇒ 红着退出，不读成干净。
//
// 受众也走结构判定而不是措辞：字面量若挂在 `console.*` 的实参位上，它是给运维看的，
// 不进"最后一跳"义务（判据宽到把散文当承诺，第 53 页教训 2 已经踩过一次）。
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { trackedExistingFiles } from "./lib/scan-scope.js";
import { testCaseBody, vitestTitlePatterns, vitestTitles } from "./lib/mutate-gates.js";
import { discoverPlugins } from "../src/agent/plugins/discover.js";
import { expandSkillInvocation, skillInvokeName } from "../src/agent/plugins/skills.js";
import { computePrune } from "../src/agent/prune.js";
import { createObservationLedger } from "../src/agent/ledger.js";
import { SolpiRuntime } from "../src/agent/solpi-runtime.js";
import { createObservationRecallTool } from "../src/tools/observation-capture.js";
import { renderJoinPayload, shapeJoinRows } from "../src/agent/orchestrator-join.js";
import { INJECTED_TOOLS } from "../src/agent/tool-surface.js";
import { read_file } from "../src/tools/read_file.js";
import type { AgentEvent } from "../src/events/index.js";
import type { ToolContext } from "../src/tools/base.js";
import { TOOL_NAMES } from "../src/tools/base.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * 承诺标记：**把读者指去别处取全文**的措辞（"见 §7.4" 这种给人看的章节引用不算）。
 * 清单只当候选生成器，判定逐字读那句——所以下面把整句原文都打出来。
 */
export const PROMISE_MARKS: readonly string[] = [
  "全文见",
  "原文已存",
  "取回",
  "回取",
  "见事件流",
  // #58：这两条是**换写法绕过**的实证——`ledger`/`solpi` 两格用英文与另一种中文写"可回取"，
  // 上面五种中文措辞一个字都不含 ⇒ 整族漏收（规则 122：机制判据挂在一种写法上＝换写法即绕过）。
  // ` available` 带前导空格，是为了不把 `archive unavailable` 这种反向陈述收进来。
  " available",
  "取全文",
];

/** 一把措辞网收出来的一个面（两把网共用这个形状：承诺网与能力断言网只差标记表）。 */
export interface MarkedSite {
  /** 相对仓库根。 */
  file: string;
  /** 所在函数名（顶层 = "<module>"）——判定按它挂，行号会漂而函数名不漂（规则 79）。 */
  fn: string;
  mark: string;
  /** 那句原文（压掉空白，截 160 字供逐字读）。 */
  text: string;
  line: number;
  /**
   * 受众三态，全部由**结构**判而不是措辞判：
   * - `model`：在模型可见根内，且不挂在终端写入（`console.*`／`process.stdout|stderr.write`）的实参链上
   *   ⇒ 欠一次"照那句做一遍"（或"那句话有证人"）；
   * - `operator`：字面量往上整条 parent 链里遇到终端写入调用 ⇒ 给运维/使用者看；
   * - `ui`：落在 `UI_ROOTS` 里 ⇒ 给人看（HEAD-only 验跑会扫到桌面层，见那条注释）。
   * 后两态仍进清单（不许静默消失），只是不判可达性。
   */
  audience: "model" | "operator" | "ui";
}

/** 历史名字：承诺网收出来的面。 */
export type PromiseSite = MarkedSite;

/**
 * 「给人看」的那两面：AGENTS.md 的 scope 段点名为桌面层（本仓 core-only 迁 removing 的就是它们），
 * HEAD-only 验跑时它们仍在盘上（实测 `src/renderer/app.js:1091` 那句「全文见安全报告卡」是 UI 文案）。
 * 判据若不排它会红在一句给人看的话上＝断言越界（规则 60）；但**不删读料**，仍列成 ⚪ 态。
 */
export const UI_ROOTS: readonly string[] = ["src/renderer/", "src/preload/"];

function enclosingFnName(node: ts.Node): string {
  let cur: ts.Node = node;
  for (;;) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isSourceFile(cur)) return "<module>";
    cur = cur.parent;
  }
}

/** 结构判据：这个调用是不是「把字交给终端」。
 *  两类 claim（回取承诺／能力断言）共用这**一个**决策点——从前这里只认 `console.*`，
 *  而本仓 CLI 清一色走 `process.stdout/stderr.write`（`src/cli.ts` 实测 55 处），
 *  于是 usage／审批提示这些**只会打在终端上**的句子被算成模型可见面，欠了一次根本不该欠的判定。 */
const TERMINAL_SINKS: readonly string[] = ["console", "process.stdout.write", "process.stderr.write"];

function isTerminalSinkCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const e = node.expression;
  if (!ts.isPropertyAccessExpression(e)) return false;
  const dotted = e.getText().replace(/\s+/gu, "");
  if (TERMINAL_SINKS.includes(dotted)) return true;
  // `console.log` / `console.warn`：前缀是 `console` 的任意方法都算。
  return dotted.startsWith("console.");
}

/** 受众：先判落位（UI 根＝给人看），再从字面量往上走**整条 parent 链**——
 *  只要途中遇到一个终端写入调用就认成 operator。
 *  为什么不能只看最近的那个 CallExpression：`process.stdout.write(paint(YELLOW, "…"))` 里
 *  最近的一层是 `paint(…)`，浅走一步就把终端文案判成模型可见（第 311 页现读：`src/cli.ts` 有 55 处这种写法）。 */
function audienceOf(node: ts.Node, relFile: string): "model" | "operator" | "ui" {
  if (UI_ROOTS.some((root) => relFile.startsWith(root))) return "ui";
  let cur: ts.Node = node;
  for (;;) {
    if (isTerminalSinkCall(cur)) return "operator";
    if (ts.isSourceFile(cur)) return "model";
    cur = cur.parent;
  }
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return (node as { text: string }).text;
  }
  return null;
}

/** AST 扫描（纯函数：判卷可直接喂突变源，不必碰盘）。同一处语句的多支字面量各记一条。 */
/** 弱标记：英文的 "available" 单独不成承诺——`[context_budget_exceeded] … available 4321; request not sent`
 *  就是一句容量说明。只有同一句里**点了一个可调用的工具名**，它才构成"照这句做就能取回"。
 *  工具名一律取事实源（TOOL_NAMES + INJECTED_TOOLS），不在此抄清单（规则 64/122）。 */
const WEAK_MARKS: readonly string[] = [" available"];
const CALLABLE_NAMES: readonly string[] = [...TOOL_NAMES, ...INJECTED_TOOLS.map((t) => t.name)];

/** 两把 claim 网共用的 AST 收料：同一棵树、同一个受众判定（规则 100：取料各抄一遍迟早漂）。
 *  `weak` 是承诺网那条「弱标记要点一个可调用的名字才算数」的规矩，能力断言网不需要，交 null 即跳过。
 *  `wholeTemplates` 只给能力断言那一把：它要拿**整句**挑证人针脚，按片段收会把句子切碎（假红）。
 *  整句收下后必须压掉它自己的组成片段——第一版我没压，同一句既按整句进清单、又按 head/tail 片段各进一次
 *  ⇒ 承诺网（根本没用这个开关）的分母从 10 处涨到 13 处。共用 walker 时这种虚高会串到对面去。 */
function scanMarkedSites(
  files: readonly { path: string; text: string }[],
  marks: readonly string[],
  weak: ((text: string, mark: string) => boolean) | null,
  wholeTemplates: boolean,
): MarkedSite[] {
  const out: MarkedSite[] = [];
  // 「模板结构」：整句收下后这些节点自带的字面量就是那句的碎片，不再单列。
  const isTemplatePart = (n: ts.Node): boolean =>
    ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) ||
    ts.isTemplateSpan(n) || ts.isNoSubstitutionTemplateLiteral(n);
  for (const f of files) {
    const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const walk = (node: ts.Node, suppress: boolean): void => {
      const whole = wholeTemplates && ts.isTemplateExpression(node);
      const text = whole ? node.getText().slice(1, -1) : suppress ? null : literalText(node);
      let matched = false;
      if (text !== null) {
        for (const mark of marks) {
          if (!text.includes(mark)) continue;
          if (weak && !weak(text, mark)) continue;
          out.push({
            file: f.path,
            fn: enclosingFnName(node),
            mark,
            text: text.replace(/\s+/g, " ").slice(0, 160),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            audience: audienceOf(node, f.path),
          });
          matched = true;
          break;
        }
      }
      // 抑制只沿模板结构往下传；一走进普通表达式就恢复收料——
      // 否则 `${cond ? "全文见事件流" : "另起一句"}` 里那支独立的句子会被无声吞掉。
      ts.forEachChild(node, (c) => walk(c, (matched || suppress) && isTemplatePart(c)));
    };
    walk(sf, false);
  }
  return out;
}

export function scanPromiseSites(files: readonly { path: string; text: string }[]): PromiseSite[] {
  return scanMarkedSites(files, PROMISE_MARKS, (text, mark) =>
    !(WEAK_MARKS.includes(mark) && !CALLABLE_NAMES.some((n) => text.includes(n))), false);
}

/* ---------------- 第二个 claim 类：模型可见的「能力断言」有没有证人（第 311 页） ----------------
 *
 * 起因是第 308 页那一格：`unionNote` 那句「本图只按名字连边、不认 import」从第 305 页起就是假话，
 * 而**同一句里真话那半**（`并集`）被点过 11 次、假话那半 0 次 ⇒ 「这句文案有人判」这个印象是真的，
 * 被绕开的正是"按分句配证人"。要判断那是孤例还是一张表，先得有分母（量法见
 * `outputs/model-claim-face-2026-10-03/claim-measure.mts`，那一支是一次性的，本面才是尺）。
 *
 * 与承诺网的分工：承诺网问的是「那句话给的**路**走不走得通」（可达性，要 exec）；
 * 本面问的是「那句**能力边界**有没有用例点过」（证人，静态即可判）。两把网共用同一套取料与受众判定。 */
export const CLAIM_MARKS: readonly string[] = [
  "不认", "不支持", "不采", "不做", "不会", "只能", "已按", "永远不", "做不到", "不翻页", "不覆盖",
];

/** 欠证人的能力断言＝**存量帽**（只准调低）。
 *  现读 11 条（第 320 页又补三格原句证人之后）。帽只往下走过七档，每一档都留了取料面：
 *    29 第 311 页开张现读 → `outputs/terminal-audience-2026-10-03/measure-claims.log`
 *    28 第 312 页补 LESSONS 那句的证人 → `outputs/lesson-empty-evidence-2026-10-03/claims-recheck.log`
 *    25 第 313 页补换路提示两支文案 + no-progress 那句 → `outputs/repeat-nudge-honesty-2026-10-03/claims-recheck.log`
 *    23 第 314 页开绑定通道，sidechat 那两句按执行端符号配对 → `outputs/claim-binding-2026-10-03/measure.log`
 *    18 第 317 页绑定通道加"点名用例＋符号区分度"，四格按新通道配对、一格补了原句证人 →
 *       `outputs/claim-binding-tighten-2026-10-03/claims-after.log`
 *    14 第 319 页四格各配一支真探针（web-search 那次出网没发生／autonomy 的整句理由／
 *       capWayOut 到顶那一支／resolveMaxFiles 的拒绝句）→ `outputs/claims-4faces-2026-10-03/claims.log`
 *    11 第 320 页再补三格（worker 档位裁剪的两支臂／supervise 的拒因／provider 缺凭据那条闸的「空白串不算已配置」）
 *       → `outputs/claims-4faces-2026-10-03/claims-320.log`
 *  最新一档的五个数：面 45、模型可见 43、原句证人 21、绑定 6、挑不出段 5（四态相加＝分母）。
 *  计数类不留余量；补了证人不跟着把帽调下来同样要红。
 *  注意这一格的取料含 `tests/**` 全文——**判卷自己抄的那句生产原文也会当证人**，
 *  所以本文件的夹具一律用「探针假句……」这种对不上任何生产文案的串（第 311 页实测：照抄原句会让分母从 29 掉到 26）。
 *  这句话的另一半在第 319 页用上了：真判卷**就是要**抄那句原文（那才叫原句证人），
 *  但抄之前要先证明这一格有行为观测者（请求计数／两支臂各钉一次），否则只是给文案换了个地方躺着。 */
export const CLAIM_UNWITNESSED_CAP = 11;

/** 证人候选段：句里**所有**够长的连续中文（先把 `${…}` 插值挖掉，再按非中文断开），门槛 6 字。
 *  为什么交"每一段"而不是"最长那一段"：一句能力断言往往分好几层，判卷通常只点其中一层
 *  （第 308 页那条就是——`并集` 那半被点 11 次、`不认 import` 那半 0 次）。
 *  只拿最长那段去比，会把"有人点过别的分句"读成"整句没人判"＝把真证人做成假红。
 *  本面因此只声称一件更弱的事：**一段都不曾被点过**才算欠证人。6 字门槛是"碎片顶不了证人"
 *  （`不会`／`只能这样`这种短词在任何测试里都会撞上，等于没有判据）。 */
export function claimWitnessRuns(text: string, min = 6): string[] {
  const stripped = text.replace(/\$\{[^}]*\}/gu, "◆");
  return [...new Set(stripped.split(/[^一-龥]+/u).filter((r) => r.length >= min))];
}

export interface ClaimSite extends MarkedSite {
  /** 可当证人的候选段；空数组＝这句里挑不出可判的连续中文 ⇒ **不可知**，单列，不许混进"有人判过"。 */
  runs: string[];
  /** 展示用的那一段（候选里最长者；`runs` 为空时是空串）。 */
  needle: string;
}

export function scanClaimSites(files: readonly { path: string; text: string }[]): ClaimSite[] {
  return scanMarkedSites(files, CLAIM_MARKS, null, true).map((s) => {
    const runs = claimWitnessRuns(s.text);
    return { ...s, runs, needle: runs.reduce((best, r) => (r.length > best.length ? r : best), "") };
  });
}

/** 证人核对：判卷把 `tests/**` 的正文交进来（取料在调用方，本函数不碰盘）。
 *  单位是**面**（`file#fn｜最长段` 去重），三态各自出声且**相加＝分母**（守恒律）：
 *    witnessed   至少一段被点过；
 *    unwitnessed 有候选段而 tests 里**一段都没出现** ⇒ 这一格欠证人；
 *    noNeedle    句子里挑不出可判的连续中文 ⇒ **不可知**（多半是被 `${…}` 插值切碎的短句），
 *                单独出声，不算有人判过，也不许被并进前两个态。 */
export interface ClaimWitnessFindings {
  modelSites: number;
  witnessed: string[];
  unwitnessed: string[];
  noNeedle: string[];
  byAudience: { model: number; operator: number; ui: number };
}

export function claimWitnessFindings(
  sites: readonly ClaimSite[],
  testCorpus: readonly string[],
): ClaimWitnessFindings {
  const faceRuns = new Map<string, string[]>();
  for (const s of sites) {
    if (s.audience !== "model") continue;
    const k = `${s.file}#${s.fn}｜${s.needle}`;
    // 同一个面上多段并存：取并集，别让后到的覆盖先到的。
    faceRuns.set(k, [...new Set([...(faceRuns.get(k) ?? []), ...s.runs])]);
  }
  const witnessed: string[] = [];
  const unwitnessed: string[] = [];
  const noNeedle: string[] = [];
  for (const [k, runs] of faceRuns) {
    if (runs.length === 0) { noNeedle.push(k); continue; }
    if (runs.some((r) => testCorpus.some((t) => t.includes(r)))) witnessed.push(k);
    else unwitnessed.push(k);
  }
  const count = (a: "model" | "operator" | "ui"): number => sites.filter((s) => s.audience === a).length;
  return {
    modelSites: faceRuns.size,
    witnessed,
    unwitnessed,
    noNeedle,
    byAudience: { model: count("model"), operator: count("operator"), ui: count("ui") },
  };
}

/* ---------------- 绑定通道：证人用了另一套词时，靠**执行端符号**配对（第 314 页） ----------------
 *
 * 起因是第 313 页复核 `src/agent/sidechat.ts#SIDECHAT_SYSTEM` 那两句：执行端有符号
 * （`SIDECHAT_FORBIDDEN_TOOLS` 是那份 allow-list 的补集、`promoteToMain` 是旁路进主流的唯一入口），
 * 判卷也真在用它——可证人写的是「三个写向工具不在 sidechat 工具表里」，与作者那串中文一个字都不重合
 * ⇒ 上面那张网只能报「欠证人」。这张表就是把"这句话背后那个开关"变成可机器核的配对。
 *
 * 它**不许**用「把原句抄进测试」来降数：那只会骗过匹配、什么都不证明。这里成立的条件是四件事同时为真
 *   ① 那一格还在现读的欠证人清单里（那句话改名/被删 ⇒ 绑定是白登记，出声）；
 *   ② `symbol` 真出现在那句话所在的那个源文件里（句子背后确有这么个开关，不是凭印象）；
 *   ③ `testCase` 是 `testFile` 里**一条用例的标题**（取 body 用的是 `mutate-gates` 那份共用抽取，不另抄口径）；
 *   ④ 那条用例的**体内**引用了 `symbol`（它确实在按这个开关判，不是同文件里另一条顺手提到）。
 * 缺任何一件 ⇒ 这一格**仍算欠证人**，且这条绑定自己上报原因。`why` 给人复核，尺不判它。
 *
 * ③④ 是第 317 页补上去的。原来只有"文件级"那两件（符号在这个判卷文件里出现过），而**面的符号名越通用就越空**：
 * `src/tools/write_file.ts#run`、`src/agent/glm-session.ts#specs` 这种格，任何一条调过工具入口的判卷都能满足它 ⇒
 * 那张表成了"随便填个两边都存在的词就能降帽"的空头支票。指到用例那一层，登记就必须说得出"哪一条判它"。
 * ⑤ 同页补：光指到用例还不够——`run` 在 295 份判卷里有 130 份提到它，符号本身没有区分度时，
 * ③④ 只是把蒙混的成本降低，没有取消 ⇒ 用一个"提到它的判卷文件数"帽把这类符号直接拒掉（见 `BINDING_SYMBOL_MAX_JUDGE_FILES`）。 */
export interface ClaimBinding {
  /** 面的单位与 `claimWitnessFindings` 一致：`file#fn｜needle`。 */
  face: string;
  symbol: string;
  testFile: string;
  /** 那份判卷里**具体一条用例的标题**（与 `mutate-verify` 的 `expectFail` 同形，允许带占位符的标题）。 */
  testCase: string;
  why: string;
}

export interface BindingMaterial {
  /** 源文件路径 → 正文（只有 face 所属那一支会被查）。 */
  src: ReadonlyMap<string, string>;
  /** 判卷文件路径 → 正文。真仓那一趟交的是**全部** `trackedExistingFiles(ROOT,"tests")` ⇒ 符号区分度这一格有分母。 */
  tests: ReadonlyMap<string, string>;
}

/** 符号的**区分度帽**：提到这个符号的判卷文件数超过它 ⇒ 这条绑定拒收。
 *  为什么要有这一格：绑定靠"两边都有这个符号名"配对，而 `run`／`note`／`event`／`specs`／`evaluate`
 *  这种名字满屏都是 ⇒ 拿它配对等于没配对（第 317 页现读：`run` 在 295 份判卷里出现在 130 份里）。
 *  2026-10-03 现读的那道空档：真能当配对的符号停在 **0—3 份**（`unionNote` 1、`promoteToMain` 1、
 *  `SIDECHAT_FORBIDDEN_TOOLS` 2、`feasibility` 2、`clampTier` 2、`parseArgs` 3），
 *  下一档直接跳到 14（`evaluate`）／18（`specs`）／35（`event`）／38（`note`）／130（`run`）。
 *  帽取 5＝空档内侧的整数（不贴着现读钉死，也不放到 14 那一档——那一档已经说明不了任何一格）。 */
export const BINDING_SYMBOL_MAX_JUDGE_FILES = 5;

const hasSymbol = (text: string, symbol: string): boolean =>
  new RegExp("(^|[^A-Za-z0-9_])" + symbol + "([^A-Za-z0-9_]|$)", "u").test(text);

/** 一条绑定缺了哪几件事（空数组＝成立）。原因逐条印出来：只答"不成立"等于让人再去 grep 一遍。 */
export function claimBindingDefects(b: ClaimBinding, m: BindingMaterial): string[] {
  const out: string[] = [];
  const file = b.face.split("｜")[0]?.split("#")[0] ?? b.face;
  const srcText = m.src.get(file);
  if (srcText === undefined) out.push(`取料里没有 ${file}`);
  else if (!hasSymbol(srcText, b.symbol)) out.push(`${file} 里没有 ${b.symbol} 这个符号（那句背后没有你说的开关）`);
  // 区分度按**取料里那一批判卷**算（不是另找一份语料）：真仓那一趟交的就是全部 tests ⇒ 有分母。
  const colliding = [...m.tests.values()].filter((t) => hasSymbol(t, b.symbol)).length;
  if (colliding > BINDING_SYMBOL_MAX_JUDGE_FILES) {
    out.push(`${b.symbol} 在 ${String(colliding)} 份判卷里出现过（帽 ${String(BINDING_SYMBOL_MAX_JUDGE_FILES)}）⇒ 这个词没有区分度，拿它配对等于没配对`);
  }
  const testText = m.tests.get(b.testFile);
  if (testText === undefined) out.push(`判卷文件 ${b.testFile} 不在取料面里`);
  else {
    // ③ 先要它**是**一条用例标题（四支抽取与锚点指针同一把尺），再④要那条用例体内用到这个开关。
    //    只查"文件里出现过这个词"会漏：`testCaseBody` 用的是 indexOf，注释里写一句就能把后面 4000 字算成体。
    const isTitle = vitestTitles(testText).some((t) => t === b.testCase)
      || vitestTitlePatterns(testText).some((re) => re.test(b.testCase));
    if (!isTitle) out.push(`${b.testFile} 里没有「${b.testCase.slice(0, 40)}」这条**用例标题** ⇒ 绑定只能指到文件，指不到判它的那一格`);
    else {
      const body = testCaseBody(testText, b.testCase);
      if (body === null) out.push(`${b.testFile} 那条标题取不到用例体（写法超出四支抽取的形状，静态验不了 ⇒ 别当已验）`);
      else if (!hasSymbol(body, b.symbol)) out.push(`${b.testFile} 那条用例体内没引用 ${b.symbol}（它判的不是这件事）`);
    }
  }
  return out;
}

/** 绑定生效的那些格从「欠证人」移到「绑定」；**守恒律**：`bound + unwitnessed` 必须等于进来的
 *  `findings.unwitnessed` 条数（判卷里钉着）。`bad` 不占这个等式——它是登记表自己的病，单独红。 */
export function bindClaimFaces(
  findings: Pick<ClaimWitnessFindings, "unwitnessed">,
  bindings: readonly ClaimBinding[],
  m: BindingMaterial,
): { bound: string[]; unwitnessed: string[]; bad: string[] } {
  const owed = new Set(findings.unwitnessed);
  const moved = new Set<string>();
  const bad: string[] = [];
  for (const b of bindings) {
    if (!owed.has(b.face)) {
      bad.push(b.face + "：欠证人清单里没有这一格（那句话改了名、被删，或它已经拿到原句证人 ⇒ 这条是白登记）");
      continue;
    }
    const defects = claimBindingDefects(b, m);
    if (defects.length > 0) { bad.push(b.face + "：" + defects.join("；")); continue; }
    moved.add(b.face);
  }
  return {
    bound: findings.unwitnessed.filter((k) => moved.has(k)),
    unwitnessed: findings.unwitnessed.filter((k) => !moved.has(k)),
    bad,
  };
}

/** 已甄别的绑定登记表。每条都要能过 `claimBindingDefects` 那四件事，过不了就红在判卷里——
 *  这张表不是"我说它真"，是"它背后那个开关真在被指认的那条用例里被用着"。逐条附**为什么这句被它兜住**。 */
export const CLAIM_BINDINGS: readonly ClaimBinding[] = [
  {
    face: "src/agent/sidechat.ts#SIDECHAT_SYSTEM｜写向工具已从你的工具表摘除",
    symbol: "SIDECHAT_FORBIDDEN_TOOLS",
    testFile: "tests/sidechat-core.test.ts",
    testCase: "三个写向工具不在 sidechat 工具表里",
    why: "那句话的范围由这份名单兜：那条用例逐个断言名单里的工具不在 `sidechatToolSpecs()` 给的表内；"
      + "而表本身是按 `SIDECHAT_TOOL_WHITELIST` 过滤出来的（allow-list，不是黑名单加补丁）",
  },
  {
    face: "src/agent/sidechat.ts#SIDECHAT_SYSTEM｜你的结论不会自动进入主会话",
    symbol: "promoteToMain",
    testFile: "tests/sidechat-core.test.ts",
    testCase: "source_event_ids 为空 → 拒绝（结论须可追溯）",
    why: "旁路进主流只有 `promoteToMain` 这一个显式入口，那条用例钉的是「没有可追溯的源事件号 ⇒ 整条拒绝」，"
      + "⇒ 不调它（或调了但缺三件事）主会话一个字节都不写。"
      + "这句的另一半（旁路事件落在自己的 JSONL、主文件字节不变）由同文件那条 JSONL 用例守着，"
      + "而那条不引用这个符号 ⇒ 本条登记说的是**入口这一半**，不冒充整句都被它兜住。",
  },
  /* 第 317 页：拿新的四条件把「其实早就有人判，只是证人用了另一套词」那几格捞回来。
     每条都是先跑候选名单（`outputs/claim-binding-tighten-2026-10-03/find-candidates.mts`）、
     再逐条读那条用例的体确认"它判的就是这句话"才登记的——不是符号两边都在就填。 */
  {
    face: "src/tools/output-ring.ts#WEB_CONTENT_TRUNCATION_HINT｜锚点不会改变取回的内容",
    symbol: "WEB_CONTENT_TRUNCATION_HINT",
    testFile: "tests/web-fetch.test.ts",
    testCase: "要么不说，要说就说清片段不上线：那句解释必须写在模型读到的这一句里",
    why: "那条用例直接对这个常量断言 `toMatch(/锚点[^，。；)]{0,18}不会改变取回/u)` ⇒ 这句话本身是判据，"
      + "不是注释；同文件另一条还钉「这句要真从 web_fetch 那一支交出去」，所以常量改了出口不接也会红",
  },
  {
    face: "src/tools/output-ring.ts#WEB_CONTENT_TRUNCATION_HINT｜本工具不会替你翻页",
    symbol: "WEB_CONTENT_TRUNCATION_HINT",
    testFile: "tests/web-fetch.test.ts",
    testCase: "要么不说，要说就说清片段不上线：那句解释必须写在模型读到的这一句里",
    why: "同一条用例的第二半：`expect(WEB_CONTENT_TRUNCATION_HINT).toContain(\"不会替你翻页\")` 是**反向哨兵**——"
      + "这条否定式事实本来就在句子里，不许被后续改动顺手删掉（写它的那一页实测过它是 0 证人）",
  },
  {
    face: "src/tools/impact-query.ts#unionNote｜清单仍是各份同名定义的并集",
    symbol: "unionNote",
    testFile: "tests/impact-query.test.ts",
    testCase: "并集那句不许再承诺做不到的事，也不许夸成已经做到（文案的两半各钉一次）",
    why: "那条用例两头都钉：`toContain(\"并集\")`（这件事仍然成立，不许藏）＋ `not.toMatch(/已按定义逐条(筛|收窄|判)/)`"
      + "（做不到的一律不许写进模型可见文案）⇒ 这句「仍是并集」既有正向证人，也有防它说反话的哨兵",
  },
  {
    face: "src/agent/prune-batching.ts#thresholdKnobIsWired｜门槛拨到多低都不会多出落盘",
    symbol: "thresholdKnobIsWired",
    testFile: "tests/prune-batching.test.ts",
    testCase: "每轮都落盘 ⇒ 绿；仍然只在压缩轮落盘 ⇒ 红（并说清是对照空了）",
    why: "那句话只在 `stray === 0` 那一支拼进 detail，而这条用例喂的正是「没活可干」的形状：`expect(red.detail).toContain(\"对照是空的\")`"
      + " ⇒ 这句点名话有观测者（红的那一支就是它要说的事），不是写了没人读",
  },
];

/** 存量帽（计数类**不留余量**，同 `prose-needle-scan` 那族）。三态各自出声：
 *  `over`＝现读超过帽（新加的无人判能力断言）；`stale`＝现读低于帽（有人补了证人却没把帽调下来，
 *  登记表自己烂掉也要红）；`margin` 只是给读数用，不参与判定。 */
export function claimWitnessCeiling(
  findings: Pick<ClaimWitnessFindings, "unwitnessed">,
  cap: number,
): { over: boolean; stale: boolean; read: number; cap: number; margin: number } {
  const read = findings.unwitnessed.length;
  return { over: read > cap, stale: read < cap, read, cap, margin: cap - read };
}

const siteKey = (s: { file: string; fn: string }): string => s.file + "#" + s.fn;

/**
 * 清单完整性判定（**判卷与探针共用这一份**，规则 100：同一判据各抄一份迟早漂）。
 * 两格成对：面缺归属 ⇒ unjudged；归属指向已消失的发射处 ⇒ stale。
 */
export interface InventoryFindings {
  modelKeys: string[];
  unjudged: string[];
  stale: string[];
  byAudience: { model: number; operator: number; ui: number };
}

export function promiseInventoryFindings(
  sites: readonly PromiseSite[],
  runners: Readonly<Record<string, string>> = RUNNERS,
): InventoryFindings {
  const modelSites = sites.filter((s) => s.audience === "model");
  const modelKeys = [...new Set(modelSites.map(siteKey))];
  const live = new Set(modelKeys);
  return {
    modelKeys,
    unjudged: modelKeys.filter((k) => runners[k] === undefined),
    stale: Object.keys(runners).filter((k) => !live.has(k)),
    byAudience: {
      model: modelSites.length,
      operator: sites.filter((s) => s.audience === "operator").length,
      ui: sites.filter((s) => s.audience === "ui").length,
    },
  };
}

/**
 * #59 的候选定义：「回取承诺＝在截断/归档点上调用某个 notice builder」。
 * 若这条成立，按措辞收料的网（`PROMISE_MARKS`）就能退休——换写法即绕过的那一族病（规则 122）也就没了。
 * 下面这一格量的就是它成不成立：读的是**两面之差**，不是印象。
 */
export const NOTICE_BUILDERS: readonly string[] = [
  "byteCapNotice", "countCapNotice", "truncationNotice", "pruneRecallSuffix", "skillRecallSuffix",
];

export interface BuilderCallSite {
  file: string;
  fn: string;
  builder: string;
  line: number;
}

/** AST 收 builder 的**调用点**（定义本身不算；只吃传进来的源文本 ⇒ 判卷可直接喂突变源）。 */
export function scanBuilderCallSites(files: readonly { path: string; text: string }[]): BuilderCallSite[] {
  const out: BuilderCallSite[] = [];
  for (const f of files) {
    const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && NOTICE_BUILDERS.includes(node.expression.text)) {
        out.push({
          file: f.path,
          fn: enclosingFnName(node.expression),
          builder: node.expression.text,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/**
 * 按 `fn` 把措辞网收到的承诺面分成「由 builder 发射」与「在调用方 inline」。
 * 只有这一支能回答 #59 的问题（结构网盖不盖得住），且必须比 `fn` 而不是键集——
 * builder 的**调用点**与字面量所在函数是两回事，比键集恒得 0 交集（一条恒真读数）。
 */
export function builderCoverage(modelSites: readonly PromiseSite[]): { viaBuilder: string[]; inline: string[] } {
  const keys = (list: readonly PromiseSite[]) => [...new Set(list.map((s) => siteKey(s)))];
  return {
    viaBuilder: keys(modelSites.filter((s) => NOTICE_BUILDERS.includes(s.fn))),
    inline: keys(modelSites.filter((s) => !NOTICE_BUILDERS.includes(s.fn))),
  };
}

/**
 * 「半句话」这条判据挂在**结构**上的那一半（宽版本挂在措辞上，量出来 103 处里 96 处是散文/事件名/规格说明
 * ⇒ 被否决，见 `outputs/half-sentence-net-2026-09-26/01-measure.mts`）。
 *
 * 静态判得定的只有两种形状：
 *   ① `byteCapNotice(a, b, nextStep)` 的下一步是**调用方给的参数**——给空串就等于模板里那句变成 `（）`；
 *      「给了一句在这个消费者身上做不到的动作」判不了（第 69 页那句 glob 就是那种，只能逐面配用例）。
 *   ② `truncationNotice(n)` 那支老文案**不说少了多少**（第 67 页为 `byteCapNotice` 立的就是这条纪律）
 *      ⇒ 它每多一个调用方，就多一处"只说截断、不说漏了多少"的面。
 */
export interface CapNoticeCall {
  file: string;
  fn: string;
  line: number;
  builder: string;
  /** 第三实参的原文；缺省（参数没给）＝ `null`。`byteCapNotice` 之外一律 `null`。 */
  nextStepArg: string | null;
  /** 只对 `byteCapNotice` 有意义：下一步是空串字面量。 */
  emptyNextStep: boolean;
}

export function scanCapNoticeCalls(files: readonly { path: string; text: string }[]): CapNoticeCall[] {
  const out: CapNoticeCall[] = [];
  for (const f of files) {
    const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        (node.expression.text === "byteCapNotice" || node.expression.text === "truncationNotice")) {
        const third = node.expression.text === "byteCapNotice" ? node.arguments[2] : undefined;
        out.push({
          file: f.path,
          fn: enclosingFnName(node.expression),
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          builder: node.expression.text,
          nextStepArg: third === undefined ? null : third.getText(sf),
          emptyNextStep: third !== undefined && ts.isStringLiteral(third) && third.text.trim() === "",
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

// --------------------------------------------------------------------------- 最后一跳

interface Verdict {
  ok: boolean;
  /** 这一格是怎么量的（"照承诺的动作，用真工具做一遍"，不是读代码的印象）。 */
  how: string;
  detail: string;
}

/** 从承诺文本里取出被点名的路径（`[全文见 <path>]` / `[原文已存附件 <path>，…]`）。 */
function pathIn(text: string): string {
  const m = /(?:全文见|原文已存附件)\s+([^\s，,）)\]]+)/u.exec(text);
  return m?.[1] ?? "";
}

async function hopWithReadFile(workspace: string, path: string): Promise<{ reached: boolean; why: string }> {
  if (path === "") return { reached: false, why: "那句里根本没有地址" };
  const ctx = { workspace, emit: async () => {} } as unknown as ToolContext;
  try {
    const r = await read_file.run({ path }, ctx);
    return {
      reached: r.ok === true,
      why: `read_file 返回 ok=${String(r.ok)}：${r.output.slice(0, 70).replace(/\s+/g, " ")}`,
    };
  } catch (err) {
    return { reached: false, why: "read_file 抛错：" + (err instanceof Error ? err.message : String(err)) };
  }
}

/** skill 那两把「全文见 <entry.path>」：真发现 → 真展开 → 真 read_file，两种落位各量一次。 */
async function hopSkill(workspace: string): Promise<Verdict> {
  const userRoot = await mkdtemp(join(tmpdir(), "promise-recall-userplugins-"));
  const projectRoot = join(workspace, ".agent", "plugins");
  try {
    await mkdir(join(userRoot, "big-suite", ".claude-plugin"), { recursive: true });
    await mkdir(join(userRoot, "big-suite", "skills", "big"), { recursive: true });
    await mkdir(join(projectRoot, "proj-suite", ".claude-plugin"), { recursive: true });
    await mkdir(join(projectRoot, "proj-suite", "skills", "big"), { recursive: true });
    const manifestOf = (name: string): string =>
      JSON.stringify({ name, description: "探针样本", version: "0.1.0" });
    // 正文要越过 SKILL_REMOUNT_TOKENS_PER_SKILL(=5000 token) 才会触发那句尾注
    const body = "line of skill text\n".repeat(4000);
    for (const [root, name] of [[join(userRoot, "big-suite"), "big-suite"], [join(projectRoot, "proj-suite"), "proj-suite"]] as const) {
      await writeFile(join(root, ".claude-plugin", "plugin.json"), manifestOf(name), "utf8");
      await writeFile(join(root, "skills", "big", "SKILL.md"), "---\ndescription: 探针用大 skill\n---\n\n" + body, "utf8");
    }

    const manifest = await discoverPlugins({ userPluginsDir: userRoot, projectPluginsDir: projectRoot });
    const pick = (pluginName: string) =>
      manifest.plugins.find((p) => p.name === pluginName)?.skills.find((s) => s.name === "big");
    const userEntry = pick("big-suite");
    const projEntry = pick("proj-suite");
    if (!userEntry || !projEntry) {
      return { ok: false, how: "discoverPlugins", detail: "发现没出两支 skill ⇒ 没有尺（探针红，不是产品干净）" };
    }

    const suffixFor = (e: NonNullable<typeof userEntry>): string =>
      expandSkillInvocation([e], skillInvokeName(e), undefined, workspace).text.slice(-300);
    const userSuffix = suffixFor(userEntry);
    const projSuffix = suffixFor(projEntry);
    const userGiven = pathIn(userSuffix);
    const projGiven = pathIn(projSuffix);
    if (projGiven === "") {
      return {
        ok: false,
        how: "expandSkillInvocation",
        detail: "区内那案（项目级插件）没给出取回地址 ⇒ 触发形状不对（探针红）：" + projSuffix.slice(-110),
      };
    }

    const asWrittenProj = await hopWithReadFile(workspace, projGiven);
    // #47 落地后的判据（两半都要，缺一半就能骗过去）：
    //   区内 ⇒ 必须递**相对**地址且照原文真读得到；区外 ⇒ 必须**不递地址**并明说读不到。
    const projHonest = !projGiven.startsWith("/") && asWrittenProj.reached;
    const userHonest = userGiven === "" && userSuffix.includes("读不到");
    return {
      ok: projHonest && userHonest,
      how: "discoverPlugins（产品取 path 那一句）→ expandSkillInvocation（带真 workspace）→ 真 read_file",
      detail:
        `区内那案：递「${projGiven.slice(0, 60)}」⇒ ${asWrittenProj.reached ? "读得到" : "读不到"}` +
        `（绝对地址？${projGiven.startsWith("/") ? "是＝不合格" : "否"}）` +
        `｜区外那案：${userHonest ? "不递地址且明说读不到（合格）" : "不合格，仍递：" + userGiven}｜尾注原文：${userSuffix.slice(-70)}`,
    };
  } finally {
    await rm(userRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/** `orchestrator-join` 的「再调一次 wait_for_agents 即可取回其摘要」：受众拿得到那把工具吗 + 单次 re-wait 真给摘要吗。 */
function hopJoinPayload(): Verdict {
  const many = Array.from({ length: 8 }, (_, i) => ({
    agentId: "w" + String(i),
    status: "done" as const,
    task: "探针任务 " + String(i),
    report: "结论".repeat(4000),
    usage: { inputTokens: 10, outputTokens: 20 },
  }));
  const shaped = shapeJoinRows(many);
  const text = renderJoinPayload({ ...shaped, timedOut: [], cancelled: false });
  const promised = ["wait_for_agents", "cancel_agents"].filter((n) => text.includes(n));
  const row = INJECTED_TOOLS.find((t) => t.name === "wait_for_agents");
  if (promised.length === 0) return { ok: false, how: "renderJoinPayload", detail: "退化格没出那句 ⇒ 触发形状不对（探针红）" };
  if (!row) return { ok: false, how: "INJECTED_TOOLS", detail: "声明表里没有 wait_for_agents ⇒ 没有尺（探针红）" };
  const single = shapeJoinRows([many[0] as (typeof many)[number]]);
  const gotBack = String(single.rows[0]?.summary ?? "").length > 0;
  return {
    ok: gotBack,
    // 受众由**声明表**说，不由措辞说：workerReachable=false ⇒ 这句只对主会话成立
    how: "shapeJoinRows（整批帽）→ renderJoinPayload → shapeJoinRows（单 agent 再走一次）+ tool-surface 声明表",
    detail:
      `点名工具=${promised.join("、")}｜单次 re-wait 拿到摘要=${gotBack ? "是" : "否"}` +
      `（长度 ${String(String(single.rows[0]?.summary ?? "").length)}）` +
      `｜worker 可达=${String(row.workerReachable)} ⇒ 这句承诺只对主会话兑现（面板/worker 侧收到就是空话）`,
  };
}

/** 占位串的三种语义（第 310 页给那一格 0 加分母列时抽出来的）。
 *  同一个 `computePrune` 出口，实参形状不同交的东西完全不同 ⇒ 单看「附件=0 条」分不了成因：
 *  - 裸占位：没给 `attachmentsDir` ⇒ 只有一句 cleared，**没有任何回取通道**；
 *  - 读不到声明：给了目录但工作区不可证明（`workspaceUsablePath` 是 fail-closed 的）⇒ 明说"模型侧读不到"；
 *  - 带可取路径：给了目录且目录在工作区内 ⇒ 附相对路径并让模型 `read_file` 取回。
 *  判据只认 producer 自己那两句措辞（`pruneRecallSuffix` 的两个分支），不认"像不像有路径"。 */
export type RecallStubKind = "裸占位" | "读不到声明" | "带可取路径";

export function classifyPruneStub(stub: string): RecallStubKind {
  if (stub.includes("原文已存附件")) return "带可取路径";
  if (stub.includes("模型侧读不到")) return "读不到声明";
  return "裸占位";
}

/** 一栏读数。`wrote` 是 **`computePrune` 交回的附件路径条数**（落盘由调用方那支异步函数做，
 *  这一层只到"给了地址"），判卷要说的是"有没有地址"，不是"盘上有没有文件"。 */
export interface PruneStubColumn {
  label: string;
  why: string;
  wrote: number;
  kind: RecallStubKind;
}

/** 尺本体：同一份事件 fixture，唯一变量是**传给 `computePrune` 的实参形状** ⇒ 栏与栏之差
 *  只能是那一格 0 的成因，不可能是别的东西。抽成纯函数是为了让判卷吃结构、不吃我印的那句话
 *  （规则 371：判卷不许替被验对象做那个动作，也不许靠正则读我的报告才看得见结论）。 */
export function pruneStubMatrix(): PruneStubColumn[] {
  const events: AgentEvent[] = [];
  for (let r = 0; r < 6; r++) {
    events.push({ type: "user_message", content: "round " + String(r) } as AgentEvent);
    events.push({ type: "tool_call", id: "c" + String(r), name: "read_file", args: { path: "a.ts" } } as AgentEvent);
    events.push({ type: "tool_result", callId: "c" + String(r), ok: true, output: "R".repeat(100 * 1024) } as AgentEvent);
  }
  const kindOf = (replacements: Map<number, string>): RecallStubKind =>
    replacements.size === 0 ? "裸占位" : classifyPruneStub(String([...replacements.values()][0]));
  const column = (label: string, res: ReturnType<typeof computePrune>): PruneStubColumn =>
    ({ label, why: res.why, wrote: res.attachments.length, kind: kindOf(res.replacements) });
  // 栏一＝与那个调用点**同一实参形状**：只给 events（源码那一行逐字如此）。
  // 栏二＝反事实甲：补目录，但不给工作区。栏三＝反事实乙：目录就在工作区内。
  return [
    column("栏一（调用点形状）", computePrune({ events })),
    column("栏二（只给目录）", computePrune({ events, attachmentsDir: "/tmp/dsh-hop-attachments", sessionId: "s1" })),
    column("栏三（目录在工作区内）", computePrune({
      events, attachmentsDir: join(ROOT, ".dsh-hop-attachments"), sessionId: "s1", workspace: ROOT,
    })),
  ];
}

/** `agent-runner.ts` map 演示那句「原文可从附件目录回取」：那一支调用真交出过地址吗。
 *
 *  第 310 页把这一格的 0 拆成能行动的读数。老读数只有「附件=0 条」，而 0 至少两种成因：
 *  ① 那句承诺真为假；② 是我这一趟的取料没触发落盘那一支。三栏各跑一次自答（`pruneStubMatrix`）。
 *  栏一 vs 栏二 ⇒ 缺的是那一个实参；栏二 vs 栏三 ⇒ **还缺工作区**，只补目录会换成"读不到"那句。
 *  ⇒ 修法因此是两件事，不是一件；这也是为什么这里不满足于"跑两栏"。
 *  （第一版这里只断言 `原文已存` 一个标记，而它有两个分支，于是栏三差点被读成"路不通"——
 *  标记选窄了＝量法缺陷本身，`classifyPruneStub` 就是为修它而抽出来的。） */
export function hopMapDemo(): Verdict {
  const [asCalled, dirOnly, inWorkspace] = pruneStubMatrix();
  const lied = asCalled.why === "saved" && asCalled.wrote === 0;
  return {
    ok: !lied,
    how: "computePrune 三栏：照调用点实参形状／只给目录／给目录且目录在工作区内——三栏之差就是那一格 0 的成因",
    detail:
      `why=${asCalled.why}｜${asCalled.label}附件=${String(asCalled.wrote)} 条、占位=${asCalled.kind}`
      + `｜${dirOnly.label}附件=${String(dirOnly.wrote)} 条、占位=${dirOnly.kind}`
      + `｜${inWorkspace.label}附件=${String(inWorkspace.wrote)} 条、占位=${inWorkspace.kind}`
      + ` ⇒ 那句「原文可从附件目录回取」在此刻${lied
        ? " **为假**：那一趟交的是裸占位，既没给地址也没给通道。假话在调用方那句括号里，不在 `computePrune`"
          + "（它不给目录时交裸占位、目录不可证明时明说读不到，两种都不假装给通道）"
          + "｜修法有两件：调用点要传 attachmentsDir，且要让工作区可证明——只补前者只会换成『读不到』那句"
        : " 成立"}`,
  };
}

/** prune 那把已证到底的面：不重抄判据，直接跑既有复现器读它的退出码（规则 100：同一判据只留一份）。 */
function hopPruneStub(): Verdict {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts", "probe-prune-recall.ts")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const tail = String(r.stdout ?? "").trim().split("\n").slice(-2).join(" / ");
  return {
    ok: r.status === 0,
    how: "spawn scripts/probe-prune-recall.ts（既有复现器，本探针不重抄它的判据）",
    detail: `exit=${String(r.status)}｜${tail.slice(0, 140)}`,
  };
}

/** 第 309 页那一面的判定归属：`WEB_CONTENT_TRUNCATION_HINT` 里那句「换一个更精确的 URL」到底做不做得到。
 *  与 prune 那格同一个形状——**判据住在复现器里**（`scripts/probe-web-anchor-claim.ts`），
 *  这一支只 exec 它；判卷 `tests/web-fetch.test.ts` exec 的也是同一支，不各抄一份。 */
function hopWebAnchorClaim(): Verdict {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts", "probe-web-anchor-claim.ts")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const tail = String(r.stdout ?? "").trim().split("\n").slice(-3).join(" / ");
  return {
    ok: r.status === 0,
    how: "spawn scripts/probe-web-anchor-claim.ts（真起 loopback＋真 fetch：片段上不上线由服务器报，正文相同由三次请求比，换 path 必须不同当正控）",
    detail: `exit=${String(r.status)}｜${tail.slice(0, 190)}`,
  };
}

const RECALL_HOW = "把句子里点名的 id 真拿去调 obs_recall（shipped：ObservationLedger + createObservationRecallTool），看回来的页里有没有原文凭证";

/** 造一份"够归档"的授权输出（>10KB 且含失败信号行，收据支要拿它做引文）。 */
function recallFixture(needle: string, fill: string, rows: number): string {
  return [
    "test failed: error 断言不符 " + needle,
    ...Array.from({ length: rows }, (_, i) => "row-" + String(i) + " " + fill.repeat(90) + " 错误上下文"),
  ].join("\n");
}

/** #58 面一：`ledger.project` 的预览行 `[observation <id>: …; obs_recall available]`。 */
async function hopLedgerRecall(): Promise<Verdict> {
  // macOS 的 /var 是指向 /private/var 的符号链接，而 ledger 一律 O_NOFOLLOW ⇒ 必须先 realpath，
  // 否则 capture 直接 ELOOP（这格量的就是"照那句真做一遍"，环境假红会把判定淹掉——规则 52/89）。
  const dir = await mkdtemp(join(await realpath(tmpdir()), "probe-recall-ledger-"));
  try {
    const needle = "RECALL-LEDGER-凭证";
    const text = recallFixture(needle, "x", 130);
    const ledger = createObservationLedger(dir);
    const cap = await ledger.capture({ toolName: "run_shell", callId: "c1", source: { kind: "authorized-redacted-text", text } });
    if (!cap.archived || cap.id === undefined) {
      return { ok: false, how: RECALL_HOW, detail: "capture 没归档 ⇒ 这句承诺在这一刻根本不会发；error=" + String(cap.error ?? "(无)") };
    }
    const proj = await ledger.project({ id: cap.id, text, requestNumber: 3 }); // > FULL_SENDS ⇒ 走预览+提示
    const promised = proj.text.includes("obs_recall available");
    const tool = createObservationRecallTool(ledger);
    const page = tool === undefined
      ? { ok: false, output: "obs_recall 未注入（ledger disabled）" }
      : await tool.run({ id: cap.id }, { workspace: dir } as unknown as ToolContext);
    const reached = page.ok === true && String(page.output).includes(needle);
    return {
      ok: promised && reached,
      how: RECALL_HOW,
      detail: `capture.error=${String(cap.error ?? "无")}｜提示发了=${String(promised)}｜obs_recall ok=${String(page.ok)}｜页内含原文凭证=${String(reached)}` +
        `｜worker 可达=false（INJECTED_TOOLS.obs_recall）⇒ 这句只对主会话兑现`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** #58 面二：`solpi-runtime` 收据行的 `取全文 obs_recall id=<id>`（要跑满 FULL_SENDS 才发）。 */
async function hopSolpiReceipt(): Promise<Verdict> {
  const dir = await mkdtemp(join(await realpath(tmpdir()), "probe-recall-solpi-"));
  try {
    const needle = "RECALL-SOLPI-凭证";
    const output = recallFixture(needle, "y", 130);
    const events = [
      { type: "tool_call", id: "c1", name: "run_shell", args: { command: "true" } },
      { type: "tool_result", callId: "c1", ok: false, output },
    ] as unknown as AgentEvent[];
    const rt = new SolpiRuntime(dir, { observationPack: true, evidenceReceipts: true });
    let last = new Map<number, string>();
    for (let send = 0; send < 4; send++) {
      last = await rt.project(events);
      rt.sent([{ role: "tool", tool_call_id: "c1" }], events);
    }
    const text = String(last.get(2) ?? "");
    const id = (text.match(/取全文 obs_recall id=([0-9A-Za-z:._-]+)/) ?? [])[1];
    if (id === undefined) {
      return {
        ok: false, how: RECALL_HOW,
        detail: "收据支没发出那句承诺（sends 没满 / 收据不比原文小 / 校验没过）⇒ 要么修发射条件，要么这句该删",
      };
    }
    const tool = rt.recallTool(async () => true);
    const page = tool === undefined
      ? { ok: false, output: "recallTool 未注入" }
      : await tool.run({ id }, { workspace: dir } as unknown as ToolContext);
    const reached = page.ok === true && String(page.output).includes(needle);
    return {
      ok: reached,
      how: RECALL_HOW,
      detail: `提示发了=true（id 已嵌在收据行里）｜obs_recall ok=${String(page.ok)}｜内含原文凭证=${String(reached)}` +
        `｜worker 可达=false ⇒ 这句只对主会话兑现`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 每个模型可见面的判定归属：键 = `<file>#<fn>`。**加一面就必须在这里登记一条**，否则本探针红。
 * 键跟着**发射处**走：#47 把三处副本收成一支 `skillRecallSuffix` 之后，旧的两个键当场失效——
 * 下面的陈旧格会拦住"登记表烂在这儿"（与 D-8 ② 同族）。
 */
export const RUNNERS: Readonly<Record<string, string>> = {
  "src/agent/plugins/skills.ts#skillRecallSuffix": "hopSkill",
  "src/agent/orchestrator-join.ts#renderJoinPayload": "hopJoinPayload",
  "src/agent/prune.ts#pruneRecallSuffix": "hopPruneStub",
  "src/main/agent-runner.ts#body": "hopMapDemo",
  "src/agent/ledger.ts#project": "hopLedgerRecall",
  "src/agent/solpi-runtime.ts#candidate": "hopSolpiReceipt",
  // 第 309 页：`web_fetch`/`web-search` 共用的那句截断提示（措辞含「取回」⇒ 被本清单收成一个面）。
  // 这一面欠的判定不是"能不能回取"，而是**它给的出路做不做得到**——由复现器三件事量。
  "src/tools/output-ring.ts#WEB_CONTENT_TRUNCATION_HINT": "hopWebAnchorClaim",
};

/** 判定名的花名册：**登记一个不存在的名字，等于这一面没人判过**。
 *  此前 `runOnce` 是"落到最后一支"的 ternary——把名字打错会得到 `hopPruneStub` 的结论，
 *  登记表看着齐全、实际顶包（规则 366 那一族：指针失效比缺指针更难发现）。
 *  现在名字表在这里列一次，`isKnownRunner` 与判卷 `tests/promise-recall-inventory.test.ts` 共用它。 */
const RUNNER_NAMES: readonly string[] = [
  "hopSkill", "hopJoinPayload", "hopMapDemo", "hopLedgerRecall", "hopSolpiReceipt", "hopWebAnchorClaim", "hopPruneStub",
];

export function isKnownRunner(name: string): boolean {
  return RUNNER_NAMES.includes(name);
}

/** 名字 → 真去跑那一次判定。未知名字**不 exec**，直接红在这一格（不许拿别的 hop 的结果顶替）。 */
export function runnerVerdict(name: string, workspace: string): Promise<Verdict> {
  if (!isKnownRunner(name)) {
    return Promise.resolve({
      ok: false,
      how: "不 exec——这一格没有对应的判定函数，不许拿别的 hop 的结果顶替",
      detail: `RUNNERS 里的判定名「${name}」在本探针没有实现 ⇒ 登记等于空写`,
    });
  }
  return name === "hopSkill" ? hopSkill(workspace)
    : name === "hopJoinPayload" ? Promise.resolve(hopJoinPayload())
      : name === "hopMapDemo" ? Promise.resolve(hopMapDemo())
        : name === "hopLedgerRecall" ? hopLedgerRecall()
          : name === "hopSolpiReceipt" ? hopSolpiReceipt()
            : name === "hopWebAnchorClaim" ? Promise.resolve(hopWebAnchorClaim())
              : Promise.resolve(hopPruneStub());
}

function loadSrcFiles(): { files: { path: string; text: string }[]; missingOnDisk: string[] } {
  // 「git 跟踪」与「盘上有这个文件」在桌面层迁移在飞时不是一件事（实测 src/main/index.ts 已删未提交）。
  // 少读一支不等于扫过了 ⇒ 缺席清单出声（规则 92 同族）。
  // 这一跳的**口径收成一份**（`trackedExistingFiles`）：判卷 `tests/promise-recall-inventory.test.ts`
  // 原先抄着同一份循环 ⇒ 同一条取料两支各答一遍，改一支另一支照旧（本仓最忌的那族）。
  const scope = trackedExistingFiles(ROOT, "src");
  return {
    files: scope.files.map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") })),
    missingOnDisk: scope.missingOnDisk,
  };
}

let red = 0;
function line(mark: string, text: string): void {
  if (mark === "❌") red++;
  console.log(`  ${mark} ${text}`);
}

async function main(): Promise<void> {
  console.log("[probe promise-recall] 回取承诺的收口清单 + 最后一跳｜不进 gate-manifest，exit 1 = 缺陷还在或有承诺没判定");

  const { files, missingOnDisk } = loadSrcFiles();
  const sites = scanPromiseSites(files);
  console.log(
    "扫描面：src/ 在盘 " + String(files.length) + " 支（另有 " + String(missingOnDisk.length) +
    " 支已跟踪但不在盘 ⇒ 本清单不覆盖）｜承诺面 " + String(sites.length) + " 处",
  );
  if (sites.length === 0) {
    line("❌", "清单为空 ⇒ **没有尺**（扫描面或标记漂了），不读成干净");
    console.log("[probe promise-recall] 红 " + String(red) + " 条");
    process.exit(1);
  }

  const modelSites = sites.filter((s) => s.audience === "model");
  const inv = promiseInventoryFindings(sites);
  const exemptSites = sites.filter((s) => s.audience !== "model");
  for (const s of exemptSites) {
    const why = s.audience === "operator" ? "运维面（console.* 实参位）" : "UI 面（落在 UI_ROOTS＝给人看的桌面层）";
    console.log(`  ⚪ ${why}，不欠模型最后一跳，但仍进清单 ${s.file}:${String(s.line)} [${s.fn}]「${s.text}」`);
  }

  const workspace = await mkdtemp(join(tmpdir(), "promise-recall-ws-"));
  await writeFile(join(workspace, "target.ts"), "export const x = 1;\n", "utf8");

  const verdictCache = new Map<string, Promise<Verdict>>();
  const runOnce = (name: string): Promise<Verdict> => {
    const hit = verdictCache.get(name);
    if (hit) return hit;
    const next = runnerVerdict(name, workspace);
    verdictCache.set(name, next);
    return next;
  };

  try {
    const grouped = new Map<string, PromiseSite[]>();
    for (const s of modelSites) {
      const list = grouped.get(siteKey(s)) ?? [];
      list.push(s);
      grouped.set(siteKey(s), list);
    }
    // 两格判定走 promiseInventoryFindings 那一份（判卷 import 的也是它）——不在这里再算一遍。
    for (const key of inv.modelKeys) {
      for (const s of grouped.get(key) ?? []) console.log(`  面 ${s.file}:${String(s.line)} [${s.fn}]「${s.text}」`);
      const runner = RUNNERS[key];
      if (runner === undefined) {
        line("❌", `${key} 没有判定归属 ⇒ 新加一句「全文见 X」就必须给一次可达性判定（在 RUNNERS 里登记并写清怎么量的）`);
        continue;
      }
      const v = await runOnce(runner);
      line(v.ok ? "✅" : "❌", `${key} ⇒ ${v.detail}`);
      console.log(`      量法：${v.how}`);
    }
    if (inv.unjudged.length === 0 && inv.modelKeys.length === 0) {
      line("❌", "模型可见的承诺面为 0 ⇒ 没有尺（标记或扫描面漂了），不读成干净");
    }

    // 登记表也不许烂在这儿（与 D-8 ② 同族）：把三处副本收成一支 helper 之后，旧键若还挂着，
    // 读表的人会以为那一面还有判定在守，而它其实守的是一个已经不存在的发射处。
    line(inv.stale.length === 0 ? "✅" : "❌",
      inv.stale.length === 0 ? "判定归属表没有陈旧键" : "陈旧归属键：" + inv.stale.join(" | ") + " ⇒ 那一面已不在盘上发射，撤掉这条登记");

    // #59 的裁决读数（**这是读数不是判据**：红不红仍由上面几格决定）。
    // 结构网＝「承诺文案由 builder 发射」；措辞网＝现在这张 `PROMISE_MARKS`。
    // 两边必须比**同一件东西**：措辞面的键是字面量所在函数，builder 的键是它的函数名 ⇒ 比 `fn`，
    // 不能比 `<file>#<fn>` 键集（那是两回事，比出来恒为 0 交集＝一条恒真读数，规则 128 第二种形态）。
    {
      const cov = builderCoverage(modelSites);
      console.log("  ⚪ #59 读数：模型可见承诺面 " + String(inv.modelKeys.length) + " 格（字面量 " + String(modelSites.length) + " 处），" +
        "其中由 builder 发射 " + String(cov.viaBuilder.length) + " 格 / 在调用方 inline " + String(cov.inline.length) + " 格");
      console.log("      inline 那几格＝按 builder 调用收料会漏的：" + (cov.inline.join(" | ") || "—"));
      // 反向一侧（规则 60）：builder 的**调用点**里有多少并不产出去取回原文的承诺（那是"少说了多少"，另一族）。
      const callSites = scanBuilderCallSites(files);
      const callKeys = [...new Set(callSites.map((c) => siteKey(c)))];
      const wordingKeys = new Set(inv.modelKeys);
      const notPromise = callKeys.filter((k) => !wordingKeys.has(k));
      console.log("      builder 调用点 " + String(callKeys.length) + " 处，其中措辞网未收 " + String(notPromise.length) +
        " 处（`另有 N 条未列出` 那一族：属**省略量**而非**回取承诺**，不是缺陷）：" + (notPromise.join(" | ") || "—"));
      // 尺自己也要可证伪（规则 63/65/74）：内存里多一处 builder 调用 ⇒ 结构面必须报更大的数。
      const t = modelSites[0];
      const f2 = files.find((x) => x.path === t?.file) ?? files[0] ?? { path: "probe.ts", text: "" };
      const baseB = scanBuilderCallSites([f2]).length;
      const extraB = scanBuilderCallSites([
        { path: f2.path, text: f2.text + '\nfunction __probeBuilder(): string { return byteCapNotice(10, 20, "x"); }\n' },
      ]).length;
      line(extraB > baseB ? "✅" : "❌",
        `自证：追加一次 builder 调用 ⇒ 该支调用点从 ${String(baseB)} 变 ${String(extraB)}（没变 = 结构网恒假）`);
    }

    // 「半句话」读数——宽版本（按措辞）已否决，这里只留挂在结构上的那一半。
    {
      const calls = scanCapNoticeCalls(files);
      const empty = calls.filter((c) => c.emptyNextStep);
      const legacy = calls.filter((c) => c.builder === "truncationNotice");
      const byte = calls.filter((c) => c.builder === "byteCapNotice");
      console.log("  ⚪ 半句话读数（结构版）：`byteCapNotice` 调用 " + String(byte.length) + " 处｜下一步给了空串的 " +
        String(empty.length) + " 处｜`truncationNotice`（不说少了多少的那支老文案）调用 " + String(legacy.length) + " 处");
      for (const c of [...empty, ...legacy].slice(0, 10)) {
        console.log("      " + c.file + ":" + String(c.line) + " [" + c.fn + "] " + c.builder +
          " 下一步=" + (c.nextStepArg ?? "（没给）"));
      }
      const one = files[0] ?? { path: "p.ts", text: "" };
      const baseC = scanCapNoticeCalls([one]).length;
      const extraC = scanCapNoticeCalls([
        { path: one.path, text: one.text + '\nfunction __probeCap(): string { return byteCapNotice(1, 2, ""); }\n' },
      ]).length;
      const extraEmpty = scanCapNoticeCalls([
        { path: one.path, text: one.text + '\nfunction __probeCap(): string { return byteCapNotice(1, 2, ""); }\n' },
      ]).filter((c) => c.emptyNextStep).length;
      line(extraC > baseC && extraEmpty > 0 ? "✅" : "❌",
        `自证：追加一处 ` + "`byteCapNotice(1, 2, \"\")`" + ` ⇒ 调用点 ${String(baseC)}→${String(extraC)}、空下一步 ${String(extraEmpty)}（都要动才算有分辨力）`);
    }

    // 尺自己也要可证伪（规则 63/65/74）：挑一支**已有面**的文件，在内存里凭空多一处承诺，清单必须报更大的数。
    const target = modelSites[0];
    const one = files.find((f) => f.path === target?.file) ?? files[0] ?? { path: "probe.ts", text: "" };
    const base = scanPromiseSites([one]).length;
    const extra = scanPromiseSites([
      { path: one.path, text: one.text + '\nfunction __probe(): string { return "[全文见 /somewhere/else]"; }\n' },
    ]).length;
    line(extra > base ? "✅" : "❌",
      `自证：往内存里那份源码追加一句承诺 ⇒ 该支清单从 ${String(base)} 变 ${String(extra)}（没变 = 这条判据恒假）`);

    // 反向一侧（规则 60：收窄判定面必须同时补一条 opposite-side 断言）——
    // 受众豁免只认「落在 UI_ROOTS」这一条路，同形状写进模型可见根就仍欠判定；否则 UI 态是张空白支票。
    const injected = scanPromiseSites([
      { path: one.path, text: one.text + '\nfunction __probePromise(): string { return "[全文见 /somewhere/else]"; }\n' },
    ]);
    const owedNew = injected.some((s) => s.fn === "__probePromise" && s.audience === "model" &&
      RUNNERS[siteKey(s)] === undefined);
    const uiExempt = scanPromiseSites([
      { path: "src/renderer/__probe.js", text: 'function __probeUi(): string { return "[全文见 安全报告卡]"; }' },
    ]).some((s) => s.audience === "ui");
    line(owedNew && uiExempt ? "✅" : "❌",
      `反向：同形状进模型可见根 ⇒ 仍欠判定（${owedNew ? "是" : "否"}）；进 UI_ROOTS ⇒ 认成 UI 面（${uiExempt ? "是" : "否"}）`);

    /* 第二个 claim 类（第 311 页）：模型可见的**能力断言**有多少条从来没被测试点过。
       这一格只印不拦是有意为之——拦在判卷（`tests/promise-recall-inventory.test.ts` 真仓那一趟），
       探针这边给人看的是名单本身：帽是 29，而帽只准调低。 */
    {
      const claimSites = scanClaimSites(files);
      const testPaths = trackedExistingFiles(ROOT, "tests").files;
      const corpus = testPaths.map((p) => readFileSync(join(ROOT, p), "utf8"));
      const cf = claimWitnessFindings(claimSites, corpus);
      // 绑定通道（第 314 页，四条件版见第 317 页）：证人用了另一套词的那些格，靠「执行端符号 + 点名用例」配对。
      // 取料交**带文件名的**两份正文——判定要问的是"这个符号在那支文件里"，只交一坨拼接文本就答不了；
      // 符号区分度也读这一份（`tests` 交的就是全部判卷 ⇒ 分母是真盘，不是被谁挑小过的）。
      const material: BindingMaterial = {
        src: new Map(files.map((f) => [f.path, f.text])),
        tests: new Map(testPaths.map((p, i) => [p, corpus[i] ?? ""])),
      };
      const bind = bindClaimFaces(cf, CLAIM_BINDINGS, material);
      const capped = { ...cf, unwitnessed: bind.unwitnessed };
      const ceil = claimWitnessCeiling(capped, CLAIM_UNWITNESSED_CAP);
      console.log("  ⚪ 能力断言证人面：面 " + String(claimSites.length) + " 处｜受众 " + JSON.stringify(cf.byAudience) +
        "｜模型可见 " + String(cf.modelSites) + " 格 ⇒ 有证人 " + String(cf.witnessed.length) +
        "／绑定 " + String(bind.bound.length) +
        "／欠证人 " + String(bind.unwitnessed.length) + "（帽 " + String(CLAIM_UNWITNESSED_CAP) +
        (ceil.over ? " ⇒ **超帽**" : ceil.stale ? " ⇒ **现读低于帽，把帽调下来**" : "，正贴线") + "）" +
        "／挑不出段 " + String(cf.noNeedle.length) +
        "（四态相加＝" + String(cf.witnessed.length + bind.bound.length + bind.unwitnessed.length + cf.noNeedle.length) + "）");
      for (const k of bind.bound) console.log("      绑定：" + k);
      for (const k of bind.bad) console.log("      ❌ 登记表自己有病：" + k);
      for (const k of bind.unwitnessed) console.log("      欠证人：" + k);
      for (const k of cf.noNeedle) console.log("      不可知（句里挑不出 ≥6 字连续中文，多半被插值切碎）：" + k);
      line(bind.bad.length === 0 ? "✅" : "❌",
        `绑定表逐条过三件事（那一格在欠证人清单里、符号在那句所在源文件里、符号在被指认判卷里）：坏 ${String(bind.bad.length)} 条`);
      line(!ceil.over && !ceil.stale ? "✅" : "❌",
        `能力断言的帽：现读 ${String(ceil.read)} 对帽 ${String(ceil.cap)}（超出＝新加的无人判句子；低于＝补了证人没调帽）`);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  console.log(red === 0
    ? "[probe promise-recall] 全绿：每一处回取承诺都按那句话做过一遍。"
    : "[probe promise-recall] 红 " + String(red) + " 条 ⇒ 见上（要么是指向走不通的路，要么是新面没给判定）");
  process.exit(red === 0 ? 0 : 1);
}

// 只在直接执行时跑：判卷 import 本模块时不得有副作用（规则 110）。
// 比较走 fileURLToPath——本仓路径里有空格，import.meta.url 会编码成 %20。
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
