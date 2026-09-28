// 分片并行判卷的合并层（`scripts/lib/shard-plan.ts` + `scripts/mutate-shards.ts`）。
// 这一层的全部风险都在**读数形状**上：一片崩了、一片没跑完、一片红——三件事必须印成不同的字，
// 否则「四份日志里只读到三份」会被读成「三份全绿」（规则 239 的三态）。
// 所以这里的样本**逐字取自真机输出**（第 186 页那一跑的收尾行、第 185 页那一跑的 `REDKINDS=` 行），
// 不是手写得好看的假日志——手写的样本测不出真机器会印什么（规则 237：计数尺先喂真机）。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  groupByHost,
  hostsSplitAcrossShards,
  mergeShards,
  partitionProof,
  planShards,
  rollupLine,
  shardRow,
  splitShards,
  type ShardRow,
} from "../scripts/lib/shard-plan";
import { parseArgs, shardLogPath, treeProblem } from "../scripts/mutate-shards";

/** 真机末段（第 186 页 `--changed-since=be18607`，27 条全杀）——只留判卷要认的那几行，文字与原文一致。 */
const REAL_ALL_KILLED = [
  "变异验证：27 条",
  "✅ mutate-lock-read-only-face-locked — 把只读的 `--list` 也接去占锁 ⇒ …",
  "全部变异被正确杀死（断言非恒真）",
  "[mutate-verify] 本次耗时 32.4s · 跑了 27/27 条 · 未设预算（外层超时会在中途杀我，见 --budget-ms）",
  "成本分母：判卷 spawn 54 次／27 条（每条次数分布 2×27）· 单次中位 第1次 0.4s／第2次 0.4s· 最贵一条 changed-since-list-mode-always-filters 2.9s",
].join("\n");

/** 真机的对照组（第 185 页 `--changed-since=467e9ec`：33 条里 1 条存活）。 */
const REAL_ONE_SURVIVED = [
  "变异验证：33 条",
  "❌ mutate-lock-read-only-face-locked — 把只读的 `--list` 也接去占锁 ⇒ 行为零差异（等价突变）",
  "1 条判红（按类别分开数，修法各不同——见上一行起的分类名单）",
  "REDKINDS=survived:1,misattributed:0,baseline-red:0,no-effect:0,syntax:0,restore-mismatch:0,vacuous:0",
  "[mutate-verify] 本次耗时 37.3s · 跑了 33/33 条 · 未设预算（外层超时会在中途杀我，见 --budget-ms）",
].join("\n");

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ENTRY = join(ROOT, "scripts/mutate-shards.ts");

