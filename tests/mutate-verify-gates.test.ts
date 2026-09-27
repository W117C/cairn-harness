// 变异验证器的"可判性闸门"：把「并发在飞」与「变异表退化」分成两种信号。
// 动因（2026-09-19 实跑）：另一会话正在改判卷测试文件时，本门把两条正常条目报成
// 「基线就不是全绿」+「变异存活」——真回归信号被并发噪声伪装掉了。
import { describe, expect, it } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorFaces, auditExpectFails, looseOnlyPointers, baselineRedKind, blockingTotalOf, budgetMsOf, classifyArgs, entryDisposition, failingTestText, headOnlyNeedleLine, headOnlyNeedleProblems, headPointerProblems, killerAttributionOk, leftoverActionOf, leftoverBackupPaths, needleProblemLine, preflightRefusals, selectChangedEntries, splitRunnable, untrackedAnchorLine, untrackedAnchorPaths, type HeadState } from "../scripts/lib/mutate-gates";
import { checkAnchorTitles } from "../scripts/mutate-anchor-titles";

/** 从锚点表取 `{id,test,expectFail}`：只走 `--list` 这条**不改源文件**的入口。
 *  以前这里 spawn `--check-needles`，结果在变异单跑时撞上门自己的备份文件预检 ⇒「读不到汇总行」
 *  把三条本来好好的锚点带红（第 138 页）。两把尺共用这一份取料，别各写一遍（第十三族）。 */
function listAnchorRows(): { id: string; test: string; expectFail: string }[] {
  const script = fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [script, "--list"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return (r.stdout ?? "").split("\n")
    .map((l) => l.split("\t"))
    .filter((p) => p.length >= 5 && p[4] !== undefined && p[4].startsWith("\""))
    .map((p) => ({ id: p[0] ?? "", test: p[3] ?? "", expectFail: JSON.parse(p[4] ?? '""') as string }));
}

function readRel(rel: string): string | null {
  try { return readFileSync(join(fileURLToPath(new URL("../", import.meta.url)), rel), "utf8"); } catch { return null; }
}

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

/* 第 162 页 · `--changed-since`：把「该杀哪几条锚点」从人肉名单改成从改动面派生。
   动因不是想要个新功能，是规则 229 反复喊的那格——手抄名单只会抄到**我想到的**那几条，
   而同一个文件上那些旧锚点，恰恰是在我改了实现之后最容易变成空操作的那些。 */
describe("改动面派生：一条锚点的两面都要认（被测源 ∪ 判卷文件）", () => {
  const table = [
    { id: "a", src: "src/agent/x.ts", test: "tests/x.test.ts" },
    { id: "b", src: "src/agent/y.ts", test: "tests/y.test.ts" },
    { id: "c", src: "scripts/z.ts", test: "tests/z.test.ts" },
  ];

  it("改被测源 ⇒ 选中；改判卷文件 ⇒ 也要选中（只认一头＝另一半搬家没人知道）", () => {
    expect(selectChangedEntries(table, ["src/agent/x.ts"]).ids).toEqual(["a"]);
    expect(selectChangedEntries(table, ["tests/y.test.ts"]).ids, "判卷文件自己改了取料面，也该重杀一次").toEqual(["b"]);
  });

  it("两面都不在改动面 ⇒ 一条不选，但把「表多大／面多大」一起交回去（0 条要能被分诊）", () => {
    const r = selectChangedEntries(table, ["README.md", "docs/x.md"]);
    expect(r.ids).toEqual([]);
    expect(r.faceCount).toBe(2);
    expect(r.pickedCount).toBe(0);
    expect(r.total, "分母必须是整表条数：不然「选中 2 条」读起来像全跑完了").toBe(3);
  });

  it("git 输出的尾换行不算一个文件；同一锚点两面都改也只选一次", () => {
    expect(selectChangedEntries(table, ["", ""]).faceCount, "空路径进面＝虚增分母").toBe(0);
    expect(selectChangedEntries(table, ["src/agent/x.ts", "tests/x.test.ts"]).ids).toEqual(["a"]);
  });

  it("接线：派生出来的 id 真的并进 targets（只写纯函数不接＝名单还是人手抄的）", () => {
    const src = readFileSync(join(fileURLToPath(new URL("../", import.meta.url)), "scripts", "mutate-verify.mjs"), "utf8");
    // 两根都必须是**带真换行的跨行正则**，不能是 `toContain(那行文字)`：锚点表就住在这同一个文件里，
    // 表中的针脚字面就是这两行原文 ⇒ 实现被改掉、表里那份字面还在 ⇒ 断言恒真。
    // 09-28 实测：这两条锚点第一版就是这么**存活**的（规则 236 那一族的第五次，也是变异机第一次
    // 抓到我写的接线判卷恒真——它当时喊的是「待复认」，我照提示改成真换行才让这两条开口）。
    expect(src, "派生调用整支没接上 ⇒ selectChangedEntries 是个没人调的纯函数").toMatch(
      /\n\s*derived = selectChangedEntries\(MUTATIONS, changed\);/);
    expect(src, "算出 ids 却不并进 targets ⇒ 跑的还是人手抄那几条").toMatch(
      /\nconst targets = \[\.\.\.new Set\(\[\.\.\.plan\.targets, \.\.\.derived\.ids\]\)\];/);
    expect(src, "这一支是上面那条的反面：把并集换成只取人手抄的名单").not.toMatch(
      /\nconst targets = \[\.\.\.plan\.targets\];/);
  });

  it("派生可以只看名单不真跑：`--list --changed-since=<空树>` ⇒ 每条锚点两面都在跟踪文件里，必须选中整表", () => {
    const script = fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url));
    const emptyTree = execFileSync("git", ["hash-object", "-t", "tree", "/dev/null"], { encoding: "utf8" }).trim();
    const r = spawnSync(process.execPath, ["--import", "tsx", script, "--list", "--changed-since=" + emptyTree],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    expect(r.status).toBe(0);
    const rows = (r.stdout ?? "").split("\n").filter((l) => l.includes("\t"));
    expect(rows.length).toBeGreaterThan(900);
    // 「选中 N/N」而不是「选中 0/N」：这是**行为读数**，名单被筛空或被忽略时它当场变样——
    // 上面那条文字钉抓不到第 4 条锚点那种"传了个空面"的坏（它照样命中文字）。
    expect(r.stdout).toContain(`选中锚点 ${String(rows.length)}/${String(rows.length)} 条`);
  });

  it("真跑：`--changed-since` 不给 rev ⇒ exit 2，且一条源文件都不许动", () => {
    const script = fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url));
    const r = spawnSync(process.execPath, ["--import", "tsx", script, "--changed-since"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toContain("需要一个 rev");
  });

  // 这一支比上面那条值钱：拼错的 rev 是**真实会发生**的输入，而它的默认读法（"没东西要跑"）长得跟"验完了"一模一样。
  it("派生可以只看名单不真跑：`--list --changed-since=<rev>` 只印选中的那些，且不碰任何源文件", () => {
    const script = fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url));
    const one = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", script, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const picked = one(["--list", "--changed-since=HEAD"]);
    expect(picked.status).toBe(0);
    expect(picked.stdout, "派生行必须印出来：不然「筛过」与「没筛」在输出上没区别").toContain("改动面派生：rev=HEAD");
    const rows = (picked.stdout ?? "").split("\n").filter((l) => l.includes("\t")).length;
    expect(rows).toBeLessThan(900);
    // 反向那一半是这条用例存在的理由：**没给 flag 时"选中 0 条"是未筛，不是筛出空表**。
    // 写错成一律 filter ⇒ `--list` 印 0 行，而吃 `--list` 的两把静态尺会把整张表读成"表空了"。
    const all = one(["--list"]);
    expect(all.stdout).not.toContain("改动面派生");
    expect((all.stdout ?? "").split("\n").filter((l) => l.includes("\t")).length).toBeGreaterThanOrEqual(900);
  });

  it("真跑：rev 取不到 ⇒ exit 2 并点名那个 rev（「取料坏」不许退化成「选中 0 条」）", () => {
    const script = fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url));
    const r = spawnSync(process.execPath, ["--import", "tsx", script, "--changed-since=no-such-rev-xyz"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    const out = r.stdout + r.stderr;
    expect(out).toContain("no-such-rev-xyz");
    expect(out, "把取料坏印成一条正常的派生读数 ⇒ 下一句就是「0 条，全绿」").not.toContain("改动面派生：");
  });
});

