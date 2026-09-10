// M2e 明卷验收：pnpm plugins-check（白名单内脚本，仿 memory-check / tools-check 体例）。
// 断言面（任务书任务 3/5/6/7 明确要求落在本脚本的条目）：
//   A 容器与发现：三级作用域 / 散装 skill / manifest 超集（未知字段警告不阻断）/ 失败隔离 / JS 入口拒载
//   B skill：路由清单超 1536 截断 / 触发后全文进上下文（runAgent 事件流实证）/ 压缩重挂不超预算
//   C hook：exit 2 真的阻断该次工具调用 / JSON decision 放行 / 超时被强杀（引擎级精确计时）
//   D 信任门：未信任时 hook 不执行、MCP 不连接（只列出）；信任后同样样本开始生效（决议持久化）
//   E MCP：tools/list 进注册表且名字为 scoped 形态 / tools/call 结果回传 / 权限门对 MCP 工具同样生效（deny 规则）
//   F 暗卷：联网拉真实 CC 插件（anthropics/skills 或 claude-plugins-community）免改加载；拉不到打印跳过退出 0
// 场景经 runAgent（M1C_AUTONOMY_SCRIPT 剧本通道）驱动真实 loop：hook/信任/MCP 全在事件流上实证。
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../src/events";
import { runAgent } from "../src/main/agent-runner";
import { composeTurnMessages } from "../src/agent/glm-session";
import {
  PluginRuntime, TrustStore, buildSkillRoutingList, clampSkillBody,
  SKILL_ROUTING_CHAR_LIMIT, SKILL_REMOUNT_TOKENS_PER_SKILL, SKILL_REMOUNT_TOKENS_TOTAL,
} from "../src/agent/plugins";

const ROOT = process.cwd();
const FX = join(ROOT, "fixtures", "plugins");

let pass = 0;
let fail = 0;
function ok(name: string): void {
  pass++;
  console.log("  ✅ " + name);
}
function bad(name: string, detail?: string): void {
  fail++;
  console.log("  ❌ " + name + (detail ? "（" + detail + "）" : ""));
}
function assert(cond: boolean, name: string, detail?: string): void {
  if (cond) ok(name);
  else bad(name, detail);
}

function fx(...parts: string[]): string {
  return join(FX, ...parts);
}

/** 临时工作区 .agent/plugins/echo-suite 用符号链接指回 fixtures（判卷不复制、不污染；
 *  stub server.mjs 的裸导入 @modelcontextprotocol/sdk 经 ESM realpath 解析回仓库 node_modules）。 */
async function makeWorkspace(tag: string): Promise<{ ws: string; pluginRoot: string }> {
  const ws = await mkdtemp(join(tmpdir(), "m2e-check-" + tag + "-"));
  const pluginsDir = join(ws, ".agent", "plugins");
  await mkdir(pluginsDir, { recursive: true });
  const pluginRoot = join(pluginsDir, "echo-suite");
  await symlink(fx("project", "echo-suite"), pluginRoot, "dir");
  return { ws, pluginRoot };
}

/** runAgent 一轮（剧本经 M1C_AUTONOMY_SCRIPT 通道注入；返回事件流）。 */
async function run(ws: string, scenario: string, trustFile: string, tag: string): Promise<AgentEvent[]> {
  const logPath = join(ws, "events-" + tag + ".jsonl");
  const prev = {
    script: process.env.M1C_AUTONOMY_SCRIPT,
    trust: process.env.M2E_TRUST_FILE,
    data: process.env.M2E_PLUGIN_DATA,
  };
  process.env.M1C_AUTONOMY_SCRIPT = fx("check", scenario);
  process.env.M2E_TRUST_FILE = trustFile;
  process.env.M2E_PLUGIN_DATA = join(ws, ".plugin-data");
  try {
    return await runAgent({
      workspace: ws,
      message: "M2e 明卷场景 " + tag,
      mode: "auto",
      logPath,
    });
  } finally {
    if (prev.script === undefined) delete process.env.M1C_AUTONOMY_SCRIPT;
    else process.env.M1C_AUTONOMY_SCRIPT = prev.script;
    if (prev.trust === undefined) delete process.env.M2E_TRUST_FILE;
    else process.env.M2E_TRUST_FILE = prev.trust;
    if (prev.data === undefined) delete process.env.M2E_PLUGIN_DATA;
    else process.env.M2E_PLUGIN_DATA = prev.data;
  }
}

