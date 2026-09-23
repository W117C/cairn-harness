// supervise 的**判据取料面**端到端（vitest 侧）：凭据优先、无凭据时保留现场。
//
// 为什么另开一份而不是只靠 `pnpm supervisor-check` 的 E8/E10：变异锚点只能配 vitest 文件
// （`scripts/mutate-verify.mjs` 的条目形状是 `{src, test, expectFail}`，跑的是 VITEST）。
// 那两格此前只有门在守——我在 2026-09-24 手工注入两次突变才确认它们真能红（把 caller 的
// `evidence:` 换成 undefined ⇒ 红 7 项；把 escalate 的 rejectRings 改回全量 ⇒ 只红现场那两条），
// 但"手工证过一次"和"门在守"是两件事：下一轮重构不会重放那两次注入。所以这里把同样的两格
// 落进 vitest，再给它们挂针脚。
// 与门侧的分工：E8 还断言提示词/审计面等宽面，这里只钉「判据从哪来」与「现场在不在」两件事。
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Orchestrator, scriptedWorkerModel } from "../src/agent/orchestrator";
import type { AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";
import type { VerifyHook } from "../src/agent/verify";

const dirs: string[] = [];
const run = (cwd: string, args: string[]): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    execFile("git", args, { cwd }, (err) => (err === null ? resolve() : reject(err)));
  });

/** 一次性 git repo（seed 一个初始提交）：supervise 的 write 环要有真 worktree，必须有 HEAD 可分叉。 */
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

/** 跑一轮 supervise：批准第一张卡，等链终态。返回 spawn 回执 + 事件流 + 工作区路径。 */
async function runSupervise(
  tag: string,
  script: ModelOutput[],
  verify: VerifyHook | undefined,
  maxStages: number,
): Promise<{ output: string; ok: boolean; events: AgentEvent[]; repo: string }> {
  const root = await mkdtemp(join(tmpdir(), "supervise-anchor-"));
  dirs.push(root);
  const repo = await makeTempRepo(root, tag);
  const events: AgentEvent[] = [];
  const orch = new Orchestrator({
    logPath: join(root, "events.jsonl"),
    workspace: repo,
    parentMode: "default",
    emit: async (e) => {
      events.push(e);
    },
    modelFor: () => scriptedWorkerModel(script),
    ...(verify === undefined ? {} : { workerVerify: () => verify }),
  });
  const spawnP = orch.spawn(
    { mode: "supervise", task: "把 note.txt 换成一句话", supervise: { maxStages } },
    { callId: "sup-" + tag },
  );
  const requested = await new Promise<boolean>((resolve) => {
    const started = Date.now();
    const tick = () => {
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
  await orch.waitAll(20_000);
  return { output: res.output ?? "", ok: res.ok, events, repo };
}

const greenHook: VerifyHook = {
  async run() {
    return { ok: true, results: [{ command: "anchor-check", ok: true, output: "all green" }] };
  },
};

const noVerdictLineScript: ModelOutput[] = [
  { type: "tool_call", id: "c1", name: "write_file", args: { path: "note.txt", content: "changed by the ring\n" } },
  { type: "assistant_message", content: "已按要求改完 note.txt（本环不写结论行）。" },
];

const landed = (repo: string): Promise<boolean> =>
  readFile(join(repo, "note.txt"), "utf8").then(() => true, () => false);

describe("supervise 判据取料面：caller 真读 artifacts.verified，升级时现场还在", () => {
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it(
    "绿凭据 + 报告没有 verdict 行 ⇒ accept 并合并落盘（判据来自 caller 读到的凭据，不是散文）",
    { timeout: 180_000 },
    async () => {
      const { output, ok, events, repo } = await runSupervise("evidence", noVerdictLineScript, greenHook, 3);
      expect(
        events.some((e) => e.type === "verify_result" && e.ok === true && e.auto === true),
        "自动拍没落流 ⇒ 凭据是读成了 undefined，这条就成了假绿",
      ).toBe(true);
      expect(ok && output.includes('"merged":true'), output.slice(0, 200)).toBe(true);
      expect(await landed(repo)).toBe(true);
    },
  );

  it(
    "改了盘但取不到凭据、报告也无契约行 ⇒ escalate，且回执点名保留的 worktree 仍在盘上",
    { timeout: 180_000 },
    async () => {
      const { output, ok, repo } = await runSupervise("scene", noVerdictLineScript, undefined, 3);
      expect(ok).toBe(false);
      expect(output).toContain("已升级人工裁决");
      expect(output, "回执说「保留了」却不给地址 ⇒ 这句话对模型和用户都不可执行").toContain("现场已保留：worktree=");
      const kept = await readdir(join(repo, ".agents")).then((d) => d.length > 0, () => false);
      expect(kept, "旧实现先 rejectRings（含最终环）删掉 worktree 再回去问人").toBe(true);
      expect(await landed(repo), "升级不等于合并：主 checkout 必须零污染").toBe(false);
    },
  );
});
