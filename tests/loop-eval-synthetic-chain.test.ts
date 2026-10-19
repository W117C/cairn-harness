/** 离线合成面的端到端证人（第 422 页）：`scripts/loop-eval.ts --scripted=<剧本>` 真的把
 *  SWE-bench 那两半尺子从**规格**跑成**读数**——零 API key、零网络。
 *
 *  为什么这一格值得真 spawn 而不是源码断言：要证的正是「装配没变、判卷口径没变、只有模型那一侧
 *  换成剧本，链子就通了」。源码里写着一行 `createRoundScriptedProvider` 不等于跑得出逐名读数
 *  （本仓点名的第 4 形态：用例在、那一格没人判）。
 *
 *  两副剧本各钉一面：
 *   · `script.jsonl`＝门槛改对 ⇒ 该转绿的转绿、该保住的都保住 ⇒ `state=pass`；
 *   · `script-broken-p2p.jsonl`＝门槛改对**同时**把基础运费从 600 改成 500 ⇒
 *     `notGreen` 仍为空而 `broken` 点名那条 ⇒ 这正是「同一枚退出码说不出来的那句话」。
 *  第二副里那条「原价未过线收运费」故意**不**坏：它断言的是 import 进来的常量本身，
 *  改常量不会动它——读数只报真坏了的那条，不替剧本编故事。 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseTestResults } from "../src/agent/eval/test-results";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const GREEN_SCRIPT = "fixtures/bench/scripts/synthetic-judge/script.jsonl";
const BROKEN_SCRIPT = "fixtures/bench/scripts/synthetic-judge/script-broken-p2p.jsonl";
const TASKS = "fixtures/bench/tasks-synthetic.json";
// 多个全量套件可并行运行；共享固定目录会让一个进程的 afterAll 删除另一个进程正在写的读数。
const RUN_ID = randomUUID();
const GREEN_OUT = `.tmp/dsh-synth-chain-${RUN_ID}-green`;
const BROKEN_OUT = `.tmp/dsh-synth-chain-${RUN_ID}-broken`;

interface Run { status: number | null; out: string; readings: unknown }

/* `--out` 用**仓内相对路径**（`.tmp/` 在 .gitignore 里）。这一版跑器把 `--out` 一律 `join(ROOT, out)`，
 * 传绝对路径会被静默搬进仓（`join(root, "/tmp/x")` = `<root>/tmp/x`），而打印出来的还是那个绝对串——
 * 「印的路径 ≠ 写的路径」是另一格缺陷，本轮绕开并在页上登记，不混进这一簇。 */
const spawnedDirs = [GREEN_OUT, BROKEN_OUT];

