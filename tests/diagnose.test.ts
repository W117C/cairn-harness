// M3 · diagnose 的判卷：解析层（真实/规范样本逐条钉）+ 工具层（离网、假执行器）+ 三面对账。
// 解析层的样本出处逐条标在注释里：本仓真跑输出两份，各工具的公开稳定格式两份——不编格式。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DIAGNOSTIC_ENTRY_CAP, parseDiagnostics } from "../src/tools/diagnose-parse";
import { createDiagnoseTool, diagnoseSurface, diagnoseSpec } from "../src/tools/diagnose";
import { sessionToolSpecs } from "../src/agent/session-provider";
import { isSideEffectTool } from "../src/permissions";
import type { ExecFn } from "../src/agent/verify";

/** 真实样本①：本仓 tsc 真跑（2026-10-01，docs-check 在飞改动的报错，逐字抄）。 */
const REAL_TSC = [
  "scripts/docs-check.ts(251,21): error TS2820: Type '\"D-12\"' is not assignable to type '\"D-1\" | \"D-2\"'. Did you mean '\"D-1\"'?",
  "scripts/docs-check.ts(253,21): error TS2820: Type '\"D-12\"' is not assignable to type '\"D-1\" | \"D-2\"'. Did you mean '\"D-1\"'?",
].join("\n");

/** 真实样本②：本仓 vitest 5.x 真跑（reverse-verify-guard-off.log 的失败块，保留形状、截短消息）。 */
const REAL_VITEST = [
  "⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯",
  "",
  " FAIL  tests/apply-patch.test.ts > apply_patch：把计划落到盘上 > 上下文漂移：报出是哪一段、第几行、期望什么、实际是什么",
  "AssertionError: expected '' to contain 'src/a.ts 第 1 个 hunk'",
  "",
  "- Expected",
  "+ Received",
  "",
  " ❯ tests/apply-patch.test.ts:233:17",
  "    231|     await writeFile(join(dir, \"src\", \"a.ts\"), A_ORIG.replace(\"line1\", …",
].join("\n");

/** 规范样本③：eslint stylish（文件头 + 缩进表体，rule 可带 scoped 名）。 */
const ESLINT_STYLISH = [
  "/Users/x/proj/src/a.ts",
  "  12:5  error  'x' is defined but never used  @typescript-eslint/no-unused-vars",
  "  14:1  warning  Missing semicolon  semi",
  "",
  "/Users/x/proj/src/b.py",
  "  3:1  error  Undefined name 'y'  F821",
].join("\n");

/** 规范样本④：gcc/ruff 一族的 unix 形状（severity 词 + 尾随 [RULE]；note 不是条目）。 */
const UNIX_LIKE = [
  "src/util.c:12:5: error: expected ';' before '}' token",
  "src/util.c:20:3: warning: unused variable 'x' [-Wunused-variable]",
  "src/util.c:25:1: note: expected 'int (*)(char *)' but argument is of type 'void (*)(char *)'",
  "src/app.py:12:5: E501 Line too long (120 > 88)",
].join("\n");

