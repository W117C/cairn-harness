// skill 正文在**主路径**（触发）上的预算。此前只有压缩后重挂那头收窄（clampSkillBody），
// 触发那头原样吐全文，而 skill 的 tool_result 又在 prune exemptTools 里 ⇒ 一份 200KB 的
// SKILL.md 会作为常驻上下文付满整个会话。见 src/agent/plugins/index.ts::triggerSkill。
import { describe, expect, it } from "vitest";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PluginRuntime, SKILL_REMOUNT_TOKENS_PER_SKILL, clampSkillBody, estimateTokens,
} from "../src/agent/plugins";

async function runtimeWithBody(body: string): Promise<{ rt: PluginRuntime; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "skill-cap-"));
  const projectDir = join(root, "project");
  await cp(join(process.cwd(), "fixtures", "plugins", "project"), projectDir, { recursive: true });
  await writeFile(
    join(projectDir, "echo-suite", "skills", "greet", "SKILL.md"),
    "---\nname: greet\ndescription: cap fixture\n---\n\n" + body,
    "utf8",
  );
  const dataDir = join(root, "data");
  const rt = await PluginRuntime.load({
    projectPluginsDir: projectDir,
    looseRoots: [],
    workspace: root,
    pluginDataRoot: dataDir,
    trustFile: join(dataDir, "trust.json"),
  });
  await rt.trustDecide("echo-suite", true);
  return { rt, root };
}

describe("clampSkillBody 的取回提示计入预算", () => {
  it("未超限逐字不变，且不追加提示", () => {
    expect(clampSkillBody("short body", 5000, "\n[全文见 /a/b.md]")).toBe("short body");
  });

  it("超限时提示自己不得撑破预算（总量 ≤ 预算，且提示完整保留）", () => {
    const suffix = "\n[全文见 /very/long/path/to/SKILL.md]";
    const out = clampSkillBody("y".repeat(200 * 1024), SKILL_REMOUNT_TOKENS_PER_SKILL, suffix);
    expect(out.endsWith(suffix)).toBe(true);
    expect(out).toContain("已截断");
    expect(estimateTokens(out)).toBeLessThanOrEqual(SKILL_REMOUNT_TOKENS_PER_SKILL);
  });
});

describe("skill 触发主路径有界", () => {
  it("200KB 正文收到单 skill 预算内，头部留住并给出全文路径", async () => {
    const body = "HEAD-SKILL-LINE\n" + "z".repeat(200 * 1024) + "\nTAIL-SKILL-LINE";
    const { rt, root } = await runtimeWithBody(body);
    try {
      const hit = rt.triggerSkill("/echo-suite:greet");
      expect(hit.ok).toBe(true);
      expect(estimateTokens(hit.output)).toBeLessThanOrEqual(SKILL_REMOUNT_TOKENS_PER_SKILL);
      expect(hit.output.indexOf("HEAD-SKILL-LINE")).toBeLessThan(12); // 头部留住，不是只留了个尾巴
      expect(hit.output).toContain("已截断");
      expect(hit.output).toContain("全文见 ");
      expect(hit.output).toContain("SKILL.md");
    } finally {
      await rt.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("未超限的正文逐字进上下文（零回归）", async () => {
    const body = "HEAD-SKILL-LINE\n# 正文\nTAIL-SKILL-LINE";
    const { rt, root } = await runtimeWithBody(body);
    try {
      const hit = rt.triggerSkill("/echo-suite:greet");
      expect(hit.ok).toBe(true);
      expect(hit.output).not.toContain("已截断");
      expect(hit.output).toContain("TAIL-SKILL-LINE");
    } finally {
      await rt.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
});
