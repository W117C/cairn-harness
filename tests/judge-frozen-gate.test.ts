// 判卷面硬闸（2026-09-20 立）。
// 为什么值得锁：真模型评测 8 格里 3 格把 `tests/todo.test.ts` **改写**了（含"补一条测试"那格——
// 它把"新增用例"实现成编辑既有判卷文件），而 `BASE_SYSTEM` 纪律 6 明文禁止这条改写动作却没拦住。
// 本仓既有口径是「不是提示词自觉，是工具表摘除」（见 `allowedTools` / 只读档那两条），
// 判卷面的保护同样不能靠提示词：⇒ 落进权限层 L0（与只读档摘除、方案门同层，规则库不许复活）。
//
// 事实源只有一处：工作区自己声明的 `scripts/frozen-sha256.json`（键 = 判卷文件相对路径）。
// 表不存在 ⇒ 空集 ⇒ 零行为（用户自己的仓库不受本条约束）；表存在但解析不了 ⇒ 显式抛，
// 绝不静默折成"这个工作区没有判卷面"（那正是把闸拆掉的最省事写法）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { evaluate, newAutonomySession, type PermissionRule } from "../src/permissions";
import type { ToolName } from "../src/tools/base";
import { frozenJudgePathSet } from "../src/frozen";
import { runAgent } from "../src/main/agent-runner";
import { createEventLog, type AgentEvent } from "../src/events";
import { Orchestrator, scriptedWorkerModel } from "../src/agent/orchestrator";
import { worktreePathFor } from "../src/agent/worktree";

const exec = promisify(execFile);

const ROOT = process.cwd();
const JUDGE = "fixtures/mock/todo-bug.ts";
const NOT_JUDGE = "fixtures/todo-app/src/todo.ts";

/** 拿 deny 的理由：先收窄联合类型（`reason` 只存在于 deny/ask 两支），再断言。 */
function denyReason(d: ReturnType<typeof evaluate>): string {
  if (d.verdict === "deny") return d.reason;
  throw new Error("期望 deny，实际 verdict=" + d.verdict);
}

const rules = (rs: PermissionRule[]) => rs;
const allowWrite: PermissionRule = { behavior: "allow", tool: "write_file", scope: "always", id: "allow-write" };
const allowShell: PermissionRule = { behavior: "allow", tool: "run_shell", scope: "always", id: "allow-shell" };

