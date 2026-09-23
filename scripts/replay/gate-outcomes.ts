// 复跑面 · 登记项 `replay:gate-outcomes`（判卷读数：真语料里**人到底怎么答的**，按 layer × verdict 铺全矩阵）
//
// 这条读数服务 judgment-layer §7 第 2 步（攒可标语料）与第 3 步（配阈值 τ）：
// §5 把 `gate`（layer / verdict / risk / mode）落进 `tool_result` 之后，"当时判了什么、人怎么答的"
// 第一次可从事件流回放——但**从来没人把它当读数面统计过**。ask 密度（`ask-density`）是反事实臂：
// 它回答"如果按 X 档会出多少卡"；而 τ 要的是分子"出过的卡里人被拒了多少"。
// 这条就是量分子在不在。
//
// 三条口径纪律：
//  ⑴ 矩阵按 `GATE_LAYERS × GATE_VERDICTS` **铺满骨架**再计数——只列非零格会让"新加一层/一种结果"
//     静默少一列（读数看着完整，其实漏计）；表外字面量单独进 unknown*，不许丢。
//  ⑵ `tool_result` 上没有工具名，受管判定必须经 `callId → tool_call.name` join（同 corpus-inventory）；
//     join 不上的单独计数，不静默跳过——那正是"读数取不到"的入口。
//  ⑶ 三态守卫：零语料 / 有语料但 0 条受管 / 有受管但 0 条带 gate，**全部红着退出**并说清缺哪一环，
//     禁止打出 0 后退 0 让人读成"人从没拒过"。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_LAYERS, GATE_VERDICTS } from "../../src/permissions/autonomy";
import type { GateVerdict } from "../../src/permissions";
import { isGatedTool, readJsonl, scanCorpus, zeroCorpusProblem } from "./corpus";

export const CELL_SEP = "␟";

export interface GateTally {
  /** `${layer}${CELL_SEP}${verdict}` → 次数（骨架含全部格子，未命中即 0）。 */
  cells: Map<string, number>;
  /** 表外 layer / verdict（旧日志或新增值），单独记账，不混进矩阵也不丢。 */
  unknownLayer: Map<string, number>;
  unknownVerdict: Map<string, number>;
  /** 受管 tool_result 总数（分母）。 */
  gatedResults: number;
  /** 其中带 `gate` 留痕的条数（覆盖率分子）。 */
  withGate: number;
  /** 问过人的（approved / rejected / timeout / unattended）。 */
  humanAnswered: number;
  /** §7 第 2 步读数 A 的**可标**口径：approved + rejected + denied（含门直接拦的），≥300 才有资格进第 3 步。
   *  与 `humanAnswered` 分开算：denied 没问过人，但它同样是"这一格该不该免批"的标签。 */
  labelable: number;
  rejected: number;
  /** join 不上 tool_call 的受管 tool_result：不静默跳过。 */
  unmatched: number;
}

const HUMAN_ANSWERED: readonly GateVerdict[] = ["approved", "rejected", "timeout", "unattended"];
/** §7 读数 A 的可标集（含门直接拦的 denied：它同样是该格该不该免批的证据）。 */
const LABELABLE: readonly GateVerdict[] = ["approved", "rejected", "denied"];

/* `X-distill` 那一行读时要另带一条口径：沉淀轮是**合并审批**（一次问答覆盖整轮），
 * 所以它的 approved/rejected 按"受管调用"计而不是按"人的答复"计。格子按层分开正是为了这件事——
 * 逐次审批那些行的分母不受它影响；整表读数若要报"人回答了几次"，得把这一行单独折回成轮数。 */

/** 全矩阵骨架：新加一层或一种结果时，格子自动多一格（用例钉住"格子数 = 两层数之积"）。 */
export function emptyCells(): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of GATE_LAYERS) for (const v of GATE_VERDICTS) m.set(l + CELL_SEP + v, 0);
  return m;
}

