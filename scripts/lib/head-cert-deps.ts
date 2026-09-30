/** 「去认证一棵树之前，它的依赖配不配得上那棵树」——纯函数，供 `tests/head-cert-deps.test.ts` 消费。
 *  不碰盘、不起进程：取料（`git show <rev>:package.json`、`ls node_modules`）由调用方做。
 *
 * 为什么单独一层（第 84 页实踩两次）：隔离 worktree 的 `node_modules` 通常是从**主树**硬链接来的，
 * 而主树的依赖集反映的是**未提交**的那笔改动（core-only 迁移把 `electron` 摘了）。
 * 拿它去认证仍然含桌面层的 HEAD，`tsc` 直接 `TS2307: Cannot find module 'electron'`——
 * 这是**环境假红**，很容易被读成"HEAD 本来就红"（与规则 87/103 同族：软链树对 `run_shell` 面造假红、
 * 新装树没有 `electron/dist` 的 ENOENT 不是代码红）。所以认证的第一步是核依赖集，不是跑门。 */

import { dirname, resolve } from "node:path";

/** HEAD（或任意 rev）里声明的依赖名：`dependencies` + `devDependencies` + `optionalDependencies`。
 *  `peerDependencies` 不算：npm/pnpm 对它可以真的不装，报出来是噪声。 */
export function declaredDeps(pkgJsonText: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(pkgJsonText) as unknown; } catch { return []; }
  if (typeof parsed !== "object" || parsed === null) return [];
  const pkg = parsed as Record<string, unknown>;
  const out = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const map = pkg[field];
    if (typeof map !== "object" || map === null) continue;
    for (const name of Object.keys(map as Record<string, unknown>)) out.add(name);
  }
  return [...out].sort();
}

/** 盘上真装了什么。**入参是"包名"清单**：作用域包必须由取料方展开成 `@scope/name`
 *  （`readdirSync(node_modules)` 只会给到 `@scope` 那一层，不展开就会把每个 `@types/*` 都误报成缺失）。
 *  这里只过滤非包条目（`.bin`、`.package-lock.json`、`.modules.yaml` 等以点开头的）。 */
export function installedDeps(entries: readonly string[]): string[] {
  const out = entries.filter((e) => e !== "" && !e.startsWith(".") && !e.endsWith("/"));
  return [...new Set(out)].sort();
}

/** 声明了而没装的那些——**认证前必须先清掉**，否则后面每一条红都归因不清。
 *  反向一侧也要求：只装不声明（别的会话留在树上的）不算缺失，本函数不许报。 */
export function missingDeclaredDeps(pkgJsonText: string, topLevelEntries: readonly string[]): string[] {
  const installed = new Set(installedDeps(topLevelEntries));
  return declaredDeps(pkgJsonText).filter((d) => !installed.has(d));
}

/** 认证**等级**：`--skip-test` 只跑 typecheck，它不等于"这棵树的全量绿"。
 *
 * 为什么要做成判据而不是注释（都是实跑撞到的）：`--skip-test` 的退出码以前与完整认证**一模一样是 0**，
 * 汇总行也只写一句括号里的「（--skip-test：本次没跑全量）」。第 116 页有人（我）拿着它的 exit 0
 * 在进度页上写"同 HEAD 隔离树跑过"，而它根本没跑全量 —— 于是 HEAD 上那盏已红 86 笔的灯又躲过一轮。
 * 本仓的老规矩在这儿同样成立：**汇总行与退出码是两个数**，一个能冒充另一个的凭据面就是假绿源。
 *
 * 两条收紧：① `--skip-test` 必须配 `--why=<非空>`，把"为什么这次不跑全量"逼成文字（下一轮读者看得见）；
 * ② 等级要印出来，且**半把尺不许叫认证**。 */
export function certLevel(skipTest: boolean, why: string): { level: "full" | "half"; ok: boolean; label: string } {
  if (!skipTest) return { level: "full", ok: true, label: "完整（typecheck ＋ 全量）" };
  const reason = why.trim();
  if (reason === "") {
    return { level: "half", ok: false, label: "半把尺（--skip-test 必须配 --why=<为什么不跑全量>）" };
  }
  return { level: "half", ok: true, label: "半把尺：只 typecheck ⇒ **不构成这棵树的全量绿**｜原因：" + reason };
}

/** 门表在**被认证那一笔**上完不完整：`GATES` 列了、而那笔的 package.json 没有同名 script ⇒ 这道门一 spawn 就失败。
 *
 *  动因（第 136 页）。想登记第 24 道门时被提交前的归属检查拦下，顺手才看见：HEAD 的门表 37 道里
 *  **11 道连 script 都没有**（桌面层迁移把门留在表里、把 script 摘了，两边分在两笔里）⇒「整表绿」在那一笔上
 *  根本不可能成立，而**这件事没有任何观察者**：`gate-check` 拿盘上那份 manifest 比盘上那份 package.json，
 *  两边一起漂就一起绿。
 *  我自己还先踩了一次口径坑：拿**盘上**已裁剪的 26 条去比 **HEAD** 的 scripts ⇒ 读出「一条不缺」。
 *  ⇒ 判据两头都必须来自同一个 rev，所以这里吃**文本**，绝不吃 import 进来的活数组。
 *
 *  三态（规则 92）：任一输入没取到、或数组读不出来 ⇒ `null`＝**没取到**，不等于"门表完整"。 */
