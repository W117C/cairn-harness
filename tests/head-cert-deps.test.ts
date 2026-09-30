/** 认证一棵树之前的那道前置检查（第 84 页：我两次把**环境假红**读成代码红）。
 *  纯函数层：`declaredDeps` / `installedDeps` / `missingDeclaredDeps` / `certLevel`（第 119 页加的等级）
 *  / `readInvalidated`（第 149 页：这道门进了默认门表，共享树上的写点要有人复核）。 */
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { certLevel, CERT_FLAGS, CERT_OPTS, collisionHint, concurrencyReading, countConcurrentSuites, declaredDeps, depDirs, gitInflightArgs, headGateTableIntegrity, installedDeps, mainRootFromCommonDir, missingDeclaredDeps, parseWorktreeList, readInvalidated, staleScratchTrees, staleTreeCell, unknownCertArgs } from "../scripts/lib/head-cert-deps";
import { acquireToolLock, decideToolLock, lockAgeCap, parseToolLock, shouldReleaseLock, toolLockPath } from "../scripts/lib/tool-lock";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const listWorktrees = (cwd: string): string[] =>
  execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.startsWith("worktree "));

const pkg = (fields: Record<string, Record<string, string>>): string => JSON.stringify(fields);

describe("declaredDeps：取料面", () => {
  it("dependencies + devDependencies + optionalDependencies 都算声明了", () => {
    const text = pkg({
      dependencies: { zod: "^3" },
      devDependencies: { typescript: "^5", vitest: "^5" },
      optionalDependencies: { fsevents: "2" },
    });
    expect(declaredDeps(text)).toEqual(["fsevents", "typescript", "vitest", "zod"]);
  });

  it("peerDependencies 不算——它可以合法不装，报出来是噪声（会把人推去装用不上的包）", () => {
    const text = pkg({ dependencies: { a: "1" }, peerDependencies: { react: ">=18" } });
    expect(declaredDeps(text)).toEqual(["a"]);
  });

  it("坏 JSON / 非对象 = 空清单（取料失败由调用方按『没尺』处理，不在这里编造依赖）", () => {
    expect(declaredDeps("{ not json")).toEqual([]);
    expect(declaredDeps('"a string"')).toEqual([]);
    expect(declaredDeps("{}")).toEqual([]);
  });
});

describe("installedDeps：与盘上清单对齐", () => {
  it("非包条目（以 . 开头）被剔掉，其余原样保留并排序", () => {
    expect(installedDeps(["zod", ".bin", ".package-lock.json", "@types", "typescript"])).toEqual(["@types", "typescript", "zod"]);
  });

  it("重复条目去重（同一包从两处 readdir 混进来时不许比出假差异）", () => {
    expect(installedDeps(["a", "a", "b"])).toEqual(["a", "b"]);
  });
});

describe("missingDeclaredDeps：只报『声明了而没装』那一格", () => {
  const headLike = pkg({ dependencies: { electron: "^44", zod: "^3" }, devDependencies: { typescript: "^5" } });

  it("主树（core-only，electron 已摘）的清单去认证仍含桌面层的 HEAD ⇒ 必须点名 electron", () => {
    expect(missingDeclaredDeps(headLike, ["zod", "typescript"])).toEqual(["electron"]);
  });

  it("作用域包按展开后的名字比：装了 `@types/node` 就不算缺", () => {
    const withScoped = pkg({ devDependencies: { "@types/node": "^22" } });
    expect(missingDeclaredDeps(withScoped, ["@types/node"])).toEqual([]);
    // 反向：只把 `@types` 这一层目录名当清单 ⇒ 假缺失（取料方必须展开，本用例钉住这个边界）
    expect(missingDeclaredDeps(withScoped, ["@types"])).toEqual(["@types/node"]);
  });

  it("只装不声明的不算缺失（别的会话留在树上的包，不许变成这道检查的噪声）", () => {
    expect(missingDeclaredDeps(pkg({ dependencies: { a: "1" } }), ["a", "leftover-from-someone-else"])).toEqual([]);
  });

  it("package.json 读不到 ⇒ 空，而**调用方**必须把空当『没尺』：这里给一条钉住语义的反向用例", () => {
    expect(missingDeclaredDeps("", ["anything"])).toEqual([]);
  });
});

describe("certLevel：半把尺不许冒充认证（第 119 页，起因是第 116/117 页我自己踩的那盏假灯）", () => {
  it("不跳测＝完整认证", () => {
    expect(certLevel(false, "")).toEqual({ level: "full", ok: true, label: "完整（typecheck ＋ 全量）" });
  });

  it(`跳测又没写理由 ⇒ ok=false（脚本据此 exit 2），文案点名要 --why`, () => {
    const r = certLevel(true, "   ");
    expect(r.level).toBe("half");
    expect(r.ok).toBe(false);
    expect(r.label).toContain("--why");
  });

  it("跳测但写了理由 ⇒ 放行，可文案必须自带『不构成全量绿』＋把理由印出来", () => {
    const r = certLevel(true, "只看 typecheck 那一条面");
    expect(r.ok).toBe(true);
    expect(r.label).toContain("不构成这棵树的全量绿");
    expect(r.label).toContain("只看 typecheck 那一条面");
  });

  // 反向钉：把 `ok` 写成恒真（`--skip-test` 又不要理由）时，上面第二条必须红。
  it("空白理由不许被当成『写了理由』（trim 这一步是判据，不是清洁工）", () => {
    expect(certLevel(true, "").ok).toBe(false);
    expect(certLevel(true, "\t\n ").ok).toBe(false);
  });

  // 纯函数钉不住接线（第 118 页的同一课）：这里**真跑一次 CLI** 钉住"脚本确实按 ok 退出 2"。
  // 放在 guard 之后 ⇒ 不建 worktree、不装依赖，秒级。
  it("真跑：`--skip-test` 不带 `--why` ⇒ 脚本 exit 2，且不建 worktree", () => {
    const before = listWorktrees(repoRoot).length;
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/head-cert.ts", "--at=HEAD", "--skip-test"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toContain("--why");
    expect(listWorktrees(repoRoot).length).toBe(before); // 抱怨之前不许先花两分钟建树
  });

  // 反向那一半（"完整认证也被逼着写 --why"）跑不了全量验证（那要建一棵真树），
  // 所以钉最小可疑点：条件必须来自 `flag("skip-test")`，写死 `true` 就等于把这条判据挂到所有人身上。
  it("guard 的输入必须来自命令行，不是写死的 true", () => {
    const src = readFileSync(join(repoRoot, "scripts/head-cert.ts"), "utf8");
    expect(src.includes('certLevel(flag("skip-test"), opt("why", ""))')).toBe(true);
    expect(src.includes("certLevel(true,")).toBe(false);
  });
});

/** 第 134 页：认证一棵树时先跑 0.2 秒的 import 面自洽，把「typecheck 必红」的成因印在它前面。
 *  这里钉的是**接线**（同上面 certLevel 那条的形状）：判据本体有自己的 12 条用例与 4 条锚点，
 *  但"head-cert 有没有真的在认证那个 rev 上调它"只有这一条管。 */
describe("认证流程里的 import 面那一行（接线）", () => {
  const src = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");

  it("必须问被认证的 rev（TARGET），不是问 HEAD 字面量、也不是问盘", () => {
    expect(src.includes("collectHeadEdges(TARGET)")).toBe(true);
    expect(src.includes('collectHeadEdges("HEAD")')).toBe(false);
    expect(src.includes("collectHeadEdges()")).toBe(false);
  });

  it("取不到时必须出声「未取」，不许把空悬空当成自洽（规则 210 那一族）", () => {
    expect(src.includes("import 面未取")).toBe(true);
    expect(src.includes("不等于 import 面自洽")).toBe(true);
  });

  it("取到**空面**（文件 0 或边 0）与未取同处置：0 条 findings 正好像「自洽」（空载棘轮，规则 129/196）", () => {
    expect(src.includes("importFace.headFiles.size === 0 || importFace.edges.length === 0")).toBe(true);
    expect(src.includes("取到空面")).toBe(true);
  });
});

/** 第 136 页：门表本身在**那一笔**上完不完整。起因是想登记第 24 道门时看清了 HEAD 的门表
 *  ——37 道里 11 道连同名 script 都没有（桌面层的门名还留在表里，script 早被摘走）⇒「整表绿」在那一笔上
 *  不可能成立，而**没有任何观察者**：`gate-check` 拿盘上那份 manifest 比盘上那份 package.json，两边一起漂就一起绿。
 *  我自己还先踩了一次混口径：拿**盘上**已裁剪的 26 条去比 **HEAD** 的 scripts ⇒ 当场读出「一条不缺」。
 *  ⇒ 判据吃**文本**、两头同源，绝不吃 import 进来的活数组。 */
