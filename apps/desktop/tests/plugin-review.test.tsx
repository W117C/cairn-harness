import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScopedPluginReview } from "../src/renderer/state/plugins-marketplace";
import { PluginImportMenu } from "../src/renderer/components/plugins/PluginImportMenu";
import { PluginReview } from "../src/renderer/components/plugins/PluginReview";

function reviewState(): ScopedPluginReview {
  return {
    kind: "update",
    workspace: "/workspace",
    instanceId: "job-1:1",
    jobId: "job-1",
    review: {
      jobId: "job-1",
      entryId: "git-plugin",
      manifestName: "git-plugin",
      version: null,
      source: {
        kind: "git",
        repositoryUrl: "https://github.com/example/git-plugin",
        ref: "main",
        commit: "1".repeat(40),
      },
      scope: "user",
      workspace: null,
      targetRoot: "/Users/example/.cairn/plugins/git-plugin",
      fingerprint: "b".repeat(32),
      packageSha256: "a".repeat(64),
      capabilities: { skills: 2, commands: 1, agents: 0, hooks: 3, mcp: 1, lsp: 0 },
      permissions: null,
      userConfigFields: [],
      warnings: ["hooks 会在下一轮运行"],
    },
  };
}

describe("PluginReview", () => {
  it("shows source, scope, digest, capabilities, permissions, config, and warnings", () => {
    const html = renderToStaticMarkup(<PluginReview state={reviewState()} />);
    for (const text of ["Git", "全局", "SHA-256", "钩子 3", "技能 2", "未提供签名权限清单", "配置", "风险"]) {
      expect(html).toContain(text);
    }
    // 零值能力不出空壳：agents/lsp 为 0，审查页不摆这两格。
    expect(html).not.toContain("智能体 0");
    expect(html).not.toContain("LSP 0");
    expect(html).not.toContain("plugin-capability-grid");
    expect(html).toContain("plugin-capability-pills");
    expect(html).toContain("确认更新");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-modal-surface="true"');
  });
});

describe("插件抽屉与标题栏贴合", () => {
  it("抽屉从 38px 开始，不盖标题栏也不在下面留缝", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/renderer/components/plugins/plugins.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\.plugin-sheet\s*\{[^}]*top:\s*38px/s);
    expect(css).not.toMatch(/\.plugin-sheet\s*\{[^}]*top:\s*48px/s);
  });
});

describe("PluginImportMenu", () => {
  it("offers one import command with Git and local choices", () => {
    const html = renderToStaticMarkup(<PluginImportMenu open />);
    expect(html).toContain("Git 仓库");
    expect(html).toContain("本地目录");
  });
});