export function cellOf(layer: string, verdict: string): string {
  return layer + CELL_SEP + verdict;
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

/** 纯函数：吃一堆原始事件对象（多文件拼接后的数组），吐交叉表。 */
export function tallyGateEvents(raws: readonly unknown[]): GateTally {
  const nameByCall = new Map<string, string>();
  for (const raw of raws) {
    const e = raw as { type?: string; id?: string; name?: string };
    if (e.type === "tool_call" && typeof e.id === "string") nameByCall.set(e.id, String(e.name ?? ""));
  }
  const t: GateTally = {
    cells: emptyCells(),
    unknownLayer: new Map<string, number>(),
    unknownVerdict: new Map<string, number>(),
    gatedResults: 0,
    withGate: 0,
    humanAnswered: 0,
    labelable: 0,
    rejected: 0,
    unmatched: 0,
  };
  for (const raw of raws) {
    const e = raw as { type?: string; callId?: string; gate?: { layer?: string; verdict?: string } };
    if (e.type !== "tool_result" || typeof e.callId !== "string") continue;
    const tool = nameByCall.get(e.callId);
    if (tool === undefined) {
      t.unmatched++;
      continue;
    }
    if (!isGatedTool(tool)) continue;
    t.gatedResults++;
    const g = e.gate;
    if (g === undefined || typeof g.layer !== "string" || typeof g.verdict !== "string") continue;
    t.withGate++;
    const layerOk = (GATE_LAYERS as readonly string[]).includes(g.layer);
    const verdictOk = (GATE_VERDICTS as readonly string[]).includes(g.verdict);
    if (!layerOk) bump(t.unknownLayer, g.layer);
    if (!verdictOk) bump(t.unknownVerdict, g.verdict);
    if (layerOk && verdictOk) bump(t.cells, cellOf(g.layer, g.verdict));
    if (verdictOk && HUMAN_ANSWERED.includes(g.verdict as GateVerdict)) t.humanAnswered++;
    if (verdictOk && LABELABLE.includes(g.verdict as GateVerdict)) t.labelable++;
    if (g.verdict === "rejected") t.rejected++;
  }
  return t;
}

const show = (m: Map<string, number>): string =>
  [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + CELL_SEP + String(v)).join("  ");

function main(): void {
  const scan = scanCorpus();
  const raws = scan.files.flatMap((f) => readJsonl(f));
  const empty = zeroCorpusProblem(scan);
  if (empty !== null) {
    console.error("⚠️ gate-outcomes 读数无意义：" + empty);
    process.exitCode = 1;
    return;
  }
  const t = tallyGateEvents(raws);
  if (t.gatedResults === 0) {
    console.log(`语料=${String(scan.files.length)} 个 jsonl · 受管 tool_result=0 ⇒ 本面在此语料上**不可测**（join 不上=${String(t.unmatched)}）`);
    process.exitCode = 1;
    return;
  }
  if (t.withGate === 0) {
    // G7 口径：标 unmeasurable，不报 0——"0 条留痕"与"人从没拒过"是两件事
    console.log(
      `受管 tool_result=${String(t.gatedResults)} · 带 gate 留痕=0 ⇒ **不可测**：这批会话早于 gate 留痕落流（§5），` +
        "第 3 步的分子在这里取不到，别把它读成「人没拒过」",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `语料=${String(scan.files.length)} 个 jsonl · 受管 tool_result=${String(t.gatedResults)} · 带 gate=${String(t.withGate)}` +
      `（覆盖率 ${String(Math.round((t.withGate / t.gatedResults) * 100))}%）· 问过人的=${String(t.humanAnswered)} 其中被拒=${String(t.rejected)}` +
      ` · 可标(读数A口径 approved+rejected+denied)=${String(t.labelable)} · join 不上=${String(t.unmatched)}`,
  );
  // §7 第 2 步写死了资格线：可标 < 300 就没有第 3 步。这一行把它变成读数而不是靠人记得住那句文档。
  console.log(
    t.labelable >= 300
      ? "⇒ 已达 §7 第 3 步的资格线（可标 ≥ 300）"
      : `⇒ **未达** §7 第 3 步的资格线：可标 ${String(t.labelable)} / 300（还差 ${String(300 - t.labelable)} 条）`,
  );
  console.log("layer×verdict（非零格）:", show(t.cells) || "（无非零格）");
  const byVerdict = new Map<string, number>();
  for (const [k, v] of t.cells) bump(byVerdict, k.split(CELL_SEP)[1] ?? "?");
  console.log("按 verdict 汇总:", show(byVerdict));
  if (t.unknownLayer.size > 0) console.log("⚠️ 表外 layer（GATE_LAYERS 没这一层）:", show(t.unknownLayer));
  if (t.unknownVerdict.size > 0) console.log("⚠️ 表外 verdict（GATE_VERDICTS 没这一种）:", show(t.unknownVerdict));
}

// 只在直接执行时跑读数：判卷要 import `tallyGateEvents`，模块加载不得有副作用（也不该扫盘）。
// 比较走 fileURLToPath——本仓路径里有空格，`import.meta.url` 会编码成 %20，endsWith 会比不中。
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
