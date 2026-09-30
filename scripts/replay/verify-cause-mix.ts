// 复跑面 · 登记项 `replay:verify-cause-mix`（判卷读数：**一次失败**里有多少**今天能被机器归因**）
//
// 一把尺、两个面（同族同格，不另开第二把）：
//   ⑴ verify 面 = `verify_result` 事件里的红命令；
//   ⑵ exec 面 = shell 家族（`run_shell` / `shell_ro` / `shell_rw`）在事件流里的红拍。
// 立第二个面的理由不是"顺手"：#24 把 `exitCode`/`timedOut` 接进 `tool_result` 之后，"这条红是不是
// 模型写的代码错了"第一次有了**结构**证人——而结构证人只有在真会话跑过之后才量得出比例。
// 这一面就是那把等在现场的尺：现在跑，它印"读不到"并说清为什么读不到；真会话一来，同一行变成占比。
//
// 这条读数服务 judgment-layer §9「第 0 步：verify 归因」与 gap-fix P1-3：
// 环境红（工具链没装 / 超时 / 根本没有可验面 / 钩子自己炸）今天在事件里与"模型写的代码错了"
// **长得一模一样**，于是它同时做三件错事：烧掉模型的 verify 额度、按档位阶梯升级模型（多花钱）、
// 进沉淀被当成"这个模型在这里会失败"。要判断这事值不值得修，先得有**分母**：
// 语料里到底几条红、其中几条今天光靠字段就能判出是环境红。
//
// 口径分两栏，且**只有左栏是产品将来能用的机制**（judgment-layer §9.1 定案：纯结构、零文案匹配）：
//   结构栏 = 只看落盘字段（verify：command / ok / exitCode / cause；exec：exitCode / timedOut）。
//   文案栏 = 人眼现在能从 output 里读出来的线索（`[exit code: 127]`、超时那句、`(none)`、"钩子异常"）——
//            它是**证据**不是**判据**：跨域串（如 "Cannot find module"）已实测不可分类，见 §9.1。
//            两栏都**只认行首**（规则 264：被度量者自己的正文是第二个注入面）。
import { readJsonl, scanCorpus, callNameIndex, envTextRe, firstEnvTextCue, NO_SURFACE_COMMAND, zeroCorpusProblem } from "./corpus";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SHELL_FAMILY } from "../../src/permissions/risk";
import { classifyVerifyFailure, PKG_MANAGER_OWN_ERROR_LINE } from "../../src/agent/verify";
import { isEnvVerifyCause, type VerifyCause } from "../../src/events";

/** 「带 cause 的红命令 = 0」有两种**相反**的解释：语料比归因落盘还老（数据年龄），
 *  或归因路径根本没落地（缺陷）。旧读数只印一个 0，读者会挑一个信（本仓规则 119：全称否定
 *  要连着前提一起记）。⇒ 把前提本身量出来：语料里最新一条事件的时间 vs `cause` 落盘的提交日期。 */
export function causeShipDate(root: string): { sha: string; ms: number } {
  try {
    const out = execFileSync("git",
      ["log", "-1", "--format=%h%x09%ct", "-S", "cause === undefined ? {} : { cause }", "--", "src/agent/loop.ts"],
      { cwd: root, encoding: "utf8" }).trim();
    const [sha, ct] = out.split("\t");
    if (!sha || !ct) return { sha: "", ms: 0 };
    return { sha, ms: Number(ct) * 1000 };
  } catch {
    return { sha: "", ms: 0 }; // 读不到 ⇒ 下面按"没尺"报，绝不静默当成"年龄解释成立"
  }
}

export type DatingState = "attributed" | "older-than-ship" | "newer-but-unattributed" | "unmeasurable";

/** `noun` = 这一面的字段名（默认 "cause" 保住 verify 面那四句话逐字不变）。
 *  两面共用的是**判定形状**，不是"cause 落盘"那句措辞——写死会让 exec 面印出一句不指任何东西的话。 */
