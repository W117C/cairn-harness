// M6 教训面的**复发读数**：把「教训真的在起作用吗」做成一条能离线算、能判卷、且老实声明
// 自身局限的读数。
//
// 为什么另立一份而不是并进提炼器（`src/agent/memory/lessons.ts`）：那个模块回答「这条教训
// 该不该诞生」（纯函数 + 硬门），本模块回答「诞生之后，同类失败还复不复发」。输入相同
// （事件流），问的问题不同——把两个问题写进一个函数，只会让「没产出教训」与「产出了但没用」
// 在读数上同形。
//
// **零 IO、零模型、可单测**：本模块不读盘、不取时间。会话时间 `time` 由调用方给。
// 生产侧（`lessons-offline.ts`）取**该会话最后一个事件的时间戳**（`ts`，即会话收束时刻），
// 老日志没有 `ts` 则退到文件 mtime；两者都是毫秒纪元，可混排。
// 为什么取「最后一个事件」而不是第一个：教训由 `runSessionEndDistill` 在**会话收束时**落盘，
// 所以「这一场开始时有哪些教训可用」的锚点该是**上一场收束的时刻**，不是开场时刻。
//
// 排序键：`(time 升序, id 升序)`。`id` 只在 time 相等的日志之间做**确定性 tie-break**（同一批
// 语料重跑必须给出同一份读数），不承载语义。
//
// ⚠️ **口径（本模块的第一等产出，必须随读数一起印出来，别只活在这里）**：
//   本读数量的是**暴露与复发的相关性，不是因果**——它证不了「注入教训导致复发下降」。
//   两组（该类教训已可用 / 尚不可用）**不是随机分派**出来的，两个方向都有偏：
//   ① 教训只在**出现过该类失败**的会话里诞生 ⇒ 「可用组」先天更容易再次出现同类失败（选择效应）；
//   ② 「可用」是按我们的时间折演判的，而真实注入取决于当时盘上到底有没有那份记忆文件——
//      折演只是它的一个**代理**，代理偏了，率就偏了，而本读数看不见这个偏。
//   本机真语料百来份、覆盖两成 ⇒ 这个量级读不出任何统计显著差异。
//   **读出「一个正确的零」是合格结果；读出噪声却声称有效应才是失败。**
//
// 逐类的「本场出现了该类失败」口径 = **census 那一族**（与提炼器分开算的原始红拍计数），
// 这样才不会「用提炼器量提炼器的疗效」：
//   · `verify-red`    ⟸ `codeRed > 0`（有代码归因的验证红）
//   · `tool-streak`   ⟸ `toolFail > 0`（有归属工具的红拍）
//   · `repeat-action` ⟸ 该场**产出**了该类教训
// 第三条是**结构性妥协**，照实说：census 家族里没有「重复写向动作」这一列，而另抄一份签名
// 规则（`lessons.ts` 来源③的 `name + "\0" + JSON.stringify(args)`）就是第二份真相——
// 本仓点过名的缺陷族。所以退而用提炼器自身的产出当出现证据 ⇒ **repeat-action 那一行的两组
// 不是独立仪器量的**，读它的率时要知道这一点。
import { isEnvVerifyCause, type AgentEvent, type ToolResultEvent } from "../../src/events";
import { distillLessons, type LessonKind } from "../../src/agent/memory/lessons";

/** census（分母侧）：与提炼口径**分开**算的原始红拍计数——「有多少红」不依赖提炼器没漏。 */
export interface CensusCounts {
  /** 有代码归因（`cause` 非环境类或缺席）的验证红拍数。 */
  codeRed: number;
  /** 环境成因的验证红拍数（归 harness 侧，不进教训）。 */
  envRed: number;
  /** 查得到归属工具的红拍数。 */
  toolFail: number;
  /** 查不到 `tool_call` 的无归属红拍数——**不**进教训（无证据指针），这一列就是硬门在拦的量。 */
  orphanFail: number;
  /** `verify_result` 拍数（含绿拍）。 */
  verifyBeats: number;
}

/** 分母侧计数：与提炼口径分开算，好让读数里「有多少红」不必依赖提炼器没漏。
 *  （从 `lessons-offline.ts` 搬进来，只此一份——面与本模块读的是同一个函数，不是两份抄本。） */
export function census(events: AgentEvent[]): CensusCounts {
  const names = new Map<string, string>();
  const verifyIds = new Set<string>();
  for (const e of events) {
    if (e.type === "tool_call") names.set(e.id, e.name);
    if (e.type === "verify_result") { verifyIds.add(e.callId); }
  }
  let codeRed = 0;
  let envRed = 0;
  let verifyBeats = 0;
  for (const e of events) {
    if (e.type !== "verify_result") continue;
    verifyBeats += 1;
    if (e.ok) continue;
    if (isEnvVerifyCause(e.cause)) envRed += 1;
    else codeRed += 1;
  }
  let toolFail = 0;
  let orphanFail = 0;
  for (const e of events as ToolResultEvent[]) {
    if (e.type !== "tool_result" || e.ok) continue;
    if (verifyIds.has(e.callId)) continue;
    if (e.blockedBy !== undefined) continue;
    if (names.get(e.callId) === undefined) orphanFail += 1;
    else toolFail += 1;
  }
  return { codeRed, envRed, toolFail, orphanFail, verifyBeats };
}

