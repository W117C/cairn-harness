// 变异验证器的"可判性闸门"：把「并发在飞」与「变异表退化」分成两种信号。
// 动因（2026-09-19 实跑）：另一会话正在改判卷测试文件时，本门把两条正常条目报成
// 「基线就不是全绿」+「变异存活」——真回归信号被并发噪声伪装掉了。
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorFaces, auditExpectFails, blockingTotalOf, budgetMsOf, classifyArgs, entryDisposition, expectFailFragments, expectFailRecognizable, headOnlyNeedleLine, headOnlyNeedleProblems, leftoverActionOf, leftoverBackupPaths, needleProblemLine, preflightRefusals, splitRunnable, untrackedAnchorLine, untrackedAnchorPaths, type HeadState } from "../scripts/lib/mutate-gates";

describe("budgetMsOf + classifyArgs 的值位（自我预算这条手段本身要有判卷）", () => {
  it("flag 优先于 env；两者都缺 ⇒ 不限且不吭声", () => {
    expect(budgetMsOf(["--budget-ms", "600000"], "30000")).toEqual({ ms: 600000, warning: null });
    expect(budgetMsOf([], "30000")).toEqual({ ms: 30000, warning: null });
    expect(budgetMsOf([], undefined)).toEqual({ ms: 0, warning: null });
  });

  it("非法预算不许静默退化成「没设」（写的人以为给了预算）", () => {
    const bad = budgetMsOf(["--budget-ms", "ten minutes"], undefined);
    expect(bad.ms).toBe(0);
    expect(bad.warning).toContain("--budget-ms");
    const empty = budgetMsOf(["--budget-ms"], undefined);
    expect(empty.warning).toContain("没有值");
    // `--budget-ms --list`：值位是另一个 flag ⇒ 不吞它，让 --list 照旧生效
    const clash = classifyArgs(["--budget-ms", "--list"]);
    expect(clash.unknown).toEqual([]);
    expect(clash.mode).toBe("list");
  });

  it("`--budget-ms 600000` 的值不是锚点 id（旧分流会报「未知 id 600000」，等于没人能设预算）", () => {
    const p = classifyArgs(["--budget-ms", "600000", "some-anchor-id"]);
    expect(p.targets).toEqual(["some-anchor-id"]);
    expect(p.unknown).toEqual([]);
    expect(p.mode).toBe("run");
  });

  it("未知 flag 照旧当场拒（新认的两个 flag 不放宽这条）", () => {
    expect(classifyArgs(["--budgett-ms", "600000"]).unknown).toEqual(["--budgett-ms"]);
  });
});

const clean: HeadState = "clean";
const dirty: HeadState = "dirty";
const untracked: HeadState = "untracked";

// 这两条路径是**喂给 `entryDisposition` 的输入**，被返回的那句只是把它们抄回理由里（第 97 页的 echo 形状）。
// 断言里写它们的字面量＝让"任何含 src/a.ts 的文案"替这条作证（实测「src/a.ts」在仓里有 2 处字面量），
// 所以取派生值：真正要钉的是**成因那半句**，见下面各条的 `toContain`。
const SRC_REL = "src/a.ts";
const TEST_REL = "tests/a.test.ts";

const info = (srcState: HeadState, testState: HeadState) => ({
  srcRel: SRC_REL,
  srcState,
  testRel: TEST_REL,
  testState,
});

