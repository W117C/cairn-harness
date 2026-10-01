/** 第 285 页普查（**宽分面版**）：整本台账里每一条 `outputs/<目录>/<文件>` 形式的点名，在 HEAD 里追得到吗？
 *  动因是同一天的两起事故：第 281 页凭证引的三份日志没随页入库（只有 210s 的干净树判卷量得到，规则 346）；
 *  第 284 页声称「第一版原文留着」而那份日志已被同名覆盖（D-9 只抽目录、看不见文件名）。
 *  ⚠️ 这一版是**上线前的宽度试验**：D-11 最终按凭证页取分面（见 `classify2.mts`），因为整本台账会把 09-26 时代
 *  那 61 条老账算进来——那是另一件事，不该混进这一笔（规则 345 的分面宽度）。
 *  ⚠️ 本文件在第 285 页里改过一次：`checkWitnessPaths` 的入参从「点名字符串数组」换成「凭证页数组」
 *  （形状跟着判据走）。旧证人 `classify.log` 一字不改地留着，这一趟的复跑落在 `classify-v2.log`——
 *  「探针自己抄一份取料面、接口一改就静默烂掉」是第 284 页那根 `cred-face.mts` 的教训（规则 345），
 *  这次的做法是**改探针并复跑**，而不是留一份没人重跑的脚本在仓里烂着。
 *  取料面用 `trackedFilesAtHead()`（与 D-10 同一个构造器），探针不自己抄一份 git 调用。
 *  哨兵：拿空 HEAD 清单跑同一把尺，必须把每一条点名都读成 miss（否则「61」这个数可能是「压根没检查」）。 */
import { existsSync, readFileSync } from "node:fs";
import { checkWitnessPaths, credentialPages, ledgerWitnessRefs, trackedFilesAtHead, type CredPage } from "/Users/ze/Downloads/deepseek harness/scripts/docs-check.ts";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const text = readFileSync(ROOT + "/PROGRESS.md", "utf8");
const tracked = trackedFilesAtHead();
if (tracked === null) { console.log("HEAD 跟踪清单取不到 ⇒ 这次普查不构成读数"); process.exit(1); }

// 宽分面：整本台账的点名，包成一张假页喂给尺（尺只认 page.refs，不再认散装数组）。
const refs = ledgerWitnessRefs(text);
const wide: CredPage[] = [{ key: "整本台账", title: "宽分面试验（非上线口径）", dirs: [], numbers: [], shas: [], refs }];
const res = checkWitnessPaths(wide, tracked, []);
const miss = res.findings.map((f) => /点名 ([^\s，]+)，但 HEAD/u.exec(f.detail)?.[1] ?? "");
const gone = miss.filter((p) => p !== "" && !existsSync(ROOT + "/" + p.replace(/\/$/u, "")));

// 哨兵：同一张面喂空清单 ⇒ 每一条点名都该红。
const emptyFace = checkWitnessPaths(wide, new Set<string>(), []);
console.log(JSON.stringify({
  headTrackedFiles: tracked.size,
  refsTotal: res.refs,
  fileRefs: refs.filter((r) => !r.endsWith("/")).length,
  dirRefs: refs.filter((r) => r.endsWith("/")).length,
  missTotal: res.findings.length,
  miss且盘上还在: res.findings.length - gone.length,
  miss且盘上也没有: gone.length,
  哨兵_空清单下点名全红: emptyFace.findings.length,
  哨兵_与refsTotal同值: emptyFace.findings.length === res.refs,
  哨兵_凭证页分面条数: checkWitnessPaths(credentialPages(text), new Set<string>(), []).refs,
}, null, 2));
console.log("--- 逐条 miss（带在盘分类）---");
for (const p of miss) console.log((p !== "" && existsSync(ROOT + "/" + p.replace(/\/$/u, "")) ? "在盘 " : "无盘 ") + p);