describe("--changed-since 的参数形状：放行连写，但不放宽「未知即拒」", () => {
  it("`--changed-since=HEAD~1` 认，那个值也不被当成锚点 id", () => {
    const p = classifyArgs(["--changed-since=HEAD~1"]);
    expect(p.unknown).toEqual([]);
    expect(p.targets).toEqual([]);
  });

  it("空格写法同样认：rev 不进 targets，位置参数照旧是 id", () => {
    const p = classifyArgs(["--changed-since", "HEAD~1", "some-id"]);
    expect(p.unknown).toEqual([]);
    expect(p.targets).toEqual(["some-id"]);
  });

  it("两条反向哨兵：不带值的 flag 硬塞值照样拒；`--budget-ms=600000` 刻意**不**放行", () => {
    // budgetMsOf 只解析空格写法——放行 `=` 写法＝"给了值却按不限跑"，正是本文件要拒的静默按缺省。
    expect(classifyArgs(["--list=HEAD"]).unknown).toEqual(["--list=HEAD"]);
    expect(classifyArgs(["--budget-ms=600000"]).unknown).toEqual(["--budget-ms=600000"]);
  });

  it("`--lock-tag` 两种写法都认、值不进 targets，而隔壁拼错的 `--lock-tx=` 照拒", () => {
    // 登记与读取必须双向对得上（cert 侧那条同名的闸在这里没有配对，所以这里补一条）：
    // 只加进 flag 表而脚本不读＝白放行，脚本读了没登记＝把标签当未知 flag 拒跑，判卷自己先撞死。
    expect(classifyArgs(["--lock-tag=judge-1"]).unknown).toEqual([]);
    expect(classifyArgs(["--lock-tag=judge-1"]).targets).toEqual([]);
    const spaced = classifyArgs(["--lock-tag", "judge-1", "some-id"]);
    expect(spaced.unknown).toEqual([]);
    expect(spaced.targets).toEqual(["some-id"]);
    expect(classifyArgs(["--lock-tx=judge-1"]).unknown).toEqual(["--lock-tx=judge-1"]);
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

  it("六支数都给 ⇒ 求和（0 也算数，不许被当成缺项丢掉）", () => {
    expect(blockingTotalOf({ needle: 3, duplicateIds: 0, untracked: 4, drift: 5, expectFail: 6, headPointer: 7 })).toEqual(25);
  });

  it("缺一支 ⇒ 抛并点名缺哪支（门报红却少算一维 = 这条门唯一的产出被废）", () => {
    const partial = { needle: 3, duplicateIds: 0, untracked: 4 } as unknown as Parameters<typeof blockingTotalOf>[0];
    expect(() => blockingTotalOf(partial)).toThrow(/drift/);
    // 第 138 页新加的那一维（killer 指针失效）同样必须被强制喂：接线少喂一支＝那一维静默不算。
    const noPointer = { needle: 0, duplicateIds: 0, untracked: 0, drift: 0 } as unknown as Parameters<typeof blockingTotalOf>[0];
    expect(() => blockingTotalOf(noPointer)).toThrow(/expectFail/);
    // 第 141 页的 HEAD 侧那一维，同理
    const noHead = { needle: 0, duplicateIds: 0, untracked: 0, drift: 0, expectFail: 0 } as unknown as Parameters<typeof blockingTotalOf>[0];
    expect(() => blockingTotalOf(noHead)).toThrow(/headPointer/);
  });

  it("非有限数（NaN / Infinity）也算缺项： typeof 是 number，但读数本身不可信", () => {
    expect(() => blockingTotalOf({ needle: NaN, duplicateIds: 0, untracked: 0, drift: 0, expectFail: 0, headPointer: 0 })).toThrow(/needle/);
    expect(() => blockingTotalOf({ needle: 1, duplicateIds: 0, untracked: 0, drift: Infinity, expectFail: 0, headPointer: 0 })).toThrow(/drift/);
    expect(() => blockingTotalOf({ needle: 0, duplicateIds: 0, untracked: 0, drift: 0, expectFail: NaN, headPointer: 0 })).toThrow(/expectFail/);
    expect(() => blockingTotalOf({ needle: 0, duplicateIds: 0, untracked: 0, drift: 0, expectFail: 0, headPointer: NaN })).toThrow(/headPointer/);
  });
});

describe("headPointerProblems：锚点行入库了、判卷里那条标题没入库", () => {
  // 动因（第 141 页）：这一格整表普查里 23 条，只能靠 21.8 分钟实跑发现。盘上尺看不到它——
  // 盘上指针指得到盘上那条标题；差的只有 HEAD 那一侧。
  const entries = [
    { id: "in-table-dirty", test: "tests/a.test.ts", expectFail: "只有盘上有的一条用例" },
    { id: "in-table-clean", test: "tests/b.test.ts", expectFail: "盘上与 HEAD 都有" },
    { id: "new-this-commit", test: "tests/c.test.ts", expectFail: "本笔新加的锚点" },
  ];
  const headFiles: Record<string, string> = {
    "tests/a.test.ts": 'it("别的用例", () => {});',                 // 判卷改了没入库 ⇒ HEAD 指不到
    "tests/b.test.ts": 'it("盘上与 HEAD 都有", () => {});',
    "tests/c.test.ts": "it(\"本笔新加的锚点\", () => {});",
  };
  const runWith = (judgeDirty: (rel: string) => boolean) => headPointerProblems(entries, {
    inHeadTable: (id) => id !== "new-this-commit",
    judgeDirty,
    readAtHead: (rel) => headFiles[rel] ?? null,
  });

  it("判卷在飞且 HEAD 那份指不到 ⇒ 点名（三态里这是「HEAD 侧失效」，不是「没问题」）", () => {
    expect(runWith((rel) => rel === "tests/a.test.ts").map((p) => `${p.id}/${p.why}`)).toEqual(["in-table-dirty/not-found"]);
  });

  it("本笔同时改表与改判卷的那条**不判**（那格归同笔规矩）；判卷没动过的也不重复判", () => {
    expect(runWith(() => false)).toEqual([]);
    expect(runWith((rel) => rel === "tests/b.test.ts" || rel === "tests/c.test.ts").map((p) => p.id)).toEqual([]);
  });

  it("HEAD 里根本没有那份判卷 ⇒ unreadable，不等于没问题", () => {
    const got = headPointerProblems([{ id: "in-table-dirty", test: "tests/gone.test.ts", expectFail: "任何标题" }], {
      inHeadTable: () => true, judgeDirty: () => true, readAtHead: () => null,
    });
    expect(got.map((p) => `${p.id}/${p.why}`)).toEqual(["in-table-dirty/unreadable"]);
  });

  it("空指针条目不在这里判（那是「没声明 killer」另一档，归盘上那把尺）", () => {
    expect(runWith(() => true).length).toBe(1);
    expect(headPointerProblems([{ id: "x", test: "tests/a.test.ts", expectFail: "" }], {
      inHeadTable: () => true, judgeDirty: () => true, readAtHead: () => "",
    })).toEqual([]);
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

  // 第 152 页：整条都是占位符的标题（生成式 `it(`${t}`, …)`）编译出来是一条**匹配任何输入**的模式，
  // 于是压在**那份判卷文件**上的全部指针体检一起变恒真——本轮那条「四支／六支」死指针就是靠这个洞活到 21 分钟实跑才喊。
  it("生成式标题不许把整份判卷的体检缴械：指向不存在用例的指针仍要报 not-found", () => {
    const text = ['  it("${t}", () => {});', '  it("一句真实存在的标题", () => {});'].join("\n");
    expect(auditExpectFails([{ id: "vac", test: "tests/x.test.ts", expectFail: "这句话在仓库里不存在 ZZZ-9x7" }], read(text)))
      .toEqual([{ id: "vac", test: "tests/x.test.ts", expectFail: "这句话在仓库里不存在 ZZZ-9x7", why: "not-found" }]);
    // 反向：同文件里那条真实标题必须还指得到（否则就成了"把所有模式清空"这种过修）
    expect(auditExpectFails([{ id: "real", test: "tests/x.test.ts", expectFail: "一句真实存在的标题" }], read(text))).toEqual([]);
  });

  it("变体：标题里除了占位符只剩空白 ⇒ 同样缴械，也要丢（不 trim 就漏这一格）", () => {
    const text = '  it(" ${t} ", () => {});';
    // 指针必须**带空档**：不 trim 时那条模式的字面残迹是两个空格，它只认得"空格…空格"形状的句子；
    // 拿无空格的句子去问，两种实现都给 not-found ⇒ 这条用例分辨不出这一位（第一版就是这样让锚点存活的）。
    expect(auditExpectFails([{ id: "ws", test: "tests/x.test.ts", expectFail: "任何 不相干 的句子" }], read(text))).toHaveLength(1);
  });

  it("过修的反面：带字面残迹的标题要**留着**通配（参数化标题仍然认得渲染后的样子）", () => {
    const text = '  it("参数化 ${t} 那一格", () => {});';
    expect(auditExpectFails([{ id: "keep", test: "tests/x.test.ts", expectFail: "参数化 run-scorecard 那一格" }], read(text))).toEqual([]);
  });

  it("本文件自己就是案发现场：那串 fixture 生成器里的 it 不是真标题，收紧后假指针必须报出来", () => {
    // 洞的来源正是本文件上面那行 `titles.map(...)` 里的 `it("${t}"` ——正则取料分不清"真标题"与"字符串里长得像标题的文字"，
    // 于是它编译成了一条恒真模式。读自己这一份，比再造一份合成输入更能钉住"这条修法在真盘上有效"。
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
    // 指针要**拼**出来，不许整串写死：`auditExpectFails` 第一支判据是"判卷源文件里逐字含这句"，
    // 而我正在读自己这份文件——整串写死的话，那句字面量本身就躺在文件里 ⇒ 尺永远答"指针有效"（实测第一版就是这么绿的）。
    const bogus = "绝不可能出现" + "在判卷里的一句话";
    const rows = [{ id: "self", test: "tests/mutate-verify-gates.test.ts", expectFail: bogus }];
    expect(self).toContain('it("${t}"'); // 自证：这份判卷里确实躺着那条恒真模式的原型
    expect(self).not.toContain(bogus);
    expect(auditExpectFails(rows, () => self)).toHaveLength(1);
  });

  it("判卷文件读不到 ⇒ unreadable，不许当「指针没问题」（规则 92/210 那一族）", () => {
    const got = auditExpectFails([{ id: "z", test: "tests/gone.test.ts", expectFail: "任何句子" }], () => null);
    expect(got.map((p) => p.why)).toEqual(["unreadable"]);
  });

  it("空 expectFail / 空 test 跳过：那是「没声明 killer」，与指针断裂分两档", () => {
    expect(auditExpectFails([{ id: "w", test: "tests/x.test.ts", expectFail: "" }, { id: "v", test: "", expectFail: "有内容" }], read(file(["任何东西"])))).toEqual([]);
  });

  it("两把尺同宽（同一判据只许有一份）：新尺与 `mutate-anchor-titles` 对同一批判卷判定必须一致", () => {
    const srcs = [
      { path: "tests/loop.test.ts", text: '  it("零行为回退：" + label + " → 无 verify_result、请求数与旧行为同形", async () => {});' },
      { path: "tests/hooks.test.ts", text: '  it("纯精确名不做子串：matcher \\"Edit\\" 不得命中 NotebookEdit", async () => {});' },
      { path: "tests/plain.test.ts", text: '  it("反面对手：不同 callId 的两条 result 绝不合并", () => {});' },
    ];
    const read = (rel: string): string | null => srcs.find((s) => s.path === rel)?.text ?? null;
    const rows = [
      { id: "curried", test: "tests/loop.test.ts", expectFail: "零行为回退：缺省不开闸（未给 autoVerify） → 无 verify_result、请求数与旧行为同形" },
      { id: "escaped", test: "tests/hooks.test.ts", expectFail: '纯精确名不做子串：matcher "Edit" 不得命中 NotebookEdit' },
      { id: "plain", test: "tests/plain.test.ts", expectFail: "反面对手：不同 callId 的两条 result 绝不合并" },
      { id: "renamed", test: "tests/plain.test.ts", expectFail: "旧标题里那句再也没出现过的一句话" },
    ];
    const mine = auditExpectFails(rows, read).map((p) => p.id);
    const theirs = checkAnchorTitles(rows.map((r) => ({ ...r, src: "src/x.ts" })), srcs, {})
      .filter((f) => f.kind === "drift").map((f) => f.id);
    expect(mine).toEqual(["renamed"]);
    expect(theirs).toEqual(mine);
  });

  it("非 vitest 面不判（test 指向 .ts/.md 之类）：那一格归 `mutate-anchor-titles` 单独点名，不造第三把尺", () => {
    expect(auditExpectFails([{ id: "n", test: "scripts/x.ts", expectFail: "任何句子" }], () => "什么句子都没有")).toEqual([]);
  });

  it("真表自证：整张表的 killer 指针必须 0 失效（新增一条断指针＝当场红）", () => {
    // 只走 `--list` 这条**不改源文件**的入口。以前这里 spawn `--check-needles`，结果在变异单跑时
    // 撞上门自己的备份文件预检 ⇒「读不到汇总行」把三条本来好好的锚点带红（第 138 页）。
    const rows = listAnchorRows();
    // 空 expectFail 的条目（逐行式那几条）由尺自己跳过，这里只要求表读得出来。
    expect(rows.length).toBeGreaterThan(500);
    // 「一条都不许丢」：`--list` 是两把静态尺共同的取料面。字段里带换行会把一行拆成两行 ⇒
    // 那条锚点对两把尺同时隐形，而两把尺都发现不了（今天就抓到 1 条：desc 里带换行）。
    const tableSrc = readFileSync(fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url)), "utf8");
    expect(rows.length).toBe((tableSrc.match(/^\s+id: "/gm) ?? []).length);
    const root = fileURLToPath(new URL("../", import.meta.url));
    expect(auditExpectFails(rows, (rel) => {
      try { return readFileSync(join(root, rel), "utf8"); } catch { return null; }
    }).map((p) => `${p.id}/${p.why}`)).toEqual([]);
  }, 60_000);

  // 第 154 页：「松钉」＝逐字认不出、只靠占位符展开的标题模式过关的指针。这一格以前没有读数，
  // 所以"标题改了、指针跟着漂"只能花 21 分钟实跑后以「红了但没红在期望用例」出现（本轮「四支／六支」就是这条来路）。
  const LOOSE_CAP = 10;
  it("松钉要单独点名：拼接标题与带转义引号两类算松钉，逐字命中的不算，真断的也不算（那是 not-found）", () => {
    const srcs = [
      { path: "tests/loop.test.ts", text: '  it("零行为回退：" + label + " → 无 verify_result、请求数与旧行为同形", async () => {});' },
      { path: "tests/hooks.test.ts", text: '  it("纯精确名不做子串：matcher \\"Edit\\" 不得命中 NotebookEdit", async () => {});' },
      { path: "tests/plain.test.ts", text: '  it("反面对手：不同 callId 的两条 result 绝不合并", () => {});' },
    ];
    const read3 = (rel: string): string | null => srcs.find((s) => s.path === rel)?.text ?? null;
    const rows = [
      { id: "curried", test: "tests/loop.test.ts", expectFail: "零行为回退：缺省不开闸（未给 autoVerify） → 无 verify_result、请求数与旧行为同形" },
      { id: "escaped", test: "tests/hooks.test.ts", expectFail: '纯精确名不做子串：matcher "Edit" 不得命中 NotebookEdit' },
      { id: "plain", test: "tests/plain.test.ts", expectFail: "反面对手：不同 callId 的两条 result 绝不合并" },
      { id: "renamed", test: "tests/plain.test.ts", expectFail: "旧标题里那句再也没出现过的一句话" },
    ];
    expect(looseOnlyPointers(rows, read3)).toEqual(["curried", "escaped"]);
    // 反向：同一根指针在 auditExpectFails 那里必须是干净的（两把尺各记各的，不许互相顶账）
    expect(auditExpectFails(rows, read3).map((p) => p.id)).toEqual(["renamed"]);
  });

  it("判卷文件读不到 ⇒ 不进松钉（那一格归 unreadable，松钉计数不许把它吞了）", () => {
    expect(looseOnlyPointers([{ id: "gone", test: "tests/gone.test.ts", expectFail: "任何句子" }], () => null)).toEqual([]);
  });

  it("接线：门自己那一步要真拿整张表去数松钉（只印不数＝这一格永远 0，且永远不红）", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url)), "utf8");
    // 必须用**带真换行的正则**钉，不许用 toContain：这条锚点自己的 apply 里就写着那句文字（转义形式），
    // 任何整段子串断言都会读到表自己 ⇒ 变异把调用改成喂空表之后，那句文字仍躺在文件里，判卷当场失去分辨力（实测存活一次）。
    expect(/const loosePinned = looseOnlyPointers\(pointerEntries,\n\s*\(rel\) =>/.test(src)).toBe(true);
    expect(src).toContain("松钉指针 ${String(loosePinned.length)} 条");
  });

  it(`水位：真表现读松钉只准调低（帽 ${String(LOOSE_CAP)}，09-27 现读 10）——新增一根要写明为什么`, () => {
    const loose = looseOnlyPointers(listAnchorRows(), readRel);
    expect(loose.length, "松钉指针：" + loose.join("、")).toBeLessThanOrEqual(LOOSE_CAP);
    // 帽不许悄悄失效：帽本身必须钉在现读附近（现读掉到帽以下很远处，就该收帽而不是留着一张空帽）
    expect(LOOSE_CAP - loose.length).toBeLessThan(5);
  }, 60_000);

  it("求和那一行必须把第 5 维喂进去（钉接线：少喂一支＝门照跑、汇总照印绿）", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url)), "utf8");
    // 用正则框住**真实的那个调用**，不能只 includes 一行文字：
    // 这条锚点自己的 apply 里也写着那句文字（同一份文件），单行文字判据会连被改掉的那次也读成"还在"。
    expect(/blockingTotalOf\(\{[^}]*expectFail:[^}]*\}\)/s.test(src)).toBe(true);
  });

  it("第 6 维（HEAD 侧指针失效）也要喂进求和，且 runner 真去调那把尺", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url)), "utf8");
    expect(/blockingTotalOf\(\{[^}]*headPointer:[^}]*\}\)/s.test(src)).toBe(true);
    expect(/^\s*headPointers\.push\(\.\.\.headPointerProblems\(/m.test(src)).toBe(true);
  });
});

