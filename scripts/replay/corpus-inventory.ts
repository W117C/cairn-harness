// 复跑面 · 登记项 `replay:corpus-inventory`（判卷读数：judgment-layer §7 末「定序依据」四项）
//
// 与 `ask-density` 同一条理由搬进脚本：heredoc 不过编译。这里另有一处**该被机器记住**的坑，
// 09-21 实踩过——`tool_call` 的关联字段叫 `id`，`tool_result` 的叫 `callId`；按 `callId` 去查 `tool_call`
// 会得到 `Map.has(undefined)` 恒 false ⇒ 打出「失败=0 / 原样重试=0」的一片零**假读数**
// （该页 §附录 B 自纠第二条记的就是这次）。所以 join 键在这里写成具名常量 + 一条断言，
// 而不是散在表达式里：读错键不再只是"数不对"，而是当场崩。
//
// 2026-09-23 又抓到两处**同方向（偏小）**的形状，都在这张表最后一行——那一行是
// 「要不要给主循环加换路压力」的决策依据（记忆 [[dsh-loop-repeat-blindspot]]：`detectStuck` 只服务 worker 看门）：
//  ⑴ 重复只认**紧邻**的下一个 `tool_call`：中间隔一次别的调用就逃过统计；
//  ⑵ 参数用 `JSON.stringify(原始对象)` 比：同一调用换个键序就被读成"改过参数"⇒「一字不变」偏低。
// 决策依据偏小的害处不是数错，是它会安静地让人得出"没证据 ⇒ 不动"。现在计数搬进纯函数
// `tallyInventory`（判卷 `tests/replay-corpus-inventory.test.ts` 四条正/反面对手），
// 并把结论印成一行 `repeatOfFailed` 的裁决，不再靠人自己心算。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isGatedTool, readJsonl, scanCorpus, corpusProblem } from "./corpus";

/** join 键：call 侧用 `id`，result 侧用 `callId`（两者不同名是本仓事件面的既有事实）。 */
const CALL_KEY = "id" as const;
const RESULT_KEY = "callId" as const;

export interface InventoryEvent {
  type: string;
  [CALL_KEY]?: string;
  [RESULT_KEY]?: string;
  name?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
}

export interface InventoryTally {
  calls: number;
  gated: number;
  nonAscii: number;
  /** 有 result 且 ok=false 的调用。 */
  failedCalls: number;
  /** 没有配对 result 的调用（进程切在调用中途是合法成因，但要看得见数量）。 */
  noResult: number;
  /** 失败之后，同会话内**再次**调同一工具（不限紧邻——旧写法只认紧邻，偏小）。 */
  retrySameName: number;
  /** 其中参数规范化后一字不变的那部分：这一格是"卡死"的直接证据。 */
  retryIdenticalArgs: number;
  /** 连续同 (工具, 参数) 且都失败的最长一段（只在失败序列上数，中间的成功调用不打断它）。 */
  maxSameFailedRun: number;
}

/** 参数规范化：递归按键排序再 stringify。键序不同的同一调用不得逃过统计。 */
export function canonicalArgs(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort()) out[k] = walk(src[k]);
      return out;
    }
    return v;
  };
  try {
    return JSON.stringify(walk(value ?? null));
  } catch {
    return "?"; // 循环引用等：读数面宁可给稳定占位，也不让整张表崩在一次统计里
  }
}

