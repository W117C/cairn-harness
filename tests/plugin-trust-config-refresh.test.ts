import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginRuntime, setPluginSecretBackend, writePluginUserConfig, type McpServerConfig } from "../src/agent/plugins";
import { McpManager } from "../src/agent/plugins/mcp";
import { loadLspConfig } from "../src/tools/lsp";

const name = "config-refresh";
const token = "fixture-token-original";
const dirs: string[] = [];
const runtimes: PluginRuntime[] = [];
beforeEach(() => {
  const secrets = new Map<string, string>();
  setPluginSecretBackend({
    name: "fixture-memory", isAvailable: () => true,
    async set(key, value) { secrets.set(key, value); },
    async get(key) { return secrets.get(key) ?? null; },
  });
});
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
  setPluginSecretBackend(null);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "plugin-trust-config-"));
  dirs.push(dir);
  const root = join(dir, "plugins", name);
  await mkdir(join(root, ".claude-plugin"), { recursive: true });
  await mkdir(join(root, "hooks"));
  await mkdir(join(dir, ".agent"));
  await writeFile(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({
    name, version: "1.0.0",
    userConfig: { TOKEN: { type: "string", sensitive: true }, PROFILE: { type: "string", default: "prod" } },
    mcpServers: {
      remote: { type: "http", url: "https://example.invalid/${user_config.PROFILE}/mcp", headers: { authorization: "Bearer ${user_config.TOKEN}" } },
      local: { command: "node", args: ["${PLUGIN_ROOT}/server.mjs", "${user_config.PROFILE}"], env: { TOKEN: "${user_config.TOKEN}" } },
    },
  }));
  await writeFile(join(root, ".lsp.json"), JSON.stringify({ servers: {
    stub: { command: "node", args: ["${user_config.PROFILE}", "${user_config.TOKEN}"], extensionToLanguage: { ".cfg": "plaintext" } },
  } }));
  await writeFile(join(root, "hooks", "hooks.json"), JSON.stringify({ hooks: {
    PostToolUse: [{ hooks: [{ type: "command", command: [process.execPath, "-e", "process.stdout.write(process.env.PLUGIN_OPTION_TOKEN ?? 'missing')"] }] }],
  } }));
  await writeFile(join(dir, ".agent", "lsp.json"), JSON.stringify({ lsp: {} }));
  const runtime = await PluginRuntime.load({
    workspace: dir, home: dir, projectPluginsDir: join(dir, "plugins"),
    userPluginsDir: join(dir, "none"), projectSkillsDir: join(dir, "skills"), looseRoots: [],
    pluginDataRoot: join(dir, "data"), trustFile: join(dir, "trust.json"),
  });
  runtimes.push(runtime);
  runtime.mcp = new McpManager(async () => { throw new Error("fixture transport: no network"); });
  expect(runtime.manifest.plugins).toHaveLength(1);
  expect(runtime.manifest.plugins[0]?.trust).toBe("pending");
  const writeConfig = async (values = { TOKEN: token, PROFILE: "staging" }) => {
    const result = await writePluginUserConfig({
      plugin: name, fields: runtime.manifest.plugins[0]!.userConfigFields,
      values, dir: join(dir, "data", name),
    });
    expect(result.ok).toBe(true);
  };
  return { dir, root, runtime, writeConfig };
}

