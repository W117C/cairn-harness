// 高级段——2026-11-12（第 1070 页）从 settings-sections.tsx 按区拆分至此，
// 沿用 General / Shortcuts / Permissions / Mcp / Hooks 的 settings/ 子文件 + monolith 重导出模式（对外 API 面不变）。
// 本段已是 STR 形（STR.advanced.*），无裸中文收编债；两个导出 parse 助手随段迁、monolith 重导出保判卷值进口。
import { useState } from "react";
import type { AppSettings } from "../../../../../../src/main/ipc-protocol";
import { Badge, Field, SettingsSection, SettingsRow } from "../settings-ui";
import { Switch } from "../Switch";
import { LspStatusRow } from "./LspStatusRow";
import { STR } from "../../strings";
import { isCompositionEnter } from "../../ime";

/** 花费闸的两个数字字段：0 = 关（与 settings.ts 的缺省口径逐字一致）。
 *  校验放在这里而不是只靠后端：后端对非法值静默回退默认，界面必须先拦住并说清，
 *  否则用户输入 1e9 看到「已保存」实际存的是 0——「视图说成功、事实没发生」。 */
export function parseBudgetField(raw: string, max: number): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: 0 }; // 空 = 0 = 关（与缺省同义）
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "要填一个不小于 0 的数字" };
  if (n > max) return { ok: false, error: `上限是 ${String(max)}` };
  return { ok: true, value: n };
}

/** 定时并发上限（1-8 的整数）：后端对非法值静默回退 2，界面必须先拦——否则用户改 0/12
 *  看到「已保存」，实际跑的是 2。与花费闸同一个理由：视图不许说成功而事实没发生。 */
export function parseCapField(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim();
  const n = Number(t);
  if (t === "" || !Number.isInteger(n) || n < 1 || n > 8) return { ok: false, error: "要填 1-8 的整数" };
  return { ok: true, value: n };
}

