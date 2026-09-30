/** 一次命令完成「认证一棵树」——把第 84 页手工做过两遍（并且做错一遍）的动作收成一个面。
 *
 * 为什么要有（都是实测）：
 *   · `cd 树 && git checkout --detach <sha> >/dev/null 2>&1 && <跑门>` 里 checkout **失败会被静默吞掉**，
 *     而它同一条链产出的 log 照样存在 ⇒ 我把"旧 HEAD＋我的副本"读成了"新 HEAD 认证"（规则 184）。
 *     本脚本对改变被测对象的每一步**打印退出码并事后复核 `rev-parse`**。
 *   · 隔离树的 `node_modules` 一般是从主树硬链接来的，而主树的依赖集反映**未提交**那笔改动
 *     ⇒ 拿它认证仍含桌面层的 HEAD 会得到 `TS2307: Cannot find module 'electron'` 这种**环境假红**（规则 87/103 同族）。
 *     本脚本先比"这棵树声明了什么 vs 装了什么"，缺的从本机其它 worktree 硬链接补上，补不齐就在汇总里写明"不可归因于代码"。
 *
 * 用法：`node --import tsx scripts/head-cert.ts [--at=HEAD] [--tree=.worktrees/head-cert] [--skip-test --why=<文本>] [--no-borrow]`
 *   · `--skip-test` 必须配 `--why`，否则 exit 2：它只跑 typecheck，**不构成"这棵树全量绿"**（见 `certLevel` 的理由）。
 * 退出码：0＝所跑的每条门都绿**且**认证门面（`CERT_GATES`，第 224 页 #36）每道都跑到且退出码 0，
 *   **且**跑完之后那棵树还在同一笔上（等级见汇总里的「认证等级」）；
 *   门面里"某道没跑到"与"某道红"都判红；**超出预算只出声**（秒数会被负载挪动，规则 256）；
 *   那一笔还没有 `CERT_GATES` 时印「认证门面=这一笔还没有这一格」并跳过——认证老提交不该被新格子判红。
 *   1＝有红，或收尾复核发现树被切走（后者是"读数作废"，不是"HEAD 红"——汇总里会点名）；
 *   2＝连认证的前置都不成立
 *   （切树失败 / 取不到 package.json / `--skip-test` 没写 `--why` / **那棵认证树正被别的进程占着**）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { certGateCell, certGatePlan, certGateVerdict, certLevel, CERT_FLAGS, CERT_OPTS, certTreeAbs, collisionHint, concurrencyReading, countConcurrentSuites, declaredDeps, defaultTimeoutFromConfig, depDirs, gitInflightArgs, headGateTableIntegrity, mainRootFromCommonDir, missingDeclaredDeps, parseCertGateRows, parseWorktreeList, readInvalidated, staleScratchTrees, staleTreeCell, suiteRows, timingCell, timingNearCapCell, unknownCertArgs } from "./lib/head-cert-deps";
import { acquireToolLock } from "./lib/tool-lock";
import { checkHeadImportFace, collectHeadEdges, findDanglingImports } from "./head-import-face";

const argv = process.argv.slice(2);
const opt = (name: string, dflt: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
const flag = (name: string): boolean => argv.includes(`--${name}`);

const MAIN = process.cwd();
const AT = opt("at", "HEAD");
/** 默认树名带提交号：`.worktrees/head-cert` 这种通用名**可能是别的会话正在用的树**——
 *  本脚本会 `checkout --detach` 它，撞上就是替别人把树切走。宁可每次新建一棵（末尾会打印回收命令）。 */
const shaShortForDefault = (runGit: () => { status: number | null; out: string }): string => {
  const s = runGit();
  return s.status === 0 ? s.out.trim().slice(0, 7) : "tmp";
};
const TREE = opt("tree", ".worktrees/head-cert-" + shaShortForDefault(() => run(MAIN, "git", ["rev-parse", AT])));

