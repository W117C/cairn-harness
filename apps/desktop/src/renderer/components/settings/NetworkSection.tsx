import { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, Globe, Loader2, RefreshCw } from "lucide-react";
import type { SearchProvider, SearchSettingsInput, SearchSettingsSnapshot, SearchSettingsTestResult } from "../../../../../../src/main/ipc-protocol";
import { Field, SettingsPage, SettingsRow, SettingsSection } from "../settings-ui";
import { Switch } from "../Switch";
import { STR } from "../../strings";
import { readOrError } from "../../read-result";
import "./network-settings.css";

type Draft = Omit<SearchSettingsInput, "apiKey" | "clearApiKey">;
const PROVIDERS: Record<SearchProvider, { label: string; endpoint: string; key: boolean }> = {
  tavily: { label: "Tavily", endpoint: "https://api.tavily.com/search", key: true },
  brave: { label: "Brave Search", endpoint: "https://api.search.brave.com/res/v1/web/search", key: true },
  searxng: { label: "SearXNG", endpoint: "", key: false },
  custom: { label: STR.network.customSearch, endpoint: "", key: false },
};

const draftOf = (s: SearchSettingsSnapshot): Draft => ({ enabled: s.enabled, provider: s.provider, endpoint: s.endpoint, allowLocalEndpoint: s.allowLocalEndpoint });

