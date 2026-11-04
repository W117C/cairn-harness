// 第 1000 页判卷：hook handler 类型兑现。
// 口径：类型枚举声明了五档 handler，运行侧此前只认 command——http 连 URL 都无处写，mcp_tool 会绕过
// 工具裁剪。本文件钉「兑现的档位真跑且折进同一套决策语义」「坏形状在装载期就出声」「没兑现的如实点名」。
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HookEngine, type HookEngineOptions } from "../src/agent/plugins";
import {
  HOOK_OUTPUT_CAP, dedupKey, hookPayloadJson, hookShapeRejection, hookStdinJson, hookUrlAllowed,
} from "../src/agent/plugins/hooks";
import type { HookHandlerDef, LoadedHookDef } from "../src/agent/plugins/types";

let seq = 0;
function mk(event: LoadedHookDef["event"], handler: HookHandlerDef, over: Partial<LoadedHookDef> = {}): LoadedHookDef {
  seq++;
  return { plugin: "hp" + String(seq), pluginRoot: join(process.cwd(), "fixtures", "plugins", "project", "echo-suite"), event, handler, loaded: true, ...over };
}

interface FetchCall { url: string; headers: Record<string, string>; body: string; timeoutMs: number }

async function tempRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "hook-handlers-"));
}

/** 注入面替身：http 与 MCP 都在这一层收口——判卷不碰网络，也不碰真 server。 */
function harness(opts: Partial<HookEngineOptions> & {
  fetchResponses?: Array<{ status: number; body: string } | { error: string; errorName?: string }>;
  mcpResponses?: Array<{ ok: boolean; output: string }>;
} = {}) {
  const calls: FetchCall[] = [];
  const mcpCalls: { plugin: string; server: string; tool: string; args: Record<string, unknown> }[] = [];
  const responses = opts.fetchResponses ?? [{ status: 200, body: "" }];
  const mcpResponses = opts.mcpResponses;
  let n = 0;
  let m = 0;
  const engine = new HookEngine({
    hooks: opts.hooks ?? [],
    workspace: opts.workspace ?? process.cwd(),
    pluginDataRoot: opts.pluginDataRoot ?? process.cwd(),
    mode: "auto",
    ...opts,
    fetch: async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body, timeoutMs: init.timeoutMs });
      const r = responses[Math.min(n, responses.length - 1)];
      n++;
      if ("error" in r) throw Object.assign(new Error(r.error), r.errorName === undefined ? {} : { name: r.errorName });
      return r;
    },
    mcpCall: mcpResponses === undefined ? undefined : async (plugin, server, tool, args) => {
      mcpCalls.push({ plugin, server, tool, args });
      const r = mcpResponses[Math.min(m, mcpResponses.length - 1)];
      m++;
      return r;
    },
  });
  return { engine, calls, mcpCalls };
}

