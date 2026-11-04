// 工具调用行的"终端命令"形制（2026-11-02 第 914 页，业主给了一张参照截图）。
// 两条口径：
//  ① 行头不泄露实现名：有中文动词的已知工具，行头不再并排写 `run_shell` + 「运行 …」
//     （同一件事说两遍，其中一份还是机器名）；未知工具没有动词可给，原始名是它唯一身份 ⇒ 保留。
//  ② 命令是这一行最该被看见的事实 ⇒ 展开区单独一排 `$ <命令>`，不必去 JSON 里捞。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stream } from "../src/renderer/components/Stream";
import { projectStream } from "../src/renderer/derived/stream";
import type { StreamRow } from "../src/renderer/projections";

const tool = (over: Partial<Extract<StreamRow, { kind: "tool" }>> = {}): StreamRow => ({
  kind: "tool", seq: 0, tool: "run_shell", summary: "pnpm test", ok: true, then: 1200, ts: 200, ...over,
});

const rows = (...r: StreamRow[]) => renderToStaticMarkup(<Stream rows={r} view="normal" streaming={false} />);
// 展开体只在 verbose 档进 DOM（收起态由 ToolCluster 自己管）。
const openRows = (...r: StreamRow[]) => renderToStaticMarkup(<Stream rows={r} view="verbose" streaming={false} />);
// SSR 会把 " & < > 转义成实体；断言按原文写，比较前统一还原（否则命令里一个引号就误判成没渲染）。
const unesc = (h: string): string => h.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("工具行头：已知档不写机器名，未知档不丢身份", () => {
  it("run_shell 行头只有「运行 + 命令」，不再并排出现 run_shell", () => {
    const html = rows(tool());
    expect(html).toContain("运行 pnpm test");
    expect(html).not.toContain("run_shell");
  });

  it("反向自证：没有中文动词的工具，原始名仍在行头（宁缺不编，不能变成没有身份的一行）", () => {
    const html = rows(tool({ tool: "mystery_tool", summary: "x" }));
    expect(html).toContain("mystery_tool");
  });

  it("读文件类同样不写机器名", () => {
    const html = rows(tool({ tool: "read_file", summary: "src/example.ts" }));
    expect(html).toContain("读取 src/example.ts");
    expect(html).not.toContain("read_file");
  });
});

describe("展开区：命令行单独一排", () => {
  it("带 command 的工具给一行 $ 命令，且排在原始参数之前", () => {
    const cmd = "cd /Users/dev/app && grep -rn \"筛选\" src/renderer | head -6";
    const html = unesc(openRows(tool({ args: JSON.stringify({ command: cmd }), command: cmd })));
    expect(html).toContain('class="tool-cmd"');
    expect(html).toContain('class="tool-cmd-prompt"');
    expect(html).toContain(cmd);
    // 顺序即口径：命令在「原始参数（JSON）」之前——先看事实，机器面退到后面。
    expect(html.indexOf("tool-cmd-line")).toBeLessThan(html.indexOf("原始参数"));
  });

  it("命令是原文，不是被截断的摘要", () => {
    const long = `echo ${"x".repeat(200)}`;
    const html = unesc(openRows(tool({ summary: long, command: long, args: JSON.stringify({ command: long }) })));
    expect(html).toContain(long);
    expect(html).not.toContain(`${long.slice(0, 200)}…`);
  });

  it("非命令类工具不摆 $ 行（不造空壳）", () => {
    const html = openRows(tool({ tool: "read_file", summary: "src/a.ts", args: JSON.stringify({ path: "src/a.ts" }) }));
    expect(html).not.toContain("tool-cmd");
    expect(html).toContain("原始参数");
  });
});

describe("投影：command 只从 args.command 取", () => {
  const ev = (name: string, args: Record<string, unknown>) =>
    ({ type: "tool_call", id: "t1", name, args, ts: 1 }) as never;

  it("run_shell 带 command ⇒ 投影给出原文；read_file 不带 ⇒ 不给", () => {
    const withCmd = projectStream([ev("run_shell", { command: "ls -la" })], false);
    const row = withCmd.find((r) => r.kind === "tool");
    expect(row && row.kind === "tool" ? row.command : undefined).toBe("ls -la");
    const noCmd = projectStream([ev("read_file", { path: "src/a.ts" })], false);
    const r2 = noCmd.find((r) => r.kind === "tool");
    expect(r2 && r2.kind === "tool" ? r2.command : undefined).toBeUndefined();
  });

  it("空字符串 command 不摆 $ 行（空命令不是事实，是缺数据）", () => {
    const r = projectStream([ev("run_shell", { command: "" })], false).find((x) => x.kind === "tool");
    expect(r && r.kind === "tool" ? r.command : "unset").toBeUndefined();
  });
});
