// M2d 记忆两层存储（§8.1.3 定稿）：项目层 .agent/{ARCHITECTURE.md,DECISIONS.md,preferences.md,memory/}，
// 全局层 <appData>/memory/（可配：M2D_MEMORY_HOME / initMemoryHome，测试用临时目录）。
// 读写是纯 fs 语义：frontmatter 解析往返不丢字段、modified 写入落账、索引 upsert、索引硬上限写入端拒绝。
// 本模块是唯一知道记忆文件布局的地方；remember 工具与注入器都经它读写（写入口收敛 §8.1.8 第 4 条）。
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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
  return join(homedir(), ".config", "m0-agent", "memory");
}

export function projectAgentDir(workspace: string): string {
  return join(workspace, ".agent");
}

export function projectMemoryDir(workspace: string): string {
  return join(workspace, ".agent", "memory");
}

/** 根三文件路径（kind → 文件名映射 §8.1.4；仅项目层——全局层只有 memory）。 */
export function rootFilePath(workspace: string, kind: keyof typeof ROOT_FILES): string {
  return join(projectAgentDir(workspace), ROOT_FILES[kind]);
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
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
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
export function validateTopic(topic: string): string {
  if (typeof topic !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(topic)) {
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

export async function loadExternalRefState(): Promise<ExternalRefState> {
  try {
    const raw = JSON.parse(await readFile(externalRefsPath(), "utf8")) as Partial<ExternalRefState>;
    return { approved: raw.approved ?? [], declined: raw.declined ?? [] };
  } catch {
    return { approved: [], declined: [] };
  }
}

/** 审批决议落账（approved/declined 二选一入集）；拒绝 = 该引用此后停用（不再询问）。 */
export async function saveExternalRefDecision(ref: string, approved: boolean): Promise<void> {
  const state = await loadExternalRefState();
  const next: ExternalRefState = {
    approved: approved ? [...new Set([...state.approved, ref])] : state.approved,
    declined: approved ? state.declined : [...new Set([...state.declined, ref])],
  };
  await mkdir(globalMemoryDir(), { recursive: true });
  const tmp = externalRefsPath() + ".tmp";
  await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await rename(tmp, externalRefsPath());
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

/** 追加根文件（日志型：DECISIONS）。 */
export async function appendRootFile(workspace: string, kind: keyof typeof ROOT_FILES, content: string): Promise<void> {
  const path = rootFilePath(workspace, kind);
  await ensureDir(projectAgentDir(workspace));
  const cur = (await readOrNull(path)) ?? "";
  await writeFile(path, cur + (cur === "" || cur.endsWith("\n") ? "" : "\n") + content, "utf8");
}

/** 整写根文件（状态型 replace：old_content 已由调用方校验精确命中）；原子写。 */
export async function replaceRootFile(workspace: string, kind: keyof typeof ROOT_FILES, content: string): Promise<void> {
  const path = rootFilePath(workspace, kind);
  await ensureDir(projectAgentDir(workspace));
  const tmp = path + ".tmp";
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

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
 *  索引硬上限在写盘前检查：投影超限 → index_overflow，topic 与索引都不写（不静默截断）。 */
export async function writeTopic(
  dir: string,
  topic: string,
  type: MemoryType,
  body: string,
  nowISO: string,
): Promise<{ bytes: number }> {
  validateTopic(topic);
  const firstLine = (body.split("\n")[0] ?? "").trim();
  const projected = upsertIndexLine(await readIndex(dir), topic, indexLine(topic, type, nowISO, firstLine));
  checkIndexLimit(projected);
  await ensureDir(dir);
  const doc = renderTopicDoc({ type, modified: nowISO }, body);
  const path = join(dir, topic + ".md");
  const tmp = path + ".tmp";
  await writeFile(tmp, doc, "utf8");
  await rename(tmp, path);
  await writeFile(join(dir, MEMORY_INDEX), projected, "utf8");
  return { bytes: Buffer.byteLength(doc, "utf8") };
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
  try {
    await unlink(path);
  } catch {
    return false;
  }
  const cur = await readIndex(dir);
  const kept = cur.split("\n").filter((l) => l.trim().length > 0 && !l.startsWith("- " + topic + " ·"));
  await writeFile(join(dir, MEMORY_INDEX), kept.length > 0 ? kept.join("\n") + "\n" : "", "utf8");
  return true;
}