describe("killerAttributionOk：归因只认失败面（通过的用例那一行不算）", () => {
  // 真事（第 141 页）：`cpp-zero-boundary-ratio-zero` 的针脚落在 `no-usage` 那一支，
  // 真红的是「没有 usage…」，而它声明的「真实红跑：零 verified…」那条**是绿的**——
  // runner 那句 `hit.out.includes(expectFail)` 被 vitest 列出的 `✓` 行满足了 ⇒ 表上照样报 ✅。
  const OUT = [
    " ✓ 真实红跑：零 verified ⇒ 不可测（不是 0 也不是 Infinity），整笔主面就是死跑成本 3ms",
    " × 没有 usage：不可测且原因是 no-usage，不许把「没记账」读成「没花钱」 2ms",
    "",
    "⎯⎯⎯ Failed Tests 1 ⎯⎯⎯",
    " FAIL  tests/cost-per-progress.test.ts > 比值：与分母同面，零前进是不可测 > 没有 usage：不可测且原因是 no-usage，不许把「没记账」读成「没花钱」",
  ].join("\n");

  it("声明的那条只是**通过**了 ⇒ 不算归因（旧判据在这里报真）", () => {
    expect(killerAttributionOk("真实红跑：零 verified ⇒ 不可测（不是 0 也不是 Infinity），整笔主面就是死跑成本", OUT)).toBe(false);
    // 失败面本身也要只剩红的那两条（`✓` 行整行丢掉，否则下一环又把它读回来）
    const face = failingTestText(OUT);
    expect(face.includes("真实红跑：零 verified")).toBe(false);
    expect(face.split("\n").filter((l) => l.includes("没有 usage"))).toHaveLength(2);
  });

  it("红的那条正是声明的那条 ⇒ 认；`FAIL … > 标题` 与 `×` 两种失败面都要认", () => {
    expect(killerAttributionOk("没有 usage：不可测且原因是 no-usage，不许把「没记账」读成「没花钱」", OUT)).toBe(true);
    expect(killerAttributionOk("只有 × 那一面", " × 只有 × 那一面 1ms\n Test Files 1 failed (1)")).toBe(true);
    // 颜色开着也不能瞎（runner 里 TERM=dumb，但别人换 reporter/换环境时这条得跟着成立）
    expect(killerAttributionOk("带颜色的标题", " \u001b[31m×\u001b[39m 带颜色的标题 1ms")).toBe(true);
  });

  it("没声明 killer（空指针）不在这里判——那是静态那把尺点名的另一档", () => {
    expect(killerAttributionOk("", OUT)).toBe(true);
  });

  it("接线：runner 归因那一步真调这把尺，且旧的整串 includes 已经不在", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url)), "utf8");
    // 行首＋行尾锚定：这条锚点自己的 apply 字面量里也写着同一句话（同一个文件），
    // 不加 `$` 的话"真调用被摘掉、字面量还留着"照样读成在（第 138 页那条自指）。
    expect(/^\s*if \(!killerAttributionOk\(m\.expectFail, hit\.out\)\) \{$/m.test(src)).toBe(true);
    expect(src.includes("hit.out.includes(m.expectFail)")).toBe(false);
  });
});

