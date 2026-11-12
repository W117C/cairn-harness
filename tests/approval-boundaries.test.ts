import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { alwaysRulesPath } from "../src/permissions/rules";
import { judgeChain, rememberDecision, scopeKey, staticRisk, type PermissionRule } from "../src/permissions";
import { SettingsStore } from "../src/main/settings";

describe("approval boundaries", () => {
  it("lets project policy restrict tools, while grants require a trusted source", () => {
    const project: PermissionRule = { tool: "write_file", behavior: "allow", scope: "always", layer: "project" };
    expect(judgeChain([project], "write_file")).toEqual({ verdict: "miss" });
    expect(judgeChain([{ ...project, behavior: "ask" }], "write_file").verdict).toBe("ask");
    expect(judgeChain([{ ...project, behavior: "deny" }], "write_file").verdict).toBe("deny");
    expect(judgeChain([{ ...project, layer: "global" }], "write_file").verdict).toBe("allow");
  });

  it("keeps a matching ask across unmatched segments, with deny still taking priority", () => {
    const ask: PermissionRule = { tool: "run_shell", behavior: "ask", pattern: "echo first", scope: "always", id: "first" };
    const deny: PermissionRule = { ...ask, behavior: "deny", pattern: "echo last", id: "last" };
    expect(judgeChain([ask], "run_shell", "echo first && echo second")).toMatchObject({ verdict: "ask", ruleId: "first" });
    expect(judgeChain([ask, deny], "run_shell", "echo first && echo second && echo last")).toMatchObject({ verdict: "deny", ruleId: "last" });
  });

  it("keeps distinct quoted arguments separate in shell session approvals", () => {
    const command = "echo 'hello world'";
    const key = scopeKey("run_shell", { command });
    expect(scopeKey("run_shell", { command })).toBe(key);
    expect(scopeKey("run_shell", { command: "echo 'hello  world'" })).not.toBe(key);
    expect(scopeKey("shell_rw", { command })).not.toBe(key);
  });

  it.each(["default", "guided", "auto"] as const)("requires consent for global memory in %s", (mode) => {
    expect(rememberDecision({ scope: "global", mode, isPlanBlocked: () => false })).toBe("ask");
    expect(rememberDecision({ scope: "project", mode, isPlanBlocked: () => false })).toBe("allow");
    expect(rememberDecision({ scope: "global", mode, isPlanBlocked: () => true })).toBe("deny");
  });

  it("stores remembered grants outside the checkout and separates workspaces", async () => {
    const dir = await mkdtemp(join(tmpdir(), "approval-boundaries-"));
    try {
      const appData = join(dir, "appdata");
      const workspace = join(dir, "workspace");
      const another = join(dir, "another");
      await Promise.all([appData, workspace, another].map((path) => mkdir(path)));
      const first = alwaysRulesPath(workspace, appData);
      expect(relative(appData, first)).not.toMatch(/^\.\./);
      expect(alwaysRulesPath(workspace + "/.", appData)).toBe(first);
      expect(alwaysRulesPath(another, appData)).not.toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("classifies an entire structured path, including whitespace in file names", () => {
    expect(staticRisk("read_file", { path: ".git/hooks/ sample" }).level).toBe("high");
    expect(staticRisk("read_file", { path: "docs/hello world.md" }).level).toBe("none");
  });

  it("accepts the web approval preference only from host settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "web-approval-settings-"));
    try {
      const path = join(dir, "settings.json");
      await writeFile(path, JSON.stringify({ webAutoApprove: true }));
      expect(await new SettingsStore(path, "host").webAutoApproveForRun()).toBe(true);
      expect(await new SettingsStore(path, "workspace").webAutoApproveForRun()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
