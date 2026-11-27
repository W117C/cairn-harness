import { Check, X } from "lucide-react";
import { useEffect } from "react";
import { STR } from "../strings";

export interface FirstRunGuideProps {
  active: boolean;
  providerReady: boolean;
  projectReady: boolean;
  taskReady: boolean;
  onConnect: () => void;
  onChooseProject: () => void;
  onStart: () => void;
  onComplete: () => Promise<void>;
}

/** 非阻断式首次使用条：只标出下一步，真正操作仍落在现有设置、项目选择器和输入框。 */
export function FirstRunGuide(props: FirstRunGuideProps): React.JSX.Element | null {
  const complete = props.providerReady && props.projectReady && props.taskReady;
  useEffect(() => {
    if (props.active && complete) void props.onComplete();
  }, [complete, props.active, props.onComplete]);
  if (!props.active || complete) return null;
  const current = !props.providerReady ? 0 : !props.projectReady ? 1 : 2;
  const steps = [
    { key: "provider", label: STR.empty.firstRun.connect, done: props.providerReady, onClick: props.onConnect },
    { key: "project", label: STR.empty.firstRun.project, done: props.projectReady, onClick: props.onChooseProject },
    { key: "task", label: STR.empty.firstRun.task, done: props.taskReady, onClick: props.onStart },
  ];
  return (
    <section className="first-run-guide" aria-label={STR.empty.firstRun.label}>
      <div className="first-run-steps">
        {steps.map((step, index) => (
          <button
            key={step.key}
            type="button"
            className={"first-run-step" + (step.done ? " is-done" : "")}
            data-step={step.key}
            data-current={index === current ? "true" : undefined}
            aria-current={index === current ? "step" : undefined}
            onClick={step.onClick}
          >
            <span className="first-run-index" aria-hidden="true">
              {step.done ? <Check size={11} strokeWidth={2.2} /> : index + 1}
            </span>
            <span>{step.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="first-run-skip"
        aria-label={STR.empty.firstRun.skip}
        title={STR.empty.firstRun.skip}
        onClick={() => { void props.onComplete(); }}
      >
        <X size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </section>
  );
}