function runLoopEval(script: string, outRel: string): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const k of ["CAIRN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) delete env[k];
  const r = spawnSync(process.execPath,
    ["--import", "tsx", "scripts/loop-eval.ts", "--tasks", TASKS, "--scripted=" + script, "--out", outRel],
    { cwd: ROOT, encoding: "utf8", env, timeout: 180_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const file = join(ROOT, outRel, "readings.json");
  return { status: r.status, out, readings: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined };
}

/** 读数的脸是 `[{ r, g }]`（跑器 `rows.push({r, g})` 那个形状）；这里**不自己重算**任何一格。 */
function firstReading(run: Run, label: string): Record<string, never> {
  const rows = run.readings as { r: Record<string, never> }[] | undefined;
  expect(rows, `${label}：readings.json 没落盘或不是数组面（跑器换了形状，这里先红）\n--- 末尾原文 ---\n${run.out.slice(-600)}`).toBeInstanceOf(Array);
  return rows![0]!.r;
}
const namedOf = (r: Record<string, never>) =>
  r["namedSets"] as { state: string; notGreen: string[]; broken: string[]; sources: { format: string; tests: number; carried: boolean; complete: boolean }[] };

describe("离线合成面：SWE-bench 那两半尺子第一次跑出读数", () => {
  let green: Run;
  let broken: Run;

  beforeAll(() => {
    green = runLoopEval(GREEN_SCRIPT, GREEN_OUT);
    broken = runLoopEval(BROKEN_SCRIPT, BROKEN_OUT);
  }, 400_000);

  afterAll(async () => {
    for (const d of spawnedDirs) await rm(join(ROOT, d), { recursive: true, force: true });
  });

  it("剧本那一趟：逐名报全绿、提供者报剧本，取料面带格式与条数", () => {
    expect(green.status, green.out.slice(-600)).toBe(0);
    expect(green.out).toContain("合成面：provider=剧本");
    const r = firstReading(green, "全绿那趟");
    expect(r["providerFace"]).toBe("剧本");
    const ns = namedOf(r);
    // 失败时带上取料面本身（2026-10-12 CI 自评：本地全绿、CI 两连红，而断言只说
    // "expected 'unreadable' to be 'pass'" ⇒ 看不出是没跑测试、输出只剩噪音、还是解析换了格式。
    // 那三种的修法完全不同，所以红的时候必须把 sources 与逐名原文一起交出来。
    expect(ns.state, "逐名这一格的取料面：" + JSON.stringify(ns.sources)).toBe("pass");
    expect(ns.notGreen).toEqual([]);
    expect(ns.broken).toEqual([]);
    expect(ns.sources).toHaveLength(1);
    // format 认**两种**：`node --test` 按 stdout 是不是 TTY 选 reporter——管道 ⇒ tap，TTY ⇒ spec。
    // GitHub Actions 给每个 step 分一个 PTY ⇒ CI 上永远是 spec，本地永远是 TAP。
    // 判据要的是「逐名读到了 3 条、都带进来了、派生完整」，那一格与用哪种 reporter 无关；
    // 把格式钉成一种，等于让这条判据在另一种终端下必红（2026-10-12 CI 上正是这么连红六趟的）。
    expect(ns.sources[0]).toMatchObject({
      format: expect.stringMatching(/^node-test-(tap|spec)$/u),
      tests: 3, carried: true, complete: true,
    });
  });

  it("同一副装配换一条剧本：目标转绿而「该保住的」坏了一条 ⇒ broken 点名它、notGreen 仍为空", () => {
    expect(broken.status, broken.out.slice(-600)).toBe(0);
    const ns = namedOf(firstReading(broken, "改坏那一趟"));
    expect(ns.state, "逐名这一格的取料面：" + JSON.stringify(ns.sources)).toBe("fail");
    expect(ns.notGreen, "「该转绿的没绿」这一格没坏就不许报它").toEqual([]);
    expect(ns.broken).toEqual(["券后价不为负且总价含运费"]);
    // 分辨力证人：这一趟退出码也是红的，但它说不出「是哪条、哪一种坏」——那两句话只在逐名这一格里。
    expect(firstReading(broken, "改坏那一趟")["verifyOkLast"]).toBe(false);
    expect(broken.out).toContain("逐名=逐名有红");
  });

  it("剧本那一趟不许被「未起步」剔出分母：请求=0 是构造如此，不是跑不成", () => {
    expect(green.out, green.out.slice(-600)).not.toContain("拒绝出数");
    expect(green.out).not.toContain("一趟都不算数");
    const r = firstReading(green, "分母那一判");
    expect(r["requests"]).toBe(0);
    expect(r["providerFace"]).toBe("剧本");
  });

  it("等号写法也要认，剧本缺文件时出声退 1——静默改用真会话等于在花用户的钱", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", CAIRN_API_KEY: "", OPENAI_API_KEY: "" };
    const r = spawnSync(process.execPath,
      ["--import", "tsx", "scripts/loop-eval.ts", "--tasks", TASKS, "--scripted=fixtures/bench/scripts/synthetic-judge/没有这份剧本.jsonl"],
      { cwd: ROOT, encoding: "utf8", env, timeout: 90_000 });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(r.status).toBe(1);
    expect(out).toContain("不存在");
    expect(out, "不许把这条读成「暗卷缺席，跳过」——那条路会静默地不出数也不报错").not.toContain("暗卷缺席");
  });

  it("两种旗标写法走到同一个值：等号写法必须真的拿到剧本，且空值闸同样开口", () => {
    // 这条判据的存在理由是一次**活下来的变异**：`scripted-flag-equals-form-dropped`
    // 原先 apply 打在死代码上（自己 find 一遍 --scripted=，与 pick 的结果恒等）⇒ 磨掉它行为一字不变。
    // 判据有牙的前提是它判的那件事**真的可被改坏**：所以这里不问「两种写法输出是否相同」
    // （值一起失效时两种写法照样同时失败、输出逐字相同，那条断言是恒真的），
    // 而问「等号写法有没有**真的拿到**那个值」——拿到与否，缺文件那句里回显的路径就是证人。
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", CAIRN_API_KEY: "", OPENAI_API_KEY: "" };
    const missing = "fixtures/bench/scripts/synthetic-judge/没有这份剧本.jsonl";
    const eqMissing = spawnSync(process.execPath,
      ["--import", "tsx", "scripts/loop-eval.ts", "--tasks", TASKS, "--scripted=" + missing],
      { cwd: ROOT, encoding: "utf8", env, timeout: 90_000 });
    const eqOut = (eqMissing.stdout ?? "") + (eqMissing.stderr ?? "");
    expect(eqMissing.status).toBe(1);
    expect(eqOut, "值没拿到就会掉进空值闸，而不是走到缺文件闸").not.toContain("后面是空的");
    expect(eqOut, "缺文件那句回显的必须是等号写法给进来的那个路径").toContain(missing);

    // 反向格：等号后面空着 ⇒ 必须掉进空值闸（这一格证明上一格不是「反正都退 1」）
    const eqEmpty = spawnSync(process.execPath,
      ["--import", "tsx", "scripts/loop-eval.ts", "--tasks", TASKS, "--scripted="],
      { cwd: ROOT, encoding: "utf8", env, timeout: 90_000 });
    const eqEmptyOut = (eqEmpty.stdout ?? "") + (eqEmpty.stderr ?? "");
    expect(eqEmpty.status).toBe(1);
    expect(eqEmptyOut).toContain("后面是空的");
  });

  it("接线：跑器按 SCRIPTED 分岔把剧本递给 runLoop（整条调用连入参，不钉函数名）", () => {
    const src = readFileSync(join(ROOT, "scripts/loop-eval.ts"), "utf8");
    expect(src).toMatch(
      /provider:\s*SCRIPTED === ""\s*\?\s*createSessionProvider\([\s\S]{0,900}?\)\s*(?:\/\/[^\n]*\n\s*)?:\s*createRoundScriptedProvider\(resolve\(ROOT, SCRIPTED\)\)/u,
    );
    const validitySrc = readFileSync(join(ROOT, "scripts/lib/eval-validity.ts"), "utf8");
    expect(validitySrc).toMatch(/if\s*\(run\.requests <= 0 && run\.providerFace !== "剧本"\)/u);
  });

  it("靶子自己的口径：起点态恰有一条红、两枚绿，且逐名解析器认这份 TAP", () => {
    const seed = readFileSync(join(ROOT, "fixtures/bench/bench-synthetic-judge/src/shipping.js"), "utf8");
    expect(seed, "起点态必须是严格大于那一枚 bug，否则这条链的 F2P 没有红可转").toContain("after > FREE_SHIPPING_THRESHOLD_CENTS");
    const r = spawnSync(process.execPath, ["--test", "fixtures/bench/bench-synthetic-judge/tests/shipping.test.js"],
      { cwd: ROOT, encoding: "utf8", timeout: 90_000 });
    expect(r.status, "起点态这条命令必须是红的（红→绿才是这一格要量的事）").not.toBe(0);
    const parsed = parseTestResults((r.stdout ?? "") + "\n" + (r.stderr ?? ""));
    // 这一支是 spawnSync（管道）⇒ 本地拿到 TAP；同一条判据在 CI 的 PTY 下会拿到 spec。
    // 判的是「三条名字与红绿读对了」，与 reporter 无关（理由同上面那条 format 断言）。
    expect(parsed.format).toMatch(/^node-test-(tap|spec)$/u);
    expect(parsed.tests.map((t) => [t.name, t.outcome])).toEqual([
      ["券后过线免运费", "failed"],
      ["原价未过线收运费", "passed"],
      ["券后价不为负且总价含运费", "passed"],
    ]);
  });
});
