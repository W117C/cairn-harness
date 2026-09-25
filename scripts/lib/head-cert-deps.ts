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
