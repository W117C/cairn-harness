// 权限与安全段——2026-11-12（第 1069 页）从 settings-sections.tsx 按区拆分至此，
// 沿用 GeneralSection / ShortcutsSection / McpSection / HooksSection 的 settings/ 子文件 + monolith 重导出模式（对外 API 面不变）。
// 本批只搬结构，文案仍是字面量；裸中文收编进 STR 留下一批（先按区拆分，再逐件收）。
import { useState } from "react";
import type { AppSettings, PermissionMode } from "../../../../../../src/main/ipc-protocol";
import { selectablePermissionMode } from "../../../../../../src/permissions/modes";
import { STR } from "../../strings";
import { applyRadioNavigation } from "../../radio-nav";
import { OptionCard, SettingsSection, SettingsRow } from "../settings-ui";
import { ConfirmDialog } from "../ConfirmDialog";
import { MODE_LABEL, permissionConfirmCopy } from "../PermissionMenu";

// 档位名与说明只在 MODE_LABEL 里写一份（芯片菜单 / 确认框 / 设置面同源）。
// 此前设置面抄了第二份，已经漂了：最松档的说明漏掉「评测判卷文件仍受硬闸保护」这条硬边界。
// 设置面自己只多一行风险警示（warn），其余一律取词表。
const SETTINGS_MODE_IDS = ["read-only", "default", "auto", "full-access"] as const;

export const MODE_OPTIONS: readonly { id: PermissionMode; label: string; desc: string; warn?: string }[] =
  SETTINGS_MODE_IDS.map((id) => {
    const info = MODE_LABEL[id];
    // 2026-11-03 业主：引导与自动两档文案重叠，合并成一个「智能审批」入口（持久化 id 仍是 auto）。
    // 它免的是"逐笔问写"，不是"什么都不问"：风险 ≥ high 的动作照样出卡。
    const warn = id === "auto" ? STR.permissions.modeAutoWarn : id === "full-access" ? STR.permissions.modeFullWarn : undefined;
    return { id, label: info.label, desc: info.desc, ...(warn === undefined ? {} : { warn }) };
  });

export function PermissionsSection(props: {
  settings: AppSettings;
  onSave: (patch: Record<string, unknown>) => void;
}): React.JSX.Element {
  const [confirmMode, setConfirmMode] = useState<PermissionMode | null>(null);
  const requestMode = (id: PermissionMode): void => {
    if ((id === "auto" || id === "full-access") && props.settings.mode !== id) {
      setConfirmMode(id);
      return;
    }
    props.onSave({ mode: id });
  };
  const confirmCopy = confirmMode === null ? null : permissionConfirmCopy(confirmMode);
  const selectedIndex = MODE_OPTIONS.findIndex((m) => m.id === selectablePermissionMode(props.settings.mode));
  return (
    <>
      <SettingsSection title={STR.permissions.modesTitle} hint={STR.permissions.modesHint}>
        <div className="ss-opt-list" role="radiogroup" aria-label={STR.permissions.modesTitle}>
          {MODE_OPTIONS.map((m) => (
            <OptionCard
              key={m.id}
              checked={selectablePermissionMode(props.settings.mode) === m.id}
              title={m.label}
              desc={m.desc}
              tabIndex={selectablePermissionMode(props.settings.mode) === m.id ? 0 : -1}
              onKeyDown={(e) => {
                applyRadioNavigation(e, selectedIndex, MODE_OPTIONS.length, (index) => {
                  const target = MODE_OPTIONS[index];
                  if (target !== undefined) requestMode(target.id);
                });
              }}
              {...(m.warn !== undefined ? { danger: true, warn: m.warn } : {})}
              // 2026-11-02 真机：五档里「自动」和「完全允许」此前同样红描边，风险梯度读不出。
              // 自动 = 警告级（黄），完全允许 = 危险级（红），与权限菜单的档位色点口径一致。
              tone={m.id === "auto" ? "warn" : m.id === "full-access" ? "danger" : "normal"}
              onSelect={() => { requestMode(m.id); }}
            />
          ))}
        </div>
      </SettingsSection>
      {confirmMode !== null && confirmCopy !== null && (
        <ConfirmDialog
          title={confirmCopy.title}
          note={confirmCopy.desc}
          confirmLabel={STR.permissions.confirmSwitch}
          danger
          onClose={() => { setConfirmMode(null); }}
          onConfirm={() => { const m = confirmMode; setConfirmMode(null); props.onSave({ mode: m }); }}
        />
      )}

      <SettingsSection title={STR.permissions.securityTitle}>
        {/* 方案模式（2026-11-03 业主）：是否先出方案由 agent 自判（提示词自判面 + 方案门写禁），
            这里不再有用户开关；设置存档里方案默认值的旧键只为读旧档兼容而保留。 */}
        {/* 布局优先（第 1091 页）：说明首句已经是「默认断网」，不再加同义 chip 重复同一条事实。 */}
        <SettingsRow label={STR.permissions.network} desc={STR.permissions.networkDesc} />
      </SettingsSection>
    </>
  );
}