// §9.3 的「权限联动」两行：`allowed-tools` / `disallowed-tools`。
// 此前的形状：字段被 frontmatter 解析器收下（tests/plugins-skills.test.ts 只断言它"是个字符串"），
// 执行端一个字都不读 ⇒ 装载即陈列。这一组判据把两条 face 分别钉住，并且**钉住收紧点**：
// §9.3 原话「放行不得越过当前权限档位」——所以 allowed-tools 只登记不扩权，
// 而 disallowed-tools 是真闸（激活期摘工具，与 §4.4.1 的 worker 工具面同构）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginRuntime, skillToolPolicy, setCurrentPluginRuntime } from "../src/agent/plugins";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import { runAgent, handleAgentState, runStartToolFace, withSkillAllowNote } from "../src/main/agent-runner";
import { sessionToolSpecs } from "../src/agent/glm-session";
import { TOOL_NAMES } from "../src/tools/base";
import type { AgentEvent } from "../src/events";

describe("skillToolPolicy（申报解析）", () => {
  it("逗号/空格混排、数组形态、CC 别名与去重都归一成规范工具名", () => {
    const p = skillToolPolicy({ "allowed-tools": "read_file, Write  edit", disallowedTools: undefined, "disallowed-tools": ["grep", "bash"] });
    expect(p.allow).toEqual(["read_file", "write_file", "edit_file"]);
    expect(p.deny).toEqual(["grep", "run_shell"]);
    expect(p.unknown).toEqual([]);
  });

  it("认不出的名字另列且带方向前缀（不静默当真，也不静默丢掉）", () => {
    const p = skillToolPolicy({ "allowed-tools": "delete_everything", "disallowed-tools": "mcp__foo__bar" });
    expect(p.allow).toEqual([]);
    expect(p.deny).toEqual([]);
    expect(p.unknown).toEqual(["allow:delete_everything", "deny:mcp__foo__bar"]);
  });

  it("没有申报 = 三个空表（零行为：既有会话不因此多出任何改动）", () => {
    expect(skillToolPolicy(undefined)).toEqual({ allow: [], deny: [], unknown: [] });
    expect(skillToolPolicy({ description: "x" })).toEqual({ allow: [], deny: [], unknown: [] });
  });
});

describe("loop 的 disallowed-tools 活闸", () => {
  async function call(over: Partial<LoopOptions>, toolName: string): Promise<{ log: AgentEvent[]; ran: number }> {
    const log: AgentEvent[] = [];
    let ran = 0;
    let calls = 0;
    await runLoop({
      workspace: "/tmp",
      userMessage: "t",
      mode: "auto",
      events: { async append(e) { log.push(e); } },
      provider: {
        async *stream() {
          calls++;
          if (calls === 1) yield { type: "tool_call", id: "c1", name: toolName, args: {} };
        },
      },
      tools: {
        grep: { name: "grep", async run() { ran++; return { ok: true, output: "SHOULD_NOT_RUN" }; } },
        verify: { name: "verify", async run() { ran++; return { ok: true, output: "SHOULD_NOT_RUN" }; } },
      },
      // 故意接上 verify 钩子：没有活闸时它就会执行（ran 变 1）——这样「被摘的 verify 走不走系统门」
      // 才是可分辨的，否则拿「钩子未接线」的既有拒绝冒充闸生效。
      verify: {
        maxAttempts: 1,
        surface: async () => false,
        run: async () => { ran++; return { ok: true as const, results: [] }; },
      },
      ...over,
    });
    return { log, ran };
  }

  it("摘除期间该工具根本不进执行面，拒绝挂回原 callId 且点名申报者", async () => {
    const { log, ran } = await call({ skillDenial: (t) => (t === "grep" ? "/demo:sec" : null) }, "grep");
    expect(ran).toBe(0);
    const refused = log.find((e) => e.type === "tool_result") as Extract<AgentEvent, { type: "tool_result" }>;
    expect(refused.ok).toBe(false);
    expect(refused.callId).toBe("c1");
    expect(refused.output).toContain("[skill]");
    expect(refused.output).toContain("/demo:sec");
  });

  it("活闸排在 verify 系统门之前：被摘掉的 verify 不能靠「系统门优先」绕过", async () => {
    const { ran } = await call({ skillDenial: (t) => (t === "verify" ? "/demo:sec" : null) }, "verify");
    expect(ran).toBe(0);
  });

  it("未接线（缺省）与不摘该工具 ⇒ 照常执行（零回归）", async () => {
    expect((await call({}, "grep")).ran).toBe(1);
    expect((await call({ skillDenial: () => null }, "grep")).ran).toBe(1);
  });
});

