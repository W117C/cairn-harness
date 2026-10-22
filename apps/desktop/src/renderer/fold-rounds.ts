/** 「折叠全部」的轮集：保留最后一轮（正在读/正在跑的那轮不折）。 */
export function foldAllButLast(rounds: readonly number[]): ReadonlySet<number> {
  return new Set(rounds.slice(0, -1));
}

