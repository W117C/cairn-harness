import { useState } from "react";

export function Composer(props: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  return (
    <div className="composer">
      <div className="box">
        <input
          value={text}
          placeholder={props.disabled ? "会话运行中，输入将排队追加…" : "给 agent 派活…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) { props.onSend(text.trim()); setText(""); }
          }}
        />
        <span className="hint">⏎</span>
      </div>
    </div>
  );
}
