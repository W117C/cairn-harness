import { useMemo, useRef, useState } from "react";
import { Plus, Webhook } from "lucide-react";
import type { HookEventName } from "../../../../../../src/agent/plugins/types";
import { ConfirmDialog } from "../ConfirmDialog";
import { Badge, EmptyState } from "../settings-ui";
import {
  IntegrationFeedback, IntegrationInput, IntegrationItem, IntegrationLoading, IntegrationPath,
  IntegrationSubview, IntegrationToolbar, parseStringArray, useIntegrationConfig,
} from "./integration-ui";
import { STR } from "../../strings";

const HOOK_EVENTS = {
  SessionStart: STR.hooks.eventSessionStart,
  UserPromptSubmit: STR.hooks.eventUserPromptSubmit,
  PreToolUse: STR.hooks.eventPreToolUse,
  PostToolUse: STR.hooks.eventPostToolUse,
  PostToolUseFailure: STR.hooks.eventPostToolUseFailure,
  PreCompact: STR.hooks.eventPreCompact,
  SubagentStart: STR.hooks.eventSubagentStart,
  SubagentStop: STR.hooks.eventSubagentStop,
  Stop: STR.hooks.eventStop,
  SessionEnd: STR.hooks.eventSessionEnd,
} satisfies Record<HookEventName, string>;
const EVENT_OPTIONS = Object.entries(HOOK_EVENTS).map(([value, label]) => ({ value, label: STR.hooks.eventOption.replace("{label}", label).replace("{value}", value) }));
const COMMAND_OPTIONS = [{ value: "shell", label: STR.hooks.commandShell }, { value: "exec", label: STR.hooks.commandExec }];

type Entry = Record<string, unknown>;
type HookTable = Record<string, unknown>;
type HookTarget = { event: string; index: number };
type HookRow = HookTarget & { entry: Entry; handlers: unknown[] };
type CommandDraft = { format: "shell" | "exec"; text: string };
type HookDraft = {
  source: HookRow | null;
  event: string;
  matcher: string;
  commands: Readonly<Record<number, CommandDraft>>;
};

function asObject(value: unknown): Entry | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Entry : null;
}
function handlersFor(table: HookTable, event: string): unknown[] {
  const entries = table[event];
  return Array.isArray(entries) ? entries : [];
}
function rowsOf(table: HookTable): HookRow[] {
  return Object.keys(table).flatMap((event) => handlersFor(table, event).flatMap((value, index) => {
    const entry = asObject(value);
    return entry && Array.isArray(entry.hooks) ? [{ event, index, entry, handlers: entry.hooks }] : [];
  }));
}
function eventLabel(event: string): string {
  return Object.hasOwn(HOOK_EVENTS, event) ? HOOK_EVENTS[event as HookEventName] : event;
}
function matcherOf(row: HookRow): string {
  return typeof row.entry.matcher === "string" ? row.entry.matcher : "";
}

export function makeHookDraft(source: HookRow | null): HookDraft {
  const commands: Record<number, CommandDraft> = {};
  source?.handlers.forEach((value, index) => {
    const handler = asObject(value);
    if (handler?.type !== "command") return;
    if (typeof handler.command === "string") commands[index] = { format: "shell", text: handler.command };
    if (Array.isArray(handler.command) && handler.command.every((part) => typeof part === "string")) {
      commands[index] = { format: "exec", text: JSON.stringify(handler.command) };
    }
  });
  return {
    source,
    event: source?.event ?? "SessionStart",
    matcher: source ? matcherOf(source) : "",
    commands: source ? commands : { 0: { format: "shell", text: "" } },
  };
}

export function hookDraftEntry(draft: HookDraft): { ok: true; entry: Entry } | { ok: false; error: string } {
  const hooks = draft.source ? [...draft.source.handlers] : [{}];
  for (const [key, command] of Object.entries(draft.commands)) {
    const index = Number(key);
    let value: string | string[] = command.text;
    if (command.format === "exec") {
      try { value = parseStringArray(command.text); }
      catch { return { ok: false, error: STR.hooks.handlerNeedsArray.replace("{n}", String(index + 1)) }; }
      if (!value[0]?.trim()) return { ok: false, error: STR.hooks.handlerFirstItem.replace("{n}", String(index + 1)) };
    } else if (command.text.trim() === "") {
      return { ok: false, error: STR.hooks.handlerNeedsCommand.replace("{n}", String(index + 1)) };
    }
    hooks[index] = { ...asObject(hooks[index]), type: "command", command: value };
  }
  const entry: Entry = { ...draft.source?.entry, hooks };
  if (!draft.source || draft.matcher !== matcherOf(draft.source)) {
    if (draft.matcher === "") delete entry.matcher;
    else entry.matcher = draft.matcher;
  }
  return { ok: true, entry };
}

function removeHook(table: HookTable, target: HookTarget): HookTable {
  const entries = handlersFor(table, target.event).filter((_, index) => index !== target.index);
  const next = { ...table };
  if (entries.length === 0) delete next[target.event];
  else next[target.event] = entries;
  return next;
}