// 未知开关**先拒**，一次树都不许多建：09-27 实测 `--tre=` 拼错被静默丢掉，脚本转而去建**默认那棵共享树**
// 并跑完整轮 typecheck——操作者以为在认证自己指定的那棵，读数其实是另一棵的（与 `--skip-test` 缺 `--why` 同档，fail-closed）。
const badArgs = unknownCertArgs(argv);
if (badArgs.length > 0) {
  console.error(`❌ 不认识的参数：${badArgs.join("、")}`);
  console.error(`   本脚本只认 --${CERT_OPTS.join(" --")} 与 --${CERT_FLAGS.join(" --")}（拼错的开关不许降级成"用默认值继续跑"）。`);
  process.exit(2);
}

// 认证等级要在**干活之前**判掉：`--skip-test` 配不上 `--why` 就是用法错，别先花两分钟建树再抱怨。
const LEVEL = certLevel(flag("skip-test"), opt("why", ""));
if (!LEVEL.ok) {
  console.error(`❌ ${LEVEL.label}`);
  console.error("   要么去掉 --skip-test 跑全量，要么写清这次为什么只算半把尺（下一轮读进度页的人看得见这句话）。");
  process.exit(2);
}

function run(cwd: string, cmd: string, args: string[], logPath?: string): { status: number | null; out: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (logPath !== undefined) {
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, out);
  }
  return { status: r.status, out };
}
/* 印出来的每一行同时留在 `spoken` 里，收尾时同步落盘成 `summary.txt`：
 *  凭证的证据本体不该只活在 stdout 上——`console.log` 到管道是异步排队的，而本脚本结尾是 `process.exit`，
 *  尾巴有被丢掉的风险（同一族在 mutate-verify 里 09-28 实测到过：`--list` 数出 874/918）。
 *  规则 214：门禁可以截展示，不可以截证据。 */
const spoken: string[] = [];
const say = (line: string): void => { console.log(line); spoken.push(line); };

const sha = run(MAIN, "git", ["rev-parse", AT]);
if (sha.status !== 0 || sha.out.trim() === "") {
  console.error(`取不到 ${AT} 的提交号 ⇒ 没尺，退出`);
  process.exit(2);
}
const TARGET = sha.out.trim();
say(`目标提交：${TARGET.slice(0, 7)}（--at=${AT}）`);

/* ⓪ 占锁：认证一棵树 = 在**共享写点**上落刀。这棵树的默认名带着提交号，所以两个会话认证同一个 HEAD
 *  会算出同一个名字，而 `gate-head-cert` 那棵树的名字直接写死在 package.json 里 ⇒ 谁后跑谁替前者把树切走，
 *  前者打出来的每一条读数都是别人那笔的（第 155/160 页两次撞窗都是这个形状）。
 *  所以顺序是：**先占到锁，再动树**。占不到就 exit 2——它不是"我这笔代码红"，是"这次根本没认证任何东西"，
 *  与 `--skip-test` 缺 `--why` 同档（前置不成立）。
 *  锁放在 git 的 common dir 下：worktree 之间共享（这正是需要的），且不会出现在 `git status` 里被误提交。 */
/** `--git-common-dir` 的原样输出只取一次：锁面与 scratch 面问的是同一件事（主树在哪），两份取料会漂。 */
const COMMON_DIR_OUT = run(MAIN, "git", ["rev-parse", "--git-common-dir"]).out;
const MAIN_ROOT = mainRootFromCommonDir(COMMON_DIR_OUT, MAIN);
/** 本仓 scratch 面＝主树的 `.worktrees/`。取不到主树要**出声**：静默退回"全都算本仓的树"＝把别人的树标成可回收。 */
const SCRATCH_ROOT = MAIN_ROOT === null ? undefined : join(MAIN_ROOT, ".worktrees");
if (SCRATCH_ROOT === undefined) say("  ⚠️ 主树根取不到（`git-common-dir` 空）⇒ 残留那一格不分外域：所有残留形树都算本仓 scratch，foreign 这一趟没有读数");
const LOCK = acquireToolLock({
  tool: "head-cert",
  root: MAIN,
  tree: TREE,
  target: TARGET,
  commonDirOut: COMMON_DIR_OUT,
  harm: "占这棵树会替别人把它切走（它随后的读数其实是这一笔的）",
  say,
});
const lockCell = LOCK.cell;

