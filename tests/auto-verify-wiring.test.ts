// 能力 5 收束闸的**中间那一棒**（任务 #55）。两头各自早有判卷：读盘回退在 `tests/settings.test.ts`，
// 那一拍本身在 `tests/loop.test.ts` / `context-auto-verify-note.test.ts`——但把两者接起来的那一行
// （`src/main/agent-runner.ts:1559`：`autoVerify: over.autoVerify ?? (await store().get()).autoVerify`）
// 此前零观察着。动因是 2026-09-23 的裁决 6（§483 要求 lint/test 两拍默认开）：翻完默认之后
// "这条已生效"只到**装配完成**——实测 `pnpm e2e` 日志里那一拍出现 0 次。
//
// 本文件把链拆成三格量。②那一格修正了一个我此前写进文档的误判：
//   ① 直接 `runAgent({autoVerify:true})` ⇒ 那一拍**会**发生（真跑了配置里的命令）；
//   ② 走生产入口 `handleAgentRun` + 无人值守 + 没有批条 ⇒ 先被权限门拒写，
//      `wroteThisRun` 为假 ⇒ 那一拍**正确地**不补。我先前把它读成"生产入口那条路从不触发"的缺陷，
//      错了；那条误判同时说明"e2e 里 0 次出现"也不是缺陷证据（剧本自己调了 verify ⇒ 让位）。
//      ⇒ #55 剩下的正向观察是：**带批条**的 IPC 路径上要能看到那一拍（runner-gates 的 M1B_GATE_FLOW 有现成做法）。
//   ③ 代价上界与让位规则照旧成立（没可验面 ⇒ 零行为；模型自调过 ⇒ 不补第二拍）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAgentRun, initSessionsDir, initSettingsStore, runAgent } from "../src/main/agent-runner";
import { replay } from "../src/events";
import type { AgentEvent } from "../src/events";

let dir: string;
let seq = 0;
let scriptPath: string;

const WRITE = { type: "tool_call", id: "w1", name: "write_file", args: { path: "target.txt", content: "changed\n" } };
const TEXT = { type: "assistant_message", content: "改完了，可以直接收工。" };

const autoBeats = (events: AgentEvent[]) =>
  events.filter((e) => e.type === "verify_result" && e.auto === true);
const verifyResults = (events: AgentEvent[]) => events.filter((e) => e.type === "verify_result");