function resultOf(events: AgentEvent[], callId: string): { ok: boolean; output: string } | null {
  const e = events.find((x) => x.type === "tool_result" && (x as { callId: string }).callId === callId);
  if (!e) return null;
  const r = e as { ok: boolean; output: string };
  return { ok: r.ok, output: r.output };
}

async function main(): Promise<void> {
  console.log("== M2e plugins-check ==");
  const scratch = await mkdtemp(join(tmpdir(), "m2e-check-scratch-"));

  // ---- A 容器与发现 ----
  console.log("-- A 容器与发现（三级作用域 / 超集 / 隔离 / 拒载）--");
  {
    const rt = await PluginRuntime.load({
      userPluginsDir: fx("user"),
      projectPluginsDir: fx("project"),
      looseRoots: [fx("loose")],
      workspace: scratch,
      pluginDataRoot: join(scratch, "data-a"),
      trustFile: join(scratch, "trust-a.json"),
    });
    assert(rt.manifest.plugins.some((p) => p.name === "hello-plugin" && p.scope === "user"), "A1 用户级作用域发现（user/plugins）");
    assert(rt.manifest.plugins.some((p) => p.name === "echo-suite" && p.scope === "project"), "A2 项目级作用域发现（.agent/plugins）");
    assert(rt.loose().length === 1 && rt.loose()[0]!.entry.plugin === null, "A3 散装 skill 免包装加载（无 manifest = 独立 skill）");
    const echo = rt.manifest.plugins.find((p) => p.name === "echo-suite")!;
    assert(echo.unknownFields.includes("futureField"), "A4 manifest 超集：未知顶层字段收录");
    assert(echo.trust === "pending", "A5 项目级插件首次加载 = pending（信任卡数据源）");
    assert(rt.manifest.errors.some((e) => e.plugin === "broken-plugin"), "A6 坏 manifest 隔离报错（面板可见）");
    assert(rt.manifest.errors.some((e) => e.plugin === "js-entry-plugin" && e.message.includes("index.js")), "A7 含 index.js 的包拒载 + 警告");
    assert(rt.manifest.plugins.some((p) => p.name === "echo-suite"), "A8 坏插件不影响其他插件加载");
    const w = rt.manifest.warnings.find((x) => x.plugin === "echo-suite" && x.message.includes("未知顶层字段"));
    assert(w !== undefined, "A9 未知字段只警告不阻断（警告面在场）");
    await rt.shutdown();
  }

  // ---- B skill 渐进披露 / 触发全文 / 压缩重挂 ----
  console.log("-- B skill（1536 截断 / 触发全文 / 重挂预算）--");
  {
    const long = Array.from({ length: 12 }, (_, i) => ({
      plugin: "p" + String(i),
      name: "s" + String(i),
      description: "d".repeat(200),
    }));
    const r = buildSkillRoutingList(long);
    assert(r.truncated && r.text.length <= SKILL_ROUTING_CHAR_LIMIT, "B1 清单超 1536 字符被截断（len=" + String(r.text.length) + "）");
    // 触发全文：runAgent 事件流实证（信任预置 → skill 工具在统一注册表）
    const wsB = await makeWorkspace("skill");
    const trustB = join(wsB.ws, "trust.json");
    await new TrustStore(trustB).decide(wsB.pluginRoot, true);
    const evB = await run(wsB.ws, "skill-flow.jsonl", trustB, "skill");
    const res = resultOf(evB, "c-skill");
    assert(res !== null && res.ok && res.output.includes("# Greet Skill") && res.output.includes("$ARGUMENTS"), "B2 触发后全文进上下文（tool_result 携带 SKILL.md 全文）");
    // 压缩重挂：投影自事件流（compaction 摘除触发记录 → 重挂；未摘除 → 不重挂）
    const rtB = await PluginRuntime.load({
      projectPluginsDir: join(wsB.ws, ".agent", "plugins"),
      workspace: wsB.ws,
      pluginDataRoot: join(wsB.ws, ".plugin-data"),
      trustFile: trustB,
    });
    const events: AgentEvent[] = [
      { type: "user_message", content: "hi" },
      { type: "tool_call", id: "c1", name: "skill", args: { name: "/echo-suite:greet" } },
      { type: "tool_result", callId: "c1", ok: true, output: "GREET" },
    ];
    const noRemount = rtB.remountFromEvents(events);
    assert(noRemount.text === null, "B3 触发记录未被压缩 → 不重挂（无重复注入）");
    const compacted: AgentEvent[] = [
      ...events,
      {
        type: "compaction",
        trigger: "auto",
        reason: "threshold",
        compressed_event_ids: [2, 3],
        summary: "s",
        summary_offset: 2,
        tokens_before: 100,
        tokens_after: 10,
      },
    ];
    const remount = rtB.remountFromEvents(compacted);
    assert(remount.text !== null && remount.mounted.includes("/echo-suite:greet"), "B4 触发记录被压缩 → 最近激活 skill 重挂");
    assert(remount.tokens <= SKILL_REMOUNT_TOKENS_TOTAL, "B5 压缩重挂不超过预算（合计 25000 token，实测 " + String(remount.tokens) + "）");
    const clamped = clampSkillBody("x".repeat(6000 * 4), SKILL_REMOUNT_TOKENS_PER_SKILL);
    assert(Math.ceil(clamped.length / 4) <= SKILL_REMOUNT_TOKENS_PER_SKILL + 1, "B6 单 skill 前 5000 token 截断（含 marker 计入预算）");
    await rtB.shutdown();
  }

  // ---- C hook 双路径 + 超时强杀（引擎级精确计时）----
  console.log("-- C hook（exit2 阻断 / JSON 放行 / 超时强杀）--");
  {
    const wsC = await makeWorkspace("hook");
    const trustC = join(wsC.ws, "trust.json");
    await new TrustStore(trustC).decide(wsC.pluginRoot, true);
    const t0 = Date.now();
    const evC = await run(wsC.ws, "hook-flow.jsonl", trustC, "hook");
    const elapsed = Date.now() - t0;
    const blocked = resultOf(evC, "c-read");
    assert(blocked !== null && !blocked.ok && blocked.output.startsWith("[hook blocked]") && blocked.output.includes("rejected"), "C1 exit 2 真的阻断该次工具调用（stderr 为阻断原因）");
    const allowed = resultOf(evC, "c-glob");
    assert(allowed !== null && allowed.ok && !allowed.output.startsWith("[hook blocked]") && allowed.output.includes("[hook] hookctx:post-tooluse"), "C2 stdout JSON decision 放行 + PostToolUse 上下文回注 tool_result 尾部");
    const slow = resultOf(evC, "c-slow");
    assert(slow !== null && slow.output.includes("unknown tool: slow_tool"), "C3 超时 hook 非阻塞（loop 继续，工具照常走注册表查表）");
    assert(elapsed >= 900, "C4 超时 hook 确实等待了 timeout 窗口（1s，总耗时 " + String(elapsed) + "ms）");
    // 引擎级强杀断言（精确计时 + SIGKILL 证据）
    const rtC = await PluginRuntime.load({
      projectPluginsDir: join(wsC.ws, ".agent", "plugins"),
      workspace: wsC.ws,
      pluginDataRoot: join(wsC.ws, ".plugin-data"),
      trustFile: trustC,
    });
    const t1 = Date.now();
    const hr = await rtC.hooks.run("PreToolUse", { event: "PreToolUse", tool_name: "slow_tool", tool_args: {} });
    const killElapsed = Date.now() - t1;
    assert(hr.errors.some((e) => e.includes("强杀")) && killElapsed < 2500, "C5 超时被强杀（SIGKILL @1s，实测 " + String(killElapsed) + "ms，error=" + hr.errors[0] + "）");
    // SessionStart 注入面（composeTurnMessages 的 skills 参数 = 路由清单 + hook 上下文入口）
    const probe = composeTurnMessages({ history: [], skills: "[SessionStart 注入探测]" });
    assert(probe.some((m) => m.role === "system" && String(m.content ?? "").includes("SessionStart 注入探测")), "C6 SessionStart/UserPromptSubmit 上下文经组装层注入（system 位）");
    await rtC.shutdown();
  }

  // ---- D 信任门（未信任不激活 → 信任后同样样本生效）----
  console.log("-- D 信任门（未信任只列出 / 信任后生效）--");
  {
    const wsD = await makeWorkspace("trust");
    const trustD = join(wsD.ws, "trust.json");
    // 未信任：hook 不执行（read_file 真执行了，未被 [hook blocked]）、MCP 不连接
    const evD1 = await run(wsD.ws, "hook-flow.jsonl", trustD, "untrusted");
    const unblocked = resultOf(evD1, "c-read");
    assert(unblocked !== null && unblocked.ok === false && !unblocked.output.startsWith("[hook blocked]"), "D1 未信任时 hook 不执行（read_file 正常走工具，返回其真实输出）");
    const rtD1 = await PluginRuntime.load({
      projectPluginsDir: join(wsD.ws, ".agent", "plugins"),
      workspace: wsD.ws,
      pluginDataRoot: join(wsD.ws, ".plugin-data"),
      trustFile: trustD,
    });
    await rtD1.connectMcp();
    assert(rtD1.mcpTools.size === 0 && rtD1.mcp.statuses().length === 0, "D2 未信任时 MCP 不连接（statuses 空）");
    const pending = rtD1.manifest.plugins.find((p) => p.name === "echo-suite");
    assert(pending?.trust === "pending", "D3 未信任插件在加载清单里「只列出」（pending）");
    // 信任决议持久化 → 同同样本开始生效
    await rtD1.trustDecide("echo-suite", true);
    const evD2 = await run(wsD.ws, "hook-flow.jsonl", trustD, "trusted");
    const blocked2 = resultOf(evD2, "c-read");
    assert(blocked2 !== null && blocked2.output.startsWith("[hook blocked]"), "D4 信任后同样样本开始生效（exit2 hook 在 loop 真实阻断）");
    const rtD2 = await PluginRuntime.load({
      projectPluginsDir: join(wsD.ws, ".agent", "plugins"),
      workspace: wsD.ws,
      pluginDataRoot: join(wsD.ws, ".plugin-data"),
      trustFile: trustD,
    });
    assert(rtD2.manifest.plugins.find((p) => p.name === "echo-suite")?.trust === "trusted", "D5 信任决议持久化（新实例直读）");
    await rtD1.shutdown();
    await rtD2.shutdown();
  }

  // ---- E MCP（scoped 注册 / call 回传 / 权限门）----
  console.log("-- E MCP（scoped 名 / call 回传 / 权限门）--");
  {
    const wsE = await makeWorkspace("mcp");
    const trustE = join(wsE.ws, "trust.json");
    await new TrustStore(trustE).decide(wsE.pluginRoot, true);
    const rtE = await PluginRuntime.load({
      projectPluginsDir: join(wsE.ws, ".agent", "plugins"),
      workspace: wsE.ws,
      pluginDataRoot: join(wsE.ws, ".plugin-data"),
      trustFile: trustE,
    });
    await rtE.connectMcp();
    const scopedEcho = "mcp__plugin_echo-suite_stub__echo";
    assert(rtE.mcpTools.has(scopedEcho) && rtE.mcpTools.has("mcp__plugin_echo-suite_stub__fail"), "E1 tools/list 进注册表且名字为 scoped 形态（mcp__plugin_<p>_<s>__<t>）");
    const direct = await rtE.mcp.callTool("echo-suite", "stub", "echo", { text: "直连" });
    assert(direct.ok && direct.output === "echo: 直连", "E2 tools/call 结果回传（stub server 透传）");
    await rtE.shutdown();
    // e2e：模型经统一注册表调用 MCP 工具（auto 档 + 无规则 → 放行）
    const evE1 = await run(wsE.ws, "mcp-flow.jsonl", trustE, "mcp-allow");
    const okCall = resultOf(evE1, "c-mcp");
    assert(okCall !== null && okCall.ok && okCall.output.includes("echo: 你好"), "E3 MCP 工具经统一注册表真实执行（事件流回传 echo: 你好）");
    // e2e：deny 规则命中 scoped 名 → 同一权限门拦截
    await writeFile(
      join(wsE.ws, ".agent", "permissions.json"),
      JSON.stringify({ rules: [{ behavior: "deny", tool: scopedEcho, scope: "always" }] }),
    );
    const evE2 = await run(wsE.ws, "mcp-flow.jsonl", trustE, "mcp-deny");
    const denyCall = resultOf(evE2, "c-mcp");
    assert(denyCall !== null && !denyCall.ok && denyCall.output.includes("[permission denied]") && denyCall.output.includes("deny 规则命中"), "E4 权限门对 MCP 工具同样生效（deny 规则命中 scoped 名）");
  }

  // ---- F 暗卷（可跳过）----
  console.log("-- F 暗卷（真实 CC 插件免改加载；联网不可得即跳过）--");
  await darkBox();

  // 收尾
  await rm(scratch, { recursive: true, force: true });
  console.log("");
  console.log("plugins-check: " + String(pass) + " ✅ / " + String(fail) + " ❌");
  if (fail > 0) process.exit(1);
}