// ① 切树：新建树用 worktree add，已存在的用 checkout；**不许吞输出**，且事后复核 rev-parse。
// 位置只算一次、按 `resolve` 算（`--tree=` 可以是绝对路径；`join` 不认第二段绝对，会把外域树读成「不存在」，
// 详见 `certTreeAbs` 那段注释。同族的 `mutate-verify.mjs` 早就用 `resolve(mainRoot, treeRel)` 了）。
const treeAbs = certTreeAbs(MAIN, TREE);
if (!existsSync(treeAbs)) {
  // 补父目录只是"省事"，不是判据：**建不动也要往下走**，让 `worktree add` 自己出声。
  // 上一版这里裸调 `mkdirSync(..., {recursive:true})`——旧口径把它指到仓内的假目录所以从不失败，
  // 换成真路径后 `--tree=/dev/null/x` 这种哨兵写法就抛 EEXIST 把整道门崩掉（栈里看不出是谁的错，判卷只看到少了 `worktree add exit=`）。
  try { mkdirSync(dirname(treeAbs), { recursive: true }); } catch { /* 交给下一行的 git：它知道该怎么抱怨 */ }
  const added = run(MAIN, "git", ["worktree", "add", "--detach", TREE, TARGET]);
  say(`worktree add exit=${String(added.status)}`);
  if (added.status !== 0) { console.error(added.out.trim().split("\n").slice(0, 3).join("\n")); process.exit(2); }
} else {
  const checked = run(MAIN, "git", ["-C", TREE, "checkout", "--detach", TARGET]);
  say(`checkout exit=${String(checked.status)}`);
  if (checked.status !== 0) {
    console.error(checked.out.trim().split("\n").slice(-4).join("\n"));
    console.error("⇒ 切树失败。这正是我上一轮出错的形状：链子里的 checkout 红了而门照跑，读数是旧树的。");
    process.exit(2);
  }
}
const verify = run(MAIN, "git", ["-C", TREE, "rev-parse", "HEAD"]);
if (verify.out.trim() !== TARGET) {
  console.error(`切完再核：树里是 ${verify.out.trim().slice(0, 7)}，目标是 ${TARGET.slice(0, 7)} ⇒ 不一致，停`);
  process.exit(2);
}
const judgedDirty = run(MAIN, "git", ["-C", TREE, "status", "--porcelain", "--", "src", "scripts", "tests", "fixtures"]);
const dirtyCount = judgedDirty.out.trim() === "" ? 0 : judgedDirty.out.trim().split("\n").length;
say(`已核：TREE=${verify.out.trim()}｜判卷四面在飞 ${String(dirtyCount)} 项`);
if (dirtyCount > 0) say("⚠️ 这棵树相对它自己的 HEAD 有在飞改动 ⇒ 本次读数不是 HEAD-only（谁留的？先 `git -C " + TREE + " status`）");

// ② 依赖集：先保证有 node_modules（硬链接，零拷贝），再比"这棵树声明了什么"。
const nm = join(treeAbs, "node_modules");
if (!existsSync(nm)) {
  const copied = run(MAIN, "cp", ["-al", join(MAIN, "node_modules"), nm]);
  say(`cp -al node_modules exit=${String(copied.status)}`);
}
const pkgText = run(MAIN, "git", ["show", TARGET + ":package.json"]);
if (pkgText.status !== 0) { console.error("取不到该提交的 package.json ⇒ 依赖集没法核，停"); process.exit(2); }
const installedNames = (dir: string): string[] => {
  let top: string[] = [];
  try { top = readdirSync(dir); } catch { return []; }
  const flat: string[] = [...top];
  for (const e of top) {
    if (!e.startsWith("@") || e.startsWith(".")) continue;
    try { for (const sub of readdirSync(join(dir, e))) flat.push(e + "/" + sub); } catch { /* 空作用域目录 */ }
  }
  return flat;
};
let missing = missingDeclaredDeps(pkgText.out, installedNames(nm));
say(`依赖核对：该提交声明 ${String(declaredDeps(pkgText.out).length)} 项，缺 ${String(missing.length)} 项${missing.length === 0 ? "" : "：" + missing.join("、")}`);

