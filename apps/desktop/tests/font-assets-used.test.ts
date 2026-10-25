/** 字体资产「声明了就必须有人选得中」（2026-10-23）。
 *
 *  动因（实测，不是推理）：`dsh-claude-style.css` 曾声明 `JetBrains Mono` 的**斜体**档，
 *  而全仓 CSS 里没有一处 `font-style: italic` 会选中等宽字体。离屏真 renderer 里读
 *  `document.fonts`：那条 face 的 `status` 是 **`unloaded`**，同时
 *  `[...document.querySelectorAll("*")].some(el => fontStyle==="italic" && mono)` 为 **false**。
 *  ⇒ 那份 TTF 随构建产物发出去、永远不会被下载（产物里 ~300KB）。
 *
 *  **造红记录（手工做，未登记为 JS 变异锚点）**：本判据的被测面是 `.css`，
 *  而 `mutate-needles-check` 的改法语法体检按 **JS** 解析（`@font-face` 不是 JS ⇒
 *  "Expression expected"）。两条锚点因此登记后又撤回——那是工具的适用面问题，不是判据弱。
 *  手工验证过两台：① 把斜体声明加回来 ⇒ 红 2 条；② 把正体声明删掉 ⇒ 红 1 条（反向哨兵）。
 *
 *  本判据钉两件事：
 *   ① adapter 里声明的每个**等宽** face，都必须真的存在一个 `font-style` 会选中它；
 *   ② 反向：不许为了过判据而把声明删光——正体那条必须还在（代码字体是产品面的一部分）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/renderer/", import.meta.url));
const adapter = readFileSync(join(root, "dsh-claude-style.css"), "utf8");

/** 递归收集我们自己的 CSS（vendor/ 下的上游文件不在本判据的管辖内）。 */
function ownCssFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "vendor") continue; // 上游原样文件，不由我们决定
      ownCssFiles(p, acc);
    } else if (name.endsWith(".css")) acc.push(p);
  }
  return acc;
}

describe("字体资产：声明了就必须有人选得中", () => {
  it("★ adapter 里没有声明**斜体等宽**（全仓没有一处 italic + mono 会选中它）", () => {
    // 斜体档一旦被声明，产物里就会多出一份永远不下载的 TTF
    expect(adapter).not.toMatch(/font-style:\s*italic/);
  });

  it("★ 方向二：正体等宽那条**必须还在**（代码字体是产品面，不许为了过判据删光）", () => {
    expect(adapter).toMatch(/font-family:\s*"JetBrains Mono"/);
    expect(adapter).toMatch(/JetBrainsMonoVariable\.ttf/);
  });

  it("我们自己的 CSS 里，italic 只许出现在非等宽语境（若将来加，这条会点名）", () => {
    const own = ownCssFiles(root);
    const offenders: string[] = [];
    for (const f of own) {
      const css = readFileSync(f, "utf8");
      // 找 `font-style: italic` 与同一规则块里的等宽族名
      for (const block of css.split("}")) {
        if (!/font-style:\s*italic/.test(block)) continue;
        if (/JetBrains Mono|monospace|--dsh-claude-font-code/.test(block)) {
          offenders.push(f.replace(root, ""));
        }
      }
    }
    expect(offenders, "等宽 + 斜体 ⇒ 那份斜体 TTF 就该被声明回来（否则它永不加载）").toEqual([]);
  });
});
