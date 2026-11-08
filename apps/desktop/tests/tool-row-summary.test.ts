// 工具行折叠态的两件事（第 916 页）：
//   ① 摘要取的是**主语**不是范围：grep 的 pattern、glob 的 pattern（此前 pattern 不在取值链里，
//      grep 只剩目录、glob 直接甩 `{"pattern":…}`）；
//   ② 静态工具面（`TOOL_NAMES`）每一把都有中文动词——没有动词的已知工具会被渲染层当成「未知工具」，
//      把实现名原样摆上屏，与「不暴露实现名」相反。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../src/main/ipc-protocol";
import { projectStream, summarize } from "../src/renderer/derived/stream";
import { Stream } from "../src/renderer/components/Stream";
import { TOOL_VERBS, toolVerb } from "../src/renderer/derived/tool-verbs";
import { INJECTED_TOOLS } from "../../../src/agent/tool-surface";
import { TOOL_NAMES } from "../../../src/tools/base";

describe("工具行摘要：主语优先于范围", () => {
  it("grep：pattern 是主语，path 只是范围——不许只剩目录", () => {
    expect(summarize("grep", { pattern: "TODO", path: "src/agent" })).toBe("TODO");
  });

  it("glob：只有 pattern 时不许把 JSON 甩上屏", () => {
    expect(summarize("glob", { pattern: "src/**/*.ts" })).toBe("src/**/*.ts");
  });

  it("既有取值链不动：command / path / file / url / query 各有其主", () => {
    expect(summarize("run_shell", { command: "pnpm test" })).toBe("pnpm test");
    expect(summarize("read_file", { path: "src/a.ts" })).toBe("src/a.ts");
    expect(summarize("read_file", { file: "a.ts" })).toBe("a.ts");
    expect(summarize("web_fetch", { url: "https://example.com/a" })).toBe("https://example.com/a");
    expect(summarize("web_search", { query: "cairn" })).toBe("cairn");
  });

  it("非字符串首值仍走 JSON 兜底（不编、不抛）", () => {
    expect(summarize("read_file", {})).toBe("{}");
    expect(summarize("grep", { pattern: 42 })).toBe('{"pattern":42}');
  });
});

describe("编排族与 clarify：挑主语，不甩 JSON（第 917 页）", () => {
  it("spawn_agent 摘要 = 派了什么活（不是 {\"task\":…,\"mode\":…}）", () => {
    expect(summarize("spawn_agent", { task: "把 a.ts 的 XX 改掉并跑测试", mode: "write" })).toBe("把 a.ts 的 XX 改掉并跑测试");
  });

  it("send_agent 摘要 = 追加的要求（thread id 留给展开区）", () => {
    expect(summarize("send_agent", { thread_id: "th-1", message: "再看一下 b.ts" })).toBe("再看一下 b.ts");
  });

  it("wait/cancel：有点名就数个数，没点名就说全部——不摆 {} 也不摆数组原文", () => {
    expect(summarize("wait_for_agents", { agent_ids: ["a1", "a2"] })).toBe("2 个子任务");
    expect(summarize("wait_for_agents", {})).toBe("本会话全部子任务");
    expect(summarize("cancel_agents", { agent_ids: ["a1"] })).toBe("1 个子任务");
    expect(summarize("cancel_agents", {})).toBe("本会话全部子任务");
    expect(summarize("list_agents", {})).toBe("本会话全部子任务");
  });

  it("resume/close：thread id 就是这一行唯一的事实", () => {
    expect(summarize("resume_agent", { thread_id: "th-1" })).toBe("th-1");
    expect(summarize("close_agent", { thread_id: "th-2" })).toBe("th-2");
  });

  it("clarify 摘要 = 第一个问题；多问补一句计数（不是 questions 的 JSON）", () => {
    expect(summarize("clarify", { questions: [{ question: "要 A 还是 B？", options: ["A", "B"] }] })).toBe("要 A 还是 B？");
    expect(summarize("clarify", { questions: [{ question: "第一问" }, { question: "第二问" }, { question: "第三问" }] })).toBe("第一问（共 3 问）");
  });

  it("挑不到主语时仍走通用链/JSON 兜底（不假装认识所有形状）", () => {
    expect(summarize("clarify", { questions: [{ options: ["A"] }] })).toBe('{"questions":[{"options":["A"]}]}');
  });
});

