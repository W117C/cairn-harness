import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MarketplaceEntry } from "../../../src/agent/plugins/marketplace";
import type {
  InstalledPluginRecord,
  MarketplaceCatalogReadout,
} from "../../../src/main/ipc-protocol";
import {
  mergePluginRows,
  pluginUpdateRows,
} from "../src/renderer/derived/plugins";
import {
  createPluginsMarketplaceSnapshot,
  type PluginsMarketplaceState,
} from "../src/renderer/state/plugins-marketplace";
import { PluginsWorkspace } from "../src/renderer/components/plugins/PluginsWorkspace";

const ZERO = { skills: 0, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0 } as const;

function entry(
  id: string,
  summary: string,
  capabilities: MarketplaceEntry["capabilities"] = ZERO,
): MarketplaceEntry {
  return {
    id,
    name: id,
    summary,
    author: "Cairn",
    sourceUrl: `https://plugins.example.com/${id}`,
    license: "MIT",
    version: "1.2.0",
    publishedAt: "2026-10-29T00:00:00.000Z",
    packageUrl: `https://plugins.example.com/${id}.tgz`,
    sha256: "a".repeat(64),
    sizeBytes: 1024,
    capabilities,
    permissions: ["filesystem:read"],
    minAppVersion: "0.1.0",
  };
}

function liveCatalog(entries: readonly MarketplaceEntry[]): MarketplaceCatalogReadout {
  return {
    status: "ready",
    origin: "live",
    catalog: {
      schemaVersion: 1,
      revision: "catalog-1",
      generatedAt: "2026-10-29T00:00:00.000Z",
      expiresAt: "2026-11-05T00:00:00.000Z",
      packageHosts: ["plugins.example.com"],
      entries,
      shelves: [
        { id: "featured", title: "精选", entryIds: entries.slice(0, 1).map((item) => item.id) },
        { id: "recent", title: "最近上架", entryIds: entries.slice(1).map((item) => item.id) },
      ],
    },
    fetchedAt: "2026-10-29T00:00:00.000Z",
    expiresAt: "2026-11-05T00:00:00.000Z",
    stale: false,
  };
}

function record(): InstalledPluginRecord {
  return {
    entryId: "git-plugin",
    manifestName: "git-plugin",
    version: null,
    sha256: "b".repeat(64),
    fingerprint: "c".repeat(32),
    source: {
      kind: "git",
      repositoryUrl: "https://github.com/example/git-plugin",
      ref: "main",
      commit: "1".repeat(40),
    },
    scope: "project",
    workspace: "/workspace",
    enabled: true,
    installedAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
  };
}

const noop = (): void => undefined;
const asyncNoop = async (): Promise<void> => undefined;

function state(overrides: Partial<PluginsMarketplaceState> = {}): PluginsMarketplaceState {
  const catalog = overrides.catalog ?? liveCatalog([
    entry("mcp-plugin", "把项目工具接入模型", { ...ZERO, mcp: 2 }),
    entry("skills-plugin", "复用团队工作流", { ...ZERO, skills: 3 }),
  ]);
  const installed = overrides.installed ?? [record()];
  const base = createPluginsMarketplaceSnapshot({ workspace: "/workspace" });
  const rows = mergePluginRows(catalog, installed, base.runtime, base.favorites);
  return {
    ...base,
    ...overrides,
    catalog,
    catalogStatus: overrides.catalogStatus ?? "ready",
    installed,
    installedStatus: overrides.installedStatus ?? "ready",
    runtimeStatus: overrides.runtimeStatus ?? "ready",
    rows: overrides.rows ?? rows,
    updates: overrides.updates ?? pluginUpdateRows(rows, overrides.updateChecks ?? {}),
    visibleRows: overrides.visibleRows ?? rows,
    refresh: noop,
    installPlugin: asyncNoop,
    importPlugin: asyncNoop,
    checkPluginUpdate: asyncNoop,
    updatePlugin: asyncNoop,
    setPluginEnabled: asyncNoop,
    uninstallPlugin: asyncNoop,
    configurePlugin: asyncNoop,
    toggleFavorite: noop,
    commitReview: asyncNoop,
    closeReview: noop,
    reopenReview: noop,
    cancelReview: asyncNoop,
    dismissNotice: noop,
    setView: noop,
    setQuery: noop,
    setCategory: noop,
    setFavoriteOnly: noop,
    select: noop,
    setScrollTop: noop,
  };
}

