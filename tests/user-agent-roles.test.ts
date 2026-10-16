// 用户自定义子智能体的**非插件**路径（目标第 8/10 条点名的能力，此前只有一半）：
// 插件容器里的 agents/*.md 早就接通（角色落流、spawn_agent 收 role、重派两半、发现面），
// 但实测「用户往 ~/.claude/agents/x.md 放一个文件得不到任何东西」⇒ 要么给正式路径，
// 要么把"角色 = 插件专属"写死成边界。这一笔给正式路径，并把边界写清楚：
//   - 用户级目录（自己的机器）= 自动可见，不需要插件那套信任决议；
//   - 项目级 `.agent/agents/`（会随仓库带来）= **刻意不做**，它需要一次信任设计（见 38/39 页备案）。
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadUserAgentRoles, USER_AGENT_SOURCES } from "../src/agent/roles/user-agents";
import { PluginRuntime } from "../src/agent/plugins";
import { gateToolSpecs } from "../src/agent/session-provider";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }).catch(() => {}); root = ""; });

/** 造一个假 home，里面按 source 各放若干 agent 文件。 */
async function homeWith(files: Record<string, string[]>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "dsh-user-agents-"));
  for (const [dir, names] of Object.entries(files)) {
    const abs = join(root, dir);
    await mkdir(abs, { recursive: true });
    for (const n of names) await writeFile(join(abs, n), "---\ndescription: 用户级角色\n---\n正文\n", "utf8");
  }
  return root;
}

const invokeNames = (roles: { name: string }[]): string[] => roles.map((r) => r.name).sort();

