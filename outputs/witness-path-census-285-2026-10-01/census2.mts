/** 第 285 页普查第二版（`census.mts` 的第一版留着，理由见它自己的 log：按规则「证人只追加不覆盖」）。
 *  第一版的取料面是错的：它把路径字符集限定成 ASCII，而本仓 dated 目录里的真文件名**带中文**
 *  （`01-针脚收的是一个名字时那35处副本没有一处能替它作证.md`），于是 35 条「缺失」里绝大多数是我自己截断出来的假红。
 *  ⇒ 这一版按「已知形状」收：只收 `outputs/<主题>-YYYY-MM-DD/` 这一族（那就是证人面本身），
 *  段名允许中文，只在句子边界（空白、反引号、成对/列举标点）处停；带 `*?{}` 的当成模式跳过；
 *  每条 miss 另印「同目录里同前缀的真文件」，用来分「被截断」与「真不存在」——不看命中内容就定判据是第二次犯同族错。 */
import { readFileSync } from "node:fs";
import { trackedFilesAtHead } from "/Users/ze/Downloads/deepseek harness/scripts/docs-check.ts";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const SENTINEL = "outputs/definitely-not-a-real-dir-2026-01-01/witness.log";
const text = readFileSync(ROOT + "/PROGRESS.md", "utf8") + "\n" + SENTINEL;

const tracked = trackedFilesAtHead();
if (tracked === null) { console.log("HEAD 跟踪清单取不到 ⇒ 这次普查不构成读数"); process.exit(1); }

const STOP = String.fromCharCode(0x3000);
const BOUNDARY = new Set([" ", "\t", "\n", "`", "、", "，", "。", "（", "）", "(", ")", "[", "]", "【", "】", "「", "」", "『", "』", "《", "》", "|", "｜", "；", ";", "：", ":", "'", '"', "!", "？", "?", ",", STOP]);
const RE = /outputs\/([A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2})(\/[^\s`]*)?/g;

const refs = new Map<string, "dir" | "file">();
for (const m of text.matchAll(RE)) {
  const dir = m[1]!;
  let rest = m[2] ?? "";
  if (rest === "") { refs.set(`outputs/${dir}/`, "dir"); continue; }
  rest = rest.slice(1);
  let i = 0;
  while (i < rest.length && !BOUNDARY.has(rest[i]!)) i++;
  rest = rest.slice(0, i).replace(/[.,_:-]+$/g, "");
  if (rest === "") { refs.set(`outputs/${dir}/`, "dir"); continue; }
  if (/[*?{}]/u.test(rest)) continue;                       // 模式而不是路径
  refs.set(`outputs/${dir}/${rest}`, "file");
}

const dirsWithFiles = new Map<string, string[]>();
for (const p of tracked) {
  const m = /^outputs\/([A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2})\/([^/]+)$/u.exec(p);
  if (!m) continue;
  const list = dirsWithFiles.get(m[1]!) ?? [];
  list.push(m[2]!);
  dirsWithFiles.set(m[1]!, list);
}

const missing: { ref: string; kind: string; samePrefix: string[] }[] = [];
for (const [ref, kind] of [...refs].sort()) {
  if (kind === "dir") {
    const d = /outputs\/([^/]+)\/$/u.exec(ref)![1]!;
    if (!dirsWithFiles.has(d)) missing.push({ ref, kind, samePrefix: [] });
    continue;
  }
  if (tracked.has(ref)) continue;
  const name = ref.slice(ref.lastIndexOf("/") + 1);
  const d = /outputs\/([^/]+)\//u.exec(ref)![1]!;
  missing.push({ ref, kind, samePrefix: (dirsWithFiles.get(d) ?? []).filter((f) => f.startsWith(name.slice(0, 10))).slice(0, 2) });
}
const trueMissing = missing.filter((x) => x.samePrefix.length === 0);
console.log(JSON.stringify({
  headTrackedFiles: tracked.size,
  datedRefsDistinct: refs.size,
  fileRefs: [...refs.values()].filter((k) => k === "file").length,
  dirRefs: [...refs.values()].filter((k) => k === "dir").length,
  missTotal: missing.length,
  miss且同目录没有同前缀文件: trueMissing.length,
  miss且能对上同前缀_即疑似截断: missing.length - trueMissing.length,
  哨兵在缺失名单里: missing.some((x) => x.ref === SENTINEL),
}, null, 2));
console.log("--- 同目录里找不到同前缀文件的 miss（这些才是真候选）---");
for (const x of trueMissing.slice(0, 40)) console.log(x.kind, x.ref);
