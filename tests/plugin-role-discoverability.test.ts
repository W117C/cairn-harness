// 自定义子智能体（插件 agent 角色）能不能被「发现」与「如实报错」。
//
// 起因（2026-09-22）：`pipeline.stages[].role` 收自由字符串，内置只有 implement/review/test，
// 自定义角色只能写成 `plugin-name:agent-name`；而**没有任何地方**告诉模型注册了哪些角色
// （skill 有 routingList，角色没有）⇒ 「用户自定义子智能体」实际要靠猜名字，
// 猜错的唯一反馈是 spawn 被拒。同时 §9.6 里 CC 有而我们执行端不读的字段
// （effort/skills/memory/background）与笔误键（disallowed_tools）此前**一声不吭**——
// 「装载收下、执行端不读」是本仓反复出现的形状，而笔误键静默失效等于工具面静默变宽。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginRuntime } from "../src/agent/plugins";
import { buildSkillRoutingList, SKILL_ROUTING_CHAR_LIMIT } from "../src/agent/plugins/skills";
import { resolvePluginRole, PLUGIN_ROLE_CONSUMED_KEYS } from "../src/agent/sequencer";

describe("resolvePluginRole：不读的字段必须吭声", () => {
  it("只写合法键 ⇒ 零警告（反控：不许用「什么都警告」蒙过这条）", () => {
    const r = resolvePluginRole({
      name: "scout", body: "读代码",
      frontmatter: { description: "只读调研", isolation: "worktree", tools: "read_file", maxTurns: 12, model: "cheap" },
    });
    expect(r.warnings).toEqual([]);
    expect(r.mode).toBe("write"); // isolation:worktree → write（§4.4.5 同构）
  });

  it("CC 有、执行端没有面的字段：警告说清「采纳未落地」", () => {
    for (const key of ["effort", "skills", "memory", "background"]) {
      const r = resolvePluginRole({ name: "a", body: "b", frontmatter: { [key]: "x" } });
      expect(r.warnings, key + " 不该静默被吃").toHaveLength(1);
      expect(r.warnings[0]).toContain(key);
      expect(r.warnings[0]).toContain("§9.6");
    }
  });

  it("安全约束那三件仍按原口径警告（本次改动不许把它们并入普通未知键）", () => {
    const r = resolvePluginRole({ name: "a", body: "b", frontmatter: { hooks: "x", permissionMode: "bypassPermissions" } });
    expect(r.warnings.filter((w) => w.includes("CC 安全约束"))).toHaveLength(2);
  });

  it("笔误键必须点名合法键集：disallowed_tools 静默失效 = 工具面静默变宽", () => {
    const r = resolvePluginRole({ name: "a", body: "b", frontmatter: { disallowed_tools: ["run_shell"] } });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("disallowed_tools");
    for (const k of ["tools", "disallowedTools", "maxTurns"]) {
      expect(r.warnings[0], "未知键的提示要给出对照的合法键 " + k).toContain(k);
    }
    // 关键：它没被当成 disallowedTools 采纳（不读就是不读，别假装生效）
    expect(r.disallowedTools).toBeUndefined();
  });

  it("合法键清单与警告文案同源（加一个读面忘了进清单 ⇒ 自己的字段被判成未知）", () => {
    const fm: Record<string, unknown> = { isolation: "worktree" };
    for (const k of PLUGIN_ROLE_CONSUMED_KEYS) if (fm[k] === undefined) fm[k] = k === "maxTurns" ? 4 : "x";
    expect(resolvePluginRole({ name: "a", body: "b", frontmatter: fm }).warnings).toEqual([]);
  });
});

describe("路由清单把插件 agent 角色一起列给模型（发现面）", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); dir = ""; });

  /** 建一个带 skill + 两个 agent 角色的插件并装载；trust=false 时不过信任门。 */
  async function load(trust = true): Promise<PluginRuntime> {
    dir = await mkdtemp(join(tmpdir(), "dsh-role-list-"));
    const proj = join(dir, "plugins", "crew");
    await mkdir(join(proj, ".claude-plugin"), { recursive: true });
    await writeFile(join(proj, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "crew" }), "utf8");
    await mkdir(join(proj, "agents"), { recursive: true });
    await writeFile(join(proj, "agents", "scout.md"),
      "---\ndescription: 只读调研，先看调用点再动笔。\n---\n你是调研角色。\n", "utf8");
    await writeFile(join(proj, "agents", "no-desc.md"), "---\nisolation: worktree\n---\n没有描述的角色。\n", "utf8");
    await mkdir(join(proj, "skills", "greeter"), { recursive: true });
    await writeFile(join(proj, "skills", "greeter", "SKILL.md"),
      "---\nname: greeter\ndescription: 打招呼。\n---\n正文\n", "utf8");
    const rt = await PluginRuntime.load({
      projectPluginsDir: join(dir, "plugins"),
      workspace: dir,
      pluginDataRoot: join(dir, "plugin-data"),
      trustFile: join(dir, "trust.json"),
    });
    if (trust) await rt.trustDecide("crew", true);
    return rt;
  }

  it("受信的 plugin:agent 进清单，且写明这是 stages[].role 能吃的名字", async () => {
    const rt = await load();
    try {
      const text = rt.routingList().text;
      expect(text).toContain("crew:scout");
      expect(text).toContain("只读调研，先看调用点再动笔。");
      expect(text).toContain("stages[].role");
      // 没写 description 的也要列出来（否则它永远不可能被发现），并如实说没有描述
      expect(text).toContain("crew:no-desc");
      // skill 那半边不回归
      expect(text).toContain("greeter");
    } finally { await rt.shutdown(); }
  });

  it("未信任插件的角色不进清单（信任门与 findAgentRole 同口径，不给半开的面）", async () => {
    const rt = await load(false);
    try {
      expect(rt.routingList().text).not.toContain("crew:scout");
      expect(rt.findAgentRole("crew:scout")).toBeNull();
    } finally { await rt.shutdown(); }
  });

  it("清单与 skill 共用同一份预算：超限时角色行也不会被静默丢掉（truncated 必须为真）", async () => {
    const fat = Array.from({ length: 30 }, (_, i) => ({
      name: "s" + String(i), invoke: "/s" + String(i), description: "x".repeat(120),
      frontmatter: {}, body: "", plugin: "p", path: "/p", triggerEventId: 0, seq: i,
    }));
    const r = buildSkillRoutingList(fat as never, ["- crew:scout — 只读调研（可用作 pipeline stages[].role）"]);
    expect(r.text.length).toBeLessThanOrEqual(SKILL_ROUTING_CHAR_LIMIT);
    expect(r.truncated).toBe(true);
    // 截断标记不许再自称「skill 清单」——被截掉的可能正是角色那一条
    expect(r.text).toContain("[清单超 ");
  });
});
