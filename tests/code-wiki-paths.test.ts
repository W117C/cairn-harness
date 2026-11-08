/** 第 938 页：`docs/CODE-WIKI.md` 是「先读它再动手」的那张地图。
 *  地图里的路径必须能走通（此前 `tests/markdown.test.tsx`、`scripts/ui-gallery.cjs` 都少了
 *  `apps/desktop/` 前缀，照抄的人找不到文件）；它引用的判卷字符串也必须还是判卷里的那一条
 *  （`标准 · 窗口 128k` 在第 937 页改成 `128.0k` 之后，地图上的引文就成了旧话）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const wiki = read("docs/CODE-WIKI.md");

/** 地图里的路径引用：只认仓库根相对的写法（`src/…`、`apps/desktop/…`、`scripts/…`、`tests/…`、`docs/…`）。 */
function wikiPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w/.-])((?:src|apps\/desktop|scripts|tests|docs)\/[\w./-]+\.(?:tsx|ts|mjs|cjs|md))/gu)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

describe("CODE-WIKI 是一张能走通的地图（第 938 页）", () => {
  it("每条路径都按仓库根解析得到", () => {
    const paths = wikiPaths(wiki);
    expect(paths.length).toBeGreaterThan(10); // 地图至少得指到十来个文件，太少说明扫描面坏了
    const missing = paths.filter((p) => !existsSync(join(ROOT, p)));
    expect(missing, "地图里这些路径按仓库根找不到：" + missing.join(" | ")).toEqual([]);
  });

  it("引用的判卷字符串与 render-structure 的钉子逐字一致", () => {
    const quoted = /`标准 · 窗口 [^`]+`/u.exec(wiki)?.[0];
    expect(quoted, "地图里那句「标准 · 窗口 …」的引文不见了").toBeDefined();
    const inner = quoted!.slice(1, -1);
    expect(read("apps/desktop/tests/render-structure.test.tsx")).toContain(inner);
  });
});
