import { mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { relocateRegisteredProject } from "../src/main/project-presence";
import { handleAttachmentThumb } from "../src/main/thumb";
import { parsePaneHash } from "../src/renderer/components/panes";
import { popoutEventBelongsTo } from "../src/renderer/projections";
import { createKernelHost } from "../src/main/kernel-host";
import { createSession as createSessionInRoot, pathOf } from "../../../src/main/sessions";

vi.mock("electron", () => {
  class FakeWebContentsView {
    visible = true;
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    webContents = {
      url: "",
      destroyed: false,
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        clearStorageData: vi.fn(async () => undefined),
        clearCache: vi.fn(async () => undefined),
      },
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
        goBack: vi.fn(),
        goForward: vi.fn(),
      },
      getURL: () => this.webContents.url,
      getTitle: () => `title:${this.webContents.url}`,
      isLoading: () => false,
      isDestroyed: () => this.webContents.destroyed,
      close: () => { this.webContents.destroyed = true; },
      reload: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn(async () => ({ ok: true, selector: "#app" })),
      on: (event: string, fn: (...args: unknown[]) => void) => {
        const list = this.listeners.get(event) ?? [];
        list.push(fn);
        this.listeners.set(event, list);
      },
      loadURL: async (url: string) => {
        this.webContents.url = url;
        for (const fn of this.listeners.get("did-navigate") ?? []) fn();
      },
    };
    setVisible(v: boolean) { this.visible = v; }
    setBounds(b: { x: number; y: number; width: number; height: number }) { this.bounds = b; }
  }
  return {
    WebContentsView: FakeWebContentsView,
    nativeImage: {
      createFromBuffer: (buf: Buffer) => ({
        isEmpty: () => buf.length < 4,
        resize: () => ({ toDataURL: () => `data:image/png;base64,${buf.toString("base64")}` }),
      }),
    },
  };
});

