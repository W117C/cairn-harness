// 工作树页（2026-10-23）：把 `getState().worktree.orphans` 从「协议里有、界面看不见」接到可见面。
//
// 孤儿 = `.agents/wt-*` 目录里没有终态/收尾记录、也不在 orchestrator 归属表里的 worker 树。
// 只列不自动删：清理是显式动作，走 `window.agent.worktreeClean(name)`；主进程仍会再判一次归属
// （第 688 页）——展示层过滤不是删除决策的闸。
import { useState } from "react";
import { GitBranch } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";

export function WorktreesPane(props: {
  snap: { workspace: string; orphans: string[]; details?: { name: string; dirty: boolean }[] };
  onError: (message: string) => void;
  refresh: () => void;
}): React.JSX.Element {
  const [ask, setAsk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const clean = (name: string) => {
    setAsk(null);
    setBusy(name);
    void window.agent.worktreeClean(name, props.snap.workspace)
      .then((r) => {
        if (!r.ok) props.onError(r.error ?? "清理失败");
        else props.refresh();
      })
      .catch((err: unknown) => props.onError(`清理失败：${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setBusy(null));
  };

  return (
    <div className="ap-worktrees" data-workspace={props.snap.workspace}>
      <div className="ap-toolbar">
        <div className="ap-note">孤儿 worktree 只在没有归属时列出；运行中或待合并的树不会出现在这里。</div>
      </div>
      {props.snap.orphans.length === 0 ? (
        <div className="ap-empty">没有遗留的工作树。</div>
      ) : (
        <div className="ap-list" aria-label="孤儿工作树">
          {props.snap.orphans.map((name) => {
            const dirty = props.snap.details?.find((d) => d.name === name)?.dirty === true;
            return (
            <div className="ap-item" key={name} data-orphan={name} data-dirty={dirty ? "true" : "false"}>
              <GitBranch size={14} aria-hidden="true" />
              <span className="nm">wt-{name}</span>
              <span className="sub">孤儿 worktree</span>
              {dirty && <span className="sp-tag" style={{ color: "hsl(var(--color-risk-ink))" }}>有未提交改动</span>}
              <button
                className="mini-btn danger"
                disabled={busy === name}
                onClick={() => setAsk(name)}
              >{busy === name ? "清理中…" : "清理"}</button>
            </div>
            );
          })}
        </div>
      )}
      {ask !== null && (
        <ConfirmDialog
          title={`清理 wt-${ask}？`}
          note={props.snap.details?.find((d) => d.name === ask)?.dirty === true
            ? "该 worktree 有未提交改动；清理会删除目录与对应 agent 分支，未提交内容无法恢复。"
            : "会删除该 worktree 目录与对应 agent 分支；未提交的改动无法恢复。"}
          confirmLabel="清理"
          danger
          onClose={() => setAsk(null)}
          onConfirm={() => clean(ask)}
        />
      )}
    </div>
  );
}