describe("记忆与定时任务：摘要取正文/名字，不甩参数 JSON（第 923 页）", () => {
  it("remember 摘要 = 正文首行；没有正文时用 topic", () => {
    expect(summarize("remember", {
      scope: "project", kind: "decision", op: "append",
      content: "发布前必须跑全量 gates；上一轮因为跳过它把红带进了 main。",
    })).toBe("发布前必须跑全量 gates；上一轮因为跳过它把红带进了 main。");
    expect(summarize("remember", { kind: "memory", topic: "release-gate" })).toBe("release-gate");
    // 多行正文只取首行（行内换行会把折叠行撑成一条 JSON 状的乱麻）
    expect(summarize("remember", { content: "第一行\n第二行" })).toBe("第一行");
  });

  it("automation_*：建/改给名字，删/跑给 id，列给一句话", () => {
    expect(summarize("automation_create", { name: "每日备份", prompt: "备份仓库" })).toBe("每日备份");
    expect(summarize("automation_update", { id: "a1", name: "每周巡检" })).toBe("每周巡检");
    expect(summarize("automation_update", { id: "a1" })).toBe("a1");
    expect(summarize("automation_delete", { id: "a1" })).toBe("a1");
    expect(summarize("automation_run_now", { id: "a1" })).toBe("a1");
    expect(summarize("automation_list", {})).toBe("全部定时任务");
  });

  it("行面：remember 的折叠行是「记住 + 正文首行」", () => {
    const events = [
      { type: "tool_call", id: "r1", name: "remember", args: { kind: "decision", content: "发布前跑 gates" }, ts: 1 },
      { type: "tool_result", callId: "r1", ok: true, ts: 2 },
    ] as unknown as AgentEvent[];
    const html = renderToStaticMarkup(createElement(Stream, { rows: projectStream(events) }));
    expect(html).toContain("记住 发布前跑 gates");
    expect(html).not.toContain("&quot;content&quot;");
  });
});

describe("技能 / 目标 / MCP 元工具（第 925 页）", () => {
  it("skill 摘要 = 调用名；refine_goal = 目标原文", () => {
    expect(summarize("skill", { name: "/plugin:review", args: "src/a.ts" })).toBe("/plugin:review");
    expect(summarize("refine_goal", { objective: "把重试做成指数退避，三次失败后给可操作提示" }))
      .toBe("把重试做成指数退避，三次失败后给可操作提示");
  });

  it("mcp_list：不给 server 就是全部；给 server 就是那一台", () => {
    expect(summarize("mcp_list", {})).toBe("全部 MCP 服务器");
    expect(summarize("mcp_list", { server: "plugin/sqlite" })).toBe("plugin/sqlite");
  });

  it("mcp_activate / release：server + 数量或工具名", () => {
    expect(summarize("mcp_activate", { server: "plugin/sqlite", tools: ["query", "schema"] })).toBe("plugin/sqlite（2 把）");
    expect(summarize("mcp_activate", { server: "plugin/sqlite", tool: "query" })).toBe("plugin/sqlite（1 把）");
    expect(summarize("mcp_activate", { server: "plugin/sqlite" })).toBe("plugin/sqlite（整台）");
    expect(summarize("mcp_release", { server: "plugin/sqlite", tool: "query" })).toBe("plugin/sqlite / query");
    expect(summarize("mcp_release", { server: "plugin/sqlite" })).toBe("plugin/sqlite");
  });

  it("行面：mcp_activate 的折叠行是「启用 MCP plugin/sqlite（2 把）」", () => {
    const events = [
      { type: "tool_call", id: "m1", name: "mcp_activate", args: { server: "plugin/sqlite", tools: ["query", "schema"] }, ts: 1 },
      { type: "tool_result", callId: "m1", ok: true, ts: 2 },
    ] as unknown as AgentEvent[];
    const html = renderToStaticMarkup(createElement(Stream, { rows: projectStream(events) }));
    expect(html).toContain("启用 MCP plugin/sqlite（2 把）");
    expect(html).not.toContain("&quot;server&quot;");
  });
});