export function headGateTableIntegrity(manifestSrc: string | null, pkgJsonText: string | null): { gates: string[]; withoutScript: string[] } | null {
  if (manifestSrc === null || pkgJsonText === null) return null;
  const body = /export const GATES[\s\S]*?=\s*\[([\s\S]*?)\n\]/.exec(manifestSrc)?.[1];
  if (body === undefined) return null;
  // 只认"整行就是一个带引号的名字（可带行尾注释）"：注释里出现的引号词不许算门（第 125 页 `from "…"` 那一族同一个病），
  // 而真门名后面跟人写的行尾说明必须照样收（漏一条＝静默少一位观察者）。
  const gates = [...new Set(body.split("\n")
    .map((l) => /^\s*["']([^"']+)["']\s*,?\s*(?:\/\/.*)?$/.exec(l)?.[1])
    .filter((n): n is string => n !== undefined))];
  // 读得出数组却一条门都没收到 ⇒ 这是**取料形状变了**（例如整表写成一行的排版），不是"门表空"。
  // 空面与没取到同处置（空载棘轮那一族，规则 129/196）：0 道门、0 条缺失读起来比"红"更像"绿"。
  if (gates.length === 0) return null;
  let scripts: Set<string>;
  try {
    const pkg = JSON.parse(pkgJsonText) as { scripts?: Record<string, unknown> };
    scripts = new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    return null;
  }
  return { gates, withoutScript: gates.filter((g) => !scripts.has(g)) };
}

/** 一棵树里**需要各自装依赖**的目录（根 ＋ 每个自带 `package.json` 的子仓库），返回相对根的路径。
 *
 * 为什么要有这一层（2026-09-27 实测，第一次在干净 HEAD 上跑全量判卷）：
 * `head-cert` 只把**根** `node_modules` 硬链接进隔离树，而 `fixtures/todo-app` 这类**靶子仓库**
 * 是被判卷拿去真跑命令的（`gated-tools` 的 run_shell、`runner-gates` 的 verify 拍都在它里面执行）。
 * 它的 `node_modules` 由 `.gitignore` 排除 ⇒ 干净树里没有 ⇒ 那两条判卷在 HEAD 上**必红**，
 * 而红的是环境不是代码（规则 87/103/227 那一族在"整表"面上的形状：不分开记，HEAD 的账就永远说不清）。
 *
 * 取料＝盘上目录树，由调用方注入 `list`（本层不碰盘，与同文件其余纯函数同纪律）；
 * **不写死 `fixtures/todo-app` 这个名字**——别人再加一个靶子仓库时自动跟上（挂现状不挂手抄表）。 */
