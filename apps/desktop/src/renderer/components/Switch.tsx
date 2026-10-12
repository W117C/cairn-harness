// ④ 统一的开关控件（用户实测反馈：设置里的按键「全只有勾选和不勾选」）。
//
// 为什么不用 `<input type="checkbox">`：一个裸复选框只表达「勾了没勾」，
// 而设置项需要三件额外信息 ——
//   ① **当前状态的人话**（已开启 / 已关闭），不然用户得从勾的形态反推；
//   ② **在忙**（保存中），此时要禁用并让禁用可解释，而不是点了没反应；
//   ③ **可点区域**：复选框的小方块只有十几像素，而整行才是人真正会点的地方。
//
// 用 `role="switch"` 而不是 `role="checkbox"`：屏幕阅读器会把开关读成"开/关"，
// 与界面语义一致（这也是 WAI-ARIA 对这类二元设置的推荐用法）。
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
        onClick={() => props.onChange(!props.checked)}
      >
        <span className="sw-knob" aria-hidden="true" />
      </button>
      <span className={"sw-state" + (props.checked ? " on" : "")}>{props.busy === true ? "保存中…" : stateText}</span>
      {props.trailing}
    </span>
  );
}
