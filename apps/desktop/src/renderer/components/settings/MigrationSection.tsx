import { useMemo, useState } from "react";
import type {
  SettingsMigrationItem,
  SettingsMigrationPreview,
  SettingsMigrationResult,
  SettingsMigrationSource,
} from "@core/main/ipc-protocol";
import { Banner, Field, SettingsRow, SettingsSection } from "../settings-ui";
import { STR } from "../../strings";

const sources = {
  "claude-code": {
    label: "Claude Code",
    files: STR.migration.claudeFiles,
    docs: "https://code.claude.com/docs/en/mcp",
  },
  codex: {
    label: "Codex",
    files: STR.migration.codexFiles,
    docs: "https://learn.chatgpt.com/docs/config-file/config-reference",
  },
};

const statusLabels: Record<SettingsMigrationItem["status"], string> = {
  ready: STR.migration.statusReady,
  collision: STR.migration.statusCollision,
  unsupported: STR.migration.statusUnsupported,
  skipped: STR.migration.statusSkipped,
};

function resultStatus(item: SettingsMigrationItem, imported: Set<string>, skipped: Map<string, string>, hasResult: boolean): string {
  if (imported.has(item.id)) return STR.migration.statusImported;
  if (skipped.has(item.id)) return STR.migration.statusSkipped;
  if (hasResult && item.status === "ready") return STR.migration.statusUnselected;
  return statusLabels[item.status];
}

export function MigrationSection(props: { onImported?: () => void }): React.JSX.Element {
  const [source, setSource] = useState<SettingsMigrationSource>("claude-code");
  const [preview, setPreview] = useState<SettingsMigrationPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<SettingsMigrationResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function clearPreview(): void {
    setPreview(null);
    setSelected([]);
    setResult(null);
    setError(null);
  }

  async function pickFiles(): Promise<void> {
    clearPreview();
    setBusy("preview");
    try {
      setPreview(await window.agent.settingsPreviewMigration(source));
    } catch {
      setError(STR.migration.previewFailed);
    } finally {
      setBusy(null);
    }
  }

  async function apply(): Promise<void> {
    if (preview === null || selected.length === 0) return;
    setBusy("apply");
    setError(null);
    try {
      const next = await window.agent.settingsApplyMigration(preview.id, selected);
      setResult(next);
      if (next.imported.length > 0) props.onImported?.();
    } catch {
      clearPreview();
      setError(STR.migration.applyFailed);
    } finally {
      setBusy(null);
    }
  }

  function select(id: string, checked: boolean): void {
    setSelected((current) => checked ? [...current, id] : current.filter((selectedId) => selectedId !== id));
  }

  // 第 1150 页：结果索引按 result 记忆；来源/忙碌/选择变化不重建。
  const imported = useMemo(() => new Set(result?.imported), [result]);
  const skipped = useMemo(() => new Map(result?.skipped.map(({ id, detail }) => [id, detail])), [result]);
  return (
    <>
      <SettingsSection title={STR.migration.title}>
        <SettingsRow label={STR.migration.sourceLabel} desc={sources[source].files}>
          <Field width="sm" select>
            <select aria-label={STR.migration.sourceAria} value={source} disabled={busy !== null} onChange={(event) => {
              setSource(event.target.value === "codex" ? "codex" : "claude-code");
              clearPreview();
            }}>
              <option value="claude-code">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </Field>
        </SettingsRow>
        <SettingsRow label={STR.migration.pickLabel} desc={STR.migration.pickDesc}>
          <button type="button" className="mini-btn" disabled={busy !== null} onClick={() => void pickFiles()}>
            {busy === "preview" ? STR.migration.preparing : STR.migration.pick}
          </button>
        </SettingsRow>
        <SettingsRow label={sources[source].label + STR.migration.filesHelpSuffix}>
          <button type="button" className="mini-btn" onClick={() => {
            setError(null);
            void window.agent.openExternal(sources[source].docs)
              .then((opened) => { if (!opened.ok) setError(STR.migration.openDocsFailed); })
              .catch(() => setError(STR.migration.openDocsFailed));
          }}>
            {STR.migration.openDocs}
          </button>
        </SettingsRow>
      </SettingsSection>

      {error !== null && <div role="alert"><Banner tone="warn">{error}</Banner></div>}
      {preview !== null && (
        <SettingsSection title={result === null ? STR.migration.previewTitle : STR.migration.resultTitle}>
          {result === null && (
            <Banner tone="info">
              {STR.migration.infoBanner}
            </Banner>
          )}
          {preview.items.map((item) => {
            const status = resultStatus(item, imported, skipped, result !== null);
            return (
              <SettingsRow key={item.id} label={item.name} desc={skipped.get(item.id) ?? item.detail}>
                {item.status === "ready" && result === null ? (
                  <label>
                    <input type="checkbox" aria-label={STR.migration.importAria.replace("{name}", item.name)} checked={selected.includes(item.id)}
                      disabled={busy !== null} onChange={(event) => select(item.id, event.target.checked)} />
                    {status}
                  </label>
                ) : <span className="ss-sec-hint">{status}</span>}
              </SettingsRow>
            );
          })}
          {result === null ? (
            <SettingsRow label={STR.migration.selectedCount.replace("{n}", String(selected.length))} desc={STR.migration.keepExistingDesc}>
              <button type="button" className="mini-btn primary" disabled={busy !== null || selected.length === 0} onClick={() => void apply()}>
                {busy === "apply" ? STR.migration.importing : STR.migration.importSelected}
              </button>
            </SettingsRow>
          ) : (
            <div role="status">
              <SettingsRow label={STR.migration.resultCount.replace("{imported}", String(result.imported.length)).replace("{skipped}", String(result.skipped.length))}>
                <button type="button" className="mini-btn" onClick={() => void pickFiles()}>{STR.migration.continueMigration}</button>
              </SettingsRow>
            </div>
          )}
        </SettingsSection>
      )}
    </>
  );
}
