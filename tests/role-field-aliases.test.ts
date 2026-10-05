// 判卷 · 用户自定义子代理要吃得住 Claude Code 那套**连字符**字段名（台账 #97）。
//
// 现读取证的形状：`~/.dsh/agents/x.md` / `~/.claude/agents/x.md` 里的角色 frontmatter 由
// **一份**投影吃下（`resolvePluginRole`，src/agent/sequencer.ts；单发路径 orchestrator.ts:357 与
// 链路径 orchestrator.ts:1008 都经 `resolveStageRole`→`resolvePluginRole`，装载侧
// plugins/discover.ts:128 与 roles/user-agents.ts:83 只透传 frontmatter 不读这些键），
// 而那份投影只认本仓的驼峰名。CC 生态写的是 `allowed-tools` / `disallowed-tools`
// ⇒ 那些键从前落进「未知键」被警告后**丢弃**：用户照 CC 写法放的文件"看着生效、实际按默认面跑"，
// 静默拿到比声明**更大**的工具面——本仓点名的最坏失效（申报了却不生效，且不吭声）。
//
// 这一支钉五格：
//   ① 连字符白名单 ⇒ 工具面真的收窄（可观测：worker 模型每轮拿到的规格面只缩不涨）
//   ② 连字符剔除面 ⇒ 那把工具在激活期真调不到（执行表里没有实例 ⇒ unknown tool 硬拒）
//   ③ 同义两名同时写且值不同 ⇒ 出声（回执/事件点名，不许静默择一）
//   ④ 真·未知键仍要警告（这波放宽只给连字符别名，不给下划线笔误）
//   ⑤ 反向证人：`permission-mode` 不许被当成「已生效」——本仓没有对应语义 ⇒ 只准「忽略＋点名」
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, type WorkerModel } from "../src/agent/orchestrator";
import type { PluginAgentRoleDef } from "../src/agent/sequencer";
import { resolvePluginRole } from "../src/agent/sequencer";
import { PluginRuntime } from "../src/agent/plugins";
import type { ModelOutput } from "../src/providers";
import type { GlmMessage, GlmToolSpec } from "../src/providers/glm";

const REPORT = "## 结论\n- 读完了。\n\n## 证据路径\n- a.ts:1\n\n## 风险\n- 低。\n\n## 未决问题\n- 无。\n\nverdict: pass";

let root = "";
let logPath = "";
let seq = 0;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-role-aliases-"));
  logPath = join(root, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {});
  root = "";
});

/** 放一份 CC 写法的用户级角色文件并装载运行时（真走 `~/.dsh/agents/x.md` 那条路，不是手搓 def）。 */
async function runtimeWithAgentFile(name: string, frontmatterBlock: string): Promise<PluginRuntime> {
  const home = join(root, "home-" + String(++seq));
  await mkdir(join(home, ".dsh", "agents"), { recursive: true });
  await writeFile(join(home, ".dsh", "agents", name + ".md"),
    "---\nname: " + name + "\ndescription: CC 写法的用户级角色\n" + frontmatterBlock + "---\n你是只读调研角色。\n", "utf8");
  return await PluginRuntime.load({
    projectPluginsDir: join(home, "no-plugins"),
    workspace: root,
    pluginDataRoot: join(home, "plugin-data"),
    trustFile: join(home, "trust.json"),
    home,
  });
}

interface Run {
  orch: Orchestrator;
  events: AgentEvent[];
  /** 模型每一轮**实际收到**的工具名（规格面投影，与执行表同源）。 */
  rounds: string[][];
}

/** 起一个真 worker：注入的模型会自报它每轮看到的工具规格面。 */
function runWorker(def: PluginAgentRoleDef | null, script: ModelOutput[], roleInvoke = "user:cc"): Run {
  const events: AgentEvent[] = [];
  const rounds: string[][] = [];
  let cursor = 0;
  const model = (async function* (_messages: GlmMessage[], tools: GlmToolSpec[]) {
    rounds.push(tools.map((t) => t.function.name));
    while (cursor < script.length) yield script[cursor++] as ModelOutput;
  }) as WorkerModel;
  model.scripted = true; // 冻结剧本：不拨号不付钱（价格标签据此缺席）
  const orch = new Orchestrator({
    logPath,
    workspace: root,
    parentMode: "default",
    modelFor: () => model,
    emit: async (e) => {
      events.push(e);
      await createEventLog(logPath).append(e);
    },
    ...(def ? { agentRoleFor: (invoke: string) => (invoke === roleInvoke ? def : null) } : {}),
  });
  return { orch, events, rounds };
}