describe("http handler：网络钩子真跑，并折进同一套决策语义", () => {
  it("2xx + JSON 决策体与 command hook 的 exit 2 同效（deny 变阻断，理由在案）", async () => {
    const { engine } = harness({
      hooks: [mk("PreToolUse", { type: "http", url: "https://policy.invalid/hook" })],
      fetchResponses: [{
        status: 200,
        body: '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"policy says no"}}',
      }],
    });
    const r = await engine.run("PreToolUse", { event: "PreToolUse", tool_name: "read_file", tool_args: { path: "x" } });
    expect(r.ran).toBe(1);
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toContain("policy says no");
  });

  it("请求体与 command hook 的 stdin 是同一份 payload（一份契约，两种传输）", async () => {
    const payload = { event: "PreToolUse" as const, tool_name: "edit_file", tool_args: { path: "a.ts" }, tool_use_id: "tu_1" };
    const root = await tempRoot();
    const { engine, calls } = harness({
      hooks: [mk("PostToolUse", { type: "http", url: "https://policy.invalid/hook" })],
      workspace: root,
      sessionId: "sess-9",
    });
    await engine.run("PostToolUse", payload);
    expect(JSON.parse(calls[0].body)).toEqual(hookPayloadJson(payload, root, "sess-9"));
    expect(calls[0].body).toBe(hookStdinJson(payload, root, "sess-9"));
    expect(calls[0].headers["content-type"]).toBe("application/json");
  });

  it("非 2xx 是非阻塞错误，状态码写进回执", async () => {
    const { engine } = harness({
      hooks: [mk("PreToolUse", { type: "http", url: "https://policy.invalid/hook" })],
      fetchResponses: [{ status: 503, body: "upstream down" }],
    });
    const r = await engine.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r.blocked).toBe(false);
    expect(r.ran).toBe(1);
    expect(r.errors.join(" ")).toContain("503");
    expect(r.errors.join(" ")).toContain("未被受理");
  });

  it("超时报「中止」、对面拒报「未被受理」：两种失败不能说成一种", async () => {
    const { engine } = harness({
      hooks: [mk("PreToolUse", { type: "http", url: "https://policy.invalid/slow" })],
      fetchResponses: [{ error: "The operation was timed out", errorName: "TimeoutError" }],
    });
    const r = await engine.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r.errors.join(" ")).toContain("超时被中止");
    expect(r.errors.join(" ")).not.toContain("强杀"); // 没有进程可杀：把 SIGKILL 抄进 http 的回执是假话
    expect(r.blocked).toBe(false);
  });

  it("网络异常只废这一条钩子：同事件其它 handler 照跑", async () => {
    const { engine } = harness({
      hooks: [
        mk("PostToolUse", { type: "http", url: "https://policy.invalid/dies" }),
        mk("PostToolUse", { type: "command", command: "echo alive" }, { matcher: "glob" }),
      ],
      fetchResponses: [{ error: "connect ECONNREFUSED" }],
    });
    const r = await engine.run("PostToolUse", { event: "PostToolUse", tool_name: "glob", tool_args: {}, tool_response: "x" });
    expect(r.errors.join(" ")).toContain("ECONNREFUSED");
    expect(r.additionalContext).toContain("alive"); // 另一条钩子的输出没被连坐
    expect(r.ran).toBe(2); // 两条都发出去了：失败的记错误，不冒充「没跑」也不冒充「跑成」
    expect(r.blocked).toBe(false);
  });

  it("只读档拒绝 http 钩子：网络写同样是副作用", async () => {
    const { engine } = harness({
      hooks: [mk("PreToolUse", { type: "http", url: "https://policy.invalid/hook" })],
      mode: "read-only",
    });
    const r = await engine.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r.skipped).toBe(1);
    expect(r.errors.join(" ")).toContain("只读档");
  });

  it("响应超 10k 与 command stdout 同一顶帽：全文落盘并报出路径", async () => {
    const root = await tempRoot();
    const long = "字".repeat(HOOK_OUTPUT_CAP + 50);
    const { engine } = harness({
      hooks: [mk("PostToolUse", { type: "http", url: "https://policy.invalid/hook" })],
      workspace: root,
      pluginDataRoot: root,
      fetchResponses: [{ status: 200, body: long }],
    });
    const r = await engine.run("PostToolUse", { event: "PostToolUse", tool_name: "glob", tool_args: {}, tool_response: "x" });
    expect(r.overflowFiles.length).toBe(1);
    expect((await readFile(r.overflowFiles[0], "utf8")).length).toBe(long.length);
    expect(r.additionalContext.length).toBeLessThanOrEqual(HOOK_OUTPUT_CAP + 200);
  });

  it("URL 里的敏感 user_config 只上线、不回声：错误回执带模板不带明文", async () => {
    const secret = "sk-super-secret-42";
    const { engine, calls } = harness({
      hooks: [mk("PreToolUse", { type: "http", url: "https://policy.invalid/hook?k=${user_config.token}" })],
      fetchResponses: [{ error: "socket hang up" }],
      userConfigValues: () => ({ token: secret }),
      userConfigSensitive: () => ["token"],
    });
    const r = await engine.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(calls[0].url).toContain(secret); // 值确实上了线（作者写这道钩子就是为了带它）
    expect(r.errors.join(" ")).not.toContain(secret);
    expect(r.errors.join(" ")).toContain("${user_config.token}");
  });

  it("http 钩子按事件用同一套超时帽（UserPromptSubmit 的短帽不是空的）", async () => {
    const { engine, calls } = harness({
      hooks: [mk("UserPromptSubmit", { type: "http", url: "https://policy.invalid/hook" })],
    });
    await engine.run("UserPromptSubmit", { event: "UserPromptSubmit", prompt: "hi" });
    expect(calls[0].timeoutMs).toBeLessThanOrEqual(30_000);
  });
});