export function NetworkSection(props: { onSaved?: () => void }): React.JSX.Element {
  const [saved, setSaved] = useState<SearchSettingsSnapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<SearchSettingsTestResult | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "test" | null>("load");
  const [showKey, setShowKey] = useState(false);
  // 联网免批（AppSettings.webAutoApprove，2026-11-05 业主裁）：开 = web_search/web_fetch 免逐次审批。
  const [webAuto, setWebAuto] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const keyInput = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true);

  const load = async () => {
    setBusy("load"); setError(null);
    try {
      const snapshot = await window.agent.searchSettingsGet();
      if (!alive.current) return;
      void readOrError(() => window.agent.getSettings()).then((r) => {
        if (!alive.current) return;
        if (r.ok) setWebAuto(r.value.webAutoApprove === true);
        else setError(STR.network.webAutoLoadFailedPrefix + r.error);
      });
      setSaved(snapshot); setDraft(draftOf(snapshot));
      if (snapshot.error) setError(snapshot.error);
    } catch (err) {
      if (alive.current) setError(STR.network.loadFailedPrefix + (err instanceof Error ? err.message : String(err)));
    } finally { if (alive.current) setBusy(null); }
  };
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);

  const change = (patch: Partial<Draft>) => {
    setDraft((prev) => prev === null ? prev : { ...prev, ...patch });
    setTest(null); setError(null); setNotice(null);
  };
  const request = (): SearchSettingsInput | null => {
    if (draft === null) return null;
    const apiKey = keyInput.current?.value.trim() ?? "";
    return { ...draft, ...(apiKey !== "" ? { apiKey } : {}), ...(clearKey ? { clearApiKey: true } : {}) };
  };
  const save = async () => {
    const input = request();
    if (input === null) return;
    setBusy("save"); setError(null); setNotice(null);
    try {
      const result = await window.agent.searchSettingsSave(input);
      if (!alive.current) return;
      if (!result.ok) { setError(result.error); return; }
      setSaved(result.settings); setDraft(draftOf(result.settings)); setClearKey(false);
      if (keyInput.current) keyInput.current.value = "";
      setNotice(STR.network.savedNotice);
      props.onSaved?.();
    } catch (err) {
      if (alive.current) setError(STR.network.saveFailedPrefix + (err instanceof Error ? err.message : String(err)));
    } finally { if (alive.current) setBusy(null); }
  };
  const testConnection = async () => {
    const input = request();
    if (input === null) return;
    setBusy("test"); setTest(null); setError(null); setNotice(null);
    try {
      const result = await window.agent.searchSettingsTest(input);
      if (alive.current) setTest(result);
    } catch (err) {
      if (alive.current) setError(STR.network.testFailedPrefix + (err instanceof Error ? err.message : String(err)));
    } finally { if (alive.current) setBusy(null); }
  };

  if (draft === null || saved === null) return (
    <SettingsPage title={STR.network.title}>
      {busy === "load" ? <p className="sp-note" role="status">{STR.network.loading}</p> : (
        <div className="ns-result error" role="alert"><p>{error}</p><button type="button" className="mini-btn" onClick={() => void load()}><RefreshCw size={13} />{STR.network.reload}</button></div>
      )}
    </SettingsPage>
  );

  const preset = PROVIDERS[draft.provider];
  const customEndpoint = draft.provider === "searxng" || draft.provider === "custom";
  const sameService = saved.provider === draft.provider && saved.endpoint === draft.endpoint;
  const hasSavedKey = sameService && saved.hasKey && !clearKey;
  const endpointField = (
    <SettingsRow label={STR.network.serviceAddress}>
      <Field width="full"><input type="url" aria-label={STR.network.serviceAddressAria} value={draft.endpoint} placeholder={draft.provider === "searxng" ? "https://search.example.com" : "https://search.example.com/search"} onChange={(e) => { change({ endpoint: e.target.value }); setClearKey(false); }} /></Field>
    </SettingsRow>
  );

  return (
    <SettingsPage title={STR.network.title}>
      <form className="network-settings" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <fieldset disabled={busy !== null}>
          <SettingsSection title={saved.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? STR.network.currentProject}>
            <SettingsRow label={STR.network.enableLabel}>
              <label className="ns-switch"><input type="checkbox" aria-label={STR.network.enableLabel} checked={draft.enabled} onChange={(e) => change({ enabled: e.target.checked })} /><span>{draft.enabled ? STR.network.on : STR.network.off}</span></label>
            </SettingsRow>
            <SettingsRow label={STR.network.webAutoApprove}>
              <Switch
                checked={webAuto}
                label={STR.network.webAutoApprove}
                onChange={(next) => {
                  setWebAuto(next);
                  void window.agent.setSettings({ webAutoApprove: next }).then(() => props.onSaved?.()).catch((err: unknown) => {
                    if (alive.current) setError(STR.network.saveFailedPrefix + (err instanceof Error ? err.message : String(err)));
                  });
                }}
              />
            </SettingsRow>
            <SettingsRow label={STR.network.providerLabel}>
              <Field width="full" select><select aria-label={STR.network.providerLabel} value={draft.provider} onChange={(e) => {
                const provider = e.target.value as SearchProvider;
                change({ provider, endpoint: provider === saved.provider ? saved.endpoint : PROVIDERS[provider].endpoint, allowLocalEndpoint: provider === saved.provider && saved.allowLocalEndpoint });
                setClearKey(false); if (keyInput.current) keyInput.current.value = "";
              }}>{Object.entries(PROVIDERS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></Field>
            </SettingsRow>
            {customEndpoint && endpointField}
            <SettingsRow label={preset.key ? STR.network.apiKey : STR.network.apiKeyOptional} >
              <div className="ns-secret">
                <Field width="full"><input ref={keyInput} type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} aria-label={STR.network.apiKeyAria} placeholder={hasSavedKey ? STR.network.keySavedKeepEmpty : STR.network.keyPastePlaceholder} onChange={() => { setTest(null); setNotice(null); setError(null); setClearKey(false); }} /></Field>
                <button type="button" className="mini-btn ns-eye" aria-label={showKey ? STR.network.hideKeyAria : STR.network.showKeyAria} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
              {hasSavedKey && <button type="button" className="mini-btn ghost" onClick={() => { setClearKey(true); setTest(null); setNotice(STR.network.removeKeyNotice); }}>{STR.network.removeSavedKey}</button>}
              {sameService && saved.keySource === "environment" && <p className="ss-hint">{STR.network.envKeyHint}</p>}
              {!saved.secureStorageAvailable && <p className="sp-note warn">{STR.network.secureStorageUnavailable}</p>}
            </SettingsRow>
          </SettingsSection>
          <details className="ns-advanced">
            <summary>{STR.network.advancedOptions}</summary>
            {!customEndpoint && endpointField}
            <SettingsRow label={STR.network.allowLocalLabel}>
              <label className="ns-switch"><input type="checkbox" aria-label={STR.network.allowLocalAria} checked={draft.allowLocalEndpoint} onChange={(e) => change({ allowLocalEndpoint: e.target.checked })} /><span>{draft.allowLocalEndpoint ? STR.network.allow : STR.network.off}</span></label>
            </SettingsRow>
          </details>
          <div className="ns-actions">
            <button type="button" className="mini-btn" onClick={() => void testConnection()}>{busy === "test" ? <Loader2 size={14} className="ns-spinner" /> : <Globe size={14} />} {busy === "test" ? STR.network.testing : STR.network.test}</button>
            <button type="submit" className="mini-btn primary">{busy === "save" ? STR.network.saving : STR.network.save}</button>
          </div>
        </fieldset>
        <div className="ns-feedback" aria-live="polite">
          {error !== null && <p className="ns-result error" role="alert">{error}</p>}
          {notice !== null && <p className="ns-result"><Check size={15} aria-hidden="true" />{notice}</p>}
          {test !== null && <p className={"ns-result" + (test.ok ? " success" : " error")} role="status">{test.ok ? <><Check size={15} aria-hidden="true" />{STR.network.testOkPrefix + test.elapsedMs + STR.network.testOkMs + test.resultCount + STR.network.testOkCountSuffix}</> : test.error ?? STR.network.testFail}</p>}
        </div>
      </form>
    </SettingsPage>
  );
}