const TEXT_OUT: ModelOutput[] = [{ type: "assistant_message", content: REPORT }];
const toolCall = (id: string, name: string): ModelOutput =>
  ({ type: "tool_call", id, name, args: { pattern: "x" } }) as unknown as ModelOutput;

const roleMessages = (run: Run): string[] =>
  run.events.filter((e) => e.type === "agent_message").map((e) => (e as Extract<AgentEvent, { type: "agent_message" }>).text);
const resultOf = (run: Run, callId: string): Extract<AgentEvent, { type: "tool_result" }> | undefined =>
  run.events.find((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && e.callId === callId);

describe("① CC 的 allowed-tools ⇒ 工具面真的被收窄（不是「看着生效、实际按默认面跑」）", () => {
  it("装载侧只透传：连字符键原样交给那一份投影（别名读只许有一处，不加第二个读点）", async () => {
    const rt = await runtimeWithAgentFile("cc-scout", "allowed-tools: read_file, grep\n");
    try {
      const def = rt.findAgentRole("user:cc-scout");
      expect(def, "用户级文件必须查得到").not.toBeNull();
      // 别名不是在装载期偷偷改名的：那份原始键还在，收敛只发生在 resolvePluginRole 里
      expect((def!.frontmatter as Record<string, unknown>)["allowed-tools"]).toBe("read_file, grep");
      expect(def!.frontmatter.tools).toBeUndefined();
      // 而那份投影真的吃它
      expect(resolvePluginRole(def!).tools).toEqual(["read_file", "grep"]);
    } finally { await rt.shutdown(); }
  });

  it("真跑起来：模型每轮拿到的规格面恰好是声明的那两把，且比默认面只缩不涨", async () => {
    const rt = await runtimeWithAgentFile("cc-scout2", "allowed-tools: read_file, grep\n");
    const run = runWorker(rt.findAgentRole("user:cc-scout2"), TEXT_OUT, "user:cc-scout2");
    const r = await run.orch.spawn({ mode: "read", task: "调研 a.ts", role: "user:cc-scout2" }, { callId: "c1" });
    expect(r.ok, r.output).toBe(true);
    await run.orch.waitAll(10_000);
    await rt.shutdown();

    expect(run.rounds.length, "模型至少被调过一轮，否则读数是无中放矢").toBeGreaterThan(0);
    for (const round of run.rounds) {
      expect([...round].sort()).toEqual(["grep", "read_file"]);
    }
    // 只缩不涨：拿同一台机器上的默认面当对照（不硬编码表名，表改了这条自己会说话）
    const control = runWorker(null, TEXT_OUT);
    const rc = await control.orch.spawn({ mode: "read", task: "调研 b.ts" }, { callId: "c2" });
    expect(rc.ok, rc.output).toBe(true);
    await control.orch.waitAll(10_000);
    const defaults = new Set(control.rounds[0]);
    expect(defaults.size).toBeGreaterThan(2);
    for (const name of run.rounds[0]!) expect(defaults.has(name), "白名单里冒出默认面没有的 " + name).toBe(true);
    expect(defaults.has("glob"), "对照面自己得不收窄").toBe(true);
  });

  it("连字符白名单声明了默认面没有的写工具 ⇒ 也不涨（白名单永远越不过 worker 的固有边界）", async () => {
    const run = runWorker({ name: "cc", body: "只读调研", frontmatter: { "allowed-tools": "read_file, write_file" } }, TEXT_OUT);
    const r = await run.orch.spawn({ mode: "read", task: "调研 c.ts", role: "user:cc" }, { callId: "c3" });
    expect(r.ok, r.output).toBe(true);
    await run.orch.waitAll(10_000);
    expect(run.rounds[0]).toContain("read_file");
    expect(run.rounds[0], "声明换不来扩权：write_file 根本不在 read worker 的表内").not.toContain("write_file");
  });
});

describe("② CC 的 disallowed-tools ⇒ 那把工具在激活期真调不到", () => {
  it("模型仍然发起调用时执行面硬拒（unknown tool），且规格面里它已经不存在", async () => {
    const rt = await runtimeWithAgentFile("cc-critic", "disallowed-tools: grep\n");
    const def = rt.findAgentRole("user:cc-critic");
    expect(def, "用户级文件必须查得到").not.toBeNull();
    const run = runWorker(def, [toolCall("g1", "grep"), ...TEXT_OUT], "user:cc-critic");
    const r = await run.orch.spawn({ mode: "read", task: "评审 d.ts", role: "user:cc-critic" }, { callId: "c4" });
    expect(r.ok, r.output).toBe(true);
    await run.orch.waitAll(10_000);
    await rt.shutdown();

    expect(run.rounds[0], "grep 该从模型可见面摘掉").not.toContain("grep");
    const tr = resultOf(run, "g1");
    expect(tr, "被摘的工具调用必须有一条回执，不许静默消失").toBeTruthy();
    expect(tr!.ok).toBe(false);
    expect(String(tr!.output)).toContain("grep");
    // 没被点名的那把照常可用（否则「全摘」也能骗过上面两条）
    const okRun = runWorker(def, [toolCall("r1", "read_file"), ...TEXT_OUT], "user:cc-critic");
    const okR = await okRun.orch.spawn({ mode: "read", task: "评审 e.ts", role: "user:cc-critic" }, { callId: "c5" });
    expect(okR.ok, okR.output).toBe(true);
    await okRun.orch.waitAll(10_000);
    const okTr = resultOf(okRun, "r1");
    expect(okTr, "read_file 未被申报摘除，该有回执").toBeTruthy();
    expect(String(okTr!.output)).not.toContain("unknown tool");
  });

  it("连字符剔除面与驼峰剔除面同读一份投影（驼峰那份既没坏也没多读一遍）", async () => {
    const camel = resolvePluginRole({ name: "a", body: "b", frontmatter: { disallowedTools: "grep" } });
    const hyphen = resolvePluginRole({ name: "a", body: "b", frontmatter: { "disallowed-tools": "grep" } });
    expect(hyphen.disallowedTools).toEqual(["grep"]);
    expect(camel.disallowedTools).toEqual(["grep"]);
    expect(hyphen.warnings, "单一写法不该有警告：" + hyphen.warnings.join(" | ")).toEqual([]);
    expect(camel.warnings).toEqual([]);
  });
});

describe("③ 同一份文件里两种写法并存且值不同 ⇒ 出声，不许静默择一", () => {
  it("tools 与 allowed-tools 值不同：警告点名两个键与两个值，并按保守面（交集）收", async () => {
    const r = resolvePluginRole({
      name: "a", body: "b",
      frontmatter: { tools: "read_file", "allowed-tools": "read_file, grep" },
    });
    const conflict = r.warnings.filter((w) => w.includes("tools") && w.includes("allowed-tools"));
    expect(conflict, "不许静默取其一：" + r.warnings.join(" | ")).toHaveLength(1);
    expect(conflict[0]).toContain("read_file");
    expect(conflict[0]).toContain("grep");
    expect(r.tools, "白名单冲突按交集（放大任何一份都是扩权）").toEqual(["read_file"]);
  });

  it("disallowedTools 与 disallowed-tools 值不同：按并集剔除并点名（宁多拦不漏拦）", () => {
    const r = resolvePluginRole({
      name: "a", body: "b",
      frontmatter: { disallowedTools: "grep", "disallowed-tools": "glob" },
    });
    expect(r.warnings.filter((w) => w.includes("disallowedTools") && w.includes("disallowed-tools"))).toHaveLength(1);
    expect((r.disallowedTools ?? []).sort()).toEqual(["glob", "grep"]);
  });

  it("交集为空时不许退回默认面而不吭声（那正是本笔要修的静默扩权）", () => {
    const r = resolvePluginRole({
      name: "a", body: "b",
      frontmatter: { tools: "read_file", "allowed-tools": "lsp" },
    });
    const said = r.warnings.join(" | ");
    expect(said).toContain("read_file");
    expect(said, "合并后为空必须说出来：静默按默认面跑就是「比声明更大」").toContain("空");
    expect(r.tools, "交集为空 ⇒ 白名单这一格不落地，但那句话必须已经说出来").toBeUndefined();
  });

  it("两种写法同值 ⇒ 不是冲突，不出声（否则每个 CC 文件都在喊）", () => {
    const r = resolvePluginRole({
      name: "a", body: "b",
      frontmatter: { tools: "read_file, grep", "allowed-tools": "grep,read_file" },
    });
    expect(r.warnings, "同值不该警告：" + r.warnings.join(" | ")).toEqual([]);
    expect(r.tools!.slice().sort()).toEqual(["grep", "read_file"]);
  });

  it("冲突也走那条唯一的事件出口（worker 子流里点名，而不是只进内存）", async () => {
    const run = runWorker(
      { name: "cc", body: "只读调研", frontmatter: { tools: "read_file", "allowed-tools": "read_file, grep" } },
      TEXT_OUT,
    );
    const r = await run.orch.spawn({ mode: "read", task: "调研 f.ts", role: "user:cc" }, { callId: "c6" });
    expect(r.ok, r.output).toBe(true);
    await run.orch.waitAll(10_000);
    const said = roleMessages(run).join(" | ");
    expect(said, "冲突要在事件面上看得见：" + said).toContain("allowed-tools");
    expect(said).toContain("tools");
    // 那句必须是「冲突」那一条，不是未知键的笔误提示（别名落地前者也成立 ⇒ 只点名两个键没分辨力）
    expect(said, "事件里那条要点名「不许静默择一」：" + said).toContain("不静默择一");
    // 事件里那个读数与投影一致（不是文案写了交集、执行面却用了另一份）
    expect(run.rounds[0], "冲突时执行面按交集收").toEqual(["read_file"]);
  });
});

describe("④ 真·未知键仍要警告（这波只放宽连字符别名）", () => {
  it("下划线笔误仍点名且不采纳：disallowed_tools / allowed_tools", () => {
    for (const [key, field] of [["disallowed_tools", "disallowedTools"], ["allowed_tools", "tools"]] as const) {
      const r = resolvePluginRole({ name: "a", body: "b", frontmatter: { [key]: "grep" } });
      expect(r.warnings, key + " 不该被静默吃").toHaveLength(1);
      expect(r.warnings[0]).toContain(key);
      expect(r.warnings[0]).toContain("不认识");
      expect((r as Record<string, unknown>)[field], key + " 不许被当成那条正名采纳").toBeUndefined();
    }
  });

  it("连字符别名不再是未知键，而无关的瞎写键照旧警告（同一次调用两个读数）", () => {
    const r = resolvePluginRole({ name: "a", body: "b", frontmatter: { "allowed-tools": "grep", toolz: "grep" } });
    expect(r.tools).toEqual(["grep"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("toolz");
    expect(r.warnings[0], "提示里那份合法键对照不许被这波改动弄丢").toContain("disallowedTools");
  });

  it("既有那三件 CC 安全约束仍各出一条（并入口径不许混进别名读）", () => {
    const r = resolvePluginRole({ name: "a", body: "b", frontmatter: { hooks: "x", mcpServers: "y", permissionMode: "z" } });
    expect(r.warnings).toHaveLength(3);
    for (const w of r.warnings) expect(w).toContain("安全约束照抄");
  });
});

describe("⑤ 反向证人：permission-mode 不许被当成「已生效」", () => {
  it("连字符的 permission-mode 与驼峰同口径：点名＋已忽略＋明说映射到什么", () => {
    const r = resolvePluginRole({ name: "a", body: "b", frontmatter: { "permission-mode": "bypassPermissions" } });
    expect(r.warnings).toHaveLength(1);
    const w = r.warnings[0]!;
    expect(w).toContain("permission-mode");
    expect(w).toContain("已忽略");
    expect(w, "要说清这格本仓没有对应语义，不许只留一个「已忽略」让人猜").toContain("不映射");
    expect(w).not.toContain("已生效");
  });

  it("它不进产物：投影里没有 permissionMode 这一格，mode 也只由 isolation 决定", () => {
    const noIso = resolvePluginRole({ name: "a", body: "b", frontmatter: { "permission-mode": "bypassPermissions" } });
    expect("permissionMode" in noIso).toBe(false);
    expect("permission-mode" in noIso).toBe(false);
    expect(noIso.mode, "bypassPermissions 不该把只读角色升成写面").toBe("read");
    const withIso = resolvePluginRole({
      name: "a", body: "b", frontmatter: { "permission-mode": "default", isolation: "worktree" },
    });
    expect(withIso.mode).toBe("write"); // 唯一来源仍是 isolation（§9.6），与 permission-mode 无关
    expect(withIso.warnings.filter((x) => x.includes("permission-mode"))).toHaveLength(1);
  });

  it("执行端同样读不到它：带 permission-mode 的角色跑起来，工具面还是那一份默认面", async () => {
    const run = runWorker({ name: "cc", body: "只读调研", frontmatter: { "permission-mode": "bypassPermissions" } }, TEXT_OUT);
    const r = await run.orch.spawn({ mode: "read", task: "调研 g.ts", role: "user:cc" }, { callId: "c7" });
    expect(r.ok, r.output).toBe(true);
    await run.orch.waitAll(10_000);
    const control = runWorker(null, TEXT_OUT);
    const rc = await control.orch.spawn({ mode: "read", task: "调研 h.ts" }, { callId: "c8" });
    expect(rc.ok, rc.output).toBe(true);
    await control.orch.waitAll(10_000);
    expect(run.rounds[0], "忽略掉的字段不该改工具面").toEqual(control.rounds[0]);
    expect(roleMessages(run).join(" | ")).toContain("permission-mode");
  });
});
