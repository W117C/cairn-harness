// M2e 任务 1/2/8 单测：三级作用域发现 / 散装 skill 免包装 / 未知字段警告不阻断 /
// 单插件失败隔离 / 代码插件拒载 / hook 装载纪律（user_config 禁入 shell-form）/
// agent 角色命名空间 / .lsp.json 字段对齐（socket 忽略 + 未知字段警告）。
import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverPlugins, pendingPlugins, activeHooks } from "../src/agent/plugins";

function fx(...parts: string[]): string {
  return join(process.cwd(), "fixtures", "plugins", ...parts);
}

describe("M2e 容器发现（任务 1）", () => {
  it("三级作用域各自发现（user / project / loose）", async () => {
    const m = await discoverPlugins({
      userPluginsDir: fx("user"),
      projectPluginsDir: fx("project"),
      looseRoots: [fx("loose")],
      trustStatus: () => "trusted",
    });
    const names = m.plugins.map((p) => p.name);
    expect(names).toContain("hello-plugin");
    expect(names).toContain("echo-suite");
    expect(m.plugins.find((p) => p.name === "hello-plugin")?.scope).toBe("user");
    expect(m.plugins.find((p) => p.name === "echo-suite")?.scope).toBe("project");
    // 散装 skill 免包装加载：无 manifest = 独立 skill
    expect(m.looseSkills).toHaveLength(1);
    expect(m.looseSkills[0]!.entry.plugin).toBeNull();
    expect(m.looseSkills[0]!.entry.name).toBe("standalone-skill");
    expect(m.looseSkills[0]!.entry.body).toContain("散装 skill 正文");
  });

  it("未知顶层字段只警告不阻断", async () => {
    const m = await discoverPlugins({
      projectPluginsDir: fx("project"),
      trustStatus: () => "trusted",
    });
    const echo = m.plugins.find((p) => p.name === "echo-suite");
    expect(echo).toBeDefined();
    expect(echo!.unknownFields).toContain("futureField");
    const w = m.warnings.find((x) => x.plugin === "echo-suite" && x.message.includes("未知顶层字段"));
    expect(w).toBeDefined();
  });

  it("坏 manifest 只影响自身（失败隔离），其余照常 + 面板报错", async () => {
    const m = await discoverPlugins({
      projectPluginsDir: fx("project"),
      trustStatus: () => "trusted",
    });
    const err = m.errors.find((e) => e.plugin === "broken-plugin");
    expect(err).toBeDefined();
    expect(err!.message).toContain("plugin.json");
    expect(m.plugins.map((p) => p.name)).toContain("echo-suite"); // 其余照常
  });

  it("含 index.js 的包被拒载（能力边界：零进程内第三方代码）", async () => {
    const m = await discoverPlugins({
      projectPluginsDir: fx("project"),
      trustStatus: () => "trusted",
    });
    const err = m.errors.find((e) => e.plugin === "js-entry-plugin");
    expect(err).toBeDefined();
    expect(err!.message).toContain("代码插件拒载");
    expect(err!.message).toContain("index.js");
    expect(m.plugins.map((p) => p.name)).not.toContain("js-entry-plugin");
  });

  it("散装 skill 不进 trust pending（免信任，无执行面）", async () => {
    const m = await discoverPlugins({
      projectPluginsDir: fx("project"),
      looseRoots: [fx("loose")],
      trustStatus: () => "pending",
    });
    expect(pendingPlugins(m).map((p) => p.name)).toEqual(["echo-suite"]);
    expect(m.looseSkills).toHaveLength(1); // 散装照常可见
  });
});

describe("M2e hook 装载纪律（任务 2/5）", () => {
  it("shell-form 含 ${user_config.*} 的 hook 装载即拒绝 + 警告", async () => {
    const root = join(tmpdir(), "m2e-test-usercfg-" + String(Date.now()) + "-" + String(Math.random()).slice(2, 8), "plugins");
    await mkdir(join(root, "usercfg-plugin", ".claude-plugin"), { recursive: true });
    await mkdir(join(root, "usercfg-plugin", "hooks"), { recursive: true });
    await writeFile(join(root, "usercfg-plugin", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "usercfg-plugin" }));
    await writeFile(
      join(root, "usercfg-plugin", "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo ${user_config.token}" }] }],
        },
      }),
    );
    const m = await discoverPlugins({ projectPluginsDir: root, trustStatus: () => "trusted" });
    const p = m.plugins.find((x) => x.name === "usercfg-plugin");
    expect(p).toBeDefined();
    expect(p!.hooks).toHaveLength(1);
    expect(p!.hooks[0]!.loaded).toBe(false);
    const w = m.warnings.find((x) => x.plugin === "usercfg-plugin" && x.message.includes("user_config"));
    expect(w).toBeDefined();
    expect(activeHooks(m)).toHaveLength(0); // 未装载条目不进激活面
  });

  it("bare MCP matcher（mcp__ 前缀非 plugin_ 形态）装载警告：scoped 才可能命中", async () => {
    const m = await discoverPlugins({
      projectPluginsDir: fx("project"),
      trustStatus: () => "trusted",
    });
    const w = m.warnings.find((x) => x.plugin === "echo-suite" && x.message.includes("scoped"));
    expect(w).toBeDefined();
  });

  it("agent 角色解析（tools 前沿字段在 frontmatter），命名空间断言在 runtime 测试", async () => {
    const m = await discoverPlugins({ projectPluginsDir: fx("project"), trustStatus: () => "trusted" });
    const echo = m.plugins.find((p) => p.name === "echo-suite")!;
    expect(echo.agents).toHaveLength(1);
    expect(echo.agents[0]!.name).toBe("reviewer");
    expect(echo.agents[0]!.frontmatter["tools"]).toContain("read_file");
  });

  it(".lsp.json 字段名向 CC 对齐：socket 忽略 + 警告、未知字段警告不阻断", async () => {
    const m = await discoverPlugins({ projectPluginsDir: fx("project"), trustStatus: () => "trusted" });
    const echo = m.plugins.find((p) => p.name === "echo-suite")!;
    expect(Object.keys(echo.lsp)).toEqual(["stub-ts"]);
    const cfg = echo.lsp["stub-ts"]!;
    expect(cfg.extensionToLanguage).toEqual({ ".ts": "typescript", ".tsx": "typescript" });
    expect(cfg.initializationOptions).toEqual({ stub: true });
    expect(cfg.startupTimeout).toBe(5);
    expect(cfg.restartOnCrash).toBe(false);
    expect(cfg.diagnostics).toEqual({ enabled: true, maxPerFile: 20 });
    const socketW = m.warnings.find((x) => x.plugin === "echo-suite" && x.message.includes("transport: socket"));
    expect(socketW).toBeDefined();
    const unknownW = m.warnings.find((x) => x.plugin === "echo-suite" && x.message.includes("unknownLspField"));
    expect(unknownW).toBeDefined();
  });
});