export function depDirs(list: (rel: string) => { name: string; dir: boolean }[], maxDepth = 3): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number): void => {
    const entries = list(rel);
    if (entries.some((e) => !e.dir && e.name === "package.json")) out.push(rel);
    if (depth >= maxDepth) return;
    for (const e of entries) {
      // `node_modules` 里每个包都有自己的 package.json：跟进去就会把整棵依赖图当成靶子仓库
      if (!e.dir || e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(rel === "" ? e.name : rel + "/" + e.name, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

/** 收尾复核：跑完之后那棵树还在不在**同一笔**上。
 *  为什么单独抽出来：认证树是共享目录里的一棵树，另一个会话（或另一条门）可以在判卷跑到一半时
 *  把它 `checkout` 走——切树时我核过 rev，但**那一次复核管不到这 90 秒里发生的事**。
 *  读数作废与判卷有红是两件事：这里不许把它算成"HEAD 红了"（假红），也不许当"绿"放过（假绿），
 *  只能是第三种：这一把尺没量到东西（规则 92 的三态）。 */
export function readInvalidated(afterRev: string | null, target: string): string | null {
  if (afterRev === null) return "收尾复核没跑起来（git 读不到那棵树）⇒ 本次读数不可归因于代码，也不能算已认证";
  const got = afterRev.trim();
  if (got === target) return null;
  return `跑完复核：那棵树现在是 ${got.slice(0, 7)}，认证目标是 ${target.slice(0, 7)} ⇒ 中途被切走，本次读数作废（谁在用同一棵树？）`;
}

/** 一行的命令字段是不是"在跑本仓的 vitest 判卷"。**按记号认，不按字面串的顺序认**。
 *
 *  为什么不写成一条字面量 `vitest.mjs run --config tests/vitest.config.ts`：09-27 真机抓的现行是
 *  `…/node /…/vitest/vitest.mjs run --pool=threads --config tests/vitest.config.ts tests`
 *  ——变异机在 `run` 与 `--config` **中间**插了 `--pool`，字面串直接不匹配，于是"明明有人在跑"读成 0 套。
 *  这格读数是 0 的话比读错更糟：它会让人**排除掉一个真实存在的撞窗**。 */
const WATCHER_SHAPE = /(^|\s)(pgrep|grep)(\s|$)/;
const SUITE_BIN_SHAPE = /(^|\s)\/?\S*vitest\.mjs(?=\s|$)/;
const RUN_SHAPE = /\brun\b/;
const CONFIG_SHAPE = /(^|\s)--config(\s|$)/;
const NUMERIC_SHAPE = /^\d+$/;

function isJudgeSuiteLine(line: string): boolean {
  if (WATCHER_SHAPE.test(line)) return false; // 看门的那行自己带着同样的字面（今天我就写了这么一条等窗循环）
  return SUITE_BIN_SHAPE.test(line) && RUN_SHAPE.test(line) && CONFIG_SHAPE.test(line);
}

/** 同一时刻有几套全量判卷在跑（`ps -eo pid,pgid,command` 原文 → 套数；-1＝取不到）。
 *  这里数的是"套"而不是"进程"：变异机一轮判卷会连续起几十个 vitest 进程，但它们同属一个 pgid，
 *  对本格的危险（两套判卷共享 /tmp）而言那是一路。
 *
 *  为什么按 **pgid 去重**：一次判卷在 `ps` 里通常留**两行**——外层 shell 的 `-c '… node …vitest.mjs run…'`
 *  把它自己那份命令行也写全了，加上真正的 node 子进程。按行计数会把一套数成两套（09-27 实测的 ps 输出就是这样），
 *  而"两套"和"一套"在这格里的含义完全不同：前者是真撞窗，后者只是我自己。
 *
 *  为什么"取不到"要回 -1 而不是 0：这是文本尺的老假绿路（规则 222）——把"没量到"读成"量到且为 0"，
 *  于是撞窗的红从此查不出来，还自以为排除了。 */
export function countConcurrentSuites(psOut: string | null): number {
  if (psOut === null || psOut.trim() === "") return -1;
  const groups = new Set<string>();
  for (const line of psOut.split("\n")) {
    if (!isJudgeSuiteLine(line)) continue;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2 || !NUMERIC_SHAPE.test(cols[1])) return -1;
    groups.add(cols[1]);
  }
  return groups.size;
}

/** 撞窗红该说的那句话：绿的时候这格只是背景，红的时候它是**归因方向**。
 *  刻意不改退出码——别的会话在跑不是我这笔代码错，接进退出码等于把这道门变成共享树上的随机红。 */
export function collisionHint(testStatus: number | null, before: number, after: number): string | null {
  if (testStatus === null || testStatus === 0) return null;
  const peaked = Math.max(before, after);
  if (peaked <= 0) return null;
  return `判卷有红，且两端采到 ${String(peaked)} 套判卷并行 ⇒ 先排撞窗再查代码（判卷面有写共享 /tmp 的用例，两套并行会互踩出假红；本次读数不是独占跑的）`;
}

/** 汇总行那一格。**三种"没数"要分列印**，不许都写成 0：未采（本次没跑判卷）／取不到（ps 坏了）／采到 0 套（真独占）。
 *  把它们混成一个 0，就是"把没量到读成量过且没问题"（规则 222 的文本尺老形状）。 */
export function concurrencyReading(before: number, after: number, judged: boolean): string {
  if (!judged) return "并发判卷=未采（本次没跑全量判卷，撞窗与否无从谈起）";
  if (before < 0 || after < 0) return "并发判卷=取不到（ps 没跑起来 ⇒ 撞窗无从判定，这一格不许读成 0）";
  return `并发判卷=起前 ${String(before)} 套／跑完 ${String(after)} 套${Math.max(before, after) > 0 ? "（撞窗：本仓判卷有读写共享 /tmp 的用例）" : "（两端独占）"}`;
}

/** 本脚本认的开关（`--x=v` 形式）与裸 flag。**只此一表**：新增开关不在这儿登记，就等于给自己留一条"拼错也照跑"的路。 */
export const CERT_OPTS: readonly string[] = ["at", "tree", "why"];
export const CERT_FLAGS: readonly string[] = ["skip-test", "no-borrow"];

/** 不认识的 `--…` 参数。为什么要拒绝而不是忽略：09-27 实测 `--tre=.worktrees/nope` 被静默丢掉，
 *  脚本转而去**建默认那棵共享树**并跑完 typecheck——操作者以为在认证自己指定的那棵，读数是另一棵的。
 *  拼错的开关在 CLI 上属于"操作者意图丢了"，这类只能 fail-closed（与 `--skip-test` 缺 `--why` 就 exit 2 同一档）。 */
export function unknownCertArgs(argv: readonly string[]): string[] {
  return argv.filter((a) => {
    if (!a.startsWith("--")) return false;
    const eq = a.indexOf("=");
    const name = (eq === -1 ? a.slice(2) : a.slice(2, eq)).trim();
    if (name === "") return true;
    return !CERT_OPTS.includes(name) && !CERT_FLAGS.includes(name);
  });
}

/* ---- 共享写点上的锁：已挪到 `scripts/lib/tool-lock.ts`（第 161 页为 head-cert 建，第 162 页起 mutate-verify 共用）。
 *      放在这里 = 第二个事实源，所以只留这一行指针。 */

/* ---- 清场读数（任务 #33，第 164 页）----
 * 动因是**一份与盘不符的凭证**：第 162 页补写着「verify-161 与 head-cert-83fd48a 已回收」，
 * 而 09-28 现读 `git worktree list` 里 `.worktrees/verify-161` 还在（干净、0 进程、那一笔早已在主干上）。
 * 规则 120 的"回收"只写在纸上、没有读数，于是"忘了收"这件事没有任何一处会喊（规则 210）。
 * 这一格只**报数**：`git worktree remove` 是破坏性操作，归人做；门负责让残留可见。 */

/** 一棵 worktree 的登记（来自 `git worktree list --porcelain`）。 */
export interface WorktreeRow { path: string; head: string; detached: boolean; branch: string | null; }

/** porcelain 原文 → 行。形状是 `worktree <路径>` 起块，块内 `HEAD <sha>`／`detached`／`branch refs/…`。
 *  整表读不到（null／空）回 **null**＝没尺，不许读成"没有残留"（规则 222 的三态）；
 *  缺 `path` 或缺 `HEAD` 的块丢掉而不是猜——路径猜错会把别人正在用的树报成垃圾。 */
export function parseWorktreeList(text: string | null): WorktreeRow[] | null {
  if (text === null || text.trim() === "") return null;
  const rows: WorktreeRow[] = [];
  let cur: { path?: string; head?: string; detached: boolean; branch: string | null } | null = null;
  const flush = (): void => {
    if (cur !== null && cur.path !== undefined && cur.head !== undefined) {
      rows.push({ path: cur.path, head: cur.head, detached: cur.detached, branch: cur.branch });
    }
    cur = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("worktree ")) { flush(); cur = { path: line.slice("worktree ".length).trim(), detached: false, branch: null }; continue; }
    if (cur === null) continue;
    if (line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length).trim();
    else if (line === "detached") cur.detached = true;
    else if (line.startsWith("branch ")) cur.branch = line.slice("branch ".length).trim();
  }
  flush();
  return rows.length === 0 ? null : rows;
}

/** 取一棵树「几项在飞」要交给真 git 的那对参数。`--no-optional-locks` 是 git 的**全局**选项，必须排在子命令**前面**：
 *  写在 `git status` 后面 git 报 unknown option、退出 **129** ⇒ 每棵树都「取不到」⇒ 那一格只能印 0（第 165 页实测就是这个形状）。
 *  收成一份的理由与规则 205 同：判卷与生产各拼一份，位置写错只有真跑 git 才看得见，而两边跑的是各自那一份。 */
export function gitInflightArgs(): string[] {
  return ["--no-optional-locks", "status", "--porcelain"];
}

/** 这棵树住不住本仓的 scratch 面（主树的 `.worktrees/`）？**按目录边界**比，不许用裸前缀：
 *  `"/repo/.worktrees-backup/x"` 带着同一个前缀，却不是那一面里的树——裸 `startsWith(root)` 会把它当自家人，
 *  于是"可以去收"这句话就印在别人的树旁边（前缀匹配要按位置枚举变体，第十族同一枪）。 */
function insideScratchFace(path: string, root: string | undefined): boolean {
  if (root === undefined || root === "") return true; // 没给那一面＝按旧行为全部算 scratch（调用方要为这一格出声）
  return path === root || path.startsWith(root + "/") || path.startsWith(root + "\\");
}

/** 主树根＝scratch 面的父目录，**问 git** 而不是拿"我脚下这棵树"当根
 *  （`toolLockPath` 与判卷 `tests/head-cert-deps.test.ts` 那处同一个口径：`--git-common-dir` 在主检出给相对 `.git`、
 *  在 linked 树给绝对路径 ⇒ 必须走 resolve；取不到回 null，调用方要出声，不许静默退回旧行为）。 */
export function mainRootFromCommonDir(commonDirOut: string, cwdRoot: string): string | null {
  const common = commonDirOut.trim();
  if (common === "") return null;
  return dirname(resolve(cwdRoot, common));
}

/** 认证那棵树在文件系统上的**唯一位置**。`--tree=` 允许是绝对路径（判卷与手工跑法都这么用），
 *  而 `join(main, "/tmp/x")` 得到的是 `main/tmp/x`——`join` 不认第二段绝对，只有 `resolve` 认。
 *  2026-10-01 实测：`--tree=/tmp/…` 指着一棵**已存在**的外域树时，`existsSync(join(…))` 读出「不存在」
 *  ⇒ 脚本转去 `worktree add` 那个真实路径、被 git 以 128 拒绝（这一条响，是运气不是闸）；
 *  若那棵绝对路径树**还不存在**，就会在仓里 `mkdir main/tmp/…`、把 `node_modules` 硬链进那个假目录，
 *  而真树没有依赖 ⇒ 依赖核对读的是不存在的那一面（不响的才是危险的）。
 *  收成一份（第十三族）：`staleScratchTrees` 的 `certTree` 与这里必须同源，否则「本次那棵认证树」在两个地方按两种口径算。 */
export function certTreeAbs(mainRoot: string, treeArg: string): string {
  return resolve(mainRoot, treeArg);
}

/** 哪些算"常驻残留的 scratch 树"。四个条件缺一不可：
 *  ① detached——带分支的树可能是别人正在写的工作支（本仓同时有 doc-layer／goal-plan／r1b 等分支树）；
 *  ② 0 项在飞——有在飞就是别人的活，碰都不能碰（AGENTS：保留别的会话的脏改动）；
 *  ③ 那一笔已是当前认证目标的祖先——未入库的 commit 可能正是隔壁会话在验的那笔；
 *  ④ 不是我自己这棵，也不是本次刚用的那棵认证树（那棵由汇总行末尾的回收命令单独点名，报成残留是噪声）。
 *  `dirtyCountOf` 回 null（取不到）＝**既不进残留名单，也不算干净**：它进 `unmeasured` 由 `staleTreeCell` 单独列印。
 *  旧写法直接 `continue` 掉，于是「一把坏掉的尺」永远报「收干净了」——第 165 页撞到的正是这个。
 *
 *  第五格（第 231 页）：以上四条都满足、但**不住本仓 scratch 面**（`scratchRoot`，即主树的 `.worktrees/`）的那些，
 *  进 `foreign` 而不是 `stale`。动因是现读的一处不一致：判卷 `tests/head-cert-deps.test.ts` 早就按位置钉过
 *  「报出来的必须是 `.worktrees` 下的树」，而这里的谓词压根不看位置——本机一出现别的工具建的 worktree
 *  （实测：隔壁审计会话那棵 `.claude/worktrees/…/audit-zcode`）判卷就红，而那棵树的"回收"命令会被印在**它**旁边。
 *  两半的用处不同，所以要的是**分格**而不是放宽：`stale` 才配那句"可以去收"，`foreign` 照样**报出来**（不许静默丢条，
 *  规则 261/262 那一族），只是要标清"不是本仓建的，别照那条命令删"。 */
export function staleScratchTrees(
  rows: WorktreeRow[] | null,
  opt: { selfPath: string; certTree: string; isAncestor: (sha: string) => boolean; dirtyCountOf: (path: string) => number | null; scratchRoot?: string; canonical?: (p: string) => string },
): { stale: { path: string; head: string }[]; unmeasured: string[]; foreign: string[] } {
  const stale: { path: string; head: string }[] = [];
  const unmeasured: string[] = [];
  const foreign: string[] = [];
  if (rows === null) return { stale, unmeasured, foreign };
  /* 「是不是我自己这棵」要按**同一个规范化口径**比（第 249 页实测）：`git worktree list` 给的是内核真路径，
     macOS 上 `/tmp/…` 会回报成 `/private/tmp/…`，而调用方传进来的 `--tree=` 是原始串 ⇒ 纯字符串相等漏掉，
     于是**本次刚认证完的那棵树**被印进 `foreign`，还挨着那句「别照上面那条命令删它们」（同一棵树的回收命令就在上一行）。
     取不到真路径（树还没建）就由 `canonical` 自己回原值——那是"没规范化"，不是"两个不同的树"。 */
  const canon = opt.canonical ?? ((p: string): string => p);
  const self = canon(opt.selfPath);
  const cert = canon(opt.certTree);
  for (const r of rows) {
    if (!r.detached) continue;
    const real = canon(r.path);
    if (real === self || real === cert) continue;
    const dirty = opt.dirtyCountOf(r.path);
    if (dirty === null) { unmeasured.push(r.path); continue; }
    if (dirty !== 0) continue;
    if (!opt.isAncestor(r.head)) continue;
    if (!insideScratchFace(r.path, opt.scratchRoot)) { foreign.push(r.path); continue; }
    stale.push({ path: r.path, head: r.head });
  }
  return { stale, unmeasured, foreign };
}

/** 那一格要怎么说话：未取／0 棵／N 棵三种形态分开，且**永不**把"没量到"写成 0；
 *  「在飞数取不到」是第四种形态，单独点名——并进 0 就等于让一把坏掉的尺报「收干净了」。
 *  第五种（第 231 页）＝「像残留但不住本仓 scratch 面」：照样报出来、照样点名，只是不配那句"可以去收"。 */
export function staleTreeCell(
  rows: WorktreeRow[] | null,
  res: { stale: { path: string; head: string }[]; unmeasured: string[]; foreign?: string[] },
): string {
  if (rows === null) return "常驻残留树=未取（git 读不到 worktree 清单 ⇒ 不等于没有残留）";
  const foreign = res.foreign ?? [];
  const foreignTail = foreign.length === 0
    ? ""
    : `／另有 ${String(foreign.length)} 棵不住本仓 scratch 面的残留形树（${foreign.join("、")}）＝不是本仓建的，别照上面那条回收命令删它们`;
  const tail = res.unmeasured.length === 0
    ? ""
    : `／在飞数取不到 ${String(res.unmeasured.length)} 棵（${res.unmeasured.join("、")}）＝这几棵没量过，不等于干净`;
  if (res.stale.length === 0) return `常驻残留树=0${foreignTail}${tail}`;
  return `常驻残留树=${String(res.stale.length)}（${res.stale.map((s) => `${s.path}@${s.head.slice(0, 7)}`).join("、")}）${foreignTail}${tail}`;
}

/* ── 认证面的「门」那一格（第 224 页 #36）。
 * 从前 `head-cert` 只把门表**数**一遍不**跑**（规则 292：`cert exit=0` 与「某道门红着」可以并存），
 * 于是每笔凭证页都在人肉自报另跑了哪些门。这一格把"跑哪几道、各值多少秒"收成一份，且把**判定与读数分开**：
 *   · 红＝名单里某道门没跑到，或跑到而退出码非 0（跑不到＝没尺，不许读成绿）；
 *   · ⚠️ 但不改判定＝某道门实测超出预算——判决不许押在时钟上（规则 256：本机负载、别人在跑都会挪秒数）。 */
export interface CertGateRow { name: string; exit: number; ms: number; }

/** `gates.ts` 自报的那一行：`✅ docs-check      exit=0  606ms`（前缀图标与 ANSI 都可能出现，先剥）。 */
const GATE_ROW = /\b([a-z][a-z0-9:_-]{2,})\s+exit=(-?\d+)\s+(\d+)ms/gu;

export function parseCertGateRows(text: string): CertGateRow[] {
  const clean = text.replace(/\x1b\[[0-9;]*m/gu, "");
  const out: CertGateRow[] = [];
  for (const m of clean.matchAll(GATE_ROW)) {
    out.push({ name: m[1]!, exit: Number(m[2]), ms: Number(m[3]) });
  }
  return out;
}

export interface CertGateVerdict { reds: string[]; warns: string[]; ran: number; }

/** 名单 vs 实跑的三态：缺席（红）、非 0（红）、超预算（⚠️）。名单外的行只出声不判红——
 *  它说明的是"有一份手写表漂了"，不是"这一笔代码错了"。 */
export function certGateVerdict(
  plan: readonly { name: string; budgetMs: number }[],
  rows: readonly CertGateRow[],
): CertGateVerdict {
  const byName = new Map(rows.map((r) => [r.name, r] as const));
  const reds: string[] = [];
  const warns: string[] = [];
  for (const g of plan) {
    const row = byName.get(g.name);
    if (row === undefined) {
      reds.push(`${g.name} 没跑到（gates 的输出里没有这一行 ⇒ 这一道的读数是"没尺"，不是"绿"）`);
      continue;
    }
    if (row.exit !== 0) reds.push(`${g.name} exit=${String(row.exit)}（${String(row.ms)}ms）`);
    if (row.ms > g.budgetMs) warns.push(`超预算（只出声，不判红）：${g.name} ${String(row.ms)}ms > 名单里的 ${String(g.budgetMs)}ms`);
  }
  const extra = rows.filter((r) => !plan.some((g) => g.name === r.name)).map((r) => r.name);
  if (extra.length > 0) warns.push(`输出里有名单外的门：${extra.join("、")}（不改判定，但名单与实跑不一致＝有一份手写表在漂）`);
  return { reds, warns, ran: rows.length };
}

/** 那一格要怎么说话：跑了几道／红几道／超预算几道分开印，绝不把"没量到"并进"绿"。 */
export function certGateCell(plan: readonly { name: string }[], v: CertGateVerdict): string {
  const head = `认证门面=${String(plan.length)} 道（跑到 ${String(v.ran)}）`;
  if (v.reds.length > 0) return `${head}｜❌ 红 ${String(v.reds.length)} 道｜⚠️ 超预算 ${String(v.warns.length)}`;
  return `${head}｜绿 ${String(plan.length)} 道｜⚠️ 超预算 ${String(v.warns.length)}`;
}

/** 从**那一笔**的 `scripts/gate-manifest.ts` 文本里读认证门面名单（与 `headGateTableIntegrity` 同一条纪律：
 *  名单取自被认证的那一笔，不取自正在跑命令的这一棵树的文件）。
 *  三态分开：`absent`＝那一笔还没有这一格（多半是认证老提交），只出声不判红；
 *  `broken`＝名单在却一条都没抽出来（排版/形状变了），这必须判红——
 *  门面无声消失正是本格要消灭的那种绿（规则 239/261：读不到与没有问题不许同形）。 */
export function certGatePlan(
  manifestSrc: string | null,
): { state: "ok" | "absent" | "broken"; plan: { name: string; budgetMs: number }[] } {
  if (manifestSrc === null || !/export const CERT_GATES\b/.test(manifestSrc)) return { state: "absent", plan: [] };
  const body = /export const CERT_GATES[\s\S]*?=\s*\[([\s\S]*?)\n\]/.exec(manifestSrc)?.[1];
  if (body === undefined) return { state: "broken", plan: [] };
  const plan = body.split("\n")
    .map((line) => /^\s*\{\s*name:\s*"([^"]+)"\s*,\s*budgetMs:\s*(\d+)\s*,?\s*\}/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[1]!, budgetMs: Number(m[2]) }));
  return plan.length === 0 ? { state: "broken", plan: [] } : { state: "ok", plan };
}

/* ── 贴帽读数（第 262 页，任务 #8）。
 *  动因是实测：认证 `bd5ec44` 第一趟两条用例报 `Test timed out in 5000ms`（`tests/mutate-shards.test.ts:400`、
 *  `tests/mutate-verify-gates.test.ts:1781`），把它们**隔离复跑**是 205/205 全绿 ⇒ 那是容量红不是代码红，
 *  而当时没有任何一格能证明这一点——只能再花一次三分钟复跑来归因（第 259 页补 凭证那一格给的就是这次）。
 *  现读（`outputs/judge-timeout-2026-10-01/suite-quiet.json`，安静态全量 3394 条）：
 *  最慢那条是 `tests/m3c.test.ts` 的「未获批准 fail-closed…」＝15197ms，它**自带 25000ms 显式预算** ⇒ 61%；
 *  其余最慢的 `tests/mutate-shards.test.ts` 2770ms 走缺省 5000ms ⇒ 55%。
 *  ⇒ **安静态这一格读数是 0 条**，这是事实不是缺陷：这一格量的是"隔壁会话在同一台机器上跑起来的那一刻"，
 *  而那一时刻恰好就是红发生的那一刻。它的价值在于把「谁贴着帽」变成每次认证自动印一行，
 *  让我下一次不必再靠"红了两条 → 隔离复跑 → 猜是容量"这条两分钟一趟的路归因。刻意**不进门禁**（帽子只准调低，规则 235）。
 *  第 264 页补的第二半：两趟认证实测贴帽名单都是 0 条 ⇒ 只有名单的那一格每次只印「无」＝没有读数。
 *  于是同一趟顺手印「离帽余量最近的三条」（现读安静态最高 61%＝m3c 那条自带 25_000 的），
 *  让"谁在往帽上爬"变成一个**每趟都有**的数，而不是等红起来才有。它同样只是读数，不设阈值、不进判定。 */

export type SuiteRow = { file: string; title: string; full: string; ms: number };

/** vitest `--reporter=json` 的原文 → 逐条用例。取不到／形状不认识一律 null——null 与"0 条"必须分开：
 *  后者会被读成「没有用例贴帽」，正是这一格要消灭的那件事。 */
export function suiteRows(jsonText: string | null, rootPrefix: string): SuiteRow[] | null {
  if (jsonText === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); } catch { return null; }
  const p = parsed as { testResults?: { name?: string; assertionResults?: { fullName?: string; title?: string; ancestorTitles?: string[]; duration?: number }[] }[] };
  if (!Array.isArray(p.testResults)) return null;
  const out: SuiteRow[] = [];
  for (const f of p.testResults) {
    const name = f.name ?? "";
    // 前缀配上就取相对路径；配不上（树路径被解引用过、或带 `/private` 那一类成分）就退一步按 `/tests/` 取尾。
    // 不兜这一层的话每条都会掉进 `not-resolved`——那一格会出声，但这一格本来该量到东西（规则 262）。
    let rel = name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name.replace(/^\/+/u, "");
    if (!rel.startsWith("tests/") && rel.includes("/tests/")) rel = rel.slice(rel.lastIndexOf("/tests/") + 1);
    for (const a of f.assertionResults ?? []) {
      const title = a.title ?? "";
      const full = (a.fullName ?? [...(a.ancestorTitles ?? []), title].filter(Boolean).join(" ")).trim();
      out.push({ file: rel, title, full, ms: typeof a.duration === "number" ? a.duration : 0 });
    }
  }
  return out;
}

/** 从判卷源码里取**这一条 `it` 的预算**：两种 vitest 写法都认（位置式 `}, 15_000);`、选项式 `{ timeout: 300_000 }`）。
 *  三档分开：`explicit`＝那份判卷自己写了；`implicit`＝写了收尾但没写预算 ⇒ 缺省帽说了算（正常态）；
 *  `not-resolved`＝文件取不到／标题找不到／收尾认不出 ⇒ **这一格没量到**，不能被读成「没写预算」（规则 261/262 那一族：取不到不等于没问题）。
 *  收尾只认 0/2 空格缩进的那一行：更深的 `});` 属于嵌套回调，认了就等于在中途停下。 */
export type BudgetLookup =
  | { kind: "explicit"; ms: number }
  | { kind: "implicit" }
  /** 标题**不是逐字字面量**（`it.each` 的 `%s`／反引号插值／`"…" + 变量` 拼接／`it(变量, …)`）⇒ 跑出来的标题必然不在源码里。
   *  这与"标题真的找不到"是两种成因：前者是已知形状、按缺省帽算是有道理的；后者要单独出声（规则 261/262）。
   *  同一族的另一面在变异表里叫「松钉」（`looseOnlyPointers`，09-27 现读 10／872）。
   *  真机三形各有见证（`outputs/judge-timeout-2026-10-01/realdata.log`，第 262 页）：
   *  `tests/action-fusion.test.ts` 的 `it.each(...)("… %s …")`、`tests/gate-audit.test.ts` 的
   *  `for (const c of LAYER_CASES) it(\`${c.name} ⇒ layer=${c.expected}\`, …)`、
   *  `tests/zero-regression-conjunct.test.ts` 的 `it(face.name + "：…", …)`。 */
  | { kind: "nonliteral"; fileHas: string }
  | { kind: "not-resolved"; why: string };

/** 「这一份判卷里存在非字面量标题的形状」的判据——取料与读数共用这一份，别在调用方再抄一遍（第十三族）。
 *  六个备选形状是按**真机读到的**列出来的，不是按想象的写法（`outputs/judge-timeout-2026-10-01/realdata.log`
 *  逐形状计数：`it.each` 76／`it(\`` 25／`describe.each` 8／`it("…："+` 2／`it(f…` 2／`it("②…="+` 1）：
 *  `it(` 后面既不是引号也不是反引号 ⇒ 标题是变量。 */
const NONLITERAL_TITLE = /it\.each|test\.each|describe\.each|it\(\s*`|it\(\s*"[^"]*"\s*\+|it\(\s*[A-Za-z_$]/u;

/** 归因到**这一条自己的**那个形状，而不是文件里第一条命中的形状。
 *  为什么不能取第一条：实测有一条 `it(\`水位：真表现读松钉只准调低（帽 ${N}…）\`)` 被报成了
 *  隔壁的 `it("零行为回退：" +`（同一份文件里两种形状都有）——档数没错、成因文字错，
 *  而这一格存在的理由就是"成因要说得出名字"。做法：拿标题的静态前缀（前 12 字，插值之前必然原样）
 *  定位到它在自己那条模板上的位置，再取**离它最近且靠前**的那次命中；找不到前缀就退回第一条（并如实标 `?`）。 */
function nearestNonliteralShape(text: string, title: string): string {
  const re = new RegExp(NONLITERAL_TITLE.source, "gu");
  const hits: { m: string; i: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) hits.push({ m: m[0], i: m.index });
  const first = hits[0];
  if (first === undefined) return "";
  const head = title.slice(0, 12);
  const at = head === "" ? -1 : text.indexOf(head);
  if (at < 0) return first.m.trim() + "?";
  let best = first;
  for (const h of hits) {
    if (h.i > at) break;
    best = h;
  }
  return best.m.trim();
}

export function budgetFromTestSource(text: string, title: string): BudgetLookup {
  // 取料用 `JSON.stringify(title)` 而不是裸拼 `"…"＋标题＋"…"`：判卷里写的是**带转义的字符串字面量**
  // （`\"`、`\\`、`\n`），跑出来的标题是解了转义的那一份，逐字拼必然对不上（真机 11 条因此被误归，改成 3 条）。
  // 这与变异表里「松钉指针」（`looseOnlyPointers`）是同一族：能解析 ≠ 能逐字认。
  const at = text === "" ? -1 : text.indexOf(JSON.stringify(title));
  if (at < 0) {
    if (text === "") return { kind: "not-resolved", why: "判卷文件取不到" };
    const shape = nearestNonliteralShape(text, title);
    if (shape !== "") return { kind: "nonliteral", fileHas: shape };
    return { kind: "not-resolved", why: "标题不在那份判卷里" };
  }
  const rest = text.slice(at);
  const withBudget = /^ {0,2}\}, ([0-9_]+)\);/mu.exec(rest);
  const plain = /^ {0,2}\}\);/mu.exec(rest);
  if (withBudget === null && plain === null) return { kind: "not-resolved", why: "收尾形状认不出" };
  // 位置式的收尾更靠前 ⇒ 这一条 `it` 就是带预算收尾的（否则那是下一条的收尾，宁可不判）。
  if (withBudget !== null && (plain === null || withBudget.index <= plain.index)) {
    const ms = Number((withBudget[1] ?? "").replace(/_/gu, ""));
    return Number.isFinite(ms) && ms > 0 ? { kind: "explicit", ms } : { kind: "not-resolved", why: `位置式预算不是正数：${withBudget[1] ?? ""}` };
  }
  const closer = plain?.index ?? Number.MAX_SAFE_INTEGER;
  const opts = /\{\s*timeout:\s*([0-9_]+)\s*\}/u.exec(rest.slice(0, closer));
  if (opts === null) return { kind: "implicit" };
  const ms = Number((opts[1] ?? "").replace(/_/gu, ""));
  return Number.isFinite(ms) && ms > 0 ? { kind: "explicit", ms } : { kind: "not-resolved", why: `选项式预算不是正数：${opts[1] ?? ""}` };
}

