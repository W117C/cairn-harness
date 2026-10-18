// 事件流：append-only JSONL，一事件一行。
// 本文件 = 存储引擎（常驻句柄缓存 / 半写尾行修复 / replay / forkSession）；协议面（类型 + KNOWN_TYPES）
// 住 ./types.ts。2026-10-17 从 index.ts 拆出（前 770 行是纯协议面，两张脸不再互相扰动行号）。公开面 = ./index.ts。
import { mkdir, open, readFile, stat, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { KNOWN_TYPES, type AgentEvent, type AssistantDeltaEvent } from "./types";

// ---- A1（P0-A）：事件落盘常驻文件句柄 ----
// 旧实现 appendFile 每事件 open+write+close（实测 1,930 µs/事件）；createEventLog().append 被
// loop 对每个事件（含每个流式 token 块）调用。改为常驻 FileHandle 直写（实测 9.83 µs，196×）：
// 有界句柄缓存 + 按 path 串行解析。逐事件立即 write——**不引入用户态缓冲**，「先落 JSONL 再回调」
// 与崩溃窗口语义不变（不做微批）。
const LOG_HANDLE_MAX = 32;
interface CachedHandle {
  fh: FileHandle;
  ino: number;
}
const logHandles = new Map<string, CachedHandle>();
/** 按 path 串行化句柄解析（照抄 replayChain 写法）：并发 append 在 await 间隙不得各开一次句柄。 */
const logHandleChain = new Map<string, Promise<FileHandle>>();

/** 半写尾行的扫描上限：尾段超过它仍无换行就**不猜边界**（见 `repairPartialTail` 的分支二）。 */
const TAIL_SCAN_CAP = 1 << 20;

/** 半写尾行修复（只在新开句柄时做，= 跨进程续写的唯一入口）：
 *  进程被硬杀在单次 `write` 中途时，文件尾可能留下**半条 JSON**。读者侧一直按「尾部半写可丢」
 *  容错（`replay`/`replayIncremental`），但写入侧此前没人补这一步——下一次 append 会把它和
 *  下一条事件拼成**一条**坏行，于是**新事件静默不可见**（2026-10-01 M8 侧发现并登记的边界，
 *  本笔收口）。这里把没成行的尾段裁掉并响亮告警：丢的是从未成行的字节，而读者本来就看不见它们。
 *  **只在尾部修**：文件中间的坏行不动——那是另一类事故，重放会当场抛；不许被这条修安静地抹掉。
 *
 *  2026-10-19 修一个真缺陷（分支二打偏）：旧代码用 `scanned < TAIL_SCAN_CAP` 当循环条件，
 *  退出时分不清「扫完全文都没换行」与「扫到上限就收手」——**小于一个 chunk（64KB）的文件
 *  一轮就把全文扫完**，`cut` 仍是 null，于是掉进分支二：补一个换行把半写尾段**留在文件里**。
 *  那不是隔离，是**把尾部坏行升级成中间坏行**：`replay` 见到"坏行后面还有好行"会当场抛
 *  `midBadLineError`（跳过会使事件 id 与行号错位）⇒ 整个会话永久打不开，只能手工修文件。
 *  实测复现：全新日志的第一个事件被硬杀在写中途（33 字节无换行），下一次 append 后
 *  `replay` 抛「有 1 条非尾部坏行（首在第 1 行）」，并先打一句假的「尾部超过 1MB 无换行」
 *  ——文件总共 33 字节。而这条路正是 headless run 的常见形状（`agent-runner.ts` 先 rm 日志）。
 *  修法：循环退出后先问「扫到哪儿了」。`pos === 0` ⇒ 全文已扫，边界是已知的（没有换行）
 *  ⇒ 裁到 0；只有真被上限挡住（`scanned >= TAIL_SCAN_CAP` 且 `pos > 0`）才走"不猜边界"那支。 */
async function repairPartialTail(path: string, fh: FileHandle): Promise<void> {
  const size = (await fh.stat()).size;
  if (size === 0) return;
  const last = Buffer.allocUnsafe(1);
  await fh.read(last, 0, 1, size - 1);
  if (last[0] === 0x0a) return; // 以换行收尾：没有半写尾行
  let pos = size;
  let scanned = 0;
  const chunk = 64 * 1024;
  let cut: number | null = null;
  while (pos > 0 && scanned < TAIL_SCAN_CAP) {
    const start = Math.max(0, pos - chunk);
    const len = pos - start;
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, start);
    const idx = buf.lastIndexOf(0x0a);
    if (idx >= 0) {
      cut = start + idx + 1; // 指向最后一个换行符之后
      break;
    }
    pos = start;
    scanned += len;
  }
  // 扫完全文仍无换行：边界已知（cut = 0）——整个文件都是没成行的尾段。
  // 与分支二的区别只在于"我们知不知道该裁在哪儿"，不在于文件大小。
  if (cut === null && pos === 0) cut = 0;
  if (cut !== null) {
    await fh.truncate(cut);
    console.warn(
      `[events] 检测到半写尾行（上次写入未完成，多半是被硬杀在写中途）：已丢弃未成行的 ${String(size - cut)} 字节并续写：${path}`,
    );
    return;
  }
  // 扫到上限仍无换行（文件真的很大且一个换行都没有）：不猜边界。补一个换行把劣质尾段隔离——
  // 这一支保持原样：那种文件不是半写一行，而是另一种事故，让重放**大声抛**（可见胜于静默）。
  await fh.write("\n");
  console.warn(
    `[events] 尾部超过 ${String(TAIL_SCAN_CAP / 1024 / 1024)}MB 无换行，放弃自动裁剪：已补换行隔离，重放会点名该坏行：${path}`,
  );
}