describe("entryDisposition（变异条目开跑前的可判性判定）", () => {
  it("两者都相对 HEAD 干净 → run（正常判定）", () => {
    expect(entryDisposition(info(clean, clean))).toEqual({ kind: "run" });
  });

  it("被测源文件在飞 → refused，理由说清是回滚兜底问题", () => {
    const r = entryDisposition(info(dirty, clean));
    expect(r.kind).toBe("refused");
    expect(r.why).toContain(SRC_REL);
    expect(r.why).toContain("属在飞改动集");
  });

  it("被测源文件未跟踪 → 同样 refused，但理由区分于在飞（未跟踪无 HEAD 可回滚）", () => {
    const r = entryDisposition(info(untracked, clean));
    expect(r.kind).toBe("refused");
    // 「未跟踪」这三个字在仓里有 6 处字面量（改一处不会响）⇒ 钉这一支独有的成因：没有 HEAD 可回滚。
    // 注意别用「不在 HEAD 里」——它同时出现在变异表某条 `desc:` 的散文里，而那条散文永远流不到这里。
    expect(r.why).toContain("未跟踪（不在 HEAD 里）");
    expect(r.why).toContain("无回滚兜底");
  });

  it("源文件干净、**判卷测试文件在飞** → unverified（不得冒充变异存活或基线红）", () => {
    const r = entryDisposition(info(clean, dirty));
    expect(r.kind).toBe("unverified");
    expect(r.why).toContain(TEST_REL);
    // 「判卷」在仓里有 34 处字面量 ⇒ 钉这一支独有的裁决：既不判存活也不判基线红，而是「不可判」
    expect(r.why).toContain("该条不可判");
    expect(r.why).toContain("不得伪装成变异表退化");
  });

  it("未跟踪的判卷文件同样走 unverified，不静默开跑", () => {
    expect(entryDisposition(info(clean, untracked)).kind).toBe("unverified");
  });

  it("源文件优先：两个都在飞时报 refused 不报 unverified（前者是崩溃风险，后者只是噪声）", () => {
    expect(entryDisposition(info(dirty, dirty)).kind).toBe("refused");
  });
});

// 整跑前的预检：动因是 2026-09-23 真装 worktree 的 HEAD 实测——`mutate-verify` 跑到 19 分钟
// 才在第 k 条撞上「src/tools/snapshot.ts 未跟踪」，抛死后账本里连一条读数都不留。
describe("整跑前预检 preflightRefusals", () => {
  const ent = (id: string, srcState: HeadState, testState: HeadState) => ({
    id,
    srcRel: "src/" + id + ".ts",
    srcState,
    testRel: "tests/" + id + ".test.ts",
    testState,
  });

  it("全干净 ⇒ 空列表（预检本身不许无脑拦停）", () => {
    expect(preflightRefusals([ent("a", clean, clean), ent("b", clean, clean)])).toEqual([]);
  });

  it("未跟踪与在飞的源文件都进名单，并带上是哪一条与为什么", () => {
    const r = preflightRefusals([ent("ok", clean, clean), ent("u", untracked, clean), ent("d", dirty, clean)]);
    expect(r.map((x) => x.id)).toEqual(["u", "d"]);
    expect(r[0]!.why).toContain("无回滚兜底");
    expect(r[1]!.why).toContain("在飞改动集");
  });

  // 反向那一半：判卷文件在飞只让那一条不可判。预检若把它也算进拒绝，
  // 并发窗口里别人一个未提交的测试文件就能让整道门永远跑不起来。
  it("判卷文件在飞/未跟踪 ⇒ 不进拒绝名单（那是 unverified，不是崩溃风险）", () => {
    expect(preflightRefusals([ent("a", clean, dirty), ent("b", clean, untracked)])).toEqual([]);
  });
});

