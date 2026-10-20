// M2d 记忆两层存储（§8.1.3 定稿）：项目层 .agent/{ARCHITECTURE.md,DECISIONS.md,preferences.md,memory/}，
// 全局层 <appData>/memory/（可配：M2D_MEMORY_HOME / initMemoryHome，测试用临时目录）。
// 读写是纯 fs 语义：frontmatter 解析往返不丢字段、modified 写入落账、索引 upsert、索引硬上限写入端拒绝。
// 本模块是唯一知道记忆文件布局的地方；remember 工具与注入器都经它读写（写入口收敛 §8.1.8 第 4 条）。
import { appendFile, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectAgentPath } from "../../app-data";
import { writeFileAtomic } from "../../atomic-write";

// ---- 布局常量（§8.1.3 定稿文件名）----
export const ROOT_FILES = {
  architecture: "ARCHITECTURE.md",
  decision: "DECISIONS.md",
  preference: "preferences.md",
} as const;
export const MEMORY_INDEX = "MEMORY.md";

/** Claude Code 四类型（§8.1.3 frontmatter 契约）。 */
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** 索引硬上限（§8.1.5：200 行 / 25KB，Claude Code 实测阈值）。 */
export const INDEX_MAX_LINES = 200;
export const INDEX_MAX_BYTES = 25 * 1024;

// ---- 全局层目录（应用数据目录下的 memory/；可配，测试用临时目录）----
let memoryHomeOverride: string | null = null;

/** electron 壳启动时注入 userData/memory；headless 用 M2D_MEMORY_HOME 或缺省家目录。 */
export function initMemoryHome(dir: string): void {
  memoryHomeOverride = dir;
}

export function globalMemoryDir(): string {
  if (process.env.M2D_MEMORY_HOME) return process.env.M2D_MEMORY_HOME;
  if (memoryHomeOverride) return memoryHomeOverride;
  return join(homedir(), ".config", "cairn", "memory");
}

export function projectMemoryDir(workspace: string): string {
  return projectAgentPath(workspace, "memory");
}

/** 根三文件路径（kind → 文件名映射 §8.1.4；仅项目层——全局层只有 memory）。 */
export function rootFilePath(workspace: string, kind: keyof typeof ROOT_FILES): string {
  return projectAgentPath(workspace, ROOT_FILES[kind]);
}

// ---- 错误分型（§8.1.4：「调用失败」与「无内容可沉淀」显式分型，mem0 main.py:963-969 教训）----
export type MemoryErrorCode =
  | "call_failed" // 参数/IO/用法错误
  | "empty_change" // 空变更 = 无内容可沉淀
  | "old_content_mismatch" // replace 精确命中失败（报错重试语义）
  | "index_overflow"; // 索引超硬上限（要求改写索引，不静默截断）

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;
  constructor(code: MemoryErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// ---- frontmatter（topic 正文契约：type + modified，正文原文优先）----
export interface TopicMeta {
  type: MemoryType;
  modified: string; // ISO8601
}

/** 解析 topic 文件：头部 --- 块取 key: value，其余为正文。无 frontmatter → 全文视为正文。 */
export function parseTopicDoc(raw: string): { meta: Partial<TopicMeta>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2] };
}

/** 渲染 topic 文件（canonical 形态；写入时系统落账 modified）。 */
export function renderTopicDoc(meta: TopicMeta, body: string): string {
  return "---\ntype: " + meta.type + "\nmodified: " + meta.modified + "\n---\n" + body;
}

/** frontmatter 往返：parse(render(x)) 逐字段一致（单测断言不丢字段）。 */
export function topicDocRoundtrip(meta: TopicMeta, body: string): { meta: Partial<TopicMeta>; body: string } {
  return parseTopicDoc(renderTopicDoc(meta, body));
}

// ---- topic 校验（文件名信任边界：拒绝路径穿越/绝对路径/非法字符）----
/** topic 名的规矩**只有这一支**：`validateTopic` 抛之前问的就是它。
 *  注入器要「跳过读不动的那一份，而不是让整段注入抛」，靠的是同一个谓词——
 *  在那边再抄一遍正则就是本仓反复判死的第二个事实源。 */
export const TOPIC_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

export function isCompliantTopic(topic: string): boolean {
  return typeof topic === "string" && TOPIC_NAME.test(topic);
}

export function validateTopic(topic: string): string {
  if (!isCompliantTopic(topic)) {
    throw new MemoryError("call_failed", "remember: topic 必须是 1-64 位字母/数字/连字符/下划线（不含路径分隔符），收到: " + JSON.stringify(topic));
  }
  return topic;
}