describe("Wave 5 desktop main regressions", () => {
  it("relocateRegisteredProject updates registry and syncs KernelHost workspaces", async () => {
    const added: string[] = [];
    const removed: string[] = [];
    const updated = await relocateRegisteredProject(
      "proj-1",
      "/ws/new",
      {
        get: async () => ({ id: "proj-1", path: "/ws/old" }),
        relocate: async (_id, next) => ({ id: "proj-1", path: next }),
      },
      {
        addWorkspace: (ws) => { added.push(ws); },
        removeWorkspace: (ws) => { removed.push(ws); },
      },
      "/ws/pinned-default",
    );
    expect(updated.path).toBe("/ws/new");
    expect(removed).toEqual(["/ws/old"]);
    expect(added).toEqual(["/ws/new"]);
  });

  it("relocateRegisteredProject does not remove pinned default workspace and tolerates busy old workspace", async () => {
    const added: string[] = [];
    const removed: string[] = [];
    await relocateRegisteredProject(
      "proj-1",
      "/ws/new",
      {
        get: async () => ({ id: "proj-1", path: "/ws/default" }),
        relocate: async (_id, next) => ({ id: "proj-1", path: next }),
      },
      {
        addWorkspace: (ws) => { added.push(ws); },
        removeWorkspace: (ws) => { removed.push(ws); },
      },
      "/ws/default",
    );
    expect(removed).toEqual([]);
    expect(added).toEqual(["/ws/new"]);

    const addedBusy: string[] = [];
    await relocateRegisteredProject(
      "proj-2",
      "/ws/new2",
      {
        get: async () => ({ id: "proj-2", path: "/ws/busy" }),
        relocate: async (_id, next) => ({ id: "proj-2", path: next }),
      },
      {
        addWorkspace: (ws) => { addedBusy.push(ws); },
        removeWorkspace: () => { throw new Error("busy"); },
      },
    );
    expect(addedBusy).toEqual(["/ws/new2"]);
  });

  it("BrowserHost isolates same tab id across multiple BrowserWindows and scopes push callbacks", async () => {
    const { BrowserHost } = await import("../src/main/browser-host");
    const makeWindow = (id: number) => {
      const children = new Set<unknown>();
      const closeHandlers: (() => void)[] = [];
      let destroyed = false;
      return {
        id,
        isDestroyed: () => destroyed,
        contentView: {
          addChildView: (v: unknown) => { children.add(v); },
          removeChildView: (v: unknown) => { children.delete(v); },
        },
        once: (ev: string, cb: () => void) => {
          if (ev === "closed") closeHandlers.push(cb);
        },
        destroyWindow: () => {
          destroyed = true;
          for (const cb of closeHandlers) cb();
        },
        childCount: () => children.size,
      };
    };

    const win1 = makeWindow(1);
    const win2 = makeWindow(2);
    const pushes: { winId: number | undefined; id: string; url: string }[] = [];
    const host = new BrowserHost(
      () => win1 as never,
      (state, owner) => {
        pushes.push({ winId: (owner as { id?: number } | undefined)?.id, id: state.id, url: state.url });
      },
    );

    expect(host.open("b1", "https://example.com/main", win1 as never)).toEqual({ ok: true });
    expect(host.open("b1", "https://example.com/popout", win2 as never)).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(win1.childCount()).toBe(1);
    expect(win2.childCount()).toBe(1);
    expect(pushes).toContainEqual({ winId: 1, id: "b1", url: "https://example.com/main" });
    expect(pushes).toContainEqual({ winId: 2, id: "b1", url: "https://example.com/popout" });

    // Closing b1 in win2 must NOT close b1 in win1
    host.close("b1", win2 as never);
    expect(win2.childCount()).toBe(0);
    expect(win1.childCount()).toBe(1);
    expect(host.webContentsForAudit("b1", win1 as never)?.getURL()).toBe("https://example.com/main");

    win1.destroyWindow();
    expect(host.webContentsForAudit("b1", win1 as never)).toBeNull();
  });

  it("handleAttachmentThumb reads asynchronously and validates extension/decode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cairn-thumb-"));
    const pngPath = join(dir, "sample.png");
    await writeFile(pngPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const res = await handleAttachmentThumb(pngPath);
    expect(res.ok).toBe(true);
    expect(res.dataUrl).toContain("data:image/png;base64,");

    const badExt = await handleAttachmentThumb(join(dir, "notes.txt"));
    expect(badExt.ok).toBe(false);
  });

  it("gitStatus in main index.ts is gated by resolveKnownProjectTarget", () => {
    const main = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");
    const i = main.indexOf("gitStatus: async (path)");
    expect(i).toBeGreaterThan(-1);
    const fn = main.slice(i, i + 400);
    expect(fn).toContain("resolveKnownProjectTarget(p)");
    expect(fn.indexOf("resolveKnownProjectTarget(p)")).toBeLessThan(fn.indexOf("gitStatus(canonical)"));
  });

  it("Popout hash & event scoping carry workspace without breaking legacy hash format", () => {
    expect(parsePaneHash("#pane=changes&session=s1")).toEqual({ kind: "changes", sessionId: "s1" });
    expect(parsePaneHash("#pane=changes&session=s1&workspace=%2Fws%2Fa")).toEqual({
      kind: "changes",
      sessionId: "s1",
      workspace: "/ws/a",
    });
    expect(
      popoutEventBelongsTo(
        { type: "user_message", content: "hi", session_id: "s1", workspace: "/ws/b" } as never,
        "s1",
        "/ws/a",
      ),
    ).toBe(false);
    expect(
      popoutEventBelongsTo(
        { type: "user_message", content: "hi", session_id: "s1", workspace: "/ws/a" } as never,
        "s1",
        "/ws/a",
      ),
    ).toBe(true);
  });

  it("KernelHost.forgetSession and usageLedger prune deleted session caches", async () => {
    const ws = await mkdtemp(join(tmpdir(), "cairn-kh-forget-"));
    const userData = await mkdtemp(join(tmpdir(), "cairn-kh-ud-"));
    const host = createKernelHost({
      workspaces: [ws],
      activeWorkspace: ws,
      userDataDir: userData,
      outbox: () => undefined,
    });
    const created = await host.createSession();
    const sessionsDir = join(ws, ".agent", "sessions");
    const extraId = await createSessionInRoot(sessionsDir, "to-be-deleted");
    await writeFile(
      pathOf(sessionsDir, extraId),
      JSON.stringify({ type: "usage", inputTokens: 10, outputTokens: 5, ts: 1 }) + "\n",
      "utf8",
    );
    const first = await host.usageLedger();
    expect(first.ok && first.totals.inputTokens).toBe(10);

    host.forgetSession(created.id, ws);
    const { unlink } = await import("node:fs/promises");
    await unlink(pathOf(sessionsDir, extraId));
    const second = await host.usageLedger();
    expect(second.ok && second.totals.inputTokens).toBe(0);
  });
});
