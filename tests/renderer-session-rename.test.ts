// 会话重命名的渲染层接线（孤儿桥 agent:sessions-rename 的生产者）。
// 为什么单独判：盘上「会话标题」就是 jsonl 文件名（loadSessions 里 `title: s.id`），
// 主进程改名返回的是**新 id**——所以这一步不是一行字符串赋值，而是换身份。
// 上一版只改内存里的 s.title 再 toast「已重命名」：刷新即回原样，且 UI 报了一句假成功。
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");

/** 桥接段切片：loadSessions + commitRename（与 renderer-startup 同一对锚点）。 */
function boot(over: Record<string, unknown> = {}) {
  const loadStart = source.indexOf("  async function loadSessions() {");
  const loadEnd = source.indexOf("  /* ---------- 消息流构造", loadStart);
  expect(loadStart).toBeGreaterThanOrEqual(0);
  expect(loadEnd).toBeGreaterThan(loadStart);
  const context: Record<string, any> = {
    api: {
      listSessions: vi.fn(async () => [{ id: "改后的名字", mtimeMs: 2, lines: 3 }]),
      renameSession: vi.fn(async () => ({ id: "改后的名字" })),
    },
    sessions: [{ id: "旧名字", title: "旧名字" }],
    selectedId: "旧名字",
    real: { id: "旧名字", running: false },
    sending: false,
    fmtTime: String,
    render: vi.fn(),
    toast: vi.fn(),
    $: vi.fn(() => ({ textContent: "" })),
    ...over,
  };
  runInNewContext(source.slice(loadStart, loadEnd), context);
  const flush = () => new Promise<void>((done) => setImmediate(done));
  return { context, flush };
}

it("重命名走主进程并跟着换身份：selectedId / real.id / 标题都取主进程回的新 id", async () => {
  const { context, flush } = boot();
  await context.commitRename("旧名字", "改后的名字");
  await flush();
  expect(context.api.renameSession).toHaveBeenCalledWith("旧名字", "改后的名字");
  expect(context.selectedId).toBe("改后的名字");
  expect(context.real.id).toBe("改后的名字");
  // 列表回读一次（盘面是唯一事实源，不在本地拼标题）
  expect(context.api.listSessions).toHaveBeenCalledOnce();
  expect(context.toast).toHaveBeenCalledWith(expect.stringContaining("改后的名字"));
});

it("改名失败时绝不半改：id 保持原样，错误原文上屏（不是回滚内存，它本来就没动）", async () => {
  const renameSession = vi.fn(async () => {
    throw new Error("目标会话名已存在: 改后的名字");
  });
  const { context } = boot({
    api: {
      listSessions: vi.fn(async () => [{ id: "旧名字", mtimeMs: 1, lines: 1 }]),
      renameSession,
    },
  });
  await context.commitRename("旧名字", "改后的名字");
  expect(context.selectedId).toBe("旧名字");
  expect(context.real.id).toBe("旧名字");
  expect(context.toast).toHaveBeenCalledWith(expect.stringContaining("目标会话名已存在"));
});

it("主进程回了但没带新 id ⇒ 报失败，不许当成成功（缺字段比编一个值诚实）", async () => {
  const { context } = boot({
    api: {
      listSessions: vi.fn(async () => [{ id: "旧名字", mtimeMs: 1, lines: 1 }]),
      renameSession: vi.fn(async () => ({ ok: false, error: "非法会话名" })),
    },
  });
  await context.commitRename("旧名字", "非/法");
  expect(context.selectedId).toBe("旧名字");
  expect(context.toast).toHaveBeenCalledWith(expect.stringContaining("非法会话名"));
});

it("运行中不许改名（会把仍在跑的 run 留在旧文件上，一个会话裂成两份）", async () => {
  const running = boot({ real: { id: "旧名字", running: true } });
  await running.context.commitRename("旧名字", "改后的名字");
  expect(running.context.api.renameSession).not.toHaveBeenCalled();
  expect(running.context.toast).toHaveBeenCalledWith(expect.stringContaining("运行中"));

  const sending = boot({ sending: true });
  await sending.context.commitRename("旧名字", "改后的名字");
  expect(sending.context.api.renameSession).not.toHaveBeenCalled();
});

it("提交入口接在输入框上：startRename 只经 commitRename，不再直接写内存标题", () => {
  const at = source.indexOf("function startRename(sessionEl, id) {");
  const block = source.slice(at, source.indexOf("\n/* 会话操作菜单", at));
  expect(at).toBeGreaterThanOrEqual(0);
  expect(block).toContain("void commitRename(id, v)");
  expect(block).not.toContain("s.title = v");
  expect(block).not.toContain("已重命名");
});

it("没有通道的壳：明说没保存，不改标题也不报成功", () => {
  const at = source.indexOf("function commitRename(id, title) {");
  const end = source.indexOf("\n}", at);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(at);
  const context: Record<string, any> = {
    sessions: [{ id: "a", title: "a" }],
    toast: vi.fn(),
    render: vi.fn(),
  };
  runInNewContext(source.slice(at, end + 2), context);
  context.commitRename("a", "b");
  expect(context.sessions[0].title).toBe("a");
  expect(context.toast).toHaveBeenCalledWith(expect.stringContaining("未保存"));
  expect(context.toast).not.toHaveBeenCalledWith(expect.stringContaining("已重命名"));
});