describe("headGateTableIntegrity：门表与 scripts 必须取自同一笔", () => {
  const manifest = (names: readonly string[]): string =>
    `export const GATES: readonly string[] = [\n${names.map((n) => `  "${n}",`).join("\n")}\n];`;
  const pkgWith = (names: readonly string[]): string =>
    JSON.stringify({ scripts: Object.fromEntries(names.map((n) => [n, "node x.ts"])) });

  it("齐的读空、缺的按表序指名", () => {
    const ok = headGateTableIntegrity(manifest(["typecheck", "test"]), pkgWith(["typecheck", "test"]));
    expect(ok).not.toBeNull();
    expect(ok?.gates).toEqual(["typecheck", "test"]);
    expect(ok?.withoutScript).toEqual([]);
    const bad = headGateTableIntegrity(manifest(["typecheck", "ipc:check", "build"]), pkgWith(["typecheck"]));
    expect(bad?.withoutScript).toEqual(["ipc:check", "build"]);
  });

  it("注释里的引号词不算门；真门名带行尾注释要照样收（少一位观察者就是静默失明）", () => {
    const src = [
      "export const GATES: readonly string[] = [",
      '  "typecheck",',
      '  // 这条门管的是 "build" 那一类，别照抄',
      '  "docs-check", // 文档预算（旧注释里写过 "ghost"）',
      "];",
    ].join("\n");
    const got = headGateTableIntegrity(src, pkgWith(["typecheck", "docs-check"]));
    expect(got?.gates).toEqual(["typecheck", "docs-check"]);
    expect(got?.withoutScript).toEqual([]);
  });

  it("三态：任一头没取到 / 数组读不出来 / 坏 JSON ⇒ null（没尺，不许读成「一条不缺」）", () => {
    expect(headGateTableIntegrity(null, pkgWith(["a"]))).toBeNull();
    expect(headGateTableIntegrity(manifest(["a"]), null)).toBeNull();
    expect(headGateTableIntegrity("const NOT_EXPORTED = 1;", pkgWith(["a"]))).toBeNull();
    expect(headGateTableIntegrity(manifest(["a"]), "{ not json")).toBeNull();
  });

  it("排版变了也别说「门表完整」：数组在、里面一条名字都没有 ⇒ 按 null 处置（0 道读起来比红更像绿）", () => {
    const hollowed = "export const GATES: readonly string[] = [\n  // 这一版把门名都写成注释了\n];";
    expect(headGateTableIntegrity(hollowed, pkgWith(["typecheck"]))).toBeNull();
    // 压成一行的排版同样不许冒充「齐的」：要么读得出东西，要么说没取到。
    expect(headGateTableIntegrity('export const GATES = ["typecheck", "test"];', pkgWith(["typecheck", "test"]))).toBeNull();
  });

  it("真表自证：HEAD 那份读得出东西，缺的那一撮必须是门表的子集", () => {
    const atHead = (p: string): string => execFileSync("git", ["show", "HEAD:" + p], { cwd: repoRoot, encoding: "utf8" });
    const got = headGateTableIntegrity(atHead("scripts/gate-manifest.ts"), atHead("package.json"));
    expect(got).not.toBeNull();
    expect(got?.gates).toContain("typecheck");
    expect(got?.gates).toContain("test");
    expect(got!.gates.length).toBeGreaterThan(20);
    for (const g of got!.withoutScript) expect(got!.gates).toContain(g);
  });
});

describe("认证流程里的门表那一行（接线）", () => {
  const src = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");

  it("两头都取自被认证的那一笔：绝不许 import 盘上那份活数组", () => {
    expect(src.includes("headGateTableIntegrity(gateSrc.status === 0 ? gateSrc.out : null, pkgText.out)")).toBe(true);
    expect(src.includes('run(MAIN, "git", ["show", TARGET + ":scripts/gate-manifest.ts"])')).toBe(true);
    expect(src.includes('from "./gate-manifest"')).toBe(false);
  });

  it("取不到时出声「门表未取」，不等于门表完整", () => {
    expect(src.includes("门表未取")).toBe(true);
    expect(src.includes("不等于门表完整")).toBe(true);
  });
});

/* 第 146 页：第一次在干净 HEAD 上跑全量判卷（5 红 / 2770 绿）。其中 2 条红的是**环境**——
   `gated-tools` 与 `runner-gates` 都在靶子仓库 `fixtures/todo-app` 里真跑命令，而它的 `node_modules`
   被 `.gitignore` 排除 ⇒ 认证树里根本没有。`head-cert` 原先只硬链接**根** node_modules。 */
describe("depDirs：一棵树里需要各自装依赖的目录", () => {
  // 目录树写成 `Record<路径, 条目[]>`，条目以 `/` 结尾表示目录。
  const tree = (spec: Record<string, string[]>) => (rel: string): { name: string; dir: boolean }[] =>
    (spec[rel] ?? []).map((raw) => raw.endsWith("/")
      ? { name: raw.slice(0, -1), dir: true }
      : { name: raw, dir: false });

  it("根与每个自带 package.json 的子目录都算（不写死名字 ⇒ 再加一个靶子仓库自动跟上）", () => {
    const got = depDirs(tree({
      "": ["package.json", "src/", "fixtures/"],
      "src": ["main.ts"],
      "fixtures": ["todo-app/", "notes.md"],
      "fixtures/todo-app": ["package.json", "src/"],
    }));
    expect(got).toEqual(["", "fixtures/todo-app"]);
  });

  it("node_modules 里那些 package.json 不许算：否则整棵依赖图都被当成靶子仓库", () => {
    const got = depDirs(tree({
      "": ["package.json", "node_modules/"],
      "node_modules": ["vitest/"],
      "node_modules/vitest": ["package.json", "node_modules/"],
      "node_modules/vitest/node_modules": ["uikit/"],
      "node_modules/vitest/node_modules/uikit": ["package.json"],
    }));
    expect(got).toEqual([""]);
  });

  it("隐藏目录不进（`.worktrees` 里全是别的树，它们的 package.json 与本树无关）", () => {
    const got = depDirs(tree({
      "": ["package.json", ".worktrees/", ".agent/"],
      ".worktrees": ["head-cert/"],
      ".worktrees/head-cert": ["package.json"],
      ".agent": ["config.json"],
    }));
    expect(got).toEqual([""]);
  });

  it("深度帽：maxDepth 之外的不收（取料成本有界，不许为了找靶子把整仓扫穿）", () => {
    const deep = tree({
      "": ["package.json", "a/"],
      "a": ["package.json", "b/"],
      "a/b": ["package.json", "c/"],
      "a/b/c": ["package.json"],
    });
    expect(depDirs(deep, 2)).toEqual(["", "a", "a/b"]);
    expect(depDirs(deep, 3)).toEqual(["", "a", "a/b", "a/b/c"]);
  });

  it("真表自证：本仓现读必须含根与 fixtures/todo-app（这条尺自己不许空载）", () => {
    const root = repoRoot;
    const got = depDirs((rel) => {
      try {
        return readdirSync(join(root, rel), { withFileTypes: true })
          .map((e) => ({ name: e.name, dir: e.isDirectory() }));
      } catch {
        return [];
      }
    });
    expect(got).toContain("");
    expect(got).toContain("fixtures/todo-app");
  });

  it("接线：认证流程真的按它补子仓库依赖，补不齐就点名（算出来不接＝没有）", () => {
    const src = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");
    expect(src, "没调 depDirs ⇒ 靶子仓库的判卷在干净树上必假红").toContain("depDirs((rel) =>");
    expect(src, "调了不接（算出来没人用）⇒ 这条判据要钉循环头，不只钉函数名").toContain("for (const d of subDirs) {");
    expect(src, "补齐动作丢了 ⇒ 只是知道缺，没修").toContain('run(MAIN, "cp", ["-al", from, into])');
    expect(src, "补不齐不出声 ⇒ 下一条读数又会把环境红算成代码红").toContain("不可归因于代码");
    // 反向：根那份的取料不许被子仓库这一层取代（两半都要在）
    expect(src, "根 node_modules 那一半被顺手摘了").toContain('run(MAIN, "cp", ["-al", join(MAIN, "node_modules"), nm])');
  });
});

/* 第 149 页：`head-cert-check` 进默认门表 ⇒ 认证树从"我手动跑一次"变成"每次跑门都要动一次"。
   共享树上多一个写点，就必须回答：判卷那 90 秒里，这棵树还在不在**同一笔**上？
   （切树时核过一次 rev，但那一次管不到中途——别的会话/别的门可以把它 checkout 走。） */
