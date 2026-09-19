// skill 的模型可见面与可执行面必须同源（§9.3：路由清单 = name + description(+when_to_use)；
// disable-model-invocation / user-invocable 语义照 CC）。
// ⚠️ 两条面一起测，是因为只测清单那一跳会放过最坏的一种半接：名字藏起来了、
// 模型猜得到就照样能触发（本仓反复出现的「模型看不见 ≠ 执行端挡住了」）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSkillRoutingList, skillRoutingLine } from "../src/agent/plugins";
import { PluginRuntime } from "../src/agent/plugins";

describe("路由清单行（§9.3 渐进披露）", () => {
  it("when_to_use 在场时并入同一行：模型据此判断何时触发，而不只是知道有个 skill", () => {
    const line = skillRoutingLine({
      plugin: "p", name: "lint", description: "跑 lint 的清单。",
      frontmatter: { when_to_use: "改完任何 .ts 之后" },
    });
    expect(line).toContain("/p:lint");
    expect(line).toContain("跑 lint 的清单。");
    expect(line).toContain("改完任何 .ts 之后");
  });

  it("没有 when_to_use ⇒ 逐字保持既有行（零回归：不加空括号）", () => {
    expect(skillRoutingLine({ plugin: "p", name: "lint", description: "跑 lint。", frontmatter: {} }))
      .toBe("- /p:lint — 跑 lint。");
    expect(skillRoutingLine({ plugin: null, name: "loose", description: "" })).toBe("- /loose");
  });

  it("disable-model-invocation 的 skill 不进清单；不声明的照常进（布尔与字符串两种写法同效）", () => {
    const list = buildSkillRoutingList([
      { plugin: "p", name: "auto", description: "可自动路由", frontmatter: {} },
      { plugin: "p", name: "hidden", description: "只有用户能点", frontmatter: { "disable-model-invocation": true } },
      { plugin: "p", name: "hidden2", description: "字符串写法", frontmatter: { "disable-model-invocation": "true" } },
    ]);
    expect(list.text).toContain("/p:auto");
    expect(list.text).not.toContain("/p:hidden");
    expect(list.text).not.toContain("/p:hidden2");
  });
});

describe("清单挡住 ⇒ 执行端也得挡住（同一次装载的 runtime）", () => {
  let dir: string;
  let rt: PluginRuntime | null = null;

  const skillFile = (plugin: string, name: string, frontmatter: string, body: string): Promise<unknown> =>
    mkdir(join(dir, "user-plugins", plugin, "skills", name), { recursive: true })
      .then(() => writeFile(join(dir, "user-plugins", plugin, "skills", name, "SKILL.md"),
        "---\nname: " + name + "\ndescription: " + name + " 说明。\n" + frontmatter + "---\n" + body + "\n", "utf8"));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-skill-faces-"));
    await mkdir(join(dir, "user-plugins", "crew", ".claude-plugin"), { recursive: true });
    await writeFile(join(dir, "user-plugins", "crew", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "crew", description: "skill 双面判据", version: "0.1.0" }), "utf8");
    await skillFile("crew", "auto", "", "自动可路由的正文");
    await skillFile("crew", "quiet", "disable-model-invocation: true\n", "只给用户的正文");
    rt = await PluginRuntime.load({
      userPluginsDir: join(dir, "user-plugins"),
      projectPluginsDir: join(dir, "no-project-plugins"),
      workspace: dir,
      pluginDataRoot: join(dir, "plugin-data"),
    });
  });

  afterEach(async () => {
    await rt?.shutdown();
    rt = null;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("装载后两个 skill 都在（面板口径），但清单里只有可模型触发的那个", () => {
    const e = rt!;
    expect(e.skills().map((s) => s.name).sort()).toEqual(["auto", "quiet"]);
    const routing = e.routingList().text;
    expect(routing).toContain("/crew:auto");
    expect(routing).not.toContain("/crew:quiet");
  });

  it("模型硬猜被藏起来的名字 ⇒ triggerSkill 明确拒绝并给出原因（不静默放行全文）", () => {
    const e = rt!;
    const r = e.triggerSkill("/crew:quiet");
    expect(r.ok).toBe(false);
    expect(r.output).toContain("disable-model-invocation");
    expect(r.output).not.toContain("只给用户的正文");
  });

  it("未声明该字段的 skill 触发照常返回全文（零回归）", () => {
    const r = rt!.triggerSkill("/crew:auto");
    expect(r.ok).toBe(true);
    expect(r.output).toContain("自动可路由的正文");
  });
});

