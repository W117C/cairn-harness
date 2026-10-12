// C-32 ChangeSummaryCard（v2 输出优先）：一轮的文件改动聚合卡——工具行折叠后，文件改动在这里看。
// 文件行点击 = 行内展开该文件逐笔（path/change 徽标/快照留痕脚注）；>4 行折叠 +「全部 N 个文件」。
// 数据来自 turnChanges 纯投影（change 缺席标 unknown，不猜 created/modified）。
import { useState } from "react";
import { Ic } from "./icons";

const CHANGE_LABEL: Record<"created" | "modified" | "unknown", string> = {
  created: "新建",
  modified: "修改",
  unknown: "变更",
};

export interface TurnChangeGroup {
  round: number;
  files: Array<{ path: string; change: "created" | "modified" | "unknown"; snapshotId?: string }>;
}

export function ChangeSummaryCard(props: { group: TurnChangeGroup }) {
  const [showAll, setShowAll] = useState(false);
  const g = props.group;
  const visible = showAll ? g.files : g.files.slice(0, 4);
  const created = g.files.filter((f) => f.change === "created").length;
  const modified = g.files.filter((f) => f.change === "modified").length;
  return (
    <div className="changes-card">
      <div className="changes-head">
        <span className="cf-ico" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M1.8 4.4c0-.83.67-1.5 1.5-1.5h1.9l1.4 1.5h4.1c.83 0 1.5.67 1.5 1.5v3.7c0 .83-.67 1.5-1.5 1.5H3.3c-.83 0-1.5-.67-1.5-1.5Z"/></svg>
        </span>
        <span className="cf-t">已编辑 {String(g.files.length)} 个文件</span>
        <span className="cf-stats num">
          {created > 0 && <span className="cf-add">+{String(created)}</span>}
          {created > 0 && modified > 0 && " "}
          {modified > 0 && <span className="cf-del">~{String(modified)}</span>}
        </span>
        <span className="chip">第 {String(g.round)} 轮</span>
      </div>
      <div className="changes-list">
        {visible.map((f) => (
          <div key={f.path} className="change-item" title={f.snapshotId !== undefined ? "覆盖前快照已保留（.agent/snapshots）" : undefined}>
            <span className={`chip ${f.change === "created" ? "ok" : f.change === "unknown" ? "" : ""}`}>{CHANGE_LABEL[f.change]}</span>
            <span className="ci-path">{f.path}</span>
            {f.snapshotId !== undefined && (
              <span className="ci-stat" title={`快照：${f.snapshotId}`}>
                快照<span style={{ display: "inline-flex", verticalAlign: "-1px" }}><Ic.check size={10} /></span>
              </span>
            )}
          </div>
        ))}
        {g.files.length > 4 && !showAll && (
          <button className="changes-more" onClick={() => setShowAll(true)}>
            全部 {String(g.files.length)} 个文件 <span style={{ display: "inline-flex", verticalAlign: "-2px" }}><Ic.chevronDown size={11} /></span>
          </button>
        )}
      </div>
    </div>
  );
}
