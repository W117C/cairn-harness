// P1 主界面重做：会话侧栏视图纯函数（分组 / 时间桶 / 状态合成 / 段结构）。
// groupByWorkspace / OTHER_WORKSPACE / WorkspaceGroup 自 Sidebar.tsx 迁出——判据一字未动
// （判卷资产原样保留）；新增面全部纯函数、无 React 依赖、可判卷。
import type { SessionInfoPayload } from "../../../../src/main/ipc-protocol";
import { STR } from "./strings";

/** host.listSessions() 的 desktop 扩展形状：每条带归属工作区（T1 合并清单的归组标记）。 */
export type WorkspaceSession = SessionInfoPayload & { workspace: string };

/** 按 id + workspace 定位会话。id 是分钟级时间戳，跨项目可撞名；给了 workspace 就必须
 *  两个都对上，**不退回**同名 id（退回 = 打开另一个项目的转录）。缺省 workspace 保持旧行为。 */
export function findSessionByRef<T extends { id: string; workspace?: string }>(
  sessions: readonly T[],
  id: string,
  workspace?: string,
): T | undefined {
  return sessions.find((s) => s.id === id && (workspace === undefined || s.workspace === workspace));
}

export interface WorkspaceGroup {
  /** 注册工作区的 canonical 绝对路径；「其他」组＝OTHER_WORKSPACE 哨兵。 */
  workspace: string;
  sessions: WorkspaceSession[];
}

/** 「其他」组哨兵（P1 起显示名 = 「临时对话」）：真实工作区恒为 canonical 绝对路径
 *  （project-registry realpath 保证），空串不可能与之相撞；切工作区入口对哨兵组关闭。 */
export const OTHER_WORKSPACE = "";

/** 分组纯函数（判据与迁出前逐字相同）：已注册工作区全列（空组也列、保持注册顺序），
 *  会话按归属落组；未登记工作区的会话不丢——归「其他」组垫底（防 listProjects 与盘上
 *  漂移时静默吞数据）。workspaces 重复条目去重（registry 保 path 唯一，纯函数不信任上游）。 */
export function groupByWorkspace(
  sessions: readonly WorkspaceSession[],
  workspaces: readonly string[],
): WorkspaceGroup[] {
  // 组内排序（第十四遍，原型 §2.1「置顶于组内」）：置顶恒前；stable sort ⇒ 同层保持输入序（最近活动序）。
  const pinnedFirst = (list: readonly WorkspaceSession[]): WorkspaceSession[] =>
    [...list].sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true));
  const seen = new Set<string>();
  const groups: WorkspaceGroup[] = [];
  for (const workspace of workspaces) {
    if (seen.has(workspace)) continue;
    seen.add(workspace);
    groups.push({ workspace, sessions: pinnedFirst(sessions.filter((s) => s.workspace === workspace)) });
  }
  const others = sessions.filter((s) => !seen.has(s.workspace));
  if (others.length > 0) groups.push({ workspace: OTHER_WORKSPACE, sessions: pinnedFirst(others) });
  return groups;
}

/** 归档分区（2026-10-17）：归档会话移出常规项目组、单列「已归档」分组找回。
 *  修的是真机实证：归档写入成功但侧栏照常显示（P1 重写把筛选面丢了），
 *  归档卡上「移出常规列表 / 筛选已归档可找回」两句都成了空话。
 *  纯函数：保输入序、不修改入参、active 与 archived 互斥且并集等于入参。 */
export function splitArchived<T extends { archived?: boolean }>(
  sessions: readonly T[],
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const s of sessions) {
    if (s.archived === true) archived.push(s);
    else active.push(s);
  }
  return { active, archived };
}

/** 分组标题＝路径末段（注册工作区）；「其他」组显示固定名。 */
export function workspaceLabel(workspace: string): string {
  if (workspace === OTHER_WORKSPACE) return STR.sidebar.tempChats;
  return workspace.slice(workspace.lastIndexOf("/") + 1) || workspace;
}

