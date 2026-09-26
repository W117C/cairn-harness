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
 * 退出码：0＝所跑的每条门都绿（等级见汇总里的「认证等级」）；1＝有红（读数照常打印）；2＝连认证的前置都不成立
 *   （切树失败 / 取不到 package.json / `--skip-test` 没写 `--why`）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { certLevel, declaredDeps, missingDeclaredDeps } from "./lib/head-cert-deps";

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
const say = (line: string): void => { console.log(line); };

const sha = run(MAIN, "git", ["rev-parse", AT]);
if (sha.status !== 0 || sha.out.trim() === "") {
  console.error(`取不到 ${AT} 的提交号 ⇒ 没尺，退出`);
  process.exit(2);
}
const TARGET = sha.out.trim();
say(`目标提交：${TARGET.slice(0, 7)}（--at=${AT}）`);

// ① 切树：新建树用 worktree add，已存在的用 checkout；**不许吞输出**，且事后复核 rev-parse。
const treeAbs = join(MAIN, TREE);
if (!existsSync(treeAbs)) {
  mkdirSync(dirname(treeAbs), { recursive: true });
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

// ③ 跑门（逐条降级：typecheck 跑不起来也不吞掉 test 的读数）。
const logDir = join("/tmp", `dsh-head-cert-${TARGET.slice(0, 7)}`);
const tc = run(TREE, "node", ["--import", "tsx", "scripts/typecheck.ts"], join(logDir, "typecheck.log"));
say(`typecheck exit=${String(tc.status)}${tc.status === 0 ? "（0 报错）" : "：\n  " + tc.out.trim().split("\n").slice(-4).join("\n  ")}`);
let testStatus: number | null = null;
let summary = LEVEL.label;
if (!flag("skip-test")) {
  const t = run(TREE, "node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts"], join(logDir, "test.log"));
  testStatus = t.status;
  const strip = t.out.replace(/\x1b\[[0-9;]*m/g, "");
  const files = /Test Files +(.*)$/m.exec(strip)?.[1] ?? "读不到";
  const tests = /\n *Tests +(.*)$/m.exec(strip)?.[1] ?? "读不到";
  summary = `Test Files ${files}｜Tests ${tests}｜exit=${String(testStatus)}（退出码直接取，不接管道）`;
}
say("\n== 认证汇总 ==");
say(`  TREE=${TARGET.slice(0, 7)} DIRTY_JUDGED=${String(dirtyCount)} 依赖完整=${certifiable ? "是" : "否（缺 " + missing.join("、") + "）"}`);
say(`  ${summary}`);
say(`  逐条日志：${logDir}`);
say(`  回收这棵树（规则 120，别留残留）：git worktree remove --force ${TREE}`);
process.exit(certifiable && tc.status === 0 && (testStatus === null || testStatus === 0) && dirtyCount === 0 ? 0 : 1);