export function datingVerdict(
  withCauseField: number, maxEventMs: number, ship: { sha: string; ms: number }, redResults: number,
  noun = "cause",
): { state: DatingState; reason: string } {
  if (withCauseField > 0) return { state: "attributed", reason: `归因已被观测到（带 ${noun} 的红命令 > 0）` };
  if (redResults === 0) return { state: "unmeasurable", reason: "语料里没有红样本 ⇒ 这一面无从判定，不报 0 也不报失效" };
  if (ship.ms === 0) return { state: "unmeasurable", reason: `查不到 ${noun} 落盘的提交（git 读失败）⇒ 年龄这一前提没被量过，不许拿它解释 0` };
  if (maxEventMs < ship.ms) {
    return {
      state: "older-than-ship",
      reason: `语料最新事件早于 ${noun} 落盘（${ship.sha}）⇒ 这个 0 是**数据年龄**，不是归因失效`,
    };
  }
  return {
    state: "newer-but-unattributed",
    reason: `有比 ${ship.sha} 更新的流，却仍没有一条红带 ${noun} ⇒ **归因路径没落地**，这才是要修的那格`,
  };
}

interface VerifyResultEvent {
  type: string;
  ok?: boolean;
  auto?: boolean;
  ts?: number;
  results?: { command: string; ok: boolean; output?: string; exitCode?: number; cause?: string }[];
}

/** 结构栏：今天（无 `cause`、无 `exitCode`）能判出的只有两类——它们靠**形状**而非文字。 */
function structuralKind(r: { command: string; output?: string }): string {
  if (r.command === NO_SURFACE_COMMAND) return "no-surface"; // 哨兵命令名，verify.ts 里就是它
  return "unknown"; // 其余（timeout / toolchain-missing / code）今天全在 output 文案里
}

/** 文案栏：人眼线索，仅供量"有多少红其实一眼能看出不是代码错"。
 *  线索表在取料层（`ENV_TEXT_CUES`）——同一份判据不许在这里再抄一遍，`cascade-traffic` 吃的是同一只
 *  （第 222 页 #44：从前两面各抄一份、都是无锚 `includes`，而 exec 面已改行首锚定＝第十三族）。 */
export function textualKind(r: { command: string; output?: string }): string {
  if (r.command === NO_SURFACE_COMMAND) return "no-surface";
  return firstEnvTextCue(r.output ?? "") ?? "code-or-unknown";
}

const bump = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) ?? 0) + 1); };
const show = (m: Map<string, number>): string =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ":" + String(v)).join(" ");

/* ───────────────────────────────── exec 面（shell 家族的红拍）────────────────────────────────── */

interface ExecEvent {
  type: string;
  callId?: string;
  ok?: boolean;
  output?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  /** 六道「执行前就拦下」的硬闸留的那一列（第 225 页 #40）；缺席＝这一笔走到了执行面。 */
  blockedBy?: string;
}

/** 「有正证」的四类：都由字段**明说**过，不是"别都不是所以猜它是"。
 *  第 221 页（#39）之后 `not-run` 也进了这一列——它以前是本尺比谓词多出来的一格（双向钉的那条用例当场红了），
 *  现在产品谓词自己认这一态 ⇒ 两边同形，尺退回"只是读者"（规则 302 的收敛那一半）。 */
export const EXEC_ATTRIBUTABLE: readonly string[] = ["timeout", "toolchain-missing", "pkg-manager", "code", "not-run"];

/** 结构栏：两只字段齐了才准过产品那一只谓词；不齐就**报不齐**，绝不折成 "code"。
 *  第 217 页这里曾多印一格 `no-exit-code`（`exitCode:null + timedOut:false` 在旧谓词里落到缺省 `"code"`，
 *  而它实际是"取消／被信号杀"）；#39 把那一态补进谓词后，本尺不再自己判，直接跟着 `classifyVerifyFailure` 走。 */
export function execStructKind(e: { exitCode?: number | null; timedOut?: boolean; output?: string }): string {
  const hasCode = e.exitCode !== undefined;
  const hasTimeout = e.timedOut !== undefined;
  if (!hasCode && !hasTimeout) return "no-structure";
  if (hasCode !== hasTimeout) return "half-structure"; // 落盘面成对写；只剩一只 = 装配漂了
  return classifyVerifyFailure({ timedOut: e.timedOut === true, exitCode: e.exitCode ?? null, output: e.output ?? "" });
}

/** 只有**行首**才算：这几句都由 harness 自己拼在换行之后；被跑的命令再怎么说同样的话，也不算它发生过。
 *  三条不是本面独有的（超时／127／包管理器那三句在 verify 面与产品谓词里本来就有）⇒ 从那一处取，不在这再写一遍
 *  正则；`env-cue-single-source` 那把普查尺钉的就是「整族只有一份」。 */
