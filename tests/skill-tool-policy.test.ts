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
import { resolveDeclaredTool } from "../src/agent/plugins/skills";
import { CANCEL_AGENTS_NAME, INJECTED_TOOLS, SPAWN_AGENT_NAME } from "../src/agent/tool-surface";
import { CANCEL_AGENTS_TOOL } from "../src/tools/cancel_agents";
import { runLoop, type LoopOptions } from "../src/agent/loop";
import { runAgent, handleAgentState, sessionToolFace, withSkillAllowNote } from "../src/main/agent-runner";
import { sessionToolSpecs } from "../src/agent/session-provider";
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

describe("申报域 = 整张模型面（收紧向）——第 121 页：以前 13 把注入工具一条都禁不掉", () => {
  const INJECTED = ["spawn_agent", "wait_for_agents", "cancel_agents", "refine_goal", "remember",
    "impact_query", "obs_recall", "skill", "automation_create", "automation_update",
    "automation_delete", "automation_run_now", "automation_list"];

  it("一条「禁用整张模型面」的申报：静态 10 ＋ 注入 13 全部进 deny[]，unknown 必须为空", () => {
    const p = skillToolPolicy({ "disallowed-tools": [...TOOL_NAMES, ...INJECTED].join(",") });
    expect(p.unknown).toEqual([]);
    // 两半都得在：只数静态会得到 10 条而"看起来没问题"（这一格以前就是这样红不起来的）。
    expect(p.deny.filter((t) => (TOOL_NAMES as readonly string[]).includes(t))).toHaveLength(TOOL_NAMES.length);
    expect(INJECTED.filter((n) => !p.deny.includes(n))).toEqual([]);
  });

  it("不对称必须保住：同一个注入工具名写进 `allowed-tools` 仍算认不出（放宽向不跟着扩面）", () => {
    const p = skillToolPolicy({ "allowed-tools": "spawn_agent automation_create" });
    expect(p.allow).toEqual([]);
    expect(p.unknown).toEqual(["allow:spawn_agent", "allow:automation_create"]);
  });

  it("端到端：申报生效时模型清单里真的少那把，且摘除说明点名（不许「看得见却被拒」）", () => {
    // 名字取自上面那张表，不再抄一遍字面量：尺对"裸名字针脚"这一族是不收的（变量拼 ⇒ 收料要落在散文里），
    // 抄第二处只会往顶包名单里添一格"改一处不会响"。
    const [probe] = INJECTED;
    const p = skillToolPolicy({ "disallowed-tools": probe });
    expect(p.deny).toEqual([probe]);
    const denied = new Set(p.deny);
    const face = sessionToolFace({ skillDenial: (t) => (denied.has(t) ? "plugin:x" : null) }, { mode: "auto" });
    expect(face.tools.map((s) => s.function.name)).not.toContain(probe);
    expect(face.removed).toEqual([{ name: probe, by: "plugin:x" }]);
    expect(face.note).toContain(probe);
  });

  // 反向：放宽到"整张面"不等于"什么字符串都收"——拼错与 MCP 动态名仍要点名。
  it("拼错的名字与 MCP 动态名仍然落 unknown（申报域是两张表的并集，不是任意字符串）", () => {
    const p = skillToolPolicy({ "disallowed-tools": "spawn_agents mcp__foo__bar" });
    expect(p.deny).toEqual([]);
    expect(p.unknown).toEqual(["deny:spawn_agents", "deny:mcp__foo__bar"]);
  });

  // 防复发的那一条：病灶不是"少了一把"，是**归一函数的覆盖面会随模型面扩大而静默缩水**
  // （09-24 立案时 7 把免疫，今天 13 把——中间只是 `INJECTED_TOOLS` 长了一次）。
  // 所以判据不能手抄名字，必须枚举两张表的现值：加第 14 把注入工具而忘了申报域 ⇒ 这里红。
  it("枚举两表现值：模型面上每一把都必须可申报", () => {
    const declarable = [...TOOL_NAMES, ...INJECTED_TOOLS.map((t) => t.name)];
    const immune = declarable.filter((n) => resolveDeclaredTool(n) === null);
    expect(immune).toEqual([]);
    // 且这条用例自己不许空转：两张表今天都得有货。
    expect(TOOL_NAMES.length).toBeGreaterThan(0);
    expect(INJECTED_TOOLS.length).toBeGreaterThan(0);
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
    const before = sessionToolFace(e, { mode: "default" });
    expect(before.tools.some((s) => s.function.name === "grep")).toBe(true);
    expect(before.note).toBe(""); // 没激活 ⇒ 一个字都不该变（既有会话零回归）
    e.triggerSkill("/pol:sec", "");
    const after = sessionToolFace(e, { mode: "default" });
    const denied = "grep";
    const by = "/pol:sec";
    expect(specNames(after.tools)).toEqual(specNames(before.tools).filter((n) => n !== denied));
    // 第 105 页：名字本身不许当针脚。旧写法 `toContain("grep")` 被尺算成 35 处"副本"，其中 24 处是
    // import 路径（`./grep.js`）与别处的工具清单——一条都流不进被断言的这个 `.note`。
    // ⇒ 散文那句由下一条钉（摘除说明只有这一支会说），「摘了哪把 · 被谁摘」成对形状由变量拼出来。
    expect(after.note).toContain("从可见工具表摘除");
    expect(after.note, "说清是谁摘的：静默少工具等于让模型自己猜").toContain(denied + "（由 " + by + "）");
  });

  it("规格面与活闸同一份谓词（两份实现必漂）", () => {
    const e = rt!;
    e.triggerSkill("/pol:sec", "");
    const face = sessionToolFace(e, { mode: "default" });
    expect(face.skillDenial?.("grep")).toBe("/pol:sec");
    expect(face.skillDenial?.("read_file")).toBeNull();
    expect(face.tools.some((s) => s.function.name === "grep")).toBe(false);
  });

  it("没有插件运行时 = 规格面逐字不变（不因为接线凭空摘工具或注说明）", () => {
    const face = sessionToolFace(null, { mode: "default" });
    expect(specNames(face.tools)).toEqual(specNames(sessionToolSpecs({ mode: "default" }).specs));
    expect(face.note).toBe("");
    expect(face.skillDenial).toBeUndefined();
  });

  it("申报覆盖整个 ToolName 键域：静态十把全摘；运行时注入工具仍留着——不可申报的不假装摘得动", () => {
    const e = rt!;
    e.grantSkillScope("/pol:all", { "disallowed-tools": TOOL_NAMES.join(",") });
    const face = sessionToolFace(e, { mode: "default" });
    // 运行期注入面不属于 ToolName 键域，disallowed-tools 不能越过它；这里把当前实际注入的
    // 十一把工具逐项钉住，新增运行时工具时测试会提醒同步契约，而不是静默改变权限语义。
    expect(specNames(face.tools).sort()).toEqual([
      "automation_create",
      "automation_delete",
      "automation_list",
      "automation_run_now",
      "automation_update",
      "cancel_agents",
      "refine_goal",
      "remember",
      "spawn_agent",
      "wait_for_agents",
      "web_fetch",
    ]);
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

/* 任务 #5 的现读（outputs/cancel-asymmetry-2026-09-27/measure.mts）：#19 把申报域扩到注入面之后，
   「只禁 cancel_agents、留着 spawn_agent」成为**可达**配置；此前没有任何判据读过 `note`（摘除出声这半是无人守的）。 */
describe("能派不可撤：这一格要在派活之前说出口（任务 #5）", () => {
  const BY = "pol:strict";
  const face = (denied: string[]) => {
    const set = new Set(denied);
    return sessionToolSpecs({ mode: "auto", skillDenial: (n) => (set.has(n) ? BY : null) });
  };
  const visible = (f: ReturnType<typeof face>, name: string): boolean =>
    f.specs.some((s) => s.function.name === name);

  it("只摘撤活时注脚必须点出后果：派出去的 worker 这一轮撤不回来", () => {
    const f = face([CANCEL_AGENTS_NAME]);
    expect(visible(f, SPAWN_AGENT_NAME), "派活被一起摘掉的话这格就不成立了（见反向哨兵）").toBe(true);
    expect(visible(f, CANCEL_AGENTS_NAME)).toBe(false);
    expect(f.note).toContain("撤不回来");
    expect(f.note, "光说「撤不回来」不给出路：模型要知道剩下两条路是什么").toContain("人在面板上撤");
  });

  // 上面那条已被表里两根锚点指着（规则 402：一根锚点一个唯一指向），所以**代价那一半**另开一条。
  // 「派活前请把它当成不可撤销的开销」是这一格里模型唯一能拿来权衡的量：可达性说完，钱才是决定派不派的。
  it("注脚里那句「不可撤销的开销」要跟着后果一起给（只说撤不回＝模型没有可权衡的量）", () => {
    const stranded = face([CANCEL_AGENTS_NAME]);
    expect(stranded.note).toContain("不可撤销的开销");
    expect(stranded.note, "说了收不回，就要说清剩下那两条路的第一条").toContain("只能等它自己收敛");
  });

  // 这一条单独成立，是因为它咬的是**另一种**病：句子被搬出那道门（谁被摘都喊一声开销）。
  // 上面那条正向断言对这种病全不分辨（stranded 态里句子照在）⇒ 只有反向那一格会红。
  it("那句成本话不许逃出这道门：派活也被摘时根本没有这笔开销", () => {
    const gone = face([CANCEL_AGENTS_NAME, SPAWN_AGENT_NAME]);
    expect(gone.note, "派活也被摘 ⇒ 不许再留这句吓人的话（没东西可派就没有这笔钱）").not.toContain("不可撤销的开销");
  });

  it("反向哨兵：连派活一起摘 ⇒ 不许再喊撤不回（没东西可派，就不该有这句吓人的话）", () => {
    const f = face([CANCEL_AGENTS_NAME, SPAWN_AGENT_NAME]);
    expect(visible(f, SPAWN_AGENT_NAME)).toBe(false);
    expect(f.note).toContain(CANCEL_AGENTS_NAME + "（由 " + BY + "）"); // 摘除本身照旧要点名
    expect(f.note).not.toContain("撤不回来");
  });

  it("注脚本身有观测者：没摘任何工具时它是空串，摘了才非空（此前 tests/ 里零断言）", () => {
    expect(sessionToolSpecs({ mode: "auto", skillDenial: () => null }).note).toBe("");
    // 第 105 页的口径：名字不许当针脚 ⇒ 「摘了哪把·被谁摘」那串由变量拼
    const probe = "grep";
    expect(face([probe]).note).toContain(probe + "（由 " + BY + "）");
  });

  it("名字不许长出第二份：tool-surface 的两个常量与 tools 里的常量、注入面清单三处同源", () => {
    expect(CANCEL_AGENTS_NAME).toBe(CANCEL_AGENTS_TOOL);
    const listed = INJECTED_TOOLS.map((t) => t.name);
    expect(listed).toContain(CANCEL_AGENTS_NAME);
    expect(listed).toContain(SPAWN_AGENT_NAME);
  });
});
