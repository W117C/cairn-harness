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
    for (const text of ["Git", "全局", "SHA-256", "hooks", "未提供签名权限清单", "配置", "风险"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("确认更新");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-modal-surface="true"');
  });
});

describe("PluginImportMenu", () => {
  it("offers one import command with Git and local choices", () => {
    const html = renderToStaticMarkup(<PluginImportMenu open />);
    expect(html).toContain("Git 仓库");
    expect(html).toContain("本地目录");
  });
});
