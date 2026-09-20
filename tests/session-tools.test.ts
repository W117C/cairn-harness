// SoL-Pi 阶段 A 收口（P-1 步骤 2/3 + 工具面同源）：
//   ① 模型可见工具面 ⊇ 可执行工具表（lsp 曾在可执行面而不在模型面）
//   ② 插件/MCP 工具规格复用 server inputSchema；同名冲突 fail-visible 跳过；只读档按注解白名单同步摘除
//   ③ worker 规格不因补齐 lsp 出现重复项
//   ④ provider=glm 且无 key 显式失败（不静默回落 mock）
//   ⑤ provider/model 由 settings 决定，providerInfo 与 run 同源
//   ⑥ 工作区解析链（overrides > 请求 > env > settings > 内置靶子）
//   ⑦ 地图注入计入组装预算；请求带 workspace 时工具真的在该工作区执行
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { estimateContextTokens } from "../src/agent/compaction";
import { sessionToolSpecs, type SessionPluginTool } from "../src/agent/glm-session";
import { SPAWN_MODES, workerToolSpecs } from "../src/agent/orchestrator";
import { PluginRuntime } from "../src/agent/plugins";
import { skillInvokeName } from "../src/agent/plugins/skills";
import type { McpToolInfo } from "../src/agent/plugins/mcp";
import { closeAllEventLogs, createEventLog } from "../src/events";
import { isSideEffectTool, toolTableFor, type McpGrade } from "../src/permissions";
import {
  handleAgentRun,
  handleSessionCreate,
  initSettingsStore,
  initSessionsDir,
  pluginToolSpecsFromRuntime,
  providerInfo,
  resolveRunWorkspace,
  runAgent,
  setSettings,
  type PluginToolSource,
} from "../src/main/agent-runner";
import { pathOf } from "../src/main/sessions";
import { DEFAULT_SETTINGS, validateSettings } from "../src/main/settings";

let dir = "";
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

it.each(["read-only", "default", "auto"] as const)(
  "%s：模型可见工具面覆盖可执行工具表（含 lsp）",
  (mode) => {
    const names = sessionToolSpecs({ mode }).specs.map((s) => s.function.name);
    const set = new Set(names);
    for (const tool of toolTableFor(mode)) {
      expect(set.has(tool), `${mode} 档缺工具 ${tool}`).toBe(true);
    }
    // 反向：只读档不得把写向工具带进模型面
    if (mode === "read-only") {
      expect(set.has("write_file")).toBe(false);
      expect(set.has("remember")).toBe(false);
    }
    // 每个工具恰好一条规格（重复规格会让「模型看到的」与「执行的」不再一一对应）
    expect(new Set(names).size).toBe(names.length);
  },
);

it("MCP/插件工具规格复用 server inputSchema，同名冲突 fail-visible 跳过", () => {
  const inputSchema = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
  const mcpInfo: McpToolInfo & { plugin: string; server: string } = {
    name: "search",
    description: "MCP 搜索",
    inputSchema,
    scopedName: "mcp__plugin_demo_srv__search",
    // server 什么都没标 ⇒ 按写处理（§11.7.2 fail-closed）；这里只验规格透传，不验分级
    grade: { annotated: false },
    plugin: "demo",
    server: "srv",
  };
  const rt: PluginToolSource = {
    skills: () => [{ name: "demo-skill" }],
    mcpTools: new Map([[mcpInfo.scopedName, mcpInfo]]),
  };
  const pluginTools = pluginToolSpecsFromRuntime(rt);
  expect(pluginTools.map((t) => t.name)).toEqual(["skill", "mcp__plugin_demo_srv__search"]);

  const built = sessionToolSpecs({ mode: "default", pluginTools });
  const mcpSpec = built.specs.find((s) => s.function.name === "mcp__plugin_demo_srv__search");
  expect(mcpSpec?.function.parameters).toEqual(inputSchema); // 原文复用，不翻译
  expect(built.skipped).toEqual([]);

  const clash: readonly SessionPluginTool[] = [{ name: "read_file", description: "冒充基础工具", parameters: {} }];
  const clashed = sessionToolSpecs({ mode: "default", pluginTools: clash });
  expect(clashed.skipped).toEqual(["read_file"]);
  expect(clashed.specs.filter((s) => s.function.name === "read_file")).toHaveLength(1);
  expect(clashed.specs.find((s) => s.function.name === "read_file")?.function.description).not.toBe("冒充基础工具");
});

