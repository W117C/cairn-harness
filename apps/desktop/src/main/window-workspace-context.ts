import { AsyncLocalStorage } from "node:async_hooks";

interface Entry { workspace: string | null; version: number; alive: boolean }
interface Invocation<Owner> { runOwner: Owner | null; entry: Entry; workspace: string | null }

/** Trusted IPC sender owns the selection; each invocation reads a stable snapshot. */
export class WindowWorkspaceContext<Owner extends object = object> {
  private readonly windows = new WeakMap<Owner, Entry>();
  private readonly invocation = new AsyncLocalStorage<Invocation<Owner>>();

  constructor(private readonly validate: (path: string) => Promise<string | null>) {}

  run<T>(owner: Owner, callback: () => T, agentRun = false): T {
    let entry = this.windows.get(owner);
    if (entry === undefined) {
      entry = { workspace: null, version: 0, alive: true };
      this.windows.set(owner, entry);
    }
    return this.invocation.run({ runOwner: agentRun ? owner : null, entry, workspace: entry.workspace }, callback);
  }

  current(): string | null {
    const call = this.invocation.getStore();
    return call?.entry.alive ? call.workspace : null;
  }

  /** Only a direct agent run grants a browser owner. Other IPC and timer jobs carry none. */
  currentRunOwner(): Owner | null {
    const call = this.invocation.getStore();
    return call?.entry.alive ? call.runOwner : null;
  }

  require(): string {
    const workspace = this.current();
    if (workspace === null) throw new Error("工作区未知——先在当前窗口打开一个项目");
    return workspace;
  }

  async select(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = this.invocation.getStore()?.entry;
    if (entry === undefined || !entry.alive) return { ok: false, error: "调用窗口已关闭" };
    const version = ++entry.version;
    if (path === "") { entry.workspace = null; return { ok: true }; }
    const canonical = await this.validate(path);
    if (!entry.alive || entry.version !== version) return { ok: false, error: "工作区选择已过期" };
    if (canonical === null) return { ok: false, error: `未注册的工作区，已拒绝：${path}` };
    entry.workspace = canonical;
    return { ok: true };
  }

  inherit(owner: Owner): void {
    this.windows.set(owner, { workspace: this.current(), version: 0, alive: true });
  }

  forget(owner: Owner): void {
    const entry = this.windows.get(owner);
    if (entry !== undefined) { entry.alive = false; entry.version++; }
    this.windows.delete(owner);
  }
}
