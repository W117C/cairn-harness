// 复跑面 · 登记项 `replay:cascade-traffic`
//
// 它要回答的问题（judgment-layer §9 第 0 步的第三件错事）：verify 归因里，
// 「环境红 → 触发升档重跑同一环 → 换更贵的档再红一次」这一条今天值不值得修？
// 修它要动 `orchestrator.ts` 的级联调用点（本仓最热的在飞文件之一），并且要给
// `runCascade` 的 rung 返回值加 cause 表达法——**在被绕开的路上建机制是这轮已经裁否过一次的形态**
// （pipeline 加环：mode=pipeline 真轨迹 0 次 ⇒ 不建）。所以先量分母，再决定动不动。
//
// 口径（全部只看事件字段，不做文案匹配当判据）：
//   routing_decision 事件数 + reason 分布（升档 = reason 里带 cascade）；
//   [cascade] 播报条数（orchestrator 升档那一拍一定 emit 一条 agent_message(kind=progress)，
//     文本含 "[cascade]" —— 这是**通道缺表达法时的兜底观察着**：路由表若没开，播报仍在流里）；
//   红拍里环境因占比：结构栏（`cause` 字段）+ 文案栏（人眼线索，只作证据）。
// 三条全 0 ⇒ 报 **unmeasurable**，不报"环境红没有触发过升档"（G7 口径：没上场就是没尺）。
import { readJsonl, scanCorpus, zeroCorpusProblem } from "./corpus";
import { isEnvVerifyCause, type VerifyCause } from "../../src/events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface RoutingEvent {
  type: string;
  reason?: string;
}
interface AgentMessageEvent {
  type: string;
  kind?: string;
  text?: string;
}
interface CommandResult {
  command: string;
  ok: boolean;
  output?: string;
  cause?: string;
}
interface VerifyResultEvent {
  type: string;
  ok?: boolean;
  results?: CommandResult[];
}

/** 一条流里三个计数面各自独立收齐，任一非 0 就证明"这条流真的可能被本面测到"。 */
export interface StreamTraffic {
  decisions: number;
  upgradeReasons: number;
  cascadeBroadcasts: number;
  redBeats: number;
  envRedBeats: number;
  causeFieldRedBeats: number;
}

// 文案栏：人眼线索，只作**证据**不作判据（跨域串不可分类，judgment-layer §9.1 已裁）。
const ENV_TEXTUAL = ["[exit code: 127]", "verify 命令超时", "(none)", "[verify] 钩子异常"];

/** 结构栏**直接吃仓内那只唯一谓词**（`isEnvVerifyCause`）：
 *  读数面自己抄一份 `=== "timeout" || …` 的表 = 第二事实源，产品的枚举一改就静默分叉
 *  （本仓判死过多次的同族；本轮立的新规则里刚点名过一次）。 */
function isEnvCauseStruct(cause: string | undefined): boolean {
  return isEnvVerifyCause(cause as VerifyCause | undefined);
}

export function scanStreamTraffic(lines: Iterable<unknown>): StreamTraffic {
  const t: StreamTraffic = {
    decisions: 0, upgradeReasons: 0, cascadeBroadcasts: 0,
    redBeats: 0, envRedBeats: 0, causeFieldRedBeats: 0,
  };
  for (const raw of lines) {
    const e = raw as RoutingEvent & AgentMessageEvent & VerifyResultEvent;
    if (e.type === "routing_decision") {
      t.decisions++;
      if (String(e.reason ?? "").includes("cascade")) t.upgradeReasons++;
    } else if (e.type === "agent_message" && typeof e.text === "string" && e.text.includes("[cascade]")) {
      t.cascadeBroadcasts++;
    } else if (e.type === "verify_result" && e.ok === false) {
      for (const r of e.results ?? []) {
        if (r.ok) continue;
        t.redBeats++;
        if (typeof r.cause === "string") t.causeFieldRedBeats++;
        const textEnv = ENV_TEXTUAL.some((m) => String(r.output ?? "").includes(m));
        if (isEnvCauseStruct(typeof r.cause === "string" ? r.cause : undefined) || textEnv) t.envRedBeats++;
      }
    }
  }
  return t;
}

/** 三态裁决（与 stagnation-burn 同一形状：先判"有没有尺"，再判"该不该动"）。 */
export function trafficVerdict(sum: StreamTraffic, streams: number, measurable: boolean): string {
  if (!measurable) return "不可测：没有任何语料可读（见 zeroCorpusProblem），这条 0 不是" + "「没发生过升档」";
  const seen = sum.decisions + sum.cascadeBroadcasts;
  if (seen === 0) {
    return "不可测（路径零流量）：" + String(streams) + " 条流里 routing_decision=" + String(sum.decisions) +
      " · [cascade] 播报=" + String(sum.cascadeBroadcasts) + " ⇒ 级联升档在这批语料里一次都没上场，" +
      "「环境红白花钱」的分子恒为 0 只兼容" + "「机制没被触发」。不动 orchestrator 的级联调用点；" +
      "反转条件 = 出现 ≥1 次升档的语料（真跑一轮 routing:true 的编排会话）";
  }
  const share = sum.redBeats === 0 ? "无红拍可配" : (sum.envRedBeats / sum.redBeats).toFixed(2) + " (" + String(sum.envRedBeats) + "/" + String(sum.redBeats) + ")";
  return "该量：升档决策 " + String(sum.upgradeReasons) + " 次 / 播报 " + String(sum.cascadeBroadcasts) +
    " 次，红拍里环境因占比 " + share + " ⇒ 这一占比就是「换贵档再红一次」的上界，" +
    "拿它对着一次模型往返的钱决定是否给 runCascade 的 rung 加 cause";
}