/** 会话归属的**项目名**（行上标签用）。纯函数：查项目清单，把 `projectId` 翻成名字。
 *  查不到（项目被移除而归属还在）⇒ 退回**原始 id**：如实地显示它还指着什么，
 *  而不是编一个名字、也不是把标签藏起来（藏起来的归属等于没接）。
 *  没归属（`projectId` 缺席）⇒ null＝不画标签。 */
export function projectLabelFor(
  session: { projectId?: string },
  projects: readonly { id: string; name: string }[],
): string | null {
  const id = session.projectId;
  if (id === undefined || id === "") return null;
  return projects.find((p) => p.id === id)?.name ?? id;
}

/** 「归到项目」子菜单的条目。`projectId === null` 那一项是**取消归属**。 */
export interface ProjectMenuItem {
  /** 目标项目 id；取消归属那一条为 null。 */
  projectId: string | null;
  label: string;
}

/** 「归到项目」子菜单的条目表。纯函数（菜单是关着的 Radix 弹层，静态渲染里看不见 ⇒ 逻辑必须在这里可判）。
 *  - 没有可归属的项目 ⇒ 空表（子菜单整个不摆：不摆一个点不动的入口）。
 *  - 「取消归属」**只在已归属时**才有（没归属时摆它＝摆一个没用的动作）。 */
export function projectMenuItems(
  session: { projectId?: string },
  projects: readonly { id: string; name: string }[],
): ProjectMenuItem[] {
  if (projects.length === 0) return [];
  const items: ProjectMenuItem[] = projects.map((p) => ({ projectId: p.id, label: p.name }));
  if (session.projectId !== undefined && session.projectId !== "") {
    items.push({ projectId: null, label: STR.sessionProject.unassign });
  }
  return items;
}

// ---- 时间分组（brief 第二节：今天/昨天/过去7天/更早）----

export type TimeBucket = "today" | "yesterday" | "past7" | "earlier";
const TIME_ORDER: readonly TimeBucket[] = ["today", "yesterday", "past7", "earlier"];
export const TIME_BUCKET_ORDER = TIME_ORDER;

const dayStart = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** 会话的时间锚 = 文件 mtime：事件 append 会刷新它，这**就是**对话活动时间。
 *  `metadata.updatedAt` 是组织信息的修改时间（置顶/改名/归档/归项目都会写）——拿它当 recency，
 *  置顶一下就会把一小时前的会话显示成「刚刚」、并把它分进「今天」桶（2026-10-20 真机：
 *  置顶旧会话后侧栏时间从「1 小时前」跳成「刚刚」，而 JSONL mtime 没变）。 */
export function sessionTime(s: WorkspaceSession): number {
  return s.mtimeMs;
}

/** 桶判据用**日历日**边界（本地时区）：今天 → 昨天 → 过去 7 天 → 更早。 */
export function timeBucket(updatedMs: number, nowMs: number): TimeBucket {
  const today = dayStart(nowMs);
  if (updatedMs >= today) return "today";
  if (updatedMs >= dayStart(today - 86_400_000)) return "yesterday";
  if (updatedMs >= dayStart(today - 7 * 86_400_000)) return "past7";
  return "earlier";
}

/** 时间分组：空桶不列；桶序固定 今天→昨天→过去7天→更早；桶内保持输入序（stable）。 */
export function groupByTime(
  list: readonly WorkspaceSession[],
  nowMs: number,
): { bucket: TimeBucket; sessions: WorkspaceSession[] }[] {
  const buckets = new Map<TimeBucket, WorkspaceSession[]>();
  for (const s of list) {
    const b = timeBucket(sessionTime(s), nowMs);
    const arr = buckets.get(b);
    if (arr === undefined) buckets.set(b, [s]);
    else arr.push(s);
  }
  return TIME_ORDER
    .filter((b) => buckets.has(b))
    .map((b) => ({ bucket: b, sessions: buckets.get(b)! }));
}

// ---- 状态合成（诚实边界：只有本进程可见态；重启后归零是如实行为）----

export type SessionStatus = "running" | "waiting" | "failed" | "done" | "none";

/** 状态优先级：running > waiting > failed > done > none（活跃态压过历史态）。
 *  running/waiting 由 App 运行时集合给；lastOutcome 只记**本进程**观察到的轮末结果——
 *  会话终态不落盘（内核事件格式不动），重启后图标归零是诚实行为，不写假终态。 */