it("只读档规格面同步：门必拒的 MCP 工具不再挂给模型，带 readOnlyHint 的照旧在列", () => {
  const info = (name: string, grade: McpGrade): McpToolInfo & { plugin: string; server: string } => ({
    name,
    description: "MCP " + name,
    inputSchema: { type: "object", properties: {} },
    scopedName: "mcp__plugin_demo_srv__" + name,
    grade,
    plugin: "demo",
    server: "srv",
  });
  const rt: PluginToolSource = {
    skills: () => [{ name: "demo-skill" }],
    mcpTools: new Map([
      ["mcp__plugin_demo_srv__ro", info("ro", { annotated: true, readOnly: true })],
      ["mcp__plugin_demo_srv__wr", info("wr", { annotated: true, readOnly: false })],
      ["mcp__plugin_demo_srv__noann", info("noann", { annotated: false })],
    ]),
  };
  const pluginTools = pluginToolSpecsFromRuntime(rt);
  // 注解必须随规格一起带出：不带 ⇒ 下游那份 mode 判定没有输入，只能凭空猜
  expect(pluginTools.find((t) => t.name === "mcp__plugin_demo_srv__noann")?.grade).toEqual({ annotated: false });
  const namesOf = (mode: "read-only" | "default" | "auto"): string[] =>
    sessionToolSpecs({ mode, pluginTools }).specs.map((s) => s.function.name);
  // 只读档只放行带 readOnlyHint 的（与权限门同一份谓词、同一份输入）
  const ro = namesOf("read-only");
  expect(ro).toContain("mcp__plugin_demo_srv__ro");
  expect(ro).not.toContain("mcp__plugin_demo_srv__wr");
  expect(ro).not.toContain("mcp__plugin_demo_srv__noann");
  expect(ro).toContain("skill"); // 非 MCP 注入项（无 grade）不受牵连：仍按静态写向表判
  // 另两档不摘：那里该发生的是出卡，不是工具凭空消失
  for (const mode of ["default", "auto"] as const) {
    for (const t of ["ro", "wr", "noann"]) expect(namesOf(mode)).toContain("mcp__plugin_demo_srv__" + t);
  }
});

