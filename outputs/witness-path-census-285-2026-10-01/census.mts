/** 第 285 页的普查（先量存量，再谈帽）：台账里每一条 `outputs/<目录>/<文件>` 形式的点名，
 *  那个文件在** HEAD 的跟踪清单**里吗？
 *  动因是今天两起同族事故：第 281 页凭证引的三份日志压根没入库（只有 210s 的干净树判卷量得到），
 *  第 284 页声称「第一版原文留着」而那份文件已被同名覆盖（D-9 只抽目录、看不见文件名）。
 *  ⇒ 这一格若做成尺，检测成本从一趟认证降到 docs-check 的 1s 级。
 *  取料面用 `trackedFilesAtHead()`（与 D-10 同一个构造器，规则 345），探针不自己抄一份 git 调用。
 *  哨兵：显式注入一条必然不存在的引用——missing 若为 0，先看哨兵有没有咬住，否则这读数没有意义（规则 322）。 */
import { readFileSync } from "node:fs";
import { trackedFilesAtHead } from "/Users/ze/Downloads/deepseek harness/scripts/docs-check.ts";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const SENTINEL = "outputs/definitely-not-a-real-dir-2026-01-01/witness.log";
const text = readFileSync(ROOT + "/PROGRESS.md", "utf8") + "\n" + SENTINEL;

const tracked = trackedFilesAtHead();
if (tracked === null) { console.log("HEAD 跟踪清单取不到 ⇒ 这次普查不构成读数"); process.exit(1); }

const refs = new Set<string>();
for (const m of text.matchAll(/outputs\/[A-Za-z0-9._/-]+/g)) refs.add(m[0].replace(/[._-]+$/g, ""));

const missingFiles: string[] = [];
const missingDirs: string[] = [];
for (const r of [...refs].sort()) {
  if (r.endsWith("/")) {
    if (![...tracked].some((p) => p.startsWith(r))) missingDirs.push(r);
  } else if (!tracked.has(r)) {
    missingFiles.push(r);
  }
}
const dirRefs = [...refs].filter((r) => r.endsWith("/")).length;
console.log(JSON.stringify({
  headTrackedFiles: tracked.size,
  refsDistinct: refs.size,
  fileRefs: refs.size - dirRefs,
  dirRefs,
  missingFilesCount: missingFiles.length,
  missingDirsCount: missingDirs.length,
  哨兵在缺失名单里: missingFiles.includes(SENTINEL),
}, null, 2));
console.log("--- missing files（前 60 条）---");
for (const p of missingFiles.slice(0, 60)) console.log(p);
