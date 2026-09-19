// hook 的**输入面**契约（agent-plan.md §9.5：matcher 语义照抄 + stdin 收 JSON）。
// 与 plugins-hooks.test.ts 的分工：那边测"钩子说了什么算数"（退出码 / JSON 决策 / 上限 / 去重），
// 这边测"钩子拿到了什么"（stdin JSON 字段、matcher 按事件选字段）。
// ⚠️ 本文件的 stdin 用例**一律真 spawn**（不注入 exec）：契约最后一跳就落在 defaultExec 的
// stdio 接线上，注入假执行器等于把它变成不可观测面——原 12 条钩子用例全靠注入 exec 或
// 跑不读 stdin 的 fixture，所以"没有 stdin"这件事在结构上无法被它们发现。
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookEngine, type HookEngineOptions } from "../src/agent/plugins";
import type { LoadedHookDef, HookEventName } from "../src/agent/plugins";

let seq = 0;
function mkHook(event: HookEventName, command: string, over: Partial<LoadedHookDef> & { timeoutSec?: number } = {}): LoadedHookDef {
  seq++;
  const { timeoutSec, ...rest } = over;
  return {
    plugin: "input" + String(seq),
    pluginRoot: process.cwd(),
    event,
    handler: { type: "command", command, ...(timeoutSec !== undefined ? { timeout: timeoutSec } : {}) },
    loaded: true,
    ...rest,
  };
}

async function makeEngine(hooks: LoadedHookDef[], over: Partial<HookEngineOptions> = {}): Promise<HookEngine> {
  const root = await mkdtemp(join(tmpdir(), "dsh-hook-input-"));
  return new HookEngine({ hooks, workspace: root, pluginDataRoot: root, mode: "auto", ...over });
}

describe("hook stdin JSON（§9.5 command 契约）", () => {
  it("command 钩子从 stdin 收到 JSON：hook_event_name / tool_name / tool_input / cwd", async () => {
    const e = await makeEngine([mkHook("PostToolUse", "cat", { timeoutSec: 3 })]);
    const r = await e.run("PostToolUse", {
      event: "PostToolUse", tool_name: "write_file", tool_args: { path: "src/a.ts" }, tool_response: "written",
    });
    expect(r.errors.join("｜")).not.toContain("超时");   // 不 end stdin ⇒ cat 永远等不到 EOF
    const got = JSON.parse(r.additionalContext) as Record<string, unknown>;
    expect(got.hook_event_name).toBe("PostToolUse");
    expect(got.tool_name).toBe("write_file");
    expect(got.tool_input).toEqual({ path: "src/a.ts" });
    expect(got.tool_response).toBe("written");
    expect(typeof got.cwd).toBe("string");
  });

  // 用 PostToolUse 观测：PreToolUse 的 stdout 不进 additionalContext（只有 Session/UserPromptSubmit/
  // Post* 四类收上下文），拿它做回显通道会得到空串——那是本文件的写法错，不是产品缺料。
  it("stdin 带 tool_use_id 与 agent_id（§4.4 归因；缺席时不折成空串）", async () => {
    const e = await makeEngine([mkHook("PostToolUse", "cat", { timeoutSec: 3 })]);
    const withIds = await e.run("PostToolUse", {
      event: "PostToolUse", tool_name: "edit_file", tool_args: {}, tool_use_id: "call_7", agent_id: "agent-3",
    });
    const got = JSON.parse(withIds.additionalContext) as Record<string, unknown>;
    expect(got.tool_use_id).toBe("call_7");
    expect(got.agent_id).toBe("agent-3");
    const bare = await e.run("PostToolUse", { event: "PostToolUse", tool_name: "edit_file", tool_args: {} });
    const none = JSON.parse(bare.additionalContext) as Record<string, unknown>;
    expect("agent_id" in none).toBe(false);
    expect("tool_use_id" in none).toBe(false);
  });

  it("session_id 在装载方给出时进 stdin，未给出时整字段缺席", async () => {
    const withSid = await makeEngine([mkHook("SessionStart", "cat", { timeoutSec: 3 })], { sessionId: "s-42" });
    const a = JSON.parse((await withSid.run("SessionStart", { event: "SessionStart", trigger: "startup" })).additionalContext) as Record<string, unknown>;
    expect(a.session_id).toBe("s-42");
    const without = await makeEngine([mkHook("SessionStart", "cat", { timeoutSec: 3 })]);
    const b = JSON.parse((await without.run("SessionStart", { event: "SessionStart", trigger: "startup" })).additionalContext) as Record<string, unknown>;
    expect("session_id" in b).toBe(false);
  });
});