const T_DENIED_BY_GATE = /^\[permission denied\]/m;
const T_DENIED_BY_READONLY = /^\[read-only\] 只读 bash 静态过滤拒绝/m;
const T_CANCELLED = /^\[error: \S+ 随会话取消终止\]/m;
const T_TIMEOUT = envTextRe("timeout");
const T_EXIT_NULL = /^\[exit code: null\]/m;
const T_EXIT_127 = envTextRe("toolchain-missing");
const T_SPAWN_ERROR = /^run_shell: /m;
const T_PKG = PKG_MANAGER_OWN_ERROR_LINE;

/** 文案栏：exec 面今天**唯一**看得见"这不是代码失败"的地方（取消／被拒／spawn 炸都只有这一栏有证人）。 */
export function execTextKind(output: string): string {
  if (T_DENIED_BY_GATE.test(output)) return "denied-by-gate";
  if (T_DENIED_BY_READONLY.test(output)) return "denied-by-readonly-filter";
  if (T_TIMEOUT.test(output)) return "timeout";
  if (T_CANCELLED.test(output)) return "cancelled";
  if (T_SPAWN_ERROR.test(output)) return "spawn-error";
  if (T_EXIT_127.test(output)) return "toolchain-missing";
  if (T_EXIT_NULL.test(output)) return "killed-no-exit-code";
  if (T_PKG.test(output)) return "pkg-manager";
  return "code-or-unknown";
}

export interface ExecMix {
  /** shell 家族 tool_result 总数（分母的红拍另记）。 */
  shellBeats: number;
  /** 按工具名分（挂现状：名单来自 `SHELL_FAMILY`，不在此另抄）。 */
  byTool: Map<string, number>;
  /** shell 家族全部红拍（占比的分母）。 */
  shellRed: number;
  /** 与 gate-outcomes 同一条纪律：join 不上 tool_call 的 result 单独计数，不当没有。 */
  unmatched: number;
  /** 结构字段（任一）在场的红拍数——年龄判定的分子。 */
  withStructure: number;
  /** 红拍里「从未 exec」的计数，两只分母不同（规则 262：并列印就要说口径）：
   *  `blockedShellNoStruct` 只数 shell 家族且无结构字段的那批——下面 ⚠️ 那格的成因② 就是它；
   *  `blockedAll` 数全部工具的红拍（被拦的 write_file 在本面家族过滤之外）。 */
  blockedShellNoStruct: number;
  blockedAll: number;
  blockedMix: Map<string, number>;
  struct: Map<string, number>;
  text: Map<string, number>;
  attributable: number;
  environmental: number;
}

/** 纯函数：吃原始事件对象，吐 exec 面交叉表。判卷走这一只，`main()` 只负责打印。 */
export function execMixOf(raws: readonly unknown[]): ExecMix {
  const nameByCall = callNameIndex(raws);
  const t: ExecMix = {
    shellBeats: 0, byTool: new Map<string, number>(), shellRed: 0, unmatched: 0, withStructure: 0,
    blockedShellNoStruct: 0, blockedAll: 0, blockedMix: new Map<string, number>(),
    struct: new Map<string, number>(), text: new Map<string, number>(),
    attributable: 0, environmental: 0,
  };
  for (const raw of raws) {
    const e = raw as ExecEvent;
    if (e.type !== "tool_result" || typeof e.callId !== "string") continue;
    // 「没走到 exec」从今天起是一列，不是一句推断：先在家族过滤之前数，才看得见被拦的非 shell 调用。
    if (typeof e.blockedBy === "string") {
      t.blockedAll++;
      bump(t.blockedMix, e.blockedBy);
    }
    const tool = nameByCall.get(e.callId);
    if (tool === undefined) {
      t.unmatched++; // 含 harness 自己注入的那几拍（diff / worktree 清理 / worker 回传）：不是 shell 红，但也不许丢
      continue;
    }
    if (!SHELL_FAMILY.has(tool)) continue;
    t.shellBeats++;
    bump(t.byTool, tool);
    if (e.ok !== false) continue;
    t.shellRed++;
    if (e.exitCode !== undefined || e.timedOut !== undefined) t.withStructure++;
    // 下面 ⚠️ 那格的成因② 从此有数：既没有结构字段、又明写着「被哪道闸拦」的那批，不必再靠猜。
    if (typeof e.blockedBy === "string" && e.exitCode === undefined && e.timedOut === undefined) t.blockedShellNoStruct++;
    const s = execStructKind(e);
    bump(t.struct, s);
    bump(t.text, execTextKind(e.output ?? ""));
    if (EXEC_ATTRIBUTABLE.includes(s)) t.attributable++;
    // 「不是模型的错」这一格不自己列表：吃产品那只谓词（第十三族——同一判据抄两份就会各漂宽度）
    if (isEnvVerifyCause(s as VerifyCause)) t.environmental++;
  }
  return t;
}

