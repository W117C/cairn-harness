// 面板层·五张确认闸（Phase 2 · 批 2.4）。
//
// 分层契约（见 src/renderer/LAYERING.md）：
//   · 本层**只吃 props、只吐事件**——不读全局状态、不自己取数据；
//   · 本层**不 import App.tsx**（I1）：否则 App → panes → App 成环，模块一热就循环解析。
//
// 五张闸同形（标题 + 后果说明 + 取消/确认），故合成一个组件：确认态由 props 给出，
// 事件由 props 给出（onConfirm/onClose），组件自己不含任何状态。
import type { ProjectRecord } from "../../../../../src/main/ipc-protocol";
import type { WorkspaceSession } from "../sessions-view";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ModalSurface } from "../components/ModalSurface";
import { STR } from "../strings";

export interface ConfirmScrimsProps {
  /** 回滚轮次确认（round 号码；null = 不在场）。 */
  revertConfirm: number | null;
  setRevertConfirm: (v: number | null) => void;
  doRevertTurn: (round: number) => void;
  /** 移除项目确认。 */
  projectRemoveConfirm: ProjectRecord | null;
  setProjectRemoveConfirm: (v: ProjectRecord | null) => void;
  doRemoveProject: (p: ProjectRecord) => void;
  /** 归档必问闸。 */
  archiveConfirm: WorkspaceSession | null;
  setArchiveConfirm: (v: WorkspaceSession | null) => void;
  doArchiveSession: (id: string, archived: boolean) => void;
  /** 删除会话闸。 */
  deleteConfirm: WorkspaceSession | null;
  setDeleteConfirm: (v: WorkspaceSession | null) => void;
  doDeleteSession: (id: string) => void;
  /** 丢弃隔离工作区闸。 */
  wtDiscard: WorkspaceSession | null;
  setWtDiscard: (v: WorkspaceSession | null) => void;
  sessionWorktreeOp: (kind: "create" | "merge" | "discard", s: WorkspaceSession) => void;
}

export function ConfirmScrims(props: ConfirmScrimsProps) {
  const {
    revertConfirm, setRevertConfirm, doRevertTurn,
    projectRemoveConfirm, setProjectRemoveConfirm, doRemoveProject,
    archiveConfirm, setArchiveConfirm, doArchiveSession,
    deleteConfirm, setDeleteConfirm, doDeleteSession,
    wtDiscard, setWtDiscard, sessionWorktreeOp,
  } = props;
  return (
    <>
      {/* 回滚轮次 / 移除项目的确认卡（2026-10-17：原生 confirm → 产品自绘）。 */}
      {revertConfirm !== null && (
        <ConfirmDialog
          title={`还原第 ${String(revertConfirm)} 轮的改动？`}
          note={"本轮新建的文件会删除；本轮之后又被改过的文件不会动，会列进「需手动处理」。"}
          confirmLabel="还原"
          danger
          onClose={() => setRevertConfirm(null)}
          onConfirm={() => { const round = revertConfirm; setRevertConfirm(null); doRevertTurn(round); }}
        />
      )}
      {projectRemoveConfirm !== null && (
        <ConfirmDialog
          title={STR.removeProject.title.replace("{name}", projectRemoveConfirm.name)}
          note={STR.removeProject.body}
          confirmLabel="移除"
          danger
          onClose={() => setProjectRemoveConfirm(null)}
          onConfirm={() => { const p = projectRemoveConfirm; setProjectRemoveConfirm(null); void doRemoveProject(p); }}
        />
      )}
      {/* 归档必问闸（§3.3 硬闸：所有权限模式下都问；取消归档不问）。 */}
      {archiveConfirm !== null && (
        <ModalSurface className="confirm-scrim" label="归档确认" onClose={() => setArchiveConfirm(null)}>
          <div className="confirm-card">
            <div className="cc-title">归档「{archiveConfirm.title ?? archiveConfirm.id}」？</div>
            <div className="cc-note">归档后会话移出常规列表，收进侧栏底部的「已归档」分组；随时能取消归档。归档不删任何内容。</div>
            <div className="cc-actions">
              <button className="mini-btn" onClick={() => setArchiveConfirm(null)}>取消</button>
              <button
                className="mini-btn primary"
                onClick={() => {
                  const target = archiveConfirm;
                  setArchiveConfirm(null);
                  void doArchiveSession(target.id, true);
                }}
              >归档</button>
            </div>
          </div>
        </ModalSurface>
      )}
      {/* 删除会话闸（§6.3 文案规范）：后果前置（删什么）+ 明示不可撤销 + 什么没被动（工作区文件）。 */}
      {deleteConfirm !== null && (
        <ModalSurface className="confirm-scrim" label="删除会话确认" onClose={() => setDeleteConfirm(null)}>
          <div className="confirm-card">
            <div className="cc-title">删除「{deleteConfirm.title ?? deleteConfirm.id}」？</div>
            <div className="cc-note">
              此操作无法撤销：该会话的全部记录将从磁盘删除（含旁路提升历史与队列残留）。<br />
              工作区里的文件不受影响——agent 改过的文件不会随会话回滚。
            </div>
            <div className="cc-actions">
              <button className="mini-btn" onClick={() => setDeleteConfirm(null)}>取消</button>
              <button
                className="mini-btn danger"
                onClick={() => {
                  const target = deleteConfirm;
                  setDeleteConfirm(null);
                  void doDeleteSession(target.id);
                }}
              >删除</button>
            </div>
          </div>
        </ModalSurface>
      )}
      {/* §3.7 · G4 丢弃隔离工作区闸：后果前置（哪棵树、会丢什么）+ 明示不可撤销。 */}
      {wtDiscard !== null && (
        <ModalSurface className="confirm-scrim" label="丢弃隔离工作区确认" onClose={() => setWtDiscard(null)}>
          <div className="confirm-card">
            <div className="cc-title">丢弃「{wtDiscard.title ?? wtDiscard.id}」的隔离工作区？</div>
            <div className="cc-note">
              此操作无法撤销：这块隔离工作区会被删除，里面未提交的改动一并消失。<br />
              主工作区不受影响——合并前它本来就没被动过。
            </div>
            <div className="cc-actions">
              <button className="mini-btn" onClick={() => setWtDiscard(null)}>取消</button>
              <button
                className="mini-btn danger"
                onClick={() => {
                  const target = wtDiscard;
                  setWtDiscard(null);
                  void sessionWorktreeOp("discard", target);
                }}
              >丢弃</button>
            </div>
          </div>
        </ModalSurface>
      )}
    </>
  );
}
