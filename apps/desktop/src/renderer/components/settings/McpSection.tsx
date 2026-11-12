import { useMemo, useRef, useState } from "react";
import { Network, Plug, Plus, Terminal } from "lucide-react";
import type { McpServerConfig } from "../../../../../../src/agent/plugins/types";
import { ConfirmDialog } from "../ConfirmDialog";
import { Badge, EmptyState, StatusDot } from "../settings-ui";
import { Switch } from "../Switch";
import {
  IntegrationFeedback, IntegrationInput, IntegrationItem, IntegrationLoading, IntegrationPath,
  IntegrationSubview, IntegrationToolbar, errorMessage, parseStringArray, useIntegrationConfig,
} from "./integration-ui";
import { STR } from "../../strings";

type Server = { name: string; config: McpServerConfig };
const EMPTY_SERVERS: Server[] = [];
type Kind = "stdio" | "http" | "sse";

export interface McpDraft {
  name: string;
  kind: Kind;
  command: string;
  args: string;
  url: string;
  headers: string;
  env: string;
  includeTools: string;
  excludeTools: string;
  disabled?: boolean;
  extra?: Record<string, unknown>;
  originalType?: string;
}

export const MCP_EMPTY_DRAFT: McpDraft = {
  name: "", kind: "stdio", command: "", args: "", url: "", headers: "", env: "",
  includeTools: "", excludeTools: "",
};

function serverKind(config: { command?: unknown; type?: unknown }): Kind {
  return typeof config.command === "string" ? "stdio" : config.type === "sse" ? "sse" : "http";
}

