import { closeSync, constants, fstatSync, openSync, readFileSync, type Stats } from "node:fs";

export interface FileSnapshot {
  stat: Stats;
  data: Buffer;
}

/** Read and inspect one stable file descriptor instead of stat-ing a path and
 * then reopening it. Scripts use this for source/artifact inspection only. */
export function readFileSnapshotSync(path: string): FileSnapshot {
  const fd = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${path}: 不是常规文件`);
    return { stat, data: readFileSync(fd) };
  } finally {
    closeSync(fd);
  }
}

export function readTextFileSnapshotSync(path: string): { stat: Stats; text: string } {
  const snap = readFileSnapshotSync(path);
  return { stat: snap.stat, text: snap.data.toString("utf8") };
}
