// 工作树页（2026-10-23）：把 `getState().worktree.orphans` 从「协议里有、界面看不见」接到可见面。
//
// 孤儿 = `.agents/wt-*` 目录里没有终态/收尾记录、也不在 orchestrator 归属表里的 worker 树。
// 只列不自动删：清理是显式动作，走 `window.agent.worktreeClean(name)`；主进程仍会再判一次归属
// （第 688 页）——展示层过滤不是删除决策的闸。
import { useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { PageFrame } from "./PageFrame";

export function WorktreesPane(props: {
  snap: { workspace: string; orphans: string[]; details?: { name: string; dirty: boolean }[] };
  onError: (message: string) => void;
  refresh: () => void;
}): React.JSX.Element {
  const [ask, setAsk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 第 1107 页：dirty 状态原先每行 details.find + 确认框再 find；一次 Map 建好。
  // 第 1146 页：Map 按 details 记忆；清理确认/忙碌态变化不重建索引。
  const dirtyByName = useMemo(() => new Map((props.snap.details ?? []).map((d) => [d.name, d.dirty] as const)), [props.snap.details]);

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
    <PageFrame title="工作树" onRefresh={props.refresh}>
      <div className="ap-worktrees" data-workspace={props.snap.workspace}>
        <div className="ap-toolbar">
          <div className="ap-note">运行中、待合并的树不在此列。</div>
        </div>
        {props.snap.orphans.length === 0 ? (
          <div className="ap-empty">没有遗留的工作树。</div>
        ) : (
          <div className="ap-list" aria-label="孤儿工作树">
            {props.snap.orphans.map((name) => {
              const dirty = dirtyByName.get(name) === true;
              return (
              <div className="ap-item" key={name} data-orphan={name} data-dirty={dirty ? "true" : "false"}>
                <GitBranch size={14} aria-hidden="true" />
                <span className="nm">wt-{name}</span>
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
      </div>
      {ask !== null && (
        <ConfirmDialog
          title={`清理 wt-${ask}？`}
          note={dirtyByName.get(ask) === true
            ? "该 worktree 有未提交改动；清理会删除目录与对应 agent 分支，未提交内容无法恢复。"
            : "会删除该 worktree 目录与对应 agent 分支；未提交的改动无法恢复。"}
          confirmLabel="清理"
          danger
          onClose={() => setAsk(null)}
          onConfirm={() => clean(ask)}
        />
      )}
    </PageFrame>
  );
}
