// 判卷 · 崩溃恢复「重派」必须把**基线与归因**原样带走
// （登记缺陷：核心 P1「崩溃恢复重派丢 worktree/基线/usage_model ⇒ 重派 worker 的 diff 比错基线、
//   token 成本没有模型归属」——第 642 页第五节登记，2026-10-22 修）
//
// 这条判卷只认**运行期行为**：真 git 仓 + 真编排器 ⇒ 真派一个 write worker ⇒ 崩溃期间主分支前移
// ⇒ 真重派（orch.respawn）⇒ 比对**重派产物**（重派出来的 worker 落的 agent_spawned）与**重派前**
// （原 worker 的 agent_spawned），再直接读新树的 HEAD 与它的 diff。
// 「源码里 respawnSpawnArgs 抄了那几个字段」不算判卷：字段名写在那儿 ≠ 重派产物上真带着、
// ≠ diff 真的比同一根基线。
//
// ---- worktree 语义裁决（2026-10-22，登记缺陷的三个字段之一必须显式裁决，写在这里而不是含糊过去）----
// 选 **②：新树，但基于原 base_commit 起**（干净树、基线正确）。不选 ①（沿用原来那棵树）的原因：
//   ① 与「重派 = 全新 agent_id」的设计有张力——worktree 路径是按 agent_id 推的
//   （`worktreePathFor(root, agentId)`），沿用旧树就得让合并控制塔（worker-merge.ts）也改口径，
//   而那一层不在本次授权面内；更要紧的是**恢复卡的文案已经写死了另一种语义**：
//   「write worker 的旧 worktree 走孤儿列表（可清理，不自动删）」（src/main/session-handlers.ts）——
//   沿用旧树会让这句文案变成假的。
//   ② 的代价说清楚：崩溃 worker 那棵树里**未提交**的半截改动不会被续用（它留在旧树里，用户可从孤儿
//   列表里取回）；重派是「从原基线重来一遍」，不是「在半截树上接着写」。
//   ② 保住的正是登记缺陷点名的两件：**diff 的比对面**（原 base_commit）与**token 归因**（原模型档）。
// ⇒ 判卷因此断言：重派产物上的 base_commit / usage_model 与崩溃前**逐字相等**；worktree 是**新树**
//   （≠ 崩溃前那棵），但新树的 HEAD 必须**就是原 base_commit**（⇒ 崩溃期间别人的提交不会混进
//   这次 worker 的 diff，⇒ 「不比错基线」有运行期形状，不是源码里的一句话）。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, scriptedWorkerModel, type SpawnArgs } from "../src/agent/orchestrator";
import { respawnArgsFrom } from "../src/agent/recovery";
import { worktreeDiff } from "../src/agent/worktree";
import type { WorkerModel } from "../src/agent/worker-model";
import type { ModelOutput } from "../src/providers";

const exec = promisify(execFile);

type SpawnedEvent = Extract<AgentEvent, { type: "agent_spawned" }>;

/** 一路"真拨号"形状的模型：不打 scripted 标 ⇒ 编排器会算归因键（usage_model）与价格标签；
 *  usageName 自述 ⇒ 归因键在 agent_spawned 上读得到（探针实测：注入面自带 usageName 时事件上就有）。 */
function diallingModel(usageName: string): WorkerModel {
  const model: WorkerModel = async function* () {
    yield { type: "assistant_message", content: "## 结论\n做完了。" } as ModelOutput;
  };
  model.usageName = usageName;
  return model;
}

let work = "";
let repo = "";
let logPath = "";

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "respawn-baseline-"));
  repo = join(work, "repo");
  await mkdir(repo, { recursive: true });
  const g = (...args: string[]): Promise<{ stdout: string }> => exec("git", args, { cwd: repo });
  await g("init");
  await g("config", "user.email", "judge@example.com");
  await g("config", "user.name", "judge");
  await writeFile(join(repo, "README.md"), "line1\n", "utf8");
  await g("add", ".");
  await g("commit", "-m", "init");
  logPath = join(work, "events.jsonl");
  await writeFile(logPath, "", "utf8");
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true }).catch(() => {});
});