// 预检的后果应当是**逐条**跳过，不是停摆整张表。
// 动因（2026-09-23 同 HEAD 整跑实测）：`src/tools/snapshot.ts` 一个未跟踪文件让
// 「预检拒绝 1 条 ⇒ 一条都不跑」生效——696 条锚点里与在飞改动毫无关系的那 695 条也没判，
// 而红门只报一句「拒绝 1 条」，读起来像保护还在。两条断言各守一边：少跑是损失，多跑是危险。
describe("splitRunnable（预检逐条跳过，其余照跑）", () => {
  const ent = (id: string, srcState: HeadState, testState: HeadState = "clean") => ({
    id,
    srcRel: "src/" + id + ".ts",
    srcState,
    testRel: "tests/" + id + ".test.ts",
    testState,
  });

  it("一条在飞 ⇒ 只它被跳过，**其余条目必须在 runnable 里**（旧写法这里给空表）", () => {
    const r = splitRunnable([ent("a", dirty), ent("b", clean), ent("c", untracked), ent("d", clean)]);
    expect(r.refused.map((x) => x.id)).toEqual(["a", "c"]);
    expect(r.runnable).toEqual(["b", "d"]);
    expect(r.refused[0]!.why).toContain("在飞改动集");
    expect(r.refused[1]!.why).toContain("无回滚兜底");
  });

  it("不安全的一条都不许进 runnable（跳过要真跳过，别只看名单照样跑）", () => {
    const r = splitRunnable([ent("a", dirty), ent("b", untracked), ent("c", clean)]);
    for (const id of r.refused.map((x) => x.id)) expect(r.runnable).not.toContain(id);
    expect(r.runnable).toEqual(["c"]);
  });

  it("全干净 ⇒ 全可跑、零拒绝；判卷在飞不算拒绝（照常进 runnable，由跑到时记 unverified）", () => {
    expect(splitRunnable([ent("a", clean), ent("b", clean)])).toEqual({ runnable: ["a", "b"], refused: [] });
    expect(splitRunnable([ent("a", clean, dirty)]).runnable).toEqual(["a"]);
  });

  it("全不安全 ⇒ runnable 为空（调用方据此判红，而不是把「没跑」读成「都杀了」）", () => {
    const r = splitRunnable([ent("a", dirty), ent("b", untracked)]);
    expect(r.runnable).toEqual([]);
    expect(r.refused.length).toBe(2);
  });
});

// 上一次跑被 kill/崩溃会留下 `<src>.mutbak`；收尾校验原先按精确源路径查 git status，看不见它。
describe("残留备份 leftoverBackupPaths", () => {
  it("路径 = 源文件 + .mutbak，且只报盘上真在的那几个", () => {
    const have = new Set(["src/a.ts.mutbak"]);
    expect(leftoverBackupPaths(["src/a.ts", "src/b.ts"], (p) => have.has(p))).toEqual(["src/a.ts.mutbak"]);
  });

  it("多条锚点共用一个源文件 ⇒ 只报一次；全无残留 ⇒ 空（不许把「没查到」报成一堆）", () => {
    const have = new Set(["src/a.ts.mutbak"]);
    expect(leftoverBackupPaths(["src/a.ts", "src/a.ts", "src/c.ts"], (p) => have.has(p))).toEqual(["src/a.ts.mutbak"]);
    expect(leftoverBackupPaths(["src/a.ts", "src/a.ts"], () => false)).toEqual([]);
  });
});

// 自愈要覆盖源文件，而覆盖是**不可逆**的 ⇒ 判据的每一支都得有反面对手（不能只测"该盖时盖了"）。
// 动因（2026-09-23）：整跑被外层超时掐死在"源文件是突变体"那一拍，下一道门读到污染并制造假陈旧针脚。
describe("残留处置决策 leftoverActionOf", () => {
  const HEAD = "orig\n";
  const MUT = "mutated\n";      // 本表某条锚点作用在 HEAD 上产出的内容
  const OTHER = "someone-else\n"; // 第三方改动：对不上任何锚点的改法

  it("备份 == HEAD、盘上是本表锚点留下的突变体 ⇒ restore", () => {
    expect(leftoverActionOf(HEAD, HEAD, MUT, true)).toBe("restore");
  });

  it("反面对手：同样三份内容，但当前那份对不上任何锚点 ⇒ 绝不自动盖（可能是别人的在飞改动）", () => {
    expect(leftoverActionOf(HEAD, HEAD, OTHER, false)).toBe("manual");
    // 这一条是 `isOurMutant` 非恒真的唯一证据：把它从判据里删掉，上面两条都会返回 restore
  });

  it("备份 == HEAD、源文件已经 == HEAD ⇒ 只删过期备份，不动源文件", () => {
    expect(leftoverActionOf(HEAD, HEAD, HEAD, false)).toBe("drop-backup");
    expect(leftoverActionOf(HEAD, HEAD, HEAD, true)).toBe("drop-backup");
  });

  it("备份 != HEAD ⇒ manual（备份里可能是别人未提交的原件，即便当前内容对得上锚点也不许盖）", () => {
    expect(leftoverActionOf(HEAD, OTHER, MUT, true)).toBe("manual");
    expect(leftoverActionOf(HEAD, OTHER, HEAD, false)).toBe("manual"); // 连"只删备份"都不许：那份备份不是我们的
  });

  it("没有可比基线一律 manual：文件不在 HEAD 里 / 备份读不到 / 源文件不见了", () => {
    expect(leftoverActionOf(null, HEAD, MUT, true)).toBe("manual");
    expect(leftoverActionOf(HEAD, null, MUT, true)).toBe("manual");
    expect(leftoverActionOf(HEAD, HEAD, null, false)).toBe("manual");
  });
});


