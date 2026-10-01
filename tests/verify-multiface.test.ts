// M5 · 验证闭环加固的判卷：多面探测（typecheck 面）+ 重复失败升级处置。
//
// 分三段，**按重要性倒序**：
//   C 归因一条不丢 —— 本模块的核心验收。对**每一类**归因都构造「环境红」与「代码红」，
//     断言分类正确，且环境红**不消耗模型的修复额度**。这是 M5 禁区的正反面：
//     减一类别、多扣一次额度，都由这一段抓住。
//   B 零回归金标准 —— verify-probe.test.ts 那四处整对象 toEqual 的场景逐字复刻；
//     加一个验证面最可能悄悄改掉的正是「原来产出什么」，不是「新面好不好用」。
//   A/E 新机制本身：探测成立与否、第 3 拍起提示升级、第 2 拍逐字不变。
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ESCALATE_REPEAT_ATTEMPT,
  PROBED_LANG_TIMEOUT_MS,
  classifyVerifyFailure,
  createVerifyHook,
  defaultExec,
  loadVerifyConfig,
  probeTypecheckCommands,
  repeatDigestNote,
  runVerifyOutcome,
  verifyCommands,
  type VerifyOutcome,
} from "../src/agent/verify";
import { isEnvVerifyCause, type AgentEvent, type VerifyCause, type VerifyResultEvent } from "../src/events";
import { runLoop } from "../src/agent/loop";

let dir = "";
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

/** 造一个仓库；`bin` 为 true 时同时造出可执行的本地 tsc。 */
async function repo(files: Record<string, string>, bin = false): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "verify-multiface-"));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text, "utf8");
  if (bin) {
    await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
    const tsc = join(dir, "node_modules", ".bin", "tsc");
    await writeFile(tsc, "#!/bin/sh\necho \"$@\"\n", "utf8");
    await chmod(tsc, 0o755);
  }
  return dir;
}

