import { useState } from "react";

// disabled 语义 = 真禁用（M2 裁定）：input 加 disabled 属性、onKeyDown 再加一道运行中 guard
// （双保险：disabled input 本就收不到键盘事件，guard 兜住 disabled 翻转与测试直调的缝）、
// 视觉降不透明度（styles.css 不动，行内 style 施加 opacity）。
// 排队语义裁定（计划已定）：真排队需内核新增追加通道，AgentApi 无此面——placeholder 固定
// "会话运行中…"，不造「输入将排队追加」的假象（M3+ 内核提供追加通道再实装）。
export function Composer(props: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  return (
    <div className="composer">
      <div className="box" style={props.disabled ? { opacity: 0.55 } : undefined}>
        <input
          value={text}
          disabled={props.disabled}
          placeholder={props.disabled ? "会话运行中…" : "给 agent 派活…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (props.disabled) return;
            if (e.key === "Enter" && text.trim()) { props.onSend(text.trim()); setText(""); }
          }}
        />
        <span className="hint">⏎</span>
      </div>
    </div>
  );
}
