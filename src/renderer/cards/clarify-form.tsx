// 澄清表单卡：渲染 clarify_requested 的问题（选项 → RadioGroup/Checkbox，缺省 → Input 自由补充），
// 提交经 card_action("form_submit") 把表单数据交回驱动方（合成 tool_result 挂回原 tool_use id）。
import { useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ClarifyAnswerMap, ClarifyQuestion } from "../../events";
import type { CardProps } from "./registry";

export interface ClarifyFormPayload {
  callId: string;
  questions: ClarifyQuestion[];
  /** 已提交后表单冻结（防重复提交）。 */
  submitted?: boolean;
}

export function ClarifyFormCard({ payload, onAction }: CardProps): React.ReactElement {
  const p = payload as unknown as ClarifyFormPayload;
  const [picked, setPicked] = useState<Record<number, string | string[]>>({});
  const [extra, setExtra] = useState<Record<number, string>>({});

  const submit = (): void => {
    const answers: ClarifyAnswerMap = {};
    p.questions.forEach((q, i) => {
      const selection = picked[i];
      const note = (extra[i] ?? "").trim();
      if (q.options?.length && q.multiSelect) {
        const labels = Array.isArray(selection) ? selection : [];
        answers[q.question] = note.length > 0 ? [...labels, note] : labels;
      } else if (q.options?.length) {
        const label = typeof selection === "string" ? selection : "";
        answers[q.question] = label.length > 0 ? label : note;
      } else {
        answers[q.question] = note;
      }
    });
    onAction?.("form_submit", { callId: p.callId, answers });
  };

  return (
    <Card size="sm">
      <CardHeader className="border-b px-3 py-2">
        <CardTitle className="text-sm">❓ 需要澄清（{String(p.questions.length)} 个问题）</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-3 py-3">
        {p.questions.map((q, i) => (
          <Field key={i}>
            <FieldLabel>
              {q.header ? `【${q.header}】` : ""}
              {q.question}
            </FieldLabel>
            {q.options?.length ? (
              q.multiSelect ? (
                <div className="flex flex-col gap-2">
                  {q.options.map((opt) => (
                    <Label key={opt.label} className="flex items-center gap-2 text-sm font-normal">
                      <Checkbox
                        checked={Array.isArray(picked[i]) && (picked[i] as string[]).includes(opt.label)}
                        disabled={p.submitted}
                        onCheckedChange={(checked) => {
                          const cur = Array.isArray(picked[i]) ? [...(picked[i] as string[])] : [];
                          setPicked({
                            ...picked,
                            [i]: checked ? [...cur, opt.label] : cur.filter((l) => l !== opt.label),
                          });
                        }}
                      />
                      {opt.label}
                      {opt.description ? (
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      ) : null}
                    </Label>
                  ))}
                </div>
              ) : (
                <RadioGroup
                  value={typeof picked[i] === "string" ? (picked[i] as string) : ""}
                  disabled={p.submitted}
                  onValueChange={(v) => setPicked({ ...picked, [i]: v })}
                >
                  {q.options.map((opt) => (
                    <Label key={opt.label} className="flex items-center gap-2 text-sm font-normal">
                      <RadioGroupItem value={opt.label} />
                      {opt.label}
                      {opt.description ? (
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      ) : null}
                    </Label>
                  ))}
                </RadioGroup>
              )
            ) : null}
            <Input
              placeholder="自由补充（可选）"
              disabled={p.submitted}
              value={extra[i] ?? ""}
              onChange={(e) => setExtra({ ...extra, [i]: e.target.value })}
            />
            <FieldDescription>补充说明会随选项一起回传给 agent。</FieldDescription>
          </Field>
        ))}
        <Button size="sm" className="w-fit" disabled={p.submitted} onClick={submit}>
          {p.submitted ? "已提交" : "提交"}
        </Button>
      </CardContent>
    </Card>
  );
}