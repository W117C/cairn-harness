// worktree 的纯判据面（2026-10-02 普查增补）。
//
// 立项动因（实测，不是印象）：`src/agent/worktree.ts` 337 行、**零**变异锚点，
// 而逐个导出查下来，12 个导出里**只有 2 个**在 `tests/` 里被点名过：
//   taskSlug / branchForAgent / createWorktree / linkGitignoredDirs /
//   commitAndMerge / removeWorktree / listWorktreeDirs / **orphanWorktrees** /
//   **cleanOrphanWorktree** / WORKTREE_SYMLINK_DIRS   —— 全部 0 处判卷。
//
// 其中两支是**删除决策**本身，后果不可逆：
//   · `orphanWorktrees`      —— 决定哪些 worktree 进「可清理」面板（agent-runner.ts:2499）
//   · `cleanOrphanWorktree`  —— 真的删目录 + 删分支（agent-runner.ts:2376）
// 而 `cleanOrphanWorktree` 里那道 glob 元字符白名单是审查 A6 专门加的
// （「目录名含 `[` `?` `*` 拼进 `branch --list` 会匹配全部 agent 分支并循环删除」）——
// 一道防**批量误删**的闸，零证人。
import { describe, expect, it } from "vitest";
import { branchForAgent, cleanOrphanWorktree, orphanWorktrees, taskSlug } from "../src/agent/worktree";

/** 事件流的最小形状（`orphanWorktrees` 只读这几个字段）。 */
type Ev = { type: string; agent_id?: string; status?: string; callId?: string; ok?: boolean };

describe("taskSlug：用户任务文本 ⇒ git 分支名", () => {
  it("正常文本：小写、非安全字符折叠成连字符、长度有界", () => {
    expect(taskSlug("Fix the failing test")).toBe("fix-the-failing-test");
    expect(taskSlug("修复失败用例")).toBe("修复失败用例"); // CJK 在允许集内，不该被抹成空
    expect(taskSlug("a".repeat(60)).length).toBeLessThanOrEqual(24);
  });

  // 这一格是承重的：slug 直接进 `git worktree add -b <branch>`。
  // 实测过 `../../etc/passwd` 这类输入不会产生 `..` 也不会产生 `/`。
  it("路径与命令注入形状不会产生 `..`、`/` 或前导 `-`", () => {
    for (const t of ["../../etc/passwd", "a;rm -rf /", "a`id`b", "a$HOME", 'a b"c\'d', "a\nb", "--force"]) {
      const s = taskSlug(t);
      expect(s, JSON.stringify(t)).not.toContain("..");
      expect(s, JSON.stringify(t)).not.toContain("/");
      expect(s.startsWith("-"), JSON.stringify(t)).toBe(false);
    }
  });

  it("折叠到空 ⇒ 落 `task`（不许产出空分支名）", () => {
    expect(taskSlug("")).toBe("task");
    expect(taskSlug("   ")).toBe("task");
    expect(taskSlug("!!!@@@###")).toBe("task");
  });

  it("截断后不留悬空连字符（否则分支名以 `-` 结尾）", () => {
    // 24 字截断恰好落在连字符上时，必须回退掉它。
    expect(taskSlug("a".repeat(23) + "-bbbb").endsWith("-")).toBe(false);
  });

  it("分支名恒带 `agent/` 前缀 ⇒ slug 里的内容永远不可能被 git 当成 flag", () => {
    expect(branchForAgent("--force", "w1")).toBe("agent/force-w1");
    expect(branchForAgent("修复", "worker-7")).toBe("agent/修复-worker-7");
  });
});

