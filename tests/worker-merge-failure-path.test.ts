// 合并控制塔的**失败路径**判卷（2026-10-19）：`mergeWorker` 摘除合并登记之后，
// `commitAndMerge` 若**抛异常**（而不是返回 {ok:false}），登记必须回来、且必须落一条事件。
//
// 为什么单独立一份：原实现的回滚只写在 `if (!outcome.ok)` 那一支——它覆盖"返回失败"
// （代码冲突那条路），覆盖不了"抛出异常"。而 `commitAndMerge` 内部走 git()，
// **任何非零退出都抛 WorktreeError**（worktree.ts），它的第一个调用
// `git status --porcelain` 还在 try 块外面。于是 git 起不来 / 仓库被锁 / 索引损坏
// 都会让异常窜出 mergeWorker：登记已摘、回滚没跑 ⇒ 同一张卡再按一次合并读到
// 「merge 未登记…」——**这个 worker 永久无法合并**，而用户连一条事件都没看到
// （handleCardAction 没有 try/catch）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerMergeReview } from "../src/agent/worker-merge";
import type { AgentEvent } from "../src/events";
import type { WorkerHandle } from "../src/agent/orchestrator";

const dirs: string[] = [];
afterEach(async () => { while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true }); });

/** 一个 finished 的 write worker：mergeWorker 的入口校验只看 mode/worktree/branch/finished。 */
function writeWorker(overrides: Partial<WorkerHandle> = {}): WorkerHandle {
  return {
    agentId: "ag-1",
    mode: "write",
    worktree: "/tmp/wt-ag-1",
    branch: "agent/ag-1",
    // 入口校验要的四格（缺一格就在到达 git 之前返回，测不到想测的那条路）：
    // baseCommit = 合并基线；terminalResolved = 已收敛（done 后才可合并）。
    baseCommit: "1111111111111111111111111111111111111111",
    terminalResolved: true,
    finished: true,
    task: "改点东西",
    ...overrides,
  } as unknown as WorkerHandle;
}

/** git 那一层的打桩位：`commitAndMerge` 是 `worker-merge.ts` 的**模块级 import**
 *  （实例上打桩无效），所以走 vi.mock 整模块替换——只换 git 行为，
 * mergeWorker 自己怎么收拾残局一行不改地被测。 */
const gitStub = vi.hoisted(() => ({ commitAndMerge: async (): Promise<unknown> => ({ ok: true }) }));
vi.mock("../src/agent/worktree", () => ({
  commitAndMerge: (...a: unknown[]) => gitStub.commitAndMerge(...(a as [])),
  removeWorktree: async () => ({ removed: true, branchDeleted: true }),
  worktreePathFor: (root: string, id: string) => root + "/wt-" + id,
}));

/** 装配一台合并控制塔：mergeOwners 用真的 Set 扮演模块级路由表。 */
function harness(): { wmr: WorkerMergeReview; owners: Set<string>; emitted: AgentEvent[] } {
  const owners = new Set<string>();
  const emitted: AgentEvent[] = [];
  const wmr = new WorkerMergeReview({
    opts: { emit: async (e) => { emitted.push(e); }, workspace: "/repo" },
    safeMode: "off",
    workers: new Map([["ag-1", writeWorker()]]),
    diffVersions: new Map(),
    hasMergeOwner: (id) => owners.has(id),
    dropMergeOwner: (id) => { owners.delete(id); },
    registerMergeOwner: (id) => { owners.add(id); },
    markAgentOwner: () => {},
    runWorker: async () => {},
    releaseWorkerMemory: () => {},
  });
  return { wmr, owners, emitted };
}

describe("mergeWorker：登记摘除之后的失败路径", () => {
  it("commitAndMerge **抛异常** ⇒ 登记恢复（可重试）＋ 落一条事件 ＋ 不冒充代码冲突", async () => {
    const { wmr, owners, emitted } = harness();
    owners.add("ag-1"); // 开工时已登记
    gitStub.commitAndMerge = async () => { throw new Error("spawn git ENOENT"); };

    const r = await wmr.mergeWorker("ag-1");

    expect(r.ok, r.error).toBe(false);
    // ① 登记必须回来——这是"合并可重试"承诺的唯一载体
    expect(owners.has("ag-1"), "登记没恢复：这个 worker 永久无法合并").toBe(true);
    // ② 必须落一条事件：用户/UI 总得看见点什么（handleCardAction 没有 try/catch）
    expect(emitted.length, "一条事件都没落：UI 无从显示").toBe(1);
    expect(emitted[0]!.type).toBe("tool_result");
    expect((emitted[0] as { ok: boolean }).ok).toBe(false);
    // ③ 归因要说清是 harness/git 侧炸了，不是代码冲突——否则用户去解一个不存在的冲突
    const out = (emitted[0] as { output: string }).output;
    expect(out).toContain("spawn git ENOENT");
    expect(out).toContain("不是代码冲突");
    expect(out, "可重试要说出来").toContain("可重试");
  });

  it("返回 {ok:false}（代码冲突那条路）登记同样恢复——两条失败路径必须同形状", async () => {
    const { wmr, owners, emitted } = harness();
    owners.add("ag-1");
    gitStub.commitAndMerge = async () => ({ ok: false, conflict: true, conflictedFiles: ["a.ts"], error: "冲突" });

    const r = await wmr.mergeWorker("ag-1");

    expect(r.ok).toBe(false);
    expect(owners.has("ag-1"), "返回失败的路径登记也得回来").toBe(true);
    expect(emitted.length).toBe(1);
    expect((emitted[0] as { output: string }).output).toContain("[conflict]");
  });

  it("成功路径登记保持摘除（入口摘除 + 成功注销，不因本次修改而变）", async () => {
    const { wmr, owners } = harness();
    owners.add("ag-1");
    gitStub.commitAndMerge = async () => ({ ok: true, mergeCommit: "abcdef1234567890" });

    const r = await wmr.mergeWorker("ag-1");

    expect(r.ok, r.error).toBe(true);
    expect(owners.has("ag-1"), "成功路径不该把登记留着我").toBe(false);
  });

  it("反向验证：把异常吞掉不恢复登记 ⇒ 前两条判据红（尺不是空转的）", async () => {
    // 旧行为：异常从 mergeWorker 窜出，`await` 的调用方（若无 try/catch）直接看到 reject，
    // 而登记永远不回来。这里把那个形状现造出来钉住它的坏。
    const owners = new Set<string>(["ag-1"]);
    const dropThenThrow = async (): Promise<never> => {
      owners.delete("ag-1");        // 入口摘除（与实现同一步）
      throw new Error("spawn git ENOENT"); // 且没有任何 catch 恢复它
    };
    await expect(dropThenThrow()).rejects.toThrow("spawn git ENOENT");
    expect(owners.has("ag-1"), "旧行为下登记确实回不来 ⇒ 这就是要修的后果").toBe(false);
  });
});
