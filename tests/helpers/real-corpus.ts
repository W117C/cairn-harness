/** 真语料取料面（多支判卷共读这一份，别各页各抄一遍——抄两份迟早漂一份）。
 *
 *  为什么是 `fixtures/no-progress`：那是**真跑出来的轨迹**（能力 14 的停滞探针留下的 JSONL），
 *  里面有真 shell 输出、真测试文本、真路径——正是"会改正文的那一支面"最该拿来自查的输入。
 *  分母自己必须出声：读到 0 条 = 没有尺，不是"零膨胀通过"。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 语料目录（相对仓库根）。判卷按根目录相对路径读，与既有各页同一取料口径。 */
export const REAL_CORPUS_DIR = "fixtures/no-progress";

/** 全部 `tool_result` 的原始 output 文本（顺序 = 目录遍历序，逐条一份，不拼接）。 */
export function corpusToolResults(dir: string = REAL_CORPUS_DIR): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(d, n);
      let isDir = false;
      try {
        isDir = readdirSync(p).length >= 0;
      } catch {
        isDir = false;
      }
      if (isDir) walk(p);
      else if (n.endsWith(".jsonl")) {
        for (const line of readFileSync(p, "utf8").split("\n")) {
          if (!line.trim()) continue;
          let e: Record<string, unknown>;
          try {
            e = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (e["type"] === "tool_result") out.push(String(e["output"] ?? ""));
        }
      }
    }
  };
  walk(dir);
  return out;
}

/** 分母读数（供每条判卷自己钉"没有尺"那一格）。 */
export function corpusSize(items: string[]): { n: number; bytes: number } {
  return { n: items.length, bytes: items.reduce((a, b) => a + Buffer.byteLength(b, "utf8"), 0) };
}