describe("baselineRedKind：基线红要分「载不动」与「真的不绿」", () => {
  // 第 141 页普查里 167/180 条红是判卷 import 不到未入库的模块，被报成「基线就不是全绿（不应发生）」＝阻断，
  // 于是这张表唯一的信号（表退化）被环境噪声淹掉。分诊成未证之后：仍然红（未证就红），但说的是"量不了"。
  it("判卷载不动 ⇒ 未证，且点名是哪个模块", () => {
    const out = "Error: Cannot find module '../providers/capabilities' imported from /repo/src/main/agent-runner.ts";
    expect(baselineRedKind(out)).toEqual({ kind: "unloadable", module: "../providers/capabilities" });
  });

  it("别的原因让基线红（真缺陷）⇒ 仍按阻断，不许把表退化洗成未证", () => {
    expect(baselineRedKind("AssertionError: expected 3 to be 4")).toEqual({ kind: "blocking" });
    // 反向对照：不是"任何错误都算载不动"——缺文件是另一回事（判卷自己被删走的是未跟踪那一维）
    expect(baselineRedKind("Error: ENOENT: no such file or directory, open '/repo/x.ts'")).toEqual({ kind: "blocking" });
  });

  it("接线：基线那一步真调这把分诊尺（不然是拿着读数当结论）", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url)), "utf8");
    expect(/^\s*const kind = baselineRedKind\(base\.out\);$/m.test(src)).toBe(true);
    expect(/^\s*if \(kind\.kind === "unloadable"\) \{$/m.test(src)).toBe(true);
  });
});

