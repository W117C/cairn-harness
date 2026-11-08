// 用户级 MCP 服务器（2026-11-05 业主裁「参考开源项目 ZCode」）判卷三面：
//   ① 核心纯函数：单台校验 / 整份解析（单台失败隔离）/ 虚拟插件合成（serverName 形状）
//   ② 发现面：discoverPlugins({ userMcpConfigPath }) 真读盘 → user-mcp 虚拟插件进清单
//   ③ 设置面纯函数：表单草稿 ⇄ 配置载荷（切分/校验错误句）
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  USER_MCP_PLUGIN_NAME,
  parseUserMcpConfig,
  userMcpConfigPathOf,
  validateUserMcpServer,
  virtualUserMcpPlugin,
} from "../../../src/agent/plugins/user-mcp";
import { discoverPlugins } from "../../../src/agent/plugins/discover";
import { MCP_EMPTY_DRAFT, mcpDraftFrom, mcpDraftPayload } from "../src/renderer/components/settings-sections";

describe("用户级 MCP：单台校验（validateUserMcpServer）", () => {
  it("stdio：command + args/env 进规范化配置；缺 command 拒", () => {
    expect(validateUserMcpServer({ command: "npx", args: ["-y", "x"], env: { A: "b" } })).toEqual({
      ok: true,
      config: { command: "npx", args: ["-y", "x"], env: { A: "b" } },
    });
    expect(validateUserMcpServer({ command: "  " }).ok).toBe(false);
    expect(validateUserMcpServer({}).ok).toBe(false);
  });

  it("http/sse：url 必须 http(s)；command 与 url 二选一；type 只认 sse 标记", () => {
    expect(validateUserMcpServer({ url: "https://a/b" })).toEqual({ ok: true, config: { url: "https://a/b", type: "http" } });
    expect(validateUserMcpServer({ url: "https://a/b", type: "sse" }).ok).toBe(true);
    expect(validateUserMcpServer({ url: "ftp://a" }).ok).toBe(false);
    expect(validateUserMcpServer({ command: "a", url: "https://a" }).ok).toBe(false);
  });

  it("字段查型：args/env/headers/include/exclude/disabled 类型不对 = 拒（不 String() 偷换）", () => {
    expect(validateUserMcpServer({ command: "a", args: 1 }).ok).toBe(false);
    expect(validateUserMcpServer({ command: "a", env: { A: 2 } }).ok).toBe(false);
    expect(validateUserMcpServer({ command: "a", disabled: "yes" }).ok).toBe(false);
    expect(validateUserMcpServer({ command: "a", includeTools: ["x"], excludeTools: ["y"] }).ok).toBe(true);
  });
});

describe("用户级 MCP：整份解析（parseUserMcpConfig）", () => {
  it("顶层 mcpServers 表逐台校验；坏台进 errors（带 server 名），好台照收", () => {
    const r = parseUserMcpConfig({ mcpServers: { ok: { command: "x" }, bad: { args: 1 } } });
    expect(r.servers.map((s) => s.name)).toEqual(["ok"]);
    expect(r.errors).toEqual(["bad：缺 command（stdio）或 url（http/sse）"]);
  });

  it("非对象 / mcpServers 非对象 = 一句错误；空对象 = 零服务器零错误", () => {
    expect(parseUserMcpConfig("nope").errors).toHaveLength(1);
    expect(parseUserMcpConfig({ mcpServers: 3 }).errors).toHaveLength(1);
    expect(parseUserMcpConfig({})).toEqual({ servers: [], errors: [], warnings: [] });
  });
});