export type TimingCell = {
  state: "unreadable" | "ok";
  total: number;
  /** 缺省帽的**出处**文字：谁说了算（config 里的 `testTimeout` 还是 vitest 默认）。汇总行要印它，否则读数看起来像本仓定的尺。 */
  defaultSource: string;
  /** 用时 ≥ 有效预算 80% 的条数（"贴帽"）。缺省预算按 `defaultBudget.ms` 算。 */
  near: { file: string; full: string; ms: number; budget: number; ratio: number }[];
  /** 判卷里没写显式预算 ⇒ 按缺省帽算。这是**正常态**（vitest 的设计就是缺省优先），所以它不进名单、只出个数。 */
  implicit: number;
  /** 标题不是逐字字面量（`it.each`／插值／拼接）：按缺省帽算，但成因与 `implicit` 不同，分开印（真机读数见第 262 页）。 */
  nonliteral: number;
  /** 文件取不到／标题在那份文件里找不到（而那份文件也没有模板拼标题的形状）／预算读成正数以外 ⇒ 这一格**没量到**，
   *  单独一档，不许并进上面两档（规则 261/262）。健康态应为 0。 */
  notResolved: number;
  /** 「没量到」那几条的**成因与文件名**（最多几条，够点名的量）：只给个数字的话，下一次还是得重跑一遍才知道差在哪。 */
  notResolvedWhy: { file: string; why: string }[];
  /** 离帽**最近的几条**（不达标也算，按占比降序）。为什么要有：贴帽名单在安静态常年是空的（第 262/263 页两趟实测＝0 条），
   *  一格每次只印「无」就等于没有读数——而容量红前最后一步的证据恰恰是「谁已经用到 55–70%」。
   *  这一档是**余量**，不是判定：不进门禁、不设帽（帽子只准调低，规则 235）。 */
  slowest: { file: string; full: string; ms: number; budget: number; ratio: number }[];
};

