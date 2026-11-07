import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SubagentSettings } from "../src/main/subagent-settings";
import { loadUserAgentRoles } from "../src/agent/roles/user-agents";

it("writes roles through the existing runtime loader and rejects stale edits", async () => {
  const home = await mkdtemp(join(tmpdir(), "cairn-roles-"));
  try {
    const settings = new SubagentSettings(home);
    const markdown = '---\ndescription: Audit changes\nmaxTurns: 8\n---\nReport regressions.';
    await settings.save("audit.md", markdown, null);
    const role = (await loadUserAgentRoles({ home })).roles[0];
    expect(role).toMatchObject({ name: "audit", description: "Audit changes", body: "Report regressions." });
    const draft = await settings.read("audit.md");
    await settings.save("audit.md", markdown + "\nUse fixtures.", draft.revision);
    await expect(settings.save("audit.md", "Old draft", draft.revision)).rejects.toThrow("重新载入");
    await expect(settings.remove("audit.md", draft.revision)).rejects.toThrow("重新载入");
    await settings.remove("audit.md", (await settings.read("audit.md")).revision);
    expect((await loadUserAgentRoles({ home })).roles).toEqual([]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("lists compatible roles read-only and keeps writes inside the native directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "cairn-roles-"));
  try {
    const external = join(home, ".claude", "agents");
    await mkdir(external, { recursive: true });
    await writeFile(join(external, "review.md"), "Read-only review");
    const settings = new SubagentSettings(home);
    expect((await settings.list()).roles).toContainEqual(expect.objectContaining({ invoke: "user:review", source: "claude" }));
    await expect(settings.save("../review.md", "unsafe", null)).rejects.toThrow();
    await symlink(join(home, ".claude"), join(home, ".dsh"));
    await expect(settings.save("review.md", "unsafe", null)).rejects.toThrow();
    expect(await readFile(join(external, "review.md"), "utf8")).toBe("Read-only review");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