/* 锚点的两个文件面（被测源码 + 判卷测试）在不在版本控制里（#37 的根因：主树读盘 ⇒ 这类缺陷在主树永远不报）。
   判据是纯函数，`isTracked` 由调用方喂真 git 结果；这里喂集合是**判据的两个分支**，不是桩产品代码。 */
describe("untrackedAnchorPaths：锚点入库、被测码/判卷从未入库必须当场红", () => {
  const tracked = new Set(["src/a.ts", "tests/a.test.ts"]);
  const isTracked = (rel: string) => tracked.has(rel);

  it("盘上有、HEAD 里没有 ⇒ 点出来（含 id、路径与是哪一面，能直接照着补提交）", () => {
    const bad = untrackedAnchorPaths([{ id: "x1", path: "src/ghost.ts", what: "被测面" }], isTracked);
    expect(bad).toEqual([{ id: "x1", path: "src/ghost.ts", what: "被测面" }]);
    expect(untrackedAnchorLine(bad[0]!)).toContain("不在 HEAD 的树里");
  });

  it("反面对手：两面都已入库的表 ⇒ 一条都不报（这条判据不许把正常锚点报成红）", () => {
    expect(untrackedAnchorPaths([
      { id: "x1", path: "src/a.ts", what: "被测面" },
      { id: "x1", path: "tests/a.test.ts", what: "判卷" },
    ], isTracked)).toEqual([]);
  });

  it("混合表只报未入库的那几条，且按喂入顺序（整张表 ×2 面要能一眼定位）", () => {
    const bad = untrackedAnchorPaths([
      { id: "ok1", path: "src/a.ts", what: "被测面" },
      { id: "bad1", path: "src/ghost1.ts", what: "被测面" },
      { id: "bad2", path: "tests/ghost2.test.ts", what: "判卷" },
      { id: "ok2", path: "tests/a.test.ts", what: "判卷" },
    ], isTracked);
    expect(bad.map((b) => b.id)).toEqual(["bad1", "bad2"]);
  });

  it("判卷面缺文件说「连基线都跑不出来」并指向判卷文件，不写「源文件读不到」（两面修法指不同文件）", () => {
    const line = untrackedAnchorLine({ id: "x", path: "tests/ghost.test.ts", what: "判卷" });
    expect(line).toContain("判卷 tests/ghost.test.ts");
    expect(line).toContain("连基线都跑不出来");
    expect(line).toContain("把那份判卷文件提交");
    expect(line).not.toContain("它守护的代码从未入库");
  });

  it("两种红的文案不混：「从未入库」不写「改指针脚」，反之亦然（修法相反，混了就误导）", () => {
    const never = untrackedAnchorLine({ id: "x", path: "src/ghost.ts", what: "被测面" });
    const moved = needleProblemLine({ id: "x", srcRel: "src/a.ts", hits: 0, needle: "foo(" });
    expect(never).toContain("不是改针脚");
    expect(never).not.toContain("针脚已不在源文件里");
    expect(moved).toContain("针脚已不在源文件里");
    expect(moved).not.toContain("不在 HEAD 的树里");
  });
});

