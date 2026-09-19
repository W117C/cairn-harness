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
