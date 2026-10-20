/** 共享写点上的**工具锁**（一把树只能有一个会改盘的进程在跑）——纯函数层，两个消费者共用：
 *  `scripts/head-cert.ts`（`checkout --detach` 会替别人把那棵认证树切走）与
 *  `scripts/mutate-verify.mjs`（就地改源文件；两个实例并发时，第二个的"残留备份自愈"会把第一个的在飞备份判成可恢复）。
 *
 *  为什么不各写一份（第十三族「收成一份」）：两侧要判的是同一件事——**谁能占这个位置**，
 *  差异只在"帽多长"（认证一棵树 2.5–4 分钟 vs 整张变异表实测 33.4 分钟），所以帽按工具分档，其余共用。
 *  本层不碰盘、不起进程：取料（读锁文件、探活 pid）由调用方注入，判卷因此能造"活着/死了/坏 JSON"三种形状。
 *
 *  锁文件放在 git **common dir** 下（不是 git dir）：linked worktree 各自的 `.git` 是个文件，
 *  把锁关进单棵树就等于没有——"共享写点"要跨 worktree 才看得见；且它不出现在 `git status` 里，不会被误提交。
 *
 *  分层：`toolLockPath`/`parseToolLock`/`decideToolLock`/`shouldReleaseLock` 是**纯判据**，不碰盘、不起进程，
 *  取料（锁原文、pid 探活）由参数注入 ⇒ 判卷能造"活着/死了/坏 JSON"三种形状；
 *  `acquireToolLock` 是本层唯一的取料+落盘过程，两个消费者共用它（理由写在那一节）。 */

import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

/** 一把锁的持有者登记（`<common>/dsh-tool-locks/<工具>-<树名>.lock`）。 */
export interface ToolLock { tool: string; pid: number; target: string; tree: string; startedAt: number; }

/** 锁目录名（判卷**故意另写一份字面**：改名时要被行为用例抓到，而不是跟着一起漂）。 */
export const LOCK_DIR_NAME = "dsh-tool-locks";
/** 「未登记帽」的成因前缀（判卷与生产共用这一份拼法；测试不再抄字面量）。 */
export const UNREGISTERED_CAP_REASON = "没有登记";

/** 帽按工具分档：**宁可让下一次等，不可让下一次抢**。
 *  · `head-cert` 一棵树实测 2.5–4 分钟（含全量判卷）⇒ 30 分钟已经很宽；
 *  · `mutate-verify` 整表实测 **2005.7s ≈ 33.4 分钟**（905 条 @`050e765`）⇒ 90 分钟。
 *  共用一个 30 分钟的帽的后果不是"锁不释放"，而是**第二个实例会在整跑到一半时把我活着的那把锁按证据回收掉**
 *  （pid 还活着，但"不该跑这么久"这条推理在变异机上不成立）。所以新工具接入时必须在这里登记一档，
 *  取不到档 ⇒ 回 null ⇒ 调用方不许猜（猜出来的帽就是把别人的锁抢走）。 */
export const LOCK_AGE_CAP_MS: Readonly<Record<string, number>> = {
  "head-cert": 30 * 60_000,
  "mutate-verify": 90 * 60_000,
};

/** 取某个工具的帽；未登记 ⇒ null（**不猜**：回一个"看起来合理"的默认值，等于给新工具发一把会抢活人锁的帽）。 */
export function lockAgeCap(tool: string): number | null {
  return LOCK_AGE_CAP_MS[tool] ?? null;
}

/** 锁文件路径。`commonDirOut` 来自 `git rev-parse --git-common-dir`：主 worktree 给相对 `.git`、
 *  linked worktree 给**绝对路径** ⇒ 必须按 resolve 语义拼。用 `join(root, common)` 会把绝对路径接在 root
 *  后面（`<root>//Users/…/.git`），于是每棵树各算一份锁面 ⇒ 锁**看起来在工作**（自己占、自己放），
 *  而别人永远看不见 ⇒ 撞窗退回原样。判卷拿绝对／相对两种输入各钉一次。
 *
 *  树名可来自命令行：先取末段再剥非安全字符，否则 `--tree=../../x` 能把锁写到仓外。
 *  回 null＝**锁面取不到**：调用方要出声，但不许据此拒跑（这道门不许依赖锁文件存在，判卷有反向哨兵）。 */
export function toolLockPath(commonDirOut: string, root: string, tool: string, tree: string): string | null {
  const common = commonDirOut.trim();
  if (common === "") return null;
  const name = basename(tree).replace(/[^A-Za-z0-9._-]/g, "_");
  // 这三样拼进路径＝锁面落到仓外或隔壁目录（`--tree=../../x` 由上一行的「只取末段」挡掉，这里挡的是末段本身就是点）。
  if (name === "" || name === "." || name === "..") return null;
  const leaf = sanitize(tool) + "-" + name;
  return resolve(root, common, LOCK_DIR_NAME, leaf + ".lock");
}

