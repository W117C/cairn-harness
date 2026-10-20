// 原子写：临时文件 + rename。全仓九处持久化各自抄过一份同款实现，而它们算出的临时名只精确到
// 「pid + 毫秒」——那次硬化（审查 P3 / S2-11 同族）治的是**跨进程**固定名覆写，同进程同一毫秒的
// 两笔写算出来的还是同一个名字：先 rename 的把临时文件搬走，后 rename 的抛 ENOENT。
// 两台已实锤：
//  - 设置面 = 可见真红（panels-check B3b）：每帧 renderSide 一笔 layout 写，撞掉刚点的「深色」；
//  - 学习面 = 静默丢弃：orchestrator.rewardBandit 按侧信道纪律只 console.warn，同毫秒收队的
//    并行 worker 那一笔后验就此不见（tests/bandit-runtime.test.ts 24 笔并发实测）。
// 所以临时名再加一个进程内单调序号：序号只在同进程内有意义，跨进程仍由 pid 分开。
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

let seq = 0;

/** 临时名 = 目标路径 + `.tmp-<pid>-<毫秒>-<进程内序号>`。导出只为让判据能钉住这个形状。 */
export function tmpPathFor(path: string, at = Date.now()): string {
  seq += 1;
  return path + ".tmp-" + String(process.pid) + "-" + String(at) + "-" + String(seq);
}

/** 覆盖式写（父目录自动建）。失败时清掉自己留下的临时文件，不把半成品留在盘上。 */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = tmpPathFor(path);
  try {
    await writeFile(tmp, text, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