/** 一场会话的最小事实：`id` 用于确定性 tie-break 与取会话名（`distillLessons` 从它取 session），
 *  `time` 由调用方给（本模块零 IO，不自己取时间），`events` 是已解析的事件流。 */
export interface SessionFacts {
  id: string;
  time: number;
  events: AgentEvent[];
}

/** 一组（可用 / 尚不可用）的分子分母。`rate === null` = 分母 0（没有可判的场次，不是「率是 0」）。 */
export interface RecurrenceGroup {
  /** 本组里「该类失败又出现了」的场次数（分子）。 */
  recurred: number;
  /** 本组的场次数（分母）。 */
  sessions: number;
  /** `recurred / sessions`；分母 0 ⇒ `null`（**不许**折成 0：没尺与读数为 0 不同形）。 */
  rate: number | null;
}

export interface RecurrenceRow {
  kind: LessonKind;
  /** 该类教训**在该场之前**已经落盘可用（由更早的会话产出）——暴露组。 */
  available: RecurrenceGroup;
  /** 该类教训**尚不可用**——对照组的另一半。 */
  unavailable: RecurrenceGroup;
}

export interface RecurrenceReading {
  /** 参与折演的会话数。**0 = 没有语料（没尺）**，不是「复发率 0」——调用方必须显式分开说。 */
  sessions: number;
  rows: RecurrenceRow[];
}

/** 「本场出现了哪些失败类」的判定表。写成 `Record<LessonKind, …>` 是刻意的：往 `LessonKind`
 *  加一类而忘了在这里配一格会**编译不过**（缺键 ⇒ TS 报错），不必等读数悄悄少一行。 */
const PRESENCE: Readonly<Record<LessonKind, (c: CensusCounts, produced: ReadonlySet<LessonKind>) => boolean>> = {
  "verify-red": (c) => c.codeRed > 0,
  "tool-streak": (c) => c.toolFail > 0,
  // 结构性妥协：census 家族没有这一列，见文件头。用提炼器自身的产出当「出现」证据。
  "repeat-action": (_c, produced) => produced.has("repeat-action"),
};

/** 类别清单从 `PRESENCE` 派生（单一事实源）：编译期由 `Record<LessonKind, …>` 兜住穷尽性。 */
const KINDS = Object.keys(PRESENCE) as LessonKind[];

const group = (recurred: number, sessions: number): RecurrenceGroup => ({
  recurred,
  sessions,
  rate: sessions === 0 ? null : recurred / sessions,
});

/** 折演这条读数：把会话按 `(time, id)` 升序排好，逐场判「该类教训此前是否已可用」与
 *  「本场是否又出现了该类失败」，累进两张率。纯函数，零 IO。
 *
 *  **可用性只在处理完某场之后才把它产出的类别加进去**——「该场**之前**」这条口径靠这个顺序
 *  落地，某场不为自己供料（否则每场都可用、对照组恒空，读数就废了）。 */
export function recurrence(sessions: readonly SessionFacts[]): RecurrenceReading {
  const ordered = [...sessions].sort((a, b) => (a.time - b.time) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const acc = new Map<LessonKind, { aNum: number; aDen: number; bNum: number; bDen: number }>();
  for (const k of KINDS) acc.set(k, { aNum: 0, aDen: 0, bNum: 0, bDen: 0 });
  const available = new Set<LessonKind>();
  for (const s of ordered) {
    const c = census(s.events);
    const produced = new Set<LessonKind>();
    for (const l of distillLessons(s.events, s.id)) {
      const k = l.evidence[0]?.kind;
      if (k !== undefined) produced.add(k);
    }
    for (const k of KINDS) {
      const present = PRESENCE[k](c, produced);
      const g = acc.get(k)!;
      if (available.has(k)) { g.aDen += 1; if (present) g.aNum += 1; }
      else { g.bDen += 1; if (present) g.bNum += 1; }
    }
    // 本场产出的教训从**下一场**起才可用（见上）。
    for (const k of produced) available.add(k);
  }
  return {
    sessions: ordered.length,
    rows: KINDS.map((k) => {
      const g = acc.get(k)!;
      return { kind: k, available: group(g.aNum, g.aDen), unavailable: group(g.bNum, g.bDen) };
    }),
  };
}

/** 读数自带的那句口径（**唯一一份**）：调用方必须把它印进输出，别在别处再写一句同义的
 *  ——两句迟早漂，而漂的那句会被当成「读数自己说的」。 */
export const RECURRENCE_CALIBER =
  "本读数量的是**暴露与复发的相关性，不是因果**——它证不了「注入教训导致复发下降」："
  + "两组不是随机分派（教训只在出现过该类失败的会话里诞生，可用组先天更易复发），"
  + "且这个样本量读不出任何显著差异。**读出「一个正确的零」是合格结果；读出噪声却声称有效应才是失败。**";
