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
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { trackedScriptFiles } from "./lib/scan-scope.js";
import { discoverPlugins } from "../src/agent/plugins/discover.js";
import { expandSkillInvocation, skillInvokeName } from "../src/agent/plugins/skills.js";
import { computePrune } from "../src/agent/prune.js";
import { projectContext } from "../src/agent/context.js";
import { renderJoinPayload, shapeJoinRows } from "../src/agent/orchestrator-join.js";
import { INJECTED_TOOLS } from "../src/agent/tool-surface.js";
import { read_file } from "../src/tools/read_file.js";
import type { AgentEvent } from "../src/events/index.js";
import type { ToolContext } from "../src/tools/base.js";

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
export function scanPromiseSites(files: readonly { path: string; text: string }[]): PromiseSite[] {
  const out: PromiseSite[] = [];
  for (const f of files) {
    const sf = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      const text = literalText(node);
      if (text !== null) {
        for (const mark of PROMISE_MARKS) {
          if (text.includes(mark)) {
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
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

const siteKey = (s: { file: string; fn: string }): string => s.file + "#" + s.fn;

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

    const givenFor = (e: NonNullable<typeof userEntry>): string =>
      pathIn(expandSkillInvocation([e], skillInvokeName(e)).text.slice(-300));
    const userGiven = givenFor(userEntry);
    const projGiven = givenFor(projEntry);
    if (userGiven === "" || projGiven === "") {
      return {
        ok: false,
        how: "expandSkillInvocation",
        detail: `尾注没出来（用户级/项目级各触发一次）⇒ 触发形状不对（探针红）：user=${String(userGiven.length)} proj=${String(projGiven.length)}`,
      };
    }

    const asWrittenUser = await hopWithReadFile(workspace, userGiven);
    const asWrittenProj = await hopWithReadFile(workspace, projGiven);
    const relProj = await hopWithReadFile(workspace, relative(workspace, projGiven));
    return {
      // 判定只看"照那句做得到吗"；两案的分界留给修法（不给那道信任边界添例外）
      ok: asWrittenProj.reached,
      how: "discoverPlugins（产品取 path 那一句）→ expandSkillInvocation（产品拼尾注那一句）→ 真 read_file",
      detail:
        `交给模型的地址是绝对路径：${userGiven.startsWith("/") && projGiven.startsWith("/") ? "两案皆是" : "否"}` +
        `｜项目级插件（文件就在工作区内）照原文递 read_file：${asWrittenProj.reached ? "读得到" : "读不到"}` +
        `（${asWrittenProj.why.slice(0, 80)}）` +
        `｜同一支改按工作区相对写法：${relProj.reached ? "读得到" : "读不到"}` +
        `｜用户级插件（在工作区外）照原文：${asWrittenUser.reached ? "读得到" : "读不到"}` +
        ` ⇒ 绝对路径这一层对**两案都拒**；相对写法只救得了项目级那一案`,
    };
  } finally {
    await rm(userRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/** `context.ts` 的「全文见事件流」：那句里有没有地址 + 有没有任何一把工具读得到事件流。 */
async function hopEventStream(workspace: string, logPath: string): Promise<Verdict> {
  const events = [
    { type: "user_message", content: "第一轮" },
    { type: "verify_result", auto: true, ok: false, results: [{ command: "pnpm test", ok: false, exitCode: 1, tail: "boom " + "x".repeat(200) }] },
    { type: "verify_result", auto: true, ok: false, results: [{ command: "pnpm test", ok: false, exitCode: 1, tail: "boom2 " + "y".repeat(200) }] },
  ] as unknown as AgentEvent[];
  const note = projectContext(events).find((m) => typeof m.content === "string" && m.content.includes("见事件流"));
  const body = typeof note?.content === "string" ? note.content : "";
  if (body === "") return { ok: false, how: "projectContext", detail: "那句没出现 ⇒ 触发形状不对（探针红，不是产品干净）" };
  const given = pathIn(body);
  const hop = await hopWithReadFile(workspace, given);
  return {
    ok: given !== "" && hop.reached,
    how: "projectContext（产品真注入那条 user 消息）→ 真 read_file",
    detail:
      `那句给的地址=${given === "" ? "无（只说「事件流」三个字）" : given}｜事件流真身=${logPath}` +
      `｜模型侧能读事件流的工具=0 把（七把碰文件的工具全走 resolveInWorkspace，绝对路径第一句即拒）` +
      `｜照原文递 read_file：${hop.reached ? "读得到" : "读不到"}（${hop.why}）`,
  };
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

/** 每个模型可见面的判定归属：键 = `<file>#<fn>`。**加一面就必须在这里登记一条**，否则本探针红。 */
export const RUNNERS: Readonly<Record<string, string>> = {
  "src/agent/plugins/index.ts#triggerSkill": "hopSkill",
  "src/agent/plugins/skills.ts#expandSkillInvocation": "hopSkill",
  "src/agent/context.ts#head": "hopEventStream",
  "src/agent/orchestrator-join.ts#renderJoinPayload": "hopJoinPayload",
  "src/agent/prune.ts#stub": "hopPruneStub",
  "src/main/agent-runner.ts#body": "hopMapDemo",
};

function loadSrcFiles(): { files: { path: string; text: string }[]; missingOnDisk: string[] } {
  const tracked = trackedScriptFiles(ROOT, "src") ?? [];
  const files: { path: string; text: string }[] = [];
  const missingOnDisk: string[] = [];
  for (const p of tracked) {
    // 「git 跟踪」与「盘上有这个文件」在桌面层迁移在飞时不是一件事（实测 src/main/index.ts 已删未提交）。
    // 少读一支不等于扫过了 ⇒ 缺席清单出声（规则 92 同族）。
    if (!existsSync(join(ROOT, p))) {
      missingOnDisk.push(p);
      continue;
    }
    files.push({ path: p, text: readFileSync(join(ROOT, p), "utf8") });
  }
  return { files, missingOnDisk };
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
  const exemptSites = sites.filter((s) => s.audience !== "model");
  for (const s of exemptSites) {
    const why = s.audience === "operator" ? "运维面（console.* 实参位）" : "UI 面（落在 UI_ROOTS＝给人看的桌面层）";
    console.log(`  ⚪ ${why}，不欠模型最后一跳，但仍进清单 ${s.file}:${String(s.line)} [${s.fn}]「${s.text}」`);
  }

  const workspace = await mkdtemp(join(tmpdir(), "promise-recall-ws-"));
  const logDir = await mkdtemp(join(tmpdir(), "promise-recall-logs-"));
  const logPath = join(logDir, "session.events.jsonl");
  await writeFile(logPath, "", "utf8");
  await writeFile(join(workspace, "target.ts"), "export const x = 1;\n", "utf8");

  const verdictCache = new Map<string, Promise<Verdict>>();
  const runOnce = (name: string): Promise<Verdict> => {
    const hit = verdictCache.get(name);
    if (hit) return hit;
    const next: Promise<Verdict> =
      name === "hopSkill" ? hopSkill(workspace)
        : name === "hopEventStream" ? hopEventStream(workspace, logPath)
          : name === "hopJoinPayload" ? Promise.resolve(hopJoinPayload())
            : name === "hopMapDemo" ? Promise.resolve(hopMapDemo())
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
    for (const [key, group] of grouped) {
      for (const s of group) console.log(`  面 ${s.file}:${String(s.line)} [${s.fn}]「${s.text}」`);
      const runner = RUNNERS[key];
      if (runner === undefined) {
        line("❌", `${key} 没有判定归属 ⇒ 新加一句「全文见 X」就必须给一次可达性判定（在 RUNNERS 里登记并写清怎么量的）`);
        continue;
      }
      const v = await runOnce(runner);
      line(v.ok ? "✅" : "❌", `${key} ⇒ ${v.detail}`);
      console.log(`      量法：${v.how}`);
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
    await rm(logDir, { recursive: true, force: true });
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
