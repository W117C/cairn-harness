// §9.5 userConfig 的读侧。此前 `writePluginUserConfig` 有、读的人一个也没有：
// `getPluginSecret` 零调用者、`PLUGIN_OPTION_*` 不存在、`${user_config.*}` 只被拒载从不被展开
// ⇒ 生态里现成的插件（§9.11 两个实仓样本都是 http 型、key 写在 headers 里）在 DSH 里根本连不上。
// 判据走真装载 + 真 spawn：只测替换器的话，"运行时没人把值递进去"这一层照旧能藏住。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PluginRuntime, expandMcpConfig, getPluginSecret, putPluginSecret, readPluginUserConfig,
  setPluginSecretBackend, writePluginUserConfig, SECRET_PLACEHOLDER,
  type McpServerConfig, type PluginSecretBackend, type UserConfigField,
} from "../src/agent/plugins";
import { McpManager } from "../src/agent/plugins/mcp";
import { loadLspConfig } from "../src/tools/lsp";

const KEY = "sk-token-value-1234";

/** 内存版密钥后端（等价 safeStorage 的读侧语义；不依赖 Electron）。 */
function memoryBackend(): { backend: PluginSecretBackend; store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    backend: {
      name: "memory",
      isAvailable: () => true,
      async set(k, v) { store.set(k, v); },
      async get(k) { return store.has(k) ? (store.get(k) as string) : null; },
    },
  };
}

const fields: UserConfigField[] = [
  { key: "TOKEN", type: "string", required: true, sensitive: true, hasDefault: false },
  { key: "PROFILE", type: "string", required: false, sensitive: false, hasDefault: true, defaultValue: "prod" },
];

describe("readPluginUserConfig（读侧）", () => {
  let dir: string;
  let be: { backend: PluginSecretBackend; store: Map<string, string> };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-usercfg-"));
    // 每条测试一套独立密钥后端：密钥键只含「插件名 + 字段名」，共享 store 会让上一条存的
    // TOKEN 泄漏到下一条的「缺值」断言里（把 missing 冻成永远空）。
    be = memoryBackend();
    setPluginSecretBackend(be.backend);
  });
  afterEach(async () => {
    setPluginSecretBackend(null);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("明文值走配置文件、敏感值走密钥后端；文件里那条只有占位符", async () => {
    await putPluginSecret("p1", "TOKEN", KEY);
    const w = await writePluginUserConfig({
      plugin: "p1", fields, values: { TOKEN: KEY, PROFILE: "staging" }, dir,
    });
    expect(w.ok).toBe(true);
    const r = await readPluginUserConfig({ dir, plugin: "p1", fields });
    expect(r.values.TOKEN).toBe(KEY);
    expect(r.values.PROFILE).toBe("staging");
    expect(r.sensitive).toEqual(["TOKEN"]);
    expect(r.missing).toEqual([]);
    // 值本身绝不明文落盘（写侧既有断言的读侧镜像：读回来的 TOKEN 来自后端，不是文件）
    expect(JSON.stringify(w)).not.toContain(KEY);
  });

  it("缺值 / 解不开的敏感值 → 进 missing，值面里**没有这个键**（不拿空串顶位）", async () => {
    const r = await readPluginUserConfig({ dir, plugin: "p1", fields });
    expect(r.missing).toContain("TOKEN");
    expect("TOKEN" in r.values).toBe(false);
    expect(r.values.PROFILE).toBe("prod"); // default 生效（default 值此前被丢在装载器里，只剩 hasDefault）
  });

  it("配置文件里的 plugin 与请求不一致 ⇒ 那份值一个都不采用（不把 A 插件的配置套到 B 插件上）", async () => {
    await writePluginUserConfig({ plugin: "other", fields, values: { PROFILE: "leaky" }, dir });
    const r = await readPluginUserConfig({ dir, plugin: "p1", fields });
    expect(JSON.stringify(r)).not.toContain("leaky");
    expect(r.values.PROFILE).toBe("prod"); // 只回到自己声明的 default
  });
});

