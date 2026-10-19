// 开关控件（自旧 Switch 保留语义与判卷锚：role="switch"、aria-checked、状态文字、
// 保存中禁用可解释）。新设计改用 Radix 视觉骨架（sw/sw-knob 类由 tokens 驱动，
// 样式见 styles.css），组件接口与原判卷断言（已开启/已关闭/自定义词/title）不变。
import type { ReactNode } from "react";

export function Switch(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 无障碍名（也是判卷锚点）。 */
  label: string;
  /** 忙的时候禁用，并在 title 里说明原因（禁用不许没有解释）。 */
  busy?: boolean;
  disabled?: boolean;
  /** 归一化开关旁边那行状态字（缺省「已开启 / 已关闭」）。 */
  onText?: string;
  offText?: string;
  /** 额外的行尾内容（例如「需重启」之类的注记）。 */
  trailing?: ReactNode;
}): React.JSX.Element {
  const off = props.disabled === true || props.busy === true;
  const stateText = props.checked ? (props.onText ?? "已开启") : (props.offText ?? "已关闭");
  return (
    <span className="sw-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        className={"sw" + (props.checked ? " on" : "")}
        disabled={off}
        title={props.busy === true ? "保存中…" : `${props.label}：${stateText}`}
        onClick={() => { props.onChange(!props.checked); }}
      >
        <span className="sw-knob" aria-hidden="true" />
      </button>
      <span className={"sw-state" + (props.checked ? " on" : "")}>{props.busy === true ? "保存中…" : stateText}</span>
      {props.trailing}
    </span>
  );
}