describe("readInvalidated：收尾复核（读数作废是第三态，既不是红也不是绿）", () => {
  const T = "a".repeat(40);
  const OTHER = "b".repeat(40);

  it("跑完还在同一笔 ⇒ 不作废（尾部换行是 git 的常态，要 trim）", () => {
    expect(readInvalidated(T + "\n", T)).toBeNull();
  });

  it("中途被切走 ⇒ 点名两边，并且**不说成「HEAD 红」**（假红会把人送去查代码）", () => {
    const r = readInvalidated(OTHER, T);
    expect(r).not.toBeNull();
    expect(r).toContain("作废");
    expect(r, "把读数作废写成红 ⇒ 归因方向错到人身上").not.toContain("红");
    expect(r).toContain(OTHER.slice(0, 7));
    expect(r).toContain(T.slice(0, 7));
  });

  it("复核本身没跑起来（git 读不到那棵树）⇒ 同样不算通过（「没量到」不许读成「量过且没问题」）", () => {
    const r = readInvalidated(null, T);
    expect(r).not.toBeNull();
    expect(r).toContain("读不到");
  });
});

describe("接线：认证流程真的做收尾复核，且它进得了退出码", () => {
  const src = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");

  it("复核的对象是**跑完之后**那棵树的 rev，比的是被认证的那一笔（钉整条调用，不只钉函数名）", () => {
    expect(src, "复核调用没接上 ⇒ readInvalidated 是个没人调的纯函数").toContain(
      'const drift = readInvalidated(afterRev.status === 0 ? afterRev.out : null, TARGET);');
    expect(src, "复核取的是切树时那份 rev（恒等，等于没复核）").toContain('run(TREE, "git", ["rev-parse", "HEAD"])');
  });

  it("作废必须改退出码：只印一行而门照绿 ⇒ 这道门永远不会因为树被切走而红", () => {
    expect(src).toContain("dirtyCount === 0 && drift === null ? 0 : 1");
  });

  it("复核发生在判卷之后（切树时那次管不到这 90 秒）", () => {
    const suite = src.indexOf("vitest.mjs");
    const check = src.indexOf('const drift = readInvalidated(');
    expect(suite).toBeGreaterThan(-1);
    expect(check, "复核被挪到判卷之前 ⇒ 又变成切树时那次，白加").toBeGreaterThan(suite);
  });
});

/* 第 155 页凭证的动因：我为了"别撞窗"写的等窗循环只在交接那一瞬成立，认证真跑起来后主树又开了第二套判卷。
   本次读数绿（并行只造假红、造不出假绿），但门里当时没有这一格读数——红的时候我只能事后 `ps` 反查。 */
describe("并发判卷读数：撞窗的红要有门里的归因方向，而不是人事后 ps", () => {
  // 逐字取自 09-27 真 `ps -eo pid,pgid,command` 的形状：外层 shell 把整条命令写在自己的命令行里，
  // node 子进程又是同一行形状 ⇒ 按行计数会把一套数成两套。
  const ONE_SUITE = [
    "  PID  PGID COMMAND",
    " 9113  9113 /bin/zsh -c source /tmp/snap.sh && node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts 2>&1 | tail -60",
    " 9116  9113 node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts",
    " 9118  9113 /Users/ze/.hermes/node/bin/node --require /repo/node_modules/vitest/suppress-warnings.cjs /repo/node_modules/vitest/dist/workers/forks.js",
  ].join("\n");

  it("一套判卷在 ps 里留两行（shell 包装 + node 子进程）⇒ 数成一套：按行计数会把「我自己在跑」读成撞窗", () => {
    expect(countConcurrentSuites(ONE_SUITE)).toBe(1);
  });

  it("两个 pgid ⇒ 两套并行；一行都不匹配 ⇒ 0（真独占要与「取不到」分得开）", () => {
    const two = ONE_SUITE + "\n 2222  2222 node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts";
    expect(countConcurrentSuites(two)).toBe(2);
    expect(countConcurrentSuites("  PID  PGID COMMAND\n 100  100 node scripts/typecheck.ts\n")).toBe(0);
  });

  it("取料形状不对（没有 pgid 那一列）⇒ 回 -1 而不是 0：「没量到」不许长成「量到且没问题」", () => {
    const noPgidCols = "node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts";
    expect(countConcurrentSuites(noPgidCols)).toBe(-1);
    expect(countConcurrentSuites(null)).toBe(-1);
    expect(countConcurrentSuites("")).toBe(-1);
  });

  it("真机现行：`run` 与 `--config` 中间插了 --pool ⇒ 仍然认得出（按字面串匹配的那版在这里读成 0 套）", () => {
    const pooled = "  PID  PGID COMMAND\n 95637 28142 /Users/ze/.hermes/node/bin/node /repo/node_modules/vitest/vitest.mjs run --pool=threads --config tests/vitest.config.ts tests";
    expect(countConcurrentSuites(pooled)).toBe(1);
  });

  it("看门的那行不算一套：pgrep 自己带着同样的字面（今天我就写了这么一条等窗循环）", () => {
    const watcher = "  PID  PGID COMMAND\n 1234 1234 /bin/zsh -c pgrep -f vitest.mjs run --config tests/vitest.config.ts";
    expect(countConcurrentSuites(watcher)).toBe(0);
  });

  it("判卷有红且两端采到别人 ⇒ 那句话给归因方向并点名套数；判卷绿 ⇒ 一声不出", () => {
    const hint = collisionHint(1, 0, 2);
    expect(hint).not.toBeNull();
    expect(hint).toContain("先排撞窗");
    expect(hint, "不点名的话，读的人还得自己再 ps 一遍").toContain("2");
    expect(collisionHint(0, 3, 3), "绿的时候报撞窗 ⇒ 一道门喊了没人会信的狼").toBeNull();
    expect(collisionHint(null, 3, 3), "本次没跑判卷 ⇒ 没有红可归因").toBeNull();
  });

  it("反向哨兵：判卷红而两端独占 ⇒ 不许甩锅撞窗（这条红就是代码的，得去查代码）", () => {
    expect(collisionHint(1, 0, 0)).toBeNull();
    expect(collisionHint(1, -1, -1), "ps 取不到时也不许断言「有人并行」").toBeNull();
  });

  it("汇总行三种「没数」分列印：未采／取不到／独占／撞窗，谁也不许冒充 0", () => {
    expect(concurrencyReading(-1, -1, false)).toContain("未采");
    expect(concurrencyReading(-1, -1, true)).toContain("取不到");
    expect(concurrencyReading(0, 0, true)).toContain("独占");
    const collided = concurrencyReading(0, 1, true);
    expect(collided).toContain("撞窗");
    expect(collided).toContain("1");
    expect(concurrencyReading(-1, -1, true), "取不到那一支印出 0 ⇒ 这一格从此只会假绿").not.toContain(" 0 套");
  });
});

