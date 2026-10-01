// 沙箱版 verify 执行器的接缝验收（上一轮把超时改成配置项后，"沙箱出口到底收不收这个超时"
// 只有换掉真 spawn 才测得到——宿主拒 apply 时 sandbox:check 走降级分支 B，端到端也不覆盖它）。
//
// 2026-09-29 补的一组：`pnpm test ⇒ 直连 vitest` 这条改写**加了工作区判据**。
// 动因是一次真模型闭环实测：改写原先无条件生效，于是非 vitest 项目（`node --test`）的
// `pnpm test` 被换成 vitest，vitest 对着 node:test 文件报 "No test suite found"
// ⇒ **项目自己 3/3 全过，harness 的 verify 报红**（假红，且事件里的 command 报的是原始命令，
// 模型无法归因，最后停下来问用户）。下面的用例把两个方向都钉住：
// 装了 vitest 的工作区照旧改写，没装的工作区逐字不动。
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultExec } from "../src/agent/verify";
import { MODEL_SHELL_TEST_ALIASES, SANDBOX_TEST_ALIASES, mapSandboxTestCommand, mapSandboxTestCommandForWorkspace, verifyExec } from "../src/main/agent-runner";
import type { SandboxRunOptions, SandboxStatus } from "../src/main/sandbox";
import type { ToolResult } from "../src/tools";

const ON: SandboxStatus = { available: true };
const OFF: SandboxStatus = { available: false, reason: "sandbox_apply: Operation not permitted" };

/** 判据的载体：**声明用 vitest 的工作区**——本仓的 todo-app 靶子（它的 test 脚本就是
 *  `vitest run …`，且自己不带 node_modules，正是这条改写最初要服务的那个形状）。 */
const VITEST_WS = fileURLToPath(new URL("../fixtures/todo-app", import.meta.url));
/** 反面：真声明用别的 runner 的工作区（`node --test`）——本轮实测到的那个假红就是它。 */
const NO_VITEST_WS = mkdtempSync(join(tmpdir(), "m0-novitest-"));
writeFileSync(join(NO_VITEST_WS, "package.json"), JSON.stringify({
  name: "cart-demo", private: true, type: "module",
  scripts: { test: "node --test tests/*.test.js" },
}));
afterAll(() => { rmSync(NO_VITEST_WS, { recursive: true, force: true }); });

interface Seen { command: string; opts: SandboxRunOptions }
function spy(result: ToolResult = { ok: true, output: "Tests 3 passed (3)" }): { calls: Seen[]; run: (c: string, o: SandboxRunOptions) => Promise<ToolResult> } {
  const calls: Seen[] = [];
  return { calls, run: async (command, opts) => { calls.push({ command, opts }); return result; } };
}

describe("verifyExec（沙箱是发货缺省路径）", () => {
  it("沙箱不可用 / 未知 ⇒ 直接就是 defaultExec（非沙箱宿主零行为，不多包一层）", () => {
    expect(verifyExec(null)).toBe(defaultExec);
    expect(verifyExec(OFF)).toBe(defaultExec);
  });

  it("超时透传给 runInSandbox；未给时不写这个键（沿用沙箱自己的缺省，不越权改写）", async () => {
    const s = spy();
    await verifyExec(ON, s.run)("cargo test", VITEST_WS, 300_000);
    expect(s.calls[0]?.opts.timeoutMs).toBe(300_000);
    const s2 = spy();
    await verifyExec(ON, s2.run)("cargo test", VITEST_WS);
    expect("timeoutMs" in (s2.calls[0]?.opts ?? {})).toBe(false);
  });

  it("装了 vitest 的工作区：pnpm test / pnpm run test 映射为直连 vitest；其它命令逐字不动", async () => {
    const s = spy();
    const exec = verifyExec(ON, s.run);
    await exec("pnpm test", VITEST_WS);
    await exec("pnpm run test", VITEST_WS);
    await exec("cargo test", VITEST_WS);
    expect(s.calls[0]?.command).toContain("vitest");
    expect(s.calls[0]?.command).not.toContain("pnpm");
    expect(s.calls[1]?.command).toContain("vitest");
    expect(s.calls[2]?.command).toBe("cargo test");
  });

  it("没装 vitest 的工作区：`pnpm test` **逐字不动**（这是本轮修的假红）", async () => {
    const s = spy();
    await verifyExec(ON, s.run)("pnpm test", NO_VITEST_WS);
    expect(s.calls[0]?.command).toBe("pnpm test");
  });

  it("结果里的 command 用模型下的原命令（事件流给人看的不是内部映射串）", async () => {
    const s = spy({ ok: false, output: "FAILED: 1 of 3" });
    const r = await verifyExec(ON, s.run)("pnpm test", VITEST_WS);
    expect(r.command).toBe("pnpm test");
    expect(s.calls[0]?.command).not.toBe("pnpm test");
    expect(r.ok).toBe(false);
    expect(r.output).toContain("FAILED: 1 of 3");
  });

  it("非 vitest 工作区：失败结果里的 command 与实际跑的命令一致（不再悄悄换 runner）", async () => {
    const s = spy({ ok: false, output: "not ok 2 - coupon" });
    const r = await verifyExec(ON, s.run)("pnpm test", NO_VITEST_WS);
    expect(s.calls[0]?.command).toBe("pnpm test");
    expect(r.command).toBe("pnpm test");
  });
});

