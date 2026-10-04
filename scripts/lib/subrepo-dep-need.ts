/** 为什么单独一层：`head-cert` 那支脚本会写盘（硬链接 `node_modules`）、起进程，判卷碰不到它；
 *  而「这个子包到底要不要 node_modules」是一把纯尺，取料（读 `package.json` 文字）由调用方给——与 `head-cert-deps.ts` 同纪律。
 *  为什么 fail-closed：读不到／坏 JSON／顶层不是对象一律回「要补依赖」。把「说不清」放行等于让零依赖判定
 *  覆盖到它没量过的目录，而那一格的产物正是「判卷红不可归因于代码」那张免罪符——只能往安全那一侧倒。 */

/** `dependencies` + `devDependencies` 的键数之和（只数这两面：`optionalDependencies`／`peerDependencies` 可以合法不装）。
 *  解析失败、顶层不是对象（含数组与标量）、或某一面「在却不是对象」⇒ **null**＝说不清，由调用方按 fail-closed 处置。 */
export function declaredDepCount(pkgJsonText: string): number | null {
  let parsed: unknown;
  try { parsed = JSON.parse(pkgJsonText) as unknown; } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const pkg = parsed as Record<string, unknown>;
  let total = 0;
  for (const field of ["dependencies", "devDependencies"] as const) {
    const map = pkg[field];
    if (map === undefined) continue;
    if (typeof map !== "object" || map === null) return null;
    total += Object.keys(map as Record<string, unknown>).length;
  }
  return total;
}

/** 这个子包需不需要自己的 `node_modules`：null（说不清）⇒ true；有声明 ⇒ true；恰好 0 项 ⇒ false。 */
export function needsNodeModules(pkgJsonText: string): boolean {
  const count = declaredDepCount(pkgJsonText);
  return count === null ? true : count > 0;
}
