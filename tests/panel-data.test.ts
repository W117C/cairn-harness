// R1a：抽屉面板数据单一来源（projectPanelData）——消灭渲染层的第二事实源（原型 mock 常量）。
// 面板内容 100% 事件流投影（projections.ts:1 既定原则）：无写入/无命令时必须空，
// 而不是回落到任何演示数据。
import { describe, expect, it } from "vitest";
import { fileWriteState, impactLabel, projectDiffCards, projectImpactByFile, projectPanelData } from "../src/renderer/projections";
import type { AgentEvent } from "../src/events";

const write = (id: string, path: string, content: string): AgentEvent[] => [
  { type: "tool_call", id, name: "write_file", args: { path, content } },
  { type: "tool_result", callId: id, ok: true, output: "written" },
];

describe("projectPanelData（抽屉面板投影：审阅 / 文件树 / 终端 / 合并）", () => {
  it("审阅与文件树共用同一事实源：路径集合与 projectDiffCards 逐项一致", () => {
    const events: AgentEvent[] = [
      ...write("w1", "src/agent/impact/index.ts", "a\nb\nc"),
      ...write("w2", "tests/impact.test.ts", "x\ny"),
    ];
    const panel = projectPanelData(events, null);
    expect(panel.files.map((f) => f.path)).toEqual(projectDiffCards(events).map((d) => d.path));
    // write 字段是投影期由 fileWriteState(ok) 派生的落盘三态（渲染层读它，不再各自判 null）——
    // 期望里也走同一个真实现，不在这抄一份政策。
    expect(panel.files).toEqual([
      { path: "src/agent/impact/index.ts", added: 3, removed: 0, created: true, ok: true, write: fileWriteState(true) },
      { path: "tests/impact.test.ts", added: 2, removed: 0, created: true, ok: true, write: fileWriteState(true) },
    ]);
  });

  it("文件树按目录分组（同目录归一组，保持首次出现顺序）", () => {
    const events: AgentEvent[] = [
      ...write("w1", "src/agent/a.ts", "1"),
      ...write("w2", "src/agent/b.ts", "1"),
      ...write("w3", "tests/c.test.ts", "1"),
      ...write("w4", "README.md", "1"),
    ];
    const tree = projectPanelData(events, null).tree;
    expect(tree.map((g) => [g.dir, g.files.length])).toEqual([
      ["src/agent", 2],
      ["tests", 1],
      ["", 1],
    ]);
    expect(tree[0].files.map((f) => f.path)).toEqual(["src/agent/a.ts", "src/agent/b.ts"]);
  });

  it("终端面板 = run_shell 真调用与配对输出；未回结果的标 pending", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "s1", name: "run_shell", args: { command: "pnpm test" } },
      { type: "tool_result", callId: "s1", ok: false, output: "3 failed" },
      { type: "tool_call", id: "s2", name: "run_shell", args: { command: "pnpm gates" } },
    ];
    expect(projectPanelData(events, null).terminal).toEqual([
      { callId: "s1", command: "pnpm test", ok: false, output: "3 failed" },
      { callId: "s2", command: "pnpm gates", ok: null, output: "" },
    ]);
  });

  it("合并面板取 write worker 的状态与收尾态（projectMergeTower 同源）", () => {
    const events: AgentEvent[] = [
      { type: "agent_spawned", agent_id: "w1", parent_event_id: 1, mode: "write", task: "改投影", max_turns: 5, permission_mode: "default", worktree: ".agents/wt-w1", base_commit: "abc" },
      { type: "agent_status", agent_id: "w1", status: "done" },
      { type: "tool_result", callId: "merge-w1", ok: true, output: "[merged] abc123" },
    ];
    const merge = projectPanelData(events, null).merge;
    // 面板那一列现在就是合并控制塔的列本身（原来有一层把它裁成 6 字段 ⇒ 补丁/安全发现/评审评论
    // 算好了却到不了任何界面）。完整形状由 tests/renderer-merge-review.test.ts 逐面判；
    // verified / spentUsd（b998e48 起的两个新面）在这条靶子上如实为 null：没有 verify_result、没价表。
    expect(merge).toHaveLength(1);
    expect(merge[0]).toMatchObject({ agent_id: "w1", task: "改投影", status: "done", outcome: "merged", verified: null, spentUsd: null });
    expect([merge[0]?.diffs, merge[0]?.comments].every(Array.isArray), "评审面字段随列到面板（不再被中间裁剪层丢掉）").toBe(true);
    expect(merge[0]?.report).toBeNull();
  });

  it("工作区：绝对路径取末段为显示名；null → 未配置", () => {
    expect(projectPanelData([], "/Users/me/coding-suite").workspace).toEqual({
      name: "coding-suite",
      path: "/Users/me/coding-suite",
    });
    expect(projectPanelData([], null).workspace).toBeNull();
  });

  it("空事件流 → 每块面板全空（不得回落到任何演示数据）", () => {
    expect(projectPanelData([], null)).toEqual({
      workspace: null,
      files: [],
      tree: [],
      terminal: [],
      merge: [],
      agents: [],
    });
  });

  it("非 write_file 的写动作（edit_file）不计入——审阅口径与 projectDiffCards 一致", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "e1", name: "edit_file", args: { path: "src/x.ts", old_string: "a", new_string: "b" } },
      { type: "tool_result", callId: "e1", ok: true, output: "patched" },
    ];
    const panel = projectPanelData(events, null);
    expect(panel.files).toEqual([]);
    expect(panel.tree).toEqual([]);
  });
});