/** 解析（必要时新建）path 的常驻句柄。inode 校验是必须的：agent-runner 会先 rm(logPath) 再
 *  createEventLog——不校验会把事件写进已 unlink 的旧 inode（静默丢数据）。 */
async function resolveHandleInner(path: string): Promise<FileHandle> {
  const st = await stat(path).catch(() => null);
  const cached = logHandles.get(path);
  if (cached && st !== null && st.ino === cached.ino) return cached.fh; // 同 inode → 复用
  if (cached) {
    // 旧 inode 已被 unlink/替换：关掉旧句柄（忽略错误）并从缓存删除
    logHandles.delete(path);
    await cached.fh.close().catch(() => undefined);
  }
  // `a+` 而不是 `a`：半写尾行修复要在**同一句柄**上回读文件尾（`a` 是只写 fd，read 报 EBADF）。
  // 追加语义逐字不变（O_APPEND：写永远落在末尾），只多一个可读位。
  const fh = await open(path, "a+");
  await repairPartialTail(path, fh);
  const ino = (await fh.stat()).ino;
  if (logHandles.size >= LOG_HANDLE_MAX) {
    // 有界：淘汰最早插入的一条并关闭其句柄（照抄 replayCache 的淘汰写法；Map 插入序即 LRU-ish，
    // 不做访问序更新，保持简单）。
    const oldest = logHandles.keys().next().value;
    if (oldest !== undefined) {
      const old = logHandles.get(oldest);
      logHandles.delete(oldest);
      if (old) await old.fh.close().catch(() => undefined);
    }
  }
  logHandles.set(path, { fh, ino });
  return fh;
}

/** 串行化入口（照抄 replayIncremental）：同一 path 的解析按到达顺序执行，跑完即回收链（有界）。
 *  导出给同族的 append-only 写路径复用（scheduler journal），不另造一套缓存/链。 */
export async function resolveHandle(path: string): Promise<FileHandle> {
  const prev = logHandleChain.get(path);
  const job = (prev === undefined ? Promise.resolve() : prev.catch(() => undefined)).then(() =>
    resolveHandleInner(path),
  );
  logHandleChain.set(path, job);
  try {
    return await job;
  } finally {
    if (logHandleChain.get(path) === job) logHandleChain.delete(path); // 无并发即回收（有界）
  }
}