describe("loadUserAgentRoles：用户级 agents 目录", () => {
  it("两个来源都读，且顺序稳定（清单不随 fs 排列漂）", async () => {
    const home = await homeWith({ ".claude/agents": ["scout.md"], ".dsh/agents": ["reviewer.md"] });
    const r = await loadUserAgentRoles({ home });
    expect(invokeNames(r.roles)).toEqual(["reviewer", "scout"]);
    expect(r.warnings).toEqual([]);
    expect(r.roles.find((x) => x.name === "scout")?.description).toBe("用户级角色");
  });

  it("同名冲突：DSH 自己的目录赢，并点名被盖住的那条路径（静默覆盖=改了没生效）", async () => {
    const home = await homeWith({ ".claude/agents": ["same.md"], ".dsh/agents": ["same.md"] });
    const r = await loadUserAgentRoles({ home });
    expect(invokeNames(r.roles)).toEqual(["same"]);
    expect(r.roles.find((x) => x.name === "same")?.path).toContain(join(".dsh", "agents"));
    expect(r.warnings.join(" ")).toContain("same");
    expect(r.warnings.join(" ")).toContain(".claude");
  });

  it("两个目录都不存在 ⇒ 空集合且零警告（缺席是常态，不该吓人）", async () => {
    const r = await loadUserAgentRoles({ home: join(root || tmpdir(), "definitely-not-here-9f2c") });
    expect(r.roles).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("非 .md 文件与子目录跳过；空文件点名（不静默丢）", async () => {
    const home = await homeWith({ ".dsh/agents": ["keep.md", "notes.txt"] });
    const abs = join(home, ".dsh", "agents");
    await mkdir(join(abs, "nested"), { recursive: true });
    await writeFile(join(abs, "empty.md"), "", "utf8");
    const r = await loadUserAgentRoles({ home });
    expect(invokeNames(r.roles)).toEqual(["keep"]);
    expect(r.warnings.join(" ")).toContain("empty.md");
  });

  it("软链不跟随：目录里放一条指向外部的符号链接 ⇒ 跳过并警告（不悄悄读别人的文件）", async () => {
    const home = await homeWith({ ".dsh/agents": ["ok.md"] });
    const outside = join(home, "outside.md");
    await writeFile(outside, "---\ndescription: 外面\n---\n正文\n", "utf8");
    await symlink(outside, join(home, ".dsh", "agents", "link.md"));
    const r = await loadUserAgentRoles({ home });
    expect(invokeNames(r.roles)).toEqual(["ok"]);
    expect(r.warnings.join(" ")).toContain("link.md");
  });

  it("来源清单本身可核（防「少配一个目录还宣称全量」）", () => {
    expect(USER_AGENT_SOURCES.map((s) => s.rel)).toEqual([join(".dsh", "agents"), join(".claude", "agents")]);
    expect(USER_AGENT_SOURCES[0]!.priority).toBeLessThan(USER_AGENT_SOURCES[1]!.priority);
  });
});

describe("PluginRuntime：用户级角色与插件角色同一条查找面、同一条清单", () => {
  /** 装一个带 crew:scout 角色的插件，home 里放一个 user:reviewer。 */
  async function loaded(): Promise<PluginRuntime> {
    root = await mkdtemp(join(tmpdir(), "dsh-user-agents-rt-"));
    const proj = join(root, "plugins", "crew");
    await mkdir(join(proj, ".claude-plugin"), { recursive: true });
    await writeFile(join(proj, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "crew" }), "utf8");
    await mkdir(join(proj, "agents"), { recursive: true });
    await writeFile(join(proj, "agents", "scout.md"), "---\ndescription: 只读调研\n---\n你是调研角色。\n", "utf8");
    await mkdir(join(root, ".dsh", "agents"), { recursive: true });
    await writeFile(join(root, ".dsh", "agents", "reviewer.md"),
      "---\ndescription: 只看 diff 的评审角色\nisolation: worktree\n---\n你是评审角色。\n", "utf8");
    const rt = await PluginRuntime.load({
      projectPluginsDir: join(root, "plugins"),
      workspace: root,
      pluginDataRoot: join(root, "plugin-data"),
      trustFile: join(root, "trust.json"),
      home: root,
    });
    await rt.trustDecide("crew", true);
    return rt;
  }

  it("findAgentRole 两条来源都能命中，且形态与插件一致（编排器共用同一份映射，不另起一路）", async () => {
    const rt = await loaded();
    const user = rt.findAgentRole("user:reviewer");
    expect(user).not.toBeNull();
    expect(user?.body).toContain("评审角色");
    expect(user?.frontmatter.isolation).toBe("worktree");
    expect(rt.findAgentRole("crew:scout")?.name).toBe("scout");
    expect(rt.findAgentRole("user:nobody")).toBeNull();
  });

  it("发现面：两条来源都出现在同一份路由清单里，并写明能用作 stages[].role", async () => {
    const text = (await loaded()).routingList().text;
    expect(text).toContain("crew:scout");
    expect(text).toContain("user:reviewer");
    expect(text).toContain("可用作 pipeline stages[].role");
  });

  it("清单与查找同一个集合：列出来的角色都必须查得到（少一半 = 模型点了才被拒）", async () => {
    const rt = await loaded();
    const roleLines = rt.routingList().text.split("\n").filter((l) => l.includes("可用作 pipeline stages[].role"));
    expect(roleLines.length).toBeGreaterThanOrEqual(2);
    for (const line of roleLines) {
      const m = /^- (\S+) —/u.exec(line);
      expect(m, "角色行要以「- invoke —」开头：" + line).not.toBeNull();
      expect(rt.findAgentRole(m![1]), "清单里的 " + m![1] + " 查不到").not.toBeNull();
    }
  });

  it("装载期的问题要能在快照警告里看到（面板那一侧有出口，不是只进内存）", async () => {
    const rt = await loaded();
    await writeFile(join(root, ".dsh", "agents", "empty.md"), "", "utf8");
    const again = await PluginRuntime.load({
      projectPluginsDir: join(root, "plugins"), workspace: root,
      pluginDataRoot: join(root, "plugin-data"), trustFile: join(root, "trust.json"), home: root,
    });
    expect(again.snapshot().warnings.filter((w) => w.message.includes("empty.md")).map((w) => w.plugin))
      .toEqual(["user-agents"]);
  });
});

// 模型手里那份**说明文字**也要认得 `user:`：清单列得出名字，而工具参数的描述只说 plugin: 形态，
// 等于告诉模型「这个参数不接受用户级角色」——同一件事两处口径必漂（本次落地实测抓到的半边）。
describe("模型可见的角色口径（spawn_agent 参数描述）", () => {
  it("role 描述同时点名两种形态，且未注册即拒这句还在", () => {
    const spec = gateToolSpecs().find((s) => s.function.name === "spawn_agent");
    expect(spec, "spawn_agent 规格得在模型面上").toBeTruthy();
    const props = (spec!.function.parameters as { properties?: Record<string, { description?: string }> }).properties;
    expect(props?.role, "role 参数得在规格里").toBeTruthy();
    const desc = String(props!.role.description);
    expect(desc).toContain("plugin:");
    expect(desc, "只说 plugin: ⇒ 用户级角色对模型不可用（清单有、说明没有）").toContain("user:");
    expect(desc).toContain("未注册");
  });
});
