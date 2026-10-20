// 读侧敏感路径门：**主会话**真的会对敏感路径出审批卡（2026-10-20 独立评审追出的 HIGH）。
//
// 旧形状：路径通道（`src/permissions/risk.ts` 的 pathRisk）判得出「这个路径是敏感面」
// （`.git/config` / `.env` / `.agent/config.json` / `.agent/lsp.json` …），但那个判据**只在
// `evaluate()` 里跑**，而 evaluate 只对**被 gatedTool 包装**的工具跑。主会话此前只包了写向与
// 执行类，**read_file/grep/glob 三把裸挂** ⇒ 判据在主会话这条路上一次也没跑过：
// `read_file {path:".git/config"}` 在四档里都是**零审批**，凭据直接进模型上下文（还落进会话 JSONL）。
// worker 那条路一直包着（`gatedWorkerTool`）⇒ 同一个工具、同一套判据、两个出口两个结论。
//
// 这一份判卷量的是**接线后真的会发生的事**（跑真 runAgent、真工具、真 AskGate），
// 不是判据本身（判据另有 `tests/permissions-tool-registry.test.ts` 钉着）。
// 另配一条**源文本**判卷（接线棘轮）与一条**反向对照**（检查器瞎了必须能分得开）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../src/events";

const temporaryDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const SECRET = "FAKE_CREDENTIAL_ghp_should_never_reach_the_model";

/** 起一套真会话：真 AskGate（人点「不」）、真权限会话、真 runAgent。 */
async function setup(opts: { approve: boolean; mode?: "default" | "read-only" | "auto"; safeMode?: "on" | "off" | "gate" } = { approve: false }) {
  vi.resetModules();
  const dir = await mkdtemp(join(tmpdir(), "read-path-gate-"));
  temporaryDirs.push(dir);
  const workspace = join(dir, "workspace");
  const appdata = join(dir, "appdata");
  await mkdir(join(workspace, ".git"), { recursive: true });
  await mkdir(join(workspace, ".agent"), { recursive: true });
  await mkdir(appdata);
  // 一份**真的**带凭据的 .git/config —— 读它必须出卡
  await writeFile(join(workspace, ".git", "config"), `[remote "origin"]\n\turl = https://${SECRET}@github.com/x/y.git\n`);
  await writeFile(join(workspace, "notes.txt"), "普通文件，没有秘密。\n");
  await writeFile(join(workspace, ".agent", "permissions.json"), JSON.stringify({ rules: [] }));
  vi.stubEnv("DSH_APPDATA", appdata);
  vi.stubEnv("M2D_MEMORY_HOME", join(dir, "memory"));
  vi.stubEnv("M2E_USER_PLUGINS", join(dir, "plugins"));
  vi.stubEnv("M2E_LOOSE_SKILLS", join(dir, "skills"));
  vi.stubEnv("M1E_SAFE_MODE", opts.safeMode ?? "off");
  const permissions = await import("../src/permissions");
  const { AskGate } = await import("../src/main/ask-gate");
  const { setToolGateDeps } = await import("../src/main/tool-gates");
  const asked: string[] = [];
  const gate = new AskGate({
    timeoutMs: 3000,
    notify: (request) => {
      asked.push(request.tool);
      gate.decide(request.askId, opts.approve, "user", "once");
    },
  });
  const autonomy = permissions.newAutonomySession(opts.mode ?? "default", {
    rules: permissions.loadPermissionRules(join(workspace, ".agent", "permissions.json"), join(appdata, "permissions.json")),
    planBlocked: () => false,
  });
  setToolGateDeps({ currentSession: () => ({ askGate: gate, autonomy, sandbox: null }) });
  return { dir, workspace, asked, gate, autonomy, permissions };
}

/** 写一份脚本化 provider，让 agent 按剧本调工具。 */
async function script(dir: string, calls: { id: string; name: string; args: Record<string, unknown> }[]): Promise<string> {
  const path = join(dir, "script.jsonl");
  const events = [
    ...calls.map((c) => ({ type: "tool_call", id: c.id, name: c.name, args: c.args })),
    { type: "assistant_message", content: "done" },
  ];
  await writeFile(path, events.map((e) => JSON.stringify(e)).join("\n"));
  return path;
}

async function runAgentWithScript(s: Awaited<ReturnType<typeof setup>>, scriptPath: string, mode: "default" | "read-only" | "auto", safeMode: "off" | "gate" = "off") {
  vi.stubEnv("M1C_AUTONOMY_SCRIPT", scriptPath);
  vi.stubEnv("M0A_PROVIDER", "demo");
  const { runAgent } = await import("../src/main/agent-runner");
  const { initSettingsStore, setSettings } = await import("../src/main/settings-handlers");
  initSettingsStore(join(s.dir, "settings.json"));
  // ⚠️ safeMode 必须走**设置**这一条路：setSettings 会把 M1E_SAFE_MODE 转发到环境变量
  // （`src/main/settings-handlers.ts:72`）——只 stub 环境变量会被它覆盖掉（safeMode:"off" ⇒ 删变量）。
  await setSettings({ autoMemory: false, autoVerify: false, subagentTools: false, safeMode });
  return runAgent({ workspace: s.workspace, logPath: join(s.dir, "run.jsonl"), message: "go", mode, askGate: s.gate });
}