/* 同一批针脚跑两遍：盘上那份（现有 `auditNeedles`）+ HEAD 那份。
   只有「盘上判得通过、HEAD 那份判不过」才是这一类——它意味着锚点行已入库、被锚定的实现改动还没入库，
   于是这道门在主树绿、在干净 HEAD 红（2026-09-23 两树并排实测：主树阻断 7 / 隔离树阻断 10）。 */
describe("headOnlyNeedleProblems：锚点钉在在飞文本上必须点名（否则主树绿洗 HEAD）", () => {
  const p = (id: string, srcRel: string, hits: number): { id: string; srcRel: string; hits: number; needle: string } =>
    ({ id, srcRel, hits, needle: "foo(" });

  it("盘上没问题、HEAD 里 0 处 ⇒ 报这一类", () => {
    const bad = headOnlyNeedleProblems([], [p("a1", "src/x.ts", 0)], new Set());
    expect(bad.map((b) => b.id)).toEqual(["a1"]);
    const line = headOnlyNeedleLine(bad[0]!);
    expect(line).toContain("在飞文本");
    expect(line).toContain("src/x.ts");
  });

  it("盘上已经报过的同一条不重复报（一行红只有一个成因，读的人不必对两行）", () => {
    expect(headOnlyNeedleProblems([p("a1", "src/x.ts", 0)], [p("a1", "src/x.ts", 0)], new Set())).toEqual([]);
  });

  it("HEAD 里读不到、且该路径已由「未入库」判据报过 ⇒ 不重复报（同一件事两栏都记 = 数被抬高）", () => {
    expect(headOnlyNeedleProblems([], [p("a1", "src/ghost.ts", -1)], new Set(["src/ghost.ts"]))).toEqual([]);
  });

  it("反面对手：盘上与 HEAD 两份都判得通过 ⇒ 一条都不报", () => {
    expect(headOnlyNeedleProblems([], [], new Set(["src/ghost.ts"]))).toEqual([]);
  });

  it("三种红的文案互不串（修法各不相同：等实现入库 / 提交那文件 / 改指针脚）", () => {
    const drift = headOnlyNeedleLine(p("a1", "src/x.ts", 0));
    const never = untrackedAnchorLine({ id: "a1", path: "src/ghost.ts", what: "被测面" });
    const moved = needleProblemLine(p("a1", "src/x.ts", 0));
    expect(drift).not.toContain("不在 HEAD 的树里");
    expect(never).not.toContain("在飞文本");
    expect(moved).not.toContain("在飞文本");
    expect(moved).not.toContain("不在 HEAD 的树里");
  });
});

/* 接线（`reportNeedles`）里没有编译期保护：tsconfig 的 include 覆盖 scripts/，但没开 allowJs ⇒
   `.mjs` 不过 tsc（实测：`pnpm exec tsc --noEmit --listFiles` 列出 829 个文件，其中 `.mjs` **0 个**；
   对照 `scripts/lib/mutate-gates.ts` 在列）。所以"少喂一支面 / 少算一支数"
   这种接线错只有在 lib 里立运行时判据才会出声。以下两支就是为那个目的存在。 */
