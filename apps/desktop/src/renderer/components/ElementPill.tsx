// 元素选择的短 chip（从 Composer 抽出：Composer 已顶到 1200 行帽）。
// 只负责一枚「<ellipse> 页面元素 ×」；完整选择器/HTML 留在 state 里，由发送时拼装。
import { Crosshair, X } from "lucide-react";
import type { PickedElement } from "../picked-element";
import { STR } from "../strings";

export function ElementPill(props: { element: PickedElement; onRemove: () => void }) {
  const e = props.element;
  return (
    <span className="element-pill">
      <button
        type="button"
        className="ep-main"
        title={`${e.selector}${e.snippet !== "" ? `\n${e.snippet}` : ""}`}
      >
        <Crosshair size={11} aria-hidden="true" />
        <span className="ep-name">{e.label}</span>
        <span className="ep-kind">{STR.composer.elementKind}</span>
      </button>
      <button
        type="button"
        className="ep-x"
        aria-label={STR.composer.elementRemove.replace("{label}", e.label)}
        title={STR.composer.elementRemoveTip}
        onClick={props.onRemove}
      ><X size={10} /></button>
    </span>
  );
}
