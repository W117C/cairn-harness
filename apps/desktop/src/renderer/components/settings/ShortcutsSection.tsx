// 快捷键速查段——2026-11-12（第 1067 页）从 settings-sections.tsx 按区拆分至此，
// 沿用 GeneralSection / McpSection / HooksSection 的 settings/ 子文件 + monolith 重导出模式（对外 API 面不变）。
// 本批只搬结构，文案仍是字面量；裸中文收编进 STR 留下一批（先按区拆分，再逐件收）。
import { STR } from "../../strings";
import { SettingsSection } from "../settings-ui";
import { SHORTCUT_GROUPS } from "../../shortcuts";

/** 快捷键（P3-3 · brief 九节）：核心表渲染自 SHORTCUTS（单一事实源——Sidebar/命令面板 tooltip 同源）；
 *  完整速查（含窗格/视图键）按 ⌘/ 弹层。 */
export function ShortcutsSection(): React.JSX.Element {
  return (
    /* 2026-11-02：此前只列 13 条核心键，但 ⌘/ 弹层有 40+ 条（含窗格/视图/查找族）——
       同一件事两份数据，设置页成了精简版。现在直接渲染完整分组表（SHORTCUT_GROUPS，
       与 ⌘/ 弹层同一事实源）；核心键仍由 SHORTCUTS 承担 tooltip 取键。 */
    <SettingsSection title={STR.shortcutsSection.title} hint={STR.shortcutsSection.hint}>
      {SHORTCUT_GROUPS.map((g) => (
        <div key={g.title}>
          <h2 className="ss-sec-title kx-group-title">{g.title}</h2>
          <div className="kx-list">
            {g.rows.map((row) => (
              <div className="kx-row" key={`${g.title}:${row.keys}:${row.what}`}>
                <kbd className="kx-keys">{row.keys}</kbd>
                <span className="kx-what">{row.what}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </SettingsSection>
  );
}