describe("anchorFaces + blockingTotalOf：接线缺件必须当场崩，不许静默少看一维", () => {
  it("每条锚点产出两支面（被测面 + 判卷），且两面各一次（少喂一支 = 那一面静默失效）", () => {
    const faces = anchorFaces([
      { id: "a1", src: "src/a.ts", test: "tests/a.test.ts" },
      { id: "a2", src: "src/b.ts", test: "tests/b.test.ts" },
    ]);
    expect(faces.map((f) => `${f.id}/${f.what}`)).toEqual([
      "a1/被测面", "a1/判卷", "a2/被测面", "a2/判卷",
    ]);
  });

  it("反面对手：空表 ⇒ 空数组（这条判据不许凭空造出锚点面）", () => {
    expect(anchorFaces([])).toEqual([]);
  });

  it("五支数都给 ⇒ 求和（0 也算数，不许被当成缺项丢掉）", () => {
    expect(blockingTotalOf({ needle: 3, duplicateIds: 0, untracked: 4, drift: 5, expectFail: 6 })).toEqual(18);
  });

  it("缺一支 ⇒ 抛并点名缺哪支（门报红却少算一维 = 这条门唯一的产出被废）", () => {
    const partial = { needle: 3, duplicateIds: 0, untracked: 4 } as unknown as Parameters<typeof blockingTotalOf>[0];
    expect(() => blockingTotalOf(partial)).toThrow(/drift/);
    // 第 138 页新加的那一维（killer 指针失效）同样必须被强制喂：接线少喂一支＝那一维静默不算。
    const noPointer = { needle: 0, duplicateIds: 0, untracked: 0, drift: 0 } as unknown as Parameters<typeof blockingTotalOf>[0];
    expect(() => blockingTotalOf(noPointer)).toThrow(/expectFail/);
  });

  it("非有限数（NaN / Infinity）也算缺项： typeof 是 number，但读数本身不可信", () => {
    expect(() => blockingTotalOf({ needle: NaN, duplicateIds: 0, untracked: 0, drift: 0, expectFail: 0 })).toThrow(/needle/);
    expect(() => blockingTotalOf({ needle: 1, duplicateIds: 0, untracked: 0, drift: Infinity, expectFail: 0 })).toThrow(/drift/);
    expect(() => blockingTotalOf({ needle: 0, duplicateIds: 0, untracked: 0, drift: 0, expectFail: NaN })).toThrow(/expectFail/);
  });
});

/* 入口这条闸（2026-09-23 实踩）：这张表跑在**顶层**，于是 `import("scripts/mutate-verify.mjs")`
   等于发起一次整表变异。我为了"数一下条目数"跑了一条 `node -e "await import(...)"`，主树当场跑起来，
   被我 SIGKILL 后留下一枚 mutant（`src/tools/remember.ts` 的 `if (!isMemoryType(type))` 成了 `if (false)`），
   靠 `.mutbak` + 三条证据前提（备份==HEAD ∧ 当前!=HEAD ∧ 当前==apply(备份)）才敢还原。
   判据写成对两侧：被 import 拒跑 / 正当入口照跑——只钉一侧的话，把闸写成"永远退 2"也能绿。 */
describe("被 import 时必须拒绝运行（它会就地改源文件）", () => {
  const script = fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url));

  it("import 进来 ⇒ 退出码 2、点名拒绝，且一条变异都没跑", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "-e", `await import(${JSON.stringify(script)})`], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("拒绝运行");
    expect(r.stdout).not.toContain("变异验证：");
  });

  it("反向一侧：正当入口没被这道闸误伤（--list 仍 exit 0 且列得出条目）", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", script, "--list"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    // 只给下限不给等式：条目数会随锚点增减（事实源是那张表本身），这里判的是"入口还活着"。
    expect(r.stdout.split("\n").filter((l) => l.includes("\t")).length).toBeGreaterThan(500);
  });
});

/* 第 138 页：`expectFail` 自己也是一根指针。它断在「用例改过名」上时，报告的措辞是「变异存活或误伤」——
   把**指针坏了**说成**代码没守住**，而发现它以前要把那条变异跑一遍（整表几十分钟）。
   这条尺的校准过程值得留在判卷里：第一版按整句逐字比，报了 10 条，其中 5 条单跑是 ✅ 杀死的假红
   （标题是 `"…：" + label + " → …"` 拼出来的，盘上根本没有整句）⇒ 判据改成**最长片段**必须认得。 */