/* ---------------- M7 影响面挂到文件行（能力 1 的可见面） ----------------
   审计发现的缺口：`impact_report` 早就落流了，但 `projectPanelData` 四个投影都不读它
   ⇒ 波及面只在会话流的通用记录卡里能以 JSON 见到，右栏读数不随它变（outputs/impact-third-ring-audit-2026-09-22.md）。
   这里钉的是三件容易各写一遍就漂的事：缺席 ≠ 波及 0、join 键要归一、同文件多条取最后一条。 */
const impact = (file: string, up: { symbol: string; file: string; line: number }[], truncated = false): AgentEvent => ({
  type: "impact_report", file, symbols: ["addTodo"], up, truncated,
});

describe("影响面投影（projectImpactByFile / impactLabel）", () => {
  const sites = (f: string, n: number) => Array.from({ length: n }, (_, i) => ({ symbol: "s" + String(i), file: f, line: i }));

  it("报告汇聚到被改文件：调用点数 + 波及文件数 + 帽标记", () => {
    const events = [...write("w1", "src/todo.ts", "a"), impact("src/todo.ts", [...sites("src/app.ts", 2), ...sites("tests/t.test.ts", 1)])];
    const f = projectPanelData(events, null).files[0];
    expect(f.impact).toEqual({ sites: 3, files: 2, truncated: false });
    expect(impactLabel(f.impact!)).toBe("波及 3 处 · 2 个文件");
  });

  it("缺席 ≠ 波及 0：没有 impact_report 时字段必须缺席（设置关着不能显示成「测过、半径 0」）", () => {
    const noReport = projectPanelData([...write("w1", "src/todo.ts", "a")], null).files[0];
    expect("impact" in noReport).toBe(false);
    // 报告发了、确实没人用 ⇒ 才是「无跨文件调用点」这一句
    const reported = projectPanelData([...write("w1", "src/todo.ts", "a"), impact("src/todo.ts", [])], null).files[0];
    expect(reported.impact).toEqual({ sites: 0, files: 0, truncated: false });
    expect(impactLabel(reported.impact!)).toBe("无跨文件调用点");
  });

  it("join 键归一：impact 侧与 diff 侧写法不同（`./`、反斜杠）也必须挂得上——挂不上表现为面板永远空白", () => {
    const m = projectImpactByFile([impact("./src\\todo.ts", sites("src/app.ts", 1))]);
    expect(m.get("src/todo.ts")?.sites).toBe(1);
    const f = projectPanelData([...write("w1", "src/todo.ts", "a"), impact("./src/todo.ts", sites("src/app.ts", 1))], null).files[0];
    expect(f.impact?.sites).toBe(1);
    // 反向一半：脏写法在**另一侧**（模型把 args.path 写成 `./x.ts`，影响面报的是干净路径）。
    // 只测上面那一半时，「两边各归一」退化成「只归一一边」也判绿——两侧都得各来一条。
    const g = projectPanelData([...write("w2", "./src/sort.ts", "a"), impact("src/sort.ts", sites("src/app.ts", 2))], null).files[0];
    expect(g.impact).toEqual({ sites: 2, files: 1, truncated: false });
  });

  it("同一文件两条报告取最后一条（后一次写覆盖前一次的读数，累加会把同一批调用点数两遍）", () => {
    const m = projectImpactByFile([impact("src/todo.ts", sites("src/app.ts", 5)), impact("src/todo.ts", sites("src/other.ts", 1))]);
    expect(m.get("src/todo.ts")).toEqual({ sites: 1, files: 1, truncated: false });
  });

  it("撞限量帽要说成 N+，不能报成精确数", () => {
    expect(impactLabel({ sites: 200, files: 9, truncated: true })).toBe("波及 200+ 处 · 9 个文件");
  });
});