describe("崩溃恢复重派：基线（diff 比对面）与归因模型原样带走", () => {
  it("重派产物：base_commit / usage_model 与崩溃前逐字相等；新树但基于原 base_commit 起（语义②）", async () => {
    const events: AgentEvent[] = [];
    let dial = 0;
    const orch = new Orchestrator({
      logPath,
      workspace: repo,
      parentMode: "default",
      emit: async (e) => {
        events.push(e);
        await createEventLog(logPath).append(e);
      },
      // 第一趟 A 档；重派那趟解析到了 B 档（模拟"崩溃期间模型解析变了"）——
      // 归因键要靠**携带**才守得住，不是靠重算。
      modelFor: () => diallingModel(dial++ === 0 ? "judge-model-a" : "judge-model-b"),
      approvalTimeoutMs: 100,
    });

    const first = await orch.spawn({ mode: "write", task: "改 README" } as SpawnArgs, { callId: "c1" });
    expect(first.ok).toBe(true);
    await orch.waitAll(15_000);
    const spawned1 = events.find((e) => e.type === "agent_spawned") as SpawnedEvent;
    expect(spawned1.worktree).toBeTruthy();
    expect(spawned1.base_commit).toBeTruthy();
    expect(spawned1.usage_model).toBe("judge-model-a");
    const originalBase = spawned1.base_commit!;

    // 崩溃期间世界前进了：主分支多一个提交 ⇒ "重派 worker 的 diff 比错基线"从此是具体的
    // （世界不动的话，两次派活的基线恰好相等，判卷没有分辨力）。
    await writeFile(join(repo, "OTHER.md"), "other\n", "utf8");
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-m", "others moved on"], { cwd: repo });
    const mainHead = (await exec("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    expect(mainHead).not.toBe(originalBase);

    // 真·重派：走 orch.respawn（恢复卡「重派」点的那条路）。
    const rr = await orch.respawn(respawnArgsFrom(spawned1), { callId: "respawn-1" });
    expect(rr.ok).toBe(true);
    await orch.waitAll(15_000);
    const spawnedAll = events.filter((e) => e.type === "agent_spawned") as SpawnedEvent[];
    const spawned2 = spawnedAll[spawnedAll.length - 1]!;

    // ① 既有契约：重派仍是全新 agent_id（V1 无热恢复）。
    expect(spawned2.agent_id).not.toBe(spawned1.agent_id);
    // ② 语义②：重派 worker 拿**新树**（崩溃 worker 的旧树走孤儿列表，与恢复卡文案一致）。
    expect(spawned2.worktree).toBeTruthy();
    expect(spawned2.worktree).not.toBe(spawned1.worktree);
    // ③ 但新树**基于原 base_commit 起**：它的 HEAD 就是原基线（不是此刻的 HEAD）。
    const newTreeHead = (
      await exec("git", ["-C", join(repo, spawned2.worktree!), "rev-parse", "HEAD"])
    ).stdout.trim();
    expect(newTreeHead).toBe(originalBase);
    expect(newTreeHead).not.toBe(mainHead);
    // ④ 事件上报的 diff 比对面 = 原基线（带走，不重算）。
    expect(spawned2.base_commit).toBe(originalBase);
    // ⑤ 「不比错基线」的运行期形状：重派 worker 的 diff 里**没有**第三方提交。
    const diff = await worktreeDiff(join(repo, spawned2.worktree!), originalBase);
    expect(diff).not.toContain("OTHER.md");
    // ⑥ 归因模型带走原档（不按此刻的解析重算）——注入面在两趟之间换了模型。
    expect(spawned2.usage_model).toBe("judge-model-a");
  }, 60_000);

  it("反控：普通派活的口径不变（基线仍取此刻的 HEAD，树也起在 HEAD）", async () => {
    const events: AgentEvent[] = [];
    const orch = new Orchestrator({
      logPath,
      workspace: repo,
      parentMode: "default",
      emit: async (e) => {
        events.push(e);
        await createEventLog(logPath).append(e);
      },
      modelFor: () => diallingModel("judge-model-a"),
      approvalTimeoutMs: 100,
    });
    const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    const spawned = await orch.spawn({ mode: "write", task: "改 README" } as SpawnArgs, { callId: "c1" });
    expect(spawned.ok).toBe(true);
    await orch.waitAll(15_000);
    const s1 = events.find((e) => e.type === "agent_spawned") as SpawnedEvent;
    expect(s1.base_commit).toBe(head);
    const treeHead = (await exec("git", ["-C", join(repo, s1.worktree!), "rev-parse", "HEAD"])).stdout.trim();
    expect(treeHead).toBe(head);
  }, 60_000);

  it("反控：剧本通道不硬造 usage_model（原 worker 没有，重派也不许凭空长出）", async () => {
    const events: AgentEvent[] = [];
    const orch = new Orchestrator({
      logPath,
      workspace: repo,
      parentMode: "default",
      emit: async (e) => {
        events.push(e);
        await createEventLog(logPath).append(e);
      },
      modelFor: () => scriptedWorkerModel([{ type: "assistant_message", content: "## 结论\n做完了。" }]),
      approvalTimeoutMs: 100,
    });
    const first = await orch.spawn({ mode: "write", task: "改 README" } as SpawnArgs, { callId: "c1" });
    expect(first.ok).toBe(true);
    await orch.waitAll(15_000);
    const spawned1 = events.find((e) => e.type === "agent_spawned") as SpawnedEvent;
    expect(spawned1.usage_model).toBeUndefined();

    const rr = await orch.respawn(respawnArgsFrom(spawned1), { callId: "respawn-1" });
    expect(rr.ok).toBe(true);
    await orch.waitAll(15_000);
    const spawnedAll = events.filter((e) => e.type === "agent_spawned") as SpawnedEvent[];
    const spawned2 = spawnedAll[spawnedAll.length - 1]!;
    expect(spawned2.usage_model).toBeUndefined();
    // 剧本通道的重派仍要是可执行的（基线照样带走：diff 比对面 = 原基线）。
    expect(spawned2.base_commit).toBe(spawned1.base_commit);
  }, 60_000);
});
