import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
function section(start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function element() {
  const listeners: Record<string, (event: any) => any> = {};
  return {
    value: "", textContent: "", title: "", disabled: true, innerHTML: "", className: "",
    listeners, attributes: {} as Record<string, string>,
    addEventListener(name: string, fn: (event: any) => any) { listeners[name] = fn; },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    prepend: vi.fn(), querySelector: (_selector: string): any => undefined,
  };
}
function boot() {
  const settings = deferred<{ workspace?: string | null }>();
  const input = element(), save = element(), status = element(), form = element();
  const controls: Record<string, ReturnType<typeof element>> = { '#workspacePath': input, '#workspaceSave': save, '#workspaceStatus': status };
  form.querySelector = (selector) => controls[selector];
  const context = {
    api: {
      getSettings: vi.fn(() => settings.promise),
      setSettings: vi.fn(async (_patch: { workspace: string | null }) => ({})),
      run: vi.fn(async (_payload: any) => ({ ok: true })),
      createSession: vi.fn(async () => ({ id: 'created' })),
    },
    document: { createElement: vi.fn(() => form) }, $: vi.fn(() => element()),
    ctxWorkspaceLabel: element(), ctxWorkspace: element(), syncCtxChipState: vi.fn(),
    real: { id: 'real-session' as string | null, running: false },
    promptInput: { value: 'fix this' }, toast: vi.fn(), send: undefined as unknown as () => Promise<void>,
    loadSessions: vi.fn(), activeFileDoc: null, openView: vi.fn(), finalizePending: vi.fn(),
    appendUser: vi.fn(), ensureAi: vi.fn(), syncStatusbar: vi.fn(), setRunning: vi.fn(),
    PERM_MAP: { standard: 'default' }, permMode: { id: 'standard' },
    // Deliberately present: actual sending must ignore all demo path variants.
    currentWs: { path: '~/dev/coding-suite' },
  };
  runInNewContext(section('  /* ---------- 真实运行目录：', '  /* ---------- 运行目录接线结束') +
    section('  send = async function () {', '  selectSession = async function'), context);
  const flush = () => new Promise<void>((done) => setImmediate(done));
  const edit = (value: string) => { input.value = value; input.listeners.input({}); };
  const submit = () => form.listeners.submit({ preventDefault: vi.fn() });
  return { context, settings, input, save, status, form, flush, edit, submit };
}

it('loads the real setting before sending, locks startup edits and suppresses duplicate sends', async () => {
  const b = boot();
  expect(b.form.innerHTML).toContain('for="workspacePath"');
  const first = b.context.send();
  await b.context.send();
  await b.submit();
  expect(b.context.api.setSettings).not.toHaveBeenCalled();
  expect(b.context.api.run).not.toHaveBeenCalled();
  b.settings.resolve({ workspace: '/Users/me/real project' });
  await first;
  expect(b.context.api.getSettings).toHaveBeenCalledTimes(1);
  expect(b.input.value).toBe('/Users/me/real project');
  expect(b.context.api.run).toHaveBeenCalledExactlyOnceWith({
    message: 'fix this', mode: 'default', sessionId: 'real-session', workspace: '/Users/me/real project',
  });
});

it.each([null, '', '   ', undefined])('omits workspace for empty/default setting %s, never sends demo paths', async (workspace) => {
  const b = boot();
  b.settings.resolve({ workspace });
  await b.flush();
  for (const path of ['~/dev/coding-suite', '~/dev/docs-site', '~/work/edge-gateway', '本机 · 4 个文件']) {
    b.context.currentWs.path = path;
    b.context.promptInput.value = 'fix this';
    b.context.real.running = false;
    await b.context.send();
  }
  expect(b.context.api.run).toHaveBeenCalledTimes(4);
  for (const [payload] of b.context.api.run.mock.calls) {
    expect(payload).toEqual({ message: 'fix this', mode: 'default', sessionId: 'real-session' });
    expect(Object.hasOwn(payload, 'workspace')).toBe(false);
  }
});

it.each(['relative/project', '~/dev/project', '$HOME/project', '/tmp/\u0000bad'])('rejects invalid saved path %s visibly before session creation', async (workspace) => {
  const b = boot();
  b.context.real.id = null;
  b.settings.resolve({ workspace });
  await b.context.send();
  expect(b.status.textContent).toContain('绝对路径');
  expect(b.input.attributes['aria-invalid']).toBe('true');
  expect(b.context.api.run).not.toHaveBeenCalled();
  expect(b.context.api.createSession).not.toHaveBeenCalled();
  expect(b.context.promptInput.value).toBe('fix this');
});

it('validates edits, persists only workspace, sends the saved path, and clears it to null', async () => {
  const b = boot();
  b.settings.resolve({ workspace: '/old' });
  await b.flush();
  b.edit('relative');
  await b.submit();
  expect(b.context.api.setSettings).not.toHaveBeenCalled();
  expect(b.status.textContent).toContain('绝对路径');
  await b.context.send();
  expect(b.context.api.run).not.toHaveBeenCalled();
  b.edit('  /new real project  ');
  await b.submit();
  expect(b.context.api.setSettings).toHaveBeenCalledExactlyOnceWith({ workspace: '/new real project' });
  expect(b.input.attributes['aria-invalid']).toBe('false');
  await b.context.send();
  expect(b.context.api.run.mock.calls[0][0].workspace).toBe('/new real project');
  b.context.real.running = false;
  b.context.promptInput.value = 'again';
  b.edit('   ');
  await b.submit();
  expect(b.context.api.setSettings).toHaveBeenLastCalledWith({ workspace: null });
  await b.context.send();
  expect(Object.hasOwn(b.context.api.run.mock.calls[1][0], 'workspace')).toBe(false);
});

it('blocks unsaved edits and pending saves, serializes saves, then runs only after persistence', async () => {
  const b = boot();
  b.settings.resolve({ workspace: '/old' });
  await b.flush();
  b.edit('/new');
  await b.context.send();
  expect(b.context.api.run).not.toHaveBeenCalled();
  const pending = deferred<{}>();
  b.context.api.setSettings.mockImplementationOnce(() => pending.promise);
  const saving = b.submit();
  expect(b.input.disabled).toBe(true);
  await b.submit();
  await b.context.send();
  expect(b.context.api.setSettings).toHaveBeenCalledTimes(1);
  expect(b.context.api.run).not.toHaveBeenCalled();
  pending.resolve({});
  await saving;
  await b.context.send();
  expect(b.context.api.run.mock.calls[0][0].workspace).toBe('/new');
});

it('fails visibly on read/save errors and permits recovery by an explicit successful save', async () => {
  const b = boot();
  b.settings.reject(new Error('read offline'));
  await b.context.send();
  expect(b.status.textContent).toContain('read offline');
  expect(b.context.api.run).not.toHaveBeenCalled();
  b.edit('/chosen');
  b.context.api.setSettings.mockRejectedValueOnce(new Error('disk full'));
  await b.submit();
  expect(b.status.textContent).toContain('disk full');
  await b.context.send();
  expect(b.context.api.run).not.toHaveBeenCalled();
  await b.submit();
  await b.context.send();
  expect(b.context.api.run.mock.calls[0][0].workspace).toBe('/chosen');
});

it('does not allow workspace persistence to race an in-flight session creation/run', async () => {
  const b = boot();
  b.settings.resolve({ workspace: '/selected' });
  await b.flush();
  const created = deferred<{ id: string }>();
  b.context.api.createSession.mockImplementationOnce(() => created.promise);
  b.context.real.id = null;
  const sending = b.context.send();
  await b.flush();
  b.edit('/later');
  await b.submit();
  expect(b.context.api.setSettings).not.toHaveBeenCalled();
  created.resolve({ id: 'created' });
  await sending;
  expect(b.context.api.run.mock.calls[0][0].workspace).toBe('/selected');
});
