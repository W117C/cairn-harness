// 状态簇·会话操作（Phase 2 · 批 2.3）。
//
// 分层契约（见 src/renderer/LAYERING.md）：本层**不含 JSX**、**不 import components/**；
// 钩子只吐「状态 + 动作」。搬移口径：代码逐行原样搬过来（判卷钉的是声明行与依赖数组的写法）。
//
// 装的是哪几样：会话级动作（重命名 / 置顶 / 分叉 / 跨面接力 / 隔离工作区 / 归档 / 删除）、
// 会话循环（⌘⇧] / ⌘⇧[ / Ctrl+Tab）、关会话回主页、回到主页（新建任务）。
// 为什么住一起：它们改的都是**同一条会话**，且互为对方的出口（归档当前会话 ⇒ 回主页；
// 回主页后要重开 ⇒ openSession）。
import { useCallback, useRef } from "react";
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";
import type { WorkspaceSession } from "../sessions-view";
import { STR } from "../strings";
import { toast } from "../toast";

export interface SessionOpsDeps {
  /** 当前会话（id 可能是 null）。 */
  activeId: string | null;
  /** 当前会话的镜像 ref（回调在事件时刻读最新值）。 */
  activeIdRef: React.MutableRefObject<string | null>;
  /** 会话清单。 */
  sessions: WorkspaceSession[];
  /** 刷清单。 */
  refreshSessions: () => Promise<void>;
  /** 切会话（只改身份，不载转录）。 */
  activate: (id: string | null) => void;
  /** 开会话（切 + 载转录 + 载队列）。 */
  openSession: (id: string, workspace?: string) => void;
  setLastError: (message: string, sessionId?: string) => void;
  setLastNotice: (message: string, sessionId?: string) => void;
  /** 改名换 id 时搬草稿桶。 */
  setDraftRemap: (v: { from: string; to: string; seq: number } | undefined) => void;
  draftRemapSeq: React.MutableRefObject<number>;
  /** 回主页：清事件流、清队列读回闸。 */
  setEvents: React.Dispatch<React.SetStateAction<AgentEvent[]>>;
  setQueueLoading: React.Dispatch<React.SetStateAction<boolean>>;
  /** 开会话竞态闸（回主页要让后来的回包作废）。 */
  openSeq: React.MutableRefObject<number>;
  /** 当前工作区（回主页时上报一次「用它」）。 */
  activeWorkspaceRef: React.MutableRefObject<string | null>;
  /** 「最近打开」上报。 */
  touchWorkspace: (path: string | null) => void;
  /** 在跑会话集合（关会话回主页要说清「后台还在跑」）。 */
  runningSet: React.MutableRefObject<Set<string>>;
  /** 归档必问闸 / 删除闸（那两张卡住在浮层簇，本簇只负责发起与执行）。 */
  setArchiveConfirm: (v: WorkspaceSession | null) => void;
  setDeleteConfirm: (v: WorkspaceSession | null) => void;
}

export interface SessionOpsState {
  /** 回主页（新建任务）：经 ref 触达（声明顺序解耦，dialog 回调用）。 */
  newSession: () => void;
  newSessionRef: React.MutableRefObject<(() => void) | null>;
  /** 会话循环：返回是否真的切了（快捷键层据此决定消费按键还是给回执）。 */
  cycleSession: (dir: 1 | -1) => boolean;
  /** 会话循环的带回执出口（静默无响应会被读成「键坏了」）。 */
  cycleSessionOrToast: (dir: 1 | -1) => void;
  /** 关闭当前会话回主页（⌘W 与菜单「关闭会话」同一出口）。 */
  closeSessionToHome: () => void;
  renameSessionById: (id: string, name: string) => Promise<void>;
  pinSessionById: (id: string, pinned: boolean) => Promise<void>;
  forkSessionFromMenu: (s: WorkspaceSession) => Promise<void>;
  openSessionInCli: (s: WorkspaceSession) => void;
  sessionWorktreeOp: (kind: "create" | "merge" | "discard", s: WorkspaceSession) => Promise<void>;
  doArchiveSession: (id: string, archived: boolean) => Promise<void>;
  requestArchiveSession: (s: WorkspaceSession, archived: boolean) => void;
  requestDeleteSession: (s: WorkspaceSession) => void;
  doDeleteSession: (id: string) => Promise<void>;
}

