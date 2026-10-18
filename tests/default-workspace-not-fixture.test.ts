// 判卷 · 缺省工作区不许是判卷 fixture（2026-10-19 重构的钉子）。
//
// **为什么需要这份判卷**：`DEFAULT_WORKSPACE` 原先恒为 `fixtures/todo-app`——「生产 runner 的
// 缺省工作区是一个 git 判卷 fixture」。这不是观感问题，是**真污染**：
//   · 任何没显式给 workspace 的 run（IPC 会话模式、调度器触发、`runAgent` 省略）收束时都会
//     往那个 fixture 里写 `.agent/evolution.json`（`runEvolution` → `persistEvolution`）、
//     覆盖 `src/todo.ts`、往 `.agent/snapshots/` 落快照；
//   · 实测抓到过一次：`tests/replay-faces.test.ts` 的「靶子整树逐字节不变」在**全量跑**里变红，
//     点名 `改动 .agent/evolution.json`——写入方是 `tests/runner-gates.test.ts` 的 m1b run。
//     三支共用靶子的判卷之间那把锁（`tests/app-fixture-lock.ts`）管不了这件事：锁只保证
//     「同一时刻只有一方在动靶子」，而这里要的是「生产路径根本不该动靶子」。
//
// 本判卷钉三件事（前两条是行为，第三条是**反向验证**——见下）：
//   ① `DEFAULT_WORKSPACE` 的值不在 `fixtures/` 下（缺省值本身换掉，不是给 fixture 加白名单）；
//   ② 回落链 `resolveRunWorkspace` 走到最后一档时，答案与 `process.cwd()` 同源
//      （CLI `src/cli.ts:336`、`session-provider.ts:853` 早就是这个口径，三处收成一个源）；
//   ③ **反向验证**：把「缺省 = fixture」这个旧行为原样造出来，断言它**确实会被本判卷抓到**。
//      没有这一条，① 只是一句"现在恰好如此"的断言——将来谁把它改回 fixture，① 会红，
//      但没人知道这条判据**真的量到了那件事**（本仓纪律：判据要同笔造专破它的坏输入）。
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE } from "../src/main/demo-scripted";
import { resolveRunWorkspace } from "../src/main/agent-runner";

const REPO_ROOT = resolve(import.meta.dirname, "..");

/** 判卷 fixture 的根：任何以它开头的缺省工作区都是"生产路径在动判卷文件"。 */
const FIXTURE_ROOT = join(REPO_ROOT, "fixtures");

describe("缺省工作区不是判卷 fixture（2026-10-19）", () => {
  it("DEFAULT_WORKSPACE 不在 fixtures/ 下", () => {
    expect(DEFAULT_WORKSPACE.startsWith(FIXTURE_ROOT + sep),
      "缺省工作区落在判卷 fixture 树下：" + DEFAULT_WORKSPACE).toBe(false);
  });

  it("DEFAULT_WORKSPACE 与 process.cwd() 同源（CLI / session-provider 的同一口径）", () => {
    expect(DEFAULT_WORKSPACE).toBe(process.cwd());
  });

  it("回落链走满五档时答案就是 DEFAULT_WORKSPACE（不是别的兜底）", () => {
    const fell = resolveRunWorkspace(undefined, undefined, undefined, null, DEFAULT_WORKSPACE);
    expect(fell).toBe(DEFAULT_WORKSPACE);
    expect(fell.startsWith(FIXTURE_ROOT + sep)).toBe(false);
  });

  it("空串/纯空白的 req 与 env 不冒充『已给』（仍走回落，不落到 fixture）", () => {
    const fell = resolveRunWorkspace(undefined, "   ", "  ", null, DEFAULT_WORKSPACE);
    expect(fell).toBe(DEFAULT_WORKSPACE);
  });
});

describe("反向验证：旧行为（缺省 = fixture）会被上面那几条判到", () => {
  it("把缺省值换成 fixture 路径 ⇒ 判据变红（证明这条尺真的量着那件事）", () => {
    // 旧值原样：`join(ROOT, "fixtures", "todo-app")`。这里不 import 它（它已不存在），
    // 而是按同一形状现造一个——判卷要证的是"这个形状会被抓到"，不是"这个常量还在"。
    const oldStyleDefault = join(FIXTURE_ROOT, "todo-app");
    const isFixtureDefault = oldStyleDefault.startsWith(FIXTURE_ROOT + sep);
    expect(isFixtureDefault, "反向验证的前提不成立：现造的旧形状竟然不在 fixtures/ 下").toBe(true);
    // 同一把尺用在旧形状上必须判"是 fixture"——这正是上面第一条断言否定的那个谓词。
    expect(DEFAULT_WORKSPACE.startsWith(FIXTURE_ROOT + sep)).toBe(false);
  });

  it("源码里不再有把 fixture 当缺省工作区的赋值（静态面，防换一种写法绕回来）", async () => {
    const src = await readFile(join(REPO_ROOT, "src", "main", "demo-scripted.ts"), "utf8");
    // 钉的是形状而不是行号：`DEFAULT_WORKSPACE = <任何以 fixtures 开头的表达式>`。
    expect(src, "DEFAULT_WORKSPACE 又被指回 fixture 了").not.toMatch(
      /DEFAULT_WORKSPACE\s*=\s*join\(\s*ROOT\s*,\s*"fixtures"/u,
    );
  });
});
