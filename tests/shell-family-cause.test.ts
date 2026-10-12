// shell 家族的失败归因（待办 #25）：verify 早就把「环境红 ≠ 代码红」写进模型看到的正文，
// 而 run_shell / worker 的 shell_ro·shell_rw / 沙箱出口没有 ⇒ 模型照着一条 127 或 pnpm 自身报错
// 去改本来正确的代码（真语料里 run_shell 4 条、spawn_agent 6 条红全部无类，见 09-28 第 182 页）。
// 这一支的规矩：**判据只有一只**（`classifyVerifyFailure`，同正则同枚举），文案按出口分两档
// （verify 能说「测试脚本未被执行」，任意一条 shell 命令不能这么说）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { annotateExecCause } from "../src/agent/verify";
import { run_shell } from "../src/tools/run_shell";
import { makeShellRo, makeShellRw } from "../src/agent/worker-shell-tools";
import type { ToolContext, ToolResult } from "../src/tools/base";

const PNPM_LINE = "[ERR_PNPM_UNSAFE_MODULES_DIR] Refusing to remove the modules directory at /x/node_modules";
const noteCount = (s: string): number => (s.match(/\[exec: /gu) ?? []).length;

let ws = "";
const ctx = (): ToolContext => ({ workspace: ws, emit: async () => {} });

beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "shell-cause-"));
});
afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

describe("annotateExecCause：该贴的三类各贴各的，代码红与绿拍一个字都不许多", () => {
  it("127 与包管理器错误码两类各贴一句，普通代码红不贴", () => {
    const missing = annotateExecCause({ ok: false, output: "bash: foo: command not found" }, { timedOut: false, exitCode: 127 });
    expect(missing.output).toContain("127");
    expect(missing.output, "贴出来的那句必须能指路（PATH / 是否安装）").toContain("PATH");
    const pnpm = annotateExecCause({ ok: false, output: PNPM_LINE }, { timedOut: false, exitCode: 1 });
    expect(pnpm.output).toContain("包管理器自身报错");
    const code = annotateExecCause({ ok: false, output: "AssertionError: expected 1" }, { timedOut: false, exitCode: 3 });
    expect(code.output).toBe("AssertionError: expected 1"); // 一字不许多：代码红就是代码红
  });

  it("成功回执不贴：`pnpm install` 正文里有错误码行也不能说命令没跑成", () => {
    const r = annotateExecCause({ ok: true, output: PNPM_LINE + "\ndone" }, { timedOut: false, exitCode: 0 });
    expect(r.output).toBe(PNPM_LINE + "\ndone");
  });

  it("超时不重复贴——两条出口自己那行 `[error: … 超时 …]` 已经说了同一件事", () => {
    const r = annotateExecCause({ ok: false, output: "partial\n[error: run_shell 超时（60s），已强制终止]" }, { timedOut: true, exitCode: null });
    expect(r.output).toBe("partial\n[error: run_shell 超时（60s），已强制终止]");
  });

  it("没有退出码 ⇒ 贴「被取消或被信号杀掉」那一句，且幂等（两条 exec 出口共用同一句）", () => {
    // 这一格从前什么都得不贴：模型只看到 `[exit code: null]`，读到的是「脚本返回了个怪码」，
    // 而真因是这条命令**压根没跑完**（第 221 页 #39）。
    const once = annotateExecCause({ ok: false, output: "partial\n[exit code: null]" }, { timedOut: false, exitCode: null });
    expect(once.output).toContain("没有退出码");
    expect(once.output).toMatch(/不是代码失败/u);
    expect(noteCount(once.output)).toBe(1);
    const twice = annotateExecCause(once, { timedOut: false, exitCode: null });
    expect(noteCount(twice.output)).toBe(1);
  });

  it("幂等：同一条结果先后过两层出口（worker 缺省出口就是 run_shell）只贴一遍", () => {
    const once = annotateExecCause({ ok: false, output: "no such binary" }, { timedOut: false, exitCode: 127 });
    const twice = annotateExecCause(once, { timedOut: false, exitCode: 127 });
    expect(noteCount(twice.output)).toBe(1);
  });

  it("贴的句子必含「不是代码失败」——这句的存在理由就是拦住模型照着环境红改代码", () => {
    for (const f of [
      { timedOut: false, exitCode: 127 },
      { timedOut: false, exitCode: 1 },
      { timedOut: false, exitCode: null },
    ]) {
      const out = annotateExecCause({ ok: false, output: f.exitCode === 1 ? PNPM_LINE : "x" }, f).output;
      expect(out).toMatch(/不是代码失败/u);
    }
  });
});