it("worker 工具规格每个可执行工具恰好一条（lsp 不再重复补齐）", () => {
  for (const mode of ["read", "write"] as const) {
    const names = workerToolSpecs(mode).map((s) => s.function.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("lsp");
    expect(names).toContain(mode === "write" ? "shell_rw" : "shell_ro");
    expect(names).not.toContain("spawn_agent");
  }
});

it("provider=glm 且无 key：显式失败，不静默回落 mock", async () => {
  dir = await mkdtemp(join(tmpdir(), "provider-mode-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", ""); // 空串 = 不用 env 覆盖，走 settings
  const saved = process.env.M0_API_KEY;
  delete process.env.M0_API_KEY;
  try {
    await setSettings({ provider: "glm" });
    await expect(
      runAgent({ workspace: dir, message: "hi", mode: "read-only", logPath: join(dir, "events.jsonl") }),
    ).rejects.toThrow(/M0_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.M0_API_KEY = saved;
  }
});

it("provider/model 由 settings 决定，providerInfo 与 run 同源", async () => {
  dir = await mkdtemp(join(tmpdir(), "provider-info-"));
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "");
  expect((await providerInfo()).kind).toBe("demo"); // 缺省 = 显式演示档

  await setSettings({ provider: "glm", model: "glm-settings-model" });
  const info = await providerInfo();
  expect(info.kind).toBe("glm");
  expect(info.model).toBe("glm-settings-model");

  vi.stubEnv("M0A_PROVIDER", "demo"); // env 覆盖仍然有效（既有 check/演示脚本依赖）
  expect((await providerInfo()).kind).toBe("demo");

  // 白名单反向断言：非法 provider 值回退默认（漏加白名单会静默吞掉用户选择）
  expect(validateSettings({ ...DEFAULT_SETTINGS, provider: "nope" }).provider).toBe("demo");
  expect(validateSettings({ ...DEFAULT_SETTINGS, workspace: 42 }).workspace).toBeNull();
});

it("工作区解析链：overrides > 请求 > env > settings > 内置靶子", () => {
  expect(resolveRunWorkspace("/w/override", "/w/req", "/w/env", "/w/settings", "/fallback")).toBe("/w/override");
  expect(resolveRunWorkspace(undefined, "/w/req", "/w/env", "/w/settings", "/fallback")).toBe("/w/req");
  expect(resolveRunWorkspace(undefined, undefined, "/w/env", "/w/settings", "/fallback")).toBe("/w/env");
  expect(resolveRunWorkspace(undefined, undefined, undefined, "/w/settings", "/fallback")).toBe("/w/settings");
  expect(resolveRunWorkspace(undefined, undefined, undefined, null, "/fallback")).toBe("/fallback");
  expect(resolveRunWorkspace(undefined, "   ", undefined, null, "/fallback")).toBe("/fallback");
});

it("地图注入字符计入组装预算（硬兜底不再少算）", () => {
  const messages = [{ role: "user" as const, content: "x".repeat(400) }];
  const base = estimateContextTokens(messages, {});
  expect(estimateContextTokens(messages, { mapChars: 400 })).toBe(base + 100);
});

it("请求带 workspace：工具在该工作区执行（不是内置靶子）", async () => {
  dir = await mkdtemp(join(tmpdir(), "workspace-bind-"));
  const ws = join(dir, "ws");
  await mkdir(ws, { recursive: true });
  await writeFile(join(ws, "only-here.txt"), "WORKSPACE_BOUND_SENTINEL");
  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  await setSettings({ autoMemory: false }); // 关掉会话尾沉淀，避免多打一次模型请求
  const bodies: Array<{ messages?: Array<Record<string, unknown>>; tools?: Array<{ function: { name: string } }> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as (typeof bodies)[number]);
      const delta =
        bodies.length === 1
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: "read-ws",
                  type: "function",
                  function: { name: "read_file", arguments: JSON.stringify({ path: "only-here.txt" }) },
                },
              ],
            }
          : { content: "done" };
      return new Response(
        "data: " + JSON.stringify({ choices: [{ delta, finish_reason: bodies.length === 1 ? "tool_calls" : "stop" }] }) +
          "\n\ndata: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    }),
  );
  const res = await handleAgentRun(
    { message: "读 only-here.txt", mode: "default", workspace: ws },
    { logPath: join(dir, "events.jsonl") },
  );
  expect(res.ok).toBe(true);
  expect(bodies).toHaveLength(2);
  // 工具结果回灌里必须出现只存在于该工作区的哨兵 ⇒ 工作区绑定真的生效
  expect(JSON.stringify(bodies[1]?.messages ?? [])).toContain("WORKSPACE_BOUND_SENTINEL");
});