describe("未知开关：fail-closed，不许静默退回默认那棵树", () => {
  const src = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");

  it("拼错的开关（--tre=…）必须被点名拒收：实测它会转去建**默认那棵共享树**并跑完整轮", () => {
    expect(unknownCertArgs(["--tre=.worktrees/nope", "--at=HEAD"])).toEqual(["--tre=.worktrees/nope"]);
    expect(unknownCertArgs(["--at=HEAD", "--tree=.worktrees/mine", "--skip-test", "--why=x"])).toEqual([]);
  });

  it("不带 = 的裸 flag 也认：--skip-test 合法、--skip 未知（只按前缀放行就会放过半条命令）", () => {
    expect(unknownCertArgs(["--skip-test"])).toEqual([]);
    expect(unknownCertArgs(["--no-borrow"])).toEqual([]);
    expect(unknownCertArgs(["--skip"])).toEqual(["--skip"]);
    expect(unknownCertArgs(["--bogus=1"])).toEqual(["--bogus=1"]);
  });

  it("反向哨兵：合法组合一条都不许被拒（拒了就是把这道门自己关死，门表会红成「没人能认证」）", () => {
    const allLegal = [...CERT_OPTS.map((o) => `--${o}=x`), ...CERT_FLAGS.map((f) => `--${f}`)];
    expect(unknownCertArgs(allLegal)).toEqual([]);
  });

  it("名单与脚本真正读的开关双向对得上：漏登记＝自拒，多登记＝那张表是假的", () => {
    const usedFlags = [...src.matchAll(/flag\("([^"]+)"\)/g)].map((m) => m[1] as string);
    const usedOpts = [...src.matchAll(/opt\("([^"]+)"/g)].map((m) => m[1] as string);
    expect(usedFlags.length).toBeGreaterThan(0);
    expect(usedOpts.length).toBeGreaterThan(0);
    for (const f of usedFlags) expect(CERT_FLAGS, `脚本读 --${f} 却没登记 ⇒ 传它会被自己拒收`).toContain(f);
    for (const o of usedOpts) expect(CERT_OPTS, `脚本读 --${o}= 却没登记 ⇒ 传它会被自己拒收`).toContain(o);
    for (const f of CERT_FLAGS) expect(usedFlags, `名单里的 --${f} 脚本已不再读：那张表在骗人`).toContain(f);
    for (const o of CERT_OPTS) expect(usedOpts, `名单里的 --${o} 脚本已不再读：那张表在骗人`).toContain(o);
  });

  it("接线：main() 真的调它、非空就 exit 2（只写纯函数不接＝没有闸）", () => {
    expect(src).toContain("const badArgs = unknownCertArgs(argv);");
    expect(src, "算了 badArgs 却不拒 ⇒ 拼错的开关照跑，这闸是纸糊的").toContain("if (badArgs.length > 0) {");
  });
});

describe("接线：认证流程真的两端各采一次，且这格进得了汇总行", () => {
  const src = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");

  it("起前与跑完各采一次（只采一端的读数是半把尺：中途开起来的那套看不见）", () => {
    expect(src).toContain('psBefore = countConcurrentSuites(run(MAIN, "ps", ["-eo", "pid,pgid,command"]).out);');
    expect(src).toContain('psAfter = countConcurrentSuites(run(MAIN, "ps", ["-eo", "pid,pgid,command"]).out);');
    const before = src.indexOf("psBefore = countConcurrentSuites(");
    const suite = src.indexOf('node_modules/vitest/vitest.mjs');
    const after = src.indexOf("psAfter = countConcurrentSuites(");
    expect(before).toBeGreaterThan(-1);
    expect(suite).toBeGreaterThan(before);
    expect(after, "跑完那次挪到判卷之前 ⇒ 只剩起前那一端").toBeGreaterThan(suite);
  });

  it("读数印进汇总，且 --skip-test 那一路不许伪装成「跑过且独占」", () => {
    expect(src).toContain("concurrencyReading(psBefore, psAfter, testStatus !== null)");
    expect(src, "只算不印＝这格永远没人看").toContain("${concurrencyReading(");
    expect(src, "算出了归因方向却不印 ⇒ 读的人仍然只能自己去 ps").toContain("if (hint !== null) say(");
  });

  it("反向哨兵：并发套数刻意**不进退出码**（别的会话在跑不是我这笔代码错，接进去＝共享树上的随机红）", () => {
    // 09-28：那一条式子被抽成 `const code = …`（末尾要先同步落盘再 exit），所以这里**按内容找式子**，
    // 不按 `process.exit(` 那一行——整行式针脚的脆法（规则 229）这次轮到自己挨：改的是结构，判据跟着走。
    const formula = src.split("\n").find((l) => l.startsWith("const code = ")) ?? "";
    expect(formula, "找不到退出码的式子＝这条反向哨兵从此恒真地通过").not.toBe("");
    expect(formula).toContain("drift === null");
    expect(formula, "把并发接进退出码＝这道门从此看别人脸色").not.toMatch(/ps(Before|After)/);
    expect(src, "式子算出来却不交给 process.exit＝退出码是摆设").toContain("\nprocess.exit(code);");
  });
});

/* 任务 #29：认证一棵树是在**共享写点**上落刀。`package.json` 的 `head-cert-check` 把 `--tree` 写死成
   `.worktrees/gate-head-cert`，而手跑时的默认名带着提交号 ⇒ 两个会话认证同一个 HEAD 会算出同一个树名，
   谁后跑谁替前者 `checkout --detach`：前者打出来的每一条读数其实是别人那笔的。
   第 155/160 页两次撞窗都是这个形状——上一轮只补了"事后有一格 ps 读数"，这次修成"事前占不到就不动树"。 */
describe("认证树的锁：谁能占这棵树（谓词）", () => {
  const NOW = 1_800_000_000_000;
  const mine = 1000;
  const CAP = lockAgeCap("head-cert");
  const lock = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({ tool: "head-cert", pid: 4242, target: "a".repeat(40), tree: ".worktrees/gate-head-cert", startedAt: NOW, ...over });
  const decide = (text: string | null, alive: (pid: number) => boolean = () => true) =>
    decideToolLock({ path: "/repo/.git/dsh-tool-locks/head-cert-x.lock", text, now: NOW, selfPid: mine, alive, maxAgeMs: CAP });

  it("帽按工具分档，且未登记的工具**不许有默认值**（变异机整表 33 分钟 > 认证的 30 分钟帽 ⇒ 共用一把帽就是允许第二家在半路回收我活着的锁）", () => {
    expect(lockAgeCap("head-cert")).toBe(30 * 60_000);
    expect(lockAgeCap("mutate-verify"), "整表实测 2005.7s ⇒ 帽必须比它宽").toBeGreaterThan(2005_700);
    expect(lockAgeCap("no-such-tool")).toBeNull();
    const d = decideToolLock({ path: "/p.lock", text: lock(), now: NOW + 999 * 60_000, selfPid: mine, alive: () => true, maxAgeMs: null });
    expect(d.kind, "没登记帽却照样回收＝猜出来的帽会抢活人的锁").toBe("held");
    if (d.kind === "held") expect(d.reason).toContain("没有登记");
  });

  it("没有锁文件 ⇒ free（反向哨兵：这道门**不许**依赖锁文件存在）", () => {
    expect(decide(null).kind).toBe("free");
    expect(decide(""), "空文件＝还没人写过，不是坏 JSON").not.toBeNull();
  });

  it("别人活着占着 ⇒ held，且 reason 点名 pid（不点名，读的人不知道该等谁）", () => {
    const d = decide(lock());
    expect(d.kind).toBe("held");
    if (d.kind === "held") {
      expect(d.by.pid).toBe(4242);
      expect(d.reason).toContain("4242");
    }
  });

  it("持有者 pid 已死 ⇒ reclaim：崩溃残留要能自愈，不能等人来删", () => {
    expect(decide(lock(), () => false).kind).toBe("reclaim");
  });

  it("pid 就是本进程 ⇒ reclaim（上一次留下的不许把自己锁死）", () => {
    expect(decide(lock({ pid: mine }), () => true).kind).toBe("reclaim");
  });

  it("超过帽才回收，差一秒不算：帽的边界不许靠感觉（活人跑长一点就被抢＝假自愈）", () => {
    const stale = decide(lock({ startedAt: NOW - (CAP ?? 0) - 1 }));
    expect(stale.kind).toBe("reclaim");
    if (stale.kind === "reclaim") expect(stale.reason).toContain("超过帽");
    expect(decide(lock({ startedAt: NOW - (CAP ?? 0) + 5_000 })).kind, "没超帽就回收＝帽等于没有").toBe("held");
  });

  it("锁文件读不出 ⇒ 第三态：既不当「没人占」覆盖，也不当「有人占」死等，并且点名是哪个文件", () => {
    const d = decide("{pid:");
    expect(d.kind).toBe("unreadable");
    if (d.kind === "unreadable") expect(d.path).toContain("x.lock");
  });

  it("parseToolLock 不许猜 pid：缺字段／pid 不是正整数一律 null（猜出来的 pid 会把活人的锁抢走）", () => {
    expect(parseToolLock(null)).toBeNull();
    expect(parseToolLock('{"tool":"head-cert","pid":"4242","target":"t","tree":"x","startedAt":1}')).toBeNull();
    expect(parseToolLock('{"tool":"head-cert","pid":0,"target":"t","tree":"x","startedAt":1}')).toBeNull();
    expect(parseToolLock('{"tool":"head-cert","target":"t","tree":"x","startedAt":1}')).toBeNull();
    // 工具名也要核：它决定用哪一档帽，空的/缺的等于"不知道该按谁的时限判断死活"
    expect(parseToolLock('{"pid":4242,"target":"t","tree":"x","startedAt":1}')).toBeNull();
    expect(parseToolLock('{"tool":"","pid":4242,"target":"t","tree":"x","startedAt":1}')).toBeNull();
    expect(parseToolLock(lock())?.pid).toBe(4242);
  });

  it("放锁要认身份：只有自己的锁才删（不看身份就 unlink＝抹掉别人的在飞锁）", () => {
    expect(shouldReleaseLock(lock({ pid: mine }), mine)).toBe(true);
    expect(shouldReleaseLock(lock({ pid: 4242 }), mine)).toBe(false);
    expect(shouldReleaseLock("{pid:", mine)).toBe(false);
    expect(shouldReleaseLock(null, mine)).toBe(false);
  });

  it("锁路径：相对 .git 与 linked worktree 的绝对 common dir 必须各自落在**它自己**那一份上", () => {
    // 主 worktree：git 给相对 `.git`；linked worktree：git 给**绝对路径**。用 join 拼绝对路径会把 root
    // 接在前面（`<root>//abs/.git`）⇒ 每棵树各算一份锁面，锁看着在工作、别人永远看不见。
    expect(toolLockPath(".git", "/repo", "head-cert", ".worktrees/gate-head-cert")).toBe("/repo/.git/dsh-tool-locks/head-cert-gate-head-cert.lock");
    expect(toolLockPath("/main/.git", "/repo/wt", "head-cert", ".worktrees/gate-head-cert")).toBe("/main/.git/dsh-tool-locks/head-cert-gate-head-cert.lock");
    expect(toolLockPath("  .git\n", "/repo", "mutate-verify", ".worktrees/x")).toBe("/repo/.git/dsh-tool-locks/mutate-verify-x.lock");
  });

  it("树名可来自 --tree=：只取末段并剥掉不安全字符，穿越写法不许把锁写到仓外", () => {
    const p = toolLockPath(".git", "/repo", "head-cert", "../../etc/evil") ?? "";
    expect(p).toBe("/repo/.git/dsh-tool-locks/head-cert-evil.lock");
    expect(p.startsWith("/repo/.git/")).toBe(true);
    expect(toolLockPath("", "/repo", "head-cert", ".worktrees/x")).toBeNull();
    expect(toolLockPath(".git", "/repo", "head-cert", ".worktrees/..")).toBeNull();
  });
});

describe("接线：真跑 head-cert——占不到锁就不许动树", () => {
  // 这棵树名必然建不起来（`/dev/null` 下面开不出目录）⇒ 判卷能证明"走到了切树那一步"，又不会留下 worktree。
  const WITNESS_TREE = "/dev/null/dsh-lock-witness";
  // 路径**另算一份**（不复用 toolLockPath）：拿被测函数算被测函数读的路径＝那条断言没有观测者。
  // 这里问 git 要 common dir（在 linked worktree 里 `.git` 是个文件，写死 `repoRoot/.git` 会把判卷自己搞崩），
  // 而实现若退回 `join(root, common)`，两边算出的位置在认证树里就会分叉 ⇒ 下面"被占用"那条当场红。
  const gitCommon = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const LOCK_AT = join(resolve(repoRoot, gitCommon), "dsh-tool-locks", "head-cert-dsh-lock-witness.lock");
  const runCert = (): { status: number | null; out: string } => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/head-cert.ts",
      "--at=HEAD", "--tree=" + WITNESS_TREE, "--skip-test", "--why=判卷：只看锁那一支"], { cwd: repoRoot, encoding: "utf8" });
    return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  const heldBy = (pid: number, startedAt: number): void => {
    mkdirSync(dirname(LOCK_AT), { recursive: true });
    // `tool` 必须有：它决定按哪一档帽判断死活，缺它＝这份锁归哪把工具都不知道 ⇒ 解析层直接判"读不出"。
    writeFileSync(LOCK_AT, JSON.stringify({ tool: "head-cert", pid, target: "b".repeat(40), tree: WITNESS_TREE, startedAt }));
  };
  const clearLock = (): void => { try { unlinkSync(LOCK_AT); } catch { /* 本来就没有 */ } };

  it("锁被活人占着 ⇒ exit 2、点名是谁、**没走到切树**，并且不替别人删锁", () => {
    clearLock();
    heldBy(process.pid, Date.now());
    try {
      const { status, out } = runCert();
      expect(status).toBe(2);
      expect(out).toContain(String(process.pid));
      expect(out, "抱怨之前先动了树 ⇒ 这句话只是给已经发生的破坏补个说明").not.toContain("worktree add exit=");
      expect(existsSync(LOCK_AT), "拒跑的那一支把别人的锁删了＝一次自愈抹掉别人的在飞锁").toBe(true);
    } finally {
      clearLock();
    }
  });

  it("反向哨兵：没有锁文件 ⇒ 不许以「锁面不存在」为由拒跑，照常走到切树那一步", () => {
    clearLock();
    try {
      const { out } = runCert();
      expect(out, "锁面为空就停 ⇒ 这道门从依赖别人写的文件里长出来，第一次跑必红").not.toContain("正被占用");
      expect(out).toContain("worktree add exit=");
      expect(existsSync(LOCK_AT), "跑完没放锁 ⇒ 下一次只能靠 30 分钟的帽自愈").toBe(false);
    } finally {
      clearLock();
    }
  });

  it("陈旧锁（pid 已死）⇒ 出声回收并**继续**：不先摘旧锁，抢占那次 link 必 EEXIST＝陈旧锁永远回收不了", () => {
    clearLock();
    heldBy(999_999, Date.now()); // pid 探不到活人：这条在真机上由 `process.kill(pid, 0)` 判
    try {
      const { out } = runCert();
      expect(out).toContain("回收");
      expect(out).toContain("worktree add exit=");
    } finally {
      clearLock();
    }
  });

  it("锁文件读不出 ⇒ exit 2、点名是哪把锁，也不许冒领「被别人占走」那一支的措辞", () => {
    clearLock();
    mkdirSync(dirname(LOCK_AT), { recursive: true });
    writeFileSync(LOCK_AT, "{pid:");
    try {
      const { status, out } = runCert();
      expect(status).toBe(2);
      expect(out).toContain("dsh-lock-witness.lock");
      // `exit=2` ＋「点名路径」这一对**两支拒跑都给**（抢占失败那条也印同一个路径）⇒ 只钉这两样，
      // 把 unreadable 那一支整支拆掉仍然全绿：09-28 实测，这条锚点第一版就是这么活过来的。
      // 修法＝钉**这一支自己的措辞**，并配一条"不许出现另一支的话"（同规则 233 的零分辨力那一类）。
      expect(out, "第三态被吞 ⇒ 读不出被当没人占，最后靠抢占失败蒙对退出码").toContain("锁文件在但读不出");
      expect(out, "把「读不出」报成「被别人占走」＝把自己的坑说成别人的").not.toContain("被别人占走");
      expect(out).not.toContain("worktree add exit=");
    } finally {
      clearLock();
    }
  });

  it("接线形状：head-cert 真调 acquireToolLock 且早于切树，三态那份唯一过程在 tool-lock 里", () => {
    const cert = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");
    const lib = readFileSync(join(repoRoot, "scripts", "lib", "tool-lock.ts"), "utf8");
    const claim = cert.indexOf("const LOCK = acquireToolLock({");
    const checkout = cert.indexOf('"worktree", "add"');
    expect(claim, "整支占锁没接上 ⇒ acquireToolLock 是个没人调的函数").toBeGreaterThan(-1);
    expect(checkout, "先切树再占锁＝抱怨之前已经替别人把树切走").toBeGreaterThan(claim);
    expect(cert).toContain("认证树锁=${lockCell}");
    // 下面四条读的是 lib：过程从 head-cert 收过去之后针脚跟着实现走（规则 229），断言内容一条没减，只是换了被测文件。
    expect(lib).toContain("selfPid: process.pid, alive: pidAlive });");
    expect(lib, "探活写成 () => true ⇒ 崩溃残留的锁要等 30 分钟才回收得到").toContain("process.kill(pid, 0)");
    expect(lib, "rename 会**替换**别人的锁：两个同时启动的进程各自都以为占到了").not.toContain("renameSync");
    expect(lib).toContain("linkSync(tmp, lockPath)");
    expect(lib).toContain("if (shouldReleaseLock(now, process.pid))");
  });

  it("一把锁只有一份过程：两个消费者都只调 acquireToolLock，谁都不许自己再判三态（第十三族）", () => {
    const lib = readFileSync(join(repoRoot, "scripts", "lib", "tool-lock.ts"), "utf8");
    // 按**行首语句**匹配，不按「文字里出现过」匹配：锚点表就写在这些消费者的文件里，
    // 表里那些 if (decision.kind …) 是针脚文字不是分支（规则 236 同一个坑换了个面）。
    const decides = /(^|\n)[ \t]*if \(decision\.kind === "(?:held|unreadable|reclaim)"\)/g;
    expect((lib.match(decides) ?? []).length, "三态各自成支是过程的本体，并进另一态＝那一态没人判了").toBe(3);
    for (const rel of ["scripts/head-cert.ts", "scripts/mutate-verify.mjs"]) {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      expect(src, `${rel} 里没有占锁调用 ⇒ 那棵树上的并发没人拒`).toContain("acquireToolLock({");
      expect(src, `${rel} 里出现第二份三态判断 ⇒ 「占不到就不许动盘」有两个事实源，改一处漏一处`).not.toMatch(decides);
    }
  });

  it("三态不许互相冒充：free 那一支永远不 exit，未取到锁面只出声不停门", () => {
    const lib = readFileSync(join(repoRoot, "scripts", "lib", "tool-lock.ts"), "utf8");
    // 切片边界用**代码标识**，不用注释文字（`assertion-health-scan` 那条棘轮喊的，09-28 实测我第一版拿的是
    // `/* ⓪ 占锁 */` 与 `// ① 切树` 两句注释 ⇒ 改一句注释，这段切片就静默变空、断言照绿）。
    const from = lib.indexOf("export function acquireToolLock(");
    const block = lib.slice(from);
    expect(from, "过程整个没了 ⇒ 上面那条「真调它」会红在调用点，这条要红在定义点").toBeGreaterThan(-1);
    expect(block.length).toBeGreaterThan(200);
    // free 那一支**不该存在**：没有锁就该直接走到抢占。给它补一支 exit 就是把这道门做成依赖锁文件存在
    // （行为侧由上面那条反向哨兵看着，这一条是它的文字配对——两半各守一种坏法，规则 208）。
    expect(block, "给 free 也加一支拒跑＝没锁文件时这道门自己先关死，第一次跑必红").not.toContain('decision.kind === "free"');
    const nullCell = block.slice(block.indexOf("lockPath === null"), block.indexOf("lockPath === null") + 240);
    expect(nullCell, "未取到锁面要 return 不要 exit（否则 git 一抖，整道门对所有树同时关死）").not.toContain("process.exit");
    expect(block).toContain("锁面未取");
  });
});

