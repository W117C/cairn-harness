// 第 1132 页：权限 chip 与菜单从 Composer 拆出；外点/Esc 仍由 Composer 的 usePopoverDismiss 持有。
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { PermissionMode } from "../../../../../src/main/ipc-protocol";
import { MODE_LABEL, ModeDot, PermissionMenu, permissionConfirmCopy } from "./PermissionMenu";
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
  // 确认卡在场时弹层不再是菜单（没有 menuitem）：语义跟着内容走，触发钮的 haspopup 同步改口。
  const [confirming, setConfirming] = useState<PermissionMode | null>(null);
  useEffect(() => { if (!props.open) setConfirming(null); }, [props.open]);
  const confirmCopy = confirming === null ? null : permissionConfirmCopy(confirming);
  return (
    <div style={{ position: "relative", display: "inline-flex" }} ref={props.wrapRef} onKeyDown={props.onKeyDown}>
      <button
        className="ctl"
        aria-haspopup={confirming === null ? "menu" : "dialog"}
        aria-expanded={props.open}
        onClick={props.onToggle}
        disabled={props.disabled || props.running}
      >
        <ModeDot mode={props.mode} />
        <span>{modeInfo.label}</span>
        <span className="ctl-caret" aria-hidden="true"><ChevronDown size={10} /></span>
      </button>
      <Popover
        open={props.open}
        up
        role={confirming === null ? "menu" : "alertdialog"}
        aria-label={confirmCopy?.aria}
        style={{ minWidth: 280 }}
      >
        {props.open && (
          <PermissionMenu
            mode={props.mode}
            onModeChange={props.onModeChange}
            onClose={props.onClose}
            onConfirmingChange={setConfirming}
          />
        )}
      </Popover>
    </div>
  );
}
