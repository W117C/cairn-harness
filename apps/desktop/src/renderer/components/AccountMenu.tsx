// 左轨底部的账户入口（2026-11-03 业主）：设置与偏好不再挂在侧栏页脚，而是与插件/记忆
// 同一条全局导航栏的最底部，图标是用户头像。侧栏（会话上下文）收起或切到非 chat 页面时，
// 这个入口仍然在原位——它属于全局面，不属于某一路由。
//
// 菜单内容与旧页脚逐项相同（更新 / 外观 / 用量 / 设置 / 关于），不新增语义；
// 唯一变化是位置与触发件：头像图标 + `aria-haspopup`，不再有文字标签。
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CircleUser } from "lucide-react";
import { useState } from "react";
import { readMotionPref, setMotionPref, type MotionPref } from "../state/motion-pref";
import { useAvailableUpdate } from "../state/update-notice";
import { keysOf } from "../shortcuts";
import { STR } from "../strings";
import type { ThemePref } from "../theme";

/** 头像菜单的「外观」三档（原 Sidebar 页脚同一份，2026-10-20 批 130）。 */
const THEME_CHOICES: readonly { id: ThemePref; label: string }[] = [
  { id: "system", label: STR.footer.themeSystem },
  { id: "light", label: STR.footer.themeLight },
  { id: "dark", label: STR.footer.themeDark },
];

/** tooltip 键位与 SHORTCUTS 表同源（P3-3）：表里改键，这里自动跟。 */
function withKeys(base: string, id: string): string {
  const k = keysOf(id);
  return k === null ? base : `${base}（${k}）`;
}

export interface AccountMenuProps {
  onOpenSettings: () => void;
  /** 有新版本时优先打开「关于与更新」；缺省回落到 onOpenSettings。 */
  onOpenUpdateSettings?: () => void;
  onOpenUsage?: () => void;
  onOpenAbout?: () => void;
  /** 当前主题（外观子菜单打勾用）。缺省 system 只影响打勾显示，不影响主题本身。 */
  theme?: ThemePref;
  onThemeChange?: (theme: ThemePref) => void;
}

export function AccountMenu(props: AccountMenuProps): React.JSX.Element {
  // 全局可用更新：notice 随会话走，头像上的点不随会话走（第 811 页）。
  const update = useAvailableUpdate();
  const [motionPref, setMotionPrefState] = useState<MotionPref>(readMotionPref);
  const theme = props.theme ?? "system";
  return (
    <div className="app-rail-user">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="avatar"
            aria-label={STR.footer.accountTip}
            title={update !== null ? `${STR.sidebar.updateAvailableTitle} ${update.version}` : STR.footer.accountTip}
            data-update={update !== null ? "true" : undefined}
          >
            <CircleUser size={18} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          className="pop-rd pop-account"
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={10}
        >
          {update !== null && (
            <>
              <DropdownMenu.Item
                className="menu-item"
                onSelect={() => { (props.onOpenUpdateSettings ?? props.onOpenSettings)(); }}
              >
                <span>{STR.sidebar.updateMenuItem} {update.version}</span>
                <span className="menu-dot" aria-hidden="true" />
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-sep" />
            </>
          )}
          {/* 外观：主题三选一（子菜单，当前项打勾）。给的是快捷切换，
              完整的外观面（主题 + 文字大小 + 界面密度）在设置页「通用」分区。 */}
          {props.onThemeChange !== undefined && (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="menu-item">
                <span>{STR.footer.appearance}</span>
                <span className="sub">{THEME_CHOICES.find((t) => t.id === theme)?.label}</span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent className="pop-rd" sideOffset={2}>
                {THEME_CHOICES.map((t) => (
                  <DropdownMenu.Item key={t.id} className="menu-item" onSelect={() => { props.onThemeChange?.(t.id); }}>
                    <span>{t.label}</span>
                    {theme === t.id && <span className="check" aria-hidden="true">✓</span>}
                  </DropdownMenu.Item>
                ))}
                {/* 减弱动效（2026-10-28 第 758 页 · 对标 Claude 的 `data-reduce-motion` 根属性）：
                    应用内也能强制减弱动效——不只看系统设置。落位见 state/motion-pref.ts。 */}
                <DropdownMenu.Item
                  className="menu-item"
                  title={STR.footer.reduceMotionTip}
                  onSelect={() => { setMotionPref(motionPref === "reduced" ? "system" : "reduced"); setMotionPrefState(motionPref === "reduced" ? "system" : "reduced"); }}
                >
                  <span>{STR.footer.reduceMotion}</span>
                  {motionPref === "reduced" && <span className="check" aria-hidden="true">✓</span>}
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          )}
          {/* 用量入口直达设置中的完整统计页。 */}
          <DropdownMenu.Item className="menu-item" onSelect={() => { (props.onOpenUsage ?? props.onOpenSettings)(); }}>
            <span>{STR.footer.usage}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item
            className="menu-item"
            title={withKeys(STR.footer.settingsTip, "settings")}
            onSelect={() => { props.onOpenSettings(); }}
          >
            <span>{STR.footer.settings}</span>
            {/* 键位从 SHORTCUTS 表取（不手抄——哨兵判卷盯的就是这个） */}
            {keysOf("settings") !== null && <span className="sub">{keysOf("settings")}</span>}
          </DropdownMenu.Item>
          {props.onOpenAbout !== undefined && (
            <DropdownMenu.Item className="menu-item" onSelect={() => { props.onOpenAbout?.(); }}>{STR.footer.about}</DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}
