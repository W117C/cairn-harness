// M6 · 跨会话教训：从失败轨迹提炼「下次别这么做」，每条必须带证据指针。
//
// 与既有 `distill.ts` 的分工（那一支不删）：
//   distill.ts 的 `failureDigestFromEvents` 是**计数**摘要，喂给模型自由总结——没有 callId、没有会话，
//   也没有"不许凭空总结"的闸。它擅长「把失败摆到模型眼前」，不擅长「把结论钉死」。
//   本模块是它的**确定性对位**：同样的失败，改由纯函数提炼成固定形状的条目，每条都指回
//   原始事件的会话与 callId。路线图 M6 的硬要求就是这一条：**无证据不产出**。
//
// 为什么不并进 distill.ts：那支的产物是给模型看的提示词；本支的产物是**写进项目记忆的条目**
// （下一轮才回注）。两个消费者、两种形状、两种生命周期，合并只会让提示词里长出结构化字段。

import { basename } from "node:path";
import { isEnvVerifyCause, type AgentEvent, type ToolCallEvent, type ToolResultEvent, type VerifyResultEvent } from "../../events";
import { mayHaveWrittenDisk } from "../write-face";

/** 一条证据指针：这条教训是从哪次失败来的。**没有它就不出条目**（见 distillLessons 的硬门）。 */
export interface LessonEvidence {
  /** 会话 id = 日志文件名去扩展名（事件里**不带**会话 id，唯一的出处是落盘文件名）。 */
  session: string;
  callId: string;
  kind: LessonKind;
}

export type LessonKind = "verify-red" | "tool-streak" | "repeat-action";

export interface Lesson {
  /** 文件名（写入 `<project>/.agent/memory/<topic>.md`）；含序号，稳定可覆盖。 */
  topic: string;
  body: string;
  evidence: LessonEvidence[];
}

/** 同一工具连败几拍才算"教训"（1 次失败是偶发，2 次才是模式——与 loop 的 stuck 阈值同档思路）。 */
export const TOOL_STREAK_MIN = 2;
/** 同一 (工具, 参数) 重复出现几次才算"重复动作"。 */
export const REPEAT_ACTION_MIN = 2;
/** 正文里摘录原文的字节上限（记忆会被回注，摘录太长就把预算吃光）。 */
const EXCERPT_LIMIT = 400;

/** 验证拍的工具名。`tool_result` 事件不带工具名（只有 callId），verify 这一路是例外：
 *  `loop.ts` 的 verify 拍是 harness 自己发的反射，没有配套 `tool_call` 事件，
 *  所以下面查表查不到 —— 这一串是代码里唯一的那个名字，不另造一份表（避免"第二个事实源"）。 */
export const VERIFY_TOOL_NAME = "verify";

/** 从会话日志路径取会话 id：文件名去扩展名。
 *  事件里没有 session 字段（只有 `agent_id`，那是 worker 归属、不是会话）⇒ 这一步是"证据指针"里
 *  "哪条会话"的**唯一**来源，取不到就退化成空串，而空串会让下面那道硬门把整条教训丢掉。
 *
 *  末尾分隔符视作目录 ⇒ 返回空（`basename("/logs/")` 给的是目录名 `"logs"`，那不是会话 id；
 *  把它当会话就等于凭空编出一个"来自会话 logs 的教训"——正是本模块要禁的那件事）。 */
export function sessionOf(logPath: string): string {
  // 判末尾分隔符要看**入参**：`basename("/logs/")` 已经把斜杠吃掉了，返回的是目录名 `"logs"`。
  if (logPath.endsWith("/") || logPath.endsWith("\\")) return "";
  const base = basename(logPath);
  if (base === "" || base === "." || base === "..") return "";
  return base.replace(/\.jsonl$/u, "");
}

/** 从原文里取一段有界的摘录：头尾都留（失败结论常在最后一行），中间用省略号接上。 */
export function excerpt(text: string, limit = EXCERPT_LIMIT): string {
  const t = text.trimEnd();
  if (t.length <= limit) return t;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  return t.slice(0, head) + "\n…（中略 " + String(t.length - limit) + " 字符）…\n" + t.slice(t.length - tail);
}