/** 结构字段落到**盘面**的提交（不是谓词落盘，也不是工具自己盖的章——下游读者吃的是盘面）。 */
export function execFieldShipDate(root: string): { sha: string; ms: number } {
  try {
    const out = execFileSync("git",
      ["log", "-1", "--format=%h%x09%ct", "-S", "result.exitCode !== undefined", "--", "src/agent/loop.ts"],
      { cwd: root, encoding: "utf8" }).trim();
    const [sha, ct] = out.split("\t");
    if (!sha || !ct) return { sha: "", ms: 0 };
    return { sha, ms: Number(ct) * 1000 };
  } catch {
    return { sha: "", ms: 0 };
  }
}

/* ─────────────────────────────────────────── 打印 ─────────────────────────────────────────── */

/** 语料年龄：跨**全部**事件取最大 `ts`（`tool_result` 自己不带 ts，只看红拍会恒为 0）。 */
function corpusAge(raws: readonly unknown[]): number {
  let maxTs = 0;
  for (const raw of raws) {
    const ts = (raw as { ts?: number }).ts;
    if (typeof ts === "number" && ts > maxTs) maxTs = ts;
  }
  return maxTs;
}

/** verify 面。返回 true = 这一面要红着退出（不可测 / 归因路径没落地）。 */
function verifyFace(raws: readonly unknown[], fileCount: number): boolean {
  let events = 0, redEvents = 0, redResults = 0, hookErrorBeats = 0, autoBeats = 0;
  const struct = new Map<string, number>();
  const text = new Map<string, number>();
  let withCauseField = 0;

  for (const raw of raws) {
    const e = raw as VerifyResultEvent;
    if (e.type !== "verify_result") continue;
    events++;
    if (e.ok !== false) continue;
    redEvents++;
    if (e.auto === true) autoBeats++;
    const rs = e.results ?? [];
    if (rs.length === 0) hookErrorBeats++; // outcome.results 为空 = 钩子抛错那条路
    for (const r of rs) {
      if (r.ok) continue;
      redResults++;
      if (typeof r.cause === "string") withCauseField++;
      bump(struct, structuralKind(r));
      bump(text, textualKind(r));
    }
  }

  if (events === 0) {
    // 有料却一条 verify 拍都没有 = 这个语料测不到这一面（G7 的口径：标 unmeasurable，不报 0）
    console.log(`[verify 面] 语料=${String(fileCount)} 个 jsonl · verify_result 事件=0 ⇒ 本面在此语料上**不可测**（不是"环境红为 0"）`);
    return true;
  }
  console.log(`[verify 面] verify_result 事件=${String(events)} 红事件=${String(redEvents)} 红命令=${String(redResults)}`);
  console.log("带 cause 字段的红命令=", String(withCauseField), "（>0 表示 cause 已落盘）");
  console.log("钩子异常拍（红且 results 为空）=", String(hookErrorBeats), "红事件里 harness 自动拍=", String(autoBeats));
  console.log("结构栏（产品可用的机制）:", show(struct));
  console.log("文案栏（人眼线索，非判据）:", show(text));
  const attributable = (struct.get("no-surface") ?? 0) + withCauseField;
  console.log(
    "今天可机器归因占比=",
    redResults === 0 ? "无红样本" : (attributable / redResults).toFixed(2) + " (" + String(attributable) + "/" + String(redResults) + ")",
  );

  // 那个「0」到底是什么性质，由这一行说，而不是留给读者猜。
  const ship = causeShipDate(resolve(import.meta.dirname, "../.."));
  const d = datingVerdict(withCauseField, corpusAge(raws), ship, redResults);
  const age = corpusAge(raws);
  console.log(
    "语料年龄=", age === 0 ? "没读到事件 ts（=没尺）" : new Date(age).toISOString().slice(0, 10),
    "· cause 落盘=", ship.sha === "" ? "查不到提交（=没尺）" : ship.sha + " / " + new Date(ship.ms).toISOString().slice(0, 10),
    "⇒", d.reason,
  );
  return d.state === "newer-but-unattributed";
}