describe("判卷面硬闸（权限层 L0）", () => {
  it("① 写向工具命中冻结表 ⇒ deny，理由指明「写 BLOCKED.md 换判据」而不是改文件", () => {
    const s = newAutonomySession("default", { rules: [], frozenJudgePaths: new Set([JUDGE]) });
    const d = evaluate("write_file", { path: JUDGE, content: "x" }, s);
    const why = denyReason(d);
    expect(why).toContain("判卷");
    expect(why).toContain("BLOCKED.md");
  });

  it("② 闸在 L0：一条 allow 规则 / 自主档都不能复活被冻住的写", () => {
    for (const mode of ["default", "auto"] as const) {
      const s = newAutonomySession(mode, { rules: rules([allowWrite]), frozenJudgePaths: new Set([JUDGE]) });
      expect(evaluate("write_file", { path: JUDGE, content: "x" }, s).verdict).toBe("deny");
      expect(evaluate("edit_file", { path: "./" + JUDGE, new_string: "a", old_string: "b" }, s).verdict).toBe("deny");
    }
  });

  it("③ 同一张表不挡读（读判卷文件是日常动作：看清是哪一条在红）", () => {
    const s = newAutonomySession("default", { rules: [], frozenJudgePaths: new Set([JUDGE]) });
    expect(evaluate("read_file", { path: JUDGE }, s).verdict).not.toBe("deny");
  });

  it("④ 缺省零行为：不给冻结集 ⇒ 既有判定路径逐字不变", () => {
    const s = newAutonomySession("auto", { rules: rules([allowWrite]) });
    const d = evaluate("write_file", { path: JUDGE, content: "x" }, s);
    expect(d.verdict).toBe("approve"); // 判定词汇是 approve|ask|deny（不是 allow）——本条第一版就写错在这里
  });

  it("⑤ MCP 写工具同口径（写向判定只此一份，不按工具族各写一套）", () => {
    const s = newAutonomySession("auto", { rules: rules([allowWrite]), frozenJudgePaths: new Set([JUDGE]) });
    const d = evaluate("mcp__repo__patch_file" as ToolName, { path: JUDGE }, s, { annotated: true, readOnly: false });
    expect(d.verdict).toBe("deny");
  });

  it("⑥ 已声明的覆盖边界：run_shell 不解析命令面 ⇒ 本闸不拦 shell 写；逃逸路径不当判卷面处理", () => {
    const s = newAutonomySession("auto", {
      rules: rules([allowShell, allowWrite]),
      frozenJudgePaths: new Set([JUDGE]),
    });
    // 这一条是**故意**钉住"闸覆盖到哪"：shell 写面由沙箱/审批那两条通道管，
    // 不把本闸说成全防（全防会让人以为判卷面从此安全）。
    expect(evaluate("run_shell", { command: `sed -i '' 's/a/b/' ${JUDGE}` }, s).verdict).not.toBe("deny");
    // 归一化只认工作区相对路径：`../` 与绝对路径落在工作区外，不属于本张表。
    expect(evaluate("write_file", { path: "../" + JUDGE }, s).verdict).not.toBe("deny");
    expect(evaluate("write_file", { path: "/etc/" + JUDGE }, s).verdict).not.toBe("deny");
  });
});

describe("冻结表装载（唯一事实源 = scripts/frozen-sha256.json）", () => {
  it("⑦ 表里的键进集合、非判卷文件不进、归一化后同一写法可命中", () => {
    const set = frozenJudgePathSet(ROOT);
    expect(set.has("fixtures/todo-app/tests/todo.test.ts")).toBe(true);
    expect(set.has(NOT_JUDGE)).toBe(false);
  });

  it("⑧ 工作区没有这张表 ⇒ 空集（零行为）；有但解析不了 ⇒ 显式抛，不静默当「没有判卷面」", async () => {
    const absent = await mkdtemp(join(tmpdir(), "judge-absent-"));
    expect(frozenJudgePathSet(absent).size).toBe(0);
    const broken = await mkdtemp(join(tmpdir(), "judge-broken-"));
    await mkdir(join(broken, "scripts"), { recursive: true });
    await writeFile(join(broken, "scripts", "frozen-sha256.json"), "{ 这不是 JSON", "utf8");
    expect(() => frozenJudgePathSet(broken)).toThrow();
  });
});

