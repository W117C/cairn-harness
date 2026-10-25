// C-20 权限档菜单（批 5 · 细则 §五「弹层与菜单（统一组件）」；P2-2 迁移 STR + 档位色点）。
// 列表态 = 每项色点 + 图标 + 标题 + 副标题两行；「自动」行 warning 图标 +「危险」小标签（不整行变色）；
// 选「自动」先走二次确认（PermissionConfirm）——确认前绝不调 onModeChange（危险动作不静默）。
// 词表（MODE_LABEL / MODE_DOT）与触发器共用，单一事实源在本文件；值全出处 STR（本文件零裸中文）。
import { Shield,ShieldAlert,ShieldCheck,ShieldOff } from "lucide-react";
import { useState } from "react";
import type { PermissionMode } from "../../../../../src/main/ipc-protocol";
import { STR } from "../strings";

/** 权限档词表：label 短词（触发器与条目共用）、desc 一句人话说明、warn = 危险档标记。 */
import { MODE_LABEL } from "../permission-labels";
export { MODE_LABEL } from "../permission-labels";

/** 档位色点（P2-2 · brief 三节：只读=灰绿 / 默认=蓝灰 / 引导=黄 / 自动=红）。
 *  值 = tokens.css 四枚语义变量的引用（亮暗双主题各给值，组件零字面色值纪律不破）。 */
export const MODE_DOT: Record<PermissionMode, string> = {
  "read-only": "var(--mode-readonly)",
  default: "var(--mode-default)",
  guided: "var(--mode-guided)",
  auto: "var(--mode-auto)",
};

/** 条目图标族（盾形谱：拒写 / 默认 / 引导 / 全放行）。 */
const MODE_ICON: Record<PermissionMode, typeof Shield> = {
  "read-only": ShieldOff,
  default: Shield,
  guided: ShieldCheck,
  auto: ShieldAlert,
};

const MODE_ORDER: readonly PermissionMode[] = ["read-only", "default", "guided", "auto"];

/** 色点展示件（触发器与菜单条目共用同一枚，几何/色值分主题由 tokens 定）。 */
export function ModeDot(props: { mode: PermissionMode }): React.JSX.Element {
  return (
    <span
      className="mode-dot"
      data-mode={props.mode}
      style={{ background: MODE_DOT[props.mode] }}
      aria-hidden="true"
    />
  );
}

export function PermissionMenu(props: {
  mode: PermissionMode;
  onModeChange: (m: PermissionMode) => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <PermissionConfirm
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          // 先清确认态再落档（防御：将来若改回常驻挂载，state 也不残留——真机实证过）。
          setConfirming(false);
          props.onModeChange("auto");
          props.onClose();
        }}
      />
    );
  }
  return (
    <>
      <div className="pop-label">{STR.permissionMenu.label}</div>
      {MODE_ORDER.map((m) => {
        const info = MODE_LABEL[m];
        const Ico = MODE_ICON[m];
        return (
          <button
            key={m}
            type="button"
            className="menu-item perm-item"
            role="menuitem"
            data-mode={m}
            onClick={() => {
              // 「自动」= 全部放行：没确认过就先出确认卡；确认前不动权限（危险不静默）。
              if (m === "auto" && props.mode !== "auto") {
                setConfirming(true);
                return;
              }
              props.onModeChange(m);
              props.onClose();
            }}
          >
            <ModeDot mode={m} />
            <span className={info.warn === true ? "perm-ico warn" : "perm-ico"}>
              <Ico size={13} aria-hidden="true" />
            </span>
            <span className="perm-text">
              <span className="perm-label">
                {info.label}
                {info.warn === true && <span className="tag-warn">{STR.permissionMenu.warnTag}</span>}
              </span>
              <span className="perm-desc">{info.desc}</span>
            </span>
            {m === props.mode && <span className="check">✓</span>}
          </button>
        );
      })}
    </>
  );
}

/** 「自动」二次确认卡（危险动作显式确认；确认按钮才是真切换）。 */
export function PermissionConfirm(props: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="perm-confirm" role="alertdialog" aria-label={STR.permissionMenu.confirmAria}>
      <div className="perm-confirm-title">{STR.permissionMenu.confirmTitle}</div>
      <div className="perm-confirm-desc">{STR.permissionMenu.confirmDesc}</div>
      <div className="perm-confirm-actions">
        <button type="button" className="mini-btn" onClick={props.onCancel}>{STR.common.cancel}</button>
        <button type="button" className="mini-btn danger" onClick={props.onConfirm}>{STR.permissionMenu.confirmOk}</button>
      </div>
    </div>
  );
}
