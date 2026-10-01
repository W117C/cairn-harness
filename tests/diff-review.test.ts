// M8 增量判卷：worker diff 的逐文件接受/拒绝——判定、候选、选择解析、还原计划，
// 以及**真 git 夹具**上的还原动作（在 tmp 仓库里真建 worktree 改动，真跑 git checkout/rm）。
// 另钉一条跨文件棘轮：生产端（orchestrator 的 emit）与消费端（cli/fork-cli 的判定）
// 必须讲同一个 `[diff] v` 标记——2026-10-01 实测的断口正是两侧标记分家后没人发现。
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyReverts,
  isWorkerDiffReceipt,
  parsePorcelainZ,
  parseSelection,
  patchSectionOf,
  reviewActionFor,
  reviewCandidates,
  revertPlan,
  type RevertEntry,
} from "../src/agent/diff-review";
import { formatReplay } from "../src/agent/fork-cli";
import type { AgentEvent } from "../src/events";

const exec = (cmd: string, args: string[], cwd?: string): string =>
  execFileSync(cmd, args, { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] });

const ROOT = exec("git", ["rev-parse", "--show-toplevel"]).trim();

/** 真实形状的 diff 收据（callId=spawn 的 call id + `[diff] v` 正文头；与 outputs/ga-* 真语料同形）。 */
const realDiffReceipt = (): AgentEvent =>
  ({
    type: "tool_result",
    callId: "call_8f66c40e573e47478b3b64d5",
    agent_id: "worker-4",
    ok: true,
    output: "[diff] v1 vs 0a1b2c3d4e5f（worktree .agents/wt-worker-4，含未提交改动）\n## stat\n src/a.ts | 2 +-\n## patch\ndiff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;\n",
  }) as AgentEvent;

describe("isWorkerDiffReceipt：两侧讲同一个标记（含生产端源头钉）", () => {
  it("真实形状（spawn callId + `[diff] v` 头）认出；老兜底形状（diff- 前缀）也认出", () => {
    expect(isWorkerDiffReceipt(realDiffReceipt())).toBe(true);
    expect(isWorkerDiffReceipt({ type: "tool_result", callId: "diff-ag-1", agent_id: "ag-1", ok: true, output: "[diff] v1 …" } as AgentEvent)).toBe(true);
  });

  it("负控：普通 tool_result 不整块打（否则整个渲染面变刷屏）", () => {
    expect(isWorkerDiffReceipt({ type: "tool_result", callId: "c1", ok: true, output: "## patch\n不该整块打" } as AgentEvent)).toBe(false);
  });

  it("跨文件棘轮：orchestrator 的 emit 仍在写 `[diff] v` 头（改了标记就必须同步两边）", () => {
    const orch = readFileSync(join(ROOT, "src", "agent", "orchestrator.ts"), "utf8");
    expect(orch).toContain('"[diff] v"');
  });

  it("formatReplay 也按同一判定把 diff 压成形状行（真形状喂进去，不看 callId 前缀）", () => {
    const text = formatReplay([realDiffReceipt()]);
    expect(text).toContain("worker diff：1 文件 / 1 hunk / +1 −1 行");
    expect(text).not.toContain("diff --git");
  });
});