it("真实受信插件（磁盘 echo-suite）：skill 路由与压缩重挂真的进主会话请求", async () => {
  dir = await mkdtemp(join(tmpdir(), "plugin-remount-"));
  const ws = join(dir, "ws");
  const pluginsDir = join(ws, ".agent", "plugins");
  await mkdir(pluginsDir, { recursive: true });
  // 真实插件来自冻结样本目录（复制而非改写 fixtures）
  const fixture = fileURLToPath(new URL("../fixtures/plugins/project/echo-suite", import.meta.url));
  await cp(fixture, join(pluginsDir, "echo-suite"), { recursive: true });
  // 摘掉 .mcp.json：样本 server.mjs 依赖仓库 node_modules，复制到临时目录后解析不到 SDK 会
  // 在子进程里抛错（噪音 + 潜在 flake）。MCP 真实连接面由 plugins-check 覆盖；
  // 本测试钉的是 skill 路由 / 压缩重挂 / 工具面接线，与 MCP 传输无关。
  await rm(join(pluginsDir, "echo-suite", ".mcp.json"), { force: true });
  const trustFile = join(dir, "trust.json");
  const pluginDataRoot = join(dir, "plugin-data");

  // 第一次装载：未受信 → 不进路由（信任门是硬闸，不是提示）
  const pending = await PluginRuntime.load({
    projectPluginsDir: pluginsDir,
    workspace: ws,
    pluginDataRoot,
    trustFile,
  });
  expect(pending.skills().length).toBe(0);
  expect(await pending.trustDecide("echo-suite", true)).toBe(true);
  const invokes = pending.skills().map((s) => skillInvokeName(s));
  expect(invokes).toContain("/echo-suite:greet");
  await pending.shutdown();

  // 预置一条「skill 已被触发、随后被压缩摘除」的会话日志：重挂的输入条件在此
  const logPath = join(dir, "session.jsonl");
  const log = createEventLog(logPath);
  await log.append({ type: "user_message", content: "用 /echo-suite:greet" });
  await log.append({ type: "tool_call", id: "sk1", name: "skill", args: { name: "/echo-suite:greet" } });
  await log.append({ type: "tool_result", callId: "sk1", ok: true, output: "<greet skill 全文>" });
  await log.append({
    type: "compaction",
    trigger: "auto",
    reason: "threshold",
    compressed_event_ids: [2, 3],
    summary: "PRIOR_SUMMARY",
    summary_offset: 2,
    tokens_before: 100,
    tokens_after: 10,
  });
  await log.close?.();

  initSettingsStore(join(dir, "settings.json"));
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  vi.stubEnv("M2E_TRUST_FILE", trustFile);
  vi.stubEnv("M2E_PLUGIN_DATA", pluginDataRoot);
  await setSettings({ autoMemory: false });
  const bodies: Array<{ messages?: Array<Record<string, unknown>>; tools?: Array<{ function: { name: string } }> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as (typeof bodies)[number]);
      return new Response(
        'data: ' + JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    }),
  );
  await runAgent({ workspace: ws, message: "继续", mode: "default", sessionId: "session", logPath });

  expect(bodies).toHaveLength(1);
  const serialized = JSON.stringify(bodies[0]?.messages ?? []);
  // ① skill 路由清单（真实插件的 description）进了 system 面
  expect(serialized).toContain("/echo-suite:greet");
  // ② 触发记录被压缩摘除 → 重挂的 skill 全文回到本次请求（这是「压缩后不丢技能上下文」的硬证据）
  expect(serialized).toContain("Greet Skill");
  // ③ 注入面是 system 角色，不与用户/工具消息混淆
  const systems = (bodies[0]?.messages ?? []).filter((m) => m.role === "system");
  expect(systems.some((m) => String(m.content ?? "").includes("Greet Skill"))).toBe(true);
  // ④ 受信插件在场 → skill 工具进模型面（与可执行面同源）
  expect(bodies[0]?.tools?.map((t) => t.function.name)).toContain("skill");
});