/** 纯函数：一个会话的事件 → 这张表的全部读数。断链即抛（不静默把"失败"读成 0）。 */
export function tallyInventory(events: readonly InventoryEvent[], file: string): InventoryTally {
  const t: InventoryTally = {
    calls: 0, gated: 0, nonAscii: 0, failedCalls: 0, noResult: 0,
    retrySameName: 0, retryIdenticalArgs: 0, maxSameFailedRun: 1,
  };
  const okByCall = new Map<string, boolean>();
  for (const e of events) {
    if (e.type !== "tool_result") continue;
    const key = e[RESULT_KEY];
    if (typeof key !== "string") {
      // 有 result 却带不上 callId = 事件面坏了，静默跳过会把「失败」读成 0（正是 09-21 踩的形状）
      throw new Error(`corpus-inventory：tool_result 缺 ${RESULT_KEY}（${file}）——join 键断链，读数不可信`);
    }
    okByCall.set(key, e.ok === true);
  }
  const tc = events.filter((e) => e.type === "tool_call");
  const failed: { name: string; args: string }[] = [];
  tc.forEach((c, i) => {
    const cid = c[CALL_KEY];
    if (typeof cid !== "string") throw new Error(`corpus-inventory：tool_call 缺 ${CALL_KEY}（${file}）`);
    t.calls++;
    const name = String(c.name);
    const args = canonicalArgs(c.args);
    if (isGatedTool(name)) {
      t.gated++;
      const s = Object.values(c.args ?? {}).filter((v) => typeof v === "string").join(" ");
      if (/[^\x00-\x7F]/.test(s)) t.nonAscii++;
    }
    if (!okByCall.has(cid)) {
      t.noResult++;
      return;
    }
    if (okByCall.get(cid) !== true) t.failedCalls++;
    // 只看失败调用后面发生过什么：向后找同名调用（**不限紧邻**）。
    if (okByCall.get(cid) === false) {
      for (let j = i + 1; j < tc.length; j++) {
        const n = tc[j]!;
        if (String(n.name) !== name) continue;
        t.retrySameName++;
        if (canonicalArgs(n.args) === args) t.retryIdenticalArgs++;
        break;
      }
      failed.push({ name, args });
    }
  });
  // 失败序列上的连续同参数 run（一次成功调用不该把"同一件事连败三次"洗散）
  for (let i = 0; i < failed.length; i++) {
    let n = 1;
    while (i + n < failed.length && failed[i + n]!.name === failed[i]!.name && failed[i + n]!.args === failed[i]!.args) n++;
    t.maxSameFailedRun = Math.max(t.maxSameFailedRun, n);
  }
  return t;
}

/** 决策线：两条同时成立才给主 loop 加换路压力——深 run（≥3）且确有原样重试。 */
export function repeatOfFailed(t: Pick<InventoryTally, "maxSameFailedRun" | "retryIdenticalArgs" | "retrySameName" | "failedCalls">): { shouldAct: boolean; why: string } {
  const deepRun = t.maxSameFailedRun >= 3;
  const hasExactRepeat = t.retryIdenticalArgs > 0;
  const why =
    "失败=" + String(t.failedCalls) + " 失败后再调同工具=" + String(t.retrySameName) +
    " 参数一字不变=" + String(t.retryIdenticalArgs) + " 最深连败 run=" + String(t.maxSameFailedRun);
  if (deepRun && hasExactRepeat) {
    return { shouldAct: true, why: why + " ⇒ 有卡死证据（run≥3 且原样重试非零），该给主循环加换路压力" };
  }
  return { shouldAct: false, why: why + " ⇒ 无卡死证据（要 run≥3 且「参数一字不变」>0）；重复的主流形态是改完再读/换参数重试，不动主 loop" };
}

function main(): void {
  const scan = scanCorpus();
  const total: InventoryTally = {
    calls: 0, gated: 0, nonAscii: 0, failedCalls: 0, noResult: 0, retrySameName: 0, retryIdenticalArgs: 0, maxSameFailedRun: 1,
  };
  for (const f of scan.files) {
    const t = tallyInventory(readJsonl(f) as InventoryEvent[], f);
    total.calls += t.calls;
    total.gated += t.gated;
    total.nonAscii += t.nonAscii;
    total.failedCalls += t.failedCalls;
    total.noResult += t.noResult;
    total.retrySameName += t.retrySameName;
    total.retryIdenticalArgs += t.retryIdenticalArgs;
    total.maxSameFailedRun = Math.max(total.maxSameFailedRun, t.maxSameFailedRun);
  }
  const problem = corpusProblem(scan, total.calls);
  if (problem !== null) {
    console.error("⚠️ corpus-inventory 读数无意义：" + problem);
    process.exitCode = 1;
    return;
  }
  console.log("会话文件=" + String(scan.files.length), "tool_call=" + String(total.calls), "受管=" + String(total.gated), "受管含非ASCII=" + String(total.nonAscii));
  console.log("失败结果=" + String(total.failedCalls), "无配对result=" + String(total.noResult), "失败后仍调同一工具=" + String(total.retrySameName), "其中参数一字不变=" + String(total.retryIdenticalArgs));
  const v = repeatOfFailed(total);
  console.log("主循环换路压力：" + (v.shouldAct ? "**该动**" : "**不动**") + " —— " + v.why);
}

// 只在直接执行时跑读数：本文件现在**导出**纯函数给判卷 import，模块加载不得有副作用
// （否则一次 import 就去扫会话目录、还可能把 exitCode 改成 1 污染整张测试表）。
// 比较走 fileURLToPath——本仓路径里有空格，`import.meta.url` 会编码成 %20，endsWith 会比不中。
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