// 端到端：走产品真入口 `runAgent`（→ gatedTool → evaluate → 工具执行），
// 而不是只测 `evaluate` 单元口。剧本通道用**现成的** `M1C_AUTONOMY_SCRIPT`
// （`agent-runner.ts:985`，autonomy-check 三条路径复用同一接线）——不新增 `M1B_GATE_FIXTURE`：
// 同一件事开第二个 env 出口，就是本仓点名的「同族出口策略副本」，两份将来必然漂移一份。
describe("判卷面硬闸端到端（runAgent → gatedTool → evaluate → 不执行）", () => {
  it("⑨ 写判卷路径 ⇒ tool_result 出「判卷文件冻结」且文件逐字未变；同一 run 里写非判卷路径照常放行", async () => {
    const ws = await mkdtemp(join(tmpdir(), "judge-e2e-"));
    await mkdir(join(ws, "scripts"), { recursive: true });
    await mkdir(join(ws, "src"), { recursive: true });
    await mkdir(join(ws, "out"), { recursive: true });
    // 工作区自己声明一张小冻结表（sha 值本闸不比对，只看键 = 判卷文件清单）
    await writeFile(join(ws, "scripts", "frozen-sha256.json"), JSON.stringify({ "out/judge.txt": "0".repeat(64) }), "utf8");
    await writeFile(join(ws, "out", "judge.txt"), "原样未动", "utf8");
    const script = join(ws, "flow.jsonl");
    await writeFile(script, [
      JSON.stringify({ type: "tool_call", id: "j1", name: "write_file", args: { path: "out/judge.txt", content: "被改写" } }),
      JSON.stringify({ type: "tool_call", id: "j2", name: "write_file", args: { path: "src/ok.txt", content: "放行" } }),
      JSON.stringify({ type: "assistant_message", content: "两件都办完了。" }),
    ].join("\n") + "\n", "utf8");

    process.env.M1C_AUTONOMY_SCRIPT = script;
    let log;
    try {
      log = await runAgent({
        workspace: ws,
        message: "端到端：写判卷文件与写普通文件",
        mode: "auto",
        logPath: join(ws, "events.jsonl"),
        askGate: undefined,
        sandbox: null,
      });
    } finally {
      delete process.env.M1C_AUTONOMY_SCRIPT;
    }

    // `AgentEvent` 是联合类型，`ok` / `output` 只在 tool_result 那支上存在 ⇒ 收窄一次，别到处 cast。
    type ToolResultLike = { callId: string; ok: boolean; output: string };
    const resultFor = (id: string): ToolResultLike | undefined =>
      log.find((e) => e.type === "tool_result" && (e as { callId?: string }).callId === id) as ToolResultLike | undefined;
    const denied = resultFor("j1");
    const allowed = resultFor("j2");
    expect(denied, "判卷路径那次调用必须有回执").toBeTruthy();
    expect(denied!.ok).toBe(false);
    expect(denied!.output).toContain("判卷文件冻结");
    expect(denied!.output).toContain("BLOCKED.md");
    expect(await readFile(join(ws, "out", "judge.txt"), "utf8")).toBe("原样未动");
    expect(allowed?.ok).toBe(true); // 同 run 非判卷路径 ⇒ 零行为，不能连坐
    expect(await readFile(join(ws, "src", "ok.txt"), "utf8").catch(() => null)).toBe("放行");
  }, 120_000);
});

/* worker 面：上面那条端到端只走主会话，而 orchestrator 给 write worker 装的两处
   `frozenJudgePaths`（autonomy / toolAutonomy）此前**零观测者**——write worker 的工具档硬编码 "auto"，
   正是②「自主档不能复活被冻住的写」在并行路径上的同一件事（`agent-plan` §4.4.5：worker 在 worktree 里
   改判卷文件，与主会话改是同一件事，不该因为它在 worktree 里就少一道闸）。
   缺这一格时，摘掉那两行装配不会有任何用例红。 */
