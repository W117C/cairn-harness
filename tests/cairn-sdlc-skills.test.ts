import { cp, mkdtemp, mkdir, readFile, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PluginRuntime, expandSkillInvocation, parseFrontmatter } from "../src/agent/plugins";

const names = ["cairn-gates", "cairn-verify"] as const;

async function fixture(selected: readonly string[] = names) {
  const workspace = await mkdtemp(join(tmpdir(), "cairn-sdlc-skills-"));
  // F2 余项：信任表不得落工作区 ⇒ 夹具配一个工作区外的信任目录，dispose 一并清尾。
  const trustDir = await mkdtemp(join(tmpdir(), "cairn-sdlc-trust-"));
  const plugins = join(workspace, ".agent", "plugins");
  const runtimes: PluginRuntime[] = [];
  try {
    await mkdir(plugins, { recursive: true });
    for (const name of selected) {
      await cp(join(process.cwd(), ".agent", "plugins", name), join(plugins, name), { recursive: true });
    }
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
  return {
    workspace,
    plugins,
    async load(trustFile = join(trustDir, "trust.json")) {
      const runtime = await PluginRuntime.load({
        workspace,
        projectPluginsDir: plugins,
        projectSkillsDir: "",
        foreignSources: [],
        home: join(workspace, "home"),
        pluginDataRoot: join(workspace, "data"),
        trustFile,
      });
      runtimes.push(runtime);
      return runtime;
    },
    async dispose() {
      for (const runtime of runtimes) await runtime.shutdown();
      await rm(trustDir, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    },
  };
}

describe("Cairn SDLC skills through the project discovery and trust path", () => {
  it.each(names)("%s requires trust, routes, and delivers its complete body on both invocation faces", async (name) => {
    const f = await fixture([name]);
    try {
      const runtime = await f.load();
      expect(runtime.snapshot().looseSkills.map((skill) => skill.name)).toEqual([name]);
      expect(runtime.snapshot().looseSkills.every((skill) => skill.trust === "pending")).toBe(true);
      expect(runtime.skills()).toHaveLength(0);
      expect(runtime.triggerSkill("/" + name).ok).toBe(false);
      expect(expandSkillInvocation(runtime.skills(), "/" + name).hit).toBeNull();

      expect(await runtime.trustDecide(name, true)).toBe(true);
      expect(runtime.routingList("Cairn 验证 门禁 test build").text).toContain("/" + name);
      const source = await readFile(join(f.plugins, name, "SKILL.md"), "utf8");
      const { frontmatter, body } = parseFrontmatter(source);
      expect(frontmatter["name"]).toBe(name);
      expect(typeof frontmatter["description"]).toBe("string");
      expect(String(frontmatter["description"] ?? "").trim().length).toBeGreaterThan(0);
      const triggered = runtime.triggerSkill("/" + name);
      expect(triggered.ok).toBe(true);
      expect(triggered.output).toContain(body.trim());
      const user = expandSkillInvocation(runtime.skills(), "/" + name + " docs-only", undefined, f.workspace);
      expect(user.hit).toEqual({ invoke: "/" + name, args: "docs-only" });
      expect(user.text).toContain(body.trim());

      const reloaded = await f.load();
      expect(reloaded.triggerSkill("/" + name).ok).toBe(true);
    } finally {
      await f.dispose();
    }
  });

  it("content changes invalidate trust, and a second clone starts pending", async () => {
    const f = await fixture();
    const other = await fixture();
    try {
      const runtime = await f.load();
      for (const name of names) expect(await runtime.trustDecide(name, true)).toBe(true);
      await appendFile(join(f.plugins, "cairn-verify", "SKILL.md"), "\nChanged content for the trust regression.\n");
      const reloaded = await f.load();
      expect(reloaded.triggerSkill("/cairn-verify").ok).toBe(false);
      expect(reloaded.snapshot().looseSkills.find((skill) => skill.name === "cairn-verify")?.trust).toBe("pending");
      expect(reloaded.triggerSkill("/cairn-gates").ok).toBe(true);
      const clone = await other.load(join(f.workspace, "trust.json"));
      expect(clone.skills()).toHaveLength(0);
      expect(clone.snapshot().looseSkills.map((skill) => skill.name).sort()).toEqual([...names]);
      expect(clone.snapshot().looseSkills.every((skill) => skill.trust === "pending")).toBe(true);
    } finally {
      await f.dispose();
      await other.dispose();
    }
  });
});
