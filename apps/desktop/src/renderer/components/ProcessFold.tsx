// 过程带折叠行（2026-11-02 业主截图）：一轮的最终答复落地后，答复之前的一切收成**一行**。
//
// 形态沿用过程带既有的语法（左轨 + 图标 + 标题 + 细项），不新造一套：
// 思考行是「▸ 脑标 思考记录」、工具簇是「▸ 状态字形 N 次工具调用」，
// 这一行是它们两个的**上一层**——「▸ 脑标 思考与工具 · N 次工具调用 · M 段思考」。
// 点开 ⇒ 里面还是原来那些行（思考记录 / 工具簇 / 旁白），原样恢复。
import { BrainCircuit, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import type { ProcessSummary } from "../derived/process-fold";
import { STR } from "../strings";

export function ProcessFold(props: { children: React.ReactNode; summary: ProcessSummary }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const s = props.summary;
  return (
    <div className="process-fold" data-open={expanded ? "true" : "false"}>
      <button
        type="button"
        className="process-fold-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => { setExpanded(!expanded); }}
      >
        <span className="chev" aria-hidden="true"><ChevronRight size={10} /></span>
        <BrainCircuit className="process-fold-icon" size={14} aria-hidden="true" />
        <span className="process-fold-label">{STR.processFold.label}</span>
        {s.tools > 0 && <span className="process-fold-detail">{STR.processFold.toolCount.replace("{n}", String(s.tools))}</span>}
        {s.thinks > 0 && <span className="process-fold-detail">{STR.processFold.thinkCount.replace("{n}", String(s.thinks))}</span>}
        {s.failures > 0 && <span className="process-fold-failure">{STR.processFold.failureCount.replace("{n}", String(s.failures))}</span>}
      </button>
      {/* 2026-11-17（移植设计收敛 R5 B 档）：hidden 瞬切 → grid-rows 高度过渡 + fold-inner 裁剪层
           （与工具簇同一套手感）；收起态 data-open=false + aria-hidden（正文按钮收起后不可聚焦）。 */}
      <div id={id} className="process-fold-body" data-open={expanded ? "true" : "false"} aria-hidden={!expanded}><div className="fold-inner">{props.children}</div></div>
    </div>
  );
}
