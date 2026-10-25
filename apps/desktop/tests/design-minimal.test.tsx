// 设计面·减法判卷（2026-10-22）：「简约」不是口号，得有能钉住的不变量。
//
// 这一批钉四件事（都是**减法**，不是加法）：
//   ① 概览指标**不许**是带框表格——此前「gap:1px ＋ 容器底色画格线 ＋ 每格不透明底」
//      把六个小卡拼成一张 Excel 表（暗色下尤其重）。现在只靠留白与字重分层。
//   ② 概览里的数字**刚变过要闪一下**：概览是运行中盯着看的面，数字自己在变；
//      此前只有「变了」这个事实、没有「刚刚变」的提示。
//   ③ 设置行的说明**独占整行**：此前被关在 220px 标题列里，中文句子折行、末行只剩一个字。
//   ④ 错误正文**降到正文色**：失败的标记已经三重（红三角 / 「N 次失败」红字摘要 / 危险色重试钮），
//      四行散文再整段用危险色是在阅读面里喊。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsRow } from "../src/renderer/components/settings-ui";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const inspector = readFileSync(fileURLToPath(new URL("../src/renderer/components/Inspector.tsx", import.meta.url)), "utf8");
const tokens = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");

/** 一条规则里 animation 简写点名的 var(...)（动画简写里一个 var 就够：令牌自带时长与缓动）。 */
const animationVars = (rule: string): string[] =>
  [...rule.matchAll(/var\(--[a-z0-9-]+\)/g)].map((m) => m[0]);
/** var(--x) → --x（去壳，要去令牌表里查它自己的定义）。 */
const tokenName = (v: string): string => v.replace(/^var\((--[a-z0-9-]+)\)$/, "$1");
/** 令牌自己的定义正文（tokens.css 里那一行）。 */
const tokenBody = (name: string): string =>
  tokens.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? "";

/** 取一个选择器规则块的内容。 */
function block(sel: string): string {
  const i = css.indexOf(`\n${sel} {`);
  if (i < 0) throw new Error(`CSS 块不存在：${sel}`);
  return css.slice(i, css.indexOf("}", i));
}

