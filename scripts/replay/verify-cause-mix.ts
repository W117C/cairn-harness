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

interface VerifyResultEvent {
  type: string;
  ok?: boolean;
  auto?: boolean;
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
  const struct = new Map<string, number>();
  const text = new Map<string, number>();
  let withCauseField = 0;

  for (const f of scan.files) {
    for (const raw of readJsonl(f)) {
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
}

main();