export function mcpDraftFrom(name: string, config: Readonly<Record<string, unknown>>): McpDraft {
  const json = (value: unknown): string => value === undefined ? "" : JSON.stringify(value);
  const { command, args, url, headers, env, includeTools, excludeTools, disabled, type, ...extra } = config;
  const simpleArgs = Array.isArray(args) && args.length > 0 && args.every((arg) =>
    typeof arg === "string" && arg !== "" && !/[\s\[\]"'\\]/u.test(arg));
  return {
    name,
    extra,
    kind: serverKind(config),
    command: typeof command === "string" ? command : "",
    url: typeof url === "string" ? url : "",
    args: simpleArgs ? args.join(" ") : json(args),
    headers: json(headers),
    env: json(env),
    includeTools: json(includeTools),
    excludeTools: json(excludeTools),
    ...(typeof disabled === "boolean" ? { disabled } : {}),
    ...(typeof type === "string" ? { originalType: type } : {}),
  };
}

function parseStringMap(raw: string, separator: string): Record<string, string> {
  if (!raw.startsWith("{")) {
    const pairs = raw.split("\n").filter((line) => line.trim() !== "").map((line) => {
      const boundary = line.indexOf(separator);
      const key = line.slice(0, boundary).trim();
      if (boundary <= 0 || key === "") throw new Error();
      return [key, line.slice(boundary + 1).trim()] as const;
    });
    return Object.fromEntries(pairs);
  }
  const value: unknown = JSON.parse(raw);
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.entries(value).some(([key, entry]) => key === "" || typeof entry !== "string")) {
    throw new Error(STR.mcp.mapParseFail);
  }
  return value as Record<string, string>;
}

export function mcpDraftPayload(draft: McpDraft): { ok: true; config: McpServerConfig } | { ok: false; error: string } {
  if (draft.name.trim() === "") return { ok: false, error: STR.mcp.needName };
  const config: McpServerConfig = { ...draft.extra };
  if (draft.kind === "stdio") {
    config.command = draft.command.trim();
    if (config.command === "") return { ok: false, error: STR.mcp.needCommand };
  } else {
    try {
      const url = new URL(draft.url.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      config.url = draft.url.trim();
      if (draft.kind === "sse") config.type = "sse";
    } catch {
      return { ok: false, error: STR.mcp.needValidUrl };
    }
  }
  for (const [key, label] of [["args", STR.mcp.labelArgs], ["includeTools", STR.mcp.labelIncludeTools], ["excludeTools", STR.mcp.labelExcludeTools]] as const) {
    const raw = draft[key].trim();
    if (raw === "") continue;
    try {
      if (key === "args" && !raw.startsWith("[") && /[\]"'\\]/u.test(raw)) throw new Error();
      config[key] = raw.startsWith("[") ? parseStringArray(raw)
        : raw.split(key === "args" ? /\s+/ : ",").map((entry) => entry.trim()).filter(Boolean);
    } catch {
      return { ok: false, error: STR.mcp.arrayFail.replace("{label}", label) };
    }
  }
  for (const [key, label, separator] of [["headers", STR.mcp.labelHeaders, ":"], ["env", STR.mcp.labelEnv, "="]] as const) {
    const raw = draft[key].trim();
    if (raw === "") continue;
    try { config[key] = parseStringMap(raw, separator); }
    catch { return { ok: false, error: STR.mcp.mapFail.replace("{label}", label) }; }
  }
  if (draft.originalType !== undefined && config.type === undefined) {
    Object.assign(config, { type: draft.originalType });
  }
  if (draft.disabled !== undefined) config.disabled = draft.disabled;
  return { ok: true, config };
}

export function replaceMcpServer(servers: readonly Server[], original: string | null, next: Server): Server[] | null {
  if (servers.some((server) => server.name === next.name && server.name !== original)) return null;
  if (original === null) return [...servers, next];
  if (!servers.some((server) => server.name === original)) return null;
  return servers.map((server) => server.name === original ? next : server);
}

const TRANSPORTS = [
  { value: "stdio", label: STR.mcp.transportStdio },
  { value: "http", label: STR.mcp.transportHttp },
  { value: "sse", label: STR.mcp.transportSse },
] as const;
const TRANSPORT_LABEL = { stdio: "stdio", http: "HTTP", sse: "SSE" } as const;

function previewServer(config: McpServerConfig): string {
  if (config.command !== undefined) return config.command;
  try {
    return new URL(config.url ?? "").host;
  } catch {
    return "";
  }
}

function McpForm({ draft, setDraft, busy, blocked, onSave, onCancel }: {
  draft: McpDraft;
  setDraft: (draft: McpDraft) => void;
  busy: boolean;
  blocked: boolean;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const change = <K extends keyof McpDraft,>(key: K, value: McpDraft[K]): void => setDraft({ ...draft, [key]: value });
  return (
    <fieldset className="integrations-form" disabled={busy}>
      <div className="integrations-pair">
        <IntegrationInput label={STR.mcp.name} value={draft.name} onChange={(value) => change("name", value)} placeholder="my-server" />
        <IntegrationInput label={STR.mcp.transport} value={draft.kind} options={TRANSPORTS} onChange={(value) => {
          const kind = value as Kind;
          const { originalType: _originalType, ...fields } = draft;
          setDraft({ ...fields, kind, ...(kind === "stdio" ? { headers: "" } : { args: "" }) });
        }} />
      </div>
      {draft.kind === "stdio" ? <>
        <IntegrationInput label={STR.mcp.command} value={draft.command} onChange={(value) => change("command", value)} placeholder="/path/to/server" />
        <IntegrationInput label={STR.mcp.labelArgs} value={draft.args} onChange={(value) => change("args", value)} multiline
          placeholder='["--path", "/path with spaces", ""]' hint={STR.mcp.argsHint} />
      </> : <IntegrationInput label={STR.mcp.url} value={draft.url} onChange={(value) => change("url", value)} placeholder="https://example.com/mcp" />}
      <div className="integrations-field">
        <Switch checked={draft.disabled !== true} onChange={(enabled) => change("disabled", !enabled)} label={STR.mcp.enable} busy={busy} />
        <small>{draft.kind === "stdio" ? STR.mcp.enableStdioNote : STR.mcp.enableRemoteNote}</small>
      </div>
      <details className="integrations-advanced">
        <summary>{STR.mcp.advanced}</summary>
        {(draft.kind !== "stdio" || draft.headers !== "") && <IntegrationInput label={STR.mcp.labelHeaders} value={draft.headers} onChange={(value) => change("headers", value)}
          multiline placeholder='{"Authorization": "Bearer …"}' hint={STR.mcp.headersHint} />}
        <IntegrationInput label={STR.mcp.labelEnv} value={draft.env} onChange={(value) => change("env", value)}
          multiline placeholder='{"KEY": "value"}' hint={STR.mcp.envHint} />
        <div className="integrations-pair">
          <IntegrationInput label={STR.mcp.labelIncludeTools} value={draft.includeTools} onChange={(value) => change("includeTools", value)}
            multiline placeholder='["tool_name"]' hint={STR.mcp.toolsHint} />
          <IntegrationInput label={STR.mcp.labelExcludeTools} value={draft.excludeTools} onChange={(value) => change("excludeTools", value)}
            multiline placeholder='["tool_name"]' hint={STR.mcp.toolsHint} />
        </div>
      </details>
      <div className="integrations-actions">
        <button type="button" className="mini-btn" onClick={onCancel}>{STR.mcp.cancel}</button>
        <button type="button" className="mini-btn primary" disabled={blocked} onClick={onSave}>{busy ? STR.mcp.saving : STR.mcp.saveServer}</button>
      </div>
    </fieldset>
  );
}

export function McpSection(): React.JSX.Element {
  const store = useIntegrationConfig(
    () => window.agent.mcpUserConfig(),
    (next, expectedRevision) => window.agent.mcpUserSave({
      servers: Object.fromEntries(next.servers.map((server) => [server.name, server.config])),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    }),
  );
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ original: string | null; draft: McpDraft } | null>(null);
  const [confirm, setConfirm] = useState<"probe" | "remove" | null>(null);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<{ name: string; text: string; error: boolean } | null>(null);
  const listTitle = useRef<HTMLHeadingElement>(null);
  const config = store.config;
  const servers = config?.servers ?? EMPTY_SERVERS;
  // 第 1141 页：MCP 选中项按 servers/selectedName 记忆，探测/编辑等局部状态不重扫。
  const selected = useMemo(() => servers.find((server) => server.name === selectedName), [servers, selectedName]);

  const returnToList = (): void => {
    setSelectedName(null);
    setEditor(null);
    if (!store.conflict) store.setError(null);
    requestAnimationFrame(() => listTitle.current?.focus());
  };
  const cancelEdit = (): void => {
    if (selected === undefined) returnToList();
    else {
      setEditor(null);
      if (!store.conflict) store.setError(null);
    }
  };
  const edit = (server?: Server): void => {
    store.setError(null);
    setEditor(server
      ? { original: server.name, draft: mcpDraftFrom(server.name, { ...server.config }) }
      : { original: null, draft: { ...MCP_EMPTY_DRAFT } });
  };
  const save = async (): Promise<void> => {
    if (!editor || !config || store.blocked) return;
    const payload = mcpDraftPayload(editor.draft);
    if (!payload.ok) { store.setError(payload.error); return; }
    const name = editor.draft.name.trim();
    const next = replaceMcpServer(servers, editor.original, { name, config: payload.config });
    if (next === null) { store.setError(STR.mcp.nameTaken); return; }
    if (await store.save({ ...config, servers: next })) {
      setProbe(null);
      setSelectedName(name);
      setEditor(null);
    }
  };
  const remove = async (server: Server): Promise<void> => {
    setConfirm(null);
    if (config && await store.save({ ...config, servers: servers.filter((entry) => entry.name !== server.name) })) {
      setProbe(null);
      returnToList();
    }
  };
  const runProbe = async (server: Server): Promise<void> => {
    setConfirm(null);
    setProbe(null);
    setProbing(true);
    try {
      const result = await window.agent.mcpUserProbe({ name: server.name, config: server.config });
      const tools = result.tools ?? [];
      const suffix = tools.length > 0 ? STR.mcp.probeListSuffix + tools.slice(0, 6).join("、") + (tools.length > 6 ? STR.mcp.probeEllipsis : "") : "";
      setProbe(result.ok
        ? { name: server.name, error: false, text: STR.mcp.probeOkPrefix + STR.mcp.probeToolCount.replace("{n}", String(result.toolCount ?? tools.length)) + suffix }
        : { name: server.name, error: true, text: result.error ?? STR.mcp.probeFail });
    } catch (err) {
      setProbe({ name: server.name, error: true, text: errorMessage(err) });
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="integrations">
      {editor ? (
        <IntegrationSubview title={editor.original === null ? STR.mcp.addServer : STR.mcp.editServer}
          onReturn={cancelEdit}
          busy={store.busy} backLabel={editor.original === null ? STR.mcp.serverList : STR.mcp.serverDetail}>
          <IntegrationFeedback error={store.error} />
          <McpForm draft={editor.draft} setDraft={(draft) => setEditor({ ...editor, draft })}
            busy={store.busy} blocked={store.blocked} onSave={() => void save()}
            onCancel={cancelEdit} />
        </IntegrationSubview>
      ) : selected ? (
        <IntegrationSubview title={selected.name} onReturn={returnToList} backLabel={STR.mcp.serverList} busy={probing || store.busy}>
          <dl className="integrations-details">
            <div><dt>{STR.mcp.transport}</dt><dd>{TRANSPORT_LABEL[serverKind(selected.config)]}</dd></div>
            <div><dt>{selected.config.command !== undefined ? STR.mcp.command : STR.mcp.serverHost}</dt><dd><code>{previewServer(selected.config)}</code></dd></div>
            <div><dt>{STR.mcp.status}</dt><dd><StatusDot tone={selected.config.disabled ? "off" : "ok"} />{selected.config.disabled ? STR.mcp.disabled : STR.mcp.enabled}</dd></div>
          </dl>
          <IntegrationFeedback error={store.error ?? (config?.errors.join("；") || null)} notice={store.notice} />
          {probe?.name === selected.name && <IntegrationFeedback error={probe.error ? probe.text : null} notice={probe.error ? null : probe.text} />}
          <div className="integrations-actions">
            <button type="button" className="mini-btn danger-text" disabled={store.blocked || probing} onClick={() => setConfirm("remove")}>{STR.mcp.delete}</button>
            <button type="button" className="mini-btn" disabled={store.blocked || probing} onClick={() => setConfirm("probe")}>
              {probing ? STR.mcp.testing : STR.mcp.test}
            </button>
            <button type="button" className="mini-btn primary" disabled={store.blocked || probing} onClick={() => edit(selected)}>{STR.mcp.edit}</button>
          </div>
          {confirm === "remove" && <ConfirmDialog title={STR.mcp.deleteTitle.replace("{name}", selected.name)} note={STR.mcp.deleteNote}
            danger confirmLabel={STR.mcp.deleteServer} onClose={() => setConfirm(null)} onConfirm={() => void remove(selected)} />}
          {confirm === "probe" && <ConfirmDialog title={STR.mcp.probeTitle.replace("{name}", selected.name)}
            note={selected.config.command !== undefined ? STR.mcp.probeNoteStdio : STR.mcp.probeNoteRemote}
            confirmLabel={STR.mcp.probeStart} onClose={() => setConfirm(null)} onConfirm={() => void runProbe(selected)} />}
        </IntegrationSubview>
      ) : <>
        <IntegrationToolbar headingRef={listTitle} title={STR.mcp.serverList}>
          {servers.length > 0 && <button type="button" className="mini-btn primary" disabled={store.blocked} onClick={() => edit()}>
            <Plus size={15} aria-hidden="true" />{STR.mcp.addServer}
          </button>}
        </IntegrationToolbar>
        <IntegrationFeedback error={store.loadError ?? store.error ?? (config?.errors.join("；") || null)} notice={store.notice} />
        {store.loading ? <IntegrationLoading /> : config === null
          ? <button type="button" className="mini-btn" onClick={() => void store.load()}>{STR.integrations.reload}</button>
          : <>
            {servers.length > 0 ? <ul className="integrations-list" aria-label={STR.mcp.listAria}>
              {servers.map((server) => (
                <IntegrationItem key={server.name} title={server.name} secondary={previewServer(server.config)}
                  icon={server.config.command !== undefined ? <Terminal size={18} /> : <Network size={18} />}
                  status={<><Badge>{TRANSPORT_LABEL[serverKind(server.config)]}</Badge><span className="integrations-status">{server.config.disabled ? STR.mcp.disabled : STR.mcp.enabled}</span></>}
                  onOpen={() => { if (!store.conflict) store.setError(null); setSelectedName(server.name); }} />
              ))}
            </ul> : config.ok && config.errors.length === 0 && <EmptyState icon={<Plug size={22} />} title={STR.mcp.emptyTitle}
              desc={STR.mcp.emptyDesc}
              action={<button type="button" className="mini-btn primary" disabled={store.blocked} onClick={() => edit()}><Plus size={15} aria-hidden="true" />{STR.mcp.addServer}</button>} />}
            <IntegrationPath path={config.path} onReload={() => { setProbe(null); void store.load(); }} />
          </>}
      </>}
    </div>
  );
}
