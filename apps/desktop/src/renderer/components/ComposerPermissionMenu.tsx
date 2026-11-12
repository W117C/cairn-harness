// 第 1132 页：权限 chip 与菜单从 Composer 拆出；外点/Esc 仍由 Composer 的 usePopoverDismiss 持有。
import { ChevronDown } from "lucide-react";
import type { PermissionMode } from "../../../../../src/main/ipc-protocol";
import { MODE_LABEL, ModeDot, PermissionMenu } from "./PermissionMenu";
import { Popover } from "./Popover";

export function ComposerPermissionMenu(props: {
  wrapRef: React.Ref<HTMLDivElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  mode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
  disabled: boolean;
  running: boolean;
}): React.JSX.Element {
  const modeInfo = MODE_LABEL[props.mode];
  return (
    <div style={{ position: "relative", display: "inline-flex" }} ref={props.wrapRef} onKeyDown={props.onKeyDown}>
      <button
        className="ctl"
        aria-haspopup="menu"
        aria-expanded={props.open}
        onClick={props.onToggle}
        disabled={props.disabled || props.running}
      >
        <ModeDot mode={props.mode} />
        <span>{modeInfo.label}</span>
        <span className="ctl-caret" aria-hidden="true"><ChevronDown size={10} /></span>
      </button>
      <Popover open={props.open} up role="menu" style={{ minWidth: 280 }}>
        {props.open && (
          <PermissionMenu mode={props.mode} onModeChange={props.onModeChange} onClose={props.onClose} />
        )}
      </Popover>
    </div>
  );
}