describe("mutate-verify 也接了这把锁：占不到就不许动盘（那份过程的第二个消费者）", () => {
  const script = fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url));
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  // 路径**另算一份**（不复用 toolLockPath）：拿被测函数算被测函数读的路径＝那条断言没有观测者。
  // 末段是这棵树自己的目录名（sanitize 后），所以这里也照抄那一步——实现若退回「锁写死在主树 .git」，两边位置分叉，下面当场红。
  const gitCommon = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: repoRoot, encoding: "utf8" }).trim();
  /* 一律带 `--lock-tag=judge-<pid>`：机器的锁名永远是**那棵树的目录名**，而跑锚点时它会 spawn 本文件——
   *  不带标签的话这里写的正是那台机器自己占着的锁，`noForeignLock` 当场喊撞窗 ⇒ 本文件基线红 ⇒ 挂在它上面的几十条锚点一起判「基线就不是全绿」。
   *  （09-28 实测：干净树里 83 条派生名单有 46 条就是这么红的，规则 223「判卷不许拿被度量者自己的状态当输入」的第六次命中。）
   *  带标签后两边永不撞名，而默认那条路（不带标签＝树名）由下面接线判卷钉住。 */
  const TAG = "judge-" + String(process.pid);
  const LOCK_AT = join(resolve(repoRoot, gitCommon), "dsh-tool-locks", "mutate-verify-" + TAG + ".lock");
  const runMv = (args: string[]): { status: number | null; out: string } => {
    const r = spawnSync(process.execPath, ["--import", "tsx", script, "--lock-tag=" + TAG, ...args], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  /* 探锁用**一个不存在的 id**：它会一路走到「未知 id」那支 exit 2，中间一个源文件都不碰。
   * 于是两个 exit 2 在措辞上分得开——抱怨「正被占用」＝锁在管，抱怨「未知 id」＝锁没管。
   * 这比钉源码文字硬一档（规则 239）：拿「必然让下一步失败」的入参跑真子进程，锁没接上就会当场露形。 */
  const BOGUS = ["anchor-id-that-does-not-exist"];
  const readPid = (): number | null | "unreadable" => {
    let raw: string;
    try { raw = readFileSync(LOCK_AT, "utf8"); } catch { return null; }
    try {
      const o = JSON.parse(raw) as unknown;
      const p = (o as { pid?: unknown }).pid;
      return typeof p === "number" ? p : "unreadable";
    } catch { return "unreadable"; } // 文件在但读不出＝第三态，判卷也不许删（同被度量那条纪律）
  };
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  /** 只清自己那一份：活人的锁留给活人，本判卷宁可判红也不抹别人的在飞锁。 */
  const clear = (): void => {
    const pid = readPid();
    if (pid === "unreadable") return;
    if (pid !== null && pid !== process.pid && alive(pid)) return;
    try { unlinkSync(LOCK_AT); } catch { /* 本来就没有 */ }
  };
  const noForeignLock = (): void => {
    const pid = readPid();
    if (pid === "unreadable") throw new Error(`锁面 ${LOCK_AT} 读不出 ⇒ 本判卷要在这上面写，先人工核过再跑（不许自动覆盖）`);
    if (pid !== null && pid !== process.pid && alive(pid)) {
      throw new Error(`撞窗：mutate-verify 正被 pid ${String(pid)} 真跑着 ⇒ 本判卷不许碰共享锁面，也不许把这条跳成绿`);
    }
  };
  const hold = (): void => {
    mkdirSync(dirname(LOCK_AT), { recursive: true });
    writeFileSync(LOCK_AT, JSON.stringify({ tool: "mutate-verify", pid: process.pid, target: "c".repeat(40), tree: repoRoot, startedAt: Date.now() }));
  };

  it("活人占着 ⇒ exit 2、点名是谁、拒在开跑之前，并且不替别人删锁", () => {
    noForeignLock();
    clear();
    hold();
    try {
      const { status, out } = runMv(BOGUS);
      expect(status).toBe(2);
      expect(out).toContain(String(process.pid));
      expect(out).toContain("正被占用");
      expect(out, "拒跑的话没说到锁，只说到 id ⇒ 说明锁那一支根本没拦，这条红来自隔壁支").not.toContain("未知 id");
      expect(out, "抱怨之前已经开跑＝这句拒绝只是给破坏补个说明").not.toContain("变异验证：");
      expect(existsSync(LOCK_AT), "拒跑那一支把别人的锁删了＝一次自愈抹掉别人的在飞锁").toBe(true);
    } finally { clear(); }
  }, 30_000);

  it("反向哨兵：同一入参、没有锁 ⇒ 必须走到「未知 id」，并且占过又放掉（上面那条的红只能来自锁）", () => {
    noForeignLock();
    clear();
    const { status, out } = runMv(BOGUS);
    expect(status).toBe(2);
    expect(out).toContain("未知 id");
    expect(out, "占到锁这件事不出声 ⇒ 凭证里看不出这次是独占还是根本没占（规则 211）").toContain("锁=本进程持有");
    expect(existsSync(LOCK_AT), "跑完没放锁 ⇒ 下一次只能靠 90 分钟的帽自愈").toBe(false);
  }, 30_000);

  it("只读入口不许被这把门锁死：--list／--check-needles 在有人占着时照跑", () => {
    noForeignLock();
    clear();
    hold();
    try {
      const listed = runMv(["--list"]);
      expect(listed.status).toBe(0);
      expect(listed.out).not.toContain("正被占用");
      const rows = (listed.out ?? "").split("\n").filter((l) => l.includes("\t")).length;
      // 分母取**同一张表**的现读（表里的 `id:` 数），不写死水位：09-28 机器里跑的一次读到过 874/918，
      // 而同条命令在 shell 管道里连测 20 次全是 918、把这条锚点的突变落到盘上再数也是 918 ⇒ 成因未定。
      // 写死 `>900` 只会把一次未定读数变成常驻假红；换成相对读数后这一格反而更硬——它成了
      // 「列协议一条都不许丢」（规则 225）在**锁语境下**的观测者，与上面那条真表自证各守一侧。
      const tableSrc = readFileSync(script, "utf8");
      expect(rows, "名单行数不等于表长＝吃 `--list` 的两把静态尺会少读锚点而不自知").toBe((tableSrc.match(/^\s+id: "/gm) ?? []).length);
      const chk = runMv(["--check-needles"]);
      expect(chk.status, "只读体检被锁拒成 exit 2 ⇒ 读的人只会以为门坏了，不会知道有人在跑").not.toBe(2);
      expect(chk.out).not.toContain("正被占用");
    } finally { clear(); }
    expect(existsSync(LOCK_AT), "只读入口自己占了一把锁 ⇒ 两条并发 --list 会互相拒跑，而它一个字节都不改").toBe(false);
    // 这条要跑两次真子进程（一次 `--check-needles` 对 918 条改法做语法体检≈7s），默认 5s 判卷窗口载不动。
  }, 90_000);

  it("接线形状：占锁排在自愈与开跑之前，消费者侧不留第二份三态判断", () => {
    const src = readFileSync(script, "utf8");
    const claim = src.indexOf("\nconst LOCK = acquireToolLock({");
    const startPrint = src.indexOf("\nconsole.log(`变异验证：");
    const heal = src.indexOf("\nhealLeftoverBackups();");
    expect(claim, "整支占锁没接上 ⇒ tool-lock 是个没人调的第二份 lib（第 161 页那把锁的同格）").toBeGreaterThan(-1);
    expect(startPrint, "开跑那句不见了 ⇒ 上面两条按顺序比的读数全失去意义").toBeGreaterThan(claim);
    expect(heal, "自愈会写盘：占锁排在它之后＝「占不到就不许动盘」是空话").toBeGreaterThan(startPrint);
    // 按**行首语句**匹配：这张锚点表就写在同一个文件里，`toContain(那段文字)` 在这儿恒真（规则 236）。
    expect(src, "第二份三态判断＝「占不到就不许动盘」有两个事实源，改一处漏一处").not.toMatch(/(^|\n)[ \t]*if \(decision\.kind === "(?:held|unreadable|reclaim)"\)/);
    // 锁身份的默认值与隔离位都要钉：只钉"占锁"不钉"占的是哪把"，把标签接丢也会全绿（那正是撞回机器自己那把的样子）。
    expect(src, "--lock-tag 算出来却没接进锁身份 ⇒ 判卷写的就是机器自己那把锁").toMatch(/\n\s*tree: lockTagRaw\.given \? lockTagRaw\.value : ROOT,/);
  });

  it("空标签不是「默认」：`--lock-tag=` 与 `--lock-tag \"\"` 一律 exit 2 并说明怎么要默认", () => {
    // 这里**不能**用 runMv：它自己会先带一个合法标签，而取料读的是第一个出现的那对 ⇒ 空标签会被前面的合法值盖掉，
    // 测出来的是"runMv 的默认值有效"，不是"空标签被拒"。裸 spawn 一条，入参就是这条要验的形状。
    const raw = (args: string[]) => {
      const r = spawnSync(process.execPath, ["--import", "tsx", script, ...args], { cwd: repoRoot, encoding: "utf8" });
      return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
    };
    const eq = raw(["--lock-tag=", "--list"]);
    expect(eq.status).toBe(2);
    expect(eq.out).toContain("需要一个标签");
    expect(eq.out, "给了空标签还照常印名单 ⇒ 「带参数」与「没带参数」在输出上没区别").not.toContain("选中锚点");
    const bare = raw(["--lock-tag", "", "--list"]);
    expect(bare.status).toBe(2);
    expect(bare.out).toContain("需要一个标签");
  }, 30_000);
});

describe("印完就退的出口必须同步写：--list 是两把静态尺共同的取料面", () => {
  const src = readFileSync(fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url)), "utf8");
  it("helper 本体按字节写满、四个出口都经它（一次 writeSync 只交得进内核缓冲那一截）", () => {
    expect(src, "helper 不循环写满 ⇒ 长名单被砍掉尾巴：09-28 第一版实测 920 行只剩几百行").toMatch(
      /\nconst emitAndExit = \(text, code\) => \{[\s\S]{0,320}while \(off < buf\.length\) \{[\s\S]{0,220}writeSync\(1, buf, off\);/);
    expect((src.match(/\n\s*emitAndExit\(/g) ?? []).length, "四个同步出口：--list 名单／残留提示／针脚汇总／本次耗时").toBe(4);
  });

  it("真跑：--list 经管道交给读者的行数必须等于表长（少一行＝两把静态尺一起少读一条锚点而不自知）", () => {
    const script = fileURLToPath(new URL("../scripts/mutate-verify.mjs", import.meta.url));
    const r = spawnSync(process.execPath, ["--import", "tsx", script, "--list"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    expect(r.status).toBe(0);
    const rows = (r.stdout ?? "").split("\n").filter((l) => l.includes("\t")).length;
    expect(rows, "行数≠表长＝列协议在生产侧就漏了（不是读者的锅）").toBe((src.match(/^\s+id: "/gm) ?? []).length);
  }, 60_000);
});
