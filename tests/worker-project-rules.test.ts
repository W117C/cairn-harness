// 判卷 · 项目规则库必须真的管到 worker（#32：构造口里 `rules` 那一半此前的观测者 = 0）。
//
// 为什么必须是这一格：`buildSessionOrchestrator` 把 `rules` 传给编排器（P0-2 的原话是
// 「否则项目级 deny/ask 规则对 worker 全表失效」），而**实测把那一行换成 `rules: []`，
// 全量 236 files / 2523 tests 一条都不红**（2026-09-24 量过，见 PROGRESS 能力 50）。
// 原因：端到端那条判卷（`tests/judge-frozen-gate.test.ts` 的 worker 面）自己 `new Orchestrator({...})`
// 并直传 modelFor，绕开了产品入口的构造口 ⇒ "装配存在"又被当成"这格有人守"（规则 118 的镜像）。
//
// ⇒ 这条用例走真产品入口：`handleAgentRun` → `runAgent` → `buildSessionOrchestrator` → spawn_agent
//   → write worker 的 `write_file`。worker 模型用仓里既有的演示通道（`M3A_AGENTS_DEMO=1` +
//   `fixtures/agents/*.jsonl`），**不花真钱**。
// 两格各钉一半：deny ⇒ 拒且拒因点名规则 id（`deny:write_file`）；allow ⇒ 真写成功。
// 反向那格不是装饰：无规则库时 worker 的写会走审批协议，无人值守下超时也是 ok:false ⇒
// 只钉"被拒"那一格，`rules: []` 的突变照样"红得对"。
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

import { handleAgentRun, initSettingsStore } from "../src/main/agent-runner";
import type { AgentEvent } from "../src/events";

const execGit = promisify(execFile);
const dirs: string[] = [];

afterAll(async () => {
  delete process.env.M3A_MAIN_SCRIPT;
  delete process.env.M3A_AGENTS_DEMO;
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

/** 一个 git 仓库靶子（write worker 要真 worktree）。 */
async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wrk-rules-"));
  dirs.push(root);
  const repo = join(root, "repo");
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, "README.md"), "line1\n", "utf8");
  const g = (...args: string[]): Promise<unknown> => execGit("git", args, { cwd: repo });
  await g("init");
  await g("config", "user.email", "wrk@test.local");
  await g("config", "user.name", "WRK Test");
  await g("add", ".");
  await g("commit", "-m", "init");
  return repo;
}

type WriteOutcome = { ok: boolean; verdict?: string; output: string };

/** 跑一场：主会话派一个 write worker，worker 的剧本（write-demo.jsonl）第一笔就是 write_file。
 *  `behavior` = 项目规则库里对 write_file 的那一条（deny / allow）——两格只差这一个字。 */
async function spawnAndWrite(behavior: "deny" | "allow"): Promise<WriteOutcome> {
  const home = await mkdtemp(join(tmpdir(), "wrk-home-"));
  dirs.push(home);
  const repo = await makeRepo();
  initSettingsStore(join(home, "settings.json"));
  await writeFile(join(home, "settings.json"), JSON.stringify({ autoVerify: false }), "utf8");
  await mkdir(join(repo, ".agent"), { recursive: true });
  await writeFile(
    join(repo, ".agent", "permissions.json"),
    JSON.stringify({ rules: [{ behavior, tool: "write_file", scope: "always" }] }),
    "utf8",
  );
  // 主会话剧本：只派一个 write worker（模型名 = worker 剧本文件名，走演示通道），然后收口。
  const mainScript = join(home, "main.jsonl");
  await writeFile(
    mainScript,
    [
      { type: "tool_call", id: "sp-1", name: "spawn_agent", args: { mode: "write", task: "写一个示例配置文件", model: "write-demo.jsonl" } },
      { type: "assistant_message", content: "已派 worker 去写。" },
    ].map((o) => JSON.stringify(o)).join("\n") + "\n",
    "utf8",
  );
  process.env.M3A_MAIN_SCRIPT = mainScript;
  process.env.M3A_AGENTS_DEMO = "1";

  const seen: AgentEvent[] = [];
  const run = await handleAgentRun(
    { message: "派 worker 写配置文件", mode: "auto" },
    { workspace: repo, logPath: join(home, "events.jsonl"), unattended: true, onEvent: (e) => { seen.push(e); } },
  );
  expect(run.ok, JSON.stringify(run)).toBe(true);
  // worker 子流是**异步**落在主流上的：主 run 收束时它可能还没写那一笔。不等就会读到 0 条，
  // 而 0 条看起来跟"被规则拒了"一样像话 ⇒ 等到出现那一笔为止（等不到再红，红时带现场）。
  const isWorkerWrite = (e: AgentEvent): boolean => {
    if (e.type !== "tool_result" || (e as { agent_id?: string }).agent_id === undefined) return false;
    const call = seen.find((x) => x.type === "tool_call" && (x as { id: string }).id === (e as { callId: string }).callId) as
      | { name?: string }
      | undefined;
    return call?.name === "write_file";
  };
  const deadline = Date.now() + 30_000;
  while (!seen.some(isWorkerWrite) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const workerWrites = seen.filter(isWorkerWrite) as Array<{ ok: boolean; output?: string; gate?: { verdict?: string } }>;
  expect(workerWrites.length, "worker 面一次 write_file 都没发生 ⇒ 这一格根本没跑到被审的那件事（前置自检）").toBe(1);
  const w = workerWrites[0];
  return { ok: w.ok, verdict: w.gate?.verdict, output: w.output ?? "" };
}

describe("项目规则库管到 worker（经产品入口的构造口）", () => {
  it(
    "有 deny write_file 的项目规则 ⇒ worker 那笔写被拒，且拒因点名这条规则",
    { timeout: 300_000 },
    async () => {
      const r = await spawnAndWrite("deny");
      expect(r.ok, "worker 的写竟然成功了 ⇒ 构造口没把项目规则递下去（或规则没被 worker 那侧消费）").toBe(false);
      expect(r.verdict).toBe("denied");
      // 拒因点名规则 id：少了它，"被拒"可以是任何别的原因（worktree 路径、工具表摘除…）。
      expect(r.output, "拒因没点名规则 id ⇒ 拦它的不是项目规则，读数不可信").toContain("deny:write_file");
    },
  );

  it(
    "换成 allow 规则 ⇒ 同一份剧本真写成功（反向哨兵：上一条的红不能是任何别的原因）",
    { timeout: 300_000 },
    async () => {
      // 反向格不能省：项目里没有规则库时 worker 的写会走审批协议，无人值守下 60s 超时 →
      // 同样是一条 ok:false。只钉"被拒"那一格的话，`rules: []` 的突变也能"看起来红得对"。
      const r = await spawnAndWrite("allow");
      expect(r.ok, "allow 规则下写不成功 ⇒ 两格同形，上面那条判据没有分辨力").toBe(true);
      expect(r.verdict).not.toBe("denied");
    },
  );
});