describe("hook matcher 语义（§9.5：`*`/空/缺省=全配；纯精确名字符集=串列表；其余=JS 正则）", () => {
  it(`matcher "*" 全配：CC hooks.json 最常见写法，不得因 RegExp("*") 抛错而回落成精确比较`, async () => {
    const e = await makeEngine([mkHook("PreToolUse", "exit 2", { matcher: "*" })]);
    const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "read_file", tool_args: {} });
    expect(r.ran).toBe(1);
    expect(r.blocked).toBe(true);
  });

  it("空串 matcher 同样全配", async () => {
    const e = await makeEngine([mkHook("PreToolUse", "exit 2", { matcher: "" })]);
    expect((await e.run("PreToolUse", { event: "PreToolUse", tool_name: "read_file", tool_args: {} })).ran).toBe(1);
  });

  it("逗号/竖线分隔 = 精确名列表：逐个精确命中，非成员零执行", async () => {
    const comma = await makeEngine([mkHook("PreToolUse", "echo hit", { matcher: "read_file, glob" })]);
    expect((await comma.run("PreToolUse", { event: "PreToolUse", tool_name: "read_file", tool_args: {} })).ran).toBe(1);
    expect((await comma.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} })).ran).toBe(1);
    expect((await comma.run("PreToolUse", { event: "PreToolUse", tool_name: "edit_file", tool_args: {} })).ran).toBe(0);
    const pipe = await makeEngine([mkHook("PreToolUse", "echo hit", { matcher: "read_file|glob" })]);
    expect((await pipe.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} })).ran).toBe(1);
  });

  it("纯精确名不做子串：matcher \"Edit\" 不得命中 NotebookEdit", async () => {
    const e = await makeEngine([mkHook("PostToolUse", "echo hit", { matcher: "Edit" })]);
    expect((await e.run("PostToolUse", { event: "PostToolUse", tool_name: "NotebookEdit", tool_args: {} })).ran).toBe(0);
    expect((await e.run("PostToolUse", { event: "PostToolUse", tool_name: "Edit", tool_args: {} })).ran).toBe(1);
  });

  it("含正则字符仍走 JS 正则（锚定写法照旧生效）", async () => {
    const e = await makeEngine([mkHook("PreToolUse", "echo hit", { matcher: "^(glob|grep)$" })]);
    expect((await e.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} })).ran).toBe(1);
    expect((await e.run("PreToolUse", { event: "PreToolUse", tool_name: "glob_files", tool_args: {} })).ran).toBe(0);
  });

  it("非工具事件按各自 matcher 字段配：SessionStart/PreCompact 用 trigger，Subagent 用 agent_type", async () => {
    const ss = await makeEngine([mkHook("SessionStart", "echo hit", { matcher: "startup" })]);
    expect((await ss.run("SessionStart", { event: "SessionStart", trigger: "startup" })).ran).toBe(1);
    expect((await ss.run("SessionStart", { event: "SessionStart", trigger: "resume" })).ran).toBe(0);
    const pc = await makeEngine([mkHook("PreCompact", "echo hit", { matcher: "auto" })]);
    expect((await pc.run("PreCompact", { event: "PreCompact", trigger: "auto" })).ran).toBe(1);
    const sa = await makeEngine([mkHook("SubagentStart", "echo hit", { matcher: "write" })]);
    expect((await sa.run("SubagentStart", { event: "SubagentStart", agent_type: "write" })).ran).toBe(1);
    expect((await sa.run("SubagentStart", { event: "SubagentStart", agent_type: "read" })).ran).toBe(0);
  });

  it("工具类事件缺 tool_name 时不误配（只有全配型 matcher 可命中）", async () => {
    const strict = await makeEngine([mkHook("PreToolUse", "echo hit", { matcher: "read_file" })]);
    expect((await strict.run("PreToolUse", { event: "PreToolUse", tool_args: {} })).ran).toBe(0);
    const all = await makeEngine([mkHook("PreToolUse", "echo hit", { matcher: "*" })]);
    expect((await all.run("PreToolUse", { event: "PreToolUse", tool_args: {} })).ran).toBe(1);
  });
});