describe("auditExpectFails：killer 指针必须指得到活用例", () => {
  const file = (titles: string[]): string => titles.map((t) => `  it("${t}", () => {});`).join("\n");
  const read = (text: string) => (): string => text;

  it("齐的读空；真改过名的按 not-found 报出来", () => {
    const ok = auditExpectFails([{ id: "a1", test: "tests/x.test.ts", expectFail: "开关开着就红一次" }], read(file(["开关开着就红一次"])));
    expect(ok).toEqual([]);
    const bad = auditExpectFails([{ id: "a2", test: "tests/x.test.ts", expectFail: "旧标题里那句再也没出现过的一句话" }], read(file(["新标题：同一件事换了说法"])));
    expect(bad.map((p) => `${p.id}/${p.why}`)).toEqual(["a2/not-found"]);
  });

  it("拼出来的标题（盘上没有整句，跑起来才有）不许报红——这条是校准出来的，不是推的", () => {
    const text = '  it("零行为回退：" + label + " → 无 verify_result、请求数与旧行为同形", async () => {});';
    expect(auditExpectFails([{ id: "auto-verify-default-on", test: "tests/loop.test.ts", expectFail: "零行为回退：缺省不开闸（未给 autoVerify） → 无 verify_result、请求数与旧行为同形" }], () => text)).toEqual([]);
  });

  it("带转义引号的标题不许误报（表里存解码值，盘上是源码文字）", () => {
    const text = 'it("纯精确名不做子串：matcher \\"Edit\\" 不得命中 NotebookEdit", async () => {});';
    expect(auditExpectFails([{ id: "h", test: "tests/y.test.ts", expectFail: '纯精确名不做子串：matcher "Edit" 不得命中 NotebookEdit' }], () => text)).toEqual([]);
  });

  it("判卷文件读不到 ⇒ unreadable，不许当「指针没问题」（规则 92/210 那一族）", () => {
    const got = auditExpectFails([{ id: "z", test: "tests/gone.test.ts", expectFail: "任何句子" }], () => null);
    expect(got.map((p) => p.why)).toEqual(["unreadable"]);
  });

  it("空 expectFail / 空 test 跳过：那是「没声明 killer」，与指针断裂分两档", () => {
    expect(auditExpectFails([{ id: "w", test: "tests/x.test.ts", expectFail: "" }, { id: "v", test: "", expectFail: "有内容" }], read(file(["任何东西"])))).toEqual([]);
  });

  it("片段口径本身：按分隔切、丢掉 4 字以下的碎片、长片段排在前面", () => {
    expect(expectFailFragments("a b、cd efghijklmnop abcd_efg")).toEqual(["efghijklmnop", "abcd_efg"]);
    // 整句全是三四字以下的碎片 ⇒ 没判据，放行（宁少报，不假红）。
    expect(expectFailRecognizable("ab cd", "anything")).toBe(true);
  });

  it("真表自证：整张表的 killer 指针必须 0 失效（新增一条断指针＝当场红）", () => {
    // 只走 `--list` 这条**不改源文件**的入口。以前这里 spawn `--check-needles`，结果在变异单跑时
    // 撞上门自己的备份文件预检 ⇒「读不到汇总行」把三条本来好好的锚点带红（第 138 页）。
    const script = fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url));
    const r = spawnSync(process.execPath, [script, "--list"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const rows = (r.stdout ?? "").split("\n")
      .map((l) => l.split("\t"))
      .filter((p) => p.length >= 5 && p[4] !== undefined && p[4].startsWith("\""))
      .map((p) => ({ id: p[0] ?? "", test: p[3] ?? "", expectFail: JSON.parse(p[4] ?? '""') as string }));
    // 空 expectFail 的条目（逐行式那几条）由尺自己跳过，这里只要求表读得出来。
    expect(rows.length).toBeGreaterThan(500);
    const root = fileURLToPath(new URL("../", import.meta.url));
    expect(auditExpectFails(rows, (rel) => {
      try { return readFileSync(join(root, rel), "utf8"); } catch { return null; }
    }).map((p) => `${p.id}/${p.why}`)).toEqual([]);
  }, 60_000);

  it("求和那一行必须把第 5 维喂进去（钉接线：少喂一支＝门照跑、汇总照印绿）", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url)), "utf8");
    // 用正则框住**真实的那个调用**，不能只 includes 一行文字：
    // 这条锚点自己的 apply 里也写着那句文字（同一份文件），单行文字判据会连被改掉的那次也读成"还在"。
    expect(/blockingTotalOf\(\{[^}]*expectFail:[^}]*\}\)/s.test(src)).toBe(true);
  });
});
