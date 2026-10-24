// 外部声明式来源（opencode / pi）导入：技能、命令、agent 角色走与容器插件同一套解析与信任门。
// 判据分两类：
//   · 正例：真目录布局能被读成条目（skills/commands/agents 各自一项，frontmatter 原样保留）；
//   · 反例/边界：主 agent、无法忠实映射的 permission/tools 白名单必须**跳过并出声**，
//     不能按比申报更宽的工具面导入；代码插件目录不导入但要提醒；指纹只绑定被导入的目录。
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPlugins, PluginRuntime } from "../src/agent/plugins";
import { pluginFingerprintSubsetEx } from "../src/agent/plugins/trust";
import { resolvePluginRole } from "../src/agent/sequencer";
import type { ForeignSource } from "../src/agent/plugins/types";

const dirs: string[] = [];

async function ws(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "cairn-foreign-"));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function put(root: string, rel: string, text: string): Promise<void> {
  const abs = join(root, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, text, "utf8");
}

const ocSource = (root: string): ForeignSource => ({ kind: "opencode", root, scope: "project", name: "opencode-project" });
const piSource = (root: string): ForeignSource => ({ kind: "pi", root, scope: "project", name: "pi-project" });

describe("外部声明式来源：opencode", () => {
  it("skills / command / agent 三类都导入，agent 的白名单工具名翻译成本仓名字", async () => {
    const root = await ws();
    await put(root, ".opencode/skills/effect/SKILL.md", "---\nname: effect\ndescription: Work with Effect\n---\n# Effect\n");
    await put(root, ".opencode/command/commit.md", "---\ndescription: git commit and push\nagent: build\n---\ncommit $ARGUMENTS\n");
    await put(root, ".opencode/agent/reviewer.md",
      "---\ndescription: Reviews code\nmode: subagent\nmodel: anthropic/claude-sonnet-5-5\ntools:\n  \"*\": false\n  read: true\n  grep: true\n---\nYou review code.\n");

    const m = await discoverPlugins({ foreignSources: [ocSource(join(root, ".opencode"))], trustStatus: () => "pending" });
    const p = m.plugins.find((x) => x.name === "opencode-project");
    expect(p).toBeDefined();
    expect(p!.scope).toBe("project");
    expect(p!.trust).toBe("pending");
    expect(p!.skills.map((s) => s.name)).toEqual(["effect"]);
    expect(p!.commands.map((c) => c.name)).toEqual(["commit"]);
    const reviewer = p!.agents.find((a) => a.name === "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer!.frontmatter.model).toBe("anthropic/claude-sonnet-5-5");
    expect(reviewer!.frontmatter.mode).toBeUndefined();
    expect(reviewer!.frontmatter.tools).toEqual(["read_file", "grep"]);
    // 归一化后的角色必须能被执行端直接采纳：没有未知键警告，工具白名单落到 resolvePluginRole
    const role = resolvePluginRole({ name: reviewer!.name, body: reviewer!.body, frontmatter: reviewer!.frontmatter });
    expect(role.tools).toEqual(["read_file", "grep"]);
    expect(role.warnings).toEqual([]);
    // command 的 opencode 专有字段没映射，必须出声（装载收下、执行端不读而不吭声 = 假承诺）
    expect(m.warnings.some((w) => w.message.includes("agent/model/subtask") || w.message.includes("agent") && w.message.includes("不映射"))).toBe(true);
    expect(m.roots?.foreignSources?.map((s) => s.name)).toEqual(["opencode-project"]);
  });

  it("mode: primary 跳过；permission 能忠实收窄时映射成 disallowedTools", async () => {
    const root = await ws();
    await put(root, ".opencode/skills/s/SKILL.md", "---\nname: s\ndescription: d\n---\nbody\n");
    await put(root, ".opencode/agent/triage.md", "---\nmode: primary\ntools:\n  \"*\": false\n---\ntriage\n");
    await put(root, ".opencode/agent/gated.md", "---\nmode: subagent\npermission:\n  edit: deny\n  bash: ask\n---\ngated\n");
    const m = await discoverPlugins({ foreignSources: [ocSource(join(root, ".opencode"))], trustStatus: () => "trusted" });
    const p = m.plugins[0]!;
    expect(p.agents.map((a) => a.name)).toEqual(["gated"]);
    expect(p.agents[0]!.frontmatter.permission).toBeUndefined();
    expect(p.agents[0]!.frontmatter.disallowedTools).toEqual(["edit_file", "run_shell"]);
    expect(m.warnings.some((w) => w.message.includes("主 agent"))).toBe(true);
    expect(m.warnings.some((w) => w.message.includes("已映射为 disallowedTools"))).toBe(true);
    // ask 按 deny 收窄：映射后的角色能被执行端直接采纳
    const role = resolvePluginRole({ name: "gated", body: p.agents[0]!.body, frontmatter: p.agents[0]!.frontmatter });
    expect(role.disallowedTools).toEqual(["edit_file", "run_shell"]);
  });

  it("无法忠实映射的 permission（通配 deny / pattern 规则）⇒ 跳过并出声", async () => {
    const root = await ws();
    await put(root, ".opencode/skills/s/SKILL.md", "---\nname: s\ndescription: d\n---\nbody\n");
    await put(root, ".opencode/agent/all-deny.md", "---\nmode: subagent\npermission:\n  \"*\": deny\n---\nbody\n");
    const m = await discoverPlugins({ foreignSources: [ocSource(join(root, ".opencode"))], trustStatus: () => "trusted" });
    expect(m.plugins[0]!.agents).toEqual([]);
    expect(m.warnings.some((w) => w.message.includes("对全部工具 deny/ask"))).toBe(true);
  });

  it("白名单里含本仓没有的工具 ⇒ 跳过该角色，不静默放宽", async () => {
    const root = await ws();
    await put(root, ".opencode/skills/s/SKILL.md", "---\nname: s\ndescription: d\n---\nbody\n");
    await put(root, ".opencode/agent/tasky.md", "---\nmode: subagent\ntools:\n  \"*\": false\n  task: true\n---\nbody\n");
    const m = await discoverPlugins({ foreignSources: [ocSource(join(root, ".opencode"))], trustStatus: () => "trusted" });
    expect(m.plugins[0]!.agents).toEqual([]);
    expect(m.warnings.some((w) => w.message.includes("本仓没有的工具") && w.message.includes("task"))).toBe(true);
  });

  it("代码插件目录不导入，但必须提醒（声明式层的能力边界）", async () => {
    const root = await ws();
    await put(root, ".opencode/skills/s/SKILL.md", "---\nname: s\ndescription: d\n---\nbody\n");
    await put(root, ".opencode/plugins/hook.ts", "export const Plugin = async () => ({});\n");
    const m = await discoverPlugins({ foreignSources: [ocSource(join(root, ".opencode"))], trustStatus: () => "trusted" });
    expect(m.warnings.some((w) => w.message.includes("plugins/") && w.message.includes("不包含进程内代码插件"))).toBe(true);
  });
});

describe("外部声明式来源：pi", () => {
  it("skills / prompts 导入；不支持的 ${1:-默认} 语法出声", async () => {
    const root = await ws();
    await put(root, ".pi/skills/release/SKILL.md", "---\nname: release\ndescription: Release pi\n---\nbody\n");
    await put(root, ".pi/prompts/review.md", "---\ndescription: Review changes\n---\nFocus ${1:-correctness} and ${@:2}.\n");
    const m = await discoverPlugins({ foreignSources: [piSource(join(root, ".pi"))], trustStatus: () => "pending" });
    const p = m.plugins.find((x) => x.name === "pi-project");
    expect(p).toBeDefined();
    expect(p!.skills.map((s) => s.name)).toEqual(["release"]);
    expect(p!.commands.map((c) => c.name)).toEqual(["review"]);
    expect(p!.agents).toEqual([]);
    expect(m.warnings.some((w) => w.message.includes("${1:-默认}"))).toBe(true);
  });

  it("用户级来源恒 trusted；目录不存在 = 不产条目", async () => {
    const root = await ws();
    await put(root, ".pi/skills/s/SKILL.md", "---\nname: s\ndescription: d\n---\nbody\n");
    const user: ForeignSource = { kind: "pi", root: join(root, ".pi"), scope: "user", name: "pi-user" };
    const m = await discoverPlugins({ foreignSources: [user], trustStatus: () => "pending" });
    expect(m.plugins[0]!.trust).toBe("trusted");

    const empty = await discoverPlugins({ foreignSources: [piSource(join(root, "nope"))], trustStatus: () => "pending" });
    expect(empty.plugins).toEqual([]);
    expect(empty.errors).toEqual([]);
  });
});

describe("装配层接线", () => {
  it("PluginRuntime.load 默认扫描项目级 .opencode / .pi（不是只有 discover 能收参数）", async () => {
    const workspace = await ws();
    await put(workspace, ".opencode/skills/oc/SKILL.md", "---\nname: oc\ndescription: d\n---\nbody\n");
    await put(workspace, ".pi/skills/pi-s/SKILL.md", "---\nname: pi-s\ndescription: d\n---\nbody\n");
    const rt = await PluginRuntime.load({
      workspace,
      projectSkillsDir: "",
      pluginDataRoot: join(workspace, "data"),
      home: join(workspace, "home"),
    });
    try {
      const names = rt.manifest.plugins.map((p) => p.name);
      expect(names).toContain("opencode-project");
      expect(names).toContain("pi-project");
    } finally {
      await rt.shutdown();
    }
  });

  it("显式 foreignSources: [] 关掉外部导入", async () => {
    const workspace = await ws();
    await put(workspace, ".opencode/skills/oc/SKILL.md", "---\nname: oc\ndescription: d\n---\nbody\n");
    const rt = await PluginRuntime.load({
      workspace,
      projectSkillsDir: "",
      pluginDataRoot: join(workspace, "data"),
      home: join(workspace, "home"),
      foreignSources: [],
    });
    try {
      expect(rt.manifest.plugins).toEqual([]);
    } finally {
      await rt.shutdown();
    }
  });
});

describe("外部来源的信任指纹", () => {
  it("只绑定被导入的目录：改代码插件不动指纹，改 skill 正文才动", async () => {
    const root = await ws();
    await put(root, ".opencode/skills/s/SKILL.md", "---\nname: s\ndescription: d\n---\nbody\n");
    await put(root, ".opencode/plugins/hook.ts", "v1\n");
    const first = await pluginFingerprintSubsetEx(join(root, ".opencode"), ["skills"]);
    await put(root, ".opencode/plugins/hook.ts", "v2\n");
    const afterCode = await pluginFingerprintSubsetEx(join(root, ".opencode"), ["skills"]);
    expect(afterCode.fp).toBe(first.fp);
    await put(root, ".opencode/skills/s/SKILL.md", "---\nname: s\ndescription: d2\n---\nbody\n");
    const afterSkill = await pluginFingerprintSubsetEx(join(root, ".opencode"), ["skills"]);
    expect(afterSkill.fp).not.toBe(first.fp);
  });

  it("软链让指纹 bounded（fail-closed = 不可批准）", async () => {
    const root = await ws();
    await put(root, ".opencode/skills/s/SKILL.md", "---\nname: s\ndescription: d\n---\nbody\n");
    await symlink("/etc/hosts", join(root, ".opencode/skills/s/link"));
    const fp = await pluginFingerprintSubsetEx(join(root, ".opencode"), ["skills"]);
    expect(fp.bounded).toBe(true);
  });
});
