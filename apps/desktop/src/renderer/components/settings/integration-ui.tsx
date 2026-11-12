import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Field } from "../settings-ui";
import { STR } from "../../strings";
import "./integrations.css";

type ConfigStatus = { ok: boolean; path: string; errors: readonly string[]; revision?: string };
type SaveResult = { ok: boolean; error?: string; errors?: readonly string[]; revision?: string; conflict?: boolean };

export function useIntegrationConfig<T extends ConfigStatus>(
  read: () => Promise<T>,
  write: (next: T, expectedRevision?: string) => Promise<SaveResult>,
) {
  const [config, setConfig] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    setError(null);
    setNotice(null);
    try {
      const next = await read();
      setConfig(next);
      if (!next.ok && next.errors.length === 0) setLoadError(STR.integrations.loadFailed);
      setConflict(false);
    } catch (err) {
      setConfig(null);
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const blocked = config === null || !config.ok || loading || busy || conflict || config.errors.length > 0;
  const save = async (next: T): Promise<boolean> => {
    if (blocked) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await write(next, config.revision);
      if (!result.ok) {
        if (result.conflict === true) {
          setConflict(true);
          setError(STR.integrations.conflict);
        } else {
          setError(result.errors?.join("；") || result.error || STR.integrations.saveFailed);
        }
        return false;
      }
      if (result.revision !== undefined) {
        setConfig({ ...next, revision: result.revision });
      } else {
        await load();
      }
      setNotice(STR.integrations.saved);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { config, loading, loadError, busy, blocked, error, notice, conflict, load, save, setError };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function parseStringArray(raw: string): string[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(STR.integrations.arrayParseFail);
  }
  return value;
}

export function IntegrationFeedback({ error, notice }: { error: string | null; notice?: string | null }): React.JSX.Element {
  return <>
    {error && <div className="integrations-feedback error" role="alert">{error}</div>}
    {notice && <div className="integrations-feedback" role="status">{notice}</div>}
  </>;
}

export function IntegrationToolbar({ title, headingRef, children }: {
  title: string; headingRef?: Ref<HTMLHeadingElement>; children?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="integrations-toolbar">
      <div>
        <h2 tabIndex={-1} ref={headingRef}>{title}</h2>
      </div>
      {children}
    </header>
  );
}

export function IntegrationItem({ title, secondary, status, icon, onOpen }: {
  title: string; secondary?: string; status?: ReactNode; icon: ReactNode; onOpen: () => void;
}): React.JSX.Element {
  return (
    <li>
      <button type="button" className="integrations-item" onClick={onOpen}>
        <span className="integrations-item-icon" aria-hidden="true">{icon}</span>
        <span className="integrations-item-main">
          <span className="integrations-item-title">{title}</span>
          {secondary && <span className="integrations-item-secondary">{secondary}</span>}
        </span>
        {status}
        <ChevronRight size={16} className="integrations-chevron" aria-hidden="true" />
      </button>
    </li>
  );
}

export function IntegrationSubview({ title, onReturn, backLabel, busy, children }: {
  title: string; onReturn: () => void; backLabel: string; busy?: boolean; children: ReactNode;
}): React.JSX.Element {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, [title]);
  return <>
    <button type="button" className="mini-btn integrations-back" onClick={onReturn} disabled={busy}>
      <ArrowLeft size={14} aria-hidden="true" />{backLabel}
    </button>
    <h2 className="integrations-title" tabIndex={-1} ref={titleRef}>{title}</h2>
    {children}
  </>;
}

export function IntegrationPath({ path, onReload }: { path: string; onReload: () => void }): React.JSX.Element {
  return (
    <footer className="integrations-path">
      <span><span>{STR.integrations.configFile}</span><code>{path}</code></span>
      <button type="button" className="mini-btn" onClick={onReload}>{STR.integrations.reload}</button>
    </footer>
  );
}

export function IntegrationInput({ label, value, onChange, placeholder, options, hint, multiline = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  options?: readonly { value: string; label: string }[];
  hint?: string;
  multiline?: boolean;
}): React.JSX.Element {
  const id = useId();
  const attrs = { id, value, "aria-describedby": hint ? id + "-hint" : undefined };
  return (
    <div className="integrations-field">
      <label htmlFor={id}>{label}</label>
      <Field width="full" select={options !== undefined}>
        {options ? <select {...attrs} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select> : multiline ? <textarea {...attrs} rows={2} spellCheck={false} placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)} />
        : <input {...attrs} type="text" spellCheck={false} placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)} />}
      </Field>
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}

export function IntegrationLoading(): React.JSX.Element {
  return <div className="integrations-loading" role="status">{STR.integrations.loading}</div>;
}
