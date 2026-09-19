// 非 npm 仓库的验证面探测（能力 2 × 能力 5）+ 工具链缺失（127）的诚实标注。
// 都是临时目录 + 纯文件读，不起真测试框架。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VERIFY_TIMEOUT_MS,
  PROBED_LANG_TIMEOUT_MS,
  defaultExec,
  loadVerifyConfig,
  probeLanguageTestCommands,
  runVerifyOutcome,
} from "../src/agent/verify";
import type { VerifyCommandResult } from "../src/events";

let dir = "";
async function repo(files: Record<string, string>): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "verify-probe-"));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text, "utf8");
  return dir;
}
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe("probeLanguageTestCommands / loadVerifyConfig 第③档", () => {
  it("go.mod → go test ./...", async () => {
    await repo({ "go.mod": "module m\n" });
    expect(await probeLanguageTestCommands(dir)).toEqual(["go test ./..."]);
  });

  it("Cargo.toml → cargo test", async () => {
    await repo({ "Cargo.toml": "[package]\nname=\"x\"\n" });
    expect(await loadVerifyConfig(dir)).toEqual({ config: { test: ["cargo test"], timeoutMs: PROBED_LANG_TIMEOUT_MS }, source: "probed" });
  });

  it("pytest 的四种声明面都能探到（pytest.ini / conftest.py / pyproject 段 / setup.cfg 段）", async () => {
    const marks: Array<[string, string]> = [
      ["pytest.ini", "[pytest]\n"],
      ["conftest.py", "# fixture\n"],
      ["pyproject.toml", "[tool.pytest.ini_options]\naddopts=\"-q\"\n"],
      ["setup.cfg", "[pytest]\ntestpaths = tests\n"],
    ];
    for (const [name, text] of marks) {
      dir = "";
      await repo({ [name]: text });
      expect(await probeLanguageTestCommands(dir)).toEqual(["python3 -m pytest -q"]);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Makefile 只认 test: 目标；只有 build: 就不猜", async () => {
    await repo({ Makefile: "all:\n\t@true\n" });
    expect(await probeLanguageTestCommands(dir)).toEqual([]);
    await rm(dir, { recursive: true, force: true });
    await repo({ Makefile: "build:\n\t@true\n\ntest: deps\n\tpytest -q\n" });
    expect(await probeLanguageTestCommands(dir)).toEqual(["make test"]);
  });

  it("注释里写着「test:」不算目标（判定锚在行首，否则一句说明就凭空造出验证面）", async () => {
    await repo({ Makefile: "# run test: pytest -q manually\nall:\n\t@true\n" });
    expect(await probeLanguageTestCommands(dir)).toEqual([]);
  });

  it("探测只产出写死的命令串，不读仓库给的脚本文本（信任面不变）", async () => {
    await repo({ Makefile: "test:\n\trm -rf $HOME\n" });
    expect(await loadVerifyConfig(dir)).toEqual({ config: { test: ["make test"], timeoutMs: PROBED_LANG_TIMEOUT_MS }, source: "probed" });
  });

  it("package.json 有 test 脚本时优先，语言探测不参与（零回归）", async () => {
    await repo({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }), "go.mod": "module m\n" });
    expect(await loadVerifyConfig(dir)).toEqual({ config: { test: ["pnpm run test"] }, source: "probed" });
  });

  it("package.json 存在但没有 lint/test 脚本 ⇒ 继续探语言（旧实现到此返回 none）", async () => {
    await repo({ "package.json": JSON.stringify({ name: "x", scripts: { build: "tsc" } }), "go.mod": "module m\n" });
    expect(await loadVerifyConfig(dir)).toEqual({ config: { test: ["go test ./..."], timeoutMs: PROBED_LANG_TIMEOUT_MS }, source: "probed" });
  });

  it("只补 test 不凭空造 lint（action-fusion 读 config.lint，造出来会把干净改动报成失败）", async () => {
    await repo({ "pyproject.toml": "[tool.pytest.ini_options]\n" });
    const { config } = await loadVerifyConfig(dir);
    expect(config.lint).toBeUndefined();
    expect(config.test).toEqual(["python3 -m pytest -q"]);
  });

  it("package.json 坏 JSON → fail loud（与 config.json 同口径，不静默降级成「无验证面」）", async () => {
    await repo({ "package.json": "{not json" });
    await expect(loadVerifyConfig(dir)).rejects.toThrow();
  });

  it("什么面都没有 → source none，且消息说清查过哪些工具链", async () => {
    await repo({ "README.md": "hi\n" });
    const outcome = await runVerifyOutcome(dir, async () => ({ command: "x", ok: true, output: "" }));
    expect(outcome.ok).toBe(false);
    expect(outcome.results[0]?.output).toContain("未找到 verify 配置");
    expect(outcome.results[0]?.output).toContain("go/cargo/pytest/make");
  });
});