describe("清场读数：常驻残留的 scratch 树要自己报数（任务 #33）", () => {
  const PORCELAIN = [
    "worktree /repo", "HEAD aaa", "",
    "worktree /repo/.worktrees/branchy", "HEAD bbb", "branch refs/heads/feat", "",
    "worktree /repo/.worktrees/dirty", "HEAD ccc", "detached", "",
    "worktree /repo/.worktrees/stale", "HEAD ddd", "detached", "",
    "worktree /repo/.worktrees/notancestor", "HEAD eee", "detached", "",
    "worktree /repo/.worktrees/unreadable", "HEAD fff", "detached", "",
    "worktree /repo/.worktrees/head-cert-aaa", "HEAD aaa", "detached", "",
  ].join("\n");
  const rows = parseWorktreeList(PORCELAIN);
  const OPT = {
    selfPath: "/repo",
    certTree: "/repo/.worktrees/head-cert-aaa",
    scratchRoot: "/repo/.worktrees",
    isAncestor: (sha: string): boolean => sha !== "eee",
    dirtyCountOf: (p: string): number | null => (p.endsWith("dirty") ? 2 : p.endsWith("unreadable") ? null : 0),
  };

  it("取料：整表空 ⇒ null（没尺，不等于「没有残留」）；缺 path 或缺 HEAD 的块丢掉而不是猜", () => {
    expect(parseWorktreeList(null)).toBeNull();
    expect(parseWorktreeList("   \n")).toBeNull();
    expect(parseWorktreeList("garbage not porcelain")).toBeNull();
    // 一棵只有 `worktree` 行、没有 HEAD 行的块：报了路径也没法判祖先 ⇒ 丢，别猜
    expect(parseWorktreeList("worktree /x\nsome other line\n")).toBeNull();
    const got = parseWorktreeList(PORCELAIN);
    expect(got === null ? -1 : got.length).toBe(7);
  });

  it("四个条件缺一不可：带分支／有在飞／未入库／是本次那棵认证树，各一条反向（把别人正在用的树喊成垃圾是最坏的读法）", () => {
    expect(staleScratchTrees(rows, OPT).stale.map((s) => s.path)).toEqual(["/repo/.worktrees/stale"]);
    expect(staleScratchTrees(null, OPT)).toEqual({ stale: [], unmeasured: [], foreign: [] });
    // 条件本身也要能单独被拆：只留「detached」时会把分支树与未入库那笔一起算进来（⇒ 门会喊人去删别人的活）
    const loose = { ...OPT, isAncestor: () => true, dirtyCountOf: () => 0 as number };
    expect(staleScratchTrees(rows, loose).stale.length, "祖先与在飞两项一放宽，branchy/notancestor/dirty 全被算成残留").toBeGreaterThan(3);
  });

  it("第四态：在飞数取不到的那棵要单独点名——既不进残留名单，也不许被那个 0 吞掉", () => {
    const res = staleScratchTrees(rows, OPT);
    // fixture 里 `unreadable` 那棵的 dirtyCountOf 回 null：旧写法直接 continue 掉它，于是"一把坏掉的尺"永远报「收干净了」
    expect(res.unmeasured, "取不到＝静默丢弃 ⇒ 这一格从此只能印 0（第 165 页实测就是这个形状）").toEqual(["/repo/.worktrees/unreadable"]);
    expect(res.stale.map((s) => s.path), "取不到的那棵不许被算成残留（喊人去删一棵没量过的树，比不报更坏）").not.toContain("/repo/.worktrees/unreadable");
    const cell = staleTreeCell(rows, res);
    expect(cell, "数量不列印出来＝这格没有观测者（规则 210）").toContain("在飞数取不到 1 棵");
    expect(cell, "得点名到路径，否则读的人不知道该去核哪一棵").toContain("/repo/.worktrees/unreadable");
    expect(staleTreeCell(rows, { stale: [], unmeasured: ["/repo/.worktrees/x"] }).startsWith("常驻残留树=0／"), "残留 0 棵但有一棵没量过 ⇒ 整句不许只剩 =0").toBe(true);
    expect(staleTreeCell(rows, { stale: [], unmeasured: [] }), "全都量到、全都干净 ⇒ 才是那个 0").toBe("常驻残留树=0");
  });

  it("那一格三种形态分列印：未取／0 棵／N 棵，未取不许写成 0（空载棘轮同族）", () => {
    expect(staleTreeCell(null, { stale: [], unmeasured: [] })).toContain("未取");
    expect(staleTreeCell(rows, { stale: [], unmeasured: [] })).toBe("常驻残留树=0");
    const one = staleTreeCell(rows, { stale: [{ path: "/repo/.worktrees/stale", head: "d".repeat(40) }], unmeasured: [] });
    expect(one).toContain("常驻残留树=1");
    expect(one, "不点名路径，读的人不知道该去收哪一棵").toContain("/repo/.worktrees/stale");
  });

  // ---- 第 231 页：不住本仓 scratch 面的那些另列一格——既不许领"可以去收"，也不许静默消失 ----
  const FOREIGN = [
    "worktree /repo", "HEAD aaa", "",
    "worktree /repo/.worktrees/stale", "HEAD ddd", "detached", "",
    "worktree /other/tool/.claude/worktrees/audit", "HEAD ggg", "detached", "",
    "worktree /repo/.worktrees-backup/lookalike", "HEAD hhh", "detached", "",
  ].join("\n");
  const allClean = { ...OPT, isAncestor: (): boolean => true, dirtyCountOf: (): number => 0 };

  it("外域那棵进 foreign 而不是 stale，且照样在句子里点名（报成「不存在」＝尺把它吞了）", () => {
    const rows2 = parseWorktreeList(FOREIGN);
    const res = staleScratchTrees(rows2, allClean);
    expect(res.stale.map((s) => s.path), "只有主树 .worktrees 下那棵配「可以去收」").toEqual(["/repo/.worktrees/stale"]);
    expect(res.foreign.sort()).toEqual(["/other/tool/.claude/worktrees/audit", "/repo/.worktrees-backup/lookalike"]);
    const cell = staleTreeCell(rows2, res);
    expect(cell).toContain("常驻残留树=1");
    expect(cell, "外域那棵不印出来＝下一次没人知道它还在那儿").toContain("/other/tool/.claude/worktrees/audit");
    expect(cell, "不写清「别照那条命令删」，这一串路径就是给回收命令看的").toContain("别照上面那条回收命令删");
  });

  it("同前缀不是同一面：`.worktrees-backup` 算外域（裸 startsWith 会把别人的树标成可回收）", () => {
    const res = staleScratchTrees(parseWorktreeList(FOREIGN), allClean);
    expect(res.stale.map((s) => s.path), "目录名前缀撞车不等于住在那一面里").not.toContain("/repo/.worktrees-backup/lookalike");
  });

  it("没给 scratchRoot 才退回旧行为（全算本仓）——而调用方必须把它接上，否则分格是死代码", () => {
    const noRoot = { ...allClean, scratchRoot: undefined };
    const res = staleScratchTrees(parseWorktreeList(FOREIGN), noRoot);
    expect(res.foreign, "没给那一面＝不分格（调用方要为此出声，见 head-cert 里那行警告）").toEqual([]);
    expect(res.stale.length).toBe(3);
    const src = readFileSync(join(repoRoot, "scripts/head-cert.ts"), "utf8");
    expect(src, "调用方没传主树的 .worktrees ⇒ 这一格永远是空的").toContain("scratchRoot: SCRATCH_ROOT,");
    expect(src, "主树根必须问 git：拿脚下这棵树当根，在链接树里跑就全盘错位").toContain("mainRootFromCommonDir(COMMON_DIR_OUT, MAIN)");
  });

  it("主树根两种 git 形状都认：主检出给相对 .git，linked 树给绝对路径；取不到回 null 不猜", () => {
    expect(mainRootFromCommonDir(".git\n", "/repo")).toBe("/repo");
    expect(mainRootFromCommonDir("/repo/.git", "/repo/.worktrees/x")).toBe("/repo");
    expect(mainRootFromCommonDir("   ", "/repo"), "空输入＝没尺，不许猜成脚下这棵").toBeNull();
  });

  it("接线：主树根取不到时那一格必须出声，不许静默退回「全都算本仓」", () => {
    const src = readFileSync(join(repoRoot, "scripts/head-cert.ts"), "utf8");
    expect(src, "guard 被改成 if (false) ⇒ 没有主树根的场合 foreign 那一格悄悄退化成旧行为，而读数看起来什么都没发生").toMatch(
      /^if \(SCRATCH_ROOT === undefined\) say\(/mu);
  });

  it("真读现喂：拿本机真的 worktree 清单喂进去不许崩，且绝不点到自己这棵", () => {
    const real = parseWorktreeList(execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim() === "" ? null : execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }));
    expect(real, "这台机器上真有 worktree，读到空＝取料坏了").not.toBeNull();
    /* 仓库根要**问 git**，不许拿"当前这棵树"当根：判卷在链接树里跑时，别的 scratch 树住在**主树**的 `.worktrees` 下，
     * 而 `repoRoot` 是那棵链接树自己 ⇒ 用 `join(repoRoot, ".worktrees")` 做包含断言在主树里恒过、在链接树里恒红。
     * 09-28 实测：这个错让派生名单 62 条里 46 条判「基线就不是全绿」（规则 240 那一族——判卷读到的是自己所住那棵树的状态）。 */
    const mainRoot = dirname(resolve(repoRoot, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: repoRoot, encoding: "utf8" }).trim()));
    // 这根"我在哪棵树"的自证必须留着：链接树的 `.git` 是个**文件**，主树的才是目录。
    // 谁再把根算成 `repoRoot` 自己，这条会在**每一次派生名单**（都在链接树里跑）当场红，而不是变成 46 条没有指向性的「基线不绿」。
    expect(existsSync(join(mainRoot, ".git")), "算出来的主树不存在：" + mainRoot).toBe(true);
    expect(statSync(join(mainRoot, ".git")).isDirectory(), "主树的 .git 必须是目录（链接树的那个是文件）⇒ 根算错了：" + mainRoot).toBe(true);
    const candidates = (real ?? []).filter((r) => r.detached && r.path !== repoRoot).length;
    const OPTS = {
      selfPath: repoRoot,
      certTree: resolve(repoRoot, ".worktrees/none-such"),
      isAncestor: (sha: string) => {
        try { execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: repoRoot, encoding: "utf8", stdio: "ignore" }); return true; }
        catch { return false; } // 非零退出＝不是祖先；**不许**让它抛（抛出去这格就变成"没量到"）
      },
      dirtyCountOf: (() => {
        /* 一树一次、结果缓存：下面要把同一份清单喂**两次**（分位置 vs 不分位置）比划分，
           而本机别的会话正在建/删/写树——第二遍现读就会拿到不同的脏净态，那条"划分必须相等"的断言
           于是押在调度上（2026-09-30 实测：`.worktrees/gate-mutate-verify` 在两遍之间翻了态 ⇒ 偶发红，规则 256 同一族）。
           命令形状仍然走真 git，且每个路径只走一次 ⇒ "这对参数跑不通"那一格照样有证人。 */
        const seen = new Map<string, number | null>();
        return (p: string): number | null => {
          const hit = seen.get(p);
          if (hit !== undefined) return hit;
          const r = spawnSync("git", gitInflightArgs(), { cwd: p, encoding: "utf8" });
          const v = r.status !== 0 ? null : (r.stdout ?? "").split("\n").filter((l) => l.trim() !== "").length;
          seen.set(p, v);
          return v;
        };
      })(),
    };
    const res = staleScratchTrees(real, { ...OPTS, scratchRoot: join(mainRoot, ".worktrees") });
    for (const s of res.stale) {
      expect(s.path).not.toBe(repoRoot);
      // 目录**边界**，不是裸前缀：`.worktrees-backup/…` 撞得上句断言就永远过不了（第十族那一枪）
      expect(s.path.startsWith(join(mainRoot, ".worktrees") + "/"), "报「可以去收」的必须是主树 .worktrees 下的 scratch 树：" + s.path).toBe(true);
    }
    // 分格必须是**划分**而不是筛子：拿同一对参数不按位置分一次，两格并起来要等于那份名单
    // （只断言"外域的不进 stale"是不够的——把外域那条整个丢掉照样过，而那就是一把会吞条目的尺）
    const byLocationBlind = staleScratchTrees(real, OPTS);
    expect([...res.stale.map((s) => s.path), ...res.foreign].sort(), "stale ∪ foreign 必须等于不按位置分的那份名单").toEqual(
      byLocationBlind.stale.map((s) => s.path).sort(),
    );
    if (candidates > 0) {
      expect(res.unmeasured.length, `本机 ${String(candidates)} 棵候选树**全部**取不到在飞数＝git 那条命令本身跑不通（参数形状坏了），这格就又变成恒 0`).toBeLessThan(candidates);
    }
  });

  it("行为证人：这对参数交给真 git——跑得出 0、脏树量得出 1 而干净树是 0，并且不碰那棵树的 index", () => {
    // 这条是第 165 页那一格的正面证人：`--no-optional-locks` 是 git 的**全局**选项，位置写错时 git 退 129，
    // 而**文字钉看不见位置**（旧断言 toContain 那串引号，写在前面还是后面都过）。这里让真 git 说话。
    const dir = mkdtempSync(join(tmpdir(), "dsh-inflight-")); // 唯一名：固定名会和隔壁并发的判卷互相踩（/tmp 共享面撞过）
    const repo = join(dir, "repo");
    mkdirSync(repo);
    const git = (args: string[]): { status: number | null; out: string } => {
      const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
    };
    try {
      expect(git(["init", "-q", "."]).status).toBe(0);
      git(["config", "user.email", "judge@example.invalid"]);
      git(["config", "user.name", "judge"]);
      writeFileSync(join(repo, "f.txt"), "a\n");
      expect(git(["add", "f.txt"]).status).toBe(0);
      expect(git(["commit", "-q", "-m", "init"]).status).toBe(0);
      const clean = git(gitInflightArgs());
      expect(clean.status, "git 跑不通＝这对参数是坏的；坏掉之后每棵树都『取不到』⇒ 那一格只能印 0（第 165 页实测）").toBe(0);
      expect(clean.out.trim(), "干净树要量出 0 项").toBe("");
      writeFileSync(join(repo, "f.txt"), "b\n");
      const dirty = git(gitInflightArgs());
      expect(dirty.status).toBe(0);
      expect(dirty.out.trim().split("\n").filter((l) => l.trim() !== "").length, "脏树要量出 1 项：同一对参数分不出两态，那个 0 就没有证人").toBe(1);

      /* index 的路径要问 git，不写死 `.git/index`：`GIT_INDEX_FILE` 或 split-index 一旦生效，写死就会去读一份
         永远不会被写到的文件 ⇒ 正向那条「没动 index」变成**真空里通过**（规则 208 要防的正是这种）。 */
      const idxPath = git(["rev-parse", "--git-path", "index"]).out.trim();
      expect(idxPath, "git 连 index 在哪都答不出 ⇒ 这一格没量到，不许把空路径当『没动过』").not.toBe("");
      const idx = isAbsolute(idxPath) ? idxPath : join(repo, idxPath);
      const readIdx = (): { ms: number; ino: number; sha: string } => {
        const buf = readFileSync(idx);
        const st = statSync(idx);
        return { ms: st.mtimeMs, ino: st.ino, sha: createHash("sha256").update(buf).digest("hex") };
      };
      /* 三种观测各有分工：sha＝内容真换了；ino＝git 用「临时文件＋rename」换 index，**每次写盘 inode 必变，
         且不受时钟粒度影响**；mtime 只作旁证（它才是上一版唯一依赖的东西，也是它在并发下翻不出来的）。 */
      const differs = (a: ReturnType<typeof readIdx>, b: ReturnType<typeof readIdx>): string[] => {
        const out: string[] = [];
        if (a.sha !== b.sha) out.push("sha");
        if (a.ino !== b.ino) out.push("ino");
        if (a.ms !== b.ms) out.push("mtime");
        return out;
      };
      let staleN = 0;
      const staleIt = (): void => {
        staleN += 1;
        const t = Math.floor(Date.now() / 1000) - 120 + staleN;
        utimesSync(join(repo, "f.txt"), t, t);
      };
      /* 正向（带 `--no-optional-locks` 不许动别人的 index）在**两种内容态**下都要成立：生产里读的就是别人那棵树，
         而它脏不脏不由我定。两态都跑，每圈仍用**过去且互不相同**的时刻（规则 256：不许把结论押在调度或时钟粒度上）。 */
      for (const state of ["脏", "干净"] as const) {
        // 回到"内容与 HEAD 一致"那一态：直接改回提交里那句（同为 2 字节，变的只有 mtime 与内容本身）
        if (state === "干净") writeFileSync(join(repo, "f.txt"), "a\n");
        const seen: string[] = [];
        for (let k = 0; k < 3 && seen.length === 0; k++) {
          staleIt();
          const before = readIdx();
          expect(git(gitInflightArgs()).status).toBe(0);
          seen.push(...differs(before, readIdx()));
        }
        expect(seen, `带着 --no-optional-locks 还是动了别人的 index（内容${state}态，观测到 ${seen.join("、")}）＝这选项的存在没有证人；读数把被读对象写脏了`).toEqual([]);
      }
      /* 反向对照只能在**内容干净**那一态做，而且要先证明「这一态真的干净」——不能只靠上面那个数组的顺序。
         实测计数在 `outputs/inflight-index-witness-2026-09-30/summary.log`（4 份 log × 每臂 12 圈，汇总器 summarize.mts）：
           脏态 · plain status：ino/mtime 翻 **9/12**，而 sha **0/12** ⇒ git 想写就写、写的还是同样的字节，这次写盘是**可选的**；
           干净态 · plain status：ino/mtime/sha 翻 **12/12**（stat 刷新会落进字节）⇒ 证人取这一态；
           哨兵 · git add：4/4 三样全翻 ⇒ 这几列本身能翻，不是恒「不变」的坏表；
           两态 · 带 --no-optional-locks：**0/24** ⇒ 正向那条「没动 index」量的是真事。
         ⚠️ 上一版在这里错过两次：⑴ 押「脏态必写盘」当反向对照（它就是 2026-09-30 全量认证那格红的成因：
         `认证树判卷 1 failed`，而单跑该文件 88 条绿 ×3）；⑵ 把探针里恒「不变」的 `ino`/`mtimeNs` 两列
         （字段根本不存在，`undefined !== undefined` 为假）读成现象，还据此编过一个「时钟粒度／浮点量化」的错机理。
         时钟那条现已排除：写盘那些圈 Δms ≥ 10、Δns 与它同向。机制仍**没单独量过负载那一臂**。 */
      expect(git(["status", "--porcelain"]).out.trim(), "反向对照前必须先处在干净态，否则量的又是那个可选的写盘").toBe("");
      /* 证人必须是**同一圈里同时**看到 sha 与 ino 变化——跨圈拼两个半观测，就等于没看到一次写盘。 */
      const rounds: string[][] = [];
      for (let k = 0; k < 3; k++) {
        staleIt();
        const before = readIdx();
        expect(git(["status", "--porcelain"]).status).toBe(0);
        const d = differs(before, readIdx());
        rounds.push(d);
        if (d.includes("sha") && d.includes("ino")) break;
      }
      const witness = rounds.find((d) => d.includes("sha") && d.includes("ino")) ?? [];
      expect(witness.includes("sha"), "反向对照：三圈里都没有一次「字节变了」的写盘 ⇒ 上面那条『带着它没动』是常数而不是观测（规则 208）；" +
        "这一格必须在**内容干净**那态量（脏态下 git 写的是同样的字节，那次写盘是可选的）。逐圈观测：" + JSON.stringify(rounds)).toBe(true);
      expect(witness.includes("ino"), "ino 也要同圈翻：git 换 index 走临时文件＋rename，inode 必变且不受时钟粒度影响——" +
        "上一版只依赖 mtime，那正是它偶发红的原因。逐圈观测：" + JSON.stringify(rounds)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("接线：head-cert 真调它、进汇总行，而这格刻意不进退出码；取在飞要 --no-optional-locks", () => {
    const src = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");
    expect(src, "只写纯函数不接＝没有读数（规则 230）").toContain("staleScratchTrees(wtRows");
    expect(src, "数出来了但不印＝这格没有观测者（规则 210）").toContain("${staleCell}");
    expect(src, "调用点自己拼一份命令＝两份形状可以各错各的（规则 205 收成一份）；而它错的那一份恰好让 git 退 129").toContain('run(p, "git", gitInflightArgs())');
    const libSrc = readFileSync(join(repoRoot, "scripts", "lib", "head-cert-deps.ts"), "utf8");
    expect(libSrc, "位置这件事只有真 git 看得见（上面那条行为证人），而这份形状必须是唯一事实源").toContain('return ["--no-optional-locks", "status", "--porcelain"];');
    const exitLine = src.split("\n").find((l) => l.startsWith("const code = "));
    expect(exitLine, "别的会话没收尾不是我这笔代码错 ⇒ 接进退出码＝共享树上的随机红").not.toContain("stale");
    expect(exitLine).not.toContain("wtRows");
  });

  it("汇总要同步落盘：stdout 只是展示，summary.txt 才是证据（本脚本结尾是 process.exit）", () => {
    const src = readFileSync(join(repoRoot, "scripts", "head-cert.ts"), "utf8");
    expect(src, "say 不记录 ⇒ 落盘的那份是空表，凭证还是只能靠 stdout").toContain("console.log(line); spoken.push(line);");
    expect(src, "落盘走 writeFileSync（同步交给内核），不是 console.log＋exit").toContain('writeFileSync(join(logDir, "summary.txt")');
    expect(src).toContain("spoken.join(");
  });

  it("临时名必须是自己新建的（wx）：缺省写法会跟随已存在的同名文件/符号链接", () => {
    const lib = readFileSync(join(repoRoot, "scripts", "lib", "tool-lock.ts"), "utf8");
    expect(lib, '不带 flag ⇒ 别人预置一个 `<lock>.<pid>.tmp` 符号链接，我这一写就写到链接那头').toContain('{ flag: "wx" }');
    expect(lib, "EEXIST 是上一轮自己的残骸（名字带我的 pid）：摘掉重写一次，而不是把整道门砸了").toContain('!== "EEXIST"');
  });
});

describe("临时名只写自己新起的名字：`wx` 与 EEXIST 重写的行为证人（任务 #35）", () => {
  /* 这一格以前只有结构钉（上面那条 `toContain({ flag: "wx" })`）——结构钉看不见**后果**：把 wx 摘掉，代码照样跑到下一步。
   *  行为证人能造出来的关键是：临时名的 pid 就是**我这条判卷自己的 pid**，所以判卷可以提前在那个名字上放东西。
   *  锁面一律落在 `mkdtemp` 出来的临时根里，不碰本机 `.git/dsh-tool-locks`（规则 240：判卷往共享介质写活人状态＝它读到的就是度量机自己）。 */
  const mk = (): string => {
    const d = mkdtempSync(join(tmpdir(), "dsh-lock-wx-"));
    mkdirSync(join(d, "repo"));
    return d;
  };
  const faceOf = (root: string, tree: string): { lockPath: string; tmp: string } => {
    const p = toolLockPath("git", root, "head-cert", tree);
    if (p === null) throw new Error("锁面路径算不出来 ⇒ 这三条量不了（tree 名不合法？）：" + tree);
    return { lockPath: p, tmp: p + "." + String(process.pid) + ".tmp" };
  };
  const acquire = (root: string, tree: string): string =>
    acquireToolLock({ tool: "head-cert", root, tree, target: "a".repeat(40), commonDirOut: "git", harm: "判卷：这三条不许动真机的锁面", say: () => {} }).cell;

  it("临时名上已有一个指向别处的符号链接 ⇒ 链接那头一个字节不许被动，而锁照样占到", () => {
    const d = mk();
    try {
      const root = join(d, "repo");
      const victim = join(d, "victim.txt");
      writeFileSync(victim, "ORIGINAL\n");
      const { lockPath, tmp } = faceOf(root, "witness-a");
      mkdirSync(dirname(lockPath), { recursive: true });
      symlinkSync(victim, tmp); // 别人预置：`<lock>.<我的pid>.tmp` → 指向别处
      expect(acquire(root, "witness-a"), "被符号链接吓住而没占到＝这条没跑到要证的那一步").toContain("本进程持有");
      expect(readFileSync(victim, "utf8"), "这一次写跟着链接走到别人文件里去了 ⇒「只写自己新起的名字」这句承诺没有证人").toBe("ORIGINAL\n");
      expect(parseToolLock(readFileSync(lockPath, "utf8"))?.pid, "锁面要真占到，不是靠没写成功蒙过去").toBe(process.pid);
      expect(existsSync(tmp), "占到之后临时名要清掉：留着就是下一次「跟着已存在的名字写」的入口").toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("临时名上是上一轮自己留的普通残骸 ⇒ 摘掉重写一次就占到，不许把整道门砸了", () => {
    const d = mk();
    try {
      const root = join(d, "repo");
      const { lockPath, tmp } = faceOf(root, "witness-b");
      mkdirSync(dirname(lockPath), { recursive: true });
      writeFileSync(tmp, "上一轮我自己的残骸\n");
      expect(acquire(root, "witness-b"), "EEXIST 是同名残骸，不是抢锁失败：拿它砸门＝一个 pid 撞一次就再也跑不动").toContain("本进程持有");
      expect(parseToolLock(readFileSync(lockPath, "utf8"))?.pid).toBe(process.pid);
      expect(existsSync(tmp), "残骸被摘掉又留下新的临时名＝下一次还要靠帽自愈").toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("反向哨兵：临时名与锁面都不存在 ⇒ 照常占到（上面两条的红不许来自「路径算不出」或「目录建不起来」）", () => {
    const d = mk();
    try {
      const root = join(d, "repo");
      const { lockPath, tmp } = faceOf(root, "witness-c");
      expect(acquire(root, "witness-c")).toContain("本进程持有");
      expect(existsSync(lockPath)).toBe(true);
      expect(existsSync(tmp)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
