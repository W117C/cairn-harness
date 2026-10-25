// C-20 权限档菜单（批 5 · 细则 §五「弹层与菜单（统一组件）」；P2-2 迁移 STR + 档位色点）。
// 列表态 = 每项色点 + 图标 + 标题 + 副标题两行；「自动」行 warning 图标 +「危险」小标签（不整行变色）；
// 选「自动」先走二次确认（PermissionConfirm）——确认前绝不调 onModeChange（危险动作不静默）。
// 词表（MODE_LABEL / MODE_DOT）与触发器共用，单一事实源在本文件；值全出处 STR（本文件零裸中文）。
import { LockOpen,Shield,ShieldAlert,ShieldCheck,ShieldOff } from "lucide-react";
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
  "full-access": "var(--mode-full)",
};

/** 条目图标族（盾形谱：拒写 / 默认 / 引导 / 全放行）。 */
const MODE_ICON: Record<PermissionMode, typeof Shield> = {
  "read-only": ShieldOff,
  default: Shield,
  guided: ShieldCheck,
  auto: ShieldAlert,
  "full-access": LockOpen, // 全解锁：本档没有审批卡（区别于自动档的 ShieldAlert）
};

const MODE_ORDER: readonly PermissionMode[] = ["read-only", "default", "guided", "auto", "full-access"];

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
  // 二次确认态携带目标档（自动 / 完全允许两张危险档共用一张确认卡，文案按档取）。
  const [confirming, setConfirming] = useState<PermissionMode | null>(null);
  if (confirming !== null) {
    const target = confirming;
    return (
      <PermissionConfirm
        mode={target}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          // 先清确认态再落档（防御：将来若改回常驻挂载，state 也不残留——真机实证过）。
          setConfirming(null);
          props.onModeChange(target);
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
              // 危险档（自动/完全允许）没确认过就先出确认卡；确认前不动权限（危险不静默）。
              if ((m === "auto" || m === "full-access") && props.mode !== m) {
                setConfirming(m);
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

/** 危险档二次确认卡（自动 / 完全允许；危险动作显式确认；确认按钮才是真切换）。 */
export function PermissionConfirm(props: { mode: PermissionMode; onCancel: () => void; onConfirm: () => void }) {
  const copy = props.mode === "full-access"
    ? { aria: STR.permissionMenu.confirmFullAria, title: STR.permissionMenu.confirmFullTitle, desc: STR.permissionMenu.confirmFullDesc }
    : { aria: STR.permissionMenu.confirmAria, title: STR.permissionMenu.confirmTitle, desc: STR.permissionMenu.confirmDesc };
  return (
    <div className="perm-confirm" role="alertdialog" aria-label={copy.aria}>
      <div className="perm-confirm-title">{copy.title}</div>
      <div className="perm-confirm-desc">{copy.desc}</div>
      <div className="perm-confirm-actions">
        <button type="button" className="mini-btn" onClick={props.onCancel}>{STR.common.cancel}</button>
        <button type="button" className="mini-btn danger" onClick={props.onConfirm}>{STR.permissionMenu.confirmOk}</button>
      </div>
    </div>
  );
}
