// 技能指令正文（§8 #15，2026-10-18）：设置页技能抽屉「读了再信任」的读取面。
// 真临时工作区 + 真 SKILL.md，走 handleSkillBody 的完整发现路径（不是桩）。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleListSkills, handleSkillBody } from "../src/main/state-handlers";

let ws = "";
beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "cairn-skill-body-"));
  await mkdir(join(ws, ".agent", "skills", "demo"), { recursive: true });
  await writeFile(join(ws, ".agent", "skills", "demo", "SKILL.md"),
    "---\nname: demo\ndescription: 演示技能\n---\n你是演示技能，先报「Demo 已激活」。\n", "utf8");
  // 容器插件（同样真布局）：面板要列出它的技能/命令，斜杠清单要带上 /plugin:skill。
  await mkdir(join(ws, ".agent", "plugins", "demo-plugin", ".claude-plugin"), { recursive: true });
  await mkdir(join(ws, ".agent", "plugins", "demo-plugin", "skills", "greet"), { recursive: true });
  await mkdir(join(ws, ".agent", "plugins", "demo-plugin", "commands"), { recursive: true });
  await writeFile(join(ws, ".agent", "plugins", "demo-plugin", ".claude-plugin", "plugin.json"), '{"name":"demo-plugin"}', "utf8");
  await writeFile(join(ws, ".agent", "plugins", "demo-plugin", "skills", "greet", "SKILL.md"),
    "---\nname: greet\ndescription: 向用户问好\n---\n说你好。\n", "utf8");
  await writeFile(join(ws, ".agent", "plugins", "demo-plugin", "commands", "hello.md"),
    "---\ndescription: 打印一句问候\n---\n你好。\n", "utf8");
});
afterAll(async () => { await rm(ws, { recursive: true, force: true }); });

describe("handleSkillBody", () => {
  it("按名字读到正文与路径（frontmatter 不进正文）", async () => {
    const r = await handleSkillBody("demo", ws);
    expect(r.ok).toBe(true);
    expect(r.body).toContain("你是演示技能");
    expect(r.body).not.toContain("description: 演示技能");
    expect(r.path?.endsWith("SKILL.md")).toBe(true);
  });

  it("未找到 / 空名字 → ok:false 且说原因", async () => {
    const miss = await handleSkillBody("nope", ws);
    expect(miss.ok).toBe(false);
    expect(miss.error).toContain("nope");
    const empty = await handleSkillBody("  ", ws);
    expect(empty.ok).toBe(false);
  });
});


describe("插件技能进斜杠清单", () => {
  it("散装技能在前，容器插件技能以 /plugin:skill 追加（信任随插件）", async () => {
    const r = await handleListSkills(ws);
    expect(r.skills.map((s) => s.invoke)).toEqual(["/demo", "/demo-plugin:greet"]);
    expect(r.skills[1]?.trust).toBe("pending");
    expect(r.skills[1]?.description).toBe("向用户问好");
    // 命令同进补全（同样信任随插件）
    expect(r.commands.map((c) => c.invoke)).toEqual(["/demo-plugin:hello"]);
    expect(r.commands[0]?.trust).toBe("pending");
  });

  it("容器插件技能按 /plugin:skill 读正文", async () => {
    const r = await handleSkillBody("/demo-plugin:greet", ws);
    expect(r.ok).toBe(true);
    expect(r.body).toContain("说你好");
    expect(r.path?.endsWith("SKILL.md")).toBe(true);
  });
});