export function AdvancedSection(props: {
  settings: AppSettings;
  /** 单键直写（不走 panelPatch 白名单——那份白名单与其判卷口径保持原样；
   *  与 saveCtrlTab 同一条路：window.agent.setSettings({ [key]: value })）。 */
  onSaveKey: (key: string, value: boolean | number) => void;
}): React.JSX.Element {
  const [budgetErr, setBudgetErr] = useState<string | null>(null);
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const [capErr, setCapErr] = useState<string | null>(null);
  const s = props.settings;
  return (
    <>
      <SettingsSection title={STR.advanced.memoryTitle}>
        <SettingsRow label={STR.advanced.autoMemory} desc={STR.advanced.autoMemoryDesc}>
          <Switch
            label={STR.advanced.autoMemory}
            checked={s.autoMemory}
            onChange={(next) => props.onSaveKey("autoMemory", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label={STR.advanced.impactAnalysis} desc={STR.advanced.impactAnalysisDesc}>
          <Switch
            label={STR.advanced.impactAnalysis}
            checked={s.impactAnalysis}
            onChange={(next) => props.onSaveKey("impactAnalysis", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label={STR.advanced.promptCache} desc={STR.advanced.promptCacheDesc}>
          <Switch
            label={STR.advanced.promptCache}
            checked={s.promptCache}
            onChange={(next) => props.onSaveKey("promptCache", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={STR.advanced.budgetTitle}>
        <SettingsRow label={STR.advanced.maxBudgetUsd} desc={STR.advanced.maxBudgetUsdDesc}>
          <div className="ss-inline">
            <Field width="sm">
              <input
                aria-label={STR.advanced.maxBudgetUsd}
                defaultValue={typeof s.maxBudgetUsd === "number" && Number.isFinite(s.maxBudgetUsd) ? String(s.maxBudgetUsd) : "0"}
                inputMode="decimal"
                onKeyDown={(e) => { if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); e.currentTarget.blur(); } }}
                onBlur={(e) => {
                  const r = parseBudgetField(e.target.value, 10000);
                  if (!r.ok) { setBudgetErr(r.error); return; }
                  setBudgetErr(null);
                  if (r.value !== s.maxBudgetUsd) props.onSaveKey("maxBudgetUsd", r.value);
                }}
              />
            </Field>
            {budgetErr !== null && <span className="ss-err">{budgetErr}</span>}
          </div>
        </SettingsRow>
        <SettingsRow label={STR.advanced.budgetPrice} desc={STR.advanced.budgetPriceDesc}>
          <div className="ss-inline">
            <Field width="sm">
              {/* 2026-11-02 真机：字段缺省时 `String(undefined)` 把字面 "undefined" 填进了输入框。
                  先判空再转串（0 是合法值，不能被省略）。 */}
              <input
                aria-label={STR.advanced.budgetPrice}
                defaultValue={typeof s.budgetPricePerMTok === "number" && Number.isFinite(s.budgetPricePerMTok)
                  ? String(s.budgetPricePerMTok)
                  : "0"}
                inputMode="decimal"
                onKeyDown={(e) => { if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); e.currentTarget.blur(); } }}
                onBlur={(e) => {
                  const r = parseBudgetField(e.target.value, 10000);
                  if (!r.ok) { setPriceErr(r.error); return; }
                  setPriceErr(null);
                  if (r.value !== s.budgetPricePerMTok) props.onSaveKey("budgetPricePerMTok", r.value);
                }}
              />
            </Field>
            {priceErr !== null && <span className="ss-err">{priceErr}</span>}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={STR.advanced.privacyTitle}>
        <SettingsRow label={STR.advanced.telemetry}>
          {/* 2026-11-02：Badge 的正文是 children（settings-ui.tsx:135），不是 text 属性。
              写成 text 时那个 prop 被丢掉 ⇒ 胶囊渲染成一片空白，判卷 settings-advanced-section
              第 57 条要的「未收集」在 DOM 里根本不存在（该条一直红）。 */}
          <Badge>未收集</Badge>
        </SettingsRow>
      </SettingsSection>

      {/* 2026-10-30 补账：这三个开关一直在生效却没有入口——子代理工具决定模型看不看得见三把工具，
          收束闸/返修直接改花钱与交付质量。默认值与 settings.ts 同源（不另抄）。 */}
      <SettingsSection title={STR.advanced.verifyTitle}>
        <SettingsRow label={STR.advanced.subagentTools} desc={STR.advanced.subagentToolsDesc}>
          <Switch
            label={STR.advanced.subagentTools}
            checked={s.subagentTools}
            onChange={(next) => props.onSaveKey("subagentTools", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label={STR.advanced.autoVerify} desc={STR.advanced.autoVerifyDesc}>
          <Switch
            label={STR.advanced.autoVerify}
            checked={s.autoVerify}
            onChange={(next) => props.onSaveKey("autoVerify", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
        <SettingsRow label={STR.advanced.autoVerifyRepair} desc={STR.advanced.autoVerifyRepairDesc}>
          <Switch
            label={STR.advanced.autoVerifyRepair}
            checked={s.autoVerifyRepair}
            onChange={(next) => props.onSaveKey("autoVerifyRepair", next)}
            onText="开"
            offText="关"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={STR.advanced.lspTitle}>
        <LspStatusRow />
      </SettingsSection>

      <SettingsSection title={STR.advanced.scheduleTitle}>
        <SettingsRow label={STR.advanced.scheduleCap} desc={STR.advanced.scheduleCapDesc}>
          <div className="ss-inline">
            <Field width="sm">
              <input
                aria-label={STR.advanced.scheduleCap}
                defaultValue={typeof s.scheduleConcurrencyCap === "number" && Number.isFinite(s.scheduleConcurrencyCap) ? String(s.scheduleConcurrencyCap) : "1"}
                inputMode="numeric"
                onKeyDown={(e) => { if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); e.currentTarget.blur(); } }}
                onBlur={(e) => {
                  const r = parseCapField(e.target.value);
                  if (!r.ok) { setCapErr(r.error); return; }
                  setCapErr(null);
                  if (r.value !== s.scheduleConcurrencyCap) props.onSaveKey("scheduleConcurrencyCap", r.value);
                }}
              />
            </Field>
            {capErr !== null && <span className="ss-err">{capErr}</span>}
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}