// ---- 索引（MEMORY.md 一行一条；upsert 按 topic 键；摘要只允许出现在索引行）----
export function indexLine(topic: string, type: string, modified: string, firstLine: string): string {
  const digest = firstLine.replace(/\s+/g, " ").trim().slice(0, 80);
  return "- " + topic + " · " + type + " · " + modified + " · " + digest;
}

export function checkIndexLimit(projected: string): void {
  const lines = projected.split("\n").filter((l) => l.trim().length > 0).length;
  const bytes = Buffer.byteLength(projected, "utf8");
  if (lines > INDEX_MAX_LINES || bytes > INDEX_MAX_BYTES) {
    throw new MemoryError(
      "index_overflow",
      "remember: MEMORY.md 索引超硬上限（" + lines + " 行 / " + bytes + " 字节，上限 " + INDEX_MAX_LINES + " 行 / " + INDEX_MAX_BYTES + " 字节）——写入端拒绝，请改写索引：缩短/合并条目、把内容下沉到 topic 正文",
    );
  }
}

/** upsert 一条索引行（同 topic 旧行替换，新行落尾部）；返回投影后的索引全文。 */
export function upsertIndexLine(current: string, topic: string, line: string): string {
  const kept = current
    .split("\n")
    .filter((l) => l.trim().length > 0 && !l.startsWith("- " + topic + " ·"));
  kept.push(line);
  return kept.join("\n") + "\n";
}

async function readIndex(dir: string): Promise<string> {
  return (await readOrNull(join(dir, MEMORY_INDEX))) ?? "";
}

// ---- 外部引用审批状态（§8.1.8 第 3 条：@path 工作区外 → 首次批准，拒绝则停用）----
export interface ExternalRefState {
  approved: string[];
  declined: string[];
}

function externalRefsPath(): string {
  return join(globalMemoryDir(), "external-refs.json");
}

/** 读取；文件缺失 = 首启无历史（正常静默）；文件存在但损坏/畸形 = 审批决议无痕蒸发
 *  （批准过的 @path 全部回到未批准、拒绝记录也丢失），必须经 onCorrupt 显式告警并继续
 *  按空态走——空态 = 无一批准，方向 fail-closed。
 *  先例：`src/routing/bandit.ts` 的 `loadBanditState`（同一族，P2 审查修过）。 */
export async function loadExternalRefState(
  onCorrupt: (reason: string) => void = (reason) => console.warn("[memory] " + reason),
): Promise<ExternalRefState> {
  const path = externalRefsPath();
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<ExternalRefState>;
    if (!Array.isArray(raw.approved) || !Array.isArray(raw.declined)) {
      throw new Error("approved/declined 字段不是数组");
    }
    return { approved: raw.approved, declined: raw.declined };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      onCorrupt("外部引用审批状态损坏，已按空态继续（决议记录丢失，需重新确认）：" + path + "：" + (err instanceof Error ? err.message : String(err)));
    }
    return { approved: [], declined: [] };
  }
}

/** 审批决议落账（approved/declined 二选一入集）；拒绝 = 该引用此后停用（不再询问）。
 *  E9（审查 P2）：read-modify-write 全程按全局键串行 + 唯一 tmp 名——旧实现固定 .tmp 并发
 *  clobber、并发决议互相覆盖。 */
const writeChains = new Map<string, Promise<unknown>>();
function serializeOn<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(job);
  writeChains.set(key, next);
  void next.then(
    () => {
      if (writeChains.get(key) === next) writeChains.delete(key); // 无并发即回收（有界）
    },
    () => {},
  );
  return next;
}

export async function saveExternalRefDecision(ref: string, approved: boolean): Promise<void> {
  return await serializeOn("external-refs", async () => {
    const state = await loadExternalRefState();
    const next: ExternalRefState = {
      approved: approved ? [...new Set([...state.approved, ref])] : state.approved,
      declined: approved ? state.declined : [...new Set([...state.declined, ref])],
    };
    await writeFileAtomic(externalRefsPath(), JSON.stringify(next, null, 2));
  });
}

// ---- 写路径（remember 唯一写入口的底层）----

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** 追加根文件（日志型：DECISIONS）。
 *  E9（审查 P2）：追加走 appendFile（O_APPEND 单写）——旧实现 read-modify-write 整文件重写，
 *  并发追加互相覆盖（后写者带着旧全文，先写者的条目被抹掉）。分隔换行只看文件末字节。 */