describe("采集/检索/诊断的行摘要（第 927 页）", () => {
  it("obs_recall = 观察 id；impact_query = 符号名（file 模式仍走通用链）", () => {
    expect(summarize("obs_recall", { id: "obs-7", by: "lines" })).toBe("obs-7");
    expect(summarize("impact_query", { symbol: "buildConfig" })).toBe("buildConfig");
    expect(summarize("impact_query", { file: "src/a.ts", deps: true })).toBe("src/a.ts");
  });

  it("diagnose：缺省说「全部检查」，指定 face 说清只跑哪类", () => {
    expect(summarize("diagnose", {})).toBe("全部检查");
    expect(summarize("diagnose", { face: "lint" })).toBe("只跑 lint");
    expect(summarize("diagnose", { face: "test" })).toBe("只跑 test");
  });

  it("行面：diagnose 的折叠行是「诊断 只跑 lint」", () => {
    const events = [
      { type: "tool_call", id: "d1", name: "diagnose", args: { face: "lint" }, ts: 1 },
      { type: "tool_result", callId: "d1", ok: true, ts: 2 },
    ] as unknown as AgentEvent[];
    const html = renderToStaticMarkup(createElement(Stream, { rows: projectStream(events) }));
    expect(html).toContain("诊断 只跑 lint");
    expect(html).not.toContain("&quot;face&quot;");
  });
});

describe("静态工具面每一把都有中文动词（实现名不上屏）", () => {
  it("TOOL_NAMES 全覆盖", () => {
    const missing = TOOL_NAMES.filter((n) => toolVerb(n) === null);
    expect(missing, "没有动词、会被当成未知工具把实现名摆上屏：" + missing.join(" | ")).toEqual([]);
  });

  it("INJECTED_TOOLS 全覆盖（运行期注入的工具也不许把实现名摆上屏，第 927 页）", () => {
    const missing = INJECTED_TOOLS.map((t) => t.name).filter((n) => toolVerb(n) === null);
    expect(missing, "注入面里没有动词、会被当成未知工具把实现名摆上屏：" + missing.join(" | ")).toEqual([]);
  });

  it("词表里不许有工具面之外的陈旧键（如已不存在的 list_dir）", () => {
    // web_fetch 的规格在 session-provider（网络工具按配置注册），既不进 TOOLS 也不进 INJECTED_TOOLS。
    const known = new Set<string>([...TOOL_NAMES, ...INJECTED_TOOLS.map((t) => t.name), "web_fetch"]);
    const stale = Object.keys(TOOL_VERBS).filter((k) => !known.has(k));
    expect(stale, "词表比工具面多的键：" + stale.join(" | ")).toEqual([]);
  });

  it("未知工具仍然是 null（宁缺不编，渲染层回落原名）", () => {
    expect(toolVerb("mystery_tool")).toBeNull();
  });
});

describe("行面：折叠行把主语念出来（不是 JSON）", () => {
  it("spawn_agent ⇒「派发子任务 把 a.ts 的 XX 改掉」；wait_for_agents ⇒「等待 2 个子任务」", () => {
    const events = [
      { type: "tool_call", id: "s1", name: "spawn_agent", args: { task: "把 a.ts 的 XX 改掉", mode: "write" }, ts: 1 },
      { type: "tool_result", callId: "s1", ok: true, ts: 2 },
      { type: "tool_call", id: "w1", name: "wait_for_agents", args: { agent_ids: ["a1", "a2"] }, ts: 3 },
      { type: "tool_result", callId: "w1", ok: true, ts: 4 },
    ] as unknown as AgentEvent[];
    const html = renderToStaticMarkup(createElement(Stream, { rows: projectStream(events) }));
    expect(html).toContain("派发子任务 把 a.ts 的 XX 改掉");
    expect(html).toContain("等待 2 个子任务");
    expect(html).not.toContain("&quot;task&quot;");
  });
});
