/** 第 335 页补二 · #45 的第一步（同分母对照，零花费、只读）：locate-recall 的两道 A 臂 MISS 到底丢在哪一档。
 *  口径全部复用生产端那一支：摘要＝`commentSummary`（帽＝`SUMMARY_MAX_CODEPOINTS`），分词＝`tokensOf`；
 *  本脚本不重写任何摘要逻辑，只回答一句：**问句里的词，生产摘要送出来了多少、整个文件里有没有**。
 *  跑法：node --import tsx outputs/locate-miss-45-2026-10-04/why-miss.mjs */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { commentSummary, SUMMARY_MAX_CODEPOINTS, tokensOf } from "../../src/agent/map/retrieve.ts";

const ROOT = process.cwd();
const QUESTIONS = JSON.parse(readFileSync("fixtures/locate/dsh-questions.json", "utf8"));
const LIST = Array.isArray(QUESTIONS) ? QUESTIONS : (QUESTIONS.questions ?? []);

// 取 HEAD 那份，不取工作树：隔壁正在改 model-surface.ts，工作树内容不是探针跑过的那份。
const atHead = (rel) => {
  const r = spawnSync("git", ["show", "HEAD:" + rel], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
};

const STOP = new Set(["的", "了", "在", "是", "吗", "?"]);
for (const q of LIST) {
  const target = (q.truth ?? [])[0]?.file;
  if (typeof target !== "string") continue;
  const src = atHead(target);
  if (src === null) { console.log(q.id + " 取不到 HEAD 那份：" + target); continue; }
  const sum = commentSummary(src);
  const sumCp = Array.from(sum).length;
  const qTok = [...new Set(tokensOf(String(q.question ?? "")).filter((t) => !STOP.has(t) && t.length >= 2))];
  const inSum = qTok.filter((t) => sum.includes(t));
  const inFile = qTok.filter((t) => src.includes(t));
  const lost = qTok.filter((t) => src.includes(t) && !sum.includes(t));
  const bucket = sumCp === 0 ? "无顶部注释" : (sumCp >= SUMMARY_MAX_CODEPOINTS ? "截在帽上" : "有摘要·未截顶");
  console.log([
    q.id + " shape=" + (q.shape ?? "?") + " target=" + target,
    "档=" + bucket + "（摘要 " + String(sumCp) + " 码点／帽 " + String(SUMMARY_MAX_CODEPOINTS) + "）",
    "问句词 " + String(qTok.length) + " 个：摘要里有 " + String(inSum.length) + "、文件里有 " + String(inFile.length),
    "摘要送不出的（文件里有）＝" + (lost.length === 0 ? "（无）" : lost.slice(0, 8).join("/")),
  ].join("\n  "));
  console.log("  摘要原文：" + (sum.slice(0, 120) || "（空）"));
}