describe("工具链缺失（退出码 127）不冒充代码失败", () => {
  it("命令不存在：红，但明写「不是代码失败」并给出下一步", async () => {
    const r = await defaultExec("dsh-no-such-toolchain-xyz --version", process.cwd());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("[exit code: 127]");
    expect(r.output).toContain("工具链缺失");
    expect(r.output).toContain("别照它改代码");
  });

  it("非 127 的失败不加这条（真失败的口径不变）", async () => {
    const r = await defaultExec("echo boom >&2; exit 3", process.cwd());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("[exit code: 3]");
    expect(r.output).not.toContain("工具链缺失");
  });
});

describe("verify 超时是配置项，不是 60s 硬编码", () => {
  it("语言探测档自带 300s：冷编译 cargo/go 不该被 60s 掐死", async () => {
    await repo({ "Cargo.toml": "[package]\n" });
    const seen: number[] = [];
    const stub = async (c: string, d: string, t?: number): Promise<VerifyCommandResult> => {
      seen.push(t ?? -1);
      return { command: c, ok: true, output: "" };
    };
    const outcome = await runVerifyOutcome(dir, stub);
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual([PROBED_LANG_TIMEOUT_MS]);
  });

  it("npm 侧不带 timeoutMs ⇒ 仍按 60s（e2e / gym 的既有口径零回归）", async () => {
    await repo({ "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) });
    const seen: number[] = [];
    await runVerifyOutcome(dir, async (c, d, t) => {
      seen.push(t ?? -1);
      return { command: c, ok: true, output: "" };
    });
    expect(seen).toEqual([DEFAULT_VERIFY_TIMEOUT_MS]);
  });

  it(".agent/config.json 的 verify.timeoutMs 透传到执行器", async () => {
    await repo({});
    await mkdir(join(dir, ".agent"), { recursive: true });
    await writeFile(join(dir, ".agent", "config.json"), JSON.stringify({ verify: { test: ["true"], timeoutMs: 15_000 } }), "utf8");
    const seen: number[] = [];
    await runVerifyOutcome(dir, async (c, d, t) => {
      seen.push(t ?? -1);
      return { command: c, ok: true, output: "" };
    });
    expect(seen).toEqual([15_000]);
  });

  it("timeoutMs 越界或类型错 → fail loud（静默忽略会让人以为配上了）", async () => {
    for (const bad of ["fast", 0, 500, 9_999_999]) {
      await repo({});
      await mkdir(join(dir, ".agent"), { recursive: true });
      await writeFile(join(dir, ".agent", "config.json"), JSON.stringify({ verify: { test: ["true"], timeoutMs: bad } }), "utf8");
      await expect(loadVerifyConfig(dir)).rejects.toThrow(/timeoutMs/u);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("defaultExec 真按传入上限掐表，消息里的秒数跟着配置走", async () => {
    const t0 = Date.now();
    const r = await defaultExec("sleep 5", process.cwd(), 2_000);
    const elapsed = Date.now() - t0;
    expect(r.ok).toBe(false);
    expect(r.output).toContain("verify 命令超时（2s）");
    expect(elapsed).toBeLessThan(4_500); // 到点就杀，不等子进程自己跑完
  });
});