const KIND_LABEL: Readonly<Record<LessonKind, string>> = {
  "verify-red": "验证红",
  "tool-streak": "工具连败",
  "repeat-action": "重复同一动作",
};

/** 教训 topic 的固定前缀：注入侧靠它认出哪些条目是教训（frontmatter 只有 type，
 *  而 type=feedback 的条目也可能是别的来源沉淀的——按前缀认，来源才唯一）。 */
export const LESSON_TOPIC_PREFIX = "lesson-";

/** `evidence-line:` 是**机器可解析**的唯一出处（注入侧从磁盘读回时按同一锚点解析）。
 *  用锚定行首而不是分隔符切，是本仓一贯口径（judging 纪律：判据锚定，避免误伤正文里的同名字样）。 */
export const EVIDENCE_LINE_PREFIX = "evidence-line:";
export const SESSION_LINE_PREFIX = "session-line:";

function bodyFor(headline: string, excerpts: string[], evidence: LessonEvidence[], session: string): string {
  const lines: string[] = [
    // 首行是被 store.indexLine 取去当摘要的那行 ⇒ 抬头必须在最前。
    headline,
    SESSION_LINE_PREFIX + session,
  ];
  for (const e of excerpts) lines.push("```", e, "```");
  // 证据指针逐条列名：回注时模型看到的是「这条凭什么这么说」，不是一句无从追溯的断言。
  // 这一行是**整条教训成立的前提**（无它就不产出），因此放最后一行的位置也固定。
  lines.push(
    EVIDENCE_LINE_PREFIX + evidence
      .map((ev) => "[" + KIND_LABEL[ev.kind] + "] " + ev.session + "#" + ev.callId)
      .join(" / "),
  );
  return lines.join("\n") + "\n";
}

/** 提炼教训（纯函数、零 IO）。
 *
 *  **硬门：造不出证据指针就不产出条目。** 这不是事后过滤——三类来源每一条都先把证据指针造出来，
 *  指针造不出（callId 缺失/空）的候选直接不进列表，所以"无证据"与"无条目"是同一条路径。
 *  路线图 M6 的反向验证就是摘掉这道门 ⇒ 对应判卷必须变红。
 *
 *  `session` 取自 logPath 文件名；**session 为空 ⇒ 全部条目作废**（证据指针要求指得出是哪条会话）。 */