export interface EventLog {
  /** 追加一个事件到日志末尾；只追加，永不改写已有内容。 */
  append(event: AgentEvent): Promise<void>;
  /** A1：关闭本实例常驻句柄（可选）。退出路径由 closeAllEventLogs 统一收；单实例可显式回收。 */
  close?(): Promise<void>;
}

/** 创建绑定到日志路径的事件流。 */
export function createEventLog(path: string): EventLog {
  // A1 + X1：按实例缓存句柄引用 `cur`，但**每次 append 都核对它是否仍是缓存里的当前句柄**
  // （1 次 Map.get + 1 次指针比较，纳秒级，不引入 await）。有界缓存（LOG_HANDLE_MAX=32）淘汰、
  // 或 rm 重建 / invalidateEventLogHandle 显式失效后，cur 与缓存失配 → 自动重新 resolve，
  // 避免 write 到已关闭句柄（ERR_FILE_HANDLE_CLOSED）。真实触发路径：长会话里 32+ 个 sidechat/
  // 会话 path 会把主 run 的句柄挤出缓存并 close。
  let cur: FileHandle | null = null;
  return {
    async append(event) {
      if (!event || typeof event.type !== "string" || !Object.hasOwn(KNOWN_TYPES, event.type)) {
        throw new Error(`未知事件类型: ${JSON.stringify((event as { type?: unknown })?.type)}`);
      }
      // A8（审查）：轻量 payload 校验——{"type":"tool_result"} 缺 output 会一路流进
      // serializeConversation 并在压缩时抛错；写入口 fail-loud 比读路径深处的类型错误可诊断得多。
      if (event.type === "tool_result" && typeof (event as { output?: unknown }).output !== "string") {
        throw new Error("tool_result 事件缺 output 字符串（写入被拒）");
      }
      if (
        (event.type === "user_message" || event.type === "assistant_message") &&
        typeof (event as { content?: unknown }).content !== "string"
      ) {
        throw new Error(event.type + " 事件缺 content 字符串（写入被拒）");
      }
      // 校验全部通过后才解析句柄并 write（校验必须在 write 之前）。
      const cached = logHandles.get(path);
      if (cur === null || cached === undefined || cached.fh !== cur) cur = await resolveHandle(path);
      // 时钟戳盖在**落盘这一处**，不让每个生产者自己记得：`ts?: number` 曾声明在十个事件类型上，
      // 而真语料里 282 条 tool_call 一条都没带 ⇒ 工具耗时、轮耗时、「模型时间 vs 工具时间」占比
      // 在盘上全都不可测（可选字段当默认行为，等于没有行为）。producer 自带的值原样保留
      // （automation 那批本来就自己盖，覆盖会把它们的语义洗掉）。
      // **盖在事件本身上，不另造一份只存在于盘上的副本**：`ipc:check` 的「丢弃内存态 → 重放等价」
      // 与 `schedule-check` 的「append→replay 逐字无损」两条老不变量都要求 live 与盘同一个式子；
      // 副本让那两条恒红（2026-09-24 实测：ipc:check / schedule-check J1 J2 三门同时红，
      // 而单测面用 stripTs 各自绕过了它——同一件事在五个测试文件里各抄一份归一化，就是这种漏口的形状）。
      const holder = event as { ts?: number };
      if (holder.ts === undefined) holder.ts = Date.now();
      await cur.write(JSON.stringify(event) + "\n");
    },
    async close() {
      // 关闭本实例对应 path 的缓存句柄（仅当缓存中仍是本实例解析的那个）。不在 append 后自动关闭。
      if (cur === null) return;
      const cached = logHandles.get(path);
      if (cached && cached.fh === cur) {
        logHandles.delete(path);
        await cur.close().catch(() => undefined);
      }
      cur = null;
    },
  };
}

/** X2：查询某 path 当前是否已有常驻句柄（供调用方决定是否需要先建父目录——本机实测
 *  `mkdir(recursive)` ≈ 2.1ms/次，是 10k 级 append 的主成本，已解析过就必须跳过）。 */
export function hasEventLogHandle(path: string): boolean {
  return logHandles.has(path);
}

