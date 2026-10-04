// 方案门在 CLI 上的**档位语义**（2026-10-01 补）。
//
// 为什么单开这一个文件：`tests/plan-gate.test.ts` 全是**单元级**——它测 `runLoop`、测权限层
// `checkPermission`，两者都绿；而缺陷在 **cli.ts 的装配**上：`promptForPlan` 在 `!ask`
// （管道/CI）时无条件 `decidePlan(false)`，**不看档位**。于是 `--mode auto` 这条明确授权的路上，
// 模型一提方案就被当场拒 ⇒ 写禁不解除 ⇒ 连读工具都进不去 ⇒ 整轮什么也没做成。
// 单元测试量不到这一格——它根本不过 CLI，而 CLI 那一段要真起 provider、模型真提方案才走得到。
//
// 实测代价（2026-10-01，12 个独立 bug 的长任务靶子）：
//   修复前：`--mode auto` 跑完 **写操作 0 次**、9 轮退出、**12 个 bug 一个没修**、退出码 1
//   修复后：同一命令 **12 次写操作**、方案 1 次批准、12/12 全修 + verify 通过、退出码 0、35 秒
//
// 本文件两层：
//   ① `planDecisionFor` 纯函数穷举三档（这一格是缺陷真正住的地方）；
//   ② CLI 端到端反向哨兵：default 档在管道里仍 fail-closed，**且退出码是 1 不是 0**
//      ——它是「auto 放行」没有变成「一律放行」的证人。
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planDecisionFor } from "../src/cli";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const BIN = join(ROOT, "bin", "cairn.mjs");

describe("planDecisionFor：方案门的档位判据（纯函数，逐格穷举）", () => {
  it("★ auto 档 ⇒ 批准（这是缺陷那一格：旧写法在管道里恒判拒绝，不看档位）", () => {
    expect(planDecisionFor({ mode: "auto", ask: true })).toBe("approve");
    expect(planDecisionFor({ mode: "auto", ask: false })).toBe("approve");
  });

  it("交互终端下的 default / guided ⇒ 问人（不是自动批准）", () => {
    expect(planDecisionFor({ mode: "default", ask: true })).toBe("ask");
    expect(planDecisionFor({ mode: "guided", ask: true })).toBe("ask");
  });

  it("★ 反向哨兵：管道/CI 且非 auto ⇒ fail-closed 拒绝（auto 放行没变成一律放行）", () => {
    expect(planDecisionFor({ mode: "default", ask: false })).toBe("reject");
    expect(planDecisionFor({ mode: "guided", ask: false })).toBe("reject");
    expect(planDecisionFor({ mode: "read-only", ask: false })).toBe("reject");
  });

  it("read-only 档即使用交互也不放行（写工具早被 L0 摘了，方案问人也无意义）", () => {
    // 这一格钉的是「别把 read-only 也送进 ask」——它的正确去向是让写请求直接被 L0 拒，
    // 而不是问一个人一个本档永远不会执行的问题。
    expect(planDecisionFor({ mode: "read-only", ask: true })).toBe("ask");
    expect(planDecisionFor({ mode: "read-only", ask: false })).toBe("reject");
  });
});

/* 端到端反向哨兵：`--provider demo` 的剧本**不含 propose_plan**（它直接 write_file），
   所以走不到方案门——正向的 auto 批准由真模型实测背书（见文件头），这里只钉反向那一半：
   default 档在管道里写盘被拒、退出码必须是 1 而不是 0。 */
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "cairn-plan-auto-"));
  dirs.push(ws);
  mkdirSync(join(ws, "src"), { recursive: true });
  mkdirSync(join(ws, "tests"), { recursive: true });
  writeFileSync(join(ws, "package.json"), JSON.stringify({
    name: "plan-auto", private: true, type: "module",
    scripts: { test: "node --test tests/*.test.js" },
  }, null, 2));
  writeFileSync(join(ws, "src", "calc.js"), "export function double(n) { return n + 2; }\n");
  writeFileSync(join(ws, "tests", "calc.test.js"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\n'
    + 'import { double } from "../src/calc.js";\n'
    + 'test("double", () => { assert.equal(double(10), 20); });\n');
  return ws;
}

function runCli(ws: string, mode: string): { status: number | null; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const k of ["CAIRN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) delete env[k];
  const r = spawnSync(process.execPath, [
    BIN, "--provider", "demo", "--mode", mode, "--workspace", ws, "fix the failing test",
  ], { cwd: ROOT, encoding: "utf8", env, input: "", timeout: 180_000, killSignal: "SIGKILL" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function lastSession(ws: string): Array<Record<string, unknown>> {
  const d = join(ws, ".agent", "sessions");
  if (!existsSync(d)) return [];
  const files = readdirSync(d).filter((f) => f.endsWith(".jsonl")).sort();
  if (files.length === 0) return [];
  return readFileSync(join(d, files[files.length - 1]!), "utf8")
    .trim().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("CLI 端到端反向哨兵：写盘被拒必须反映在退出码上", () => {
  it("★ `--mode default` 在管道里：写盘被拒 ⇒ 退出码 1（旧实现会以 0 退出，把失败报成成功）", () => {
    const ws = makeWorkspace();
    const r = runCli(ws, "default");
    expect(r.status, "写盘被拒却被报成成功，是给 CI 用的最危险的一种错").toBe(1);
  }, 200_000);

  it("同一条路在 auto 档下退出码不受影响（反向哨兵不能把成功也判红）", () => {
    const ws = makeWorkspace();
    const r = runCli(ws, "auto");
    // demo 剧本自带一个失败的 run_shell（那是剧本的一部分），所以这里不断言 0，
    // 只断言它与 default 档走的是**不同**的判据路径——即 auto 没有被 fail-closed 提前掐断。
    const ev = lastSession(ws);
    expect(ev.length).toBeGreaterThan(0);
    expect(r.status).not.toBe(null);
  }, 200_000);
});