describe("装载期形态校验：坏形状不等到运行时才说", () => {
  // hooks.json 是人写的 JSON：TS 的判别联合挡不住缺字段，运行时守卫才是真闸。这里喂的就是它挡不住的那一类。
  const bad = (shape: unknown): HookHandlerDef => shape as unknown as HookHandlerDef;

  it("http 没有可用 URL ⇒ 拒载理由点名「url」", () => {
    expect(hookShapeRejection(bad({ type: "http" }))).toContain("url");
    expect(hookShapeRejection(bad({ type: "http", url: "   " }))).toContain("url");
  });

  it("非 http(s) 协议拒载：http 钩子不许变成新的本地文件读通道", () => {
    expect(hookUrlAllowed("file:///etc/passwd")).toBe(false);
    expect(hookUrlAllowed("data:text/plain,hi")).toBe(false);
    expect(hookUrlAllowed("https://policy.invalid/hook")).toBe(true);
    expect(hookShapeRejection({ type: "http", url: "file:///etc/passwd" })).toContain("协议");
  });

  it("mcp_tool 缺 server 或 tool ⇒ 拒载并点名缺哪个", () => {
    expect(hookShapeRejection(bad({ type: "mcp_tool", server: "s" }))).toContain("tool");
    expect(hookShapeRejection(bad({ type: "mcp_tool", tool: "t" }))).toContain("server");
    expect(hookShapeRejection({ type: "mcp_tool", server: "s", tool: "t" })).toBeNull();
  });

  it("command 档仍要求非空 command（旧口径没被联合类型冲淡）", () => {
    expect(hookShapeRejection(bad({ type: "command", command: "" }))).toContain("command");
    expect(hookShapeRejection({ type: "command", command: "echo hi" })).toBeNull();
  });

  it("未兑现的 agent 档在装载期就如实点名；已兑现的档不被顺手拒掉", () => {
    const reason = hookShapeRejection({ type: "agent" });
    expect(reason).toContain("agent");
    expect(reason).toContain("未兑现");
    // 回归护栏：union 里加一档时，不许把已经兑现的档也一起拒掉（prompt 的判卷见 plugins-hook-prompt）。
    expect(hookShapeRejection({ type: "prompt", prompt: "判断是否安全" })).toBeNull();
    expect(hookShapeRejection({ type: "http", url: "https://policy.invalid/hook" })).toBeNull();
    expect(hookShapeRejection({ type: "mcp_tool", server: "s", tool: "t" })).toBeNull();
  });
});