/** 纯函数：把"每条用时"对上"每条预算"，只挑出贴帽的那几条。`readTest` 由调用方注入（门喂真盘，判卷喂假文字）。 */
export function timingNearCapCell(
  rows: SuiteRow[] | null,
  opts: { defaultBudget: { ms: number; source: string }; readTest: (rel: string) => string | null; limit?: number; slowLimit?: number },
): TimingCell {
  if (rows === null) return { state: "unreadable", total: 0, defaultSource: opts.defaultBudget.source, near: [], implicit: 0, nonliteral: 0, notResolved: 0, notResolvedWhy: [], slowest: [] };
  const cache = new Map<string, string | null>();
  const near: TimingCell["near"] = [];
  const ratios: TimingCell["slowest"] = [];
  const notResolvedWhy: TimingCell["notResolvedWhy"] = [];
  let implicit = 0;
  let nonliteral = 0;
  let notResolved = 0;
  for (const r of rows) {
    if (!cache.has(r.file)) cache.set(r.file, r.file.endsWith(".test.ts") ? opts.readTest(r.file) : null);
    const lookup = budgetFromTestSource(cache.get(r.file) ?? "", r.title);
    if (lookup.kind === "implicit") implicit += 1;
    if (lookup.kind === "nonliteral") nonliteral += 1;
    if (lookup.kind === "not-resolved") {
      notResolved += 1;
      if (notResolvedWhy.length < 3) notResolvedWhy.push({ file: r.file, why: lookup.why });
    }
    const eff = lookup.kind === "explicit" ? lookup.ms : opts.defaultBudget.ms;
    if (eff <= 0) continue;
    const row = { file: r.file, full: r.full, ms: r.ms, budget: eff, ratio: r.ms / eff };
    ratios.push(row);
    if (row.ratio >= 0.8) near.push(row);
  }
  const byRatio = (a: { ratio: number }, b: { ratio: number }): number => b.ratio - a.ratio;
  near.sort(byRatio);
  ratios.sort(byRatio);
  return {
    state: "ok",
    total: rows.length,
    defaultSource: opts.defaultBudget.source,
    near: near.slice(0, opts.limit ?? 8),
    implicit,
    nonliteral,
    notResolved,
    notResolvedWhy,
    slowest: ratios.slice(0, opts.slowLimit ?? 3),
  };
}