function toolResults(events: AgentEvent[]): { ok: boolean; output: string; gate?: { layer?: string; verdict?: string } }[] {
  return events
    .filter((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result")
    .map((e) => ({ ok: e.ok, output: e.output, gate: (e as { gate?: { layer?: string; verdict?: string } }).gate }));
}

describe("读侧敏感路径门（主会话接线）", () => {
  it("read_file 读 .git/config ⇒ 出审批卡；人点「不」⇒ 凭据一个字都不进模型上下文", async () => {
    const s = await setup({ approve: false });
    const scriptPath = await script(s.dir, [
      { id: "r1", name: "read_file", args: { path: ".git/config" } },
    ]);
    const events = await runAgentWithScript(s, scriptPath, "default");
    expect(s.asked, "敏感路径的读必须出卡（此前主会话这条路上一次也没出过）").toContain("read_file");
    const results = toolResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok, "人拒绝了 ⇒ 工具没执行").toBe(false);
    expect(results[0]?.output, "凭据绝不能出现在给模型的输出里").not.toContain(SECRET);
  });

  it("read_file 读普通文件 ⇒ 不出卡（不抬高文件工具的基线风险）", async () => {
    const s = await setup({ approve: false });
    const scriptPath = await script(s.dir, [
      { id: "r1", name: "read_file", args: { path: "notes.txt" } },
    ]);
    const events = await runAgentWithScript(s, scriptPath, "default");
    expect(s.asked, "普通文件不该弹卡").toEqual([]);
    const results = toolResults(events);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.output).toContain("普通文件");
  });

  it("grep 扫 .git 子树 ⇒ 出审批卡（递归扫描面：参数是目录，覆盖面是整棵子树）", async () => {
    const s = await setup({ approve: false });
    const scriptPath = await script(s.dir, [
      { id: "g1", name: "grep", args: { pattern: "FAKE_CREDENTIAL", path: ".git" } },
    ]);
    const events = await runAgentWithScript(s, scriptPath, "default");
    expect(s.asked).toContain("grep");
    expect(toolResults(events)[0]?.output ?? "").not.toContain(SECRET);
  });

  it("只读档同样出卡（只读 ≠ 无门：读出去一样是外泄）", async () => {
    const s = await setup({ approve: false });
    const scriptPath = await script(s.dir, [
      { id: "r1", name: "read_file", args: { path: ".git/config" } },
    ]);
    const events = await runAgentWithScript(s, scriptPath, "read-only");
    expect(s.asked, "只读档也必须出卡").toContain("read_file");
    expect(toolResults(events)[0]?.output ?? "").not.toContain(SECRET);
  });

  it("人点「是」⇒ 放行（门是问人，不是替人决定）", async () => {
    const s = await setup({ approve: true });
    const scriptPath = await script(s.dir, [
      { id: "r1", name: "read_file", args: { path: ".git/config" } },
    ]);
    const events = await runAgentWithScript(s, scriptPath, "default");
    expect(s.asked).toContain("read_file");
    const results = toolResults(events);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.gate?.verdict).toBe("approved");
  });
});

describe("安全模式 gate 的范围是**写向**（读侧三把不该被它拦）", () => {
  it("安全模式开着时读普通文件仍不出卡（这道门是「写前强制审批」，不是「每次读都问」）", async () => {
    const s = await setup({ approve: true, safeMode: "gate" });
    const scriptPath = await script(s.dir, [
      { id: "r1", name: "read_file", args: { path: "notes.txt" } },
    ]);
    const events = await runAgentWithScript(s, scriptPath, "default", "gate");
    expect(s.asked, "安全模式把每次读都变成一张卡) ⇒ 人会闭眼点允许，反而更危险").toEqual([]);
    expect(toolResults(events)[0]?.ok).toBe(true);
  });

  it("安全模式开着时写文件照样出卡（这道门的语义没被削弱）", async () => {
    const s = await setup({ approve: true, safeMode: "gate" });
    const scriptPath = await script(s.dir, [
      { id: "w1", name: "write_file", args: { path: "out.txt", content: "x" } },
    ]);
    await runAgentWithScript(s, scriptPath, "default", "gate");
    expect(s.asked).toContain("write_file");
  });
});

describe("接线棘轮（源文本对账）", () => {  it("读侧三把在 installAppTools 里都被 gatedTool 包着（不包＝权限门整条缺席）", () => {
    const runner = readFileSync(join(import.meta.dirname, "..", "src", "main", "agent-runner.ts"), "utf8");
    const unwrappedIn = (src: string, names: readonly string[]): string[] =>
      names.filter((n) => !src.includes(`TOOLS.${n} = gatedTool("${n}", TOOLS.${n})`));
    expect(unwrappedIn(runner, ["read_file", "grep", "glob"])).toEqual([]);
    // 反向对照：检查器在假源文本上必须认得出缺的那把（否则这一格是恒真的摆设）
    const fake = 'TOOLS.read_file = gatedTool("read_file", TOOLS.read_file);';
    expect(unwrappedIn(fake, ["read_file", "grep", "glob"])).toEqual(["grep", "glob"]);
  });
});
