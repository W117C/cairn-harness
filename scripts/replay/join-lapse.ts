// 复跑面 · 登记项 `replay:join-lapse`（判卷读数：真语料里「回合末还有在途 worker」的占比）
//
// 这条读数服务 orchestration-design §3 的 **W1b**（回合末在途闸）。spec 自己把它的前置写死了：
// 「它多要一轮 = 花真钱，且动的是 `runLoop` 的终止语义 ⇒ **先量占比再动终止语义**」，
// 排期第 5 条又写「W1b（默认值由 G-A 出数）」。在拿到这个占比之前建那道闸，就是 spec 明令禁止的
// 「由纪律而不是数据决定默认值」。
//
// 三条口径纪律：
//  ⑴ 「在途」的定义**挂产品现状**：直接复用 `interruptedWorkers`（M3c 恢复面认的那份终态名单）。
//     本面另抄一份 done/failed/cancelled 就是第六族（同一条解析只硬化一支）——恢复面加一种终态时，
//     这里必须自动跟上，否则读数会把它算成在途。
//  ⑵ 分母只数**真派过活**的 run：把无 worker 的会话算进分母，占比会被大量普通会话稀释成好看的 0。
//  ⑶ 三态守卫：零语料 / 有语料但 `agent_spawned=0` ⇒ **红着退出**并说「不可测」。
//     「0 个 run 在途」与「一条 worker 都没派过」在这里必须长成两个不同的样子。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "../../src/events";
import { interruptedWorkers } from "../../src/agent/recovery";
import { WAIT_FOR_AGENTS_TOOL } from "../../src/tools/wait_for_agents";
import { readJsonl, scanCorpus, zeroCorpusProblem } from "./corpus";

/** 主会话「又动了」的证据：回执之后出现这三类之一，才算模型有机会读过那份产出。
 *  不含 `assistant_delta`/`usage`——它们在每个模型轮都批量出现，会把「读到过」判成恒真。 */
const MAIN_ACTIONS: ReadonlySet<string> = new Set(["tool_call", "assistant_message", "verify_result"]);

export interface RunRow {
  /** 一个文件 = 一条 run 流（语料里每条流各一次 user_message；不假设，只按文件分桶）。 */
  file: string;
  /** 去重后的 agent_id 数（重派会换新 id，所以一个 id 就是一个 worker）。 */
  spawns: number;
  /** 末态仍无终态的 worker 数 = W1b 那道闸在回合末会看到的数。 */
  inFlight: number;
  /** 主动收队次数（`wait_for_agents` 的 tool_call；不看 result 成败——量的是"有没有去等"）。 */
  waitCalls: number;
  /** 拿到过回执、且回执之后主会话还有动作。 */
  readReceipt: boolean;
}

export function tallyJoinLapse(raws: readonly unknown[], file = "?"): RunRow {
  const spawnedIds = new Set<string>();
  let waitCalls = 0;
  let lastReceipt = -1;
  raws.forEach((raw, i) => {
    const e = raw as { type?: string; agent_id?: string; name?: string };
    if (e.type === "agent_spawned" && typeof e.agent_id === "string") spawnedIds.add(e.agent_id);
    if (e.type === "tool_call" && e.name === WAIT_FOR_AGENTS_TOOL) waitCalls++;
    if (e.type === "agent_result") lastReceipt = i;
  });
  let actionsAfter = 0;
  if (lastReceipt >= 0) {
    for (let i = lastReceipt + 1; i < raws.length; i++) {
      const t = (raws[i] as { type?: string }).type;
      if (t !== undefined && MAIN_ACTIONS.has(t)) actionsAfter++;
    }
  }
  return {
    file,
    spawns: spawnedIds.size,
    inFlight: interruptedWorkers(raws as readonly AgentEvent[]).length,
    waitCalls,
    readReceipt: lastReceipt >= 0 && actionsAfter > 0,
  };
}

export interface JoinLapseSummary {
  rows: RunRow[];
  /** 分母：真派过活的 run 数。 */
  workerRuns: number;
  /** 其中末态还有在途 worker 的 run 数（W1b 的触发面）。 */
  lapsedRuns: number;
  /** 派了活却从没调用过 `wait_for_agents` 的 run 数（收队全靠 harness 异步收尾）。 */
  neverWaitedRuns: number;
  /** 回执之后主会话没再动过手的 run 数（付了钱、结论没进正文）。 */
  unreadRuns: number;
  totalSpawns: number;
  totalInFlight: number;
  /** 未计入分母的普通会话数——把「稀释」这件事说出来，而不是悄悄做掉。 */
  skippedRuns: number;
  /** **派过活的那些** run 有几个来源目录 = 样本宽度。按全语料数会被无 worker 的文件稀释，
   *  而那 13 个文件对这条读数一条票都没投（本面自己踩到后改的）。 */
  families: number;
}