/** 从 `tests/vitest.config.ts` 的原文里取**缺省超时**（写了 `testTimeout` 就用它，没写回 null ⇒ 调用方按 vitest 缺省算）。
 *  为什么要现读而不是在门里写死 5000：写了缺省值就等于造第二条"谁说了算"的口径，
 *  哪天有人给 config 加了 `testTimeout`，门里那个常数会静默把读数算歪（第十三族：同一谓词只留一份）。 */
export const VITEST_DEFAULT_TIMEOUT_MS = 5_000;

export function defaultTimeoutFromConfig(configText: string | null): { ms: number; source: string } {
  const m = configText === null ? null : /testTimeout:\s*([0-9_]+)/u.exec(configText);
  if (m === null) {
    return { ms: VITEST_DEFAULT_TIMEOUT_MS, source: `缺省＝vitest 默认 ${String(VITEST_DEFAULT_TIMEOUT_MS)}ms（config 未写 testTimeout${configText === null ? "，config 也取不到" : ""}）` };
  }
  const ms = Number((m[1] ?? "").replace(/_/gu, ""));
  return Number.isFinite(ms) && ms > 0
    ? { ms, source: `缺省＝config 里的 testTimeout=${String(ms)}ms` }
    : { ms: VITEST_DEFAULT_TIMEOUT_MS, source: `缺省＝vitest 默认 ${String(VITEST_DEFAULT_TIMEOUT_MS)}ms（config 的 testTimeout 不是正数：${m[1] ?? ""}）` };
}