async function script(lines: unknown[]): Promise<void> {
  scriptPath = join(dir, `script-${String(seq++)}.jsonl`);
  await writeFile(scriptPath, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
}

async function settings(raw: Record<string, unknown>): Promise<void> {
  await writeFile(join(dir, "settings.json"), JSON.stringify(raw), "utf8");
}

/** 走生产入口跑一轮（剧本经 M3A_MAIN_SCRIPT 显式通道，不动冻结夹具），读回事件日志。 */
async function runViaIpc(overrides: Record<string, unknown> = {}): Promise<AgentEvent[]> {
  vi.stubEnv("M3A_MAIN_SCRIPT", scriptPath);
  const logPath = join(dir, `events-${String(seq++)}.jsonl`);
  const res = await handleAgentRun(
    { message: "改一下 target", mode: "auto" },
    { workspace: dir, logPath, unattended: true, ...overrides },
  );
  expect(res.ok, JSON.stringify(res)).toBe(true);
  return replay(logPath);
}

beforeEach(async () => {
  dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "auto-verify-wiring-"));
  await mkdir(join(dir, ".agent"));
  // 仓库有可验面：没有它，那一拍本就该整段跳过（下面第三条用例正是量这件事）
  await writeFile(
    join(dir, ".agent/config.json"),
    JSON.stringify({ verify: { lint: ["printf LINT > lint-ran"], test: ["printf TEST > test-ran"] } }),
    "utf8",
  );
  await script([WRITE, TEXT]);
  vi.stubEnv("M0A_PROVIDER", "mock");
  vi.stubEnv("M1E_SAFE_MODE", "off");
  vi.stubEnv("DSH_APPDATA", dir);
  vi.stubEnv("M2E_USER_PLUGINS", join(dir, "plugins"));
  vi.stubEnv("M2E_LOOSE_SKILLS", join(dir, "skills"));
  vi.stubEnv("M2E_PLUGIN_DATA", join(dir, "plugin-data"));
  vi.stubEnv("M2E_TRUST_FILE", join(dir, "trust.json"));
  initSettingsStore(join(dir, "settings.json"));
  initSessionsDir(join(dir, "sessions"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("能力 5 收束闸的装配链（runAgent 直调 vs 生产入口）", () => {
  it("① 直接 runAgent(autoVerify:true) ⇒ 那一拍真发生：落 verify_result{auto:true} 且真跑了配置里的命令", async () => {
    vi.stubEnv("M3A_MAIN_SCRIPT", scriptPath);
    const events = await runAgent({
      workspace: dir,
      logPath: join(dir, `events-${String(seq++)}.jsonl`),
      message: "改一下 target",
      mode: "auto",
      unattended: true,
      autoVerify: true,
    });
    const beats = autoBeats(events);
    expect(beats.length).toBe(1);
    expect(beats[0]).toMatchObject({ callId: "harness-auto-verify", auto: true });
    expect(await readFile(join(dir, "test-ran"), "utf8")).toBe("TEST");
  });

  // 已知缺陷 #55（2026-09-23 量出，未修）：走生产入口时那一拍**从不**发生，
  // 即使把 autoVerify:true 放进 overrides 绕开 settings 读也一样 ⇒ 掉点在 `handleAgentRun` 的
  // 那次 runAgent 调用与 `runLoop` 之间，与 settings/默认值无关（settings 那头的读法另有判卷在 settings.test.ts）。
  // 这条断言钉的是**现态**：修好之后必须翻成正向断言（一拍 == 1），别让它变成"看起来像设计"。
  // 我一度把这条读成"生产入口那条路那一拍从不发生"的缺陷——量错了：同一条路径上
  // `write_file` 先被权限门拒（auto 档 + 无人值守 + 无批条 ⇒ fail-close），`wroteThisRun` 因此为假，
  // 那一拍**正确地**不补。所以这里钉的是真实形状；"带批条的 IPC 路径上那一拍会补"这半边正向观察仍在 #55。
  it("② auto + 无人值守 + 无批条 ⇒ 写被门拒，那一拍正确地不补（零行为，不是缺陷）", async () => {
    await settings({ provider: "demo", safeMode: "off" }); // settings 侧读到 true（读法另有判卷在 settings.test.ts）
    const events = await runViaIpc({ autoVerify: true });
    const results = events.filter((e) => e.type === "tool_result");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((e) => e.ok === false)).toBe(true);
    expect(JSON.stringify(results)).toContain("permission denied");
    expect(verifyResults(events).length).toBe(0);
    expect(autoBeats(events).length).toBe(0);
  });

  it("③a 代价上界：仓库没有可验面时零行为（这条不许被翻默认顺带打开）", async () => {
    await rm(join(dir, ".agent/config.json"), { force: true });
    vi.stubEnv("M3A_MAIN_SCRIPT", scriptPath);
    const events = await runAgent({
      workspace: dir,
      logPath: join(dir, `events-${String(seq++)}.jsonl`),
      message: "改一下 target",
      mode: "auto",
      unattended: true,
      autoVerify: true,
    });
    expect(verifyResults(events).length).toBe(0);
  });

  it("③b 至多一拍：模型自调过 verify 就让位（那一拍不补第二次）", async () => {
    await script([WRITE, { type: "tool_call", id: "v1", name: "verify", args: {} }, TEXT]);
    vi.stubEnv("M3A_MAIN_SCRIPT", scriptPath);
    const events = await runAgent({
      workspace: dir,
      logPath: join(dir, `events-${String(seq++)}.jsonl`),
      message: "改一下 target",
      mode: "auto",
      unattended: true,
      autoVerify: true,
    });
    const all = verifyResults(events);
    expect(all.length).toBeGreaterThan(0); // 模型自己那一拍落了
    expect(all.some((e) => e.auto === true)).toBe(false); // harness 不补第二拍
  });
});
