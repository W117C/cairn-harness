// M7 影响面·接线验收：写工具（write_file/edit_file）经 ToolContext.impact 注入钩子后，
// 成功落盘会（a）发出 impact_report 事件、（b）把跨文件波及摘要回注 tool_result。
// 这是「defaultImpactHook 此前在 src/ 零调用者、sidechat 的 impact_report 投影是死代码」
// 那个半成品缺口的端到端闭合证明。
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { edit_file } from "../src/tools/edit_file";
import { write_file } from "../src/tools/write_file";
import { defaultImpactHook, IMPACT_CONTEXT_FILES } from "../src/agent/impact/index.js";
import type { ToolContext } from "../src/tools";
import type { AgentEvent, ImpactReportEvent } from "../src/events";

const MINI_REPO = fileURLToPath(new URL("../fixtures/impact/mini-repo", import.meta.url));

async function freshWs(): Promise<{ ws: string; cacheDir: string }> {
  const ws = await mkdtemp(join(tmpdir(), "impact-wire-"));
  await cp(MINI_REPO, ws, { recursive: true });
  return { ws, cacheDir: await mkdtemp(join(tmpdir(), "impact-wire-cache-")) };
}

function ctxOf(ws: string, cacheDir: string, emitted: AgentEvent[]): ToolContext {
  return {
    workspace: ws,
    emit: (e) => {
      emitted.push(e);
    },
    impact: defaultImpactHook(ws, cacheDir),
  };
}

describe("影响面·写工具接线（ToolContext.impact）", () => {
  it("edit_file 成功后发出 impact_report 事件并回注跨文件调用点", async () => {
    const { ws, cacheDir } = await freshWs();
    const emitted: AgentEvent[] = [];
    // add 定义在 utils.js:1，被 app.js:6 跨文件调用——改它必须波及 app.js。
    const r = await edit_file.run(
      { path: "utils.js", old_string: "return a + b;", new_string: "return a + b; // touched" },
      ctxOf(ws, cacheDir, emitted),
    );
    expect(r.ok).toBe(true);

    const reports = emitted.filter((e) => e.type === "impact_report") as ImpactReportEvent[];
    expect(reports.length).toBe(1);
    expect(reports[0].file).toBe("utils.js");
    expect(reports[0].symbols).toContain("add");
    // 波及面含 app.js 的调用点（跨文件）
    expect(reports[0].up.some((u) => u.file === "app.js")).toBe(true);
    // 事件先于 tool_result 落流（顺序可读）
    const idx = emitted.findIndex((e) => e.type === "impact_report");
    expect(idx).toBe(0);
    // 摘要回进了 tool_result 输出
    expect(r.output).toContain("[impact]");
    expect(r.output).toContain("app.js");
  });

  it("write_file 成功后同样发出 impact_report 事件", async () => {
    const { ws, cacheDir } = await freshWs();
    const emitted: AgentEvent[] = [];
    const r = await write_file.run(
      { path: "utils.js", content: "function add(a, b) { return a + b; }\\nexport { add };\\n" },
      ctxOf(ws, cacheDir, emitted),
    );
    expect(r.ok).toBe(true);
    const reports = emitted.filter((e) => e.type === "impact_report") as ImpactReportEvent[];
    expect(reports.length).toBe(1);
    expect(reports[0].file).toBe("utils.js");
  });

  it("不注入钩子时零行为（输出不含 [impact]，不发事件）", async () => {
    const { ws, cacheDir } = await freshWs();
    const emitted: AgentEvent[] = [];
    const r = await edit_file.run(
      { path: "math.js", old_string: "return boosted;", new_string: "return boosted; // x" },
      { workspace: ws, emit: (e) => { emitted.push(e); } }, // 无 impact 字段
    );
    expect(r.ok).toBe(true);
    expect(emitted.filter((e) => e.type === "impact_report").length).toBe(0);
    expect(r.output).not.toContain("[impact]");
  });

  it("非源码文件不发音量（fileImpact 返回 null → 无事件，写入仍成功）", async () => {
    const { ws, cacheDir } = await freshWs();
    const emitted: AgentEvent[] = [];
    const r = await write_file.run(
      { path: "notes.txt", content: "hello" },
      ctxOf(ws, cacheDir, emitted),
    );
    expect(r.ok).toBe(true);
    expect(emitted.filter((e) => e.type === "impact_report").length).toBe(0);
  });

  it("钩子抛错不影响已成功的写入（best-effort：输出正常、事件为空）", async () => {
    const { ws, cacheDir } = await freshWs();
    const emitted: AgentEvent[] = [];
    const ctx: ToolContext = {
      workspace: ws,
      emit: (e) => {
        emitted.push(e);
      },
      impact: async () => {
        throw new Error("simulated grammar failure");
      },
    };
    const r = await edit_file.run(
      { path: "utils.js", old_string: "return a + b;", new_string: "return a + b; // ok" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("已替换");
    expect(emitted.filter((e) => e.type === "impact_report").length).toBe(0);
    // 落盘内容确实是改后的
    const after = await readFile(join(ws, "utils.js"), "utf8");
    expect(after).toContain("return a + b; // ok");
  });

  it("contextNote 摘要按文件汇聚且限量（事件保留全量清单，输出不逐条膨胀）", async () => {
    const { ws, cacheDir } = await freshWs();
    const hook = defaultImpactHook(ws, cacheDir);
    // mini-repo 里 utils.js 的符号被 app.js 跨文件调用
    const r = await hook("utils.js");
    expect(r).not.toBeNull();
    const note = r!.contextNote;
    // 事件侧保留完整调用点清单（面板/sidechat 投影依赖 e.up.length）
    expect(r!.event.up.length).toBeGreaterThan(0);
    // 摘要仍含被波及文件名（护栏信息不丢）
    expect(note).toContain("app.js");
    // 摘要不含逐条 `symbol ← file:line` 旧格式（token 收紧的证明）
    expect(note.indexOf("\u2190")).toBe(-1);
    // 摘要行数受预算约束：文件数帽 + 表头 + 至多一条省略行
    const noteLines = note.split("\n");
    expect(noteLines.length).toBeLessThanOrEqual(IMPACT_CONTEXT_FILES + 2);
  });
});