/** 汇总行。三态分开印：读不到 json ≠ 没有用例贴帽（规则 261/262）。 */
export function timingCell(c: TimingCell): string {
  if (c.state === "unreadable") return "贴帽读数：取不到判卷 json ⇒ 这一格没量到，不等于「没有用例贴帽」";
  const tail = c.notResolved === 0
    ? ""
    : `（这一格没量到，不等于 0）｜成因点名：${c.notResolvedWhy.map((w) => `${w.file}（${w.why}）`).join("；")}`;
  const head = `贴帽读数（${c.defaultSource}）：${String(c.total)} 条里 ${String(c.near.length)} 条用时 ≥ 有效预算 80%`
    + `｜无显式预算按缺省算 ${String(c.implicit)} 条｜标题非字面量（it.each／插值／拼接，按缺省算）${String(c.nonliteral)} 条`
    + `｜预算没落到 ${String(c.notResolved)} 条${tail}`;
  const row = (n: TimingCell["slowest"][number]): string =>
    `${n.file}·${n.full.slice(0, 34)} ${String(Math.round(n.ms))}ms/${String(n.budget)}ms=${String(Math.round(n.ratio * 100))}%`;
  const list = c.near.length === 0 ? "｜无" : `：${c.near.map(row).join("；")}`;
  // 「离帽余量最近」：贴帽名单为空时这一串就是这一格唯一的读数（安静态两趟实测都是 0 条）；
  // 不为空但少于 slowest 长度时也补印，免得名单被 limit 截短后丢掉最靠近帽的那几条。
  const slack = (c.near.length === 0 || c.near.length < c.slowest.length) && c.slowest.length > 0
    ? `｜离帽余量最近：${c.slowest.map(row).join("；")}`
    : "";
  return `${head}${list}${slack}`;
}