/** exec 面。返回 true = 这一面要红着退出（无红拍当分母 / 归因路径没落地）。 */
function execFace(raws: readonly unknown[]): boolean {
  const t = execMixOf(raws);
  const age = corpusAge(raws);
  console.log(
    `\n[exec 面] shell 家族 tool_result=${String(t.shellBeats)}（${show(t.byTool)}）` +
      ` · join 不上=${String(t.unmatched)}（不计入分母，也不当没有）· 红拍=${String(t.shellRed)}`,
  );
  if (t.shellRed === 0) {
    console.log("⇒ 本面在此语料上**不可测**：shell 家族一条红拍也没有（不是「环境红为 0」）");
    return true;
  }
  console.log("带结构字段（exitCode／timedOut）的红拍=", String(t.withStructure), "（>0 表示 #24 那把结构面已在语料里生效）");
  console.log("结构栏（与产品谓词同形：`not-run`＝没有退出码，第 221 页 #39 之后两边收敛）:", show(t.struct));
  console.log("文案栏（人眼线索，非判据）:", show(t.text));
  console.log(
    "可机器归因占比（正证五类／红拍）=",
    (t.attributable / t.shellRed).toFixed(2) + ` (${String(t.attributable)}/${String(t.shellRed)})`,
    "· 其中环境类=",
    (t.environmental / t.shellRed).toFixed(2) + ` (${String(t.environmental)}/${String(t.shellRed)})`,
  );
  const noStructure = t.struct.get("no-structure") ?? 0;
  if (noStructure > 0) {
    const byGate = t.blockedShellNoStruct;
    // 从前这一格只能把三个成因并列说「分不开」；#40 之后 ② 有了一列可读 ⇒ 分得出多少就报多少，
    // 抽到 0 条也要说清那是「料早于列」而不是「这趟没有闸拦」（规则 270 的 ③）。
    const cause2 = byGate > 0
      ? `② 根本没走到 exec = ${String(byGate)} 条（照 \`blockedBy\` 那一列数出来的，不再靠猜）；`
      : "② 根本没走到 exec——这一因自第 225 页起有 `blockedBy` 一列可读，本份语料抽到 0 条 ⇒ " +
        "只能说「料早于该列上线」，不能说「这趟没有闸拦」；";
    console.log(
      `⚠️ 这一格有三种真成因（no-structure:${String(noStructure)}）：① 语料早于 #24 落盘；${cause2}` +
        "③ spawn 的 error 出口自己就不带字段。worker 门拒绝带 `gate.verdict=denied`，那是另一格判据，本面不读它。",
    );
  }
  console.log(
    "硬闸红拍（从未 exec，全部工具口径）=", String(t.blockedAll),
    "· 逐闸=", t.blockedAll === 0 ? "没有一条（≠这趟没有闸拦，见上面 ⚠️）" : show(t.blockedMix),
    "· 本面 shell 家族里的那部分=", String(t.blockedShellNoStruct),
  );
  const ship = execFieldShipDate(resolve(import.meta.dirname, "../.."));
  const d = datingVerdict(t.withStructure, age, ship, t.shellRed, "exitCode/timedOut 结构字段");
  console.log(
    "语料年龄=", age === 0 ? "没读到事件 ts（=没尺）" : new Date(age).toISOString().slice(0, 10),
    "· 结构字段落盘面=", ship.sha === "" ? "查不到提交（=没尺）" : ship.sha + " / " + new Date(ship.ms).toISOString().slice(0, 10),
    "⇒", d.reason,
  );
  return d.state === "newer-but-unattributed";
}

function main(): void {
  const scan = scanCorpus();
  const empty = zeroCorpusProblem(scan);
  if (empty !== null) {
    console.error("⚠️ verify-cause-mix 读数无意义：" + empty);
    process.exitCode = 1;
    return;
  }
  const raws = scan.files.flatMap((f) => readJsonl(f));
  // 两面各自守卫、各自出声：一面没料绝不许把另一面一起闭嘴（同一把尺 ≠ 同一个分母）。
  const red = verifyFace(raws, scan.files.length);
  const redExec = execFace(raws);
  if (red || redExec) process.exitCode = 1;
}

// 被 import 时只导出纯函数，绝不扫语料、绝不设 exitCode（规则 110：判卷脚本的顶层副作用会伪装成测试结果）。
// 两侧都必须**解码**再比：仓库路径里有空格，`pathToFileURL(...).href` 会把它编码成 `%20`，
// 与 `resolve(process.argv[1])` 永不相等 ⇒ 门变成"exit 0 且什么都不印"（本轮实踩，靠"读数为空"才发现）。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