export function summarizeRuns(rows: readonly RunRow[]): JoinLapseSummary {
  const worker = rows.filter((r) => r.spawns > 0);
  const skipped = rows.filter((r) => r.spawns === 0);
  return {
    rows: [...rows],
    workerRuns: worker.length,
    lapsedRuns: worker.filter((r) => r.inFlight > 0).length,
    neverWaitedRuns: worker.filter((r) => r.waitCalls === 0).length,
    unreadRuns: worker.filter((r) => !r.readReceipt).length,
    totalSpawns: worker.reduce((n, r) => n + r.spawns, 0),
    totalInFlight: worker.reduce((n, r) => n + r.inFlight, 0),
    skippedRuns: skipped.length,
    families: new Set(worker.map((r) => r.file.replace(/[/\\][^/\\]*$/, ""))).size,
  };
}

const pct = (a: number, b: number): string => (b === 0 ? "—" : String(Math.round((a / b) * 100)) + "%");

/** 纯函数版结论：把「这次读数能不能拿来裁决 W1b」这件事写成数据而不是靠人记得住 spec。
 *  调用方（main）照 `exitCode` 退出——红着退出就是"未证 ≠ 通过"。 */
export function joinLapseVerdict(s: JoinLapseSummary): { exitCode: 0 | 1; lines: string[] } {
  if (s.totalSpawns === 0) {
    return {
      exitCode: 1,
      lines: [
        `语料=${String(s.rows.length)} 个 run · agent_spawned=0 ⇒ 本面**不可测**：` +
          "没有任何派活轨迹。这里读到的「0 个在途」是「没有 worker」，不是「没人忘记收队」。",
        "⇒ 换到有 worker 的语料上再跑；在此之前 W1b 的默认值**没有数据支撑**，不得由纪律代替。",
      ],
    };
  }
  const lines = [
    `语料=${String(s.rows.length)} 个 run（${String(s.families)} 个来源目录）· 派过活的=${String(s.workerRuns)} 个` +
      `（另 ${String(s.skippedRuns)} 个无 worker 的会话**不**进分母）`,
    `回合末在途=${String(s.lapsedRuns)}/${String(s.workerRuns)} 个 run · 未收的 worker=${String(s.totalInFlight)}/${String(s.totalSpawns)}` +
      `（${pct(s.lapsedRuns, s.workerRuns)}）`,
    s.lapsedRuns === 0
      ? "⇒ W1b 那道闸在这些轨迹上**一次也不会触发**，而它每次命中要多要一轮真钱 ⇒ 数据侧不支持建它。"
      : `⇒ 闸有触发面（${String(s.lapsedRuns)} 个 run）：进 §3 落点评估，代价 = 每命中一次多要一轮真钱。`,
    `主动收队缺席=${String(s.neverWaitedRuns)}/${String(s.workerRuns)} 个 run（派了活从没调 ${WAIT_FOR_AGENTS_TOOL}）·` +
      ` 回执没读=${String(s.unreadRuns)}/${String(s.workerRuns)} 个 run`,
  ];
  if (s.families <= 2) {
    lines.push(
      "⚠️ 样本只来自 " + String(s.families) + " 个来源目录 ⇒ 这是**一次实验的轨迹**，不是产品使用面；" +
        "外推到生产前先攒真会话里派过活的那些。",
    );
  } else {
    lines.push(
      "样本宽度=" + String(s.families) + " 个来源目录 / " + String(s.workerRuns) + " 个派活 run" +
        "（n 小 ⇒ 只支持「闸会不会触发」这一问，不支持外推到产品）。",
    );
  }
  return { exitCode: 0, lines };
}

function main(): void {
  const scan = scanCorpus();
  const empty = zeroCorpusProblem(scan);
  if (empty !== null) {
    console.error("⚠️ join-lapse 读数无意义：" + empty);
    process.exitCode = 1;
    return;
  }
  const rows = scan.files.map((f) => tallyJoinLapse(readJsonl(f), f));
  const v = joinLapseVerdict(summarizeRuns(rows));
  for (const l of v.lines) console.log(l);
  if (v.exitCode === 1) return;
  for (const r of rows.filter((x) => x.spawns > 0)) {
    console.log(
      `  ${r.file} · spawns=${String(r.spawns)} 在途=${String(r.inFlight)} wait=${String(r.waitCalls)} 读到回执=${r.readReceipt ? "是" : "否"}`,
    );
  }
  process.exitCode = v.exitCode;
}

// 只在直接执行时跑读数：判卷要 import 纯函数，模块加载不得有副作用（也不该扫盘）。
// 比较走 fileURLToPath——本仓路径里有空格，`import.meta.url` 会编码成 %20，endsWith 会比不中。
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