describe("parseDiagnostics：四种形状各认各的，认不出的不猜", () => {
  it("tsc 真样本：file/line/col/rule/severity/message 全字段落地", () => {
    const d = parseDiagnostics(REAL_TSC);
    expect(d.total).toBe(2);
    expect(d.entries[0]).toMatchObject({
      file: "scripts/docs-check.ts",
      line: 251,
      col: 21,
      severity: "error",
      rule: "TS2820",
    });
    expect(d.entries[0]!.message).toContain("not assignable");
  });

  it("vitest 真样本：FAIL 行出条目，紧随的 `❯ file:line:col` 把位置补上", () => {
    const d = parseDiagnostics(REAL_VITEST);
    expect(d.total).toBe(1);
    expect(d.entries[0]).toMatchObject({ file: "tests/apply-patch.test.ts", line: 233, col: 17, severity: "error" });
    expect(d.entries[0]!.message).toContain("上下文漂移");
  });

  it("vitest：位置行文件对不上时不硬塞（补错文件的行号比不补更坏）", () => {
    const mismatched = REAL_VITEST.replace("❯ tests/apply-patch.test.ts:233:17", "❯ tests/other.test.ts:9:9");
    const d = parseDiagnostics(mismatched);
    expect(d.entries[0]!.line).toBeUndefined();
  });

  it("eslint stylish：文件头跨块跟踪，表体行带 rule", () => {
    const d = parseDiagnostics(ESLINT_STYLISH);
    expect(d.total).toBe(3);
    expect(d.entries.map((e) => e.file)).toEqual([
      "/Users/x/proj/src/a.ts", "/Users/x/proj/src/a.ts", "/Users/x/proj/src/b.py",
    ]);
    expect(d.entries[0]).toMatchObject({ line: 12, col: 5, severity: "error", rule: "@typescript-eslint/no-unused-vars" });
    expect(d.entries[1]).toMatchObject({ severity: "warning", rule: "semi" });
    expect(d.entries[2]).toMatchObject({ file: "/Users/x/proj/src/b.py", rule: "F821" });
  });

  it("unix 族：severity 词与尾随 [RULE] 各归各位；note 不是可执行条目", () => {
    const d = parseDiagnostics(UNIX_LIKE);
    expect(d.total, "note 不该进条目；其余三条进").toBe(3);
    expect(d.entries[0]).toMatchObject({ file: "src/util.c", line: 12, col: 5, severity: "error" });
    expect(d.entries[0]!.message).toBe("expected ';' before '}' token");
    expect(d.entries[1]).toMatchObject({ severity: "warning", rule: "-Wunused-variable" });
    expect(d.entries[1]!.message).toBe("unused variable 'x'");
    expect(d.entries[2]).toMatchObject({ file: "src/app.py", severity: "error" });
    expect(d.entries[2]!.rule, "ruff 这类无 severity 记号也无尾随 RULE 的格式不编字段").toBeUndefined();
  });

  it("截断有界且如实：50 条只列 40，total 仍报 50（不许把「只列了 40」读成「一共 40」）", () => {
    const many = Array.from({ length: 50 }, (_, i) => `src/f${String(i)}.ts(1,1): error TS1001: boom`).join("\n");
    const d = parseDiagnostics(many);
    expect(d.entries).toHaveLength(DIAGNOSTIC_ENTRY_CAP);
    expect(d.total).toBe(50);
    expect(d.truncated).toBe(true);
  });

  it("带色输出照样认（真实字节：FAIL 行裹 \\u001b[41m\\u001b[1m、位置行裹 \\u001b[36m\\u001b[2m）", () => {
    // 逐字取自 reverse-verify-guard-off.log 的真实转义序列——第一版解析器在这上面整块失明（0 条）。
    const coloredFail =
      "\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m tests/apply-patch.test.ts\u001b[2m > \u001b[22mapply_patch：把计划落到盘上\u001b[2m > \u001b[22m上下文漂移：报出是哪一段、第几行、期望什么、实际是什么";
    const coloredLoc = "\u001b[36m \u001b[2m❯\u001b[22m tests/apply-patch.test.ts:\u001b[2m233:17\u001b[22m\u001b[39m";
    const d = parseDiagnostics([coloredFail, "AssertionError: boom", coloredLoc].join("\n"));
    expect(d.total).toBe(1);
    expect(d.entries[0]).toMatchObject({ file: "tests/apply-patch.test.ts", line: 233, col: 17 });
    // tsc 带色同理（`error` 一词常被着成红色）
    const coloredTsc = "src/a.ts(1,2): \u001b[31merror\u001b[39m TS1001: boom";
    expect(parseDiagnostics(coloredTsc).entries[0]).toMatchObject({ file: "src/a.ts", line: 1, col: 2, rule: "TS1001" });
  });

  it("全绿的 vitest 输出产出 0 条（0 条≠尺瞎：这条是负控，防止把 ✓ 行也吃成条目）", () => {
    const green = [" RUN  v5.0.0 /repo", " ✓ tests/a.test.ts (3 tests) 12ms", " Test Files  1 passed (1)", "      Tests  3 passed (3)"].join("\n");
    const d = parseDiagnostics(green);
    expect(d.total).toBe(0);
    expect(d.entries).toEqual([]);
  });

  it("散文里的 `xx:12:5:` 不产幽灵条目（路径门槛在挡）", () => {
    const prose = ["AssertionError: expected 'a:12:5: b' to contain 'x'", "see message:12:5: parts"].join("\n");
    const d = parseDiagnostics(prose);
    expect(d.total).toBe(0);
  });
});