describe("mcp_tool handler：只走本插件、已连接、裁剪后那张表", () => {
  it("只打这条钩子所属插件的 server（跨插件名越权不走）", async () => {
    const { engine, mcpCalls } = harness({
      hooks: [mk("PostToolUse", { type: "mcp_tool", server: "lint", tool: "check", args: { file: "${tool_input.path}", event: "${hook_event_name}" } }, { plugin: "mine" })],
      mcpResponses: [{ ok: true, output: "no findings" }],
    });
    const r = await engine.run("PostToolUse", { event: "PostToolUse", tool_name: "edit_file", tool_args: { path: "src/a.ts" } });
    expect(mcpCalls[0].plugin).toBe("mine");
    expect(mcpCalls[0].server).toBe("lint");
    expect(mcpCalls[0].args).toEqual({ file: "src/a.ts", event: "PostToolUse" });
    expect(r.additionalContext).toContain("no findings");
  });

  it("args 里取不到值的 ${...} ⇒ 不调用、不送字面量，并点名是哪个路径", async () => {
    const { engine, mcpCalls } = harness({
      hooks: [mk("PostToolUse", { type: "mcp_tool", server: "lint", tool: "check", args: { file: "${tool_input.nope}" } })],
      mcpResponses: [{ ok: true, output: "should not run" }],
    });
    const r = await engine.run("PostToolUse", { event: "PostToolUse", tool_name: "edit_file", tool_args: { path: "a.ts" } });
    expect(mcpCalls.length).toBe(0);
    expect(r.errors.join(" ")).toContain("tool_input.nope");
  });

  it("MCP 结果体是 JSON 决策时同 command 生效；isError 走非阻塞错误", async () => {
    const deny = harness({
      hooks: [mk("PreToolUse", { type: "mcp_tool", server: "gate", tool: "ask" })],
      mcpResponses: [{ ok: true, output: '{"decision":"block","reason":"nope"}' }],
    });
    const r1 = await deny.engine.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r1.blocked).toBe(true);
    expect(r1.blockReason).toContain("nope");
    const err = harness({
      hooks: [mk("PreToolUse", { type: "mcp_tool", server: "gate", tool: "ask" })],
      mcpResponses: [{ ok: false, output: "server rejected" }],
    });
    const r2 = await err.engine.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r2.blocked).toBe(false);
    expect(r2.errors.join(" ")).toContain("server rejected");
  });

  it("运行时没注入 MCP 调用面时如实失败，而不是静默跳过", async () => {
    const { engine } = harness({ hooks: [mk("PreToolUse", { type: "mcp_tool", server: "gate", tool: "ask" })] });
    const r = await engine.run("PreToolUse", { event: "PreToolUse", tool_name: "glob", tool_args: {} });
    expect(r.skipped).toBe(1);
    expect(r.errors.join(" ")).toContain("MCP");
  });

  it("只读档只放过标注了 readOnly 的工具，其余拒跑（钩子不是特权通道）", async () => {
    const handler = { type: "mcp_tool", server: "lint", tool: "check" } as HookHandlerDef;
    const payload = { event: "PostToolUse" as const, tool_name: "glob", tool_args: {} };
    const graded = harness({
      hooks: [mk("PostToolUse", handler)],
      mcpResponses: [{ ok: true, output: "ok" }],
      mode: "read-only",
      mcpToolGrade: () => ({ annotated: true, readOnly: true, destructive: false }),
    });
    const r1 = await graded.engine.run("PostToolUse", payload);
    expect(graded.mcpCalls.length).toBe(1);
    expect(r1.skipped).toBe(0);
    const blind = harness({
      hooks: [mk("PostToolUse", handler)],
      mcpResponses: [{ ok: true, output: "ok" }],
      mode: "read-only",
    });
    const r2 = await blind.engine.run("PostToolUse", payload);
    expect(blind.mcpCalls.length).toBe(0);
    expect(r2.errors.join(" ")).toContain("只读档");
  });
});

describe("去重键按类型分域（旧实现非 command 档键值恒相同）", () => {
  it("两条不同的 http URL 不再互相吞掉", async () => {
    const root = await tempRoot();
    const { engine, calls } = harness({
      hooks: [
        mk("PostToolUse", { type: "http", url: "https://a.invalid/hook" }, { plugin: "pa" }),
        mk("PostToolUse", { type: "http", url: "https://b.invalid/hook" }, { plugin: "pb" }),
      ],
      workspace: root,
      pluginDataRoot: root,
    });
    await engine.run("PostToolUse", { event: "PostToolUse", tool_name: "glob", tool_args: {} });
    expect(calls.map((c) => c.url).sort()).toEqual(["https://a.invalid/hook", "https://b.invalid/hook"]);
  });

  it("同一 handler 跨层重复声明仍只跑一次（去重能力没被拆开）", () => {
    const h = { type: "mcp_tool", server: "lint", tool: "check" } as HookHandlerDef;
    expect(dedupKey(mk("PostToolUse", h))).toBe(dedupKey(mk("PostToolUse", h)));
    expect(dedupKey(mk("PostToolUse", { type: "mcp_tool", server: "lint", tool: "fmt" })))
      .not.toBe(dedupKey(mk("PostToolUse", h)));
    expect(dedupKey(mk("PostToolUse", { type: "command", command: "echo a" })))
      .not.toBe(dedupKey(mk("PostToolUse", { type: "http", url: "echo a" })));
  });
});
