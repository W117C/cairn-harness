// `autoVerifyRepair` 的第一份**确定性**端到端读数（2026-10-13 第 470 页）。
//
// 动因：第 469 页在真模型面上量这个机制，6 趟对照臂里它**一次都没触发**
// （自然命中「跑过 shell 之后模型收工」这个形状太少）⇒ 那批读数里开关值不值那一倍成本量不出来。
// 修法分两笔：① 给靶场剧本面加 `round_end` 哨兵（`fixtures/bench/scripts/narration-stop/`），
// 把那一拍钉成确定性输入；② 本文件跑 OFF/ON 两个臂，把分歧写成具名断言。
//
// 两个方向都断言（少任何一个，退化都能全绿）：
//   OFF（产品缺省）：轮 3 收工 ⇒ 收束闸补一拍（闸拍=1）⇒ 红 ⇒ 直接收——剧本第 4 轮（修复）根本不会被要到
//   ON （--auto-verify-repair）：红拍之后再要一轮 ⇒ 拿到第 4 轮 ⇒ 写盘 ⇒ 第二拍绿（闸拍=2）⇒ 收
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = "fixtures/bench/scripts/narration-stop/script.jsonl";
const TASKS = "fixtures/bench/tasks.json";
const OUT_OFF = ".tmp/dsh-repair-arm-off";
const OUT_ON = ".tmp/dsh-repair-arm-on";
const spawnedDirs = [OUT_OFF, OUT_ON];

interface Run {
  status: number | null;
  out: string;
  readings: { r: Record<string, never>; g: { ok: boolean } }[] | undefined;
}

/** 零花费：`--scripted=` 剧本面，摘掉全部凭据（它本来也不拨号）。 */
function runLoopEval(extra: string[], outRel: string): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const k of ["CAIRN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) delete env[k];
  const r = spawnSync(process.execPath,
    ["--import", "tsx", "scripts/loop-eval.ts", "--tasks", TASKS, "--scripted=" + SCRIPT,
      "--only", "B1-bugfix-crossfile", "--out", outRel, ...extra],
    { cwd: ROOT, encoding: "utf8", env, timeout: 180_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const file = join(ROOT, outRel, "readings.json");
  return { status: r.status, out, readings: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined };
}

/** 读数的脸是 `[{ r, g }]`；这里**不自己重算**任何一格。 */
function firstReading(run: Run, label: string): Record<string, never> {
  expect(run.readings, `${label}：readings.json 没落盘或不是数组面（跑器换了形状，这里先红）\n--- 末尾原文 ---\n${run.out.slice(-600)}`).toBeInstanceOf(Array);
  return run.readings![0]!.r;
}

describe("拿哨兵剧本量 autoVerifyRepair：OFF 收在红上、ON 多要一轮把盘改了", () => {
  it("OFF（产品缺省）：收束闸补一拍就收（闸拍=1、一次写盘都没有、隐藏面红）", () => {
    const run = runLoopEval([], OUT_OFF);
    expect(run.status, run.out.slice(-600)).toBe(0);
    expect(run.readings, run.out.slice(-600)).toHaveLength(1);
    const r = firstReading(run, "OFF 臂");
    expect(run.readings![0]!.g.ok, "OFF 臂必须红——否则这条链没有可分辨的分歧（ON 臂的绿就不算证据）").toBe(false);
    expect(r["arm"], "OFF 臂的面名必须是 base（不带 --arm 的缺省）").toBe("base");
    expect(r["autoVerifyBeats"], "补一拍就该收").toBe(1);
    expect(r["changedFiles"], "轮 4 根本不会被要到 ⇒ 盘上不该有任何改动").toEqual([]);
    expect(r["verifyOkLast"]).toBe(false);
  }, 120_000);

  it("★ON（--auto-verify-repair）：红拍之后再要一轮 ⇒ 拿到修复轮 ⇒ 写盘 ⇒ 第二拍绿（闸拍=2）", () => {
    const run = runLoopEval(["--auto-verify-repair", "--arm=repair"], OUT_ON);
    expect(run.status, run.out.slice(-600)).toBe(0);
    expect(run.readings, run.out.slice(-600)).toHaveLength(1);
    const r = firstReading(run, "ON 臂");
    expect(run.readings![0]!.g.ok).toBe(true);
    expect(r["arm"], "ON 臂必须自报是对照臂，不许混进产品缺省态的分母").toBe("repair");
    expect(r["autoVerifyBeats"], "一拍红 + 返修后第二拍").toBe(2);
    expect(r["changedFiles"], "返修那一轮真的写了盘（不是靠提示词自觉）").toContain("src/checkout.js");
    expect(r["verifyOkLast"]).toBe(true);
  }, 120_000);
});

afterAll(async () => {
  for (const d of spawnedDirs) await rm(join(ROOT, d), { recursive: true, force: true }).catch(() => {});
});