/** 非零退出时 execFileSync 会抛：把 status 与合并输出取回来，别拿「抛了」当「红了」。 */
function runEntry(args: readonly string[], cwd: string): { status: number; out: string } {
  try {
    const out = execFileSync("node", ["--import", "tsx", ENTRY, ...args], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/** 一个一次性 git 树：用来造「脏树」这一格，不碰本仓任何文件。 */
function tempRepo(withDirtyFile: boolean): string {
  const base = mkdtempSync(join(tmpdir(), "mutate-shards-"));
  const repo = join(base, "repo");
  execFileSync("git", ["init", "-q", repo], { encoding: "utf8" });
  writeFileSync(join(repo, "seed.txt"), "seed");
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"]);
  if (withDirtyFile) writeFileSync(join(repo, "flying.txt"), "in flight");
  return repo;
}

describe("splitShards：分片必须是分割", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `id-${String(i)}`);
  const shards = splitShards(ids, 3);

  it("轮转切分后并起来等于原名单，且不重不漏", () => {
    const flat = shards.flat();
    expect(flat.length).toBe(10);
    expect([...flat].sort()).toEqual([...ids].sort());
    expect(shards.map((s) => s.length)).toEqual([4, 3, 3]);
  });

  it("条数少于片数时**不造空片**：空片会被印成「这一片跑了 0 条且全绿」", () => {
    const two = splitShards(["a", "b"], 5);
    expect(two.length).toBe(2);
    expect(two.some((s) => s.length === 0)).toBe(false);
  });

  it("片数不是正整数 ⇒ 抛，而不是退化成「一片不限」", () => {
    expect(() => splitShards(ids, 0)).toThrow();
    expect(() => splitShards(ids, 1.5)).toThrow();
  });
});

describe("planShards：一个判卷宿主不许跨片（09-29 撞窗实测逼出来的形状）", () => {
  /** 形状取自真表的分布：一个大宿主（head-cert 47 条）＋若干小宿主。 */
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `hc-${String(i)}`, host: "tests/head-cert-deps.test.ts" })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `mv-${String(i)}`, host: "tests/mutate-verify-gates.test.ts" })),
    { id: "s-1", host: "tests/settings.test.ts" },
    { id: "s-2", host: "tests/settings.test.ts" },
    { id: "g-1", host: "tests/goal-continue.test.ts" },
  ];

  it("切成 3 片：不重不漏，且**没有任何宿主被摊到两片**", () => {
    const shards = planShards(rows, 3);
    const flat = shards.flat();
    expect(flat.length).toBe(rows.length);
    expect([...flat].sort()).toEqual(rows.map((r) => r.id).sort());
    expect(hostsSplitAcrossShards(rows, shards)).toEqual([]);
  });

  it("反向对照：轮转切法**会**把同一宿主摊开——所以 `partitionProof` 全绿不等于切法安全", () => {
    const roundRobin = splitShards(rows.map((r) => r.id), 3);
    expect(partitionProof(rows.map((r) => r.id), roundRobin).missing).toEqual([]);
    expect(hostsSplitAcrossShards(rows, roundRobin)).toContain("tests/head-cert-deps.test.ts");
  });

  it("最大宿主单独占得下一片时，片数上限由宿主数决定而不是由请求的片数决定（不造空片）", () => {
    const only = [{ id: "a", host: "h1" }, { id: "b", host: "h2" }];
    const shards = planShards(only, 5);
    expect(shards.length).toBe(2);
    expect(shards.every((s) => s.length > 0)).toBe(true);
  });

  it("groupByHost 保持首次出现顺序，并把同宿主的 id 收成一组", () => {
    const g = groupByHost(rows);
    expect(g.map((x) => x.host)).toEqual([
      "tests/head-cert-deps.test.ts",
      "tests/mutate-verify-gates.test.ts",
      "tests/settings.test.ts",
      "tests/goal-continue.test.ts",
    ]);
    expect(g[0]!.ids.length).toBe(8);
  });
});

describe("partitionProof：把「是不是分割」变成三个数", () => {
  it("少给一条要在 missing 里现身（漏跑是最坏的一类：读者以为整表跑过）", () => {
    expect(partitionProof(["a", "b", "c"], [["a", "b"], ["c"]]).missing).toEqual([]);
    const q = partitionProof(["a", "b", "c"], [["a", "b"], []]);
    expect(q.missing).toEqual(["c"]);
    expect(q.duplicated).toEqual([]);
    expect(q.outside).toEqual([]);
  });

  it("同一条进两片 ⇒ duplicated；分片里冒出名单外的条 ⇒ outside", () => {
    expect(partitionProof(["a", "b"], [["a", "b"], ["b"]]).duplicated).toEqual(["b"]);
    expect(partitionProof(["a"], [["a", "ghost"]]).outside).toEqual(["ghost"]);
  });

  it("counts 是每片条数（与那三个空数组同框读，才是「分掉了」）", () => {
    expect(partitionProof(["a", "b", "c", "d"], [["a", "c"], ["b", "d"]]).counts).toEqual([2, 2]);
  });
});