describe("orphanWorktrees：谁进「可清理」面板（删除决策的第一步）", () => {
  const dirs = ["wt-w1", "wt-w2", "wt-w3"];

  it("有 done/failed/cancelled 终态 ⇒ 不算孤儿", () => {
    for (const status of ["done", "failed", "cancelled"]) {
      const out = orphanWorktrees(dirs, [{ type: "agent_status", agent_id: "w1", status }]);
      expect(out, status).not.toContain("w1");
    }
  });

  it("非终态（running 等）仍算孤儿 —— 进程被杀遗留正是这一格要捞的", () => {
    const out = orphanWorktrees(dirs, [{ type: "agent_status", agent_id: "w1", status: "running" }]);
    expect(out).toContain("w1");
  });

  it("merge- / wt-cleanup- 收尾记录 ⇒ 不算孤儿（两条前缀都要认）", () => {
    expect(orphanWorktrees(dirs, [{ type: "tool_result", callId: "merge-w1" }])).not.toContain("w1");
    expect(orphanWorktrees(dirs, [{ type: "tool_result", callId: "wt-cleanup-w1" }])).not.toContain("w1");
  });

  // ↓↓↓ 本组是这个函数的**语义要害**，钉的是「失败的合并也算已收尾」这一条现状。
  // 为什么不改成「只有 ok:true 才算收尾」：合并冲突时 worktree **按设计保留**
  // （orchestrator 失败路径不调 removeWorktree，卡面明写「需在 worktree 内人工解决后重试」），
  // 若把它算成孤儿，用户会在清理面板看到它并按下删除 —— 那就把**还没合并的活儿删了**，
  // 比「面板上少列一个」严重得多。所以现状是**刻意**的，这里把它钉成显式契约，
  // 免得下一轮有人当 bug 顺手改掉。
  it("合并失败（ok:false）同样算已收尾 —— 刻意如此，改动前先读这一条", () => {
    // 入参类型**故意只列函数会读的字段**（`ok` 不在其中），而真实事件里 `tool_result` 是带 `ok` 的。
    // 所以这个 `ok:false` **不能删**：删了这条判卷就只证明了"给一个不带成败位的对象会怎样"，
    // 而它要钉的恰恰是「**函数不看 ok**——失败/成功的合并一视同仁算已收尾」。
    // 先落到变量再传：字面量直传会撞"多余属性"检查（TS2353）；那检查管的是**类型面**，
    // 不是这条契约——契约说的是函数**读不读** ok，所以要把带 ok 的真形状喂进去。
    const mergeFailed = { type: "tool_result", callId: "merge-w1", ok: false };
    const out = orphanWorktrees(dirs, [mergeFailed]);
    expect(out, "失败的合并**不**该进清理面板：冲突 worktree 还要人工处理").not.toContain("w1");
  });

  it("它**无条件**切掉前 3 个字符 ⇒ 调用方必须自己保证都有 `wt-` 前缀（实测耦合，不是 bug）", () => {
    // `orphanWorktrees` 的入参类型只说 `string[]`，函数体无条件 `n.slice("wt-".length)`。
    // 所以「scratch」会被切成「atch」——一个垃圾 agentId。
    //
    // 今天**不是**活 bug：唯一的生产调用方 `scanOrphanWorktrees`（agent-runner.ts:2499）
    // 先过 `listWorktreeDirs`，而它按 `startsWith("wt-")` 过滤后才传进来。
    // 但这条耦合是**隐式**的：谁将来绕过 `listWorktreeDirs` 直接喂盘上目录名，
    // 就会拿到「atch」这种 id，而它**能通过** `cleanOrphanWorktree` 的字符白名单
    // ⇒ 去删一个叫 `wt-atch` 的 worktree 与 `agent/*-atch` 分支。
    //
    // 按「不为了看起来更整齐而改生产代码」，此处**只把耦合钉成显式契约**：今天无活 bug 可修，
    // 但下一个改调用方的人会看见这一条。
    expect(orphanWorktrees(["scratch"], [])).toEqual(["atch"]);
    // 正面那一半：带前缀时切出来的是干净的 agentId。
    expect(orphanWorktrees(["wt-w1"], [])).toEqual(["w1"]);
  });
});

describe("cleanOrphanWorktree：真删之前的那道 glob 白名单（防批量误删）", () => {
  // 审查 A6 的原话：agentId 拼进 `git branch --list "agent/*-<id>"`，
  // 含 `[` `?` `*` 时会匹配**全部** agent 分支并循环删除。这道闸必须在任何 git 调用**之前**生效。
  it("含 glob 元字符 / 路径分隔 / 命令分隔符的 agentId 一律拒绝，且不动盘", async () => {
    for (const bad of ["*", "a?b", "[ab]", "w/../x", "w1;rm -rf /", "", "a b", "a\\b"]) {
      const r = await cleanOrphanWorktree("/tmp/dsh-does-not-exist", bad);
      expect(r.removed, JSON.stringify(bad)).toBe(false);
      expect(r.branchDeleted, JSON.stringify(bad)).toBe(false);
      expect(r.error, JSON.stringify(bad)).toContain("非法字符");
    }
  });

  it("合法 id 走正常路径（白名单不是「一律拒绝」——那会让清理功能瘫掉）", async () => {
    // 指向一个不存在的仓库：白名单放行后会在 git 那步失败，但 `error` 必须**不是**「非法字符」。
    // 这条防的是把闸写成永真（那样任何 id 都拒绝，清理功能形同虚设却全绿）。
    const r = await cleanOrphanWorktree("/tmp/dsh-does-not-exist", "w1");
    expect(r.error ?? "").not.toContain("非法字符");
  });
});