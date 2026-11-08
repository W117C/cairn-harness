// §11.7.2「MCP 工具」那一行的**执行侧**判据：注解必须从 tools/list 经 McpToolInfo.grade 抵达 evaluate。
// plugins-mcp.test.ts 那组只证「evaluate 拿到注解后判得对」；「递给门的那份注解是谁给的」这一跳
// 此前只有 plugins-check（明卷脚本）在看——而 mutate-verify 跑的是 vitest，摘掉 `info.grade` 实参
// 不会有任何一条测试红（本仓点名的「两头断」形状）。故这里补一条走 runAgent 真入口、真 stub server 的。
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "../src/main/agent-runner";
import { TrustStore, pluginFingerprint } from "../src/agent/plugins";
import type { AgentEvent } from "../src/events";
import type { PermissionMode } from "../src/permissions";

const FX = join(process.cwd(), "fixtures", "plugins");
const SCOPED_ECHO = "mcp__plugin_echo-suite_stub__echo"; // server 自标 readOnlyHint
const SCOPED_FAIL = "mcp__plugin_echo-suite_stub__fail"; // 什么都不标 = fail-closed 样本

let dir = "";
let trust = "";
const saved = { script: process.env.M1C_AUTONOMY_SCRIPT, trust: process.env.M2E_TRUST_FILE, data: process.env.M2E_PLUGIN_DATA };

async function run(scenario: string, mode: PermissionMode, tag: string): Promise<AgentEvent[]> {
  process.env.M1C_AUTONOMY_SCRIPT = join(FX, "check", scenario);
  process.env.M2E_TRUST_FILE = trust;
  process.env.M2E_PLUGIN_DATA = join(dir, ".plugin-data");
  return runAgent({
    workspace: dir,
    message: "MCP 注解分级场景 " + tag,
    mode,
    logPath: join(dir, "events-" + tag + ".jsonl"),
    sandbox: null,
    unattended: true,
  });
}

function resultOf(events: AgentEvent[], callId: string): { ok: boolean; output: string } | undefined {
  const e = events.find((x) => x.type === "tool_result" && (x as { callId: string }).callId === callId);
  if (!e || e.type !== "tool_result") return undefined;
  return { ok: e.ok, output: e.output };
}

describe("MCP 注解抵达权限门（runAgent 真入口 + 真 stub server）", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-mcp-grade-"));
    const pluginsDir = join(dir, ".agent", "plugins");
    await mkdir(pluginsDir, { recursive: true });
    // 符号链接指回仓库内 fixtures：server.mjs 的裸导入 @modelcontextprotocol/sdk 经 ESM realpath 解析
    const pluginRoot = join(pluginsDir, "echo-suite");
    await symlink(join(FX, "project", "echo-suite"), pluginRoot, "dir");
    trust = join(dir, "trust.json");
    await new TrustStore(trust).decide(pluginRoot, true, await pluginFingerprint(pluginRoot));
  }, 60_000);

  afterAll(async () => {
    if (saved.script === undefined) delete process.env.M1C_AUTONOMY_SCRIPT;
    else process.env.M1C_AUTONOMY_SCRIPT = saved.script;
    if (saved.trust === undefined) delete process.env.M2E_TRUST_FILE;
    else process.env.M2E_TRUST_FILE = saved.trust;
    if (saved.data === undefined) delete process.env.M2E_PLUGIN_DATA;
    else process.env.M2E_PLUGIN_DATA = saved.data;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  // 这一条是 `evaluate(name, args, s, info.grade)` 那个实参的唯一测试侧判据：
  // 摘掉它 ⇒ 门按「无注解」处理 ⇒ echo 也被拒 ⇒ 本条红。
  it("带 readOnlyHint 的工具体在自主档自动执行（注解真抵达了门）", async () => {
    const events = await run("mcp-lazy-flow.jsonl", "auto", "annotated-echo");
    const r = resultOf(events, "c-mcp");
    expect(r?.ok).toBe(true);
    expect(r?.output).toContain("echo: 你好");
    expect(r?.output).not.toContain("permission denied");
  }, 120_000);

  it("无注解的工具体在自主档不自动执行，且拒绝原因指明依据（stub 未被调用）", async () => {
    const events = await run("mcp-lazy-unannotated.jsonl", "auto", "noann");
    const r = resultOf(events, "c-mcp-noann");
    expect(r?.ok).toBe(false);
    expect(r?.output).toContain("[permission denied]");
    expect(r?.output).toContain(SCOPED_FAIL);
    // 原因必须说得出「无注解按写处理」——只报「非交互模式」等于把分级依据丢了，模型无从换路
    expect(r?.output).toContain("MCP 无注解");
    expect(r?.output).not.toContain("stub failure");
  }, 120_000);

  // 成对锁：排除「只读档一律放行 MCP」这种把白名单写成豁免的读法
  it("只读档：带 readOnlyHint 的照常放行，无注解的按白名单依据拒", async () => {
    const okEv = await run("mcp-lazy-flow.jsonl", "read-only", "ro-echo");
    expect(resultOf(okEv, "c-mcp")?.ok).toBe(true);
    const noEv = await run("mcp-lazy-unannotated.jsonl", "read-only", "ro-noann");
    const bad = resultOf(noEv, "c-mcp-noann");
    expect(bad?.ok).toBe(false);
    expect(bad?.output).toContain("只读注解白名单");
    expect(bad?.output).not.toContain("stub failure");
  }, 120_000);
});