describe("shardRow：一片的判定只认真机器印的那些字", () => {
  it("真机全杀样本＋退出码 0 ⇒ 已杀死，红行为空、抽取自洽", () => {
    const r = shardRow("/tmp/tree-a", 27, REAL_ALL_KILLED, 0);
    expect(r.verdict).toBe("已杀死");
    expect(r.redIds).toEqual([]);
    expect(r.extractMismatch).toBe(false);
  });

  it("真机存活样本＋退出码 1 ⇒ 存活，id 从 ❌ 行抽出来", () => {
    const r = shardRow("/tmp/tree-b", 33, REAL_ONE_SURVIVED, 1);
    expect(r.verdict).toBe("存活");
    expect(r.redIds).toEqual(["mutate-lock-read-only-face-locked"]);
  });

  it("同一份输出**去掉汇总行** ⇒ 读不出，绝不许读成已杀死", () => {
    const truncated = REAL_ALL_KILLED.split("\n").filter((l) => !l.startsWith("全部变异")).join("\n");
    const r = shardRow("/tmp/tree-c", 27, truncated, 1);
    expect(r.verdict).toBe("读不出");
    expect(r.cause).toBe("no-summary");
  });

  it("没有退出码（被信号杀／没跑完） ⇒ 读不出，成因点名 no-exit-code", () => {
    const r = shardRow("/tmp/tree-d", 27, REAL_ALL_KILLED, null);
    expect(r.verdict).toBe("读不出");
    expect(r.cause).toBe("no-exit-code");
  });

  it("spawn 根本没起来 ⇒ 读不出，成因 spawn（这一片一条都没验过）", () => {
    const r = shardRow("/tmp/tree-e", 27, "", null, "ENOENT");
    expect(r.verdict).toBe("读不出");
    expect(r.cause).toBe("spawn");
  });

  it("红行的严格抽取数与宽松行数不等 ⇒ 标记该片读数不可信", () => {
    const odd = REAL_ONE_SURVIVED + "\n❌ 这行的形状不是『❌ id — 描述』";
    expect(shardRow("/tmp/tree-f", 33, odd, 1).extractMismatch).toBe(true);
  });
});

describe("mergeShards 与 rollupLine：并回来的一句话说清三态", () => {
  const row = (tree: string, given: number, verdict: ShardRow["verdict"], redIds: string[] = []): ShardRow => ({
    tree, given, verdict, cause: "", redIds, extractMismatch: false,
  });

  it("两全绿＋一存活 ⇒ 计数分开、allKilled 假、待处理含那条 id", () => {
    const m = mergeShards([row("a", 10, "已杀死"), row("b", 10, "已杀死"), row("c", 10, "存活", ["x-red"])]);
    expect(m.byVerdict["已杀死"]).toBe(2);
    expect(m.byVerdict["存活"]).toBe(1);
    expect(m.allKilled).toBe(false);
    expect(m.givenTotal).toBe(30);
    expect(m.killedTotal).toBe(20);
    expect(m.actionableIds).toEqual(["x-red"]);
  });

  it("一片读不出 ⇒ 不并进「已杀死」的条数，也不许让整跑退 0", () => {
    const m = mergeShards([row("a", 10, "已杀死"), row("b", 10, "读不出")]);
    expect(m.killedTotal).toBe(10);
    expect(m.givenTotal).toBe(20);
    expect(m.allKilled).toBe(false);
    expect(m.byVerdict["读不出"]).toBe(1);
  });

  it("空片表 ⇒ allKilled 是**假**：一片都没判不等于全杀", () => {
    const m = mergeShards([]);
    expect(m.allKilled).toBe(false);
    expect(m.givenTotal).toBe(0);
    expect(m.killedTotal).toBe(0);
  });

  it("没有串行分母时那句必须说「不报加速比」，不许印 Infinity 或 0", () => {
    const m = mergeShards([row("a", 10, "已杀死")]);
    expect(rollupLine(m, 1, 13, null)).toContain("不报加速比");
    expect(rollupLine(m, 1, 13, 0)).toContain("不报加速比");
  });

  it("有串行分母时按**实测那两个数**给比值（31.0s ÷ 13s ⇒ 2.38×）", () => {
    const m = mergeShards([row("a", 27, "已杀死"), row("b", 27, "已杀死"), row("c", 27, "已杀死"), row("d", 27, "已杀死")]);
    const line = rollupLine(m, 4, 13, 31.0);
    expect(line).toContain("2.38×");
    expect(line).toContain("判定[已杀死:4]");
    expect(line).toContain("交出 108 条");
  });

  it("抽取对不上的片数要印在行里（它让上面那些数全部打折）", () => {
    const bad = row("a", 10, "已杀死");
    const m = mergeShards([{ ...bad, extractMismatch: true }, { ...bad, tree: "b", extractMismatch: true }]);
    expect(rollupLine(m, 2, 5, null)).toContain("2 片的红行抽取对不上");
  });
});

