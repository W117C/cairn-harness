// cairn CLI 的产品面契约（§阶段 B）。
//
// 这组只钉**从外面能观测到的东西**：退出码、stderr 上可操作的提示、落盘的日志。
// 渲染器 `renderEvent` 是纯函数，直接单测；审批门的接线用结构断言 + 真跑一次非交互路径。
//
// 刻意不做的：不 mock `runAgent` 去测「模型跑得好不好」——那是 e2e 的活（scripts/e2e.ts）。
// 这里钉的是「没人能用」这个缺陷本身：没有 bin、没有 README、没有可执行的产品面。
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderEvent } from "../src/cli";
import type { AgentEvent } from "../src/events";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const BIN = join(ROOT, "bin", "cairn.mjs");

/** 真跑 CLI。`noKeys` 抹掉全部 provider key，让 provider 推断走「一个都没配」那一支；
 *  `keys` 在抹完**之后**注入假 key（值是探针，专测「报在位但值绝不入报告」）。 */
function runCli(args: string[], opts: { noKeys?: boolean; env?: Record<string, string>; keys?: Record<string, string>; timeout?: number } = {}): { status: number | null; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...opts.env };
  if (opts.noKeys !== false) {
    for (const k of ["CAIRN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) delete env[k];
    delete env.M0A_PROVIDER;
  }
  Object.assign(env, opts.keys ?? {});
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env,
    input: "",
    ...(opts.timeout === undefined ? {} : { timeout: opts.timeout, killSignal: "SIGKILL" as const }),
  });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("cairn CLI：产品面存在且可执行", () => {
  it("bin/cairn.mjs 在盘上且带 shebang（npm bin 的硬要求）", () => {
    expect(existsSync(BIN)).toBe(true);
    expect(readFileSync(BIN, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("package.json 的 bin 指向它（装上才有 cairn 这个命令）", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { bin?: Record<string, string> };
    expect(pkg.bin?.cairn).toBe("./bin/cairn.mjs");
  });

  it("真跑：--help 打印用法并 exit 0（走真 bin shim，不是 import src）", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("用法：");
    expect(r.out).toContain("--mode");
    expect(r.out).toContain("--version");
    expect(r.out).toContain("--doctor");
  });

  it("真跑：--version 打印 cairn <version>，与 package.json 同源（单一事实源），exit 0", () => {
    const r = runCli(["--version"]);
    expect(r.status).toBe(0);
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    expect(r.out.trim()).toBe("cairn " + pkg.version);
  });

  it("真跑：--doctor 逐项报告＋总档；假 key 只报在位、值绝不出现；本机 node 满足 engines ⇒ exit 0", () => {
    // 探针值刻意不带任何真实 key 的形态（Mimosa 会把 sk- 前缀当真凭据拦）——
    // 它只要「在 env 里有、在报告里没有」就够钉死脱敏。
    const PROBE = "probe-key-value-NOT-A-REAL-CREDENTIAL";
    const r = runCli(["--doctor"], { noKeys: true, keys: { OPENAI_API_KEY: PROBE } });
    expect(r.status).toBe(0);
    expect(r.out).toContain("✓ node");
    expect(r.out).toContain("OPENAI_API_KEY 在位");
    expect(r.out).toContain("总档：");
    expect(r.out).not.toContain(PROBE);
  });
});

describe("cairn CLI：退出码 0 / 1 / 2（照 scripts/gym-run.ts 的口径）", () => {
  it("缺任务描述 ⇒ exit 2 且说清怎么用", () => {
    const r = runCli([]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("任务描述");
  });

  it("flag 给了却没带值 ⇒ exit 2（静默按缺省跑会让打错的 flag 假装生效）", () => {
    const r = runCli(["--mode"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--mode 需要一个值");
  });

  it("未知 --mode ⇒ exit 2 且列出合法档位", () => {
    const r = runCli(["--mode", "bogus", "做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("未知 --mode");
    expect(r.out).toContain("read-only");
  });

  it("位置参数超过两个 ⇒ exit 2（不猜哪个是工作区）", () => {
    const r = runCli(["a", "b", "c"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("位置参数最多两个");
  });
});

describe("cairn CLI：--model 自由档位", () => {
  it("--help 里列出这个 flag（没进 help 的选项等于不存在）", () => {
    expect(runCli(["--help"]).out).toContain("--model");
  });

  it("给了 flag 没给值 ⇒ exit 2（与 --mode 同一条口径）", () => {
    const r = runCli(["--model", "--mode", "read-only", "做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--model 需要一个值");
  });

  it("模型名是取值不是位置参数：不会被当成工作区或任务（漏登记进 VALUE_FLAGS 的后果）", () => {
    // 一个 key 都没配 ⇒ 停在 provider 推断并 exit 2；只要没先撞上「位置参数最多两个」，
    // 就说明 --model 的值确实被当成 flag 取值吃掉了。
    const r = runCli(["--model", "stealth/space-bunny-alpha", "做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).not.toContain("位置参数最多两个");
    expect(r.out).toContain("没有配置任何 provider 的 API key");
  });

  it("--provider demo 下点名模型 ⇒ exit 2（demo 不拨号，静默忽略等于换掉用户意图）", () => {
    const r = runCli(["--provider", "demo", "--model", "stealth/space-bunny-alpha", "做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("不匹配");
  });
});

describe("cairn CLI：--ctx-window（只配 --model，申报自由档位的真实窗口）", () => {
  it("--help 里列出这个 flag（没进 help 的选项等于不存在）", () => {
    expect(runCli(["--help"]).out).toContain("--ctx-window");
  });

  it("没有 --model 却给了 --ctx-window ⇒ exit 2（表内档位的窗口由档位表说了算，不接受申报）", () => {
    const r = runCli(["--provider", "demo", "--ctx-window", "32768", "做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--ctx-window");
  });

  // 这一格一次跑四个值 = 四次 spawnSync（每次都起一个真 node 进程）。本文件 `testTimeout` 没配，
  // vitest 缺省 5000ms：单次 200–900ms 时够用，机器一慢就整条超时（09-29 实测跑到 9102ms 翻红）。
  // 给显式上限，与本文件其它真跑用例（gate 流程 / shell 探针）同口径，不去动全局 testTimeout。
  it("非正整数 ⇒ exit 2（窗口是 token 数，0/负数/小数都不成）", () => {
    for (const bad of ["0", "-1", "32768.5", "abc"]) {
      const r = runCli(["--provider", "openai", "--model", "stealth/small", "--ctx-window", bad, "做点事"]);
      expect(r.status, `--ctx-window ${bad} 应当被拒`).toBe(2);
      expect(r.out).toContain("--ctx-window");
    }
  }, 60_000);

  it("取值型 flag：窗口值不会被当成位置参数（漏登记进 VALUE_FLAGS 的后果）", () => {
    // 刻意给**两个**位置参数（工作区 + 任务）。`--ctx-window` 一旦没登记进 VALUE_FLAGS，它的值
    // 32768 就会被当成第三个位置参数（`positional.length` 2→3），撞上「位置参数最多两个」那道
    // 解析期闸——它排在「provider 没配 key」之前，所以后果看得见。早先这格只给一个位置参数：
    // 误读后正好卡在 2（=上限，不报错），于是整条判卷恒绿，摘掉 VALUE_FLAGS 也照样过（09-29 复扫变异体存活）。
    const r = runCli(["--provider", "openai", "--model", "stealth/small", "--ctx-window", "32768", "工作区", "做点事"]);
    // 显式给了 --provider ⇒ 停在「openai 没配 key」这一关（不是推断那一关）。能走到这里就说明
    // 取值、配对、正整数三关都过了，且 32768 没被当成位置参数。
    expect(r.out).not.toContain("位置参数最多两个");
    expect(r.out).toContain("未配置 API key");
  });
});

describe("cairn CLI：缺 key 时 fail-closed，不静默换一家也不落 demo", () => {
  it("一个 key 都没配 ⇒ exit 2，且**没有**默默跑 demo", () => {
    const r = runCli(["做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("没有配置任何 provider 的 API key");
    // 关键：不能出现「跑完了」这类仿佛真跑过的输出，也不能说自己在 demo 档
    expect(r.out).not.toContain("事件日志：");
  });

  it("提示里点名了要设哪个环境变量，含 DeepSeek 那条 OpenAI 兼容通道", () => {
    const r = runCli(["做点事"]);
    expect(r.out).toContain("CAIRN_API_KEY");
    expect(r.out).toContain("OPENAI_BASE_URL=https://api.deepseek.com/v1");
  });

  it("配置错不打「用法」行（那行会把人引到 argv 上去，而该配的是环境变量）", () => {
    expect(runCli(["做点事"]).out).not.toContain("用法：cairn");
  });
});

/** 一份只发一拍 write_file 的剧本。走 `M3A_MAIN_SCRIPT` 显式通道（优先级最高，不动冻结夹具）。 */
function writeScript(ws: string): string {
  const p = join(ws, "main.jsonl");
  writeFileSync(
    p,
    [
      JSON.stringify({ type: "tool_call", id: "w1", name: "write_file", args: { path: "payload.txt", content: "写下来了\n" } }),
      JSON.stringify({ type: "assistant_message", content: "写完了。" }),
    ].join("\n"),
    "utf8",
  );
  return p;
}

/** 在临时工作区里真跑一轮 CLI，剧本只发一拍 write_file。
 *
 *  返回的 `written` 是**盘上**有没有那个文件，不是终端说了什么——把门做成纯 UI 时这两者会分家。
 *  `planRequired` 写进工作区的 `.agent/settings.json`（缺省 false），
 *  `mode` 为 null 表示不传 `--mode`，走 CLI 自己的缺省。 */
function runWriteScript(
  opts: { mode?: string | null; planRequired?: boolean } = {},
): { out: string; ws: string; written: boolean; logInWorkspace: boolean } {
  const ws = mkdtempSync(join(tmpdir(), "cairn-shell-"));
  const script = writeScript(ws);
  // 应用壳要用的那份盘面：settings 与 sessions 都在**工作区**里，不是 /tmp。
  mkdirSync(join(ws, ".agent", "sessions"), { recursive: true });
  writeFileSync(
    join(ws, ".agent", "settings.json"),
    JSON.stringify({ planRequiredByDefault: opts.planRequired === true }, null, 2),
    "utf8",
  );
  const mode = opts.mode ?? null;
  const r = runCli(
    [...(mode === null ? [] : ["--mode", mode]), "--workspace", ws, "--provider", "demo", "把 payload.txt 写下来"],
    { env: { M3A_MAIN_SCRIPT: script }, timeout: 60_000 },
  );
  return { out: r.out, ws, written: existsSync(join(ws, "payload.txt")), logInWorkspace: r.out.includes(join(ws, ".agent", "sessions")) };
}

describe("cairn CLI：默认档位是 fail-closed 的那一档", () => {
  /* 原来这条读源码（`pick("--mode") ?? "default"`），可 `--mode` 到底进没进裁决只有真跑能答。
     判据用「同一个剧本、同一个工作区，只差 argv 里有没有 --mode」：
     缺省那一次写必须落不下去（fail-closed），显式 `--mode auto` 那一次必须写得下去。
     两支只差一个维度、结论换人 ⇒ 把缺省翻成 auto 会立刻判红。 */
  it("支一：不给 --mode ⇒ 写工具被门拒（auto 必须显式 opt-in，不是缺省）", () => {
    const { out, written } = runWriteScript();
    expect(out, "这一拍根本没进权限门 ⇒ 这条判卷没有分辨力").toContain("permission denied");
    expect(out).toContain("在 default 档下");
    expect(written, `缺省档居然把文件写下去了：${out}`).toBe(false);
  });

  it("支二：只多给一个 --mode auto ⇒ 同一拍写得下去（否则支一钉的是「CLI 根本不会写」）", () => {
    const { out, written } = runWriteScript({ mode: "auto" });
    expect(written, `auto 档下没写下去 ⇒ 这一拍的失败与缺省档无关：${out}`).toBe(true);
    expect(out).not.toContain("permission denied");
  });

  it("启动时自检沙箱，不可用就明说（不假装有沙箱）", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    // 走 initSandbox 而不是自己 checkSandbox：自检只有一份事实，跑两遍就是多 spawn 一个进程，
    // 而 `handleAgentRun` 读的是模块里那一份。
    expect(src).toContain("await initSandbox()");
    expect(src).toContain("沙箱不可用");
  });

  it("退出时收掉 tracked 子进程（killAllTrackedChildren 的天然调用方就是这里）", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    expect(src).toContain("killAllTrackedChildren");
  });
});

describe("cairn CLI：审批门在没人能答时 fail-closed", () => {
  // 这条钉的是实测过的真缺陷：stdin 非 TTY 时 createInterface 立刻 EOF，
  // rl.question 随后**抛异常**，那个 throw 从 notify 冒进工具执行里，
  // 被 loop 记成「工具失败：readline was closed」——一次没人应答的审批，
  // 在日志里伪装成模型写盘失败。
  it("stdin 非 TTY 时门按 unattended 收束，不等那个 60s 超时", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    expect(src).toContain("process.stdin.isTTY === true");
    // 少掉 `|| !interactive` 那一半的后果正是本条要钉的：管道里会挂满 60s 才拒。
    expect(src).toContain("const unattended = opts.unattended || !interactive");
    // 门按 unattended 收束 = onAsk 当场 decide(false)，不是「不挂 notify 等超时」。
    expect(src).toMatch(/onAsk:[\s\S]{0,200}unattended\)\s*handleAgentDecide\(req\.askId, false\)/);
  });

  it("rl.question 的 throw 被吞掉并转成拒绝（不许冒进工具执行）", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    // 边界用代码标识而不是注释文字（`tests/assertion-health-scan.test.ts` 那条棘轮管这个）。
    // 两个位置还要显式核：`indexOf` 找不到返回 -1，slice 会静默少截一段——断言于是变成"少看一段仍绿"。
    const from = src.indexOf("function promptForApproval");
    const to = src.indexOf("function printHelp");
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    const fn = src.slice(from, to);
    expect(fn).toMatch(/try\s*\{[\s\S]*rl\.question\([\s\S]*\}\s*catch\s*\{/);
    // 决议必须走 agent-runner 导出的真入口（它就是 CLI 那道 appAskGate 的 decide）。
    expect(fn).toContain("handleAgentDecide(req.askId, false");
  });

  it("不再自建 AskGate 实例（自建一个 = 两扇门，模型问的那道和人能答的那道会分叉）", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    expect(src).not.toContain("new AskGate(");
    expect(src).toContain("setAppHooks({");
    expect(src).toContain("onAsk:");
  });
});

/* 「存在 ≠ 接线」那一刀：CLI 以前直接调内层 `runAgent`，绕过了 `handleAgentRun` 那一层。
   那一层里装着 goal 续跑循环、9 个 settings 开关、信封校验——绕过去的后果是 17 个导出入口
   零生产调用者，外加三个最值钱的开关默认全关且无处可翻。

   判据改用**盘上开关**，不读 `src/cli.ts` 的字面量。内层 `runAgent` 从不调 `store()`——
   `planRequiredByDefault` 只在 `handleAgentRun` 那一层被读进 `planRequired` 槽
   （agent-runner.ts:1796）。于是「我手写的 settings.json 被认了」这件事本身，
   就只可能发生在走了应用壳的那条路上：裸调 runAgent 时这个键无人问，写一定落盘。
   同样地，`initSettingsStore` 若没接工作区路径，`store()` 会静默回落 `/tmp/m1e-default-settings.json`
   （settings-handlers.ts:40）⇒ 支一立刻翻成支二。顺序错位也一并被这格钉住。 */
describe("cairn CLI：走应用壳（handleAgentRun），不裸调 runAgent", () => {
  // 下面两条仍读源码：它们钉的是「槽有没有被显式写出来」，而那两面（modelSelection 过信封校验、
  // automation 工具的 installed 幂等守卫）没有等价的产品面观察。已删掉的是**顺序断言**——
  // 「壳四件按序」的可观测后果就是上面那对支一/支二（store 未初始化 ⇒ 静默回落 /tmp ⇒ 支一翻成支二），
  // 再单钉一遍文本位置只是把它换成一个更脆的写法。
  const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");

  it("支一：盘上 planRequiredByDefault=true ⇒ 写禁真的挡住了写（只可能来自 handleAgentRun 那一层）", () => {
    const { out, ws, written, logInWorkspace } = runWriteScript({ mode: "auto", planRequired: true });
    expect(out, "这一拍根本没跑到权限门 ⇒ 这条判卷没有分辨力").toContain("方案门：先批后写");
    // 只打印拒绝不够：那正是把门做成纯 UI 时的样子。盘上必须没有那个文件。
    expect(written, `方案门拒绝了却把文件写进了工作区：${out}`).toBe(false);
    expect(existsSync(join(ws, ".agent", "sessions"))).toBe(true);
    // 会话日志落在工作区的 .agent/sessions 下（`initSessionsDir` 接的正是这条路径）。
    expect(logInWorkspace, `事件日志没落在工作区里：${out}`).toBe(true);
  });

  it("支二：只把那一个键去掉 ⇒ 同一拍同一份剧本写下去了（否则支一钉的是「CLI 什么也不干」）", () => {
    const { out, ws, written } = runWriteScript({ mode: "auto", planRequired: false });
    expect(written, `auto 档下没写下去，这一拍的失败与 plan 门无关：${out}`).toBe(true);
    expect(readFileSync(join(ws, "payload.txt"), "utf8")).toBe("写下来了\n");
    // 对照组的反面：这一拍没有门拦它 ⇒ 没有那句拒绝。这两支只差一个维度，结论却换人。
    expect(out).not.toContain("方案门：先批后写");
  });

  it("--model 自由档走 modelSelection 槽：那一档不在档位表里，过不了信封校验", () => {
    // 2026-10-01 M8：provider 解析从 parseArgs 推迟到 main()（`--replay` 只读日志、没 key 也得能跑），
    // 槽里交给的还是同一个解析结果，只是从 `opts.provider` 换成 main 里的局部 `provider`。
    expect(src).toContain("modelSelection: provider");
    expect(src, "解析仍然只做一次、且发生在起跑前（replay 分支之后）").toContain("provider = resolveProviderSelection(");
  });

  it("automation_* 五个工具不装：定时任务是长驻进程语义，CLI 是一次性进程", () => {
    expect(src).toContain("automationTools: false");
    // 判据在 agent-runner 那一侧（installed 幂等守卫吃的就是这个槽）。
    const runner = readFileSync(join(ROOT, "src", "main", "agent-runner.ts"), "utf8");
    expect(runner).toMatch(/installAppTools\(\{\s*automation: opts\.automationTools,[\s\S]{0,120}omitTools/);
    expect(runner).toMatch(/if \(opts\.automation !== false\) \{\s*\n\s*\/\/ M4a/);
  });
});

describe("cairn CLI：--goal / --session / --compact 三条真入口在 argv 上", () => {
  const help = (): string => runCli(["--help"]).out;

  it("三个 flag 都进了 help（没进 help 的选项等于不存在）", () => {
    expect(help()).toContain("--goal");
    expect(help()).toContain("--session");
    expect(help()).toContain("--compact");
  }, 15_000); // 真起 CLI 子进程读 help：安静态 2.08s（第 262 页，缺省 5s 帽在负载下不够）

  it("闸值单独给 ⇒ exit 2（--max-turns 没有 --goal 就是没落在任何东西上）", () => {
    const r = runCli(["--provider", "demo", "--max-turns", "5", "做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("需要一个 --goal");
  });

  it("--max-turns 非正整数 ⇒ exit 2（静默忽略 = 上限假装生效）", () => {
    const r = runCli(["--provider", "demo", "--goal", "把测试修绿", "--max-turns", "0", "做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--max-turns 要正整数");
  });

  it("--goal 与 --log 互斥（两份日志分叉 = 设了但不生效的目标）", () => {
    const r = runCli(["--provider", "demo", "--goal", "把测试修绿", "--log", "x.jsonl", "做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--log 与 --goal 不能同时给");
  }, 15_000); // 真起 CLI 子进程：安静态 2.39s（第 262 页）

  // 上面那条只钉到「不能同时给」，而这句话真正的信息在后半句：为什么不行（目标只能挂在会话上）
  // 与怎么改（去掉 --log）。理由/出路与「不许吃掉单边写法」各钉一条用例——两根锚点要有唯一指向。
  it("拒 --goal 与 --log 同行时，理由与出路要跟着拒一起给（后半句是给模型的下一步）", () => {
    const both = runCli(["--provider", "demo", "--goal", "把测试修绿", "--log", "x.jsonl", "做点事"]);
    expect(both.status).toBe(2);
    expect(both.out).toContain("目标只能挂在会话上");
    expect(both.out, "拒因必须给出路，否则模型只剩试错").toContain("去掉 --log");
  }, 15_000); // 一次 spawn：安静态 ~0.7s（第 322 页现量）

  it("那道 goal/log 闸不许吃掉单边写法：只给 --goal 或只给 --log 都要放行到后面那道闸", () => {
    // 放行臂用一个**更靠后的**用法闸当探针（--serve 的互斥表）：goal/log 那道闸在 parseArgs 里排在它前面，
    // 所以「喊出来的是 serve 那句」就等于「goal/log 这句没拦住」。缺省任务描述那一支会更早喊，别用。
    const goalOnly = runCli(["--goal", "把测试修绿", "--serve", "做点事"]);
    expect(goalOnly.status).toBe(2);
    expect(goalOnly.out, "只给 --goal 也被拦＝这道闸把 goal 这一档整个吃掉了").not.toContain("目标只能挂在会话上");
    expect(goalOnly.out).toContain("--serve 是常驻调度模式");
    const logOnly = runCli(["--log", "x.jsonl", "--serve", "做点事"]);
    expect(logOnly.status).toBe(2);
    expect(logOnly.out, "只给 --log 同理").not.toContain("目标只能挂在会话上");
    expect(logOnly.out).toContain("--serve 是常驻调度模式");
  }, 20_000); // 两次 spawn：放行臂读的是「哪道闸先喊」，所以各自都要一个真进程

  // 工作区的两种合法形状（`--workspace <目录> <任务>` 与 `<目录> <任务>`）都放行，只有同时给才拒。
  it("--workspace 与位置参数同时给 ⇒ 拒，拒因说清「二者只能取一」", () => {
    const both = runCli(["--workspace", "wsA", "wsB", "做点事"]);
    expect(both.status).toBe(2);
    expect(both.out).toContain("--workspace 与位置参数重复给工作区，二者只能取一");
  }, 15_000); // 一次 spawn

  it("工作区的两种合法形状各自放行（无条件拒会把 `cairn <目录> <任务>` 这条主路杀掉）", () => {
    const flagOnly = runCli(["--workspace", "wsA", "做点事", "--max-turns", "0"]);
    expect(flagOnly.out, "只给 --workspace 也被拒＝flag 形状没了").not.toContain("二者只能取一");
    expect(flagOnly.out).toContain("--max-turns 需要一个 --goal");
    const positionalOnly = runCli(["wsA", "做点事", "--max-turns", "0"]);
    expect(positionalOnly.out, "只给两个位置参数也被拒＝主路没了").not.toContain("二者只能取一");
    expect(positionalOnly.out).toContain("--max-turns 需要一个 --goal");
  }, 20_000); // 两次 spawn

  it("--compact 没指会话 ⇒ exit 2（压缩一条刚编出来的 id 一定报「会话不存在」）", () => {
    const r = runCli(["--provider", "demo", "--compact"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--compact 要指一条已有会话");
  });

  it("非法会话名 ⇒ exit 2（会话名会拼成文件路径）", () => {
    const r = runCli(["--provider", "demo", "--session", "a/b", "做点事"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("--session 非法会话名");
  });
});

/** 把注释剥掉再按次序比（**这里踩过，2026-10-02**）。
 *
 *  这一格量的是**控制流次序**，而 `indexOf` 是一把文本尺：`src/cli.ts:1157` 那句注释写的正是
 *  「**不要**直接 process.exit(130)」——它是句**警告**，却让 `indexOf("process.exit(130)")`
 *  先命中注释 ⇒ 读出「硬退排在守卫之前」⇒ **把正确的实现判成错的**。
 *  实测：`hardExit=9751` 落在注释那一行、`guard=9892` 落在 `if (cancelling)`；
 *  带分号的针脚（`process.exit(130);`）才读到 1164 行那句真语句。
 *
 *  为什么**不改注释**绕开：那等于「为了迁就一把文本尺，不许在代码里写这句警告」，方向反了。
 *  该修的是尺。字符串也要一起剥——否则 `"//"` 这种字面量会把状态机带偏。 */
function stripComments(s: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]!;
    const n = s[i + 1];
    if (quote !== null) {
      if (c === "\\") { out += c + (n ?? ""); i += 1; continue; }
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
    if (c === "/" && n === "/") { while (i < s.length && s[i] !== "\n") i += 1; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i += 1; i += 1; continue; }
    out += c;
  }
  return out;
}

describe("cairn CLI：Ctrl-C 走 handleRunCancel（截断事件流 = 转录对不上账）", () => {
  it("第一次请 run 收束、第二次才硬退——硬退那一支必须整个在 `cancelling` 守卫里", () => {
    const src = readFileSync(join(ROOT, "src", "cli.ts"), "utf8");
    const from = src.indexOf('process.on("SIGINT"');
    expect(from).toBeGreaterThanOrEqual(0);
    // 注释剥掉再比（理由见 `stripComments`）：否则那句"不要直接 process.exit(130)"的**警告**
    // 会被读成"硬退在守卫之前"。剥注释只改文本位置、不改四件事的相对次序。
    const fn = stripComments(src.slice(from));
    expect(fn).toContain("handleRunCancel()");
    expect(fn).toContain("process.exit(130)");
    // **判据是控制流，不是文本先后**：硬退写在 `if (cancelling)` 那一支的**开头**，
    // 文本位置因此排在 handleRunCancel 之前——只比 indexOf 大小会把正确的实现判成错的。
    // 真正要钉住的是这四件事的相对次序：守卫 → 硬退 → 置位 → 收束。
    const guard = fn.indexOf("if (cancelling)");
    const hardExit = fn.indexOf("process.exit(130)");
    const mark = fn.indexOf("cancelling = true");
    const cancel = fn.indexOf("handleRunCancel()");
    expect(guard, "少了二次 Ctrl-C 守卫 = 按第二下会再请一次收束而不是硬退").toBeGreaterThanOrEqual(0);
    expect(hardExit).toBeGreaterThan(guard);
    expect(hardExit, "硬退跑到了守卫外面 = 第一次 Ctrl-C 就把事件流截断").toBeLessThan(mark);
    // 置位先于收束：否则连按两下会连着跑两次 handleRunCancel（而第一下还没生效）。
    expect(mark).toBeGreaterThanOrEqual(0);
    expect(mark).toBeLessThan(cancel);
  });
});

/* clarify / propose_plan 两扇「等人」的门：桌面层被删后它们的决议入口（handleClarifySubmit /
   handlePlanDecide）零调用者，模型一发问就卡在 `await waiting` 永久悬挂。下面的用例用仓库自带的
   M1B_GATE_FLOW 剧本真跑一遍——它是免网的（provider=demo 读 fixture），且剧本第一步就是 clarify、
   第二步就是 propose_plan，正好是原来必挂的那两步。 */
describe("cairn CLI：clarify / propose_plan 两扇门在真跑里都收得住（不悬挂）", () => {
  // 一次真跑喂三条断言：整轮门流程要几秒，拆成三次 spawn 是白烧。
  // 挂死时 spawnSync 的 timeout 会 SIGKILL ⇒ status 必为 null，所以「没挂死」是可否证的，不是「跑得慢」。
  let cached: { status: number | null; out: string; ws: string } | undefined;
  const gateFlow = (): { status: number | null; out: string; ws: string } => {
    cached ??= (() => {
      const ws = mkdtempSync(join(tmpdir(), "cairn-gate-"));
      const r = runCli(["--workspace", ws, "--provider", "demo", "--mode", "default", "走一遍门流程"], {
        env: { M1B_GATE_FLOW: "1" },
        timeout: 60_000,
      });
      return { ...r, ws };
    })();
    return cached;
  };

  it("非交互真跑一遍门流程：进程正常收束（status 不是 null），不是被 timeout 杀掉的", () => {
    const { status, out } = gateFlow();
    expect(out).not.toContain("unsettled top-level await");
    expect(status).not.toBeNull();
  });

  it("澄清门非交互时提交**空答案**——不编造答案，但也不悬挂", () => {
    // `{}` 是 clarify 工具收到的 tool_result：空 map = 「没人答」。编造答案才是这里唯一真危险的事。
    const { out } = gateFlow();
    expect(out).toContain("模型要澄清");
    expect(out).toContain("提交空答案");
    expect(out).toMatch(/✓\s*\{\}/);
  });

  it("方案门非交互时 fail-closed 拒绝，且**写禁因此真的挡住了写**（不只是嘴上说说）", () => {
    const { out, ws } = gateFlow();
    expect(out).toContain("方案待批");
    expect(out).toContain("fail-closed 拒绝");
    expect(out).toContain("方案被拒绝");
    // 剧本批准后要去写 src/todo.ts。方案被拒 ⇒ 权限层必须真的拒它，文件不许存在。
    // 只断言「打印了拒绝」是不够的：那正是把门做成纯 UI 时的样子。
    expect(out).toContain("先批后写");
    expect(existsSync(join(ws, "src", "todo.ts"))).toBe(false);
  });

  /* 原来这条读 `src/cli.ts` 的字面量（`e.type === "plan_proposed"` / `handlePlanDecide` …）。
     改成读**盘上那场真跑的日志**：`plan_approved` 全仓只有一个写点——`handlePlanDecide`
     （agent-runner.ts:2116），其余命中全是读它。所以日志里出现这一条，就等于
     「`plan_proposed` 走 onEvent 进了 agent-runner 导出的那个决议入口」，没法用别的东西顶替。
     clarify 那一半不重复钉：它的决议入口 `handleClarifySubmit` 本来就不落事件
     （查过了），可观测的后果是「不悬挂 + 提交空答案」，已经在上一条里。 */
  it("方案门的决议经 agent-runner 的真入口落到日志里（plan_approved 全仓只有 handlePlanDecide 一个写点）", () => {
    const { ws } = gateFlow();
    const log = join(ws, ".agent", "sessions");
    const files = readdirSync(log).filter((f) => f.endsWith(".jsonl"));
    expect(files, "工作区里没有会话日志 ⇒ 这一轮根本没落盘").toHaveLength(1);
    const types = readFileSync(join(log, files[0]!), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; callId?: string; approved?: boolean });
    expect(types.some((e) => e.type === "clarify_requested"), "澄清门没在事件流上露面").toBe(true);
    const decided = types.filter((e) => e.type === "plan_approved");
    expect(decided, "没有 plan_approved ⇒ CLI 没收 plan_proposed（门是悬着的，不是被拒绝的）").toHaveLength(1);
    // 非交互那一场是拒绝：assertion 必须钉住**具体决议**，不然 `approved:true` 蒙过去也算过。
    expect(decided[0]).toMatchObject({ callId: "c-plan", approved: false });
  });

  /* 事件不许打两遍。2026-09-28 真机跑当场看见的：`handleAgentRun` 的事件有**两个**出口
     （每轮的 `over.onEvent` 与全局的 `hooks.onEvent`，agent-runner.ts:1808-1814），它们本该是
     两个不同消费者。CLI 把同一个渲染函数接到两头，于是 `⚙ read_file` / `✓ …` / `· tokens` /
     整段正文全部成对出现，输出直接没法读。判卷写两层，因为只钉一层各有一个盲区：
     行为层能抓住「打了两遍」，但抓不住「靠别处补偿成一遍」；结构层能抓住「又接了第二个出口」，
     但抓不住「以为接了两头其实一个都没接」。 */
  it("同一行只渲染一遍：行为层无相邻重复行，结构层渲染器只接一个出口", () => {
    const { out } = gateFlow();
    const lines = out.split("\n").map((line) => line.trimEnd());
    const doubled = lines.filter((line, i) => i > 0 && line.trim() !== "" && line === lines[i - 1]);
    // 幂等成对出现 ⇒ 0（真跑量过）；把每一行复制一遍模拟复发 ⇒ 34。所以这条不是「跑得过就算」。
    expect(doubled).toEqual([]);

    // 去注释后再数：注释里讨论 onEvent 是应该的，把注释算进来会让人不敢改注释。
    const code = readFileSync(join(ROOT, "src", "cli.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // 恰好两个：一个定义（`const onEvent = …`）+ 一处接线（`setAppHooks({ onEvent, … })`）。
    // 变成三个就说明渲染器又被接回了 `handleAgentRun` 的 overrides。
    expect(code.match(/\bonEvent\b/g) ?? []).toHaveLength(2);
  });
});

describe("renderEvent：事件 → stdout（全仓第一份渲染器）", () => {
  const ev = (e: Partial<AgentEvent>): AgentEvent => e as AgentEvent;

  it("工具调用带名字与参数摘要（write_file 只报路径，不刷正文）", () => {
    const line = renderEvent(ev({ type: "tool_call", id: "c1", name: "write_file", args: { path: "src/a.ts", content: "很长的正文".repeat(50) } }));
    expect(line).toContain("write_file");
    expect(line).toContain("src/a.ts");
    expect(line).not.toContain("很长的正文");
  });

  it("run_shell 的参数摘要取命令首行", () => {
    const line = renderEvent(ev({ type: "tool_call", id: "c1", name: "run_shell", args: { command: "pnpm test\n--reporter=verbose" } }));
    expect(line).toContain("pnpm test");
    expect(line).not.toContain("reporter=verbose");
  });

  it("成功 / 失败分色可辨（NO_COLOR 下也靠 ✓ / ✗ 区分）", () => {
    expect(renderEvent(ev({ type: "tool_result", callId: "c1", ok: true, output: "done" }))).toContain("✓");
    expect(renderEvent(ev({ type: "tool_result", callId: "c1", ok: false, output: "boom" }))).toContain("✗");
  });

  it("多行输出压成首行（整块刷屏反而看不见发生了什么）", () => {
    const line = renderEvent(ev({ type: "tool_result", callId: "c1", ok: true, output: "\n\n真正的第一行\n后面还有一百行" }));
    expect(line).toContain("真正的第一行");
    expect(line).not.toContain("后面还有一百行");
  });

  it("空 assistant_message 不打空行", () => {
    expect(renderEvent(ev({ type: "assistant_message", content: "" }))).toBeNull();
  });

  it("不进 stdout 的事件返回 null（它们在 JSONL 里，需要时 replay）", () => {
    expect(renderEvent(ev({ type: "session_meta" }))).toBeNull();
  });
});

/* worker 的 diff 借一条 tool_result 落地（events 层没有承载 diff 本体的事件类型），output 是
   `[diff] vN vs <sha>\n## stat\n## patch` 整块。从前它跟别的 tool_result 一起被 firstLine()
   压成一行——stat 和 patch 全丢，而看不见的 diff 等于没有审查面。
   ⚠️ 2026-10-01 同步（M8 增量）：第 245 页起收据 callId 走 **spawnCallId**（回执合并语义，
   orchestrator-hold 有判卷钉着），旧的 `startsWith("diff-")` 判定在主干路径上**从来匹配不到**——
   这个夹具当年喂的是恒真的老形状，所以一直绿。现在按生产端有意埋的 `[diff] v` 头判（两侧同标记
   有 tests/diff-review.test.ts 的棘轮钉着），夹具换回真形状；老兜底形状单独留一条证人。
   ⚠️ 本组用例**标题**是留档 `outputs/judge-timeout-2026-10-01/suite-quiet.json` 的重数键
   （head-cert-deps 的「真机整表」按标题在现源码里重找成因；2026-10-01 实测：改一个标题
   ⇒ `notResolved` 0→1 当场红）——**改名要同时重产那份留档 json**，别只改源码。 */
describe("renderEvent：worker diff 整块落地，不被首行压缩吃掉", () => {
  const ev = (e: Partial<AgentEvent>): AgentEvent => e as AgentEvent;

  const diff = (patch: string) =>
    ev({
      type: "tool_result",
      callId: "call_8f66c40e573e47478b3b64d5", // spawn 的真实 callId（非 "diff-" 前缀）
      agent_id: "ag-1",
      ok: true,
      output: "[diff] v1 vs 0a1b2c3d4e5f（worktree .agents/wt-ag-1，含未提交改动）\n## stat\n src/a.ts | 2 +-\n## patch\n" + patch,
    });

  it("stat 与 patch 都在（压首行的话模型改了什么就彻底看不见了）", () => {
    const line = renderEvent(diff("-  const x = 1;\n+  const x = 2;"));
    expect(line).toContain("## stat");
    expect(line).toContain("src/a.ts | 2 +-");
    expect(line).toContain("## patch");
    expect(line).toContain("+  const x = 2;");
  });

  it("老兜底形状（callId 是 `diff-<agent>`，无 spawn id 的内部 worker）同样整块打", () => {
    const line = renderEvent(ev({ ...(diff("-  const x = 1;") as object), callId: "diff-ag-1" } as AgentEvent));
    expect(line).toContain("## patch");
  });

  // 标题逐字保持与留档 json 一致（见上 ⚠️）：它是重数键，不是可以随手润色的文案。
  it("普通的 tool_result 仍然压首行（这条豁免只对 diff-* 生效，否则整个渲染面就成刷屏了）", () => {
    const line = renderEvent(ev({ type: "tool_result", callId: "c1", ok: true, output: "## patch\n不该整块打" }));
    expect(line).toContain("## patch");
    expect(line).not.toContain("不该整块打");
  });
});

describe("renderEvent：worker 生命周期与目标事件上屏（看不见 = 等于没发生过多 agent 编排）", () => {
  const ev = (e: Partial<AgentEvent>): AgentEvent => e as AgentEvent;

  it("派出 worker 报 id / 档位 / 任务", () => {
    const line = renderEvent(ev({ type: "agent_spawned", agent_id: "ag-1", parent_event_id: 3, mode: "read", task: "查清谁在改 src/a.ts", max_turns: 6, permission_mode: "default" }));
    expect(line).toContain("ag-1");
    expect(line).toContain("read");
    expect(line).toContain("查清谁在改 src/a.ts");
  });

  it("终态分色可辨：done 是绿的，failed / cancelled 是红的", () => {
    expect(renderEvent(ev({ type: "agent_status", agent_id: "ag-1", status: "done" }))).toContain("done");
    expect(renderEvent(ev({ type: "agent_status", agent_id: "ag-1", status: "failed", reason: "max_turns" }))).toContain("max_turns");
    expect(renderEvent(ev({ type: "agent_status", agent_id: "ag-1", status: "cancelled" }))).toContain("cancelled");
  });

  it("worker 报告整块打，过程消息压首行（结论要看得见，流水不必）", () => {
    const report = renderEvent(ev({ type: "agent_message", agent_id: "ag-1", kind: "report", text: "第一行\n第二行也要看得见" }));
    expect(report).toContain("第二行也要看得见");
    const progress = renderEvent(ev({ type: "agent_message", agent_id: "ag-1", kind: "progress", text: "第一行\n后面还有一百行" }));
    expect(progress).toContain("第一行");
    expect(progress).not.toContain("后面还有一百行");
  });

  it("worker 终态回传带上机器凭据：证据四态 + 价格标签（散文自述不算证据）", () => {
    const line = renderEvent(ev({
      type: "agent_result", agent_id: "ag-1", status: "done",
      summary: "改好了", usage: { inputTokens: 10, outputTokens: 20 }, tool_stats: {},
      artifacts: { verified: "verified", spent_usd: 0.0123, files_changed: ["src/a.ts"] },
    }));
    expect(line).toContain("verified");
    expect(line).toContain("$0.0123");
    expect(line).toContain("改 1 个文件");
  });

  it("价格不可知时**不**印 $0.00（把不可知记成免费 = 这轮没花钱的假证据）", () => {
    const line = renderEvent(ev({
      type: "agent_result", agent_id: "ag-1", status: "done",
      summary: "没查表", usage: { inputTokens: 10, outputTokens: 20 }, tool_stats: {}, artifacts: {},
    }));
    expect(line).not.toContain("$");
  });

  it("影响面报告：半径 0 也要看得见（那正是「改它没人调用」）", () => {
    expect(renderEvent(ev({ type: "impact_report", file: "src/a.ts", symbols: ["x"], up: [], truncated: false }))).toContain("无跨文件调用点");
    const up = renderEvent(ev({ type: "impact_report", file: "src/a.ts", symbols: ["x"], up: [{ symbol: "y", file: "src/b.ts", line: 3 }], truncated: true }));
    expect(up).toContain("波及 1 处调用点");
    expect(up).toContain("已截断");
  });

  it("目标设定与停止都要上屏（停止理由是用户唯一能查到的「为什么不跑了」）", () => {
    const set = renderEvent(ev({ type: "goal_set", objective: "把测试修绿", max_turns: 8, max_usd: 0.5 }));
    expect(set).toContain("把测试修绿");
    expect(set).toContain("8 轮");
    expect(set).toContain("$0.5");
    const stopped = renderEvent(ev({ type: "goal_stopped", reason: "证据 failed：验证红", turn: 3, evidence: "failed" }));
    expect(stopped).toContain("证据 failed");
    expect(stopped).toContain("验证红");
  });

  it("美元闸关着时（max_usd = 0）不印一个假的 $0 上限", () => {
    const set = renderEvent(ev({ type: "goal_set", objective: "x", max_turns: 8, max_usd: 0 }));
    expect(set).not.toContain("$");
  });
});

// ---- S-3：`--compact` 真的会调模型，help 原文那句「不跑模型」是假的 ----
// 缺陷形状是**文档比代码乐观**：help 写着不跑模型 ⇒ 用户以为不用配 key，真跑被挡在门外
// 却不知道自己缺什么。修法是让 help 兑现真话（要 CAIRN_API_KEY）+ 补 README，不是把代码改成
// 假装不调模型（那只是把谎言从一处挪到另一处，还顺手放开了 --model 的校验）。
// 判卷是**对比支**：同一个命令、只差「有没有摘要器」一个维度，结论从「拒绝且盘上一个字节没动」
// 换成「压了并落一条 compaction」。两支都断言，不靠「跑一次看看」——只钉一支的话，
// 把它整段删掉也照样绿。
describe("cairn CLI：--compact 要摘要模型，没它就 fail-closed（不许静默截断）", () => {
  const SESSION = "compact-probe";
  // 「env 里有把 key」的占位值：值本身零语义（子进程只判非空），形状刻意不模仿任何家的凭据。
  const PRESENT_IN_ENV = "cairn-unused-placeholder";
  let ws = "";
  const logOf = (): string => join(ws, ".agent", "sessions", `${SESSION}.jsonl`);
  const typesOnDisk = (): string[] =>
    readFileSync(logOf(), "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { type: string }).type);

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "cairn-compact-"));
    mkdirSync(join(ws, ".agent", "sessions"), { recursive: true });
    writeFileSync(
      logOf(),
      JSON.stringify({ type: "user_message", content: "第一条" }) + "\n" +
        JSON.stringify({ type: "assistant_message", content: "回了一条很长的话。".repeat(300) }) + "\n",
      "utf8",
    );
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  // 支一：provider 解析得过（OPENAI_API_KEY 在），但**没有摘要器**——CAIRN_API_KEY 缺、演示档也没开。
  // 这一支钉的是「不许静默压」：把长历史悄悄砍掉，用户以为省了上下文，实际是不可逆的信息损失。
  it("支一：没有可用摘要器 ⇒ exit 1 + 点名 CAIRN_API_KEY，且会话日志一个字节没动", () => {
    const before = readFileSync(logOf(), "utf8");
    const r = runCli(["--workspace", ws, "--session", SESSION, "--compact"], {
      noKeys: false, env: { OPENAI_API_KEY: PRESENT_IN_ENV, M1D_COMPACTION_DEMO: "0" },
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("CAIRN_API_KEY");
    expect(r.out).toContain("压缩失败");
    expect(typesOnDisk(), "拒绝时也落了 compaction = 静默压缩").not.toContain("compaction");
    expect(readFileSync(logOf(), "utf8")).toBe(before);
  });

  // 支二：与支一只差 M1D_COMPACTION_DEMO 一个维度 ⇒ 同一个命令这次真压，且压完留痕。
  // 这一支是支一的分辨力所在：两支都「exit 0 / 不动盘」的话这条判卷恒真。
  it("支二：摘要器在（演示档）⇒ exit 0，会话末尾多一条 compaction", () => {
    const r = runCli(["--workspace", ws, "--session", SESSION, "--compact"], {
      noKeys: false, env: { OPENAI_API_KEY: PRESENT_IN_ENV, M1D_COMPACTION_DEMO: "1" },
    });
    expect(r.status, "run 失败诊断：" + r.out).toBe(0);
    expect(r.out).toContain("已压缩会话");
    expect(typesOnDisk()).toContain("compaction");
  });

  it("help 不再承诺「不跑模型」，改说清要哪把 key（缺陷本体就是这句假话）", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    // 收**选项表里那一行**（`^\s+--compact\s`），不是用法示例那行——示例行本来就没承诺什么，
    // 拿它当判据的话，这句断言恒真，等于没钉。
    const line = r.out.split("\n").find((l) => /^\s+--compact\s/.test(l)) ?? "";
    expect(line).not.toContain("不跑模型");
    expect(line).toContain("CAIRN_API_KEY");
  });

  it("--compact 缺 --session ⇒ exit 2（不编一个会话 id 出来再报「不存在」）", () => {
    const r = runCli(["--workspace", ws, "--compact"], { noKeys: false, env: { OPENAI_API_KEY: PRESENT_IN_ENV } });
    expect(r.status).toBe(2);
    expect(r.out).toContain("--session");
  });
});

describe("cairn CLI：M5b 路由开关（--bandit / --cascade 一族）", () => {
  it("--help 列出这四枚旗标（没进 help 的选项等于不存在）", () => {
    const out = runCli(["--help"]).out;
    for (const f of ["--bandit", "--no-bandit", "--cascade", "--no-cascade"]) {
      expect(out, `${f} 没进 --help`).toContain(f);
    }
  });

  it("--bandit / --cascade 各占选项表里一行（与其它开关同形，不是夹在示例里的散字）", () => {
    const out = runCli(["--help"]).out;
    expect(out.split("\n").some((l) => /^\s+--bandit\s/.test(l))).toBe(true);
    expect(out.split("\n").some((l) => /^\s+--cascade\s/.test(l))).toBe(true);
  });

  it("矛盾旗标（--bandit 与 --no-bandit 同时给）⇒ exit 2，报文点名两枚", () => {
    const r = runCli(["--bandit", "--no-bandit", "做点事"]);
    expect(r.status, "run 输出：" + r.out).toBe(2);
    expect(r.out).toContain("--bandit");
    expect(r.out).toContain("--no-bandit");
  });

  it("--max-usd 已在 help 里（「三个最值钱的开关」里它早就有旗标了，别再当缺件）", () => {
    expect(runCli(["--help"]).out).toContain("--max-usd");
  });

  it("三跳接线都在源文本里（旗标解析 → over → 编排器装配）：摘任一跳都得变红", () => {
    // 这一格是**存在性**的钉子（本仓那句「守卫原文钉不住可用态那条路」照样适用）：语义那一半由
    // tests/routing-flags.test.ts 的纯函数判据量（四种组合 / 矛盾拒跑 / 等价性），这里只保证那条链
    // 没被拆——摘掉任一跳，旗标就变回「有机制、零流量」，而下面的纯函数判据仍会全绿。
    const cli = readFileSync(join(ROOT, "src/cli.ts"), "utf8");
    const runner = readFileSync(join(ROOT, "src/main/agent-runner.ts"), "utf8");
    expect(cli, "cli.ts 没把解析出的覆盖递进 handleAgentRun 的 over").toContain("...opts.routingOverrides");
    expect(runner, "agent-runner 没把 opts.routing 透到 buildSessionOrchestrator").toContain("...(opts.routing ? { routing: opts.routing } : {})");
    expect(runner, "over 没与 settings 合（取值面那一行没了）").toContain("resolveRoutingFlags(over, s)");
  });
});
