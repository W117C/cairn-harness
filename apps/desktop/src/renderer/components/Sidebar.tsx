// 分组侧栏（M3-3 方案 A）：会话按归属工作区分组，分组标题＝路径末段，点击分组＝切换
// activeWorkspace（只决定**新任务**归属，不动任何在跑会话/当前流）；「＋ 添加工作区」
// 最小表单（文本输入绝对路径 → addProject 桥；Electron 原生选目录需 preload 加桥——留 M4）。
import { useState, type FormEvent } from "react";
import type { SessionInfoPayload } from "../../../../../src/main/ipc-protocol";
import { relativeTime } from "../projections";

/** host.listSessions() 的 desktop 扩展形状：每条带归属工作区（T1 合并清单的归组标记）。
 *  ipc-protocol 的 AgentApi.listSessions 尚未摊平该字段，渲染层以交叉类型收窄（同 aborted 先例）。 */
export type WorkspaceSession = SessionInfoPayload & { workspace: string };

export interface WorkspaceGroup {
  /** 注册工作区的 canonical 绝对路径；「其他」组＝OTHER_WORKSPACE 哨兵。 */
  workspace: string;
  sessions: WorkspaceSession[];
}

/** 「其他」组哨兵：真实工作区恒为 canonical 绝对路径（project-registry realpath 保证），
 *  空串不可能与之相撞；切工作区入口对哨兵组关闭（新任务不能落未注册工作区）。 */
export const OTHER_WORKSPACE = "";

/** 分组纯函数（任务书 Interfaces 逐字）：已注册工作区全列（空组也列、保持注册顺序），
 *  会话按归属落组；未登记工作区的会话不丢——归「其他」组垫底（防 listProjects 与盘上
 *  漂移时静默吞数据）。workspaces 重复条目去重（registry 保 path 唯一，纯函数不信任上游）。 */
export function groupByWorkspace(
  sessions: readonly WorkspaceSession[],
  workspaces: readonly string[],
): WorkspaceGroup[] {
  const seen = new Set<string>();
  const groups: WorkspaceGroup[] = [];
  for (const workspace of workspaces) {
    if (seen.has(workspace)) continue;
    seen.add(workspace);
    groups.push({ workspace, sessions: sessions.filter((s) => s.workspace === workspace) });
  }
  const others = sessions.filter((s) => !seen.has(s.workspace));
  if (others.length > 0) groups.push({ workspace: OTHER_WORKSPACE, sessions: others });
  return groups;
}

/** 分组标题＝路径末段（注册工作区）；「其他」组显示固定名。 */
function workspaceLabel(workspace: string): string {
  if (workspace === OTHER_WORKSPACE) return "其他";
  return workspace.slice(workspace.lastIndexOf("/") + 1) || workspace;
}

function SessionRow(props: { session: WorkspaceSession; activeId: string | null; running: Set<string>; onOpen: (id: string) => void }) {
  const s = props.session;
  // 会话相对时间：updatedAt（ISO 串，可能缺席）优先，解析失败回退 mtimeMs，再失败不显示。
  const parsed = s.updatedAt ? Date.parse(s.updatedAt) : NaN;
  const timeMs = Number.isFinite(parsed) ? parsed : s.mtimeMs;
  return (
    <div key={s.id} className={"session" + (s.id === props.activeId ? " active" : "")} onClick={() => props.onOpen(s.id)}>
      <span className={"dot" + (props.running.has(s.id) ? " breathe" : "")} />
      <span>{s.title ?? s.id}</span>
      {Number.isFinite(timeMs) && <span className="row-time">{relativeTime(Date.now(), timeMs)}</span>}
    </div>
  );
}

export function Sidebar(props: {
  sessions: WorkspaceSession[];
  /** 已注册工作区（ProjectRecord.path，canonical 绝对路径）。 */
  workspaces: readonly string[];
  activeId: string | null;
  /** 当前新任务归属工作区；null＝host 缺省（尚未显式切换）。 */
  activeWorkspace: string | null;
  running: Set<string>;
  onOpen: (id: string) => void;
  onSwitchWorkspace: (workspace: string) => void;
  /** addProject 桥调用（App 提供）；reject 时错误落表单内 fail-visible。 */
  onAddWorkspace: (path: string) => Promise<void>;
  /** 注册表桥不可用等的提示行（fail-visible；null＝无）。 */
  notice?: string | null;
}) {
  const groups = groupByWorkspace(props.sessions, props.workspaces);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const path = draft.trim();
    if (path.length === 0) {
      setError("请输入工作区的绝对路径");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.onAddWorkspace(path);
      setDraft("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="sidebar">
      <div className="group-title">M0 · 工作区</div>
      {props.notice !== null && props.notice !== undefined && props.notice !== "" && (
        <div className="ws-notice">{props.notice}</div>
      )}
      {groups.map((g) => {
        // 「其他」组只是防吞数据的兜底展示：新任务不能落未注册工作区 ⇒ 头部不可点、不参与切换。
        const switchable = g.workspace !== OTHER_WORKSPACE;
        const active = g.workspace === props.activeWorkspace;
        return (
          <div key={g.workspace === OTHER_WORKSPACE ? "其他" : g.workspace} className="ws-group">
            <div
              className={"ws-header" + (switchable ? " switchable" : "") + (active ? " active" : "")}
              title={switchable ? g.workspace : undefined}
              onClick={switchable ? () => props.onSwitchWorkspace(g.workspace) : undefined}
            >
              <span>{workspaceLabel(g.workspace)}</span>
              <span className="ws-count">{g.sessions.length}</span>
            </div>
            {g.sessions.map((s) => (
              <SessionRow key={s.id} session={s} activeId={props.activeId} running={props.running} onOpen={props.onOpen} />
            ))}
          </div>
        );
      })}
      {/* M3 最小表单：文本输入绝对路径＋确认调 addProject（dialog 选目录需 preload 加桥——M4）。 */}
      <button
        className="btn-ghost ws-add"
        onClick={() => { setAdding((v) => !v); setError(null); }}
      >＋ 添加工作区</button>
      {adding && (
        <form className="ws-form" onSubmit={(e) => void submit(e)}>
          <input
            value={draft}
            placeholder="/绝对/路径/到/工作区"
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="ws-form-actions">
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? "添加中…" : "添加"}</button>
            <button className="btn-ghost" type="button" disabled={busy} onClick={() => { setAdding(false); setError(null); }}>取消</button>
          </div>
          {error !== null && <div className="form-error">{error}</div>}
        </form>
      )}
    </aside>
  );
}
