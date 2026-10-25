// §9.8 承诺的三个激活面里，插件的 `.lsp.json` 从前只有前两个：装载器收下、面板报数，
// 运行时从不读它 ⇒ 面板上那个「LSP: 1」是在撒谎（本仓点名的「能力已发货、用户点不到」）。
// 这一组判据走真进程：${PLUGIN_ROOT} 展开出的路径要真能 spawn，
// initializationOptions 要真到 initialize（stub 把它原样回显在 hover 里）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PluginRuntime } from "../src/agent/plugins";
import { runAgent } from "../src/main/agent-runner";
import { closeAllLspClients, collectDiagnostics, loadLspConfig, lsp, pluginLspServerIds } from "../src/tools/lsp";
import type { ToolContext } from "../src/tools";

const FX = fileURLToPath(new URL("../fixtures/plugins", import.meta.url));
const SERVER_PATH = join(FX, "project", "echo-suite", "lsp-server", "stub.mjs");

let ws = "";
let rt: PluginRuntime | null = null;

/** 建一次装载：`trust` = 是否过信任门；`switchOn` = 宿主 .agent/lsp.json 有没有把 LSP 打开。 */
async function load(over: { trust?: boolean; switchOn?: boolean } = {}): Promise<PluginRuntime> {
  ws = await mkdtemp(join(tmpdir(), "dsh-plugin-lsp-"));
  await writeFile(join(ws, "a.ts"), "function alpha() {}\n", "utf8");
  if (over.switchOn !== false) {
    await mkdir(join(ws, ".agent"), { recursive: true });
    await writeFile(join(ws, ".agent", "lsp.json"), JSON.stringify({ lsp: {} }), "utf8");
  }
  rt = await PluginRuntime.load({
    projectPluginsDir: join(FX, "project"),
    workspace: ws,
    pluginDataRoot: join(ws, "plugin-data"),
    trustFile: join(ws, "trust.json"),
  });
  if (over.trust !== false) await rt.trustDecide("echo-suite", true);
  rt.activateLsp();
  return rt;
}

afterEach(async () => {
  await rt?.shutdown();
  rt = null;
  await closeAllLspClients();
  if (ws) await rm(ws, { recursive: true, force: true }).catch(() => {});
});

describe("插件 .lsp.json 进 LSP 运行时（§9.8 第三激活面）", () => {
  it("受信插件的服务器按 scoped id 注册；transport:socket 那条不占名额", async () => {
    const e = await load();
    expect(pluginLspServerIds(ws)).toContain("echo-suite:stub-ts");
    expect(pluginLspServerIds(ws)).not.toContain("echo-suite:socket-only");
    const cfg = loadLspConfig(ws);
    expect(cfg.servers["echo-suite:stub-ts"]?.extensions).toEqual([".ts", ".tsx"]); // CC 的 extensionToLanguage 键集
    // 2026-10-23：extensionToLanguage 的**值**必须一路带到运行时。此前 `activateLsp` 只取
    // `Object.keys(cfg.extensionToLanguage)` 当 extensions、把值丢掉 ⇒ 非 JS 语言的插件 server
    // （`.py`/`.go`/`.rs`）didOpen 时 languageId 落回 TS 启发式的 "plaintext"，六操作静默失效。
    // 这条钉的是**值本身**（不是键集）：插件 server 与宿主 server 走同一条 languageId 契约。
    expect(cfg.servers["echo-suite:stub-ts"]?.extensionToLanguage).toEqual({ ".ts": "typescript", ".tsx": "typescript" });
    // 面板口径：声明数与已注册数分开报（只看声明数就是"装载即陈列"的旧撒谎法）
    const snap = e.snapshot().plugins.find((p) => p.name === "echo-suite");
    expect(snap?.counts.lsp).toBe(1);
    expect(snap?.counts.lspActive).toBe(1);
  });

  it("§9.8 里运行时还没兑现的字段，装载期当场说出来（不静默收下）", async () => {
    const e = await load();
    const warns = e.manifest.plugins.find((p) => p.name === "echo-suite")?.warnings ?? [];
    const unhonored = warns.find((w) => w.includes("本轮不生效"));
    expect(unhonored).toBeDefined();
    expect(unhonored ?? "").toContain("startupTimeout");
    expect(unhonored ?? "").toContain("restartOnCrash");
    expect(unhonored ?? "").toContain("diagnostics.maxPerFile");
  });

  it("未过信任门的插件不注册（server.command 是任意可执行文件，信任门与 hook/MCP 同口径）", async () => {
    await load({ trust: false });
    expect(pluginLspServerIds(ws)).toEqual([]);
    expect(loadLspConfig(ws).servers["echo-suite:stub-ts"]).toBeUndefined();
  });

  it("宿主没开 LSP 总开关 ⇒ 注册了也不生效（插件不能替用户把 LSP 打开）", async () => {
    await load({ switchOn: false });
    expect(pluginLspServerIds(ws)).toContain("echo-suite:stub-ts"); // 登记了
    const cfg = loadLspConfig(ws);
    expect(cfg.enabled).toBe(false);                                 // 但不进配置面
    expect(cfg.servers["echo-suite:stub-ts"]).toBeUndefined();
  });

  it("真跳：${PLUGIN_ROOT} 展开成真路径，lsp 工具 hover 回显出 initializationOptions", async () => {
    await load();
    const cfg = loadLspConfig(ws);
    const argv = cfg.servers["echo-suite:stub-ts"]?.args ?? [];
    expect(argv).toEqual([SERVER_PATH]);                             // 变量已展开
    expect(argv[0]).not.toContain("${");                             // 没留裸变量
    expect(existsSync(argv[0] ?? "")).toBe(true);                    // 展开出来的路径真的存在
    const ctx: ToolContext = { workspace: ws };
    const hover = await lsp.run({ operation: "hover", path: "a.ts", line: 1, column: 1 }, ctx);
    expect(hover.ok).toBe(true);
    expect(hover.output).toContain("plugin-opts");
    expect(hover.output).toContain('"stub":true');                   // .lsp.json 里那份配置真到了 initialize
  });

  it("shutdown 摘干净：注册表不留跨会话残留（下一个会话不该继承上一个插件的服务器）", async () => {
    const e = await load();
    expect(pluginLspServerIds(ws)).toContain("echo-suite:stub-ts");
    await e.shutdown();
    rt = null;
    expect(pluginLspServerIds(ws)).toEqual([]);
  });

  /** 现造一个用户级插件（带指定 diagnostics 开关），其 .lsp.json 直接指仓库那份 stub。 */
  async function loadWithDiagnostics(enabled: boolean): Promise<string> {
    ws = await mkdtemp(join(tmpdir(), "dsh-plugin-lsp-diag-"));
    const file = join(ws, "a.ts");
    await writeFile(file, "function alpha() {}\n", "utf8");
    await mkdir(join(ws, ".agent"), { recursive: true });
    await writeFile(join(ws, ".agent", "lsp.json"), JSON.stringify({ lsp: {} }), "utf8");
    const pluginRoot = join(ws, "user-plugins", "diag");
    await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
    await writeFile(join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "diag", description: "诊断开关判据", version: "0.1.0" }), "utf8");
    await writeFile(join(pluginRoot, ".lsp.json"), JSON.stringify({
      servers: { stub: { command: "node", args: [SERVER_PATH], extensionToLanguage: { ".ts": "typescript" }, diagnostics: { enabled } } },
    }), "utf8");
    rt = await PluginRuntime.load({
      userPluginsDir: join(ws, "user-plugins"),
      workspace: ws,
      pluginDataRoot: join(ws, "plugin-data"),
      trustFile: join(ws, "trust.json"),
    });
    rt.activateLsp();
    return file;
  }

  it("§9.8 的 diagnostics 开关真兑现：开 ⇒ 插件服务器推的 ERROR 回流；关 ⇒ 一个字都不回", async () => {
    const onFile = await loadWithDiagnostics(true);
    expect(await collectDiagnostics(ws, onFile)).toContain("plugin-stub-diag");
    await rt?.shutdown();
    await closeAllLspClients();
    const offFile = await loadWithDiagnostics(false);
    expect(await collectDiagnostics(ws, offFile)).toBe("");
  });
});