export function replaceHook(table: HookTable, target: HookTarget | null, event: string, entry: Entry): HookTable {
  if (target?.event === event) {
    return { ...table, [event]: handlersFor(table, event).map((value, index) => index === target.index ? entry : value) };
  }
  const next = target ? removeHook(table, target) : table;
  return { ...next, [event]: [...handlersFor(next, event), entry] };
}

function HookForm({ draft, setDraft, busy, blocked, onSave, onCancel }: {
  draft: HookDraft;
  setDraft: (draft: HookDraft) => void;
  busy: boolean;
  blocked: boolean;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const slots = draft.source?.handlers ?? [{ type: "command" }];
  const options = Object.hasOwn(HOOK_EVENTS, draft.event) ? EVENT_OPTIONS : [...EVENT_OPTIONS, { value: draft.event, label: draft.event }];
  return (
    <fieldset className="integrations-form" disabled={busy}>
      <div className="integrations-pair">
        <IntegrationInput label={STR.hooks.triggerEvent} value={draft.event} options={options} onChange={(event) => setDraft({ ...draft, event })} />
        <IntegrationInput label={STR.hooks.matcher} value={draft.matcher} onChange={(matcher) => setDraft({ ...draft, matcher })}
          placeholder={STR.hooks.matcherAll} hint={STR.hooks.matcherHint} />
      </div>
      {typeof draft.source?.entry.if === "string" && <p className="integrations-note">{STR.hooks.existingIf}<code>{draft.source.entry.if}</code></p>}
      <div className="integrations-handlers">
        <h3>{STR.hooks.handlersTitle}</h3>
        {slots.map((handler, index) => {
          const command = draft.commands[index];
          const definition = asObject(handler);
          const type = typeof definition?.type === "string" ? definition.type : STR.hooks.unknownType;
          if (!command) return (
            <div className="integrations-handler-readonly" key={index}>
              <code>{type}</code><span>{STR.hooks.keepExisting}</span>
            </div>
          );
          const change = (next: CommandDraft): void => setDraft({ ...draft, commands: { ...draft.commands, [index]: next } });
          const executable = command.format === "exec";
          return (
            <div className="integrations-handler" key={index}>
              {!draft.source && <IntegrationInput label={STR.hooks.execMethod} value={command.format} options={COMMAND_OPTIONS}
                onChange={(format) => change({ ...command, format: format === "exec" ? "exec" : "shell" })} />}
              <IntegrationInput label={(executable ? STR.hooks.execCommand : STR.hooks.commandShell) + (slots.length > 1 ? STR.hooks.commandIndexSuffix.replace("{n}", String(index + 1)) : "")}
                value={command.text} onChange={(text) => change({ ...command, text })} multiline
                placeholder={executable ? '["/path/to/program", "--flag", "value with spaces"]' : "echo 'hook started'"}
                hint={executable ? STR.hooks.execHint : undefined} />
            </div>
          );
        })}
      </div>
      <p className="integrations-note">{STR.hooks.saveNote}</p>
      <div className="integrations-actions">
        <button type="button" className="mini-btn" onClick={onCancel}>{STR.hooks.cancel}</button>
        <button type="button" className="mini-btn primary" disabled={blocked} onClick={onSave}>{busy ? STR.hooks.saving : STR.hooks.saveHook}</button>
      </div>
    </fieldset>
  );
}

function describeHandler(value: unknown): { type: string; summary: string | null } {
  const handler = asObject(value);
  const type = typeof handler?.type === "string" ? handler.type : STR.hooks.unknownType;
  if (typeof handler?.command === "string") return { type: STR.hooks.commandShell, summary: handler.command };
  if (Array.isArray(handler?.command)) return { type: STR.hooks.commandExec, summary: JSON.stringify(handler.command) };
  return { type, summary: null };
}

export function HooksSection(): React.JSX.Element {
  const store = useIntegrationConfig(
    () => window.agent.hooksUserConfig(),
    (next, expectedRevision) => window.agent.hooksUserSave({
      hooks: next.hooks, ...(expectedRevision === undefined ? {} : { expectedRevision }),
    }),
  );
  const [target, setTarget] = useState<HookTarget | null>(null);
  const [draft, setDraft] = useState<HookDraft | null>(null);
  const [confirm, setConfirm] = useState(false);
  const listTitle = useRef<HTMLHeadingElement>(null);
  const config = store.config;
  // 第 1141 页：Hook 行表与选中项按配置/目标记忆；草稿输入不重扫。
  const rows = useMemo(() => config ? rowsOf(config.hooks) : [], [config]);
  const selected = useMemo(() => rows.find((row) => row.event === target?.event && row.index === target?.index), [rows, target?.event, target?.index]);
  const returnToList = (): void => {
    setTarget(null);
    setDraft(null);
    if (!store.conflict) store.setError(null);
    requestAnimationFrame(() => listTitle.current?.focus());
  };
  const edit = (row: HookRow | null): void => {
    store.setError(null);
    setDraft(makeHookDraft(row));
  };
  const cancelEdit = (): void => {
    setDraft(null);
    if (!store.conflict) store.setError(null);
    if (!selected) requestAnimationFrame(() => listTitle.current?.focus());
  };
  const save = async (): Promise<void> => {
    if (!config || !draft || store.blocked) return;
    const payload = hookDraftEntry(draft);
    if (!payload.ok) { store.setError(payload.error); return; }
    const index = draft.source?.event === draft.event ? draft.source.index : handlersFor(config.hooks, draft.event).length;
    const hooks = replaceHook(config.hooks, draft.source, draft.event, payload.entry);
    if (await store.save({ ...config, hooks })) {
      setTarget({ event: draft.event, index });
      setDraft(null);
    }
  };
  const remove = async (row: HookRow): Promise<void> => {
    setConfirm(false);
    if (config && await store.save({ ...config, hooks: removeHook(config.hooks, row) })) returnToList();
  };

  return (
    <div className="integrations">
      {draft ? (
        <IntegrationSubview title={draft.source ? STR.hooks.editHook : STR.hooks.addHook} onReturn={cancelEdit}
          busy={store.busy} backLabel={draft.source ? STR.hooks.hookDetail : STR.hooks.hookList}>
          <IntegrationFeedback error={store.error} />
          <HookForm draft={draft} setDraft={setDraft} busy={store.busy} blocked={store.blocked} onSave={() => void save()} onCancel={cancelEdit} />
        </IntegrationSubview>
      ) : selected ? (
        <IntegrationSubview title={eventLabel(selected.event)} onReturn={returnToList} backLabel={STR.hooks.hookList} busy={store.busy}>
          <dl className="integrations-details">
            <div><dt>{STR.hooks.event}</dt><dd><code>{selected.event}</code></dd></div>
            <div><dt>{STR.hooks.matcher}</dt><dd>{matcherOf(selected) || STR.hooks.matcherAll}</dd></div>
            {typeof selected.entry.if === "string" && <div><dt>{STR.hooks.extraCondition}</dt><dd><code>{selected.entry.if}</code></dd></div>}
          </dl>
          {!Object.hasOwn(HOOK_EVENTS, selected.event) && <p className="integrations-note">{STR.hooks.unsupportedEvent}</p>}
          <div className="integrations-handlers">
            <h3>{STR.hooks.handlersTitle}</h3>
            <ol className="integrations-handler-list">
              {selected.handlers.map((value, index) => {
                const { type, summary } = describeHandler(value);
                return <li key={index}><Badge>{type}</Badge>{summary && <code>{summary}</code>}</li>;
              })}
            </ol>
          </div>
          <IntegrationFeedback error={store.error ?? (config?.errors.join("；") || null)} notice={store.notice} />
          <div className="integrations-actions">
            <button type="button" className="mini-btn danger-text" disabled={store.blocked} onClick={() => setConfirm(true)}>{STR.hooks.delete}</button>
            <button type="button" className="mini-btn primary" disabled={store.blocked} onClick={() => edit(selected)}>{STR.hooks.edit}</button>
          </div>
          {confirm && <ConfirmDialog title={STR.hooks.deleteConfirmTitle.replace("{label}", eventLabel(selected.event))}
            note={STR.hooks.deleteConfirmNote.replace("{n}", String(selected.handlers.length))}
            danger confirmLabel={STR.hooks.deleteHook} onClose={() => setConfirm(false)} onConfirm={() => void remove(selected)} />}
        </IntegrationSubview>
      ) : <>
        <IntegrationToolbar headingRef={listTitle} title={STR.hooks.hookList}>
          {rows.length > 0 && <button type="button" className="mini-btn primary" disabled={store.blocked} onClick={() => edit(null)}>
            <Plus size={15} aria-hidden="true" />{STR.hooks.addHook}
          </button>}
        </IntegrationToolbar>
        <IntegrationFeedback error={store.loadError ?? store.error ?? (config?.errors.join("；") || null)} notice={store.notice} />
        {store.loading ? <IntegrationLoading /> : config === null
          ? <button type="button" className="mini-btn" onClick={() => void store.load()}>{STR.integrations.reload}</button>
          : <>
            {rows.length > 0 ? <ul className="integrations-list" aria-label={STR.hooks.listAria}>
              {rows.map((row) => (
                <IntegrationItem key={`${row.event}:${row.index}`} title={eventLabel(row.event)} secondary={matcherOf(row) || STR.hooks.matchAll}
                  icon={<Webhook size={18} />} status={<span className="integrations-status">{Object.hasOwn(HOOK_EVENTS, row.event) ? STR.hooks.handlerCount.replace("{n}", String(row.handlers.length)) : STR.hooks.unsupported}</span>}
                  onOpen={() => { if (!store.conflict) store.setError(null); setTarget(row); }} />
              ))}
            </ul> : config.ok && config.errors.length === 0 && <EmptyState icon={<Webhook size={22} />} title={STR.hooks.emptyTitle}
              desc={STR.hooks.emptyDesc}
              action={<button type="button" className="mini-btn primary" disabled={store.blocked} onClick={() => edit(null)}><Plus size={15} aria-hidden="true" />{STR.hooks.addHook}</button>} />}
            <IntegrationPath path={config.path} onReload={() => void store.load()} />
          </>}
      </>}
    </div>
  );
}