/** 一棵**按构造就干净**的树：判卷不能把「本仓此刻干净」当前提——开发期它一定是脏的，
 *  那会让这两条在提交前红、提交后绿（读数取决于时钟而不是取决于盘）。
 *  `node_modules` 用软链接上，好让子进程里的 `--import tsx` 解析得到。 */
function cleanWorktree(): { path: string; drop: () => void } {
  const base = mkdtempSync(join(tmpdir(), "mutate-shards-wt-"));
  const path = join(base, "wt");
  execFileSync("git", ["-C", ROOT, "worktree", "add", "--detach", path, "HEAD"], { encoding: "utf8" });
  symlinkSync(join(ROOT, "node_modules"), join(path, "node_modules"), "dir");
  return {
    path,
    drop: (): void => {
      try { execFileSync("git", ["-C", ROOT, "worktree", "remove", "--force", path], { encoding: "utf8" }); } catch { /* 已经没了 */ }
      rmSync(base, { recursive: true, force: true });
    },
  };
}

describe("parseArgs：取料坏与拼错 flag 分两格印", () => {
  it("认不出的 flag 进 unknown，flags 为空（不许静默降级成「跑全表」）", () => {
    const p = parseArgs(["--trees=a,b", "--shardz=2"]);
    expect(p.flags).toBeNull();
    expect(p.unknown).toEqual(["--shardz=2"]);
    expect(p.problem).toBe("");
  });

  it("缺 --trees 是「值坏」不是「拼错 flag」⇒ 两格分开", () => {
    const p = parseArgs(["--dry-run"]);
    expect(p.flags).toBeNull();
    expect(p.unknown).toEqual([]);
    expect(p.problem).toContain("--trees");
  });

  it("--budget-ms 给非数 ⇒ problem 点名那一格，unknown 保持为空", () => {
    const p = parseArgs(["--trees=a,b", "--budget-ms=abc"]);
    expect(p.flags).toBeNull();
    expect(p.unknown).toEqual([]);
    expect(p.problem).toContain("budget-ms");
  });

  it("--force-split 只认 host|roundrobin：别的值进「值坏」那一格，不算拼错 flag", () => {
    const p = parseArgs(["--trees=a,b", "--force-split=whatever"]);
    expect(p.flags).toBeNull();
    expect(p.unknown).toEqual([]);
    expect(p.problem).toContain("force-split");
    expect(parseArgs(["--trees=a,b", "--force-split=roundrobin"]).flags?.forceSplit).toBe("roundrobin");
    expect(parseArgs(["--trees=a,b"]).flags?.forceSplit).toBe("host");
  });

  /** 第 189 页现场：我照 `mutate-verify` 那份手册敲 `--budget-ms 480000`（机器**只认空格写法**），
   *  而编排器从前只认连写 ⇒ 自己的入口把自己的参数判成「未知参数」，一条没跑。 */
  it("带值的旗标两种写法收同一个值，且值不许漏成位置 id", () => {
    const spaced = parseArgs(["--trees", "a,b", "--budget-ms", "5000", "--serial-seconds", "31"]);
    expect(spaced.flags?.trees).toEqual(["a", "b"]);
    expect(spaced.flags?.budgetMs).toBe(5000);
    expect(spaced.flags?.serialSeconds).toBe(31);
    expect(spaced.flags?.ids, "空格写法的值被当成锚点 id ⇒ 这一跑会多筛掉一条").toEqual([]);
    const eq = parseArgs(["--trees=a,b", "--budget-ms=5000", "--serial-seconds=31"]);
    expect(eq.flags?.trees).toEqual(["a", "b"]);
    expect(eq.flags?.budgetMs).toBe(5000);
    expect(eq.flags?.serialSeconds).toBe(31);
  });

  it("空格写法后面缺值 ⇒ 点名「后面没有值」，不许退化成 NaN 或「按缺省跑」", () => {
    const p = parseArgs(["--trees=a,b", "--budget-ms"]);
    expect(p.flags).toBeNull();
    expect(p.unknown).toEqual([]);
    expect(p.problem).toContain("后面没有值");
  });

  it("合法参数解析成形状：两棵树＋预算＋串行分母＋位置 id", () => {
    const p = parseArgs(["--trees=a,b", "--budget-ms=5000", "--serial-seconds=31", "id-1", "id-2"]);
    expect(p.flags?.trees).toEqual(["a", "b"]);
    expect(p.flags?.budgetMs).toBe(5000);
    expect(p.flags?.serialSeconds).toBe(31);
    expect(p.flags?.ids).toEqual(["id-1", "id-2"]);
  });
});