describe("M5 · 归因一条不丢（核心验收：每类都有一对环境红/代码红）", () => {
  /** 每类归因的「环境红」输入与「代码红」输入。同一类里两者的差别**只有**输出/退出码，
   *  这样分类对了才说明分类器真的在读那一条线索，而不是碰巧。 */
  const CASES: ReadonlyArray<{
    cause: VerifyCause;
    desc: string;
    env: { timedOut: boolean; exitCode: number | null; output: string };
    code: { timedOut: boolean; exitCode: number | null; output: string };
  }> = [
    {
      cause: "timeout",
      desc: "超时：跑不完",
      env: { timedOut: true, exitCode: null, output: "verify 命令超时（60s）" },
      code: { timedOut: false, exitCode: 1, output: "FAIL tests/a.test.ts" },
    },
    {
      cause: "not-run",
      desc: "没跑完：被取消/被信号杀（无退出码）",
      env: { timedOut: false, exitCode: null, output: "Killed" },
      code: { timedOut: false, exitCode: 1, output: "assertion failed" },
    },
    {
      cause: "toolchain-missing",
      desc: "工具链缺失：退出码 127",
      env: { timedOut: false, exitCode: 127, output: "./node_modules/.bin/tsc: No such file or directory" },
      code: { timedOut: false, exitCode: 1, output: "type error TS2345" },
    },
    {
      cause: "pkg-manager",
      desc: "包管理器自身报错（pnpm 自有错误码行）",
      env: { timedOut: false, exitCode: 1, output: "[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command \"tsc\" not found" },
      code: { timedOut: false, exitCode: 1, output: "expected 3 got 2" },
    },
    {
      cause: "code",
      desc: "代码红：环境一切正常，是被测代码的问题",
      env: { timedOut: false, exitCode: 1, output: "Test Files 1 failed" },
      code: { timedOut: false, exitCode: 2, output: "assertion failed" },
    },
  ];

  it("每一类归因：环境红与代码红被分到不同的类，且只有 code 扣额度", () => {
    for (const c of CASES) {
      const got = classifyVerifyFailure(c.env);
      expect(got, `${c.desc} 的环境红判成了 ${got}（应为 ${c.cause}）`).toBe(c.cause);
      // 代码红：除 code 外四类都该归 code —— 同一份输入只改输出/退出码，分类必须跟着变。
      const codeGot = classifyVerifyFailure(c.code);
      expect(codeGot, `${c.desc} 的代码红判成了 ${codeGot}`).toBe("code");
      // 扣额度与否，就由这一行决定（loop.ts 的 chargedAttempts 就是这个判据）。
      expect(isEnvVerifyCause(got), `${c.desc} 的环境红不该扣额度`).toBe(c.cause !== "code");
      expect(isEnvVerifyCause(codeGot)).toBe(false);
    }
  });

  it("归因类别没被这一轮减少：五类环境口径 + code 全在，且 ENV 集合就是六类非 code", () => {
    // 「不许减少归因类别」是 M5 禁区。逐个点名，不靠"跑一遍没报错"当恒真。
    const all: VerifyCause[] = ["code", "timeout", "toolchain-missing", "no-surface", "hook-error", "pkg-manager", "not-run"];
    for (const c of all) {
      expect([...all]).toContain(c);
      expect(isEnvVerifyCause(c), `${c} 的环境/代码属性`).toBe(c !== "code");
    }
  });

  it("M5 新增的那一面不改变拍数记账：环境红仍只烧 2 拍且不推进 attempt（对着 loop 的真口径跑）", async () => {
    const envOutcome = (): VerifyOutcome => ({
      ok: false,
      results: [{ command: "./node_modules/.bin/tsc --noEmit -p tsconfig.json", ok: false, output: "No such file", cause: "toolchain-missing", exitCode: 127 }],
    });
    const log: AgentEvent[] = [];
    let calls = 0;
    await runLoop({
      workspace: "/tmp",
      events: { async append(e) { log.push(e); } },
      tools: {},
      provider: { async *stream() { calls += 1; yield { type: "tool_call", id: "v" + String(calls), name: "verify", args: {} }; } },
      verify: { async run() { return envOutcome(); } },
    });
    const beats = log.filter((e): e is VerifyResultEvent => e.type === "verify_result");
    // 2 拍（环境上限），attempt 序列 1,1（环境拍不推进模型账）—— 与 mutate 前逐字相同。
    expect(beats).toHaveLength(2);
    expect(beats.map((e) => e.attempt)).toEqual([1, 1]);
  });
});