// §9.3 参数替换：正文里的 $ARGUMENTS / $1 / $name 与 ${SKILL_DIR} 一族此前**一个字都没换过**
// （triggerSkill 连 args 通道都没有）。判据全部走真装载的 runtime——替换器本体的单测在
// plugins-skills，那一层证明不了「触发这条路上有人调用它」。
describe("skill 正文的参数与变量替换（§9.3）", () => {
  let dir: string;
  let rt: PluginRuntime | null = null;

  const skillFile = async (plugin: string, name: string, frontmatter: string, body: string): Promise<void> => {
    await mkdir(join(dir, "user-plugins", plugin, "skills", name), { recursive: true });
    await writeFile(join(dir, "user-plugins", plugin, "skills", name, "SKILL.md"),
      "---\nname: " + name + "\ndescription: " + name + " 说明。\n" + frontmatter + "---\n" + body + "\n", "utf8");
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-skill-args-"));
    await mkdir(join(dir, "user-plugins", "crew", ".claude-plugin"), { recursive: true });
    await writeFile(join(dir, "user-plugins", "crew", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "crew", description: "参数替换判据", version: "0.1.0" }), "utf8");
    await skillFile("crew", "greet", "", "对 $ARGUMENTS 问好：$1 / 缺位 [$9] 结束");
    await skillFile("crew", "deploy", "arguments: env, port\n", "把 $env 部署到 $port；裸变量 ${SKILL_DIR} ${PLUGIN_ROOT} ${PLUGIN_DATA} ${PROJECT_DIR} ${SESSION_ID}");
    await mkdir(join(dir, "loose", "bare"), { recursive: true });
    await writeFile(join(dir, "loose", "bare", "SKILL.md"),
      "---\nname: bare\ndescription: 散装 skill。\n---\n没有插件根：${PLUGIN_ROOT}\n", "utf8");
    rt = await PluginRuntime.load({
      userPluginsDir: join(dir, "user-plugins"),
      looseRoots: [join(dir, "loose")],
      projectPluginsDir: join(dir, "no-project-plugins"),
      workspace: dir,
      pluginDataRoot: join(dir, "plugin-data"),
      sessionId: "sess-7",
    });
  });

  afterEach(async () => {
    await rt?.shutdown();
    rt = null;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("带 args 触发 ⇒ $ARGUMENTS 与 $1 换成实参，缺位的 $9 落成空串（不留裸变量给模型）", () => {
    const r = rt!.triggerSkill("/crew:greet", "张三 李四");
    expect(r.ok).toBe(true);
    expect(r.output).toContain("对 张三 李四 问好：张三 / 缺位 [] 结束");
    expect(r.output).not.toContain("$ARGUMENTS");
    expect(r.output).not.toContain("$1");
  });

  it("frontmatter arguments 声明过的 $name 按声明序吃位置参数", () => {
    const r = rt!.triggerSkill("/crew:deploy", "生产 8080");
    expect(r.output).toContain("把 生产 部署到 8080；");
  });

  it("五个 ${} 变量展开成这次装载的真实路径与会话 id", () => {
    const r = rt!.triggerSkill("/crew:deploy", "dev 1");
    expect(r.output).toContain("裸变量 "
      + join(dir, "user-plugins", "crew", "skills", "deploy") + " "
      + join(dir, "user-plugins", "crew") + " "
      + join(dir, "plugin-data", "crew") + " "
      + dir + " sess-7");
    expect(r.output).not.toContain("${");
  });

  it("散装 skill 没有插件根 ⇒ ${PLUGIN_ROOT} 原样留着（不填一个看起来像路径的空值）", () => {
    const r = rt!.triggerSkill("/bare");
    expect(r.ok).toBe(true);
    expect(r.output).toContain("没有插件根：${PLUGIN_ROOT}");
  });

  it("压缩后重挂重放当年那次调用的参数 ⇒ 同一 skill 两次进上下文内容一致", () => {
    const events = [
      { type: "user_message", content: "hi" },
      { type: "tool_call", id: "c1", name: "skill", args: { name: "/crew:deploy", args: "预发 9090" } },
      { type: "tool_result", callId: "c1", ok: true, output: "…" },
      { type: "compaction", ts: Date.now(), compressed_event_ids: [3], summary_offset: 0, tokens_before: 100, tokens_after: 10 },
    ] as never;
    const remounted = rt!.remountFromEvents(events);
    expect(remounted.mounted).toContain("/crew:deploy");
    expect(remounted.text).toContain("把 预发 部署到 9090；");
    expect(remounted.text).not.toContain("$env");
  });
});
