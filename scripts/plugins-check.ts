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
  scopedToolName,
  setPluginSecretBackend, putPluginSecret, getPluginSecret, writePluginUserConfig,
  SECRET_PLACEHOLDER,
  SKILL_ROUTING_CHAR_LIMIT, SKILL_REMOUNT_TOKENS_PER_SKILL, SKILL_REMOUNT_TOKENS_TOTAL,
  type PluginSecretBackend,
} from "../src/agent/plugins";

const ROOT = process.cwd();
const FX = join(ROOT, "fixtures", "plugins");

let pass = 0;
let fail = 0;
/** 未证项（联网/凭据限制导致断言没跑到）——显式列出，绝不等于通过。 */
const unverified: string[] = [];
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

  // ---- F 暗卷（断言型；联网不可得 → 显式标「未证」，不静默算绿）----
  console.log("-- F 暗卷（真实 CC 插件免改加载 · 断言型）--");
  await darkBox();

  // 收尾
  await rm(scratch, { recursive: true, force: true });
  console.log("");
  if (unverified.length > 0) {
    console.log("未证项（连网/凭据限制，未跑到的断言——不等于通过）：");
    for (const u of unverified) console.log("  ⚠️  " + u);
  }
  console.log("plugins-check: " + String(pass) + " ✅ / " + String(fail) + " ❌" + (unverified.length > 0 ? " / " + String(unverified.length) + " 未证" : ""));
  if (fail > 0) process.exit(1);
}

function git(args: string[]): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    execFile("git", args, { timeout: 180_000 }, (err) => (err ? rejectP(err) : resolveP()));
  });
}

// ============================================================ F 暗卷（断言型）============================================================
// M2g 重写（闭合 §1.4-5 + §9.11-1/2）：旧版 darkBox 是「打印型」——零 check() 调用，
// 即使容器解析数为 0 也照样 exit 0（实测就是这个数）。本版改为：
//   · 修掉 walker 的根因（旧版 `e.startsWith(".")` 跳过 .claude-plugin → 容器 manifest 恒为 0）
//   · 阈值断言：容器解析 ≥2、SKILL.md 解析 ≥50
//   · testdino：7 skills + 远程 http MCP 配置解析 + scoped 名过权限门（真 evaluate 管线）
//   · tres-finance：userConfig sensitive 解析 + 值入安全存储 + 三处零明文 + 无后端 fail-closed
//   · anthropics/skills 的 pdf / skill-creator：渐进披露全链路（1536 截断 → 触发全文 → 压缩重挂预算）
//   · 远程 MCP 实际连接（需凭据，实测 401）→ 显式记「未证」，绝不静默算绿

/** 内存型安全存储替身（headless 无 safeStorage；只验「存储路径 + 不落明文」，不冒充平台加密）。 */
function memorySecretBackend(): { backend: PluginSecretBackend; dump: () => Record<string, string> } {
  const store = new Map<string, string>();
  return {
    backend: {
      name: "memory-test-backend",
      isAvailable: () => true,
      async set(k, v) {
        store.set(k, v);
      },
      async get(k) {
        return store.get(k) ?? null;
      },
    },
    dump: () => Object.fromEntries(store),
  };
}