describe("PluginsWorkspace", () => {
  it("sidebar all overrides a category retained from the narrow-window filter", () => {
    const html = renderToStaticMarkup(<PluginsWorkspace state={state({ category: "mcp" })} activeFilter="all" />);
    expect(html).toContain("mcp-plugin");
    expect(html).toContain("skills-plugin");
  });

  it("renders the three real marketplace views without marketing chrome", () => {
    const html = renderToStaticMarkup(<PluginsWorkspace state={state()} />);

    expect(html).toContain("发现");
    expect(html).toContain("已安装");
    // 2026-11-02：措辞与左侧上下文栏/页头筛选统一为「可更新」（此前 tabs 只写「更新」）。
    expect(html).toContain("可更新");
    expect(html).toContain("mcp-plugin");
    expect(html).not.toMatch(/下载量|评分|热门/u);
  });

  it("视图只有页内标签条一处入口：分类筛选不再改写视图", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/renderer/components/plugins/PluginsWorkspace.tsx", import.meta.url)),
      "utf8",
    );
    // 标签条直写视图状态，不吃筛选回调；筛选只碰分类 / 精选。
    expect(src).toContain("onClick={() => { state.setView(id); }}");
    expect(src).not.toContain("state.setView(id as \"discover\" | \"installed\" | \"updates\")");
    // 旧视图 id 仍被兼容（命令面板 / 持久化筛选可能送来），但不参与筛选显示。
    expect(src).toContain("normalizeView(props.activeFilter, state.view)");
  });

  it("keeps cache, corrupt, empty, and registry error states distinct", () => {
    const cached = { ...liveCatalog([]), origin: "cache" as const, stale: true };
    const cacheHtml = renderToStaticMarkup(<PluginsWorkspace state={state({ catalog: cached })} />);
    expect(cacheHtml).toContain("离线缓存");

    const corrupt: MarketplaceCatalogReadout = {
      status: "unavailable",
      origin: "none",
      catalog: null,
      fetchedAt: null,
      expiresAt: null,
      stale: false,
      note: "缓存损坏",
    };
    expect(renderToStaticMarkup(<PluginsWorkspace state={state({ catalog: corrupt })} />)).toContain("缓存损坏");
    expect(renderToStaticMarkup(<PluginsWorkspace state={state({ catalog: liveCatalog([]) })} />)).toContain("目录为空");
    expect(renderToStaticMarkup(
      <PluginsWorkspace
        state={state({
          installedStatus: "error",
          installedError: "read installed.json failed",
        })}
      />,
    )).toContain("已安装列表读取失败");
    // 2026-11-02：空态不只是一个标题，要说清下一步去哪（目录为空 / 无匹配 / 未安装）。
    expect(renderToStaticMarkup(<PluginsWorkspace state={state({ catalog: liveCatalog([]) })} />)).toContain("先导入本地插件");
    expect(renderToStaticMarkup(
      <PluginsWorkspace state={state({ view: "installed", activeJob: null })} />,
    )).toMatch(/到「发现」里挑一个|导入/);
  });

  it("shows operational rows and accessible icon actions on demand", () => {
    const html = renderToStaticMarkup(
      <PluginsWorkspace
        state={state({ view: "installed", activeJob: null })}
        activeFilter="installed"
      />,
    );

    expect(html).toContain("git-plugin");
    expect(html).toContain("Git");
    expect(html).toContain('aria-label="停用 git-plugin"');
    expect(html).toContain('aria-label="卸载 git-plugin"');
    expect(html).toContain('data-plugin-row="installed"');
  });

  it("passes the real workspace and update count into the plugin destination", () => {
    const workbench = readFileSync(
      fileURLToPath(new URL("../src/renderer/panes/WorkbenchView.tsx", import.meta.url)),
      "utf8",
    ) + "\n" + readFileSync(
      fileURLToPath(new URL("../src/renderer/panes/WorkbenchSidebarHost.tsx", import.meta.url)),
      "utf8",
    );
    const appPage = readFileSync(
      fileURLToPath(new URL("../src/renderer/components/AppPage.tsx", import.meta.url)),
      "utf8",
    );
    expect(workbench).toContain("const [pluginUpdateCount, setPluginUpdateCount] = useState(0)");
    expect(workbench).toContain("badges={pluginUpdateCount > 0 ? { plugins: pluginUpdateCount } : {}}");
    expect(workbench).toContain("workspace={activeWorkspace}");
    expect(workbench).toContain("onPluginUpdateCount={(count) => { setPluginUpdateCount(count); }}");
    expect(appPage).toContain("<PluginsDestination");
    expect(appPage).toContain("workspace={props.workspace ?? null}");
    expect(appPage).toContain("onUpdateCount: props.onPluginUpdateCount");
  });
});
