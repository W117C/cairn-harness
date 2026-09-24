// 复跑面 · 登记项 `replay:verify-cause-mix`（判卷读数：verify 红里有多少**今天能被机器归因**）
//
// 这条读数服务 judgment-layer §9「第 0 步：verify 归因」与 gap-fix P1-3：
// 环境红（工具链没装 / 超时 / 根本没有可验面 / 钩子自己炸）今天在事件里与"模型写的代码错了"
// **长得一模一样**，于是它同时做三件错事：烧掉模型的 verify 额度、按档位阶梯升级模型（多花钱）、
// 进沉淀被当成"这个模型在这里会失败"。要判断这事值不值得修，先得有**分母**：
// 语料里到底几条 verify 红、其中几条今天光靠字段就能判出是环境红。
//
// 口径分两栏，且**只有左栏是产品将来能用的机制**（judgment-layer §9.1 定案：纯结构、零文案匹配）：
//   结构栏 = 只看 `VerifyCommandResult` 的字段（command / ok / 有没有 exitCode / cause）。
//   文案栏 = 人眼现在能从 output 里读出来的线索（`[exit code: 127]`、超时那句、`(none)`、"钩子异常"）——
//            它是**证据**不是**判据**：跨域串（如 "Cannot find module"）已实测不可分类，见 §9.1。
import { readJsonl, scanCorpus, zeroCorpusProblem } from "./corpus";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

export function datingVerdict(
  withCauseField: number, maxEventMs: number, ship: { sha: string; ms: number }, redResults: number,
): { state: DatingState; reason: string } {
  if (withCauseField > 0) return { state: "attributed", reason: "归因已被观测到（带 cause 的红命令 > 0）" };
  if (redResults === 0) return { state: "unmeasurable", reason: "语料里没有红样本 ⇒ 这一面无从判定，不报 0 也不报失效" };
  if (ship.ms === 0) return { state: "unmeasurable", reason: "查不到 cause 落盘的提交（git 读失败）⇒ 年龄这一前提没被量过，不许拿它解释 0" };
  if (maxEventMs < ship.ms) {
    return {
      state: "older-than-ship",
      reason: `语料最新事件早于 cause 落盘（${ship.sha}）⇒ 这个 0 是**数据年龄**，不是归因失效`,
    };
  }
  return {
    state: "newer-but-unattributed",
    reason: `有比 ${ship.sha} 更新的流，却仍没有一条红带 cause ⇒ **归因路径没落地**，这才是要修的那格`,
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
  if (r.command === "(none)") return "no-surface"; // 哨兵命令名，verify.ts 里就是它
  return "unknown"; // 其余（timeout / toolchain-missing / code）今天全在 output 文案里
}

/** 文案栏：人眼线索，仅供量"有多少红其实一眼能看出不是代码错"。 */
function textualKind(r: { command: string; output?: string }): string {
  const out = r.output ?? "";
  if (r.command === "(none)") return "no-surface";
  if (out.includes("verify 命令超时")) return "timeout";
  if (out.includes("[exit code: 127]")) return "toolchain-missing";
  if (out.includes("[verify] 钩子异常")) return "hook-error";
  return "code-or-unknown";
}

const bump = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) ?? 0) + 1); };
const show = (m: Map<string, number>): string =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ":" + String(v)).join(" ");

function main(): void {
  const scan = scanCorpus();
  let events = 0, redEvents = 0, redResults = 0, hookErrorBeats = 0, autoBeats = 0;
  let maxTs = 0;
  const struct = new Map<string, number>();
  const text = new Map<string, number>();
  let withCauseField = 0;

  for (const f of scan.files) {
    for (const raw of readJsonl(f)) {
      const e = raw as VerifyResultEvent;
      if (typeof e.ts === "number" && e.ts > maxTs) maxTs = e.ts; // 语料年龄要跨全部事件取，不能只看红拍
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
  }

  const empty = zeroCorpusProblem(scan);
  if (empty !== null) {
    console.error("⚠️ verify-cause-mix 读数无意义：" + empty);
    process.exitCode = 1;
    return;
  }
  if (events === 0) {
    // 有料却一条 verify 拍都没有 = 这个语料测不到这一面（G7 的口径：标 unmeasurable，不报 0）
    console.log(`语料=${String(scan.files.length)} 个 jsonl · verify_result 事件=0 ⇒ 本面在此语料上**不可测**（不是"环境红为 0"）`);
    process.exitCode = 1;
    return;
  }
  console.log(`verify_result 事件=${String(events)} 红事件=${String(redEvents)} 红命令=${String(redResults)}`);
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
  const d = datingVerdict(withCauseField, maxTs, ship, redResults);
  console.log(
    "语料年龄=", maxTs === 0 ? "没读到事件 ts（=没尺）" : new Date(maxTs).toISOString().slice(0, 10),
    "· cause 落盘=", ship.sha === "" ? "查不到提交（=没尺）" : ship.sha + " / " + new Date(ship.ms).toISOString().slice(0, 10),
    "⇒", d.reason,
  );
  if (d.state === "newer-but-unattributed") process.exitCode = 1;
}

// 被 import 时只导出纯函数，绝不扫语料、绝不设 exitCode（规则 110：判卷脚本的顶层副作用会伪装成测试结果）。
// 两侧都必须**解码**再比：仓库路径里有空格，`pathToFileURL(...).href` 会把它编码成 `%20`，
// 与 `resolve(process.argv[1])` 永不相等 ⇒ 门变成"exit 0 且什么都不印"（本轮实踩，靠"读数为空"才发现）。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
