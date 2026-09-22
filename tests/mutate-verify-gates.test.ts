// 变异验证器的"可判性闸门"：把「并发在飞」与「变异表退化」分成两种信号。
// 动因（2026-09-19 实跑）：另一会话正在改判卷测试文件时，本门把两条正常条目报成
// 「基线就不是全绿」+「变异存活」——真回归信号被并发噪声伪装掉了。
import { describe, expect, it } from "vitest";
import { entryDisposition, leftoverBackupPaths, preflightRefusals, splitRunnable, type HeadState } from "../scripts/lib/mutate-gates";

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