// 生产入口那一跳：上面几条都是测试自己调 activateLsp()——那正是"纯函数有单测 = 没人调用它"的藏身处。
// 这一条走 runAgent，用 onEvent 在会话中途读注册表（shutdown 之后就读不到了）。
describe("runAgent 真的会激活插件 LSP（§9.8 那一跳不是只有测试在调）", () => {
  let ws = "";
  const saved = { user: process.env.M2E_USER_PLUGINS, data: process.env.M2E_PLUGIN_DATA };

  afterEach(async () => {
    if (saved.user === undefined) delete process.env.M2E_USER_PLUGINS;
    else process.env.M2E_USER_PLUGINS = saved.user;
    if (saved.data === undefined) delete process.env.M2E_PLUGIN_DATA;
    else process.env.M2E_PLUGIN_DATA = saved.data;
    await closeAllLspClients();
    if (ws) await rm(ws, { recursive: true, force: true }).catch(() => {});
  });

  it("runAgent 里注册的 id 与面板口径同源；未激活（把那一行摘掉）就是红", async () => {
    ws = await mkdtemp(join(tmpdir(), "dsh-plugin-lsp-run-"));
    await writeFile(join(ws, "README.md"), "line1\n", "utf8");
    await mkdir(join(ws, ".agent"), { recursive: true });
    await writeFile(join(ws, ".agent", "lsp.json"), JSON.stringify({ lsp: {} }), "utf8");
    // 只带 .lsp.json 的最小插件：这一条验的是"入口会不会激活"，不该顺带拉起 MCP/hook 子进程。
    const pluginRoot = join(ws, "user-plugins", "lonely");
    await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
    await writeFile(join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "lonely", description: "入口判据", version: "0.1.0" }), "utf8");
    await writeFile(join(pluginRoot, ".lsp.json"), JSON.stringify({
      servers: { one: { command: "node", args: [SERVER_PATH], extensionToLanguage: { ".ts": "typescript" } } },
    }), "utf8");
    process.env.M2E_USER_PLUGINS = join(ws, "user-plugins");
    process.env.M2E_PLUGIN_DATA = join(ws, "plugin-data");
    const seen: string[] = [];
    await runAgent({
      workspace: ws, message: "念一遍 README 的第一行", mode: "read-only",
      logPath: join(ws, "events.jsonl"), sandbox: null, unattended: true,
      onEvent: () => { if (seen.length === 0) seen.push(...pluginLspServerIds(ws)); },
    });
    expect(seen).toContain("lonely:one");
  }, 120_000);
});