describe("用户级 MCP：发现面（discoverPlugins 真读盘）", () => {
  const dirs: string[] = [];
  const tmpCfg = (body: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "umcp-"));
    dirs.push(dir);
    const p = join(dir, "mcp.json");
    writeFileSync(p, body);
    return p;
  };
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it("好配置合成虚拟插件 user-mcp（serverName 形状、trust=trusted）；坏台隔离进 errors", async () => {
    const m = await discoverPlugins({ userMcpConfigPath: tmpCfg(JSON.stringify({ mcpServers: { fs: { command: "npx" }, bad: { url: "ftp://x" } } })) });
    const v = m.plugins.find((p) => p.name === USER_MCP_PLUGIN_NAME);
    expect(v?.scope).toBe("user");
    expect(v?.trust).toBe("trusted");
    expect(v?.mcp.map((s) => s.serverName)).toEqual(["fs"]);
    expect(m.errors).toContainEqual({ plugin: USER_MCP_PLUGIN_NAME, message: "bad：url 只允许 http/https" });
  });

  it("文件不存在 = 零服务器、零错误（不是故障）", async () => {
    const m = await discoverPlugins({ userMcpConfigPath: join(mkdtempSync(join(tmpdir(), "umcp-absent-")), "mcp.json") });
    expect(m.plugins.find((p) => p.name === USER_MCP_PLUGIN_NAME)).toBeUndefined();
    expect(m.errors.filter((e) => e.plugin === USER_MCP_PLUGIN_NAME)).toEqual([]);
  });
});

describe("用户级 MCP：虚拟插件形状（virtualUserMcpPlugin）", () => {
  it("manifest 只带 mcpServers；mcp 数组是 { serverName, config }（接口形状，不是 name）", () => {
    const v = virtualUserMcpPlugin("/data", [{ name: "a", config: { command: "x" } }]);
    expect(v.name).toBe("user-mcp");
    expect(v.trust).toBe("trusted");
    expect(v.mcp).toEqual([{ serverName: "a", config: { command: "x" } }]);
    expect((v.manifest as Record<string, unknown>).mcpServers).toEqual({ a: { command: "x" } });
  });

  it("userMcpConfigPathOf：appData 根下 mcp.json（与 plugins/ 同层）", () => {
    expect(userMcpConfigPathOf("/data")).toBe(join("/data", "mcp.json"));
  });
});

describe("用户级 MCP：设置面表单草稿（mcpDraftFrom / mcpDraftPayload）", () => {
  it("配置 → 草稿：stdio 取命令与参数，http 取地址；草稿 → 载荷：切分与必填校验", () => {
    const d = mcpDraftFrom("fs", { command: "npx", args: ["-y", "x"], env: { A: "b" } });
    expect(d.kind).toBe("stdio");
    expect(d.args).toBe("-y x");
    const p = mcpDraftPayload(d);
    expect(p).toEqual({ ok: true, config: { command: "npx", args: ["-y", "x"], env: { A: "b" } } });
    const http = mcpDraftPayload({ ...MCP_EMPTY_DRAFT, name: "r", kind: "http", url: "https://a", headers: "X-A: b" });
    // type 归一化是主进程校验层的事（url ⇒ http）：载荷只写用户给的字段。
    expect(http).toEqual({ ok: true, config: { url: "https://a", headers: { "X-A": "b" } } });
    expect(mcpDraftPayload({ ...MCP_EMPTY_DRAFT, name: "r" }).ok).toBe(false);
    expect(mcpDraftPayload({ ...MCP_EMPTY_DRAFT, name: "r", kind: "stdio" }).ok).toBe(false);
    expect(mcpDraftPayload({ ...MCP_EMPTY_DRAFT, name: "", kind: "stdio", command: "x" }).ok).toBe(false);
  });

  it("坏行给一句能落在字段旁的错误：headers 缺冒号 / env 缺等号；裁剪与停用照收", () => {
    expect(mcpDraftPayload({ ...MCP_EMPTY_DRAFT, name: "r", kind: "http", url: "https://a", headers: "没冒号" }).ok).toBe(false);
    expect(mcpDraftPayload({ ...MCP_EMPTY_DRAFT, name: "r", kind: "http", url: "https://a", env: "没等号" }).ok).toBe(false);
    const p = mcpDraftPayload({ ...MCP_EMPTY_DRAFT, name: "r", kind: "stdio", command: "x", includeTools: "a, b", excludeTools: "c", disabled: true });
    expect(p.ok && p.config.includeTools).toEqual(["a", "b"]);
    expect(p.ok && p.config.excludeTools).toEqual(["c"]);
    expect(p.ok && p.config.disabled).toBe(true);
  });
});