describe("reviewCandidates：待审阅 = write ∧ done ∧ 未决", () => {
  const base = (): AgentEvent[] =>
    [
      { type: "agent_spawned", agent_id: "w1", mode: "write", permission_mode: "auto", task: "改一下 A", worktree: "/tmp/wt/w1" },
      { type: "agent_result", agent_id: "w1", status: "done", summary: "done", artifacts: {} },
      { type: "agent_spawned", agent_id: "r1", mode: "read", permission_mode: "auto", task: "查一下" },
      { type: "agent_result", agent_id: "r1", status: "done", summary: "done", artifacts: {} },
      { type: "agent_spawned", agent_id: "w2", mode: "write", permission_mode: "auto", task: "改一下 B", worktree: "/tmp/wt/w2" },
      { type: "agent_spawned", agent_id: "w3", mode: "write", permission_mode: "auto", task: "改一下 C", worktree: "/tmp/wt/w3" },
      { type: "agent_result", agent_id: "w3", status: "done", summary: "done", artifacts: {} },
      { type: "card_action", card_id: "x", source_event_id: 7, card_type: "diff", action: "merge", target_agent_id: "w3" },
    ] as unknown as AgentEvent[];

  it("write∧done∧未决才进榜：read 排除、未 done 排除、已 merge/reject 的排除", () => {
    const cands = reviewCandidates(base());
    expect(cands.map((c) => c.agentId)).toEqual(["w1"]);
    expect(cands[0]).toMatchObject({ worktree: "/tmp/wt/w1", resultEventIndex: 2 });
  });

  it("reject 过的同样不再进榜（已决就是已决）", () => {
    const events = base();
    events.push({ type: "card_action", card_id: "y", source_event_id: 7, card_type: "diff", action: "reject", target_agent_id: "w1" } as AgentEvent);
    expect(reviewCandidates(events)).toEqual([]);
  });
});

describe("parsePorcelainZ / revertPlan：还原动作按状态分类", () => {
  it("-z 解析：改名条目带上来源路径（下一段必须被吃掉，不许变成幽灵文件）", () => {
    // 路径顺序按真 git 实测（`git mv old.txt new.txt; git status --porcelain -z` 的字节）：
    // **目的地在先、来源在后**（`R  new.txt\0old.txt\0`）——与人类可读格式的 `old -> new` 相反。
    const files = parsePorcelainZ(" M a.ts\0?? b.ts\0 D c.ts\0R  new.ts\0old.ts\0A  d.ts\0");
    expect(files).toEqual([
      { path: "a.ts", code: " M" },
      { path: "b.ts", code: "??" },
      { path: "c.ts", code: " D" },
      { path: "new.ts", code: "R ", from: "old.ts" },
      { path: "d.ts", code: "A " },
    ]);
  });

  it("还原计划：新增⇒删文件；改/删⇒checkout；改名⇒manual（不猜两步操作）；不在清单⇒manual", () => {
    const files = parsePorcelainZ(" M a.ts\0?? b.ts\0 D c.ts\0R  new.ts\0old.ts\0");
    const plan = revertPlan(files, ["a.ts", "b.ts", "c.ts", "new.ts", "ghost.ts"]);
    expect(plan).toEqual([
      { path: "a.ts", undo: "checkout" },
      { path: "b.ts", undo: "delete" },
      { path: "c.ts", undo: "checkout" },
      { path: "new.ts", undo: "manual", why: "改名/复制条目（需删新档+还原旧档两步，本工具不自动做）" },
      { path: "ghost.ts", undo: "manual", why: "不在 worktree 的变更清单里（可能已被回收）" },
    ]);
  });
});

describe("parseSelection：三种快捷与编号列表，非法不静默回落", () => {
  it("回车=跳过；a/r 两头；编号（含顿号/空格/重复）折算成两集合", () => {
    expect(parseSelection("", 3)).toBeNull();
    expect(parseSelection("  ", 3)).toBeNull();
    expect(parseSelection("a", 3)).toEqual({ accepted: [1, 2, 3], rejected: [] });
    expect(parseSelection("R", 3)).toEqual({ accepted: [], rejected: [1, 2, 3] });
    expect(parseSelection("1,3", 3)).toEqual({ accepted: [1, 3], rejected: [2] });
    expect(parseSelection("1、3 3", 3)).toEqual({ accepted: [1, 3], rejected: [2] });
    expect(parseSelection("2", 3)).toEqual({ accepted: [2], rejected: [1, 3] });
  });

  it("越界/非数字/空列表外的一切都给 error（绝不静默当成全接受）", () => {
    for (const bad of ["0", "4", "x", "1,x", "-1", "1.5"]) {
      const r = parseSelection(bad, 3);
      expect(r !== null && "error" in r, `${bad} 应报错`).toBe(true);
    }
  });

  it("reviewActionFor：全拒 ⇒ reject 卡；其余（含部分）⇒ merge 卡", () => {
    expect(reviewActionFor({ accepted: [], rejected: [1] })).toBe("reject");
    expect(reviewActionFor({ accepted: [1], rejected: [2] })).toBe("merge");
    expect(reviewActionFor({ accepted: [1, 2], rejected: [] })).toBe("merge");
  });

  it("patchSectionOf：取 `## patch` 之后的补丁段；老形状（无分节头）整段返回", () => {
    expect(patchSectionOf("[diff] v1 …\n## stat\n x | 1 +\n## patch\ndiff --git a/x b/x\n")).toBe("diff --git a/x b/x\n");
    expect(patchSectionOf("diff --git a/x b/x\n")).toBe("diff --git a/x b/x\n");
  });
});

