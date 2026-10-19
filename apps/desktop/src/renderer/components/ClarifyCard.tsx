// C-15 ClarifyCard（2026-10-07 产品化重写）：进 .card 体系（与审批/方案卡同门面：card-head +
// chip + q-block + opts），淘汰旧 card-approval 裸样式路径。表单语义与必答校验不动（cards.ts 纯函数）。
import { useState } from "react";
import type { ClarifyAnswerMap, ClarifyQuestion } from "../../../../../src/events";
import { clarifyFormValues } from "./cards";
import { MessageSquare } from "lucide-react";

/**
 * 澄清卡（M2-5）：questions 渲染表单——options 有 ⇒ radio（单选）/ checkbox（multiSelect），
 * 无 ⇒ 文本框；提交组 ClarifyAnswerMap（key = 问题原文）交 submitClarify。
 * 表单态 key 直接用问题原文（与提交 key 同源，纯函数负责必答校验）。
 */
export function ClarifyCard(props: {
  callId: string;
  questions: ClarifyQuestion[];
  onSubmit: (callId: string, answers: ClarifyAnswerMap) => void;
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const setText = (question: string, text: string) => setValues((prev) => ({ ...prev, [question]: text }));
  const toggleMulti = (question: string, label: string) =>
    setValues((prev) => {
      const cur = Array.isArray(prev[question]) ? (prev[question] as string[]) : [];
      const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
      return { ...prev, [question]: next };
    });

  const submit = () => {
    try {
      setError(null);
      props.onSubmit(props.callId, clarifyFormValues(props.questions, values));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="ico-wait" aria-hidden="true"><MessageSquare size={15} /></span>
        <h3>需要澄清（{props.questions.length} 问）</h3>
        <span className="chip wait">回答后继续</span>
      </div>
      {props.questions.map((q, i) => {
        const hasOptions = Array.isArray(q.options) && q.options.length > 0;
        return (
          <div className="q-block" key={i}>
            {q.header && <div className="q-head">{q.header}</div>}
            <div className="q-text">{q.question}</div>
            {hasOptions ? (
              <div className="opts">
                {q.options!.map((o) => (
                  <label
                    key={o.label}
                    className={"opt" + (q.multiSelect === true
                      ? Array.isArray(values[q.question]) && (values[q.question] as string[]).includes(o.label)
                      : values[q.question] === o.label ? " on" : "")}
                    title={o.description ?? undefined}
                  >
                    <input
                      type={q.multiSelect === true ? "checkbox" : "radio"}
                      name={`${props.callId}:${i}`}
                      checked={q.multiSelect === true
                        ? Array.isArray(values[q.question]) && (values[q.question] as string[]).includes(o.label)
                        : values[q.question] === o.label}
                      onChange={() => (q.multiSelect === true ? toggleMulti(q.question, o.label) : setText(q.question, o.label))}
                    />
                    <span className="o-label">{o.label}</span>
                    {o.description && <span className="o-desc">{o.description}</span>}
                  </label>
                ))}
              </div>
            ) : (
              <div className="q-free">
                <input
                  type="text"
                  value={typeof values[q.question] === "string" ? (values[q.question] as string) : ""}
                  aria-label={q.question}
                  onChange={(e) => setText(q.question, e.target.value)}
                />
              </div>
            )}
          </div>
        );
      })}
      {error !== null && <div className="form-error">{error}</div>}
      <div className="card-actions">
        <button className="btn primary" onClick={submit}>提交回答</button>
        <span className="spacer" />
        <span className="consequence">带选项的问题必答；自由项可留空</span>
      </div>
    </div>
  );
}