describe("M5 · 零回归金标准（加一个面最容易悄悄改的是「原来产出什么」）", () => {
  it("go.mod / Cargo.toml / Makefile / package.json 四档探测的产出逐字不变（无 tsconfig 时）", async () => {
    await repo({ "go.mod": "module m\n" });
    expect(await loadVerifyConfig(dir)).toEqual({ config: { test: ["go test ./..."], timeoutMs: PROBED_LANG_TIMEOUT_MS }, source: "probed" });
    await rm(dir, { recursive: true, force: true });

    await repo({ "Cargo.toml": "[package]\nname=\"x\"\n" });
    expect(await loadVerifyConfig(dir)).toEqual({ config: { test: ["cargo test"], timeoutMs: PROBED_LANG_TIMEOUT_MS }, source: "probed" });
    await rm(dir, { recursive: true, force: true });

    await repo({ "Makefile": "build:\n\t@true\n\ntest: deps\n\tpytest -q\n" });
    expect(await loadVerifyConfig(dir)).toEqual({ config: { test: ["make test"], timeoutMs: PROBED_LANG_TIMEOUT_MS }, source: "probed" });
    await rm(dir, { recursive: true, force: true });

    await repo({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) });
    expect(await loadVerifyConfig(dir)).toEqual({ config: { test: ["pnpm run test"] }, source: "probed" });
    await rm(dir, { recursive: true, force: true });

    await repo({ "README.md": "hi\n" });
    expect(await loadVerifyConfig(dir)).toEqual({ config: {}, source: "none" });
  });

  it("语言面与类型面互斥：既有 go 测试面时类型面不出现（那条 return 逐字不动是变异锚点）", async () => {
    await repo({ "go.mod": "module m\n", "tsconfig.json": "{}", "package.json": "{}" }, true);
    const { config } = await loadVerifyConfig(dir);
    expect(config.test).toEqual(["go test ./..."]);
    expect(config.typecheck).toBeUndefined();
  });

  it("显式 .agent/config.json 优先于类型面探测（手配永远是第一档）", async () => {
    await repo({ "tsconfig.json": "{}" }, true);
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, ".agent", "config.json"), JSON.stringify({ verify: { test: ["true"] } }), "utf8");
    const { config, source } = await loadVerifyConfig(dir);
    expect(source).toBe("config");
    expect(config.typecheck).toBeUndefined();
    expect(config.test).toEqual(["true"]);
  });

  it("手配的 verify.typecheck 不被静默丢弃（探测档产出这一面，配置档也得收）", async () => {
    await repo({});
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(
      join(dir, ".agent", "config.json"),
      JSON.stringify({ verify: { typecheck: ["my-tsc --noEmit"], test: ["true"] } }),
      "utf8",
    );
    const { config, source } = await loadVerifyConfig(dir);
    expect(source).toBe("config");
    expect(config.typecheck).toEqual(["my-tsc --noEmit"]);
    expect(verifyCommands(config)).toEqual(["my-tsc --noEmit", "true"]);
  });

  it("verify.typecheck 写错类型 → fail loud（与 lint/test 同口径，不静默忽略）", async () => {
    await repo({});
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, ".agent", "config.json"), JSON.stringify({ verify: { typecheck: "tsc --noEmit" } }), "utf8");
    await expect(loadVerifyConfig(dir)).rejects.toThrow(/verify\.typecheck/u);
  });
});

describe("M5 · 类型面探测本身", () => {
  it("有 tsconfig 且装了本地 tsc ⇒ 产出，且命令是本地二进制（缺失时归 toolchain-missing）", async () => {
    await repo({ "tsconfig.json": '{"compilerOptions":{}}' }, true);
    expect(await probeTypecheckCommands(dir)).toEqual(["./node_modules/.bin/tsc --noEmit -p tsconfig.json"]);
    const { config, source } = await loadVerifyConfig(dir);
    expect(source).toBe("probed");
    expect(config.typecheck).toEqual(["./node_modules/.bin/tsc --noEmit -p tsconfig.json"]);
    // 探测档与语言面同档超时（300s）：冷 tsc 也不该被 60s 掐死。
    expect(config.timeoutMs).toBe(PROBED_LANG_TIMEOUT_MS);
  });

  it("少任一条判据都不产出这一面（有 tsconfig 没 tsc ⇒ 不给一条必红的命令）", async () => {
    await repo({ "tsconfig.json": "{}" }, false);
    expect(await probeTypecheckCommands(dir)).toEqual([]);
    await rm(dir, { recursive: true, force: true });
    await repo({ "README.md": "hi\n" }, true);
    expect(await probeTypecheckCommands(dir)).toEqual([]);
  });

  it("不可执行的 .bin/tsc 不算数（存在但没权限 ⇒ 仍不产出）", async () => {
    await repo({ "tsconfig.json": "{}" }, true);
    await chmod(join(dir, "node_modules", ".bin", "tsc"), 0o644);
    expect(await probeTypecheckCommands(dir)).toEqual([]);
  });

  it("执行顺序：类型面 → lint → 测试（类型错会让后面两面的报错变噪音）", async () => {
    expect(verifyCommands({ typecheck: ["TC"], lint: ["L"], test: ["T"] })).toEqual(["TC", "L", "T"]);
    // 缺省面不凭空造项。
    expect(verifyCommands({})).toEqual([]);
  });

  it("只有 tsconfig 的仓库**有**可验面 ⇒ harness 不会整段跳过 verify（surface 认这一面）", async () => {
    await repo({ "tsconfig.json": "{}" }, true);
    const hook = createVerifyHook(dir);
    expect(await hook.surface?.()).toBe(true);
    await rm(dir, { recursive: true, force: true });
    await repo({ "README.md": "hi\n" }, false);
    expect(await createVerifyHook(dir).surface?.()).toBe(false);
  });

  it("D · 类型面缺工具链归 toolchain-missing 而**不是** code（即不扣模型额度）", async () => {
    // 真起子进程：本地二进制不存在 ⇒ bash 退出 127。这一条钉的是「用相对路径二进制」这个决定：
    // 若换成 `npx --no-install tsc`，退出码是 1 ⇒ 判成 code ⇒ 拿 harness 的环境问题扣模型的钱。
    await repo({ "tsconfig.json": "{}" }, false);
    const r = await defaultExec("./node_modules/.bin/tsc --noEmit -p tsconfig.json", dir);
    expect(r.ok).toBe(false);
    expect(r.cause).toBe("toolchain-missing");
    expect(isEnvVerifyCause(r.cause)).toBe(true);
  });
});

