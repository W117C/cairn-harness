// 复跑面 · 登记项 `replay:prune-promise`（读数，不是门）
//
// 为什么要这一支：任务 #33 说「prune 打桩那句『需要时 read_file 取回』点的是绝对路径，
// 而 read_file 第一句就拒绝对路径 ⇒ 模型照做会白跑一轮」。那是一条**已经证到底**的缺陷
// （`scripts/probe-prune-recall.ts` 是真跑 `read_file` 的复现器），但它的影响面当时是**拍脑袋**的：
// 谁都知道"如果模型真去读过附件，这就是活缺陷；从没读过，就是潜在缺陷"，
// 可没人答得出这两种情况各对应多少笔——而 #33 的修法要动一处热文件（`glm-session` 的组装那一跳），
// 值不值得动，正好由这个数决定。
//
// 三态规矩（本仓点过名的）：这里区分
//   ① 语料里根本没出现过这句承诺（潜在，别为它动热文件）
//   ② 出现过、模型从未照做（**不得**读成"没问题"——不可得的东西不会有人尝试）
//   ③ 出现过、且模型照做了 ⇒ 这时如果 attemptOk=0 就是"每次都白跑一轮"，红
// 外加"零语料 = 没有尺"（复用 `corpusProblem`，与 ask-density / corpus-inventory 同一把尺）。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusProblem, corpusRoots, readJsonl, scanCorpus } from "./corpus";

/** 打桩里那句承诺的标记（与 `src/agent/prune.ts` 里拼接的那半句同源；改了那边要改这里）。 */
const STUB_MARK = "原文已存附件";
/**
 * #33 修法落地后新增的第二案措辞（`pruneRecallSuffix` 的「区外/未知」那一案：不递路径、明说取不到）。
 * 必须单列一数：假承诺那句话消失之后，只数 `STUB_MARK` 会永远得 0 ⇒ 这一支会把它读成
 * 「从没发射过、属潜在」，而真相是「**每一次裁剪都发射了一句能力缺席的诚实话**」。
 * 标记取整句里 prune 独有的那段，不取「模型侧读不到」——skill 截断那句也说这五个字，两支会被并成一桶。
 */
const HONEST_MARK = "原文已另存到会话附件";
/** 附件目录名（`src/agent/glm-session.ts` 里 `join(dirname(logPath), "prune-attachments")`）。 */
const ATTACH_MARK = "prune-attachments";
/** join 键：call 侧 `id`、result 侧 `callId`（不同名是事件面既有事实，读错键会得到一片零假读数）。 */
const CALL_KEY = "id" as const;
const RESULT_KEY = "callId" as const;

export interface PruneEvent {
  type: string;
  [CALL_KEY]?: string;
  [RESULT_KEY]?: string;
  name?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  output?: string;
}

export interface PrunePromiseTally {
  toolCalls: number;
  /** 打桩句（承诺）出现次数。 */
  stubs: number;
  /** 其中点了**绝对路径**的（=read_file 当场拒收的那一类）。 */
  stubsWithAbsPath: number;
  /** 诚实句（区外/未知那一案）发射次数：每次都是「取回能力缺席」，不是「有受害者照做后失败」。 */
  honestStubs: number;
  /** 模型真的拿附件路径去发起工具调用的次数（任何参数位）。 */
  attempts: number;
  /** 其中拿到 ok=true 回执的。 */
  attemptOk: number;
  /** 其中拿到 ok=false 的（配对得到的）。 */
  attemptFailed: number;
  /** 没配到回执的（进程切在调用中途是合法成因，但数量要看得见）。 */
  attemptNoResult: number;
}

const emptyTally = (): PrunePromiseTally => ({
  toolCalls: 0, stubs: 0, stubsWithAbsPath: 0, honestStubs: 0, attempts: 0, attemptOk: 0, attemptFailed: 0, attemptNoResult: 0,
});

/** 从打桩句里取出被点名的路径（`[原文已存附件 <path>，需要时 read_file 取回]`）。
 *  `u` 是 **flag**，得走 `new RegExp(pattern, "u")`——写成 `new RegExp(pattern).u.exec` 会被解析成
 *  取属性，得到 undefined（本文件的判卷第一次跑就是把它炸出来的）。 */
const STUB_PATH_RE = new RegExp(STUB_MARK + "\\s+([^\\s，,）)]+)", "u");

function stubPath(output: string): string {
  const m = STUB_PATH_RE.exec(output);
  return m?.[1] ?? "";
}

/** 参数里是否出现过附件目录（任何字符串位：path / file / command 都算"照那句做了"）。 */
function argsMentionAttachment(args: Record<string, unknown> | undefined): boolean {
  if (args === undefined) return false;
  return Object.values(args).some((v) => typeof v === "string" && v.includes(ATTACH_MARK));
}