export async function appendRootFile(workspace: string, kind: keyof typeof ROOT_FILES, content: string): Promise<void> {
  const path = rootFilePath(workspace, kind);
  // E9 收口（审查 S2-14）：末字节探测与 appendFile 是两步，两个并发 remember（交互 run +
  // 定时 unattended run 同工作区）会读到同一个旧末字节 => 都判「无需补换行」=> 条目粘成
  // 一行，"## " 分块解析被破坏。整段按文件路径串行（与 writeTopic 按 dir 串行同口径）。
  await serializeOn(path, async () => {
    await ensureDir(projectAgentPath(workspace));
    let prefix = "";
    try {
      const fh = await open(path, "r");
      try {
        const st = await fh.stat();
        if (st.size > 0) {
          const buf = Buffer.alloc(1);
          await fh.read(buf, 0, 1, st.size - 1);
          if (buf[0] !== 0x0a) prefix = "\n";
        }
      } finally {
        await fh.close();
      }
    } catch {
      /* 文件不存在：无需分隔 */
    }
    await appendFile(path, prefix + content, "utf8");
  });
}

/* 整写根文件的**无条件**版本已被删除（2026-10-19）：
 * 它与 appendRootFile 抢同一个文件时**不拿锁**，整写那一份会把追加那笔静默盖掉，
 * 而两边都回执"已写入"。现在只有一条写路：`replaceRootFileIfMatches`（读-判-写整段在锁里，
 * 判据过期就拒），并发追加与替换**两笔都在**——替换要么被拒（内容已变），要么排在追加之后。 */


/** DECISIONS 追加一个决策条目（追加式日志；修订 = 新条目「取代 <旧条引用>」，旧条保留）。 */
export async function appendDecisionEntry(workspace: string, content: string, nowISO: string): Promise<void> {
  await appendRootFile(workspace, "decision", "## " + nowISO + "\n" + content.trim() + "\n");
}