describe("插件批准后配置立即进入同一运行时", () => {
  it("首次批准即读取声明的默认值，不需要重启会话或手动解析配置", async () => {
    const { runtime } = await setup();
    expect(runtime.userConfigValuesFor(name)).toEqual({});
    expect(await runtime.trustDecide(name, true)).toBe(true);
    expect(runtime.manifest.plugins[0]?.trust).toBe("trusted");
    expect(runtime.userConfigValuesFor(name)).toEqual({ PROFILE: "prod" });
  });

  it("先填配置再批准，MCP 的 URL、请求头、参数和环境都使用已填写的值", async () => {
    const { runtime, root, writeConfig } = await setup();
    await writeConfig();
    expect(runtime.userConfigValuesFor(name)).toEqual({});
    expect(await runtime.trustDecide(name, true)).toBe(true);
    const seen: McpServerConfig[] = [];
    runtime.mcp = new McpManager(async (config) => { seen.push(config); throw new Error("fixture transport: no network"); });
    await runtime.connectMcp();
    expect(seen).toHaveLength(2);
    const remote = seen.find((config) => config.type === "http");
    expect(remote?.url).toBe("https://example.invalid/staging/mcp");
    expect(remote?.headers?.authorization).toBe("Bearer " + token);
    const local = seen.find((config) => config.command === "node");
    expect(local?.args).toEqual([root + "/server.mjs", "staging"]);
    expect(local?.env?.TOKEN).toBe(token);
    expect(JSON.stringify(seen)).not.toContain("${user_config.");
  });

  it("批准后激活 LSP 立即使用配置", async () => {
    const { runtime, dir, writeConfig } = await setup();
    await writeConfig();
    expect(await runtime.trustDecide(name, true)).toBe(true);
    runtime.activateLsp();
    expect(runtime.activeLspServerIds()).toEqual([name + ":stub"]);
    expect(loadLspConfig(dir).servers[name + ":stub"]?.args).toEqual(["staging", "${user_config.TOKEN}"]);
  });

  it("修改配置后重新批准，hooks 与 MCP/LSP 的配置读取使用同一份新值", async () => {
    const { runtime, writeConfig } = await setup();
    await writeConfig();
    expect(await runtime.trustDecide(name, true)).toBe(true);
    await writeConfig({ TOKEN: "fixture-token-updated", PROFILE: "dev" });
    expect(await runtime.trustDecide(name, true)).toBe(true);
    const hook = await runtime.hooks.run("PostToolUse", { event: "PostToolUse", tool_name: "read_file", tool_args: {} });
    expect(hook.ran).toBe(1);
    expect(hook.errors).toEqual([]);
    expect(hook.additionalContext).toContain("fixture-token-updated");
    expect(runtime.userConfigValuesFor(name)).toEqual({ TOKEN: "fixture-token-updated", PROFILE: "dev" });
  });

  it("密钥后端不可用后重新批准，不再沿用旧敏感值，仍报告缺项", async () => {
    const { runtime, writeConfig } = await setup();
    await writeConfig();
    expect(await runtime.trustDecide(name, true)).toBe(true);
    // 先建立已有配置缓存，单独验证再次批准时不会沿用已经失效的敏感值。
    await runtime.resolveUserConfigs();
    expect(runtime.userConfigValuesFor(name).TOKEN).toBe(token);
    setPluginSecretBackend(null);
    expect(await runtime.trustDecide(name, true)).toBe(true);
    expect(runtime.userConfigValuesFor(name)).toEqual({ PROFILE: "staging" });
    expect(runtime.manifest.plugins[0]?.warnings.some((warning) => warning.includes("${user_config.TOKEN}") && warning.includes("没有值"))).toBe(true);
  });

  it("撤回信任后清除该插件的配置缓存", async () => {
    const { runtime, writeConfig } = await setup();
    await writeConfig();
    expect(await runtime.trustDecide(name, true)).toBe(true);
    await runtime.resolveUserConfigs();
    expect(runtime.userConfigValuesFor(name).TOKEN).toBe(token);
    expect(await runtime.trustDecide(name, false)).toBe(true);
    expect(runtime.manifest.plugins[0]?.trust).toBe("declined");
    expect(runtime.userConfigValuesFor(name)).toEqual({});
  });

  it("待批准插件被拒绝时，已填写配置仍不进入可执行面", async () => {
    const { runtime, writeConfig } = await setup();
    await writeConfig();
    expect(await runtime.trustDecide(name, false)).toBe(true);
    expect(runtime.userConfigValuesFor(name)).toEqual({});
    const hooks = await runtime.hooks.run("PostToolUse", { event: "PostToolUse", tool_name: "read_file", tool_args: {} });
    expect(hooks.ran).toBe(0);
    await runtime.connectMcp();
    expect(runtime.mcp.statuses()).toEqual([]);
    runtime.activateLsp();
    expect(runtime.activeLspServerIds()).toEqual([]);
  });
});