/** X2：显式失效某个 path 的常驻句柄（从缓存删除并 close，错误一律吞掉）。**幂等**（不存在时无操作）。
 *  用途：同路径文件被**覆盖写**（如 journal 的 read→rename 收敛）后，缓存句柄仍指向旧 inode，
 *  后续写入会静默丢失——必须显式失效，让下次写入重新 resolve 到新 inode。
 *  实例侧的 cur 引用会在下次 append 的核对中自然失配（cur !== 缓存当前句柄）→ 自动重新解析。
 *  ⚠️ 这是**显式契约，不是补丁**：当前 `resolveHandleInner` 的 inode 校验已能兜住 rename 覆盖
 *  （旧句柄 ino ≠ 新文件 ino → 自动关旧开新），保留本函数是为了**不依赖该隐式行为**，并在将来
 *  journal 路径也引入实例级句柄记忆化（如 X1 的 cur 快路径，会绕过 inode 校验）时仍然安全——
 *  **不要因为它看起来冗余就删掉**。 */
export async function invalidateEventLogHandle(path: string): Promise<void> {
  const cached = logHandles.get(path);
  if (cached === undefined) return;
  logHandles.delete(path);
  await cached.fh.close().catch(() => undefined);
}

/** A1：退出路径统一关闭全部常驻句柄（错误一律吞掉——退出路径不能抛）。 */
export async function closeAllEventLogs(): Promise<void> {
  const handles = [...logHandles.values()];
  logHandles.clear();
  for (const h of handles) await h.fh.close().catch(() => undefined);
}

/** 两条入口共用的「非尾部坏行」判据与文案：replay 与 replayIncremental 必须给同一个裁决——
 *  否则同一份损坏文件在全量入口炸、在增量入口静默产出错位投影（id=行号契约只在一条入口成立）。 */
function midBadLineError(path: string, midBad: number[]): Error {
  return new Error(
    `会话日志有 ${String(midBad.length)} 条非尾部坏行（首在第 ${String(midBad[0])} 行）：跳过会使事件 id 与 1-based 行号错位，` +
      `血缘/分支/压缩 id 全部失准，请修复该文件或从备份恢复: ${path}`,
  );
}

/** 重放：按写入顺序读回全部事件。untilEventId 给定时只重放到该事件点（含）。
 * 事件 id = 1-based 行号（append-only 保证永不漂移），即「事件点」。
 * A1（审查）：逐行容错——崩溃/并发写把尾行写成半行不再炸掉整会话（旧实现一行坏 = 所有
 * replay 调用点连锁失败 = 会话永久不可打开）。
 * 容错边界（审查 S1-4 修正）：只容忍**损坏后缀**（最后一个有效事件之后的坏行）。中段坏行
 * 不得跳过——「id = 1-based 行号」是跨文件契约（origin.source_event_ids、untilEventId、
 * compaction 的 compressed_event_ids、prune、promote 的 events[id-1] 全按此取事件），
 * 跳一行会让其后所有 id 静默错位一格：promote 取到错误的源消息、fork/回滚落错事件点。
 * 那种文件真已损坏，显式失败比静默错数据安全（与 agent-loop「不猜」的口径一致）。 */
export async function replay(path: string, untilEventId?: string): Promise<AgentEvent[]> {
  const raw = await readFile(path, "utf8");
  const events: AgentEvent[] = [];
  const badLines: number[] = []; // 坏行的 1-based 行号
  let lastGoodLine = 0;
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue; // 容忍文件末尾空行
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      badLines.push(i + 1); // 半写行/坏行：先记下，按位置决定容忍还是判坏
      continue;
    }
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
      badLines.push(i + 1); // 合法 JSON 但非事件对象（null / 123 / 数组）：同样按位置判定
      continue;
    }
    lastGoodLine = i + 1;
    events.push(parsed as AgentEvent);
  }
  const midBad = badLines.filter((l) => l < lastGoodLine);
  if (midBad.length > 0) throw midBadLineError(path, midBad);
  if (badLines.length > 0) console.warn(`[events] replay 跳过尾部 ${String(badLines.length)} 条坏行（降级容错）: ${path}`);
  if (untilEventId === undefined) return events;
  const n = Number(untilEventId);
  if (!Number.isInteger(n) || n < 1 || n > events.length) {
    throw new Error(`无效 untilEventId: ${JSON.stringify(untilEventId)}（会话共 ${events.length} 条事件）`);
  }
  return events.slice(0, n);
}

