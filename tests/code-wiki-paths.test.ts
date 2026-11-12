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
// 第 1181 页：地图的 Verification 段不能和门表说反。
// 旧句「The gate manifest contains only core checks」与同文件开头「desktop-test 在 GATES/CERT_GATES」自相矛盾，
// 实测 scripts/gate-manifest.ts 的 GATES/CERT_GATES 两处都含 desktop-test ⇒ 旧句是过期话。
describe("CODE-WIKI 的门禁说明与门表同源（第 1181 页）", () => {
  it("门表确有 desktop-test，且 Verification 段不许再说「只含核心检查」", () => {
    const manifest = read("scripts/gate-manifest.ts");
    // 必须按数组边界切：/GATES[\s\S]*desktop-test/ 会一路吃到 CERT_GATES，
    // 把 GATES 里的条目删光也照样绿（本格第一版真踩到这个假绿）。
    const gates = manifest.slice(manifest.indexOf("export const GATES"), manifest.indexOf("export const CERT_GATES"));
    const certGates = manifest.slice(manifest.indexOf("export const CERT_GATES"));
    expect(gates).toContain('"desktop-test"');
    expect(certGates).toContain('name: "desktop-test"');
    expect(wiki).toContain("`desktop-test` is in both `GATES` and `CERT_GATES`");
    expect(wiki).not.toContain("The gate manifest contains only core checks in this checkout.");
  });
});