describe("设计面·减法", () => {
  it("① 概览指标不是带框表格（无外框、无格线、无每格底色）", () => {
    const stats = block(".isp-ov-stats");
    expect(stats).not.toContain("border:");
    expect(stats).not.toContain("background:");
    expect(stats).not.toMatch(/gap:\s*1px/); // 「1px 间隙 + 容器底色」＝画格线那套
    const stat = block(".isp-ov-stat");
    expect(stat).not.toContain("border:");
    expect(stat).not.toContain("background:");
    // 但仍然是两列的指标网格（结构靠留白与字重，不靠框）
    expect(stats).toContain("grid-template-columns: 1fr 1fr");
  });

  it("② 概览数字刚变过要闪一下（值变 ⇒ 闪；不动标签、不位移）", () => {
    expect(css).toContain("@keyframes isp-ov-flash");
    expect(css).toMatch(/\.isp-ov-value-flash\s*{[^}]*animation:\s*isp-ov-flash/s);
    // 动画只碰颜色：不许动位移/缩放（那会变成"跳动"，不是"提示"）
    const key = css.slice(css.indexOf("@keyframes isp-ov-flash"));
    expect(key.slice(0, key.indexOf("}"))).not.toContain("transform");
    // 渲染面：数值走 StatValue（它才有"变了"的记忆），不是裸 dd
    expect(inspector).toContain("function StatValue(");
    expect(inspector).toContain("<StatValue value={value} />");
    expect(inspector).not.toMatch(/<dd className="num">\{value\}<\/dd>/);
  });

  it("②b 承重：那条 animation 简写**要真成立**（两个缓动 ⇒ 整条不成立 ⇒ 类加了、动画没跑）", () => {
    // 坑（2026-10-22 真机自查抓到的）：`--t-slow` 本身已经是「300ms ＋ 缓动」，
    // 简写里再写一次缓动 ⇒ 展开成「300ms cubic-bezier(...) cubic-bezier(...)」
    // ⇒ 第二个缓动落在 **delay 槽位**（那儿只收 <time>）⇒ **整条简写不成立**
    // ⇒ 类加上了、动画一帧没跑（真机读计算样式：animationName="none"）。
    // 而上面 ② 那条只钉「规则里**写着** animation: isp-ov-flash」⇒ 文本对、效果没有 ⇒ 判据空转。
    const rule = block(".isp-ov-value-flash");
    const vars = animationVars(rule);
    expect(vars, "简写里只许一个 var(...)（那个令牌自带时长与缓动）").toHaveLength(1);
    // 且那个令牌必须真的自带缓动，否则简写连 timing-function 都没有（那是不闪，不是简写不成立）。
    expect(tokenBody(tokenName(vars[0]!)), `${vars[0]} 要自带时长与缓动`).toMatch(/var\(--ease-/);
    // 反向：坏形状确实有两个 var（证明上面那条不是恒真）。
    expect(animationVars("animation: isp-ov-flash var(--t-slow) var(--ease-out);")).toHaveLength(2);
  });

  it("③ 设置行说明独占整行（结构断言：它是 .ss-row 的同级，不是 .ss-row-main 的子级）", () => {
    const h = renderToStaticMarkup(
      <SettingsRow label="界面语言" desc="目前只有中文界面；英文界面尚未接入。">
        <select aria-label="locale"><option>中文</option></select>
      </SettingsRow>,
    );
    // 说明紧跟在控件列之后 ⇒ 与标题列、控件列**平级**（独占一行）
    expect(h).toMatch(/class="ss-row-ctl"[\s\S]*?<\/div><span class="ss-row-desc">/);
    // 且标题列在说明之前**已经闭合** ⇒ 说明不在 .ss-row-main 里面
    const between = h.slice(h.indexOf('class="ss-row-main"'), h.indexOf('class="ss-row-desc"'));
    expect(between).toContain("</div>");
    // CSS：跨两列
    expect(block(".ss-row-desc")).toContain("grid-column: 1 / -1");
  });

  it("④ 错误正文降到正文色，失败标记仍然在（红三角 + 危险色重试钮 + 危险色的「N 次失败」）", () => {
    // 标记留在行色（红三角继承行色）
    expect(block(".row.error-row")).toContain("color: hsl(var(--color-danger-ink))");
    // 运行级错误正文降到正文色（这一条在工具失败那两路之前就有，别让新增断言把它替掉）
    expect(block(".row.error-row .t")).toContain("color: hsl(var(--text-200))");
    // 重试钮仍是危险色（它自带色，不受 .meta 影响）
    expect(block(".err-retry")).toContain("color: hsl(var(--color-danger-ink))");

    // 工具失败那一路（2026-10-22 目验补上）：此前这一条只钉**运行级错误行**
    // （`.row.error-row .t`），而**工具失败**的两个面还整段喊——判据对那一路是空转的。
    // ① 折叠摘要：「N 次失败」是**标记**（仍危险色），它后面的失败正文降到正文色。
    expect(block(".tool-group-failure"), "「N 次失败」这个标记必须仍危险色").toContain("color: hsl(var(--color-risk))");
    expect(block(".tool-group-failure-detail"), "失败正文必须降到正文色").toContain("color: hsl(var(--text-200))");
    // ② 展开后的失败输出正文：同样降到正文色（失败标记是那一行的红三角 + 折叠摘要）。
    expect(block(".tool-output[data-failed=\"true\"] pre"), "失败输出正文必须降到正文色").toContain("color: hsl(var(--text-200))");
    // 反向：把失败正文那条改回危险色 ⇒ 上面两条立刻红（证明它们不是恒真）。
    const risky = block(".tool-output[data-failed=\"true\"] pre").replace("hsl(var(--text-200))", "hsl(var(--color-risk))");
    expect(risky).not.toBe(block(".tool-output[data-failed=\"true\"] pre"));
  });

  it("⑤ 这一批不许把动效纪律破了（微反馈仍是 60ms 档）", () => {
    // 缓动：规则**自己**带，或它点的那个令牌带（--t-slow 自带 var(--ease-out)——
    // 简写里**不能**再写一遍：两个缓动会让整条简写不成立，见 ②b）。
    const flashRule = block(".isp-ov-value-flash");
    const easingSomewhere = /var\(--ease-/.test(flashRule)
      || animationVars(flashRule).some((v) => /var\(--ease-/.test(tokenBody(tokenName(v))));
    expect(easingSomewhere, "闪动要有缓动（规则自己带，或它点的令牌带）").toBe(true);
    // 数字闪烁是**数据反馈**（不属 hover/按下微反馈族），用时长 token 表达，不写死毫秒
    expect(css).not.toMatch(/isp-ov-value-flash\s*{[^}]*\d+ms/s);
  });

  it("⑥ 独立窗格窗口不渲染面板导航行（那里是死按钮，还叠成两行同样的字）", () => {
    const dock = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");
    const popout = readFileSync(fileURLToPath(new URL("../src/renderer/components/PopoutApp.tsx", import.meta.url)), "utf8");
    // 导航行在独立窗格窗口里不渲染
    expect(dock).toMatch(/props\.inPopout !== true && \(\s*<nav className="pane-nav"/);
    // 独立窗格窗口确实声明了它
    expect(popout).toMatch(/<PaneDock[\s\S]{0,400}?inPopout/);
    // 「恢复多面板布局」这个按钮在独立窗格窗口里没有对象（只有一个窗格）
    expect(dock).toContain('aria-label="恢复多面板布局"');
  });

  it("⑦ markdown 表格只留横线（阅读面里不摆 Excel）", () => {
    const cell = block(".md-table th, .md-table td");
    expect(cell).not.toContain("border: 1px"); // 每个格子都有边框 ⇒ 竖线把列切碎
    expect(cell).toContain("border: 0");
    // 结构靠两条横线表达：表头下一条（重一点）、行与行之间一条（轻一点）
    expect(css).toMatch(/\.md-table thead th\s*{[^}]*border-bottom:\s*1px solid var\(--hairline-strong\)/s);
    expect(css).toMatch(/\.md-table tbody tr \+ tr td\s*{[^}]*border-top:\s*1px solid var\(--hairline\)/s);
  });
});