describe("userConfig 进激活面（§9.5 的三条通道）", () => {
  let dir: string;
  let rt: PluginRuntime | null = null;
  let be: { backend: PluginSecretBackend; store: Map<string, string> };

  const pluginRoot = (): string => join(dir, "user-plugins", "cfg");

  /** 一个声明 userConfig 的插件 + 三条激活面各留一处待展开的 `${user_config.*}`。 */
  async function loadPlugin(opts: { withValue: boolean; preWrite?: boolean }): Promise<PluginRuntime> {
    await mkdir(join(pluginRoot(), ".claude-plugin"), { recursive: true });
    await mkdir(join(pluginRoot(), "hooks"), { recursive: true });
    await writeFile(join(pluginRoot(), ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "cfg", description: "userConfig 判据", version: "0.1.0",
      userConfig: { TOKEN: { type: "string", sensitive: true }, PROFILE: { default: "prod" } },
      mcpServers: {
        remote: {
          type: "http", url: "https://api.example.com/${user_config.PROFILE}/mcp",
          headers: { authorization: "Bearer ${user_config.TOKEN}" },
        },
        local: { command: "node", args: ["--token", "${user_config.TOKEN}", "--root", "${PLUGIN_ROOT}"] },
      },
    }, null, 2), "utf8");
    await writeFile(join(pluginRoot(), ".lsp.json"), JSON.stringify({
      servers: {
        stub: { command: "node", args: ["${user_config.TOKEN}/srv.mjs"], extensionToLanguage: { ".ts": "typescript" } },
      },
    }), "utf8");
    // 宿主 LSP 总开关：插件不能替用户打开它（既有判据），开着才能看第三激活面
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, ".agent", "lsp.json"), JSON.stringify({ lsp: {} }), "utf8");
    // exec form（argv 不经 shell）：把尾随 argv 与 PLUGIN_OPTION_TOKEN 一起打出来。
    // node -e 的 argv 从 [1] 起是脚本后的参数（实测 ["…/node","HELLO"]），不是 [2]。
    const script = "process.stdout.write('argv=' + process.argv[1] + ' env=' + (process.env.PLUGIN_OPTION_TOKEN ?? 'none'));";
    await writeFile(join(pluginRoot(), "hooks", "hooks.json"), JSON.stringify({
      hooks: { PostToolUse: [{ hooks: [{ type: "command", command: ["node", "-e", script, "${user_config.TOKEN}"] }] }] },
    }), "utf8");
    if (opts.withValue) await putPluginSecret("cfg", "TOKEN", KEY);
    if (opts.preWrite) {
      // 值在装载**之前**就填好：产品里是设置页写完 → 重开会话，此后没人再手动解析一次
      await writePluginUserConfig({
        plugin: "cfg", fields, values: { TOKEN: KEY },
        dir: join(dir, "plugin-data", "cfg"),
      });
    }
    rt = await PluginRuntime.load({
      userPluginsDir: join(dir, "user-plugins"),
      workspace: dir,
      pluginDataRoot: join(dir, "plugin-data"),
      trustFile: join(dir, "trust.json"),
    });
    if (opts.withValue && !opts.preWrite) {
      await writePluginUserConfig({
        plugin: "cfg", fields, values: { TOKEN: KEY },
        dir: join(dir, "plugin-data", "cfg"),
      });
      await rt.resolveUserConfigs(); // 值在装载之后才填上 → 重解析
    }
    return rt;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-usercfg-live-"));
    be = memoryBackend();
    setPluginSecretBackend(be.backend);
  });
  afterEach(async () => {
    await rt?.shutdown();
    rt = null;
    setPluginSecretBackend(null);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("exec form：敏感值只进 env（argv 里保留占位符，进程表读不到密钥）", async () => {
    const e = await loadPlugin({ withValue: true });
    const r = await e.hooks.run("PostToolUse", { event: "PostToolUse", tool_name: "read_file", tool_args: {} });
    expect(r.ran).toBe(1);
    expect(r.errors).toEqual([]);
    // 2026-10-19：sensitive 值不再展开进 argv（`ps` / 崩溃报告可读）；插件应走 PLUGIN_OPTION_*。
    expect(r.additionalContext).toContain("argv=${user_config.TOKEN}");
    expect(r.additionalContext).toContain("env=" + KEY);
    expect(r.additionalContext).not.toContain("argv=" + KEY);
    expect(r.additionalContext).not.toContain(SECRET_PLACEHOLDER);
  });

  it("没填值 ⇒ 占位串原样留着（不换成空串），且装载期点名是哪个键缺", async () => {
    const e = await loadPlugin({ withValue: false });
    const warns = e.manifest.plugins.find((p) => p.name === "cfg")?.warnings ?? [];
    expect(warns.some((w) => w.includes("${user_config.TOKEN}") && w.includes("没有值"))).toBe(true);
    const r = await e.hooks.run("PostToolUse", { event: "PostToolUse", tool_name: "read_file", tool_args: {} });
    expect(r.ran).toBe(1);
    expect(r.additionalContext).toContain("argv=${user_config.TOKEN}");
    expect(r.additionalContext).toContain("env=none");
  });

  it("装载期就把值解析好（生产里没有任何人再调一次 resolveUserConfigs）", async () => {
    const e = await loadPlugin({ withValue: true, preWrite: true });
    const r = await e.hooks.run("PostToolUse", { event: "PostToolUse", tool_name: "read_file", tool_args: {} });
    expect(r.errors).toEqual([]);
    expect(r.additionalContext).toContain("env=" + KEY);
  });

  it("第二激活面 MCP：connectMcp 真的把 userConfig 递给 connect（远程 key 就写在 headers 里）", async () => {
    const e = await loadPlugin({ withValue: true, preWrite: true });
    const seen: McpServerConfig[] = [];
    // 换掉真连接的 factory，只留"connect 收到的到底是什么配置"这一步——展开发生在 connect 内，
    // 所以这里看到的是**递进去的 roots 有没有生效**，不是替换器自己。
    (e as unknown as { mcp: McpManager }).mcp = new McpManager(async (cfg) => {
      seen.push(cfg);
      throw new Error("判据不真连");
    });
    await e.connectMcp();
    expect(seen.length).toBe(2);
    const remote = seen.find((c) => typeof c.url === "string");
    expect(remote?.url).toBe("https://api.example.com/prod/mcp"); // PROFILE 走 default
    expect(remote?.headers?.authorization).toBe("Bearer " + KEY);
    const local = seen.find((c) => Array.isArray(c.args));
    // 敏感值只进 env / 远程 headers；stdio server 的 argv 会出现在进程表里。
    expect(local?.args).not.toContain(KEY);
    expect(local?.args).toContain("${user_config.TOKEN}");
    expect(local?.args).toContain(pluginRoot()); // PLUGIN_ROOT 展开没被这轮改动挤掉
  });

  it("第三激活面 LSP：敏感值不进 command/args（进程表可读）", async () => {
    const e = await loadPlugin({ withValue: true, preWrite: true });
    e.activateLsp();
    const cfg = loadLspConfig(dir);
    expect(cfg.servers["cfg:stub"]?.args).toEqual(["${user_config.TOKEN}/srv.mjs"]);
  });

  it("getPluginSecret 不再零调用者：读侧确实经过它取敏感值（后端被拿掉 → 进 missing）", async () => {
    await loadPlugin({ withValue: true });
    setPluginSecretBackend(null);
    const r = await readPluginUserConfig({ dir: join(dir, "plugin-data", "cfg"), plugin: "cfg", fields });
    expect(r.missing).toContain("TOKEN");
    expect(await getPluginSecret("cfg", "TOKEN")).toBeNull();
  });

  // 2026-10-19：插件配置此前只有后端，没有写入入口。快照只给元数据（含 hasValue），
  // 写入走 setUserConfig，敏感值绝不回传渲染层。
  it("写入入口：快照不含值；setUserConfig 写入后 hasValue 翻转", async () => {
    const e = await loadPlugin({ withValue: false });
    const before = e.snapshot().plugins.find((p) => p.name === "cfg")?.userConfig ?? [];
    expect(before.map((f) => f.key).sort()).toEqual(["PROFILE", "TOKEN"]);
    expect(before.find((f) => f.key === "TOKEN")?.sensitive).toBe(true);
    expect(before.find((f) => f.key === "TOKEN")?.hasValue).toBe(false);
    expect(JSON.stringify(before)).not.toContain(KEY);

    const r = await e.setUserConfig("cfg", { TOKEN: KEY, PROFILE: "staging" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const after = e.snapshot().plugins.find((p) => p.name === "cfg")?.userConfig ?? [];
    expect(after.find((f) => f.key === "TOKEN")?.hasValue).toBe(true);
    expect(after.find((f) => f.key === "PROFILE")?.hasValue).toBe(true);
    expect(JSON.stringify(after)).not.toContain(KEY); // 敏感值绝不回传

    const bad = await e.setUserConfig("cfg", { NOPE: "x" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("未知配置项");
  });
});

describe("expandMcpConfig 的覆盖面（远程 server 的 key 在 headers 里）", () => {
  it("command/args/env 之外，url 与 headers 同样展开；缺值的键原样留着", () => {
    const cfg = {
      type: "http",
      url: "https://api.example.com/${user_config.PROFILE}/mcp",
      headers: { authorization: "Bearer ${user_config.TOKEN}", "x-plain": "${user_config.NOPE}" },
      env: { ROOT: "${PLUGIN_ROOT}" },
    } as unknown as McpServerConfig;
    const out = expandMcpConfig(cfg, { pluginRoot: "/pr", userConfig: { TOKEN: KEY, PROFILE: "staging" } });
    expect(out.url).toBe("https://api.example.com/staging/mcp");
    expect(out.headers?.authorization).toBe("Bearer " + KEY);
    expect(out.headers?.["x-plain"]).toBe("${user_config.NOPE}");
    expect(out.env?.ROOT).toBe("/pr");
  });
});

// 2026-10-19：插件配置写入入口的判据放在上面的激活面 describe 内部（复用 loadPlugin）。