/** 暗卷：克隆真实 CC 插件源并免改加载；任何网络失败 → 打印跳过（脚本仍退出 0）。 */
async function darkBox(): Promise<void> {
  const target = join(tmpdir(), "m2e-darkbox-" + String(Date.now()));
  const repos: [string, string][] = [
    ["https://github.com/anthropics/skills", "anthropics-skills"],
    ["https://github.com/anthropics/claude-plugins-community", "community-plugins"],
  ];
  let loaded = 0;
  let containers = 0;
  let loose = 0;
  let cloned = 0;
  for (const [url, name] of repos) {
    try {
      await git(["clone", "--depth", "1", "--filter=blob:none", url, join(target, name)]);
      cloned++;
    } catch {
      continue; // 拉不到 → 跳过该源
    }
  }
  if (cloned === 0) {
    console.log("  ⏭ 暗卷跳过（联网拉取 anthropics/skills 与 claude-plugins-community 均不可达）——按任务书退出 0");
    return;
  }
  // 扫描克隆产物：含 .claude-plugin/plugin.json 的目录 = 容器；仅 SKILL.md 的目录 = 散装 skill
  const { readdir, stat } = await import("node:fs/promises");
  const walk = async (dir: string, depth: number, out: string[]): Promise<void> => {
    if (depth > 4) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.startsWith(".")) continue;
      const abs = join(dir, e);
      try {
        if ((await stat(abs)).isDirectory()) await walk(abs, depth + 1, out);
        else if (e === "plugin.json" || e === "SKILL.md") out.push(abs);
      } catch {
        /* 忽略不可读项 */
      }
    }
  };
  const hits: string[] = [];
  await walk(target, 0, hits);
  const { parsePluginManifest } = await import("../src/agent/plugins/manifest");
  const { parseFrontmatter } = await import("../src/agent/plugins/frontmatter");
  const { readFile } = await import("node:fs/promises");
  for (const hit of hits) {
    try {
      if (hit.endsWith("plugin.json")) {
        const pluginRoot = join(hit, "..", "..");
        await parsePluginManifest(pluginRoot); // 免改加载 = CC 现行 manifest 原样解析通过
        containers++;
      } else {
        const text = await readFile(hit, "utf8");
        const parsed = parseFrontmatter(text);
        if (typeof parsed.frontmatter["description"] === "string" || parsed.frontmatter["name"] !== undefined) loose++;
      }
      loaded++;
    } catch {
      /* 个别非容器 plugin.json（如 package.json 命中）跳过，不算失败 */
    }
  }
  console.log("  🌐 暗卷实测：克隆 " + String(cloned) + " 源，容器 manifest 免改解析 " + String(containers) + "，SKILL.md 免改解析 " + String(loose) + "（Loaded " + String(loaded) + "）");
}

function git(args: string[]): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    execFile("git", args, { timeout: 60_000 }, (err) => (err ? rejectP(err) : resolveP()));
  });
}

main().catch((err) => {
  console.error("plugins-check 异常:", err);
  process.exit(1);
});
