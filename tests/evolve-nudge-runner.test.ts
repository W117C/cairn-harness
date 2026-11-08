// agent-runner 真路径：active 的 on-signal 经验必须在**自动验证红**的回执里出现，
// 且归因 ids 落到同一事件。此前这一格只有 loop 级用例 + 源码行锚定；生产闭包
// （初始工具面/去重集/runner）整段断线时，两条都不会红。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { handleAgentRun, initSettingsStore } from "../src/main/agent-runner";
import type { AgentEvent } from "../src/events";
import { HARNESS_VERIFY_CALL_ID } from "../src/agent/loop";
import { newExperience } from "../src/agent/evolve/playbook";
import { appendPlaybookEvents } from "../src/main/evolve/playbook-store";
import { buildEvolveReport, formatEvolveReport } from "../src/main/evolve/report";

const dirs: string[] = [];
afterAll(async () => {
  delete process.env.M3A_MAIN_SCRIPT;
  for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

it("生产入口：自动验证红的回执带 active 的 verify:red 经验与归因 ids", { timeout: 120_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "evolve-nudge-runner-"));
  const workspace = await mkdtemp(join(tmpdir(), "evolve-nudge-ws-"));
  dirs.push(home, workspace);
  initSettingsStore(join(home, "settings.json"));
  await writeFile(join(home, "settings.json"), JSON.stringify({ autoVerifyRepair: true }), "utf8");
  await mkdir(join(workspace, ".agent"), { recursive: true });
  await writeFile(
    join(workspace, ".agent", "permissions.json"),
    JSON.stringify({ rules: [{ behavior: "allow", tool: "write_file", scope: "always" }] }),
    "utf8",
  );
  await writeFile(
    join(workspace, ".agent", "config.json"),
    JSON.stringify({ verify: { test: ["echo 'FAIL: 1 failed' && exit 1"] } }),
    "utf8",
  );

  const entry = newExperience({
    id: "exp_0123456789abcdef",
    kind: "warning",
    scope: { workspace },
    trigger: { when: "on-signal", signal: "verify:red" },
    body: "VERIFY_RED_LESSON：先复现再改",
    status: "active",
    evidenceEpisodes: ["ep_seed"],
    now: 1_000,
    expiresAt: null,
  });
  await appendPlaybookEvents(workspace, [{ v: 1, op: "add", ts: 1_000, entry, evidence: [], reason: "test" }]);

  const script = join(home, "main.jsonl");
  await writeFile(
    script,
    [
      { type: "tool_call", id: "w1", name: "write_file", args: { path: "src/a.ts", content: "x" } },
      { type: "assistant_message", content: "改完了。" },
      { type: "round_end" },
      { type: "assistant_message", content: "还在红，我再改一处。" },
      { type: "round_end" },
      { type: "tool_call", id: "w2", name: "write_file", args: { path: "src/fix.ts", content: "y" } },
      { type: "assistant_message", content: "这回真改完了。" },
    ].map((output) => JSON.stringify(output)).join("\n") + "\n",
    "utf8",
  );
  process.env.M3A_MAIN_SCRIPT = script;

  const seen: AgentEvent[] = [];
  const result = await handleAgentRun(
    { message: "让验证通过", mode: "auto" },
    {
      workspace,
      logPath: join(home, "events.jsonl"),
      unattended: true,
      trustedRepo: true,
      onEvent: (event) => { seen.push(event); },
    },
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);

  const auto = seen.find((event) => event.type === "tool_result" && event.callId === HARNESS_VERIFY_CALL_ID);
  expect(auto?.type).toBe("tool_result");
  if (auto === undefined || auto.type !== "tool_result") throw new Error("unreachable");
  expect(auto.output).toContain("VERIFY_RED_LESSON");
  expect(auto.nudgeExperienceIds).toEqual([entry.id]);

  const report = await buildEvolveReport(workspace, Date.now());
  expect(report.nudges.episodes).toBeGreaterThanOrEqual(1);
  expect(report.nudges.byId[entry.id]).toBeGreaterThanOrEqual(1);
  expect(formatEvolveReport(report)).toContain("快环提醒");
});