/** 最近 N 条决策条目（注入用；条目以 "## " 行为界）。 */
export function recentDecisionEntries(raw: string, n: number): string[] {
  const blocks = raw.split(/^## /m).slice(1).map((b) => "## " + b.trimEnd());
  return blocks.slice(-n);
}

/** 写 topic 文件（frontmatter 系统落账 modified）+ 索引 upsert。
 *  索引硬上限在写盘前检查：投影超限 → index_overflow，topic 与索引都不写（不静默截断）。
 *  E9（审查 P2）：读索引→upsert→写索引全程按目录键串行，索引写走原子替换（tmp+rename）——
 *  旧实现索引直写，与 topic 文件可不同步、并发写互相 clobber。 */
export async function writeTopic(
  dir: string,
  topic: string,
  type: MemoryType,
  body: string,
  nowISO: string,
): Promise<{ bytes: number }> {
  validateTopic(topic);
  return await serializeOn(dir, async () => {
    const firstLine = (body.split("\n")[0] ?? "").trim();
    const projected = upsertIndexLine(await readIndex(dir), topic, indexLine(topic, type, nowISO, firstLine));
    checkIndexLimit(projected);
    await ensureDir(dir);
    const doc = renderTopicDoc({ type, modified: nowISO }, body);
    await writeFileAtomic(join(dir, topic + ".md"), doc);
    await writeFileAtomic(join(dir, MEMORY_INDEX), projected);
    return { bytes: Buffer.byteLength(doc, "utf8") };
  });
}

/** 追加一节到 topic（读-改-写**全程在锁里**）。
 *
 *  **为什么需要这一支**（2026-10-19 独立评审追出的 MEDIUM-HIGH）：`writeTopic` 拿的是**目录锁**
 *  （`serializeOn(dir, …)`），而追加形态的"读旧正文 → 拼新正文 → 写"原本**读在锁外**
 *  （`remember.ts` 先 `readTopicBody` 再 `writeTopic`）⇒ 两个并发追加都读到同一份旧正文，
 *  第二个写把第一个**整个盖掉**（两笔都回执"已写入"）。实测：并发追加 FROM-A / FROM-B ⇒
 *  盘上只剩 FROM-B。`writeTopic` 的锁只护住了"写"那一段，护不住"读-改-写"这一整段。
 *
 *  形状：把读-改-写搬进 store，由**持有锁的那一层**做（调用方不该知道有锁这件事——
 *  抄第二份锁/第二份读改写就是新的漏口）。`writeTopic` 的索引 upsert 也在同一把锁里，
 *  追加与索引不会不同步。 */
export async function appendTopic(
  dir: string,
  topic: string,
  type: MemoryType,
  text: string,
  nowISO: string,
): Promise<{ bytes: number }> {
  validateTopic(topic);
  return await serializeOn(dir, async () => {
    const prev = await readTopicBody(dir, topic);
    const body = prev === null ? text : prev.replace(/\n+$/, "") + "\n\n" + text;
    const firstLine = (body.split("\n")[0] ?? "").trim();
    const projected = upsertIndexLine(await readIndex(dir), topic, indexLine(topic, type, nowISO, firstLine));
    checkIndexLimit(projected);
    await ensureDir(dir);
    const doc = renderTopicDoc({ type, modified: nowISO }, body);
    await writeFileAtomic(join(dir, topic + ".md"), doc);
    await writeFileAtomic(join(dir, MEMORY_INDEX), projected);
    return { bytes: Buffer.byteLength(doc, "utf8") };
  });
}

/** 根三文件的**比较-替换**（CAS）：`expected` 必须逐字等于当前内容才改写。
 *
 *  **为什么 CAS 必须整段在锁里**（2026-10-19 独立评审追出的 MEDIUM-HIGH）：
 *  旧形状是"先读出来比一比、隔一会儿再整写"——判据与写**不在同一段临界区**⇒ 并发追加夹在
 *  中间时，CAS 判据已经过期（它比的是追加之前的内容），追加那笔被静默盖掉，
 *  而它回执的是"已写入"。实测：并发 `appendRootFile` + `replaceRootFile` ⇒ 盘上只剩整写那份。
 *  ⇒ 读、判、写三步放进**同一把路径锁**（与 appendRootFile 同一把），CAS 才是 CAS。
 *
 *  返回 `matched=false` 时**一个字节都没写**（由调用方报 old_content_mismatch）。 */
export async function replaceRootFileIfMatches(
  workspace: string,
  kind: keyof typeof ROOT_FILES,
  expected: string,
  content: string,
): Promise<{ matched: boolean; current: string | null }> {
  const path = rootFilePath(workspace, kind);
  return await serializeOn(path, async () => {
    const current = await readOrNull(path);
    if (current === null || current !== expected) return { matched: false, current };
    await ensureDir(projectAgentPath(workspace));
    await writeFileAtomic(path, content);
    return { matched: true, current };
  });
}

/** topic 的**比较-替换**（CAS）：同上，锁键是**目录**（索引 upsert 要在同一段里）。
 *  索引与 topic 文件不同步是另一类坏（同 E9 的旧账），所以这里不另开一把锁。 */
export async function replaceTopicIfMatches(
  dir: string,
  topic: string,
  type: MemoryType,
  expected: string,
  body: string,
  nowISO: string,
): Promise<{ matched: boolean; current: string | null }> {
  validateTopic(topic);
  return await serializeOn(dir, async () => {
    const current = await readTopicBody(dir, topic);
    if (current === null || current !== expected) return { matched: false, current };
    const firstLine = (body.split("\n")[0] ?? "").trim();
    const projected = upsertIndexLine(await readIndex(dir), topic, indexLine(topic, type, nowISO, firstLine));
    checkIndexLimit(projected);
    await ensureDir(dir);
    const doc = renderTopicDoc({ type, modified: nowISO }, body);
    await writeFileAtomic(join(dir, topic + ".md"), doc);
    await writeFileAtomic(join(dir, MEMORY_INDEX), projected);
    return { matched: true, current };
  });
}

/** 读 topic 正文（不含 frontmatter）。 */
export async function readTopicBody(dir: string, topic: string): Promise<string | null> {
  const raw = await readOrNull(join(dir, validateTopic(topic) + ".md"));
  if (raw === null) return null;
  return parseTopicDoc(raw).body;
}

// ---- 列举（记忆面板 / getState 快照；只读）----
export interface TopicEntry {
  topic: string;
  type: string;
  modified: string;
  bytes: number;
}

export async function listTopics(dir: string): Promise<TopicEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: TopicEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".md") || name === MEMORY_INDEX) continue;
    const raw = await readOrNull(join(dir, name));
    if (raw === null) continue;
    const { meta } = parseTopicDoc(raw);
    out.push({
      topic: name.slice(0, -3),
      type: meta.type ?? "unknown",
      modified: meta.modified ?? "",
      bytes: Buffer.byteLength(raw, "utf8"),
    });
  }
  return out.sort((a, b) => a.topic.localeCompare(b.topic));
}

export async function readTextOrNull(path: string): Promise<string | null> {
  return readOrNull(path);
}

/** 删除 topic（用户经记忆面板的专属删除权；模型无删除操作）。返回是否确有文件被删。 */
export async function deleteTopic(dir: string, topic: string): Promise<boolean> {
  validateTopic(topic);
  const path = join(dir, topic + ".md");
  // 审查 S2-11：必须与 writeTopic 同锁（dir 键）串行，索引走 tmp+rename。旧实现不在锁内
  // 且直写：并发 writeTopic 刚 rename 的新索引会被这里的旧全文覆盖（topic 文件在、
  // MEMORY.md 行丢 = 注入器与面板看不见），直写还可能被读到半截索引。
  return await serializeOn(dir, async () => {
    try {
      await unlink(path);
    } catch {
      return false;
    }
    const cur = await readIndex(dir);
    const kept = cur.split("\n").filter((l) => l.trim().length > 0 && !l.startsWith("- " + topic + " ·"));
    await writeFileAtomic(join(dir, MEMORY_INDEX), kept.length > 0 ? kept.join("\n") + "\n" : "");
    return true;
  });
}