/** §9.5 的 `if`（权限规则语法 best-effort）。观测点 = 注入了哪个命令，而不是 parseHookIf 的返回值——
 *  「收下即丢」这个缺陷正好躲在"解析函数有单测、但没人拿它筛 handler"的那一格。 */
describe("hook 的 if 过滤（§9.5 权限规则语法 best-effort）", () => {
  async function engineWith(ifExpr: string | undefined): Promise<{
    ran: string[];
    run: (tool: string, args: Record<string, unknown>) => Promise<{ ran: number; errors: string[] }>;
  }> {
    const ran: string[] = [];
    const e = await makeEngine(
      [mkHook("PreToolUse", "echo hit", ifExpr === undefined ? {} : { if: ifExpr })],
      {
        exec: async (command): Promise<{ code: number; stdout: string; stderr: string; killed: boolean }> => {
          ran.push(command);
          return { code: 0, stdout: "", stderr: "", killed: false };
        },
      },
    );
    return {
      ran,
      run: async (tool, args) => {
        const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: tool, tool_args: args });
        return { ran: r.ran, errors: r.errors };
      },
    };
  }

  it("前缀命中才跑：run_shell(git add:*) 挡不住别的命令", async () => {
    const hit = await engineWith("run_shell(git add:*)");
    expect((await hit.run("run_shell", { command: "git add -A" })).ran).toBe(1);
    expect(hit.ran.length).toBe(1);
    expect((await hit.run("run_shell", { command: "npm publish" })).ran).toBe(0);
    expect(hit.ran.length).toBe(1); // 没多跑
  });

  it("CC 工具名作别名：Write 命中 write_file 的主参数前缀", async () => {
    const e = await engineWith("Write(src/**)");
    expect((await e.run("write_file", { path: "src/a.ts" })).ran).toBe(1);
    expect((await e.run("write_file", { path: "docs/a.md" })).ran).toBe(0);
    expect((await e.run("read_file", { path: "src/a.ts" })).ran).toBe(0);
  });

  it("只写工具名 = 该工具一律跑；缺 if 字段 = 一律跑（零回归）", async () => {
    const only = await engineWith("read_file");
    expect((await only.run("read_file", { path: "x" })).ran).toBe(1);
    expect((await only.run("write_file", { path: "x" })).ran).toBe(0);
    const none = await engineWith(undefined);
    expect((await none.run("write_file", { path: "x" })).ran).toBe(1);
  });

  it("读不懂的 if：一律跑 + 当场回执，且 parseHookIf 如实报 null", async () => {
    const broken = await engineWith("Bash(");
    const r = await broken.run("run_shell", { command: "git push" });
    expect(r.ran).toBe(1);
    expect(r.errors.join("｜")).toContain("if 语法读不懂");
    const { parseHookIf } = await import("../src/agent/plugins");
    expect(parseHookIf("Bash(")).toBeNull();
    expect(parseHookIf("Write(src/**)")).toEqual({ tool: "Write", prefix: "src/" });
  });
});