describe("判卷面硬闸在 worker 面（并行写路径不得少一道闸）", () => {
  it("write worker（工具档恒 auto）写判卷路径 ⇒ tool_result 仍是冻结拒绝且 worktree 里逐字未变；同 run 写普通文件照常放行", async () => {
    const root = await mkdtemp(join(tmpdir(), "judge-worker-"));
    try {
      const repo = join(root, "repo");
      await mkdir(join(repo, "scripts"), { recursive: true });
      await mkdir(join(repo, "fixtures"), { recursive: true });
      const g = (...args: string[]): Promise<{ stdout: string }> => exec("git", args, { cwd: repo });
      await writeFile(join(repo, "README.md"), "line1\n", "utf8");
      await writeFile(join(repo, "fixtures", "judge.txt"), "原样未动", "utf8");
      await writeFile(join(repo, "scripts", "frozen-sha256.json"), JSON.stringify({ "fixtures/judge.txt": "0".repeat(64) }), "utf8");
      await g("init");
      await g("config", "user.email", "judge@test.local");
      await g("config", "user.name", "Judge Test");
      await g("add", ".");
      await g("commit", "-m", "init");

      const logPath = join(root, "events.jsonl");
      await writeFile(logPath, "", "utf8");
      const events: AgentEvent[] = [];
      const script = [
        { type: "tool_call", id: "wj-1", name: "write_file", args: { path: "fixtures/judge.txt", content: "被改写" } },
        { type: "tool_call", id: "wj-2", name: "write_file", args: { path: "fixtures/plain.txt", content: "放行" } },
        { type: "assistant_message", content: "改了什么：两处写入。为什么：任务要求。验证方式：无。风险：低。" },
      ] as unknown as Parameters<typeof scriptedWorkerModel>[0];
      const orch = new Orchestrator({
        logPath,
        workspace: repo,
        parentMode: "default",
        modelFor: () => scriptedWorkerModel(script),
        emit: async (e) => {
          events.push(e);
          await createEventLog(logPath).append(e);
        },
      });
      const spawned = await orch.spawn({ mode: "write", task: "改判卷文件" }, { callId: "jw-1" });
      expect(spawned.ok, spawned.output).toBe(true);
      const agentId = (JSON.parse(spawned.output) as { agent_id: string }).agent_id;
      await orch.waitAll(60_000);

      const resultFor = (id: string): { ok: boolean; output: string } | undefined =>
        events.find((e) => e.type === "tool_result" && (e as { callId?: string }).callId === id) as
          { ok: boolean; output: string } | undefined;
      const denied = resultFor("wj-1");
      expect(denied, "判卷那次调用必须有回执（没回执＝它根本没跑到闸前，下面断言全是空的）").toBeTruthy();
      expect(denied!.ok).toBe(false);
      expect(denied!.output).toContain("判卷文件冻结");
      const allowed = resultFor("wj-2");
      // 配对那一半：同 run 的普通写必须**真发生并被放行**，否则「被拒」可能只是整条 worker 路径没跑起来
      expect(allowed?.ok, "同 run 的普通写必须放行").toBe(true);

      const wt = worktreePathFor(repo, agentId);
      expect(await readFile(join(wt, "fixtures", "judge.txt"), "utf8")).toBe("原样未动");
      expect(await readFile(join(wt, "fixtures", "plain.txt"), "utf8").catch(() => null)).toBe("放行");
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  }, 120_000);
});

/* apply_patch 那一面（⑩–⑯，2026-10-08 补；编号接续 ⑦⑧⑨ 那条「按写入次序编号」的既有约定）。
   动因是本闸取料面的实测缺口：`apply_patch` 登在 `SIDE_EFFECT_TOOLS` 里（`autonomy.ts:213-229`）
   ⇒ `isWriteCall` 为真，但闸原先只读 `args.path`，而它的参数键是 `args.patch`——一份统一 diff 全文，
   目标路径躺在正文的 `--- a/x` / `+++ b/x` 里 ⇒ 取料返回 null ⇒ **整条闸直接放行**。
   净效果：同一张冻结表下 `write_file` 写不动判卷文件、`apply_patch` 写得动（比提示词纪律更快失效的那一格）。

   两条纪律：
   ① 断言全部打在**生产谓词 `evaluate`** 上，判卷里一次都不自己解析 diff——本仓成文口径是「判据与
      生产端共用同一个决策点」，这里再解析一遍就是给这一格建第二个真相（改了取料它也绿）。
   ② 「命中 ⇒ deny」每条都配一条**同形状不命中 ⇒ 不 deny** 的反向哨兵（⑪⑮⑯）：只有正向断言时，
      把闸改成恒真也照样全绿。 */
describe("判卷面硬闸的批量形态（apply_patch：目标路径在补丁正文里）", () => {
  const OTHER = "src/other.ts";
  const THIRD = "src/third.ts";
  /** 一段能真落盘的 git diff：带 `diff --git` 表头与 `--- a/` / `+++ b/`（前缀归一是生产侧的事）。 */
  const seg = (p: string): string => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-x\n+y\n`;
  /** 武装态会话：自主档 + 一条 allow 规则（② 的口径——规则库不许复活被硬闸摘掉的写）。 */
  const armed = (frozen: readonly string[]) =>
    newAutonomySession("auto", { rules: rules([allowWrite]), frozenJudgePaths: new Set(frozen) });

  it("⑩ 多文件补丁里有一条命中冻结表 ⇒ deny，理由点名的就是那一条路径", () => {
    const d = evaluate("apply_patch", { patch: seg(JUDGE) + seg(OTHER) }, armed([JUDGE]));
    const why = denyReason(d);
    expect(d.layer, "必须是硬闸那一层，不是某条 deny 规则顺手接住").toBe("L0-hard");
    expect(why).toContain("判卷文件冻结");
    expect(why).toContain(JUDGE);
    expect(why, "理由不许把整份补丁抄成嫌疑清单：点名的得是命中的那一条").not.toContain(OTHER);
  });

  // 反向哨兵（A≠旧值）：同形状、表里没有这一条 ⇒ 不 deny。摘掉这条，⑩ 与⑫ 就会被恒真实现顶包。
  it("⑪ 同形状的补丁、冻结表里没有这些文件 ⇒ 不 deny（闸不是恒真）", () => {
    const d = evaluate("apply_patch", { patch: seg(OTHER) + seg(THIRD) }, armed([JUDGE]));
    expect(d.verdict).not.toBe("deny");
  });

  // 专门盯「只看第一条」那种修法：把取料退回 `targets[0]` 只有这一条会红。
  it("⑫ 冻结文件排在补丁第二位（后面还有）与中间位 ⇒ 仍逐条判到它并 deny", () => {
    for (const patch of [seg(OTHER) + seg(JUDGE), seg(OTHER) + seg(JUDGE) + seg(THIRD)]) {
      const d = evaluate("apply_patch", { patch }, armed([JUDGE]));
      const why = denyReason(d);
      expect(why, "命中的是第二条，理由必须点名它").toContain(JUDGE);
      expect(why).not.toContain(OTHER);
    }
  });

  it("⑬ 畸形补丁：读不出要写哪些文件 ⇒ 出声 deny，不许静默放行", () => {
    // `--- /+++` 表头不在任何 `diff --git` 段内 ⇒ 生产侧解析器抛 ⇒ 闸拿不到目标清单。
    const d = evaluate("apply_patch", { patch: `--- a/${JUDGE}\n+++ b/${JUDGE}\n+x\n` }, armed([JUDGE]));
    const why = denyReason(d);
    // 收的是**本闸自己那句的开头**，不是光一个「认不出」：那个词在仓里有 11 处生产者（prose-needle
    // 尺当场把我顶包出来），换掉任何一句别的「认不出」这条断言照样绿。
    expect(why, "读不出目标必须点名本闸这句，不许折成「目标安全」").toContain("判卷面冻结闸没法判");
    expect(why).toContain("BLOCKED.md");
    expect(d.layer).toBe("L0-hard");
  });

  it("⑭ 解不出文件的补丁（空串／全是噪声／段有内容却没有目标路径）同样出声 deny", () => {
    for (const patch of [
      "",
      "随手抄的几句说明，压根不是 diff\n",
      `diff --git a/x b/x\n@@ -1 +1 @@\n-x\n+y\n`,
    ]) {
      const d = evaluate("apply_patch", { patch }, armed([JUDGE]));
      expect(d.verdict, JSON.stringify(patch)).toBe("deny");
      expect(denyReason(d), JSON.stringify(patch)).toContain("判卷面冻结闸没法判");
    }
  });

  it("⑮ 真表同口径：现读 scripts/frozen-sha256.json 的键，补丁写它一样 deny、未入表的不 deny", () => {
    // 这一条判的是**键的词汇对不对**：注入集用判卷自己造的串，归一写错时正反向会一起错；
    // 换成生产装载的那张表，`a/` 前缀没剥掉、或 `/dev/null` 被当成路径，就当场红。
    const set = [...frozenJudgePathSet(ROOT)];
    const real = "fixtures/todo-app/tests/todo.test.ts";
    expect(new Set(set).has(real), "事实源里这一条必须在（否则本用例是空的）").toBe(true);
    expect(denyReason(evaluate("apply_patch", { patch: seg(OTHER) + seg(real) }, armed(set)))).toContain(real);
    expect(evaluate("apply_patch", { patch: seg(OTHER) }, armed(set)).verdict).not.toBe("deny");
  });

  // 老那一格不许变（要求 5）：`args.path` 的口径逐字不动，包括「越界不归本闸管」那格。
  it("⑯ write_file / edit_file 的 args.path 行为一字不变；越界目标仍不归本闸管", () => {
    const s = armed([JUDGE]);
    expect(denyReason(evaluate("write_file", { path: JUDGE, content: "x" }, s))).toContain(`判卷文件冻结：${JUDGE}`);
    expect(denyReason(evaluate("edit_file", { path: "./" + JUDGE, old_string: "a", new_string: "b" }, s))).toContain(`判卷文件冻结：${JUDGE}`);
    // ⑥ 那三条口径不许被顺手改宽／改窄。
    expect(evaluate("write_file", { path: "../" + JUDGE }, s).verdict).not.toBe("deny");
    expect(evaluate("write_file", { path: "/etc/" + JUDGE }, s).verdict).not.toBe("deny");
    expect(evaluate("run_shell", { command: `sed -i '' 's/a/b/' ${JUDGE}` }, s).verdict).not.toBe("deny");
    // 补丁里的越界目标与 `args.path` 同口径：认得出、但不归本闸管（不是「读不出」）。
    expect(evaluate("apply_patch", { patch: seg("../" + JUDGE) }, s).verdict).not.toBe("deny");
  });

  it("⑰ 缺省零行为的批量版：工作区没声明判卷面 ⇒ 畸形补丁也不由这条闸拦下", () => {
    // 静态棘轮 C6 钉的是 `frozenJudgePaths.size > 0` 这条前置**不许改成无条件**：用户自己的仓库
    // 没有这张表 ⇒ 整条闸不存在，畸形补丁归工具层自己的回执管（把它拦在这里是越权加闸）。
    const s = newAutonomySession("auto", { rules: rules([allowWrite]) });
    expect(s.frozenJudgePaths.size).toBe(0);
    expect(evaluate("apply_patch", { patch: "没有 diff 段\n" }, s).verdict).not.toBe("deny");
    expect(evaluate("apply_patch", { patch: seg(JUDGE) }, s).verdict).not.toBe("deny");
  });

  it("⑱ `..` 归一与大小写变体不得绕过冻结闸（2026-10-19 实测三种输入）", () => {
    const s = armed([JUDGE]);
    // `foo/../x` 与 `x` 是同一个文件：旧实现见到 `..` 直接判「不归本闸管」。
    expect(denyReason(evaluate("write_file", { path: "foo/../" + JUDGE, content: "x" }, s))).toContain(`判卷文件冻结：${JUDGE}`);
    expect(denyReason(evaluate("edit_file", { path: "a/../" + JUDGE, old_string: "a", new_string: "b" }, s))).toContain(`判卷文件冻结：${JUDGE}`);
    // macOS/Win 默认文件系统大小写不敏感：`FIXTURES/MOCK/...` 命中同一个文件。
    if (process.platform === "darwin" || process.platform === "win32") {
      expect(evaluate("write_file", { path: JUDGE.toUpperCase(), content: "x" }, s).verdict).toBe("deny");
    }
    // 越界仍不归本闸管（方向不许被顺手改宽）。
    expect(evaluate("write_file", { path: "../" + JUDGE }, s).verdict).not.toBe("deny");
  });
});