it("带 sessionId 的 IPC run 写进会话 JSONL 并跨轮追加（不是临时日志）", async () => {
  dir = await mkdtemp(join(tmpdir(), "session-id-path-"));
  const sessionsRoot = join(dir, "sessions");
  await mkdir(sessionsRoot, { recursive: true });
  initSettingsStore(join(dir, "settings.json"));
  initSessionsDir(sessionsRoot);
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
    ),
  );
  const { id } = await handleSessionCreate();
  expect(await handleAgentRun({ message: "第一轮问题", mode: "read-only", sessionId: id })).toEqual({ ok: true });
  // 事件日志是常驻 FileHandle（A1）；读盘前先统一收句柄，否则读到的可能是未刷盘的半截文件
  await closeAllEventLogs();
  const first = await readFile(pathOf(sessionsRoot, id), "utf8");
  expect(first).toContain("第一轮问题");

  expect(await handleAgentRun({ message: "第二轮追问", mode: "read-only", sessionId: id })).toEqual({ ok: true });
  await closeAllEventLogs();
  const second = await readFile(pathOf(sessionsRoot, id), "utf8");
  // append 语义：前一轮没有被 rm 掉（W5：带 sessionId 时跳过 fresh 日志的删除）
  expect(second).toContain("第一轮问题");
  expect(second).toContain("第二轮追问");
});

it("production settings forward C2/D flags and reopen private reports across two IPC runs", async () => {
  dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR!, "solpi-ipc-flags-"));
  const sessionsRoot = join(dir, "sessions");
  const workspace = join(dir, "workspace");
  await mkdir(sessionsRoot); await mkdir(workspace);
  initSettingsStore(join(dir, "settings.json"));
  initSessionsDir(sessionsRoot);
  await setSettings({ evidenceReceipts: true, economicCompaction: true, requestMetering: true, autoMemory: false });
  vi.stubEnv("M0A_PROVIDER", "glm");
  vi.stubEnv("M0_API_KEY", "offline-test-key");
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    bodies.push(String(init.body));
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }) + '\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  }));
  const { id } = await handleSessionCreate();
  for (const message of ["first", "second"]) {
    expect(await handleAgentRun({ message, workspace, mode: "read-only", sessionId: id })).toEqual({ ok: true });
  }
  await closeAllEventLogs();
  expect(bodies).toHaveLength(2);
  // C2 creates the local recall surface, D creates a non-null economic report.
  expect(bodies.every(body => body.includes('obs_recall'))).toBe(true);
  const files = await readdir(join(sessionsRoot, "session-data"), { recursive: true });
  const reports = files.filter(f => /run-.*\.json$/.test(f));
  expect(reports).toHaveLength(2);
  for (const file of reports) {
    const report = JSON.parse(await readFile(join(sessionsRoot, "session-data", file), "utf8"));
    expect(report.economics).not.toBeNull();
    expect(report.metering.totals.requests).toBeGreaterThan(0);
    expect(report.realModelBenefits).toBe("unverified");
  }
});

/* ---- 能力 4（长程规划）：主会话模型可见面必须含编排原语 ----
   spawn_agent 曾在执行面（TOOLS 运行时注入）而不在模型面 ⇒ 主会话永远无法分解任务/派 worker，
   与 lsp 的「可执行但不可见」同类缺陷。派生 worker 花真钱且 write 档写盘，故一并计入写向工具：
   只读档摘除的链条只有这一处依据，集合漏了它 = 只读会话也能派 worker。 */
it("主会话模型可见面含 spawn_agent；只读档随写向工具一并摘除", () => {
  const namesOf = (mode: "default" | "auto" | "read-only") =>
    sessionToolSpecs({ mode }).specs.map((s) => s.function.name);
  expect(namesOf("default")).toContain("spawn_agent");
  expect(namesOf("auto")).toContain("spawn_agent");
  expect(namesOf("read-only")).not.toContain("spawn_agent");
  expect(isSideEffectTool("spawn_agent")).toBe(true);
});

it("spawn_agent 规格与执行器同源（mode 枚举 = SPAWN_MODES，必填 = task+mode）", () => {
  const spec = sessionToolSpecs({ mode: "default" }).specs.find((s) => s.function.name === "spawn_agent");
  const params = spec?.function.parameters as {
    properties: Record<string, { enum?: string[] } | undefined>;
    required: string[];
  };
  expect(params.properties.mode?.enum).toEqual([...SPAWN_MODES]);
  expect(params.required).toEqual(["task", "mode"]);
  expect(params.properties.task).toBeDefined();
});