export function useSessionOps(deps: SessionOpsDeps): SessionOpsState {
  const {
    activeId, activeIdRef, sessions, refreshSessions, activate, openSession,
    setLastError, setLastNotice, setDraftRemap, draftRemapSeq, setEvents, setQueueLoading,
    openSeq, activeWorkspaceRef, touchWorkspace, runningSet, setArchiveConfirm, setDeleteConfirm,
  } = deps;

  const newSession = useCallback(() => {
    openSeq.current += 1;
    // 用户主动回主页 = 唯一该清「上次会话」的入口（启动恢复失败不再顺手清）。
    try { window.localStorage.removeItem("cairn.lastSession.v1"); } catch { /* 存不下则本会话内生效 */ }
    setQueueLoading(false);
    activate(null);
    setEvents([]);
    // 新任务默认落在当前项目（activeWorkspace）：这也是一次「用它」（最近打开序）。
    touchWorkspace(activeWorkspaceRef.current);
  }, [activate, touchWorkspace]);
  // dialog 回调经 ref 触达（声明顺序解耦）；赋值同步于每次渲染。
  const newSessionRef = useRef<(() => void) | null>(null);
  newSessionRef.current = newSession;

  // 会话循环（§3.6：⌘⇧] / ⌘⇧[，以及可关的 Ctrl+Tab）。返回是否真的切了——
  // 快捷键层据此决定「消费按键」还是「给一句回执」，不再出现空列表时静默吞键。
  const cycleSession = useCallback((dir: 1 | -1): boolean => {
    const list = sessions;
    if (list.length === 0) return false;
    const i = list.findIndex((s) => s.id === activeId);
    const idx = i < 0 ? (dir === 1 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    const target = list[idx];
    if (target === undefined) return false;
    openSession(target.id);
    return true;
  }, [sessions, activeId, openSession]);
  /** 切换会话（键位双入口与菜单共用一处出口）：无会话时给回执——静默无响应会被读成「键坏了」。
   *  这条回执此前在三个键位里各抄一份；菜单再抄两份就是五份，改口径时必然漏。 */
  const cycleSessionOrToast = useCallback((dir: 1 | -1): void => {
    if (!cycleSession(dir)) toast(STR.shortcut.noSession);
  }, [cycleSession]);
  /** 关闭当前会话回主页（⌘W 与菜单「关闭会话」同一出口）：主页按 = 可见回执；
   *  在跑的一轮回主页后仍在后台，也要说清楚（否则用户以为它被关掉了）。 */
  const closeSessionToHome = useCallback((): void => {
    const sid = activeIdRef.current;
    if (sid !== null) {
      const wasRunning = runningSet.current.has(sid);
      newSession();
      if (wasRunning) toast(STR.shortcut.leftRunning);
    } else {
      toast(STR.shortcut.alreadyHome);
    }
  }, [newSession]);

  // 行级会话操作（蓝本 §2.1）：重命名 / 置顶 / 分叉 / 归档——通道已存在，这里只做编排与 fail-visible。
  const renameSessionById = useCallback(async (id: string, name: string) => {
    try {
      const r = await window.agent.renameSession(id, name);
      if (activeIdRef.current === id) {
        if (r.id !== id) setDraftRemap({ from: id, to: r.id, seq: ++draftRemapSeq.current });
        activate(r.id); // 改名换 id：当前会话与新 id 同步（含 ref）
      }
      void refreshSessions();
    } catch (err) {
      setLastError(`重命名失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshSessions, activate]);
  const pinSessionById = useCallback(async (id: string, pinned: boolean) => {
    try {
      await window.agent.setSessionPinned(id, pinned);
      void refreshSessions();
    } catch (err) {
      setLastError(`置顶失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshSessions]);
  /** 对话菜单「分叉…」（第十四遍对齐原型 v3-lite 五项菜单）：全量分叉——round=0 是 desktop 侧
   *  「保留到最后一轮」的哨兵（main 按实际轮数命名 <id>-f<总>，与 CLI --from <总> 同源）；
   *  分叉成功即切过去继续干活。这里走 openSession 而非动作条的裸 activate：菜单能分**非当前**会话，
   *  只切 activeId 会把上一个会话的流留在屏上（显示与会话错位）；openSession = 切 + 载转录 + 载队列。 */
  const forkSessionFromMenu = useCallback(async (s: WorkspaceSession) => {
    try {
      const r = await window.agent.forkSession(s.id, 0, true);
      if (r.ok !== true || r.id === undefined) {
        setLastError(`分叉失败：${r.error ?? "未知原因"}`, s.id);
        return;
      }
      void refreshSessions();
      openSession(r.id);
    } catch (err) {
      setLastError(`分叉失败：${err instanceof Error ? err.message : String(err)}`, s.id);
    }
  }, [refreshSessions, openSession]);
  /** 跨面接力（规范 §3.9 · 必抄 #6）：桌面与 CLI 是**同一个 sessions 存储的两个面**。
   *  这里给出等价命令并复制到剪贴板——不假装能拉起终端（桌面没有那条通道，设了就是占位）。
   *  反向那一面由 CLI 收尾时打印「在桌面打开：<id>」接回来。 */
  const openSessionInCli = useCallback((s: WorkspaceSession) => {
    const cmd = `cairn --session ${s.id}`;
    void navigator.clipboard.writeText(cmd).then(
      () => { setLastNotice(`已复制：${cmd}——在终端粘贴后续跑（CLI 还需要一句任务描述）`); },
      (err: unknown) => { setLastError(`复制失败：${err instanceof Error ? err.message : String(err)}`); },
    );
  }, []);
  /** 会话级 worktree 隔离（§3.7 · G4）：三个动作共用一条 IPC。成功/失败都落到流尾那一行——
   *  隔离标记由 listSessions 读侧现算，所以动完必须刷新清单，否则菜单文案还是旧的。 */
  const sessionWorktreeOp = useCallback(async (kind: "create" | "merge" | "discard", s: WorkspaceSession) => {
    try {
      const r = await window.agent.sessionWorktree(
        kind === "create" ? { kind, sessionId: s.id, ...(s.title !== undefined ? { title: s.title } : {}) } : { kind, sessionId: s.id },
      );
      if (!r.ok) {
        // 冲突单独说：主 checkout 已被 abort 回干净态，用户的活还在隔离树里，不是丢了。
        setLastError(
          r.conflict === true
            ? `合并冲突：${(r.conflictedFiles ?? []).join("、")}——主工作区已恢复干净态，改动仍在隔离工作区里`
            : `${kind === "create" ? "隔离" : kind === "merge" ? "合并" : "丢弃"}失败：${r.error ?? "未知原因"}`,
          s.id,
        );
        void refreshSessions();
        return;
      }
      setLastNotice(
        kind === "create"
          ? `已隔离：下一条消息起写在这条会话自己的隔离工作区里${r.path !== undefined ? `（${r.path}）` : ""}`
          : kind === "merge"
            ? `已合并回主工作区${r.branch !== undefined ? `（${r.branch}）` : ""}`
            : "隔离工作区已丢弃",
        s.id,
      );
      if (r.warnings !== undefined && r.warnings.length > 0) setLastNotice(`隔离已建成，但有降级：${r.warnings.join("；")}`, s.id);
      void refreshSessions();
    } catch (err) {
      setLastError(`隔离工作区操作失败：${err instanceof Error ? err.message : String(err)}`, s.id);
    }
  }, [refreshSessions, setLastError, setLastNotice]);
  const doArchiveSession = useCallback(async (id: string, archived: boolean) => {
    try {
      await window.agent.setSessionArchived(id, archived);
      if (archived && activeIdRef.current === id) newSession(); // 归档的是当前会话 ⇒ 回主页
      void refreshSessions();
    } catch (err) {
      setLastError(`归档失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshSessions, newSession]);
  /** 归档必问（§3.3 硬闸：「归档任何会话前必问」，与权限档无关）；取消归档不问。 */
  const requestArchiveSession = useCallback((s: WorkspaceSession, archived: boolean) => {
    if (archived) setArchiveConfirm(s);
    else void doArchiveSession(s.id, false);
  }, [doArchiveSession]);
  // §6.3 删除会话：必问（不可撤销）→ 真删；删的是当前会话 ⇒ 回 settings.currentSession 指定的最近一个（core 已回退），无则回主页。
  const requestDeleteSession = useCallback((s: WorkspaceSession) => { setDeleteConfirm(s); }, []);
  const doDeleteSession = useCallback(async (id: string) => {
    try {
      const res = await window.agent.deleteSession(id);
      if (activeIdRef.current === id) {
        if (res.currentSession === null) newSession();
        else openSession(res.currentSession);
      }
      void refreshSessions();
    } catch (err) {
      setLastError(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [openSession, newSession, refreshSessions, setLastError]);

  return {
    newSession,
    newSessionRef,
    cycleSession,
    cycleSessionOrToast,
    closeSessionToHome,
    renameSessionById,
    pinSessionById,
    forkSessionFromMenu,
    openSessionInCli,
    sessionWorktreeOp,
    doArchiveSession,
    requestArchiveSession,
    requestDeleteSession,
    doDeleteSession,
  };
}
