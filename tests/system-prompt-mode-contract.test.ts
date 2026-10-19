import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE_SYSTEM, systemPromptFor } from "../src/agent/system-prompt";
import { sessionToolSpecs } from "../src/agent/session-provider";
import { PERMISSION_MODES, type PermissionMode } from "../src/permissions";
import type { FaceCost } from "../scripts/prompt-cost";

function discipline(mode: PermissionMode, number: number): string {
  const lines = systemPromptFor(mode).split("\n").filter((line) => line.startsWith(`${number}) `));
  expect(lines).toHaveLength(1);
  return lines[0];
}

describe("只读系统提示词与实际能力一致", () => {
  it("开场定位为只读核验与建议，不承诺在本档修改代码", () => {
    const intro = systemPromptFor("read-only").split("\n")[0];
    expect(intro).toContain("只读编程 agent");
    expect(intro).toContain("修复建议");
    expect(intro).not.toContain("改代码、跑测试");
  });

  it("写工具已被摘除时，修复要求改为复现步骤与建议，不要求创建测试和改代码", () => {
    const names = sessionToolSpecs({ mode: "read-only" }).specs.map((spec) => spec.function.name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of ["write_file", "edit_file", "apply_patch", "run_shell"]) expect(names).not.toContain(name);
    const line = discipline("read-only", 4);
    expect(line).toContain("复现步骤");
    expect(line).toContain("修复建议");
    expect(line).toContain("不宣称已修复");
    expect(line).not.toContain("先写一条");
    expect(line).not.toContain("再改代码到绿");
  });

  it("只读调查给出方案，不诱导申请本档无法执行的文件修改", () => {
    const line = discipline("read-only", 2);
    expect(line).toContain("本档只读");
    expect(line).toContain("给出方案");
    expect(line).not.toContain("写/改文件前");
  });

  it("收尾要求报告发现与证据，并明确未验证项", () => {
    const line = discipline("read-only", 5);
    expect(line).toContain("verify");
    expect(line).toContain("发现");
    expect(line).toContain("证据");
    expect(line).toContain("未验证项");
    expect(line).not.toContain("改完");
  });

  it("结论覆盖实际检查范围，区分问题与假设", () => {
    const line = discipline("read-only", 6);
    expect(line).toContain("实际检查范围");
    expect(line).toContain("已证实问题");
    expect(line).toContain("待验证假设");
  });

  it("不再给没有子代理工具的只读档发送 worker 写入和合并说明", () => {
    expect(sessionToolSpecs({ mode: "read-only" }).specs.some((spec) => spec.function.name === "spawn_agent")).toBe(false);
    expect(systemPromptFor("read-only")).not.toContain("worker 改自己的 worktree");
    expect(systemPromptFor("read-only")).not.toContain("spawn");
  });

  it.each(["default", "guided", "auto"] as const)("%s 档保留原有方案门与先红后绿约束", (mode) => {
    expect(systemPromptFor(mode)).toBe(BASE_SYSTEM);
    expect(discipline(mode, 2)).toContain("propose_plan 等批准");
    expect(discipline(mode, 4)).toContain("先写一条能复现它的测试并跑到红");
    expect(discipline(mode, 6)).toContain("既有测试与判卷文件不得改写");
  });
});

describe("提示词成本量实际发送的档位文本", () => {
  let faces: FaceCost[];
  let charsPerToken: number;
  beforeAll(async () => {
    const require = createRequire(import.meta.url);
    const script = fileURLToPath(new URL("../scripts/prompt-cost.ts", import.meta.url));
    const result = await promisify(execFile)(process.execPath, ["--import", require.resolve("tsx"), script, "--json"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), maxBuffer: 256 * 1024,
    });
    const report = JSON.parse(result.stdout) as { faces: FaceCost[]; charsPerToken: number };
    faces = report.faces;
    charsPerToken = report.charsPerToken;
    expect(faces.map((face) => face.mode).sort()).toEqual([...PERMISSION_MODES].sort());
    expect(charsPerToken).toBeGreaterThan(0);
  });

  it.each(PERMISSION_MODES)("%s 的系统成本来自该档实际提示词", (mode) => {
    const face = faces.find((entry) => entry.mode === mode);
    if (!face) throw new Error(`缺少 ${mode} 成本读数`);
    expect(face.systemTokens).toBe(Math.round(systemPromptFor(mode).length / charsPerToken));
    expect(face.totalTokens).toBe(face.toolTokens + face.systemTokens);
  });
});
