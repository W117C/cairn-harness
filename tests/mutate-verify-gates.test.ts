// 变异验证器的"可判性闸门"：把「并发在飞」与「变异表退化」分成两种信号。
// 动因（2026-09-19 实跑）：另一会话正在改判卷测试文件时，本门把两条正常条目报成
// 「基线就不是全绿」+「变异存活」——真回归信号被并发噪声伪装掉了。
import { describe, expect, it } from "vitest";
import { budgetMsOf, classifyArgs, entryDisposition, leftoverActionOf, leftoverBackupPaths, needleProblemLine, preflightRefusals, splitRunnable, untrackedAnchorLine, untrackedAnchorPaths, type HeadState } from "../scripts/lib/mutate-gates";

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

const info = (srcState: HeadState, testState: HeadState) => ({
  srcRel: "src/a.ts",
  srcState,
  testRel: "tests/a.test.ts",
  testState,
});

describe("entryDisposition（变异条目开跑前的可判性判定）", () => {
  it("两者都相对 HEAD 干净 → run（正常判定）", () => {
    expect(entryDisposition(info(clean, clean))).toEqual({ kind: "run" });
  });

  it("被测源文件在飞 → refused，理由说清是回滚兜底问题", () => {
    const r = entryDisposition(info(dirty, clean));
    expect(r.kind).toBe("refused");
    expect(r.why).toContain("src/a.ts");
    expect(r.why).toContain("相对 HEAD 有改动");
  });

  it("被测源文件未跟踪 → 同样 refused，但理由区分于在飞（未跟踪无 HEAD 可回滚）", () => {
    const r = entryDisposition(info(untracked, clean));
    expect(r.kind).toBe("refused");
    expect(r.why).toContain("未跟踪");
  });

  it("源文件干净、**判卷测试文件在飞** → unverified（不得冒充变异存活或基线红）", () => {
    const r = entryDisposition(info(clean, dirty));
    expect(r.kind).toBe("unverified");
    expect(r.why).toContain("tests/a.test.ts");
    expect(r.why).toContain("判卷");
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
    expect(r[0]!.why).toContain("未跟踪");
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
    expect(r.refused[1]!.why).toContain("未跟踪");
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