const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");

/** 锁文件内容 → 结构。坏 JSON／缺字段一律回 null（**不猜**：猜出来的 pid 会把活人的锁抢走）。 */
export function parseToolLock(text: string | null): ToolLock | null {
  if (text === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; } catch { return null; }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.tool !== "string" || o.tool === "") return null;
  if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) return null;
  if (typeof o.target !== "string" || typeof o.tree !== "string" || typeof o.startedAt !== "number") return null;
  return { tool: o.tool, pid: o.pid, target: o.target, tree: o.tree, startedAt: o.startedAt };
}

export type LockDecision =
  | { kind: "free" }
  /** 有文件但读不出 ⇒ 既不能当"没锁"覆盖，也不能当"有锁"死等：这是第三态，要人看一眼。 */
  | { kind: "unreadable"; path: string }
  | { kind: "held"; by: ToolLock; reason: string }
  | { kind: "reclaim"; by: ToolLock | null; reason: string };

/** 能不能占这个位置。`alive` 注入是为了判卷能造"pid 死了/活着"两种形状；
 *  **生产侧必须传真探活**（`process.kill(pid, 0)`）——由接线判卷钉住，否则接缝自己变成一条恒真的洞。 */
export function decideToolLock(input: {
  path: string;
  text: string | null;
  now: number;
  selfPid: number;
  alive: (pid: number) => boolean;
  maxAgeMs: number | null;
}): LockDecision {
  if (input.text === null) return { kind: "free" };
  const by = parseToolLock(input.text);
  if (by === null) return { kind: "unreadable", path: input.path };
  if (input.maxAgeMs === null) {
    return { kind: "held", by, reason: `${UNREGISTERED_CAP_REASON} ${by.tool} 这一档的帽 ⇒ 不敢据此回收（猜出来的帽会把活人的锁抢走）；pid ${String(by.pid)} 持有 ${by.tree}` };
  }
  const cap = input.maxAgeMs;
  if (by.pid === input.selfPid) return { kind: "reclaim", by, reason: `pid ${String(by.pid)} 就是本进程（上一次留下的）` };
  if (!input.alive(by.pid)) return { kind: "reclaim", by, reason: `持有者 pid ${String(by.pid)} 已不在 ⇒ 崩溃残留，按证据回收` };
  const age = input.now - by.startedAt;
  if (age > cap) {
    return { kind: "reclaim", by, reason: `持有已 ${String(Math.floor(age / 60_000))} 分钟，超过帽（${by.tool} 的帽是 ${String(cap / 60_000)} 分钟；pid 还活着，但这个工具不该跑这么久）` };
  }
  return {
    kind: "held",
    by,
    reason: `pid ${String(by.pid)} 正在跑 ${by.tool}（目标 ${by.target.slice(0, 7)}，已 ${String(Math.max(0, Math.floor(age / 1000)))}s）⇒ 抢它会替别人改盘`,
  };
}

/** 放锁要认身份：**只有自己的锁才删**。不看身份就 unlink，等于把别人的在飞锁抹掉
 *  （同 `mutate-verify` 那条"备份落盘后别人改了同一份文件"的纪律，与规则 232 同源）。 */
export function shouldReleaseLock(text: string | null, selfPid: number): boolean {
  const by = parseToolLock(text);
  return by !== null && by.pid === selfPid;
}

/** 真探活：`kill(pid, 0)` 只问存在。EPERM＝存在但不是我的进程 ⇒ **算活着**
 *  （按"宁可让下一次等，不可让下一次抢"，判错了只能是多等，不能是抢走别人的锁）。 */
const pidAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
};

/** 占锁的唯一过程：读锁 → 判三态 → **占不到就 exit 2（此刻一个字节都还没改）** → 摘掉判定不能用的旧锁
 *  → `link` 原子抢占 → 注册「按身份放锁」。回 `{lockPath, cell}`，`cell` 是给汇总行直接印的那一格。
 *
 *  为什么收成一份而不是两个消费者各抄一遍（第十三族）：这一串里每一条分支都是踩过坑换来的——
 *  不先摘陈旧锁 ⇒ 抢占那次 `link` 必 EEXIST，读起来还像"正被人抢着占"（第 161 页实测）；
 *  用 `rename` ⇒ 会**替换**别人的锁，两个同时启动的进程都以为占到了；
 *  放锁不核身份 ⇒ 抹掉别人的在飞锁。抄第二份就是让这些坑各复活一次，而第二份没有判卷看着。
 *
 *  `harm` 由调用方给：抢了这棵树会发生什么，两侧语义不同（切走别人的树 vs 替别人改盘），
 *  这句话是出口文案不是判据，所以留在消费者侧；判卷两侧各钉一次。 */