// ---- A5（审查根因 5）：增量重放——session-provider/sidechat 每轮全量读盘 → 只解析追加段 ----
// 会话 JSONL append-only：按 (ino, 完整行字节偏移) 缓存已解析事件数组，每轮只读尾部新行。
// 坏行裁决与 replay 同一条（共用 midBadLineError）：**尾坏可容、非尾坏必炸**，且「当时在尾部」
// 不是永久豁免——崩溃留下的半行会被下一次 append 粘成一条完整的坏行，此后再追加就成了中段坏行；
// 那时 replay 会抛，增量若继续静默跳过，缓存下标就与 1-based 行号错位（正是 S1-4 要防的）。
// 投影本身仍是每轮全量（O(n)），增量折叠需处理 compaction 失效语义——收口留位第三批。
const replayCache = new Map<string, ReplayCacheEntry>();
/** line = 已消费的完整行数（下一批第 i 行的绝对行号 = line + i + 1）；
 *  tailBad = 已跳过、当批仍在尾部的坏行行号（其后一旦出现新事件即转为非尾部 → 抛）。 */
interface ReplayCacheEntry { ino: number; offset: number; events: AgentEvent[]; line: number; tailBad: number[] }
const REPLAY_CACHE_MAX = 32;

function parseReplayLine(t: string): AgentEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") return null;
  return parsed as AgentEvent;
}

/** B8 同型（审查 S1-2）：共享缓存的「读尾部 + push + offset 推进」在 await 间隙会被并发
 *  消费方各推一次（主会话 assemble 与 sidechat 读主会话投影可同时在飞）=> 该轮投影重复事件、
 *  offset 越界。按 path 维护在途 Promise 链串行化，且每次交出副本，缓存本体不外泄。 */
const replayChain = new Map<string, Promise<AgentEvent[]>>();

export async function replayIncremental(path: string): Promise<AgentEvent[]> {
  const prev = replayChain.get(path);
  const job = (prev === undefined ? Promise.resolve() : prev.catch(() => undefined)).then(() => replayIncrementalInner(path));
  replayChain.set(path, job);
  try {
    return await job;
  } finally {
    if (replayChain.get(path) === job) replayChain.delete(path); // 无并发即回收（有界）
  }
}

