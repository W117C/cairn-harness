// 判卷 · 截断尾注给的「取回地址」必须分落位给（任务 #47，裁决＝分案改文案，**不给 read_file 开第二根允许例**）。
//
// 为什么判这一格：`[全文见 <entry.path>]` 里的 path 由 `join(root, …)` 算出 ⇒ **恒为绝对路径**，
// 而七把碰文件的工具第一句就拒绝对路径（`resolveInWorkspace`）。实测两案（项目级／用户级）都读不到 ⇒
// 那句尾注一次也执行不了；模型照做就是白跑一轮（同族见 #33、第 63 页）。
// 复现器＝`scripts/probe-promise-recall.ts` 的 `hopSkill`（真 discoverPlugins → 真尾注 → 真 read_file）。
//
// 反向一侧同样钉住（#36 那条纪律）：那道拒绝对路径的闸**不许**为了让文案变真而被拆——
// 它和 realpath 复查一起专治软链绕过。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { skillRecallSuffix, expandSkillInvocation, skillInvokeName } from "../src/agent/plugins/skills";
import { PluginRuntime } from "../src/agent/plugins";
import { read_file } from "../src/tools/read_file";
import type { SkillEntry } from "../src/agent/plugins/types";
import type { ToolContext } from "../src/tools/base";

let ws = "";
const relInside = ".agent/plugins/p/skills/big/SKILL.md";

function ctx(): ToolContext {
  return { workspace: ws, emit: async () => {} } as unknown as ToolContext;
}

function entryAt(path: string): SkillEntry {
  return {
    plugin: "p", name: "big", description: "d", path,
    frontmatter: {}, body: "行内容\n".repeat(20000),
  } as SkillEntry;
}

beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "skill-recall-addr-"));
  await mkdir(join(ws, ".agent", "plugins", "p", "skills", "big"), { recursive: true });
  await writeFile(join(ws, relInside), "---\ndescription: d\n---\n\nMARKER-TEXT-INSIDE\n", "utf8");
});

afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

describe("尾注按落位分两案（工作区内给相对路径，外面明说读不到）", () => {
  it("工作区内：给**工作区相对**路径，且真 read_file 用它读得到（承诺＝做得到的动作）", async () => {
    const suffix = skillRecallSuffix(join(ws, relInside), ws);
    expect(suffix).toContain(relInside);
    expect(suffix).not.toMatch(/全文见\s+\//); // 不许再递绝对路径
    const m = /全文见\s+(\S+?)[，\s]/u.exec(suffix);
    expect(m, suffix).not.toBeNull();
    const r = await read_file.run({ path: String(m?.[1]) }, ctx());
    expect(r.ok, r.output).toBe(true);
    expect(r.output).toContain("MARKER-TEXT-INSIDE");
  });

  it("工作区外：明说模型侧读不到，且一个路径都不递（不递假地址）", () => {
    const suffix = skillRecallSuffix(join(tmpdir(), "outside-root", "SKILL.md"), ws);
    expect(suffix).toContain("读不到");
    expect(suffix).not.toMatch(/全文见/);
    expect(suffix).not.toMatch(/\/var|\/Users|\/private/); // 绝对路径一个字节都不进上下文
  });

  it("没登记工作区（用户侧调用点还没接上那一跳）：fail-closed，不承诺取回", () => {
    const suffix = skillRecallSuffix(join(ws, relInside), undefined);
    expect(suffix).toContain("读不到");
    expect(suffix).not.toMatch(/全文见/);
  });

  it("`..` 逃逸的写法不许被认成工作区内（落位判定按边界，不按字符串前缀）", () => {
    const escape = join(ws, "..", "elsewhere", "SKILL.md");
    expect(skillRecallSuffix(escape, ws)).not.toMatch(/全文见/);
  });
});

describe("一处收口：两个发射面吃同一支 helper", () => {
  it("expandSkillInvocation 传了 workspace ⇒ 尾注与 helper 逐字一致（不各抄一份）", () => {
    const abs = join(ws, relInside);
    const viaEntry = expandSkillInvocation([entryAt(abs)], skillInvokeName(entryAt(abs)), undefined, ws).text;
    const expectSuffix = skillRecallSuffix(abs, ws);
    expect(viaEntry.slice(-expectSuffix.length)).toBe(expectSuffix);
  });

  it("不传 workspace ⇒ 与缺省同形（旧调用方逐字不变，零回归）", () => {
    const abs = join(ws, relInside);
    const a = expandSkillInvocation([entryAt(abs)], skillInvokeName(entryAt(abs))).text;
    const b = expandSkillInvocation([entryAt(abs)], skillInvokeName(entryAt(abs)), undefined, undefined).text;
    expect(a).toBe(b);
    expect(a).toContain("读不到"); // 缺省是 fail-closed 那一案，不是旧的假承诺
  });
});

describe("反向哨兵：那道信任边界不许为文案变真而拆", () => {
  it("read_file 对绝对路径仍然拒（这是 #36 钉住的同一把闸）", async () => {
    await expect(read_file.run({ path: join(ws, relInside) }, ctx())).rejects.toThrow(/只允许 workspace 相对路径/);
  });

  it("这条判据本身有分辨力：helper 若把外面误判成内，两案的文案会相同", () => {
    const inside = skillRecallSuffix(join(ws, relInside), ws);
    const outside = skillRecallSuffix("/somewhere/definitely/outside/SKILL.md", ws);
    expect(inside).not.toBe(outside);
  });
});

describe("模型那条 face 的 producer 也有观测者（少传 workspace 会整案退化）", () => {
  it("triggerSkill 区内那案给出可读的相对地址——纯函数与用户侧两条用例照样绿，所以必须真走 runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-recall-rt-"));
    const projectDir = join(root, "project");
    await mkdir(join(projectDir, "cap-suite", ".claude-plugin"), { recursive: true });
    await mkdir(join(projectDir, "cap-suite", "skills", "big"), { recursive: true });
    await writeFile(join(projectDir, "cap-suite", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "cap-suite", description: "取回地址样本", version: "0.1.0" }), "utf8");
    await writeFile(join(projectDir, "cap-suite", "skills", "big", "SKILL.md"),
      "---\nname: big\ndescription: 大正文样本\n---\n\nMARKER-TRIGGER-TEXT\n" + "w".repeat(200 * 1024), "utf8");
    const dataDir = join(root, "data");
    const rt = await PluginRuntime.load({
      projectPluginsDir: projectDir,
      looseRoots: [],
      workspace: root,
      pluginDataRoot: dataDir,
      trustFile: join(dataDir, "trust.json"),
    });
    try {
      await rt.trustDecide("cap-suite", true);
      const hit = rt.triggerSkill("/cap-suite:big");
      expect(hit.ok, hit.output).toBe(true);
      const m = /全文见\s+(\S+?)[，\s]/u.exec(hit.output);
      expect(m, hit.output.slice(-160)).not.toBeNull();
      expect(String(m?.[1])).not.toMatch(/^\//);
      const r = await read_file.run({ path: String(m?.[1]) }, { workspace: root, emit: async () => {} } as unknown as ToolContext);
      expect(r.ok, r.output).toBe(true);
      expect(r.output).toContain("MARKER-TRIGGER-TEXT");
    } finally {
      await rt.shutdown();
      await rm(root, { recursive: true, force: true });
    }
  });
});