/** 每次跑都注入的自检（规则 74）：合成对照必须被抓、也必须不被抓，否则"0 条升档"兼容"尺是瞎的"。 */
export function selfCheck(): string[] {
  const problems: string[] = [];
  const up = { type: "routing_decision", reason: "cascade-upgrade" };
  const other = { type: "routing_decision", reason: "tier-default" };
  const cast = { type: "agent_message", kind: "progress", text: "[cascade] stage 1 → 升档重跑：small→medium" };
  const redEnv = {
    type: "verify_result", ok: false,
    results: [{ command: "pnpm test", ok: false, output: "sh: pnpm: command not found [exit code: 127]", cause: "toolchain-missing" }],
  };
  const redCode = { type: "verify_result", ok: false, results: [{ command: "pnpm test", ok: false, output: "FAIL: 1 failed" }] };
  const green = { type: "verify_result", ok: true, results: [{ command: "pnpm test", ok: true, output: "all green" }] };

  const caught = scanStreamTraffic([up, cast, redEnv, redCode, green]);
  if (caught.decisions !== 1 || caught.upgradeReasons !== 1) problems.push("① 升档计数没分对（应 1 条决策且它含 cascade）");
  if (caught.cascadeBroadcasts !== 1) problems.push("② 播报没抓到（通道缺 routing 事件时的唯一观察着）");
  if (caught.redBeats !== 2 || caught.envRedBeats !== 1) problems.push("③ 环境/代码红没分对（应 2 红 / 1 环境）");
  if (caught.causeFieldRedBeats !== 1) problems.push("④ cause 字段在场率没数到（判「没落盘」要用它）");
  // 反向格：全是绿拍与 tier-default ⇒ 三个计数面都必须安静
  const quiet = scanStreamTraffic([other, green]);
  if (quiet.upgradeReasons !== 0 || quiet.cascadeBroadcasts !== 0 || quiet.redBeats !== 0) {
    problems.push("⑤ 反控被误抓（没升档、没红拍的流读出了非 0 ⇒ 尺在自造分子）");
  }
  // 裁决两侧都要走到（规则 144：同一把尺的两条相反分支各配一条）
  const v0 = trafficVerdict({ ...quiet, decisions: 0, cascadeBroadcasts: 0 }, 3, true);
  if (!v0.startsWith("不可测")) problems.push("⑥ 零流量却印成「该量」⇒ 把「没上场」读成了「没发生」");
  const v1 = trafficVerdict(caught, 3, true);
  if (!v1.startsWith("该量")) problems.push("⑦ 有升档却印成「不可测」⇒ 尺把有流量的语料判成没尺");
  return problems;
}

function main(): void {
  const problems = selfCheck();
  if (problems.length > 0) {
    console.error("❌ cascade-traffic 自检未过（尺自己不可信，读数不作数）：\n  " + problems.join("\n  "));
    process.exitCode = 1;
    return;
  }
  const scan = scanCorpus();
  const sum: StreamTraffic = {
    decisions: 0, upgradeReasons: 0, cascadeBroadcasts: 0,
    redBeats: 0, envRedBeats: 0, causeFieldRedBeats: 0,
  };
  const empty = zeroCorpusProblem(scan);
  for (const f of scan.files) {
    const t = scanStreamTraffic(readJsonl(f));
    for (const k of Object.keys(sum) as (keyof StreamTraffic)[]) sum[k] += t[k];
  }
  console.log("自检（合成对照：该抓的抓到 / 反控不被抓 / 裁决两条反向分支各走一次）= 全过 · 取料 = " +
    String(scan.files.length) + " 个 jsonl" + (empty === null ? "" : "（⚠️ " + empty + "）"));
  console.log("红拍=" + String(sum.redBeats) + " 其中带 cause 字段=" + String(sum.causeFieldRedBeats) +
    " 环境因（结构∪文案）=" + String(sum.envRedBeats));
  console.log(trafficVerdict(sum, scan.files.length, empty === null));
  if (empty !== null) process.exitCode = 1;
}

// 守卫两侧同形：本仓路径含空格，`file://` + argv[1] 会被百分号编码成 `%20` ⇒ 永不相等、
// 脚本变成「exit 0 且什么都不印」（2026-09-24 在同一目录里实踩过，见 verify-cause-mix.ts 的注释）。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
