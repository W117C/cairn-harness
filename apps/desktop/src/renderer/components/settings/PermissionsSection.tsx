// 权限与安全段——2026-11-12（第 1069 页）从 settings-sections.tsx 按区拆分至此，
// 沿用 GeneralSection / ShortcutsSection / McpSection / HooksSection 的 settings/ 子文件 + monolith 重导出模式（对外 API 面不变）。
// 本批只搬结构，文案仍是字面量；裸中文收编进 STR 留下一批（先按区拆分，再逐件收）。
import { useState } from "react";
import type { AppSettings, PermissionMode } from "../../../../../../src/main/ipc-protocol";
import { selectablePermissionMode } from "../../../../../../src/permissions/modes";
import { STR } from "../../strings";
import { OptionCard, SettingsSection, SettingsRow } from "../settings-ui";
import { ConfirmDialog } from "../ConfirmDialog";
import { permissionConfirmCopy } from "../PermissionMenu";

export const MODE_OPTIONS: readonly { id: PermissionMode; label: string; desc: string; warn?: string }[] = [
  { id: "read-only", label: STR.permissions.modeReadOnly, desc: STR.permissions.modeReadOnlyDesc },
  { id: "default", label: STR.permissions.modeDefault, desc: STR.permissions.modeDefaultDesc },
  // 2026-11-03 业主：引导与自动两档文案重叠，合并成一个「智能审批」入口（持久化 id 仍是 auto）。
  // 它免的是"逐笔问写"，不是"什么都不问"：风险 ≥ high 的动作照样出卡。
  { id: "auto", label: STR.permissions.modeAuto, desc: STR.permissions.modeAutoDesc, warn: STR.permissions.modeAutoWarn },
  // 2026-11-03 业主：完全允许 = 什么都允许。除评测判卷文件的冻结闸外，出网、方案门、
  // 禁止规则与风险线都不再拦（旧文案说"出网仍一次性批准"已作废）。
  { id: "full-access", label: STR.permissions.modeFull, desc: STR.permissions.modeFullDesc, warn: STR.permissions.modeFullWarn },
];

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