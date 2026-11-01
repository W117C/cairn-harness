// 第 952 页：「在 Finder 中显示」失败不许静默。
//
// 同一个动作有两处调用点：项目列表（`state/projects.ts#handleRevealProject`）失败会 toast，
// 产物行（`state/workbench.ts#handleOpenArtifact`）原先 `void ...revealInFinder(abs)` 丢掉结果——
// 上一轮产物常已被删或不在本工作区，用户点了没反应，只能猜是不是按钮坏了。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const workbench = readFileSync(join(ROOT, "src/renderer/state/workbench.ts"), "utf8");
const projects = readFileSync(join(ROOT, "src/renderer/state/projects.ts"), "utf8");

describe("「在 Finder 中显示」的失败要说出来（第 952 页）", () => {
  it("产物行接了结果：失败 toast、抛错也 toast", () => {
    expect(workbench).toContain("revealInFinder(abs).then(");
    expect(workbench).toContain('if (!r.ok) toast.error(r.error ?? "无法在 Finder 中显示");');
    expect(workbench).toContain("(err: unknown) => { toast.error(err instanceof Error ? err.message : String(err)); },");
    // 不许退回「丢掉结果」的写法
    expect(workbench).not.toContain("else void window.agent.revealInFinder(abs);");
  });

  it("两处调用点同一口径（项目列表那处本来就是这样）", () => {
    expect(projects).toContain('if (!r.ok) toast.error(r.error ?? "无法在 Finder 中显示");');
  });
});