export function tallyPrunePromise(events: readonly PruneEvent[]): PrunePromiseTally {
  const t = emptyTally();
  const attemptIds = new Set<string>();
  for (const e of events) {
    if (e.type === "tool_call") {
      t.toolCalls++;
      if (argsMentionAttachment(e.args) && e[CALL_KEY] !== undefined) {
        t.attempts++;
        attemptIds.add(e[CALL_KEY]);
      }
      continue;
    }
    if (e.type !== "tool_result") continue;
    const out = e.output ?? "";
    if (out.includes(STUB_MARK)) {
      t.stubs++;
      if (stubPath(out).startsWith("/")) t.stubsWithAbsPath++;
    } else if (out.includes(HONEST_MARK)) {
      t.honestStubs++;
    }
    const callId = e[RESULT_KEY] ?? "";
    if (attemptIds.has(callId)) {
      if (e.ok === true) t.attemptOk++;
      else if (e.ok === false) t.attemptFailed++;
    }
  }
  t.attemptNoResult = t.attempts - t.attemptOk - t.attemptFailed;
  return t;
}

export interface PrunePromiseVerdict {
  /** true = 有活受害者，该修（调用方须红着退出）。 */
  live: boolean;
  why: string;
}

/** 结论成一句有名字的话——不把"零命中"留给下一个人自己猜它是读数还是没有尺。 */
export function prunePromiseVerdict(t: PrunePromiseTally): PrunePromiseVerdict {
  const counts = `承诺=${String(t.stubs)}（点绝对路径 ${String(t.stubsWithAbsPath)}）` +
    ` 诚实句=${String(t.honestStubs)}` +
    ` 照做=${String(t.attempts)}（成功 ${String(t.attemptOk)} / 失败 ${String(t.attemptFailed)} / 无回执 ${String(t.attemptNoResult)}）`;
  if (t.attemptOk > 0) {
    return { live: false, why: counts + ` ⇒ 通道可用（成功 ${String(t.attemptOk)} 笔），#33 的修法可按"省一次失败"评估` };
  }
  // 「照做过但一次都没成」要分两种：真收到红回执 = 活缺陷；只有无回执 = 分辨不出
  // （进程切在调用中途是合法成因）。把后者也算成活缺陷，等于用没证据的那一类去要真钱/热文件。
  if (t.attemptFailed > 0) {
    return { live: true, why: counts + " ⇒ **活缺陷**：模型照那句做过，且收到的每一次都是失败回执——每一笔都是白跑的轮次" };
  }
  if (t.attempts > 0) {
    return { live: false, why: counts + " ⇒ 无从判定：照做过但没有一次配到回执（切在调用中途 / 事件面漂了），先修配对再谈该不该修" };
  }
  if (t.stubs > 0) {
    return {
      live: false,
      why: counts + " ⇒ 承诺发射过但**无人照做**：这不能读成「没问题」——一条走不通的路本来就不会有人走；" +
        "要判可得性得先造观测者（真会话里跑一次长上下文），不是在这里加断言",
    };
  }
  // 文案已改口、接线那半没做：诚实句每发射一次，就是「这条能力今天缺席一次」，而不是「从没触发过」。
  // 把这一态并进最后那句「潜在」会让下一个人以为 #33 已经不用管了（规则 88：后加的面接管旧面职责）。
  if (t.honestStubs > 0) {
    return { live: false, why: counts + " ⇒ 假承诺已被诚实句替换（没人再被白跑一轮），但诚实句本身计数：" +
      "附件每落一次区外就少一次可回取。缺的是「组装那一跳把 workspace 交给 prune」，不是文案" };
  }
  return { live: false, why: counts + " ⇒ 语料里从没发射过这句（prune 未在有附件的会话里触发过）：属**潜在**，" +
    "不值得为它动 `glm-session` 的组装那一跳；这一支留着，触发一次就会出数" };
}

function main(): void {
  const scan = scanCorpus();
  const total = emptyTally();
  for (const f of scan.files) {
    const t = tallyPrunePromise(readJsonl(f) as PruneEvent[]);
    total.toolCalls += t.toolCalls;
    total.stubs += t.stubs;
    total.stubsWithAbsPath += t.stubsWithAbsPath;
    total.honestStubs += t.honestStubs;
    total.attempts += t.attempts;
    total.attemptOk += t.attemptOk;
    total.attemptFailed += t.attemptFailed;
  }
  const problem = corpusProblem(scan, total.toolCalls);
  if (problem !== null) {
    console.error("⚠️ prune-promise 读数无意义：" + problem);
    process.exitCode = 1;
    return;
  }
  total.attemptNoResult = total.attempts - total.attemptOk - total.attemptFailed;
  console.log("会话文件=" + String(scan.files.length), "tool_call=" + String(total.toolCalls));
  // 读数范围必须是**字段**而不是"看起来扫过了"：真会话那一支若不在，这个 0 只覆盖合成语料。
  console.log("语料根=" + corpusRoots().join(" | "),
    scan.missingRoots.length > 0 ? "｜不存在（该支零语料）=" + scan.missingRoots.join(" | ") : "｜两支都在");
  const v = prunePromiseVerdict(total);
  console.log("prune 回取承诺：" + v.why);
  if (v.live) process.exitCode = 1;
}

// 只在直接执行时跑读数：本文件导出纯函数给判卷 import，模块加载不得有副作用
// （否则一次 import 就去扫会话目录、还可能把 exitCode 改成 1 污染整张测试表）。
// 比较走 fileURLToPath——本仓路径里有空格，`import.meta.url` 会编码成 %20，endsWith 会比不中。
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