export function acquireToolLock(input: {
  tool: string;
  root: string;
  tree: string;
  target: string;
  commonDirOut: string;
  harm: string;
  say: (line: string) => void;
}): { lockPath: string | null; cell: string } {
  const lockPath = toolLockPath(input.commonDirOut, input.root, input.tool, input.tree);
  if (lockPath === null) {
    return { lockPath: null, cell: "未采（锁面未取：git 读不到 common dir ⇒ 本次不占锁，撞窗只由「并发判卷」那一格说话）" };
  }
  /** 锁文件 → 原文。null＝没有锁；**空串＝文件在但读不出**（权限／设备），这两态在 `decideToolLock` 里是分开的。 */
  const read = (): string | null => {
    try { return readFileSync(lockPath, "utf8"); }
    catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? null : ""; }
  };
  const decision = decideToolLock({ path: lockPath, text: read(), now: Date.now(), maxAgeMs: lockAgeCap(input.tool), selfPid: process.pid, alive: pidAlive });
  if (decision.kind === "held") {
    console.error(`❌ ${input.tree} 正被占用：${decision.reason}`);
    console.error(`   ${input.harm}。等它跑完，或换一个写入位置。`);
    process.exit(2);
  }
  if (decision.kind === "unreadable") {
    console.error(`❌ 锁文件在但读不出：${decision.path}`);
    console.error("   不当「没人占」覆盖掉（可能正有人用），也不当「有人占」死等 ⇒ 这一眼要人看：核过内容后手工删掉该文件。");
    process.exit(2);
  }
  if (decision.kind === "reclaim") {
    input.say(`♻️ 回收一把不能用的锁：${decision.reason}`);
    // 不先摘掉旧锁，下面那次 `link` 必然 EEXIST ⇒ 陈旧锁永远回收不了，读起来还像"正被人抢着占"。
    // 这里只摘**已经判定不能用的**那一把（pid 死了／超过帽／是自己留下的），活人的锁在上面就 exit 2 了。
    try { unlinkSync(lockPath); } catch { /* 别人先摘了也算回收成功 */ }
  }
  mkdirSync(dirname(lockPath), { recursive: true });
  const tmp = lockPath + "." + String(process.pid) + ".tmp";
  const mine: ToolLock = { tool: input.tool, pid: process.pid, target: input.target, tree: input.tree, startedAt: Date.now() };
  /* 临时名必须**由我新建**（`flag: "wx"`）：缺省写法会跟随一个已经在那里的名字——同用户的另一个进程先把
   *  `<lock>.<我的pid>.tmp` 做成指向别处的符号链接，我这一写就写到链接那头去了（最小权限那条：
   *  只写自己新起的名字，不写"碰巧在那儿的名字"）。`EEXIST`＝上一轮自己留的残骸（pid 是我的），摘掉重写一次。 */
  const WX: { flag: string } = { flag: "wx" };
  const writeFresh = (): void => {
    try { writeFileSync(tmp, JSON.stringify(mine), WX); }
    catch (e) {
      if (String((e as NodeJS.ErrnoException).code) !== "EEXIST") throw e;
      unlinkSync(tmp);
      writeFileSync(tmp, JSON.stringify(mine), WX);
    }
  };
  writeFresh();
  // 内容先完整落到临时名，再用 `link` 占位：`rename` 会**替换**别人的锁（两个同时启动的进程各自都以为占到了），
  // `link` 在目标已存在时直接 EEXIST ⇒ 抢占是原子的，而半截 JSON 那一坑（读侧要拒跑）也留不出来。
  try {
    linkSync(tmp, lockPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
      input.say(`⚠️ 锁写不下去（${String((e as NodeJS.ErrnoException).code)}）⇒ 本次不占锁，撞窗只由「并发判卷」那一格说话`);
      try { unlinkSync(tmp); } catch { /* 临时名已经不在了 */ }
      return { lockPath: null, cell: `未占（锁写不下去：${String((e as NodeJS.ErrnoException).code)}）` };
    }
    console.error(`❌ 就在刚才 ${input.tree} 被别人占走了（${lockPath} 已存在）⇒ 本次不动它`);
    unlinkSync(tmp);
    process.exit(2);
  }
  unlinkSync(tmp);
  process.on("exit", () => {
    // 身份复核：文件里的持有者不是本进程 ⇒ 已经被别人回收过，删它就是抹掉别人的锁
    const now = (() => { try { return readFileSync(lockPath, "utf8"); } catch { return null; } })();
    if (now === null) return;
    if (shouldReleaseLock(now, process.pid)) { try { unlinkSync(lockPath); } catch { /* 收尾不掷 */ } }
    else input.say(`⚠️ 锁没放：文件里的持有者不是本进程 ${String(process.pid)}（${lockPath}）⇒ 不替别人删`);
  });
  return { lockPath, cell: `本进程持有（${lockPath.replace(input.root + "/", "")}）` };
}
