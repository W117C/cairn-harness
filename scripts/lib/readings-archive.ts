// 读数归档（#63，2026-10-05 第 379 页）：覆盖 `readings.json` 之前先把旧的按「树号＋时刻」改名存档。
//
// **为什么抽成带注入 IO 的函数**：第一版把这段逻辑直接写在 `scripts/loop-eval.ts` 里，
// 判卷只能扫源码字符串——结果造红时把 `if (existsSync(...))` 改成 `if (false) { … }`，
// 两种写法**含同一批字符串**，判卷照绿。那就是"只钉有这句话"的形状断言，什么都证明不了。
// 抽出来之后判卷喂真行为：`exists` 说 true ⇒ 必须真调 rename 且参数是那对名字；
// 说 false ⇒ 一次都不许调。"有没有真跑"这件事因此可判。
//
// 语义边界（刻意收窄）：
//   · 只负责**归档**，不负责写新文件——写入留在脚本里（那是流程，不是判据）。
//   · 名字里带 `headSha.slice(0,7)` 与调用方给的时刻戳；**时刻由调用方给**，本函数不读钟
//     （读钟的函数不可单测，这是本仓对"纯函数面"的既有要求）。

export interface ReadingsArchiveOps {
  /** 这个路径在不在。 */
  exists: (path: string) => boolean;
  /** 改名（**不是复制**：复制会留下两份同名读数，正是本条要防的）。 */
  rename: (from: string, to: string) => void;
}

export interface ReadingsArchiveInput {
  /** 产物目录（`--out` 那一格）。 */
  dir: string;
  /** 要归档的那一份的完整路径（通常是 `dir/readings.json`）。 */
  readingsPath: string;
  /** 当前 HEAD（取不到时调用方传 "unknown"）。 */
  headSha: string;
  /** 时刻戳（ISO 串）；由调用方给，本函数不读钟。 */
  nowIso: string;
  ops: ReadingsArchiveOps;
}

/** 归档上一份读数；没有旧的就什么都不做。返回归档后的路径（没归档则 null）。
 *
 *  `nowIso` 里的 `:` 与 `.` 会在文件名里变成路径分隔外的非法/难读字符，一律换成 `-`。 */
export function archiveExistingReadings(input: ReadingsArchiveInput): string | null {
  const { dir, readingsPath, headSha, nowIso, ops } = input;
  if (!ops.exists(readingsPath)) return null;
  const stamp = nowIso.replace(/[:.]/gu, "-");
  const archived = dir + "/readings-" + headSha.slice(0, 7) + "-" + stamp + ".json";
  ops.rename(readingsPath, archived);
  return archived;
}
