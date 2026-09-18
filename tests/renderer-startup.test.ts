import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

function boot() {
  const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const loadStart = source.indexOf("  async function loadSessions() {");
  const loadEnd = source.indexOf("  /* ---------- 消息流构造", loadStart);
  const start = source.indexOf("  /* ---------- 启动 ---------- */");
  const end = source.indexOf("  syncStatusbar();", start);
  expect(loadStart).toBeGreaterThanOrEqual(0);
  expect(loadEnd).toBeGreaterThan(loadStart);
  expect(start).toBeGreaterThan(loadEnd);
  expect(end).toBeGreaterThan(start);
  let resolve!: (list: { id: string; mtimeMs: number; lines: number }[]) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const context = {
    api: { listSessions: vi.fn(() => pending) },
    sessions: [{ id: "s1" }], selectedId: "s1",
    real: { id: null as string | null, running: false },
    fmtTime: String, render: vi.fn(), toast: vi.fn(),
    // 启动切片会调它（4afcee9 空态收口新增）：函数在切片段之外，vm 里必须给桩，
    // 否则 Promise 链抛未捕获拒绝——断言照样绿但整道 test 门 exit 1（假绿 + 假红混合体）。
    showEmptyStream: vi.fn(),
    $: vi.fn(() => ({ textContent: "" })), selectSession: vi.fn(),
    // R1b B2：零会话时启动分支会走空态（原型段函数，切片外，故需桩）
    showEmptyStream: vi.fn(),
  };
  runInNewContext(source.slice(loadStart, loadEnd) + source.slice(start, end), context);
  const flush = () => new Promise<void>((done) => setImmediate(done));
  return { context, resolve, reject, flush };
}

it("waits for real sessions and never opens the initial mock session", async () => {
  const { context, resolve, flush } = boot();
  expect(context.selectSession).not.toHaveBeenCalled();
  resolve([{ id: "older", mtimeMs: 1, lines: 1 }, { id: "real-latest", mtimeMs: 2, lines: 2 }]);
  await flush();
  expect(context.selectSession).toHaveBeenCalledExactlyOnceWith("real-latest", true);
});

it("does not open a mock session when the real list is empty", async () => {
  const { context, resolve, flush } = boot();
  resolve([]);
  await flush();
  expect(context.selectSession).not.toHaveBeenCalled();
  // R1b B2：零会话必须落到空态，否则界面留着 index.html 里的演示对话（假象）
  expect(context.showEmptyStream).toHaveBeenCalledOnce();
});

it("reports list failure without opening the stale mock session", async () => {
  const { context, reject, flush } = boot();
  reject(new Error("offline"));
  await flush();
  expect(context.toast).toHaveBeenCalledWith(expect.stringContaining("offline"));
  expect(context.selectSession).not.toHaveBeenCalled();
});

it("does not replace a session the user opened while the list was loading", async () => {
  const { context, resolve, flush } = boot();
  context.real.id = "user-picked";
  resolve([{ id: "real-latest", mtimeMs: 2, lines: 2 }]);
  await flush();
  expect(context.selectSession).not.toHaveBeenCalled();
});
