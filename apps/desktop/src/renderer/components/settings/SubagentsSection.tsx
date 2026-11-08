import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { SubagentSettingsSnapshot } from "../../../../../../src/main/subagent-settings";
import { ConfirmDialog } from "../ConfirmDialog";
import { Badge, Field, SettingsRow, SettingsSection } from "../settings-ui";
import { Switch } from "../Switch";
import { STR } from "../../strings";
import "./agent-settings.css";

const SOURCE_LABELS = { builtin: STR.subagents.sourceBuiltin, cairn: STR.subagents.sourceCairn, claude: STR.subagents.sourceClaude } as const;
const BUILTIN_SUMMARIES: Readonly<Record<string, string>> = {
  implement: STR.subagents.summaryImplement,
  review: STR.subagents.summaryReview,
  test: STR.subagents.summaryTest,
};

interface RoleDraft {
  file: string;
  markdown: string;
  revision: string | null;
}

export function SubagentsSection(props: {
  enabled: boolean;
  onToggle: (next: boolean) => Promise<void>;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SubagentSettingsSnapshot | null>(null);
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const markdownInput = useRef<HTMLTextAreaElement | null>(null);
  const editing = draft !== null;

  useEffect(() => {
    if (!editing) return;
    const input = fileInput.current;
    if (input?.disabled === false) input.focus();
    else markdownInput.current?.focus();
  }, [editing]);

  const load = async (): Promise<void> => {
    setSnapshot(await window.agent.subagentSettingsList());
  };

  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void perform(load); }, []);

  const save = async (edit: RoleDraft): Promise<void> => {
    const name = edit.file.trim();
    const file = edit.revision === null && !name.endsWith(".md") ? name + ".md" : name;
    await window.agent.subagentSettingsSave(file, edit.markdown, edit.revision);
    setDraft(null);
    setNotice(STR.subagents.savedNotice);
    await load();
  };

  return (
    <div className="agent-role-section">
      <SettingsSection title={STR.subagents.title}>
        <SettingsRow label={STR.subagents.allowLabel} desc={STR.subagents.allowDesc}>
          <Switch label={STR.subagents.allowLabel} checked={props.enabled} busy={busy}
            onChange={(next) => { void perform(() => props.onToggle(next)); }} />
        </SettingsRow>
        {snapshot !== null && (
          <SettingsRow label={STR.subagents.concurrencyCap}>
            <span>{Number.isFinite(snapshot.concurrencyCap) ? snapshot.concurrencyCap : "—"}{STR.subagents.concurrencyUnit}</span>
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title={STR.subagents.rolesTitle}>
        {snapshot === null && <p className="sp-note" role="status">{busy ? STR.subagents.rolesLoading : STR.subagents.rolesUnavailable}</p>}
        {(snapshot?.roles ?? []).map((role) => (
          <SettingsRow key={role.invoke}
            label={<><code>{role.invoke}</code><Badge>{SOURCE_LABELS[role.source]}</Badge></>}
            desc={(role.source === "builtin" ? BUILTIN_SUMMARIES[role.invoke] ?? role.description : role.description) || undefined}
          >
            {role.file !== undefined && (
              <button type="button" className="mini-btn" disabled={busy || draft !== null}
                aria-label={STR.subagents.editAria.replace("{name}", role.invoke)} onClick={() => {
                  const file = role.file!;
                  void perform(async () => setDraft({ file, ...await window.agent.subagentSettingsRead(file) }));
                }}>{STR.subagents.edit}</button>
            )}
          </SettingsRow>
        ))}
        <div className="agent-settings-actions">
          <button type="button" className="mini-btn" disabled={busy || draft !== null}
            onClick={() => { void perform(load); }}>{STR.subagents.refresh}</button>
          <button type="button" className="mini-btn primary agent-role-add" disabled={busy || draft !== null || snapshot === null}
            onClick={() => setDraft({ file: "", markdown: "", revision: null })}>
            <Plus size={14} aria-hidden="true" />{STR.subagents.addRole}
          </button>
        </div>
      </SettingsSection>

      {draft !== null && (
        <form className="agent-settings-editor" onSubmit={(event) => {
          event.preventDefault();
          void perform(() => save(draft));
        }}>
          <label htmlFor="subagent-file">{STR.subagents.fileLabel}</label>
          <Field width="full">
            <input id="subagent-file" ref={fileInput} value={draft.file} disabled={busy || draft.revision !== null}
              placeholder={STR.subagents.filePlaceholder} required
              onChange={(event) => setDraft({ ...draft, file: event.target.value })} />
          </Field>
          <label htmlFor="subagent-markdown">{STR.subagents.markdownLabel}</label>
          <textarea id="subagent-markdown" ref={markdownInput} className="agent-settings-textarea" rows={7}
            value={draft.markdown} disabled={busy} required
            placeholder={STR.subagents.markdownPlaceholder}
            onChange={(event) => setDraft({ ...draft, markdown: event.target.value })} />
          <div className="agent-settings-actions">
            {draft.revision !== null && (
              <button type="button" className="mini-btn danger" disabled={busy}
                onClick={() => setConfirmDelete(true)}>{STR.subagents.deleteRole}</button>
            )}
            <button type="button" className="mini-btn" disabled={busy} onClick={() => setDraft(null)}>{STR.subagents.cancel}</button>
            <button type="submit" className="mini-btn primary"
              disabled={busy || draft.file.trim() === "" || draft.markdown.trim() === ""}>{STR.subagents.saveRole}</button>
          </div>
        </form>
      )}
      {(snapshot?.warnings ?? []).length > 0 && (
        <details><summary>{STR.subagents.warningsSummary.replace("{n}", String(snapshot!.warnings.length))}</summary>
          <ul>{snapshot!.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
        </details>
      )}
      {notice !== null && <p className="sp-note" role="status">{notice}</p>}
      {error !== null && <p className="sp-note err" role="alert">{error}</p>}
      {confirmDelete && draft !== null && draft.revision !== null && (
        <ConfirmDialog title={STR.subagents.deleteTitle} note={STR.subagents.deleteNote.replace("{file}", draft.file)}
          danger confirmLabel={STR.subagents.deleteRole} onClose={() => setConfirmDelete(false)} onConfirm={() => {
            setConfirmDelete(false);
            const revision = draft.revision!;
            void perform(async () => {
              await window.agent.subagentSettingsRemove(draft.file, revision);
              setDraft(null);
              setNotice(STR.subagents.deletedNotice);
              await load();
            });
          }} />
      )}
    </div>
  );
}
