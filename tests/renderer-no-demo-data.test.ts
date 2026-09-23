// 渲染层不许挂演示数据（AGENTS 立的规矩：假象比空白更坏）。
// 动因：右栏五面板曾有演示常量（已删），但工作树看板那份 `BRANCHES`（四条假分支）活到 2026-09-23——
// 点一行只翻数组里的 `current` 再 toast「已切换到分支…」，而 `src/preload` 没有任何 git 通道。
// 真窗口那一半在 panels-check B28（屏上读数），这里守的是"别从注释旁边又溜回源码里"这一半。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rendererFiles = ["../src/renderer/app.js", "../src/renderer/projections.ts"] as const;

/** 去掉注释后的源码：注释允许**谈论**这些名字（那是历史与理由），字面量不允许携带它们。 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/* 演示分支名。演示工作区名（coding-suite / docs-site / edge-gateway）**尚未**清掉，
   等那一半落地时一并加进来——判据不许先把没做的部分写成已守住的（见任务 #64）。 */
const demoTokens = ["ttl-rotation", "grace-window", "chore/deps"];

describe("渲染层源码里不许携带演示数据", () => {
  for (const rel of rendererFiles) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    const code = codeOnly(src);
    it(`${rel}：去注释后不含任何演示分支名／演示工作区名`, () => {
      const hit = demoTokens.filter((t) => code.includes(t));
      expect(hit, "命中的演示字面量：" + JSON.stringify(hit)).toEqual([]);
    });
  }

  it("反面对手：注释里提到这些名字仍然允许（修法与理由要写下来，判据不许把人逼成不回写历史）", () => {
    const src = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
    expect(src).toContain("ttl-rotation");
    expect(codeOnly(src)).not.toContain("ttl-rotation");
  });

  it("工作树那一格必须自己说未接入（撤假数据不等于留白）", () => {
    const src = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
    const branchFn = /function branchesViewHTML\(\)[\s\S]*?\n\}/.exec(src)?.[0] ?? "";
    expect(branchFn).not.toBe("");
    expect(branchFn).toContain("未接入");
    expect(branchFn).not.toContain("branch-row");
  });
});