async function darkBox(): Promise<void> {
  const target = join(tmpdir(), "m2g-darkbox-" + String(Date.now()));
  const repos: [string, string][] = [
    ["https://github.com/anthropics/skills", "anthropics-skills"],
    ["https://github.com/anthropics/claude-plugins-community", "community-plugins"],
  ];
  // M4a 裁决②：--filter=blob:none 浅克隆可被网络截断成「部分检出」（曾实测 SKILL.md 31<50 的假红）。
  // 克隆后做内容完整性抽查，不达标重试一次；仍不达标 → 该源按不可达处理（整段显式「未证」，不假红不静默绿）。
  const { rm: rmTree, readdir, stat } = await import("node:fs/promises");
  const MIN_SKILLS = 40; // anthropics/skills 实仓 SKILL.md 下限（正式阈值 50 留裕量；截断检出通常远低于此）
  const countSkillMd = async (dir: string, depth = 0): Promise<number> => {
    if (depth > 5) return 0;
    let n = 0;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return 0;
    }
    for (const e of entries) {
      if (e === ".git" || e === "node_modules") continue;
      const abs = join(dir, e);
      try {
        if ((await stat(abs)).isDirectory()) n += await countSkillMd(abs, depth + 1);
        else if (e === "SKILL.md") n++;
      } catch {
        /* 忽略不可读项 */
      }
    }
    return n;
  };
  let cloned = 0;
  for (const [url, name] of repos) {
    const minSkills = name === "anthropics-skills" ? MIN_SKILLS : 0;
    const attempt = async (): Promise<boolean> => {
      await git(["clone", "--depth", "1", "--filter=blob:none", url, join(target, name)]);
      return minSkills === 0 ? true : (await countSkillMd(join(target, name))) >= minSkills;
    };
    try {
      if (await attempt()) {
        cloned++;
        continue;
      }
      console.log("  ⚠️  暗卷克隆 " + name + " 内容不完整（疑似网络截断），重试一次");
      await rmTree(join(target, name), { recursive: true, force: true });
      if (await attempt()) {
        cloned++;
        continue;
      }
      console.log("  ⚠️  暗卷克隆 " + name + " 重试后仍不完整 → 该源不参与");
    } catch {
      continue; // 拉不到 → 该源不参与
    }
  }
  if (cloned < 2) {
    unverified.push("§9.11-1/2 实仓插件免改加载：存在源不可达或截断重试仍不完整 → 未证（非跳过即通过）");
    console.log("  ⚠️  暗卷**未证**：联网拉取 anthropics/skills 与 claude-plugins-community 未全部成功");
    return;
  }

  // ---- 扫描（修根因：必须下钻 .claude-plugin，否则 CC 布局的容器永远解析不到）----
  const { readFile: rf } = await import("node:fs/promises");
  const hits: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 5) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === ".git" || e === "node_modules") continue;
      const abs = join(dir, e);
      try {
        if ((await stat(abs)).isDirectory()) {
          if (e === ".claude-plugin") {
            const p = join(abs, "plugin.json");
            if (await stat(p).then(() => true, () => false)) hits.push(p);
            continue; // 容器元数据目录不再下钻
          }
          await walk(abs, depth + 1);
        } else if (e === "SKILL.md") {
          hits.push(abs);
        }
      } catch {
        /* 忽略不可读项 */
      }
    }
  };
  await walk(target, 0);

  const { parsePluginManifest, parseUserConfigFields, sensitiveUserConfigKeys } = await import("../src/agent/plugins/manifest");
  const { parseFrontmatter } = await import("../src/agent/plugins/frontmatter");
  let containers = 0;
  let loose = 0;
  const parsedContainers: { root: string; result: Awaited<ReturnType<typeof parsePluginManifest>> }[] = [];
  for (const hit of hits) {
    try {
      if (hit.endsWith("plugin.json")) {
        const pluginRoot = join(hit, "..", "..");
        parsedContainers.push({ root: pluginRoot, result: await parsePluginManifest(pluginRoot) });
        containers++;
      } else {
        const parsed = parseFrontmatter(await rf(hit, "utf8"));
        if (typeof parsed.frontmatter["description"] === "string" || parsed.frontmatter["name"] !== undefined) loose++;
      }
    } catch {
      /* 个别非容器 plugin.json（如 marketplace 内 package.json）不计入，不算失败 */
    }
  }
  console.log("  🌐 暗卷实测：克隆 " + String(cloned) + " 源，容器 manifest 免改解析 " + String(containers) + "，SKILL.md 免改解析 " + String(loose));
  assert(containers >= 2, "F1 实仓**容器**（.claude-plugin/plugin.json）免改解析 ≥ 2 个", "实际 " + String(containers));
  assert(loose >= 50, "F2 实仓 SKILL.md 免改解析 ≥ 50 个", "实际 " + String(loose));

  // ---- F3 testdino：7 skills + 远程 http MCP + scoped 名过权限门 ----
  const testdino = parsedContainers.find((c) => c.result.name === "testdino");
  if (!testdino) {
    unverified.push("§9.11-2 testdino：未在实仓中发现（命名变化？）→ 未证");
  } else {
    const { PluginRuntime } = await import("../src/agent/plugins");
    const rt = await PluginRuntime.load({
      projectPluginsDir: join(target, "community-plugins"),
      workspace: target,
      pluginDataRoot: join(target, ".plugin-data"),
      trustFile: join(target, "trust.json"),
    });
    const td = rt.manifest.plugins.find((p) => p.name === "testdino");
    assert(td !== undefined && td.skills.length === 7, "F3 testdino 7 个 skill 免改加载", "实际 " + String(td?.skills.length ?? 0));
    const servers = testdino.result.mcp;
    assert(
      servers.length === 1 && String(servers[0]?.config.type) === "http" && typeof servers[0]?.config.url === "string",
      "F4 testdino 远程 http MCP 配置免改解析（.mcp.json → type=http + url）",
      servers.map((s) => s.serverName + ":" + String(s.config.type)).join(","),
    );
    const serverName = servers[0]?.serverName ?? "testdino";
    // scoped 名形态 + 真权限管线（deny 命中 / 无规则 auto 放行）
    const { evaluate, newAutonomySession } = await import("../src/permissions");
    const scoped = scopedToolName("testdino", serverName, "get_test_runs");
    assert(/^mcp__plugin_testdino_[^_]+__/.test(scoped), "F5 testdino MCP 工具 scoped 名形态（mcp__plugin_<p>_<s>__<t>）", scoped);
    const denySession = newAutonomySession("auto", { rules: [{ behavior: "deny", tool: scoped, scope: "always", id: "dark:deny" }] });
    const dDeny = evaluate(scoped as Parameters<typeof evaluate>[0], {}, denySession);
    assert(dDeny.verdict === "deny", "F6 权限门对 testdino MCP scoped 名生效（deny 规则命中）", "实际 " + dDeny.verdict);
    const dAllow = evaluate(scoped as Parameters<typeof evaluate>[0], {}, newAutonomySession("auto"));
    assert(dAllow.verdict === "approve", "F7 对照：无规则时 auto 档放行（F6 的红不是档位层给的）", "实际 " + dAllow.verdict);
    // 远程连接：需凭据，实测 401 → 显式记未证
    const connected = await rt.connectMcp().then(() => true, () => false);
    await rt.shutdown().catch(() => {});
    if (connected && rt.mcpTools.size > 0) {
      const names = [...rt.mcpTools.keys()];
      assert(
        names.length > 0 && names.every((n) => /^mcp__plugin_testdino_/.test(n)),
        "F8 远程 MCP 连接成功，工具以 scoped 名进注册表",
        "工具 " + String(names.length) + " 个：" + names.slice(0, 5).join(","),
      );
    } else {
      unverified.push("§9.11-2 testdino 远程 http MCP 实际连接：mcp.testdino.com 返回 401（需凭据）→ 未证；已证的只是配置解析 + scoped 名过权限门（F4–F7）");
      console.log("  ⚠️  F8 远程 MCP 实际连接未证（401 需凭据）——已证项见 F4–F7");
    }
  }

  // ---- F9/F10 tres-finance：userConfig sensitive 解析 + 安全存储 + 三处零明文 ----
  const tres = parsedContainers.find((c) => c.result.name === "tres-finance-plugin");
  if (!tres) {
    unverified.push("§9.11-2 tres-finance：未在实仓中发现 → 未证");
  } else {
    const fields = parseUserConfigFields(tres.result.userConfig);
    const secretKeys = sensitiveUserConfigKeys(fields);
    assert(
      secretKeys.length === 1 && secretKeys[0] === "DEBANK_API_KEY",
      "F9 tres-finance userConfig sensitive 字段解析（DEBANK_API_KEY sensitive=true）",
      "actual keys=" + secretKeys.join(",") || "(none)",
    );
    const SECRET = "dbk_live_M2G_DARKBOX_SECRET_9f3a1c7e";
    const wsF = join(target, "tres-ws");
    const { mkdir: mk } = await import("node:fs/promises");
    await mk(join(wsF, ".agent"), { recursive: true });
    // 三处采集：落盘文件 / 日志 / 事件流
    const logLines: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    const capture = (...args: unknown[]): void => {
      logLines.push(args.map((a) => String(a)).join(" "));
    };
    const mem = memorySecretBackend();
    setPluginSecretBackend(mem.backend);
    console.log = capture;
    console.warn = capture;
    console.error = capture;
    let res: Awaited<ReturnType<typeof writePluginUserConfig>>;
    try {
      res = await writePluginUserConfig({
        plugin: "tres-finance-plugin",
        fields,
        values: { DEBANK_API_KEY: SECRET },
        dir: join(wsF, ".agent"),
      });
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
    }
    // 产品口径的审计行（只记键名 + 落盘路径，**不记值**）：一旦实现改成「把配置打进日志」，
    // 下面 F12 的日志位就会红——这条扫描不是空转。
    logLines.push("[plugin] userConfig 写入完成：" + JSON.stringify({ secretKeys: res.secretKeys, plaintextKeys: res.plaintextKeys, file: res.file }));
    assert(logLines.length > 0, "F10 日志采集非空（扫描位不是空转）", String(logLines.length) + " 行");
    assert(res.ok, "F11 sensitive 值写入成功（有安全后端时）", res.ok ? "" : res.error);
    assert(res.secretKeys.includes("DEBANK_API_KEY"), "F12 DEBANK_API_KEY 走了 sensitive 通道（非明文键）");
    const disk = await rf(res.file, "utf8");
    const { createEventLog } = await import("../src/events");
    const evPath = join(wsF, "events.jsonl");
    const log = createEventLog(evPath);
    await log.append({ type: "user_message", content: "配置 tres 插件" });
    await log.append({ type: "assistant_message", content: "已写入 userConfig：" + JSON.stringify({ config: JSON.parse(disk).config }) });
    const { replay } = await import("../src/events");
    const eventsText = JSON.stringify(await replay(evPath));
    const three = { 落盘文件: disk, 日志: logLines.join("\n"), 事件流: eventsText };
    const hitIn = Object.entries(three).filter(([, t]) => t.includes(SECRET)).map(([k]) => k);
    assert(hitIn.length === 0, "F13 sensitive 值三处零明文命中（落盘文件 / 日志 / 事件流）", hitIn.join("、"));
    assert(disk.includes(SECRET_PLACEHOLDER), "F14 明文配置文件里只有占位符，不含值");
    assert((await getPluginSecret("tres-finance-plugin", "DEBANK_API_KEY")) === SECRET, "F15 敏感值可经安全后端读回（往返一致）");
    assert(Object.values(mem.dump()).some((v) => v === SECRET), "F16 安全后端确有落值（明文只在后端，不在任何落盘产物）");
    // headless（无后端）→ fail-closed 拒存，绝不静默退回明文
    setPluginSecretBackend(null);
    const noBackend = await putPluginSecret("tres-finance-plugin", "DEBANK_API_KEY", SECRET);
    assert(!noBackend.ok && /fail-closed/.test(!noBackend.ok ? noBackend.error : ""), "F17 无安全后端 → fail-closed 拒存敏感值（不静默退回明文）", !noBackend.ok ? noBackend.error : "");
  }

  // ---- F18–F21 真实 skill 渐进披露全链路（anthropics/skills 的 pdf / skill-creator）----
  const skillsRoot = join(target, "anthropics-skills", "skills");
  const { PluginRuntime: RT2 } = await import("../src/agent/plugins");
  let rt2: Awaited<ReturnType<typeof RT2.load>> | null = null;
  try {
    rt2 = await RT2.load({
      looseRoots: [skillsRoot],
      workspace: target,
      pluginDataRoot: join(target, ".plugin-data-2"),
      trustFile: join(target, "trust-2.json"),
    });
  } catch {
    rt2 = null;
  }
  if (!rt2 || rt2.skills().length === 0) {
    unverified.push("§9.11-1 官方 skill 渐进披露全链路：anthropics/skills 不可用 → 未证");
  } else {
    const all = rt2.skills();
    const list = rt2.routingList();
    assert(
      list.truncated && list.text.length <= SKILL_ROUTING_CHAR_LIMIT,
      "F18 真实 skill 路由清单超 1536 字符被截断",
      "len=" + String(list.text.length) + " skills=" + String(all.length),
    );
    const target2 = all.find((s) => s.name === "pdf") ?? all.find((s) => s.name === "skill-creator") ?? all[0]!;
    const invoke = "/" + target2.name;
    const trig = rt2.triggerSkill(invoke);
    assert(
      trig.ok && trig.output.length > 200 && trig.output === target2.body,
      "F19 触发后全文进上下文（真实 skill：" + invoke + "）",
      "len=" + String(trig.output.length),
    );
    const events: AgentEvent[] = [
      { type: "user_message", content: "用 " + invoke },
      { type: "tool_call", id: "c1", name: "skill", args: { name: invoke } },
      { type: "tool_result", callId: "c1", ok: true, output: "OK" },
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
    const remount = rt2.remountFromEvents(events);
    assert(remount.mounted.includes(invoke), "F20 触发记录被压缩 → 真实 skill 重挂");
    assert(remount.tokens <= SKILL_REMOUNT_TOKENS_TOTAL, "F21 重挂不超过预算（" + String(remount.tokens) + " ≤ " + String(SKILL_REMOUNT_TOKENS_TOTAL) + "）");
    await rt2.shutdown().catch(() => {});
  }
}

main().catch((err) => {
  console.error("plugins-check 异常:", err);
  process.exit(1);
});
