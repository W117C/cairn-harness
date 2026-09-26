/** 「去认证一棵树之前，它的依赖配不配得上那棵树」——纯函数，供 `tests/head-cert-deps.test.ts` 消费。
 *  不碰盘、不起进程：取料（`git show <rev>:package.json`、`ls node_modules`）由调用方做。
 *
 * 为什么单独一层（第 84 页实踩两次）：隔离 worktree 的 `node_modules` 通常是从**主树**硬链接来的，
 * 而主树的依赖集反映的是**未提交**的那笔改动（core-only 迁移把 `electron` 摘了）。
 * 拿它去认证仍然含桌面层的 HEAD，`tsc` 直接 `TS2307: Cannot find module 'electron'`——
 * 这是**环境假红**，很容易被读成"HEAD 本来就红"（与规则 87/103 同族：软链树对 `run_shell` 面造假红、
 * 新装树没有 `electron/dist` 的 ENOENT 不是代码红）。所以认证的第一步是核依赖集，不是跑门。 */

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
  let scripts: Set<string>;
  try {
    const pkg = JSON.parse(pkgJsonText) as { scripts?: Record<string, unknown> };
    scripts = new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    return null;
  }
  return { gates, withoutScript: gates.filter((g) => !scripts.has(g)) };
}