describe("treeProblem 与编排器的前置闸：脏树不许当片用", () => {
  it("临时 git 树：干净＝空串，放一个在飞文件＝点名条数", () => {
    const clean = tempRepo(false);
    try {
      expect(treeProblem(clean)).toBe("");
      writeFileSync(join(clean, "flying.txt"), "in flight");
      expect(treeProblem(clean)).toBe("工作树有 1 项在飞");
    } finally {
      rmSync(join(clean, ".."), { recursive: true, force: true });
    }
  });

  it("路径不存在／不是 git 树 ⇒ 两个不同的理由（都是取料坏，不许混成一格）", () => {
    expect(treeProblem("/definitely/not/here/12345")).toBe("目录不存在");
    const base = mkdtempSync(join(tmpdir(), "mutate-shards-plain-"));
    try {
      expect(treeProblem(base)).toBe("不是 git 工作树");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("编排器遇到脏树**一条不跑**：退 2、点名那棵树、且输出里没有「变异验证：」", () => {
    const dirty = tempRepo(true);
    try {
      const r = runEntry([`--trees=${dirty},${ROOT}`], ROOT);
      expect(r.status).toBe(2);
      // 点名到**那一棵**：本仓这棵树此刻可能带着新写的判卷文件（它自己也算在飞），
      // 只断言「有拒跑」会让脏树那一格在被度量面正常时也能绿。
      expect(r.out).toContain("拒跑：" + dirty);
      expect(r.out).toContain("取料坏");
      expect(r.out).not.toContain("变异验证：");
    } finally {
      rmSync(join(dirty, ".."), { recursive: true, force: true });
    }
  });

  it("同一棵树填两遍 ⇒ 拒（同树两个进程会互改源文件、互踩 .mutbak）", () => {
    const r = runEntry([`--trees=${ROOT},${ROOT}`], ROOT);
    expect(r.status).toBe(2);
    expect(r.out).toContain("重复路径");
    expect(r.out).not.toContain("变异验证：");
  });

  it("未知参数 ⇒ 退 2 并给出用法行（不退化成「按缺省跑全表」）", () => {
    const r = runEntry([`--trees=${ROOT}`, "--shardz=2"], ROOT);
    expect(r.status).toBe(2);
    expect(r.out).toContain("用法：node --import tsx scripts/mutate-shards.ts");
  });

  it("给了不在表上的 id ⇒ 拒（退 2、点名那几条、一条没跑）", () => {
    const wt = cleanWorktree();
    try {
      const r = runEntry([`--trees=${wt.path}`, "--dry-run", "this-anchor-does-not-exist"], wt.path);
      expect(r.status).toBe(2);
      expect(r.out).toContain("不在这张表上的 id");
      expect(r.out).not.toContain("只出计划");
    } finally { wt.drop(); }
  });

  it("--dry-run 只出计划：取料走机器自己的 `--list`，证分割与「不拆宿主」都成立，一条没跑", () => {
    const wt = cleanWorktree();
    try {
      const r = runEntry([`--trees=${wt.path}`, "--dry-run"], wt.path);
      expect(r.status).toBe(0);
      expect(r.out).toMatch(/名单 \d+ 条 → 1 片/);
      expect(r.out).toContain("只出计划，一条没跑");
      expect(r.out).not.toContain("变异验证：");
    } finally { wt.drop(); }
  });

  /** 观察输入（`--force-split=roundrobin`）存在的全部理由：这条守卫从前只有文字钉，
   *  把 `if (split.length > 0)` 改成 `if (false)` 时那条文字钉**照绿**（正则里那两行还在），
   *  实测「变异存活：测试全绿」——与第 186 页同一次课：存活不是没人守，是这个形状没有可达的输入。 */
  it("同一宿主被摊到两片 ⇒ 行为上当场拒（默认切法同输入放行）", () => {
    const one = cleanWorktree();
    const two = cleanWorktree();
    try {
      // 三条**同宿主**的 id：轮转必把它们拆开，按宿主成组必把它们放在一起。
      const trio = ["shard-plan-missing-hardcoded", "shard-merge-unreadable-as-killed", "shard-speed-null-guard-dropped"];
      const bad = runEntry([`--trees=${one.path},${two.path}`, "--dry-run", "--force-split=roundrobin", ...trio], one.path);
      expect(bad.status).toBe(2);
      expect(bad.out).toContain("被摊到两片以上");
      expect(bad.out).not.toContain("只出计划");
      const good = runEntry([`--trees=${one.path},${two.path}`, "--dry-run", ...trio], one.path);
      expect(good.status).toBe(0);
      expect(good.out).toContain("切法=host");
      expect(good.out).toContain("只出计划，一条没跑");
    } finally {
      one.drop();
      two.drop();
    }
  });
});

describe("编排器接线：合并层不是挂在墙上的仪表", () => {
  const src = readFileSync(ENTRY, "utf8");

  it("每片的原文落到**读者拿得到的路径**，且那片行里印出该路径（这一页就是靠它才看清「片绿而判定红」）", () => {
    const p0 = shardLogPath("judge-x", 0);
    const p1 = shardLogPath("judge-x", 1);
    expect(p0).toContain("mutate-shards-judge-x-0.log");
    expect(p0).not.toBe(p1);
    expect(src).toMatch(/原文=\$\{logs\[i\]\}/u);
    expect(src).toMatch(/writeFileSync\(p, raw\[i\]!\.stdout/u);
  });

  it("分片自检的结论**决定跑不跑**：非空即退 2，一条不跑", () => {
    expect(src).toMatch(/const proof = partitionProof\(ids, shards\);[\s\S]{0,600}process\.exitCode = 2;/u);
  });

  it("「同一宿主不许跨片」也接在闸上：非空即退 2（这一格是 head-cert 撞窗实测换来的）", () => {
    expect(src).toMatch(/const split = hostsSplitAcrossShards\(rows, shards\);[\s\S]{0,400}process\.exitCode = 2;/u);
  });

  it("每片都过 shardRow，且把它**被交出的条数**与退出码一起喂进去", () => {
    expect(src).toMatch(/shardRow\([^;]*shards\[i\]!\.length,[^;]*r\.stdout,[^;]*r\.status,[^;]*r\.spawnError\)/u);
  });

  it("退出码由合并结果决定（allKilled／抽取不符），不许写死", () => {
    expect(src).toMatch(/process\.exitCode = m\.mismatchShards > 0 \|\| shardRows\.some\(\(r\) => r\.verdict === "读不出"\) \? 2 : 1;/u);
    expect(src).toMatch(/process\.exitCode = m\.mismatchShards > 0 \? 2 : 0;/u);
  });
});