/** 三处消费者（worker 的 shell、验证门、模型那条 `run_shell`）原先各抄一行同族三元，
 *  且**宽度不同**（模型那条只认 `pnpm test`），三份里两份零观察者——只有 `verifyExec` 那条有测。
 *  收成一份之后，宽度差落成两个具名名单：差的那一条是"要不要替模型改写它自己下的命令"这个裁决，必须是点名的、不能是漂。 */
describe("沙箱 pnpm 映射收成一份", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url)), "utf8");

  it("消费者不再各自内联那句三元：`? VITEST_DIRECT : command` 全文件只剩映射器里那一处", () => {
    expect(src.split("? VITEST_DIRECT : command").length - 1).toBe(1);
    // 计数口径跟着接线改：三处消费者一律走带工作区判据的那个入口（少一处 = 有一处又绕开判据），
    // 映射器自身与它内部那一跳各算一次。
    expect(src.split("mapSandboxTestCommandForWorkspace(").length - 1).toBe(4); // 定义 1 ＋ 三处调用
    expect(src.split("mapSandboxTestCommand(").length - 1).toBe(2); // 定义 1 ＋ ForWorkspace 内部兜底那一跳
  });

  it("窄名单逐字钉住，且与全表的双向差集都要点名（加一条进窄表＝绕开裁决给模型改命令）", () => {
    expect(MODEL_SHELL_TEST_ALIASES).toEqual(["pnpm test"]);
    expect(SANDBOX_TEST_ALIASES.filter((a) => !MODEL_SHELL_TEST_ALIASES.includes(a))).toEqual(["pnpm run test"]);
    expect(MODEL_SHELL_TEST_ALIASES.filter((a) => !SANDBOX_TEST_ALIASES.includes(a))).toEqual([]);
  });

  it("映射器本身：去空白比对、名单外逐字不动、带参数的 pnpm test 不算命中", () => {
    expect(mapSandboxTestCommand("  pnpm run test  ")).toContain("vitest");
    expect(mapSandboxTestCommand("pnpm test", MODEL_SHELL_TEST_ALIASES)).toContain("vitest");
    expect(mapSandboxTestCommand("pnpm run test", MODEL_SHELL_TEST_ALIASES)).toBe("pnpm run test");
    expect(mapSandboxTestCommand("pnpm test --reporter=verbose")).toBe("pnpm test --reporter=verbose");
  });

  it("工作区判据自己：申报 vitest 才改写；workspace 缺席时保持旧语义（不误伤无上下文的调用）", () => {
    expect(mapSandboxTestCommandForWorkspace("pnpm test", VITEST_WS)).toContain("vitest");
    expect(mapSandboxTestCommandForWorkspace("pnpm test", NO_VITEST_WS)).toBe("pnpm test");
    expect(mapSandboxTestCommandForWorkspace("pnpm test", undefined)).toContain("vitest");
    // 窄名单照旧生效：模型那条 `run_shell` 仍然不改写 `pnpm run test`
    expect(mapSandboxTestCommandForWorkspace("pnpm run test", VITEST_WS, MODEL_SHELL_TEST_ALIASES)).toBe("pnpm run test");
  });

  it("判据问的是「它自己声明的 runner」而不是「盘上装没装 vitest」——真实靶子不带 package 依赖", () => {
    // fixtures/todo-app 的依赖从仓库根解析（它自己那份 node_modules 是判卷跑出来的运行产物、
    // 且被 gitignore），所以「装没装」不是一个稳定可判的量；它自己声明的 test 脚本才是。
    expect(mapSandboxTestCommandForWorkspace("pnpm test", VITEST_WS)).toContain("vitest");
    // 没有 package.json 的目录 ⇒ 不改写（保守那一边）
    const bare = mkdtempSync(join(tmpdir(), "m0-bare-"));
    try {
      expect(mapSandboxTestCommandForWorkspace("pnpm test", bare)).toBe("pnpm test");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
