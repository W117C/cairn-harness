// 判卷面硬闸（2026-09-20 立）。
// 为什么值得锁：真模型评测 8 格里 3 格把 `tests/todo.test.ts` **改写**了（含"补一条测试"那格——
// 它把"新增用例"实现成编辑既有判卷文件），而 `BASE_SYSTEM` 纪律 6 明文禁止这条改写动作却没拦住。
// 本仓既有口径是「不是提示词自觉，是工具表摘除」（见 `allowedTools` / 只读档那两条），
// 判卷面的保护同样不能靠提示词：⇒ 落进权限层 L0（与只读档摘除、方案门同层，规则库不许复活）。
//
// 事实源只有一处：工作区自己声明的 `scripts/frozen-sha256.json`（键 = 判卷文件相对路径）。
// 表不存在 ⇒ 空集 ⇒ 零行为（用户自己的仓库不受本条约束）；表存在但解析不了 ⇒ 显式抛，
// 绝不静默折成"这个工作区没有判卷面"（那正是把闸拆掉的最省事写法）。
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate, newAutonomySession, type PermissionRule } from "../src/permissions";
import type { ToolName } from "../src/tools/base";
import { frozenJudgePathSet } from "../src/frozen";
import { runAgent } from "../src/main/agent-runner";

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