async function replayIncrementalInner(path: string): Promise<AgentEvent[]> {
  let st;
  try {
    st = await stat(path);
  } catch {
    replayCache.delete(path); // 会话文件被清理：缓存同步失效
    return [];
  }
  const cached = replayCache.get(path);
  if (!cached || cached.ino !== st.ino || cached.offset > st.size) {
    // 首访 / 文件被重建（inode 变化）/ 被截断 → 全量解析并重建缓存
    const raw = await readFile(path, "utf8").catch(() => "");
    const events: AgentEvent[] = [];
    const bad: number[] = [];
    let offset = 0;
    let lastGood = 0;
    const allParts = raw.split("\n");
    const completeInit = raw === "" ? [] : allParts.slice(0, -1); // 最后一段是尾行（空串或半写）
    for (let i = 0; i < completeInit.length; i++) {
      const rawLine = completeInit[i];
      offset += Buffer.byteLength(rawLine, "utf8") + 1; // 完整行都推进偏移（含空行/坏行）
      const t = rawLine.trim();
      if (!t) continue;
      const e = parseReplayLine(t);
      if (e) { lastGood = i + 1; events.push(e); } else bad.push(i + 1);
    }
    const midBad = bad.filter((l) => l < lastGood);
    if (midBad.length > 0) throw midBadLineError(path, midBad); // 抛在写缓存之前：不留半份缓存
    if (bad.length > 0) console.warn(`[events] replayIncremental 跳过尾部 ${String(bad.length)} 条坏行（降级容错）: ${path}`);
    if (replayCache.size >= REPLAY_CACHE_MAX) {
      const oldest = replayCache.keys().next().value;
      if (oldest !== undefined) replayCache.delete(oldest);
    }
    const entry: ReplayCacheEntry = { ino: st.ino, offset: Math.min(offset, st.size), events, line: completeInit.length, tailBad: bad };
    replayCache.set(path, entry);
    return entry.events.slice(); // 交副本：消费方排序/清空不得影响缓存
  }
  // 增量：只读上次偏移之后的完整行（半写尾行留待完整落盘——不推进偏移、不重复解析）
  const len = st.size - cached.offset;
  if (len <= 0) return cached.events.slice();
  const fresh: AgentEvent[] = [];
  const bad: number[] = [];
  let lastGood = 0;
  let consumed = 0;
  let done = 0; // 本批消费的完整行数（含空行/坏行——它们同样占行号）
  const fh = await open(path, "r");
  try {
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, cached.offset);
    const text = buf.toString("utf8");
    const parts = text.split("\n");
    const complete = parts.slice(0, -1); // 最后一段是尾行（空串=到 EOF；否则半写）
    done = complete.length;
    for (let i = 0; i < complete.length; i++) {
      const rawLine = complete[i];
      consumed += Buffer.byteLength(rawLine, "utf8") + 1;
      const t = rawLine.trim();
      if (!t) continue;
      const abs = cached.line + i + 1;
      const e = parseReplayLine(t);
      if (e) { lastGood = abs; fresh.push(e); } else bad.push(abs);
    }
  } finally {
    await fh.close();
  }
  // 跨批裁决：上一批留下的尾坏，只要本批出现新事件就已离开尾部 ⇒ 与 replay 同判必炸。
  // 先算后写：抛出去时不碰缓存（偏移不推进 → 下次同一批重读，仍抛，不会退化成静默错位）。
  const midBad = [...(fresh.length > 0 ? cached.tailBad : []), ...bad.filter((l) => l < lastGood)];
  if (midBad.length > 0) throw midBadLineError(path, midBad);
  if (bad.length > 0) console.warn(`[events] replayIncremental 跳过尾部 ${String(bad.length)} 条坏行（降级容错）: ${path}`);
  cached.events.push(...fresh);
  cached.offset += consumed;
  cached.line += done;
  cached.tailBad = fresh.length > 0 ? [...bad] : [...cached.tailBad, ...bad];
  return cached.events.slice();
}

/** 流式渲染的合成基底：同一轮回复的增量片段按序拼回完整文本。 */
export function mergeAssistantDeltas(deltas: AssistantDeltaEvent[], callId?: string): string {
  return deltas
    .filter((d) => callId === undefined || d.callId === callId)
    .map((d) => d.text)
    .join("");
}

export interface ForkResult {
  /** 新会话目录。 */
  sessionDir: string;
  /** 新会话事件文件路径。 */
  eventsPath: string;
  /** 新会话事件条数 = N + 1（session_meta）。 */
  count: number;
}

/** 会话分支：从事件点 eventId 派生新会话目录。
 * 内容 = 原会话前 N 条（含该事件点）+ 一条 session_meta{branch_of: 原会话路径}。
 * 原会话文件只读，字节不变；新文件从空日志 append-only 写出。 */
export async function forkSession(sessionPath: string, eventId: string, targetDir?: string): Promise<ForkResult> {
  const all = await replay(sessionPath);
  const n = Number(eventId);
  if (!Number.isInteger(n) || n < 1 || n > all.length) {
    throw new Error(`无效 eventId: ${JSON.stringify(eventId)}（会话共 ${all.length} 条事件）`);
  }
  const dir = targetDir ?? join(dirname(sessionPath), `${basename(sessionPath, ".jsonl")}-fork-${Date.now()}`);
  const eventsPath = join(dir, "events.jsonl");
  await mkdir(dir, { recursive: true });
  const log = createEventLog(eventsPath);
  for (const e of all.slice(0, n)) await log.append(e);
  await log.append({ type: "session_meta", branch_of: sessionPath });
  return { sessionDir: dir, eventsPath, count: n + 1 };
}