describe("PluginRuntime 的登记面（两条 face 同一个入口）", () => {
  let dir: string;
  let rt: PluginRuntime | null = null;

  const root = (): string => join(dir, "user-plugins", "pol");

  async function load(): Promise<PluginRuntime> {
    await mkdir(join(root(), ".claude-plugin"), { recursive: true });
    await mkdir(join(root(), "skills", "sec"), { recursive: true });
    await mkdir(join(root(), "skills", "quiet"), { recursive: true });
    await writeFile(join(root(), ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "pol", description: "权限联动判据", version: "0.1.0" }), "utf8");
    await writeFile(join(root(), "skills", "sec", "SKILL.md"),
      "---\nname: sec\ndescription: 摘工具。\ndisallowed-tools: grep\nallowed-tools: write_file\n---\n正文\n", "utf8");
    await writeFile(join(root(), "skills", "quiet", "SKILL.md"),
      "---\nname: quiet\ndescription: 模型不可点。\ndisable-model-invocation: true\ndisallowed-tools: glob\n---\n只有用户能点\n", "utf8");
    return await PluginRuntime.load({
      userPluginsDir: join(dir, "user-plugins"),
      workspace: dir,
      pluginDataRoot: join(dir, "plugin-data"),
      trustFile: join(dir, "trust.json"),
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-skill-policy-"));
    rt = await load();
  });
  afterEach(async () => {
    await rt?.shutdown();
    rt = null;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("激活之前什么都不生效；激活那一刻登记，且 deny 与 allow 分别可查", () => {
    const e = rt!;
    expect(e.skillScopeSnapshot()).toEqual([]);
    expect(e.skillDenial("grep")).toBeNull();
    e.triggerSkill("/pol:sec", "");
    expect(e.skillDenial("grep")).toBe("/pol:sec");
    expect(e.skillDenial("read_file")).toBeNull();
    // 收紧点：allowed-tools 只是"登记 + 可解释"，不是放行通道
    expect(e.skillAllowNote("write_file")).toBe("/pol:sec");
    expect(e.skillScopeSnapshot()).toEqual([{ invoke: "/pol:sec", allow: ["write_file"], deny: ["grep"] }]);
  });

  it("被拒的那次触发什么都不登记（模型点不到 disable-model-invocation，也就带不进它的工具面）", () => {
    const e = rt!;
    expect(e.triggerSkill("/pol:quiet", "").ok).toBe(false);
    expect(e.skillScopeSnapshot()).toEqual([]);
    expect(e.skillDenial("glob")).toBeNull();
    // 用户侧那条同样登记（同一入口），此时才摘得掉 glob
    e.grantSkillScope("/pol:quiet", { "disallowed-tools": "glob" });
    expect(e.skillDenial("glob")).toBe("/pol:quiet");
  });

  it("门卡的 reason 说清「申报了但没放行」——收紧点要让使用者看得见（能力 8：可解释）", () => {
    const e = rt!;
    e.grantSkillScope("/pol:sec", { "allowed-tools": "write_file" });
    setCurrentPluginRuntime(e);
    try {
      const r = withSkillAllowNote("write_file", "档位需确认");
      expect(r).toContain("/pol:sec 的 allowed-tools 申报过 write_file");
      expect(r).toContain("仍需确认");
      expect(r).toContain("档位需确认"); // 原理由不丢
      expect(withSkillAllowNote("read_file", "原样")).toBe("原样"); // 没申报 ⇒ 一个字都不加
    } finally {
      setCurrentPluginRuntime(null);
    }
  });

  it("认不出的申报当场出声（不静默收下，也不静默不兑现）", async () => {
    const warns: string[] = [];
    const prev = console.warn;
    console.warn = (m?: unknown, ...rest: unknown[]): void => { warns.push(String(m) + " " + rest.map(String).join(" ")); };
    try {
      rt!.grantSkillScope("/pol:x", { "allowed-tools": "not_a_tool" });
    } finally {
      console.warn = prev;
    }
    expect(warns.join(" ")).toContain("not_a_tool");
    expect(warns.join(" ")).toContain("本轮不生效");
  });

  it("面板快照带这份账（审计读路径与判据同源）", () => {
    const e = rt!;
    expect(e.snapshot().toolScopes).toEqual([]);
    e.grantSkillScope("/pol:sec", { "disallowed-tools": "grep" });
    expect(e.snapshot().toolScopes).toEqual([{ invoke: "/pol:sec", allow: [], deny: ["grep"] }]);
  });

  const specNames = (specs: { function: { name: string } }[]): string[] => specs.map((s) => s.function.name);

  it("规格面同步：激活后那把工具从模型可见清单消失，只摘申报的那把、不误伤别个", () => {
    const e = rt!;
    const before = runStartToolFace(e, { mode: "default" });
    expect(before.specs.some((s) => s.function.name === "grep")).toBe(true);
    expect(before.note).toBe(""); // 没激活 ⇒ 一个字都不该变（既有会话零回归）
    e.triggerSkill("/pol:sec", "");
    const after = runStartToolFace(e, { mode: "default" });
    expect(specNames(after.specs)).toEqual(specNames(before.specs).filter((n) => n !== "grep"));
    expect(after.note).toContain("grep");
    expect(after.note).toContain("/pol:sec"); // 说清是谁摘的：静默少工具等于让模型自己猜
  });

  it("规格面与活闸同一份谓词（两份实现必漂）", () => {
    const e = rt!;
    e.triggerSkill("/pol:sec", "");
    const face = runStartToolFace(e, { mode: "default" });
    expect(face.skillDenial?.("grep")).toBe("/pol:sec");
    expect(face.skillDenial?.("read_file")).toBeNull();
    expect(face.specs.some((s) => s.function.name === "grep")).toBe(false);
  });

  it("没有插件运行时 = 规格面逐字不变（不因为接线凭空摘工具或注说明）", () => {
    const face = runStartToolFace(null, { mode: "default" });
    expect(specNames(face.specs)).toEqual(specNames(sessionToolSpecs({ mode: "default" }).specs));
    expect(face.note).toBe("");
    expect(face.skillDenial).toBeUndefined();
  });

  it("申报覆盖整个 ToolName 键域：那十把全摘；不在键域里的规格（remember 等）留着——不可申报的不假装摘得动", () => {
    const e = rt!;
    e.grantSkillScope("/pol:all", { "disallowed-tools": TOOL_NAMES.join(",") });
    const face = runStartToolFace(e, { mode: "default" });
    // 缺省清单 = TOOL_NAMES 那十把 + 三把不可申报的 ⇒ 只剩后三把就是"十把全摘干净"
    expect(specNames(face.specs).sort()).toEqual(["remember", "spawn_agent", "wait_for_agents"]);
  });
});

describe("runAgent 真入口：用户敲一条带申报的 /skill，工具面确实改了", () => {
  let dir: string;
  const savedUser = process.env.M2E_USER_PLUGINS;
  const savedData = process.env.M2E_PLUGIN_DATA;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-policy-live-"));
    await writeFile(join(dir, "README.md"), "靶子占位\n", "utf8");
    const root = join(dir, "user-plugins", "pol");
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await mkdir(join(root, "skills", "sec"), { recursive: true });
    await mkdir(join(root, "commands"), { recursive: true });
    await writeFile(join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "pol", description: "权限联动真入口判据", version: "0.1.0" }), "utf8");
    await writeFile(join(root, "skills", "sec", "SKILL.md"),
      "---\nname: sec\ndescription: 摘工具。\ndisallowed-tools: grep\nallowed-tools: write_file\n---\n安全拍正文\n", "utf8");
    // §9.4 明写命令也带 allowed-tools ⇒ 同一份解析、同一个登记入口（两条 face 不各抄一份）
    await writeFile(join(root, "commands", "cmdsec.md"),
      "---\ndescription: 命令侧申报。\nallowed-tools: read_file\n---\n命令正文\n", "utf8");
    process.env.M2E_USER_PLUGINS = join(dir, "user-plugins");
    process.env.M2E_PLUGIN_DATA = join(dir, "plugin-data");
  });
  afterEach(async () => {
    if (savedUser === undefined) delete process.env.M2E_USER_PLUGINS;
    else process.env.M2E_USER_PLUGINS = savedUser;
    if (savedData === undefined) delete process.env.M2E_PLUGIN_DATA;
    else process.env.M2E_PLUGIN_DATA = savedData;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("派发即登记：面板（agent:state）读到的就是这条 skill 的账", async () => {
    await runAgent({
      workspace: dir, message: "/pol:sec 开工", mode: "read-only",
      logPath: join(dir, "live.jsonl"), sandbox: null, unattended: true,
    });
    const st = await handleAgentState();
    expect(st.plugins?.toolScopes).toEqual([{ invoke: "/pol:sec", allow: ["write_file"], deny: ["grep"] }]);
  }, 120_000);

  it("命令侧申报走同一个登记入口（§9.4 的 allowed-tools 不是只有 skill 才有）", async () => {
    await runAgent({
      workspace: dir, message: "/pol:cmdsec", mode: "read-only",
      logPath: join(dir, "cmd.jsonl"), sandbox: null, unattended: true,
    });
    const st = await handleAgentState();
    expect(st.plugins?.toolScopes).toEqual([{ invoke: "/pol:cmdsec", allow: ["read_file"], deny: [] }]);
  }, 120_000);

  it("真入口跑一次：规格面在 run 起点就把那把摘了（告警按次数看，不看布尔）", async () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    });
    try {
      await runAgent({
        workspace: dir, message: "/pol:sec 开工", mode: "read-only",
        logPath: join(dir, "face.jsonl"), sandbox: null, unattended: true,
      });
    } finally {
      spy.mockRestore();
    }
    const lines = warns.filter((w) => w.includes("规格面摘除"));
    expect(lines).toHaveLength(1); // 恰好一次：登记面与规格面各喊一遍就是两份实现
    expect(lines[0]).toContain("grep←/pol:sec");
  }, 120_000);
});
