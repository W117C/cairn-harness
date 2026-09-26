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

export interface PromiseSite {
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
   * - `model`：在模型可见根内，且不挂在 `console.*` 实参位 ⇒ 欠一次"照那句做一遍"；
   * - `operator`：`console.*` 实参位 ⇒ 给运维看；
   * - `ui`：落在 `UI_ROOTS` 里 ⇒ 给人看（HEAD-only 验跑会扫到桌面层，见那条注释）。
   * 后两态仍进清单（不许静默消失），只是不判可达性。
   */
  audience: "model" | "operator" | "ui";
}

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

/** 受众：先判落位（UI 根＝给人看），再沿 parent 链找最近的 CallExpression 是否 `console.*`。 */
function audienceOf(node: ts.Node, relFile: string): "model" | "operator" | "ui" {
  if (UI_ROOTS.some((root) => relFile.startsWith(root))) return "ui";
  let cur: ts.Node = node;
  for (;;) {
    if (ts.isCallExpression(cur)) {
      const e = cur.expression;
      if (
        ts.isPropertyAccessExpression(e) &&
        ts.isIdentifier(e.expression) &&
        e.expression.text === "console"
      ) {
        return "operator";
      }
      return "model";
    }
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

export function scanPromiseSites(files: readonly { path: string; text: string }[]): PromiseSite[] {
  const out: PromiseSite[] = [];
  for (const f of files) {
    const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      const text = literalText(node);
      if (text !== null) {
        for (const mark of PROMISE_MARKS) {
          if (!text.includes(mark)) continue;
          if (WEAK_MARKS.includes(mark) && !CALLABLE_NAMES.some((n) => text.includes(n))) continue;
          out.push({
            file: f.path,
            fn: enclosingFnName(node),
            mark,
            text: text.replace(/\s+/g, " ").slice(0, 160),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            audience: audienceOf(node, f.path),
          });
          break;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
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

/** `agent-runner.ts:1488` map 演示那句「原文可从附件目录回取」：那一支调用真写了附件吗。 */
function hopMapDemo(): Verdict {
  const events: AgentEvent[] = [];
  for (let r = 0; r < 6; r++) {
    events.push({ type: "user_message", content: "round " + String(r) } as AgentEvent);
    events.push({ type: "tool_call", id: "c" + String(r), name: "read_file", args: { path: "a.ts" } } as AgentEvent);
    events.push({ type: "tool_result", callId: "c" + String(r), ok: true, output: "R".repeat(100 * 1024) } as AgentEvent);
  }
  // 与那个调用点**同一实参形状**：只给 events，不给 attachmentsDir/sessionId（源码那一行逐字如此）。
  const pruned = computePrune({ events });
  const wrote = pruned.attachments.length;
  const saidSaved = pruned.why === "saved";
  return {
    ok: !(saidSaved && wrote === 0),
    how: "computePrune（照那个调用点的实参形状跑一遍）",
    detail:
      `why=${pruned.why} 附件写出=${String(wrote)} 条｜替换文本里的附件路径=${pruned.replacements.size > 0 && String([...pruned.replacements.values()][0]).includes("原文已存") ? "有" : "无"}` +
      ` ⇒ 那句「原文可从附件目录回取」在此刻${saidSaved && wrote === 0 ? "**为假**（既没落盘也没给地址）" : "成立"}`,
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
};

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
    const next: Promise<Verdict> =
      name === "hopSkill" ? hopSkill(workspace)
        : name === "hopJoinPayload" ? Promise.resolve(hopJoinPayload())
          : name === "hopMapDemo" ? Promise.resolve(hopMapDemo())
            : name === "hopLedgerRecall" ? hopLedgerRecall()
              : name === "hopSolpiReceipt" ? hopSolpiReceipt()
                : Promise.resolve(hopPruneStub());
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