export function sessionStatus(input: { running: boolean; waiting: boolean; lastOutcome: "ok" | "failed" | undefined }): SessionStatus {
  if (input.running) return "running";
  if (input.waiting) return "waiting";
  if (input.lastOutcome === "failed") return "failed";
  if (input.lastOutcome === "ok") return "done";
  return "none";
}

// ---- 段结构（置顶恒前；其余按时间桶；判卷锚供侧栏渲染直接消费）----

export type SessionSection =
  | { kind: "pinned"; sessions: WorkspaceSession[] }
  | { kind: "time"; bucket: TimeBucket; sessions: WorkspaceSession[] };

/** 组内段：有置顶 ⇒ 置顶段（原序）在前，其余进时间桶（空桶不列）。 */
export function projectSections(list: readonly WorkspaceSession[], nowMs: number): SessionSection[] {
  const pinned: WorkspaceSession[] = [];
  const rest: WorkspaceSession[] = [];
  for (const s of list) (s.pinned === true ? pinned : rest).push(s);
  const sections: SessionSection[] = [];
  if (pinned.length > 0) sections.push({ kind: "pinned", sessions: pinned });
  for (const g of groupByTime(rest, nowMs)) sections.push({ kind: "time", bucket: g.bucket, sessions: g.sessions });
  return sections;
}

// ---- 拖拽分流（P1-4；纯函数先行——App 窗口级 drop 与 Composer 落点分流共用）----

/** drop 分流：目录恒进 projects（拖入即添加项目）；文件按是否在已注册项目内分流。
 *  路径前缀判定：path === project || path.startsWith(project + "/")（防 /repo/a 误吞 /repo/ab）。 */
export function classifyDrop(
  files: readonly { path: string; isDirectory: boolean }[],
  projectPaths: readonly string[],
): { projects: string[]; inProject: string[]; outside: string[] } {
  const projects: string[] = [];
  const inProject: string[] = [];
  const outside: string[] = [];
  const inProjectPath = (p: string): boolean =>
    projectPaths.some((root) => p === root || p.startsWith(root + "/"));
  for (const f of files) {
    if (f.isDirectory) projects.push(f.path);
    else if (inProjectPath(f.path)) inProject.push(f.path);
    else outside.push(f.path);
  }
  return { projects, inProject, outside };
}

// ---- 会话筛选（自 Sidebar.tsx 迁出；判据一字未动，词面改从 STR 取——值与原字面量相同）----
// P1 起侧栏 UI 不再常驻筛选入口（brief：次要操作收进 ⌘K 命令面板，P3-3 接线）；
// 纯函数与词表原样保留（判卷资产），词表只列有数据支撑的项。

export const SESSION_FILTERS = [
  { id: "all", label: STR.filter.all },
  { id: "running", label: STR.filter.running },
  { id: "pinned", label: STR.filter.pinned },
  { id: "archived", label: STR.filter.archived },
  { id: "scheduled", label: STR.filter.scheduled },
] as const;

export type SessionFilterId = (typeof SESSION_FILTERS)[number]["id"];

export const SESSION_FILTER_NOTE = STR.filter.note;

export function matchSession(
  s: { id: string; title?: string; pinned?: boolean; archived?: boolean; origin?: "scheduled" },
  input: { search: string; filter: SessionFilterId; running?: ReadonlySet<string> },
): boolean {
  const q = input.search.trim().toLowerCase();
  if (q !== "") {
    const hay = `${s.title ?? ""} ${s.id}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  switch (input.filter) {
    case "all":
      return true;
    case "running":
      return input.running?.has(s.id) === true;
    case "pinned":
      return s.pinned === true;
    case "archived":
      return s.archived === true;
    case "scheduled":
      return s.origin === "scheduled";
  }
}

export function filterSessions<T extends { id: string; title?: string; pinned?: boolean; archived?: boolean; origin?: "scheduled" }>(
  sessions: readonly T[],
  input: { search: string; filter: SessionFilterId; running?: ReadonlySet<string> },
): T[] {
  return sessions.filter((s) => matchSession(s, input));
}