describe("applyReverts：真 git 夹具（还原被拒、保住被收）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  const gitEnv = (cwd: string): void => {
    exec("git", ["-c", "init.defaultBranch=main", "init", "-q"], cwd);
    exec("git", ["config", "user.email", "t@t.invalid"], cwd);
    exec("git", ["config", "user.name", "t"], cwd);
  };

  it("被拒的改回原样、被拒的新档删掉；被接受的改动与删除原样保留", () => {
    const repo = mkdtempSync(join(tmpdir(), "dr-repo-"));
    dirs.push(repo);
    gitEnv(repo);
    writeFileSync(join(repo, "keep.txt"), "v1\n");
    writeFileSync(join(repo, "drop-mod.txt"), "base\n");
    writeFileSync(join(repo, "drop-del.txt"), "bye\n");
    exec("git", ["add", "-A"], repo);
    exec("git", ["commit", "-qm", "base"], repo);
    // worktree 里的四种改动
    writeFileSync(join(repo, "keep.txt"), "v2（被接受）\n");
    writeFileSync(join(repo, "drop-mod.txt"), "changed\n");
    rmSync(join(repo, "drop-del.txt"));
    writeFileSync(join(repo, "drop-new.txt"), "brand new\n");

    const st = exec("git", ["status", "--porcelain", "-z"], repo);
    const files = parsePorcelainZ(st);
    expect(files.map((f) => f.path).sort()).toEqual(["drop-del.txt", "drop-mod.txt", "drop-new.txt", "keep.txt"]);
    const plan = revertPlan(files, ["drop-mod.txt", "drop-new.txt"]);
    const r = applyReverts(repo, plan);
    expect(r.failed).toEqual([]);
    expect(r.manual).toEqual([]);
    expect(r.done.sort()).toEqual(["drop-mod.txt", "drop-new.txt"]);
    // 被拒：改回原样、新档没了
    expect(readFileSync(join(repo, "drop-mod.txt"), "utf8")).toBe("base\n");
    expect(() => readFileSync(join(repo, "drop-new.txt"), "utf8")).toThrow();
    // 被接受：改动与删除都还在（下一笔 add -A 提交才会带进合并）
    expect(readFileSync(join(repo, "keep.txt"), "utf8")).toBe("v2（被接受）\n");
    expect(() => readFileSync(join(repo, "drop-del.txt"), "utf8")).toThrow();
    const after = parsePorcelainZ(exec("git", ["status", "--porcelain", "-z"], repo));
    expect(after.map((f) => f.path).sort()).toEqual(["drop-del.txt", "keep.txt"]);
  });

  it("越界路径拒绝执行（包含性检查；防 plan 被改成 ../x 之类的注入面）", () => {
    const repo = mkdtempSync(join(tmpdir(), "dr-repo2-"));
    dirs.push(repo);
    gitEnv(repo);
    writeFileSync(join(repo, "a.txt"), "x\n");
    exec("git", ["add", "-A"], repo);
    exec("git", ["commit", "-qm", "base"], repo);
    const evil: RevertEntry = { path: "../evil.txt", undo: "delete" };
    const r = applyReverts(repo, [evil]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.error).toContain("越出 worktree");
    const outside = spawnSync("ls", [join(repo, "..", "evil.txt")], { encoding: "utf8" });
    expect(outside.status, "越界文件不该被创建/删除").not.toBe(0);
  });
});