describe("diagnose 工具：离网（假执行器），配置面/结构化/兜底/容量各钉一条", () => {
  let dir: string;
  const ctx = (): { workspace: string } => ({ workspace: dir });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "diagnose-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const writePkg = async (scripts: Record<string, string>): Promise<void> => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts }), "utf8");
  };
  const writeVerify = async (verify: Record<string, unknown>): Promise<void> => {
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, ".agent", "config.json"), JSON.stringify({ verify }), "utf8");
  };
  const okExec = (): ExecFn => async (command, _cwd, _t) => ({ command, ok: true, output: "all good" });

  it("无可诊断面：surface=false，调用如实报缺（fail-closed，不空转）", async () => {
    expect(await diagnoseSurface(dir)).toBe(false);
    const r = await createDiagnoseTool({ exec: okExec() }).run({}, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("没有可诊断面");
  });

  it("坏配置按「没有」处理（surface=false，整轮 run 不该因它起不来）", async () => {
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, ".agent", "config.json"), "{not json", "utf8");
    expect(await diagnoseSurface(dir)).toBe(false);
    await expect(createDiagnoseTool({ exec: okExec() }).run({}, ctx())).rejects.toThrow(/读 verify 配置失败/);
  });

  it("有 package.json scripts.test ⇒ surface=true；跑绿 ⇒ ok:true 且回执点名命令", async () => {
    await writePkg({ test: "node --test" });
    expect(await diagnoseSurface(dir)).toBe(true);
    const r = await createDiagnoseTool({ exec: okExec() }).run({}, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("✅ 通过");
    expect(r.output).toContain("pnpm run test");
  });

  it("失败命令：结构化条目逐条列出（含文件:行:列 与规则），计数与退出码都带出", async () => {
    await writeVerify({ lint: ["pnpm run lint"], test: ["pnpm test"], timeoutMs: 5000 });
    const calls: { command: string; timeoutMs?: number }[] = [];
    const exec: ExecFn = async (command, _cwd, timeoutMs) => {
      calls.push({ command, timeoutMs });
      return command === "pnpm run lint"
        ? { command, ok: false, output: REAL_TSC, cause: "code" as const, exitCode: 1 }
        : { command, ok: true, output: "" };
    };
    const r = await createDiagnoseTool({ exec }).run({}, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("scripts/docs-check.ts:251:21 error [TS2820]");
    expect(r.output).toContain("结构化 2 条");
    expect(r.output).toContain("exit 1 · code");
    expect(calls.map((c) => c.command)).toEqual(["pnpm run lint", "pnpm test"]);
    expect(calls.every((c) => c.timeoutMs === 5000), "配置的超时逐条穿到执行器").toBe(true);
  });

  it("face=lint 只跑 lint 那一类（test 一条都不起）", async () => {
    await writeVerify({ lint: ["pnpm run lint"], test: ["pnpm test"] });
    const calls: string[] = [];
    const exec: ExecFn = async (command) => {
      calls.push(command);
      return { command, ok: true, output: "" };
    };
    const r = await createDiagnoseTool({ exec }).run({ face: "lint" }, ctx());
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["pnpm run lint"]);
  });

  it("face 非法值点名拒绝（不静默回落成「都跑」）", async () => {
    await writePkg({ test: "node --test" });
    await expect(createDiagnoseTool({ exec: okExec() }).run({ face: "nope" }, ctx())).rejects.toThrow(/face 只认 lint \/ test/);
  });

  it("解析不出条目时不编结构：原文尾部照带（有界），并明写「未解析出」", async () => {
    await writePkg({ test: "node --test" });
    const exec: ExecFn = async (command) => ({ command, ok: false, output: "boom: everything is broken", exitCode: 2 });
    const r = await createDiagnoseTool({ exec }).run({}, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("未从这条命令的输出解析出结构化错误");
    expect(r.output).toContain("│ boom: everything is broken");
  });

  it("三面对账（与生产同一份谓词）：写向类=true；只读档从模型面摘除，可写档在面上", () => {
    expect(isSideEffectTool("diagnose"), "autonomy 写向表：漏登=只读档不摘除、方案门不挡、沙箱通道失效").toBe(true);
    const ro = sessionToolSpecs({ mode: "read-only", pluginTools: [diagnoseSpec] });
    expect(ro.specs.some((s) => s.function.name === "diagnose")).toBe(false);
    const auto = sessionToolSpecs({ mode: "auto", pluginTools: [diagnoseSpec] });
    expect(auto.specs.some((s) => s.function.name === "diagnose")).toBe(true);
  });
});