if (missing.length > 0 && !flag("no-borrow")) {
  const sources = [MAIN, ...readdirSync(join(MAIN, ".worktrees")).map((w) => join(MAIN, ".worktrees", w))];
  for (const dep of missing) {
    const hit = sources.map((s) => join(s, "node_modules", dep)).find((p) => existsSync(p) && p !== join(nm, dep));
    if (hit === undefined) { say(`  借不到 ${dep}（本机没有已装副本）`); continue; }
    mkdirSync(dirname(join(nm, dep)), { recursive: true });
    const linked = run(MAIN, "cp", ["-al", hit, join(nm, dep)]);
    say(`  硬链接 ${dep} ← ${hit.replace(MAIN + "/", "")} exit=${String(linked.status)}`);
  }
  missing = missingDeclaredDeps(pkgText.out, installedNames(nm));
  if (missing.length > 0) say(`补借后仍缺：${missing.join("、")}`);
}
const certifiable = missing.length === 0;
if (!certifiable) say("⚠️ 依赖不全 ⇒ 下面的红**不可归因于代码**（先装齐或换一棵树；这是规则 87/103/184 那一族）");

/* ②b 子仓库的依赖集：`fixtures/todo-app` 这类**靶子仓库**是被判卷拿去真跑命令的（run_shell / verify 拍），
 *  而它的 `node_modules` 被 `.gitignore` 排除 ⇒ 干净树里根本没有 ⇒ 那两条在 HEAD 上必红，红的却是环境。
 *  上面那条只处理根 `node_modules`，所以这里按"盘上哪些目录自带 package.json"现派生（不写死名字）。
 *  补不齐就点名——不点名就会被读成"HEAD 本来就红"（第 146 页，第一次干净 HEAD 全量 5 红里 2 条是这一类）。 */