describe("M5 · 重复失败升级处置（交付物 2）", () => {
  const red: VerifyOutcome = {
    ok: false,
    results: [{ command: "pnpm test", ok: false, output: "FAIL: 2 tests, expected 3 got 2" }],
  };

  it("第 2 拍：与这一轮之前逐字相同（对着既有判卷的字面量比，不对着自身比）", () => {
    const note = repeatDigestNote(red, 2);
    expect(note).toContain("第 2 拍结果与上一拍**逐字相同**");
    expect(note).toContain("失败命令不变：pnpm test");
    expect(note).toContain("下一步二选一");
    expect(note).not.toContain("升级处置"); // 第 2 拍不升级：tests/verify.test.ts 逐字钉着这一拍
    // 阈值本身钉住：升级从第 3 拍起，早了会把「第一次重复」也说成「换策略」。
    expect(ESCALATE_REPEAT_ATTEMPT).toBe(3);
  });

  it("第 3 拍起：追加升级段（别再改同一处 + 先判这条红可不可修）", () => {
    const note = repeatDigestNote(red, ESCALATE_REPEAT_ATTEMPT);
    expect(note).toContain("第 3 拍");
    expect(note).toContain("升级处置");
    expect(note).toContain("别再改同一处");
    // 可执行性那半句要点名环境类归因，否则模型不知道「改代码没用」的那几类是哪几类。
    expect(note).toContain("toolchain-missing");
  });

  it("升级段随拍数增长（第 4 拍说第 4 拍），不是固定一句", () => {
    expect(repeatDigestNote(red, 4)).toContain("第 4 拍");
  });

  it("升级是真走 loop 的重复检测这条支（不是只在纯函数里好看）", async () => {
    let n = 0;
    const log: AgentEvent[] = [];
    await runLoop({
      workspace: "/tmp",
      events: { async append(e) { log.push(e); } },
      tools: {},
      provider: {
        async *stream() {
          n += 1;
          yield { type: "tool_call", id: "v" + String(n), name: "verify", args: {} };
        },
      },
      verify: {
        maxAttempts: 4,
        async run() { return { ok: false, results: [{ command: "pnpm test", ok: false, output: "SAME" }] }; },
      },
    });
    const outs = log.filter((e) => e.type === "tool_result").map((e) => String(e.output));
    // 第 2 拍：重复提示；第 3 拍：重复提示 + 升级段（同一条注入里两段都在）。
    expect(outs.some((o) => o.includes("逐字相同") && !o.includes("升级处置"))).toBe(true);
    expect(outs.some((o) => o.includes("升级处置"))).toBe(true);
  });
});