describe("run_shell 真 spawn：模型看到的 output 里真的带着这一句", () => {
  it("跑一条不在 PATH 里的命令 ⇒ 点名 127 与『这不是代码失败』", async () => {
    const r = await run_shell.run({ command: "dsh-no-such-binary-91347" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("[exit code: 127]"); // 前提：退出码那行本身照旧在（新句子是补上去的，不是换掉的）
    expect(r.output).toContain("不在 PATH 里");
  });

  it("跑一条打印 pnpm 自有错误码行的命令 ⇒ 贴包管理器那句", async () => {
    const r = await run_shell.run({ command: `printf '%s\\n' '[ERR_PNPM_UNSAFE_MODULES_DIR] Refusing to remove' >&2; exit 1` }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("包管理器自身报错");
  });

  it("控制组：普通 `exit 3` 的输出逐字不变（防上面两条变成恒真）", async () => {
    const r = await run_shell.run({ command: "echo boom; exit 3" }, ctx());
    expect(r.ok).toBe(false);
    // 期望值来自现跑真机而不是推理：`echo` 自带换行 ＋ 出口那句以 `\n` 起头 ⇒ 中间是两个换行。
    // 这一格钉的是「归因不改变既有回执」，所以逐字比、不放宽成 toContain。
    expect(r.output).toBe("boom\n\n[exit code: 3]");
  });

  it("成功命令即便正文里带着 ERR_PNPM 那行也不贴（归因只在失败支上）", async () => {
    const r = await run_shell.run({ command: `printf '%s\\n' '[ERR_PNPM_UNSAFE_MODULES_DIR] just a log line'; exit 0` }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain("[exec:");
  });
});

describe("worker shell 两层出口：注入的沙箱出口有人贴，缺省出口不叠第二层", () => {
  // 沙箱版 runner 由宿主注入（`src/agent` 不许反向依赖 `src/main`），它不经过 run_shell ⇒
  // 归因必须在 makeShellRo/makeShellRw 这一层补。这里用注入缝把那条出口摆到测得着的位置：
  // 换掉的只是**执行出口**（本来就是注入点），归因函数与被贴的那一行都是生产代码。
  const sandboxish = (command: string): ToolResult => ({
    ok: false,
    output: command.includes("91347") ? "bash: command not found\n[exit code: 127]" : PNPM_LINE + "\n[exit code: 1]",
    exitCode: command.includes("91347") ? 127 : 1,
    timedOut: false,
  });

  it("shell_ro 走注入出口 ⇒ 127 这一类照样贴（摘掉 worker 这层接线就红）", async () => {
    // 命令必须真过只读静态白名单（`which` 在里面），否则先被拒绝、根本走不到执行出口——
    // 那测的就不是这一层了。
    const tool = makeShellRo(async (command) => sandboxish(command));
    const r = await tool.run({ command: "which dsh-no-such-binary-91347" }, ctx());
    expect(r.output).toContain("不在 PATH 里");
  });

  it("shell_rw 是同一层接线（同族只硬化一支 = 那一支静默不一致）", async () => {
    const tool = makeShellRw(async (command) => sandboxish(command));
    const r = await tool.run({ command: "echo x; printf '%s' '" + PNPM_LINE + "'" }, ctx());
    expect(r.output).toContain("包管理器自身报错");
  });

  it("缺省出口 bareShell 走 run_shell ⇒ worker 这层不许叠第二句（真 spawn，数 note 出现次数）", async () => {
    const r = await makeShellRw().run({ command: "dsh-no-such-binary-91347" }, ctx());
    expect(r.ok).toBe(false);
    expect(noteCount(r.output)).toBe(1);
    expect(r.output).toContain("不在 PATH 里");
  });
});

describe("四个出口的接线各有证人（同一判据四份副本、宽度各不同 = 本仓第十三族）", () => {
  // 这一格只补**够不着真 spawn 的那一支**：主会话开着沙箱时 run_shell 整个被 `runInSandbox` 顶掉，
  // 而那条出口没有注入缝（不像 `verifyExec` 能吃 `run` 参数），本仓对这类接线用行锚定的源码证人。
  // 语义面不在这里判——上面两组真 spawn 已经判过；这里只答「这一支到底有没有接上同一只函数」。
  const readFile = async (rel: string): Promise<string> => {
    const { readFile: rd } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    // 仓路径里有空格：`.pathname` 会把它编成 %20 而读不到文件 ⇒ 必须走 fileURLToPath。
    return await rd(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  };

  it("主会话沙箱出口、worker 两条出口、run_shell 直连——三处都真的调了同一只归因函数", async () => {
    // 2026-10-11 拆分：主会话沙箱出口那条（gatedTool 内）搬去 ./tool-gates ⇒ 取料跟着读两处。
    const runner = (await readFile("../src/main/agent-runner.ts"))
      + "\n" + (await readFile("../src/main/tool-gates.ts"));
    const worker = await readFile("../src/agent/worker-shell-tools.ts");
    const shell = await readFile("../src/tools/run_shell.ts");
    // 行锚定（规则 247）：不锚行首就会撞上注释里那份自述文字，改了注释也算"接上了"。
    // 允许缩进（这几处都在函数体里），但锚在**语句**开头——注释行以 `//` 起头，进不来。
    expect(runner).toMatch(/^[ \t]*return withGate\(annotateExecCause\(sand, /mu);
    const workerCalls = worker.match(/^[ \t]*return annotateExecCause\(res, /gmu) ?? [];
    expect(workerCalls, "shell_ro 与 shell_rw 两处出口都要接（只接一支＝那一支静默不自述）").toHaveLength(2);
    expect(shell).toMatch(/^[ \t]*settle\(cancelled \? res : annotateExecCause\(res, /mu);
  });

  it("反向确认：把归因从某一支摘掉，上面那条接线证人就红（不是恒真正则）", async () => {
    const worker = await readFile("../src/agent/worker-shell-tools.ts");
    const oneSiteOnly = worker.replace(/^[ \t]*return annotateExecCause\(res, .*$/mu, "      return res;");
    expect((oneSiteOnly.match(/^[ \t]*return annotateExecCause\(res, /gmu) ?? []).length).toBe(1);
  });
});
