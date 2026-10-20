// supervise：连败之后**通过**的那一环，改动必须落进主干（2026-10-19 独立评审追出的 MEDIUM）。
//
// 缺陷形状：重复闸（"同 (role, task-hash) 重复 ≥3 次 ⇒ 强制 escalate"）数的是**上一环的失败**，
// 旧实现把这个计数原样递给**下一环的裁决**——哪怕下一环**通过了**：
//   连败三环 → 第四环 verdict=pass → 仍被 escalate ⇒ 父会话拿到"已升级人工裁决"（一份"失败"的
//   回执），而那一环明明做对了，它的 worktree 被留着等人工合并 ⇒ **主干永远拿不到这次改动**。
// 实测（end-to-end）：主仓没有那个文件。
//
// 重复闸要防的是"**同一件事反复失败**还一直重试"（supervisor-check B2 那三格用的都是
// verdict:"fail"）——通过了就没有可防的循环（这一环就是终点）。
// 修法在**caller**：通过的那一环递 0（决策函数逐字未动，它的单元契约由门钉着）。
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Orchestrator, scriptedWorkerModel } from "../src/agent/orchestrator";
import type { AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";
import type { VerifyHook } from "../src/agent/verify";

const dirs: string[] = [];
const run = (cwd: string, args: string[]): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    execFile("git", args, { cwd }, (err) => (err === null) ? resolve() : reject(err));
  });

async function makeTempRepo(parent: string, tag: string): Promise<string> {
  const ws = join(parent, "repo-" + tag);
  await mkdir(ws, { recursive: true });
  await run(ws, ["init"]);
  await run(ws, ["config", "user.email", "anchor@local"]);
  await run(ws, ["config", "user.name", "supervise-anchor"]);
  await writeFile(join(ws, "README.md"), "seed\n", "utf8");
  await run(ws, ["add", "-A"]);
  await run(ws, ["commit", "-m", "seed"]);
  return ws;
}

const RING_SCRIPT: ModelOutput[] = [
  { type: "tool_call", id: "c1", name: "write_file", args: { path: "note.txt", content: "changed by the ring\n" } },
  { type: "assistant_message", content: "已按要求改完 note.txt。" },
];

describe("supervise：连败之后通过的那一环，改动要落进主干", () => {
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it(
    "★前三环失败、第四环通过 ⇒ 改动落进主干（旧实现：被 escalate 升级，主干拿不到）",
    { timeout: 180_000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "supervise-repeat-"));
      dirs.push(root);
      const repo = await makeTempRepo(root, "repeat");
      const events: AgentEvent[] = [];
      // 前三环的验证都**失败**且失败文本**逐字相同**（⇒ 重复闸的 key 相同，计数累加到 3），
      // 第四环通过。三次失败的理由串必须一模一样——那是 key 的一部分。
      let ring = 0;
      const failingHook: VerifyHook = {
        async run() {
          ring += 1;
          if (ring <= 3) return { ok: false, results: [{ command: "anchor-check", ok: false, output: "同样的失败" }] };
          return { ok: true, results: [{ command: "anchor-check", ok: true, output: "all green" }] };
        },
      };
      const orch = new Orchestrator({
        logPath: join(root, "events.jsonl"),
        workspace: repo,
        parentMode: "default",
        emit: async (e) => { events.push(e); },
        modelFor: () => scriptedWorkerModel(RING_SCRIPT),
        workerVerify: () => failingHook,
      });
      const spawnP = orch.spawn(
        { mode: "supervise", task: "把 note.txt 换成一句话", supervise: { maxStages: 6 } },
        { callId: "sup-repeat" },
      );
      const requested = await new Promise<boolean>((resolve) => {
        const started = Date.now();
        const tick = (): void => {
          if (events.some((e) => e.type === "approval_requested")) return resolve(true);
          if (Date.now() - started > 15_000) return resolve(false);
          setTimeout(tick, 25);
        };
        tick();
      });
      expect(requested, "审批卡没落流 ⇒ 链根本没跑起来").toBe(true);
      const apr = events.find((e) => e.type === "approval_requested") as Extract<AgentEvent, { type: "approval_requested" }>;
      expect(orch.decideWorkerApproval(apr.id, true, "once").ok).toBe(true);
      const res = await spawnP;
      await orch.waitAll(30_000);
      const output = res.output ?? "";

      // 第四环通过了 ⇒ 裁决必须是 accept（合并），不是 escalate（升级人工裁决）
      expect(output, "通过的那一环被升级人工裁决了 ⇒ 改动没落进主干").not.toContain("已升级人工裁决");
      expect(output.includes('"merged":true'), "合并没发生：output=" + output.slice(0, 200)).toBe(true);
      // 主干上真的有那个文件
      const onDisk = await readFile(join(repo, "note.txt"), "utf8").catch(() => "");
      expect(onDisk, "主干上没有 note.txt ⇒ 这一环的改动没落地").toContain("changed by the ring");
    },
  );
});