const subDirs = depDirs((rel) => {
  try {
    return readdirSync(join(treeAbs, rel), { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
  } catch {
    return [];
  }
}).filter((d) => d !== "");
const subMissing: string[] = [];
for (const d of subDirs) {
  const into = join(treeAbs, d, "node_modules");
  if (existsSync(into)) continue;
  const from = join(MAIN, d, "node_modules");
  if (!existsSync(from)) {
    subMissing.push(d);
    say(`  子仓库 ${d}/node_modules 缺，而主树也没有 ⇒ 这棵树跑不了它里面的命令`);
    continue;
  }
  const linked = run(MAIN, "cp", ["-al", from, into]);
  say(`  硬链接子仓库依赖 ${d}/node_modules ← 主树 exit=${String(linked.status)}`);
  if (linked.status !== 0) subMissing.push(d);
}
if (subMissing.length > 0) {
  say(`⚠️ 这些靶子仓库的依赖补不齐：${subMissing.join("、")} ⇒ 在其中真跑命令的判卷红**不可归因于代码**`);
}

/* ②b import 面自洽（问的是**被认证的那个 rev**，不是盘）。放在这里的原因：它 0.2 秒，
 *  而它说的那件事正是下面 typecheck 为什么必红——第 131 页那次，`834ba3a` 把消费者入库了、
 *  4 个新模块留在未跟踪，认证树报"8 条错 / 34 个判卷文件红"，读的人得自己数才发现其中 4 条是同一件事。 */
const importFace = collectHeadEdges(TARGET);
// 空面＝没尺：`cat-file` 整批失败、或那一笔三面皆空时 findings 天然为 0，读起来正好像「自洽」。
// 与「未取」同处置（空载棘轮那一族，规则 129/196）——0 条边不许被当成绿灯。
const faceEmpty = importFace !== null && (importFace.headFiles.size === 0 || importFace.edges.length === 0);
if (importFace === null || faceEmpty) {
  say("⚠️ import 面未取（"
    + (importFace === null ? "git 读不到 " + TARGET.slice(0, 7) : "取到空面：文件 " + String(importFace.headFiles.size) + " 个、边 " + String(importFace.edges.length) + " 条")
    + "）⇒ 不等于 import 面自洽");
} else {
  const dang = findDanglingImports(importFace.edges, importFace.headFiles, (rel) => existsSync(join(MAIN, rel)));
  const face = checkHeadImportFace(dang);
  say(`import 面：${String(importFace.edges.length)} 条边｜悬空 ${String(dang.length)}（其中存量已豁免 ${String(dang.length - face.filter((f) => f.kind === "dangling").length)}）`);
  for (const f of face) say(`  ${f.kind === "dangling" ? "❌" : "⚠️"} ${f.target} — ${f.detail}`);
}

// ②c 门表完整性（同样问 TARGET：门表与 scripts 两头都要取自**同一笔**，混口径会读出假「一条不缺」）。
const gateSrc = run(MAIN, "git", ["show", TARGET + ":scripts/gate-manifest.ts"]);
const table = headGateTableIntegrity(gateSrc.status === 0 ? gateSrc.out : null, pkgText.out);
if (table === null) {
  say("⚠️ 门表未取（git 读不到那一笔的 scripts/gate-manifest.ts）⇒ 不等于门表完整");
} else {
  const bad = table.withoutScript;
  say(`门表：${String(table.gates.length)} 道，其中该笔 package.json 没有同名 script 的 ${String(bad.length)} 道`
    + (bad.length === 0 ? "" : `：${bad.join("、")} ⇒ **「整表绿」在这一笔上不可能成立**（这些门 spawn 就失败）`));
}

// ③ 跑门（逐条降级：typecheck 跑不起来也不吞掉 test 的读数）。
const logDir = join("/tmp", `dsh-head-cert-${TARGET.slice(0, 7)}`);
const tc = run(TREE, "node", ["--import", "tsx", "scripts/typecheck.ts"], join(logDir, "typecheck.log"));
say(`typecheck exit=${String(tc.status)}${tc.status === 0 ? "（0 报错）" : "：\n  " + tc.out.trim().split("\n").slice(-4).join("\n  ")}`);

/* ②d 认证门面（第 224 页 #36）：从前这道门只把门表**数**一遍（上面那行「门表：N 道」）却不跑，
 *   于是 `cert exit=0` 与「某道门红着」可以并存（规则 292），每笔凭证页都得靠人肉自报另跑了哪些门。
 *   名单取自**被认证的那一笔**（与门表完整性同一条纪律）；一次 spawn 跑完，逐道退出码与秒数由 `gates.ts` 自报。
 *   红＝有门没跑到或非 0；**超预算只出声不判红**——判决不许押在时钟上（规则 256）。 */
const face = certGatePlan(gateSrc.status === 0 ? gateSrc.out : null);
let gateReds: string[] = [];
if (face.state === "broken") {
  gateReds.push("认证门面名单读不出来（`CERT_GATES` 在，但一条都没抽出来 ⇒ 形状变了，这一趟没跑门）");
  say("❌ " + gateReds[0]);
} else if (face.state === "absent") {
  say("认证门面=这一笔还没有这一格（只数门不跑门）⇒ 别把上面那行「门表 N 道」读成「门都跑过」");
} else {
  const only = face.plan.map((g) => g.name).join(",");
  const gr = run(TREE, "node", ["--import", "tsx", "scripts/gates.ts", "--only=" + only], join(logDir, "gates.log"));
  const rows = parseCertGateRows(gr.out);
  const verdict = certGateVerdict(face.plan, rows);
  gateReds = verdict.reds;
  say(`\n== 认证门面（${String(face.plan.length)} 道，名单取自 ${TARGET.slice(0, 7)}）==`);
  for (const g of face.plan) {
    const row = rows.find((x) => x.name === g.name);
    say(row === undefined
      ? `  ❌ ${g.name} 没跑到（预算 ${String(g.budgetMs)}ms）`
      : `  ${row.exit === 0 ? "✅" : "❌"} ${g.name} exit=${String(row.exit)} ${String(row.ms)}ms（预算 ${String(g.budgetMs)}ms）`);
  }
  for (const w of verdict.warns) say(`  ⚠️ ${w}`);
  say(`  ${certGateCell(face.plan, verdict)}`);
  for (const r of verdict.reds) say(`  ❌ ${r}`);
}

let testStatus: number | null = null;
let summary = LEVEL.label;
let timingReading: string | null = null;
let psBefore = -1;
let psAfter = -1;
if (!flag("skip-test")) {
  // 撞窗读数（第 155 页凭证的动因）：判卷面有用例读写**共享的** `/tmp/m1e-default-settings.json`
  // （`src/main/settings-handlers.ts` 的缺省设置盘），两套全量判卷并行会互踩出假红。
  // 两端各采一次——中间那 90 秒采不到（判卷是阻塞的 spawnSync），所以这格只回答"起前/跑完有没有别人"，
  // 不回答"中途有没有"；红的时候它给的是**归因方向**，不是结论。
  psBefore = countConcurrentSuites(run(MAIN, "ps", ["-eo", "pid,pgid,command"]).out);
  const t = run(TREE, "node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", "--reporter=default", "--reporter=json", `--outputFile.json=${join(logDir, "suite.json")}`], join(logDir, "test.log"));
  psAfter = countConcurrentSuites(run(MAIN, "ps", ["-eo", "pid,pgid,command"]).out);
  testStatus = t.status;
  const strip = t.out.replace(/\x1b\[[0-9;]*m/g, "");
  const files = /Test Files +(.*)$/m.exec(strip)?.[1] ?? "读不到";
  const tests = /\n *Tests +(.*)$/m.exec(strip)?.[1] ?? "读不到";
  summary = `Test Files ${files}｜Tests ${tests}｜exit=${String(testStatus)}（退出码直接取，不接管道）`;
  // 贴帽读数（第 262 页，任务 #8）：逐条 duration 由**同一次**判卷顺手产出 ⇒ 零额外 spawn、零额外墙钟。
  // 只印不判：秒数会被负载挪动（规则 256），把它做成门禁等于造一把会自己变红/变绿的尺。
  // 取料两头都在**被认证的那棵树**里（判卷文件与 config 都按 `TARGET` 那一笔读，不是脚下的工作树）。
  const readFile = (rel: string): string | null => {
    try { return readFileSync(join(TREE, rel), "utf8"); } catch { return null; }
  };
  let suiteText: string | null = null;
  try { suiteText = readFileSync(join(logDir, "suite.json"), "utf8"); } catch { suiteText = null; }
  let treeRoot = treeAbs;
  try { treeRoot = realpathSync(treeAbs); } catch { treeRoot = treeAbs; }
  timingReading = timingCell(timingNearCapCell(suiteRows(suiteText, treeRoot + "/"), {
    defaultBudget: defaultTimeoutFromConfig(readFile("tests/vitest.config.ts")),
    readTest: readFile,
  }));
}
say("\n== 认证汇总 ==");
// 收尾复核：切树时核过一次，但那一次管不到判卷这 90 秒——同一棵认证树可以被别的会话/别的门中途切走，
// 那时候打出来的绿/红都不是这一笔的。读数作废是第三种态：既不算 HEAD 红，也不算已认证（规则 92）。
const afterRev = run(TREE, "git", ["rev-parse", "HEAD"]);
const drift = readInvalidated(afterRev.status === 0 ? afterRev.out : null, TARGET);
if (drift !== null) say(`❌ ${drift}`);
say(`  TREE=${TARGET.slice(0, 7)} DIRTY_JUDGED=${String(dirtyCount)} 依赖完整=${certifiable ? "是" : "否（缺 " + missing.join("、") + "）"} 收尾复核=${drift === null ? "同一笔" : "作废"} 认证树锁=${lockCell}`);
say(`  ${summary}`);
say(`  ${concurrencyReading(psBefore, psAfter, testStatus !== null)}`);
if (timingReading !== null) say(`  ${timingReading}`);
const hint = collisionHint(testStatus, psBefore, psAfter);
if (hint !== null) say(`⚠️ ${hint}`);
say(`  逐条日志：${logDir}`);
say(`  回收这棵树（规则 120，别留残留）：git worktree remove --force ${TREE}`);
/* 清场读数（任务 #33）：别的 scratch 树收没收，门只报数、不动手（`git worktree remove` 是破坏性操作，归人）。
 * 取在飞项的参数形状在 `gitInflightArgs()`（判卷与生产共用同一份）：`--no-optional-locks` 是 git 的**全局**选项，
 * 位置必须在子命令**前面**——写在 `status` 后面 git 报 unknown option 退出 129，于是每棵树都「取不到」（第 165 页实测）。
 * 要带它的原因：`git status` 默认会**刷新那棵树的 index**，
 * 那等于我在别人正在用的树上留下写痕——读数不许以污染被读对象为代价（AGENTS：保留别的会话的在飞改动）。 */
const wtRows = parseWorktreeList(run(MAIN, "git", ["worktree", "list", "--porcelain"]).out);
const staleCell = staleTreeCell(wtRows, staleScratchTrees(wtRows, {
  selfPath: MAIN,
  certTree: treeAbs, // 与切树那一步**同一个值**（从前这里另算一份 `resolve(MAIN, TREE)`：两个口径一旦分叉，「本次那棵认证树」在排除名单里就不是被切走的那棵）
  scratchRoot: SCRATCH_ROOT, // 主树的 `.worktrees/`；取不到时传 undefined，上面那行警告已经出声
  // `worktree list` 报的是内核真路径（macOS 把 `/tmp` 回报成 `/private/tmp`），而 `--tree=` 是原始串
  // ⇒ 「是不是我自己这棵」两边先取真路径再比，否则本次刚认证完的那棵树会被印进 `foreign`（第 249 页实测）。
  canonical: (p: string): string => { try { return realpathSync(p); } catch { return p; } },
  isAncestor: (shaArg) => run(MAIN, "git", ["merge-base", "--is-ancestor", shaArg, TARGET]).status === 0,
  dirtyCountOf: (p) => {
    const r = run(p, "git", gitInflightArgs());
    if (r.status !== 0) return null; // 取不到＝交 `staleTreeCell` 的第四态列印，既不算残留也不算干净
    return r.out.split("\n").filter((l) => l.trim() !== "").length;
  },
}));
say(`  ${staleCell}（规则 120：detached ∧ 0 项在飞 ∧ 那一笔已入库 才算残留；带分支的树与隔壁会话正在验的笔都不算）`);
// 并发套数**刻意不进下面这个退出码**：别的会话在跑不是我这笔代码错，接进去等于把这道门变成共享树上的随机红。
// 同理，**常驻残留数也不进退出码**——它是卫生读数，不是我这笔的回归；它进的是"每一次认证都会被看见"这一格。
const code = certifiable && tc.status === 0 && (testStatus === null || testStatus === 0) && gateReds.length === 0 && dirtyCount === 0 && drift === null ? 0 : 1;
try {
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, "summary.txt"), spoken.join("\n") + "\n");
  say(`  汇总已同步落盘（不靠 stdout 的尾）：${join(logDir, "summary.txt")}`);
} catch (e) {
  say(`⚠️ 汇总落盘失败（${String((e as NodeJS.ErrnoException).code)}) ⇒ 这次的完整读数只在 stdout 上，可能被截`);
}
process.exit(code);
