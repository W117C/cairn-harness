import { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, Globe, Loader2, RefreshCw } from "lucide-react";
import type { SearchProvider, SearchSettingsInput, SearchSettingsSnapshot, SearchSettingsTestResult } from "../../../../../../src/main/ipc-protocol";
import { Field, SettingsPage, SettingsRow, SettingsSection } from "../settings-ui";
import "./network-settings.css";

type Draft = Omit<SearchSettingsInput, "apiKey" | "clearApiKey">;
const PROVIDERS: Record<SearchProvider, { label: string; endpoint: string; key: boolean }> = {
  tavily: { label: "Tavily", endpoint: "https://api.tavily.com/search", key: true },
  brave: { label: "Brave Search", endpoint: "https://api.search.brave.com/res/v1/web/search", key: true },
  searxng: { label: "SearXNG", endpoint: "", key: false },
  custom: { label: "自定义搜索接口", endpoint: "", key: false },
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
  const [clearKey, setClearKey] = useState(false);
  const keyInput = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true);

  const load = async () => {
    setBusy("load"); setError(null);
    try {
      const snapshot = await window.agent.searchSettingsGet();
      if (!alive.current) return;
      setSaved(snapshot); setDraft(draftOf(snapshot));
      if (snapshot.error) setError(snapshot.error);
    } catch (err) {
      if (alive.current) setError(`无法读取搜索设置：${err instanceof Error ? err.message : String(err)}`);
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
      setNotice("设置已保存，将从下一轮对话生效。");
      props.onSaved?.();
    } catch (err) {
      if (alive.current) setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
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
      if (alive.current) setError(`测试失败：${err instanceof Error ? err.message : String(err)}`);
    } finally { if (alive.current) setBusy(null); }
  };

  if (draft === null || saved === null) return (
    <SettingsPage title="联网搜索">
      {busy === "load" ? <p className="sp-note" role="status">正在读取搜索设置…</p> : (
        <div className="ns-result error" role="alert"><p>{error}</p><button type="button" className="mini-btn" onClick={() => void load()}><RefreshCw size={13} />重新加载</button></div>
      )}
    </SettingsPage>
  );

  const preset = PROVIDERS[draft.provider];
  const customEndpoint = draft.provider === "searxng" || draft.provider === "custom";
  const sameService = saved.provider === draft.provider && saved.endpoint === draft.endpoint;
  const hasSavedKey = sameService && saved.hasKey && !clearKey;
  const endpointField = (
    <SettingsRow label="服务地址">
      <Field width="full"><input type="url" aria-label="搜索服务地址" value={draft.endpoint} placeholder={draft.provider === "searxng" ? "https://search.example.com" : "https://search.example.com/search"} onChange={(e) => { change({ endpoint: e.target.value }); setClearKey(false); }} /></Field>
    </SettingsRow>
  );

  return (
    <SettingsPage title="联网搜索">
      <form className="network-settings" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <fieldset disabled={busy !== null}>
          <SettingsSection title={saved.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? "当前项目"}>
            <SettingsRow label="启用联网搜索">
              <label className="ns-switch"><input type="checkbox" aria-label="启用联网搜索" checked={draft.enabled} onChange={(e) => change({ enabled: e.target.checked })} /><span>{draft.enabled ? "开启" : "关闭"}</span></label>
            </SettingsRow>
            <SettingsRow label="服务商">
              <Field width="full" select><select aria-label="服务商" value={draft.provider} onChange={(e) => {
                const provider = e.target.value as SearchProvider;
                change({ provider, endpoint: provider === saved.provider ? saved.endpoint : PROVIDERS[provider].endpoint, allowLocalEndpoint: provider === saved.provider && saved.allowLocalEndpoint });
                setClearKey(false); if (keyInput.current) keyInput.current.value = "";
              }}>{Object.entries(PROVIDERS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></Field>
            </SettingsRow>
            {customEndpoint && endpointField}
            <SettingsRow label={preset.key ? "API Key" : "API Key（可选）"} >
              <div className="ns-secret">
                <Field width="full"><input ref={keyInput} type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} aria-label="搜索 API Key" placeholder={hasSavedKey ? "已保存，留空保留" : "粘贴 API Key"} onChange={() => { setTest(null); setNotice(null); setError(null); setClearKey(false); }} /></Field>
                <button type="button" className="mini-btn ns-eye" aria-label={showKey ? "隐藏搜索密钥" : "显示搜索密钥"} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
              {hasSavedKey && <button type="button" className="mini-btn ghost" onClick={() => { setClearKey(true); setTest(null); setNotice("保存后将移除该服务的密钥。"); }}>移除已存密钥</button>}
              {sameService && saved.keySource === "environment" && <p className="ss-hint">当前检测到环境配置的密钥。</p>}
              {!saved.secureStorageAvailable && <p className="sp-note warn">当前系统安全存储不可用，暂时无法保存新的密钥。</p>}
            </SettingsRow>
          </SettingsSection>
          <details className="ns-advanced">
            <summary>高级连接选项</summary>
            {!customEndpoint && endpointField}
            <SettingsRow label="允许本机或局域网服务">
              <label className="ns-switch"><input type="checkbox" aria-label="允许本机或局域网搜索服务" checked={draft.allowLocalEndpoint} onChange={(e) => change({ allowLocalEndpoint: e.target.checked })} /><span>{draft.allowLocalEndpoint ? "允许" : "关闭"}</span></label>
            </SettingsRow>
          </details>
          <div className="ns-actions">
            <button type="button" className="mini-btn" onClick={() => void testConnection()}>{busy === "test" ? <Loader2 size={14} className="ns-spinner" /> : <Globe size={14} />} {busy === "test" ? "测试中…" : "测试连接"}</button>
            <button type="submit" className="mini-btn primary">{busy === "save" ? "保存中…" : "保存设置"}</button>
          </div>
        </fieldset>
        <div className="ns-feedback" aria-live="polite">
          {error !== null && <p className="ns-result error" role="alert">{error}</p>}
          {notice !== null && <p className="ns-result"><Check size={15} aria-hidden="true" />{notice}</p>}
          {test !== null && <p className={"ns-result" + (test.ok ? " success" : " error")} role="status">{test.ok ? <><Check size={15} aria-hidden="true" />连接成功 · {test.elapsedMs} ms · 返回 {test.resultCount} 条结果</> : test.error ?? "连接未成功，请检查服务地址与密钥。"}</p>}
        </div>
      </form>
    </SettingsPage>
  );
}