export function distillLessons(events: AgentEvent[], logPath: string): Lesson[] {
  const session = sessionOf(logPath);
  if (session === "") return [];

  const out: Lesson[] = [];

  // 先扫一遍 tool_call 建 callId→工具名 的表：`tool_result` 事件**不带工具名**（只有 callId），
  // 不建这张表就分不出「哪个工具连败」，只能把每一条都记成 unknown——那就不是教训，是噪音。
  const callName = new Map<string, string>();
  for (const e of events) {
    if (e.type === "tool_call" && typeof e.id === "string" && e.id !== "") callName.set(e.id, e.name);
  }
  /** 归 verify 那一路的 callId（含绿拍与环境红拍，见下面那处说明），不进来源②③。 */
  const verifyCallIds = new Set<string>();
  // verify 拍的 callId 回灌：verify_result 与它那几声 tool_result 是同一拍，共享一个 callId。
  // 不回灌的话，「verify 那一路」就认不出它们，**一次验证红会被数成两次工具失败**。
  // 注意两处都收：**绿拍与环境红拍也要收**——它们虽不成条目①，那几声 tool_result 回声照样存在，
  // 只收「成条目的那几拍」的话，环境红就会被来源②重新捞回来变成一条假的教训。
  for (const e of events) {
    if (e.type === "verify_result" && typeof e.callId === "string" && e.callId !== "") {
      callName.set(e.callId, VERIFY_TOOL_NAME);
      // 无论这一拍成不成为条目①，它的那几声 tool_result 回声都归 verify 那一路，不进来源②。
      verifyCallIds.add(e.callId);
    }
  }

  // ---- 来源①：验证红（**环境红不进**）----
  // 环境红（工具链缺失/超时/无面/包管理器拒/钩子抛错）归因是 harness 侧的，不是"这个项目/这个做法会失败"。
  // 与 distill.ts 的既有裁决同一条线：那些该沉淀成「这套环境缺什么」，不是「下次别这么做」。
  const verifyReds: VerifyResultEvent[] = [];
  for (const e of events) {
    if (e.type !== "verify_result" || e.ok) continue;
    if (isEnvVerifyCause(e.cause)) continue;
    verifyReds.push(e);
  }
  for (const [i, v] of verifyReds.entries()) {
    if (typeof v.callId !== "string" || v.callId === "") continue; // 证据指针缺 callId ⇒ 不产出
    const evidence: LessonEvidence[] = [{ session, callId: v.callId, kind: "verify-red" }];
    const failed = v.results.filter((r) => !r.ok);
    const cmds = failed.map((r) => r.command).join("、");
    const headline = "验证第 " + String(v.attempt) + "/" + String(v.maxAttempts) + " 拍红"
      + "（" + (cmds === "" ? "命令未知" : cmds) + "）——先看失败原文再动手";
    out.push({
      topic: "lesson-verify-red-" + String(i + 1),
      body: bodyFor(headline, failed.map((r) => excerpt(r.output)).slice(0, 2), evidence, session),
      evidence,
    });
  }

  // ---- 来源②：同一工具连败 ≥ TOOL_STREAK_MIN 次 ----
  const failsByTool = new Map<string, { callIds: string[]; outs: string[] }>();
  for (const e of events as ToolResultEvent[]) {
    if (e.type !== "tool_result" || e.ok) continue;
    if (typeof e.callId !== "string" || e.callId === "") continue;
    // verify 自己那几声 tool_result 回声不算"工具失败"：它就是上面①那条拍的回注，同一个 callId
    // 会被数多次，把一次验证红说成"verify 连败三次"。blockedBy 也排除（压根没执行的失败
    // 与执行后失败不是同一件事）。两条都是**同一路过滤**，不是事后补救。
    if (verifyCallIds.has(e.callId)) continue;
    if (e.blockedBy !== undefined) continue;
    const name = callName.get(e.callId);
    if (name === undefined) continue; // 无归属的 tool_result ⇒ 无证据指针 ⇒ 不产出
    const g = failsByTool.get(name) ?? { callIds: [], outs: [] };
    g.callIds.push(e.callId);
    if (g.outs.length < 2) g.outs.push(excerpt(e.output));
    failsByTool.set(name, g);
  }
  for (const [name, g] of [...failsByTool.entries()].sort((a, b) => b[1].callIds.length - a[1].callIds.length)) {
    if (g.callIds.length < TOOL_STREAK_MIN) continue;
    const evidence: LessonEvidence[] = g.callIds.map((c) => ({ session, callId: c, kind: "tool-streak" }));
    out.push({
      topic: "lesson-tool-streak-" + name,
      body: bodyFor(
        "「" + name + "」连败 " + String(g.callIds.length) + " 次——同一手法连续失败，先换做法再重试",
        g.outs, evidence, session),
      evidence,
    });
  }

  // ---- 来源③：同一 (工具, 参数) 重复调用 ≥ REPEAT_ACTION_MIN 次 ----
  // 只看**工具名+参数逐字相同**的那些；换个参数不算（那是正常推进，见 tool-choice.test.ts 的同档判断）。
  //
  // 为什么**只要写向工具**（实测 2026-10-01，不是拍的）：对 tracked 的 20 份日志跑离线提炼，
  // 40 条教训里 35 条来自这一源，逐条打开看**全是 `read_file` 读同一个文件**——re-read 是
  // 「确认改动真的写进去了」的正常动作（verify.ts 的重复提示里就写着让模型这么干）。
  // 把它们写成教训，等于每轮回注都在教「别再读文件了」：纯噪音，还会挤掉真教训的预算。
  // 写向同一动作逐字重复才是真信号——同样参数写两次 = 上一次没生效，再重试是没有出路的。
  // 写向判定复用 `mayHaveWrittenDisk`（本仓唯一那一份、多处消费），不另抄一张工具表。
  const calls = events.filter((e): e is ToolCallEvent => e.type === "tool_call" && typeof e.id === "string" && e.id !== "" && !verifyCallIds.has(e.id));
  const bySig = new Map<string, { name: string; ids: string[] }>();
  for (const c of calls) {
    if (!mayHaveWrittenDisk(c.name, (c.args ?? {}) as Record<string, unknown>)) continue;
    // 分隔符用**转义**写，不写裸 NUL 字节（2026-10-02 实测的后果）：裸 0x00 会让 `file` 把本文件
    // 判成 data、**ripgrep 整份跳过** ⇒ harness 自己的 grep 工具（`src/tools/grep.ts` 走 rg）就
    // 搜不到这个文件的内容（`rg "const sig = c\.name" src/` 报 No matches，而它就在下行）。
    // 语义一字不变：`\u0000` 与裸字节是同一个字符。
    const sig = c.name + "\u0000" + JSON.stringify(c.args);
    const g = bySig.get(sig) ?? { name: c.name, ids: [] };
    g.ids.push(c.id);
    bySig.set(sig, g);
  }
  const repeats = [...bySig.values()].filter((g) => g.ids.length >= REPEAT_ACTION_MIN);
  repeats.sort((a, b) => b.ids.length - a.ids.length);
  for (const [i, g] of repeats.entries()) {
    const evidence: LessonEvidence[] = g.ids.map((c) => ({ session, callId: c, kind: "repeat-action" }));
    out.push({
      topic: "lesson-repeat-action-" + String(i + 1),
      body: bodyFor(
        "「" + g.name + "」用**完全相同的参数**调了 " + String(g.ids.length)
        + " 次——同样的输入同样的结果，确认它能推进再调第三次",
        [], evidence, session),
      evidence,
    });
  }

  return out;
}

