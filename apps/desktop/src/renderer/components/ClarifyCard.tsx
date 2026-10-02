import { useState } from "react";
import type { ClarifyAnswerMap, ClarifyQuestion } from "../../../../../src/events";
import { clarifyFormValues } from "./cards";

/**
 * 澄清卡（M2-5）：questions 渲染原生表单——options 有 ⇒ radio（单选）/ checkbox（multiSelect），
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
    <div className="card-approval card-clarify" style={{ borderLeftColor: "var(--text-3)" }}>
      <div style={{ fontWeight: 600 }}>需要澄清（{props.questions.length} 问）</div>
      {props.questions.map((q, i) => {
        const hasOptions = Array.isArray(q.options) && q.options.length > 0;
        return (
          <div className="q" key={i}>
            {q.header && <div className="q-header">{q.header}</div>}
            <div>{q.question}</div>
            {hasOptions ? (
              q.options!.map((o) => (
                <label key={o.label} title={o.description}>
                  <input
                    type={q.multiSelect === true ? "checkbox" : "radio"}
                    name={`${props.callId}:${i}`}
                    checked={q.multiSelect === true
                      ? Array.isArray(values[q.question]) && (values[q.question] as string[]).includes(o.label)
                      : values[q.question] === o.label}
                    onChange={() => (q.multiSelect === true ? toggleMulti(q.question, o.label) : setText(q.question, o.label))}
                  />
                  {o.label}
                </label>
              ))
            ) : (
              <input
                type="text"
                value={typeof values[q.question] === "string" ? (values[q.question] as string) : ""}
                onChange={(e) => setText(q.question, e.target.value)}
              />
            )}
          </div>
        );
      })}
      {error && <div className="form-error">{error}</div>}
      <div className="actions">
        <button className="btn-primary" onClick={submit}>提交</button>
      </div>
    </div>
  );
}