/** 一条已落盘教训的抬头与出处（注入侧只读这两样，不读原文摘录）。
 *
 *  **出处是从盘上正文解析回来的，不是写的时候另传一份**——另传就得存两份真相，
 *  迟早对不上；这里锚 `^evidence-line:`（行首）解析，指针不落在正文里就**读不出这一条**，
 *  于是「无出处 ⇒ 不注入」与「无出处 ⇒ 不写盘」是同一道门在两侧的表现。 */
export interface LessonDigest {
  headline: string;
  evidence: string;
  session: string;
}

export function parseLessonDigest(body: string): LessonDigest | null {
  const ev = new RegExp("^" + EVIDENCE_LINE_PREFIX + "(.*)$", "mu").exec(body);
  if (ev === null) return null; // 无证据指针 ⇒ 这条不合格，注入侧直接不收
  const evidence = (ev[1] ?? "").trim();
  // 指针**在而行内为空**（手写/半截落盘的 `evidence-line:`）同样是"无出处"。
  // 从前这一支只按"有没有那行"判，空串会带着 `evidence: ""` 往下走，直到 `lessonLine` 抛——
  // 而三个生产调用点都把注入异常**静默吞掉**，后果不是"这一条不注入"，是整段 LESSONS（含同批合格条目）消失。
  // 不合格的形状在这道**共用门**里一次判掉，注入侧的 `continue` 才真的等于"无出处不收"。
  if (evidence === "") return null;
  const se = new RegExp("^" + SESSION_LINE_PREFIX + "(.*)$", "mu").exec(body);
  const headline = (body.split("\n")[0] ?? "").trim();
  if (headline === "") return null;
  return { headline, evidence, session: (se?.[1] ?? "").trim() };
}

/** 回注用的一行：抬头 + **出处**，出处必须逐字可见（"这条凭什么这么说"是 M6 的硬要求，
 *  不是可选的礼貌话）。出处缺失 ⇒ 抛（调用方按"不合格条目"处理），不做静默降级。 */
export function lessonLine(topic: string, d: LessonDigest): string {
  if (d.evidence === "") throw new Error("lesson " + topic + " 没有证据指针，不可注入");
  return "- " + d.headline + "　〔证据: " + d.evidence + "〕";
}

/** 一条 lesson 落盘时的 frontmatter 类型：feedback（四类型里唯一对应"纠正"的那一类）。 */
export const LESSON_MEMORY_TYPE = "feedback" as const;