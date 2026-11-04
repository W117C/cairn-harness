// 设计面·减法判卷（2026-10-22）：「简约」不是口号，得有能钉住的不变量。
//
// 钉住的不变量（都是**减法**，不是加法）：
//   ③ 设置行的说明**独占整行**：此前被关在 220px 标题列里，中文句子折行、末行只剩一个字。
//   ④ 错误正文**降到正文色**：失败的标记已经三重（红三角 / 「N 次失败」红字摘要 / 危险色重试钮），
//      四行散文再整段用危险色是在阅读面里喊。
//   ①② 概览指标/数字闪烁两条随检查器统计页一起撤下（2026-11-03 业主：右栏不装用量仪表）。
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsRow } from "../src/renderer/components/settings-ui";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

/** 取一个选择器规则块的内容。 */
function block(sel: string): string {
  const i = css.indexOf(`\n${sel} {`);
  if (i < 0) throw new Error(`CSS 块不存在：${sel}`);
  return css.slice(i, css.indexOf("}", i));
}

describe("设计面·减法", () => {
  it("③ 设置行：标题/说明同列上下排（说明在 .ss-row-main 内），控件靠右垂直居中（2026-10-24 参照 ChatGPT 设置）", () => {
    const h = renderToStaticMarkup(
      <SettingsRow label="界面语言" desc="目前只有中文界面；英文界面尚未接入。">
        <select aria-label="locale"><option>中文</option></select>
      </SettingsRow>,
    );
    // 说明在标题之后、同在 .ss-row-main 里（拿到整条左列宽度，中文长句不碎行）
    const main = h.slice(h.indexOf('class="ss-row-main"'), h.indexOf('class="ss-row-ctl"'));
    expect(main.indexOf("ss-row-label")).toBeGreaterThan(-1);
    expect(main.indexOf("ss-row-desc")).toBeGreaterThan(main.indexOf("ss-row-label"));
    expect(main).toContain("目前只有中文界面");
    // CSS：左列 1fr、控件列 auto 靠右垂直居中；说明不再跨两列
    expect(block(".ss-row")).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(block(".ss-row")).toContain("align-items: center");
    expect(block(".ss-row-desc")).not.toContain("grid-column");
    expect(block(".ss-row-ctl")).toContain("justify-content: flex-end");
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

  it("⑥ 过程轨与交付卡落在正文阅读列内（失败摘要限 72ch，交付卡左 --rail-gutter / 右读同一条 stop 变量）", () => {
    // 2026-10-28 第 736 页：失败摘要原先一行铺到 990px；交付卡左缘比正文少 28px、右缘多 56px。
    // 2026-11-01 第 862 页：交付卡与助手行原本各抄一份 clamp 字面量 ⇒ 公式一改就漂；
    // 现在四处（助手行 / 思考带 / 工具簇 / 交付卡）统一读 `.reading` 上声明的那一条变量。
    expect(block(".tool-group-failure")).toContain("max-width: 72ch");
    const card = block(".changes-card");
    // 2026-11-02 形状适配：顶距那一格从 --space-sm 改成 --turn-gap（署名条浮层必须落在
    // 卡片之上，理由与读数记在 conversation-rail 判卷 ⑨）。本条钉的是**左轨与右缘**，
    // 那两格逐字不动；顶距不是本条的意图，随产品口径更新。
    expect(card).toMatch(/margin:\s*var\(--turn-gap\)\s*var\(--cds-assistant-message-text-stop\)\s*var\(--space-sm\)\s*var\(--rail-gutter\)/);
    expect(card).not.toContain("clamp(0px, (100% - 384px)");
  });

  it("⑥ 独立窗格窗口不渲染面板导航行（那里是死按钮，还叠成两行同样的字）", () => {
    const dock = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");
    const popout = readFileSync(fileURLToPath(new URL("../src/renderer/components/PopoutApp.tsx", import.meta.url)), "utf8");
    // 导航行在独立窗格窗口里不渲染
    expect(dock).toMatch(/props\.inPopout !== true && \(\s*<nav className="pane-nav"/);
    // 独立窗格窗口确实声明了它
    expect(popout).toMatch(/<PaneDock[\s\S]{0,400}?inPopout/);
    // 2026-10-24 单窗格模式：「恢复多面板布局」按钮随网格整体撤下（主窗也没有了）。
    expect(dock).not.toContain('aria-label="恢复多面板布局"');
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

describe("次级说明不许替布局说话（2026-11-01 第 866 页 · 业主口径「让布局说话」）", () => {
  /** 设置面的行/分区/页级次级说明总量（棘轮：只准调低）。 */
  const SETTINGS_DIR = fileURLToPath(new URL("../src/renderer/components/settings", import.meta.url));
  const SETTINGS_FILES = [
    "../src/renderer/components/settings-sections.tsx",
    ...readdirSync(SETTINGS_DIR).filter((f) => f.endsWith(".tsx")).sort().map((f) => `../src/renderer/components/settings/${f}`),
  ];
  const descs = SETTINGS_FILES
    .map((rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"))
    .join("\n");

  it("条数帽 36：新增一条 desc 就要先说清布局为什么说不清", () => {
    const n = (descs.match(/\bdesc=/g) ?? []).length;
    expect(n, `设置面次级说明 ${n} 条 > 帽 36（本批从 47 减到 36；要加回去请连理由一起改帽并写进台账）`).toBeLessThanOrEqual(36);
  });

  it("行、分区和页面的 desc 不许复述标题", () => {
    const pairs = [...descs.matchAll(/(?:label|title)=\{?"([^"]{2,})"\s+desc=\{?"([^"]{2,})"/g)];
    // 2026-11-04 本批撤掉 telemetryDesc（徽章「未收集」已经说完）⇒ 成对样本 8→7。
    // 这是防空转的下限，不是产品断言；只准跟着 desc 总量一起调低，不许为了让红变绿加回来。
    expect(pairs.length, "至少要真扫到成对的 label+desc，否则这条判卷是空转的").toBeGreaterThanOrEqual(7);
    const echoes = pairs.filter(([, label, desc]) => desc.includes(label.slice(0, 4))).map(([, l, d]) => `${l} → ${d}`);
    expect(echoes, "次级说明在复述行标签：" + echoes.join(" ｜ ")).toEqual([]);
  });

  it("被撤掉的复述句不许悄悄回来（逐句点名，改动要有台账页）", () => {
    for (const gone of [
      "目前只有中文界面", "也可用 ⌘⇧[ / ⌘⇧] 切换", "排查问题时对照日志使用的工程细节",
      "连接搜索服务，让助手查找网页", "开启后，助手可在对话中请求检索网页", "连接你信任的本地搜索服务时开启",
      "macOS 侧栏半透明；默认关", "这是默认值；", "重新显示首屏的七项设置检查", "窗口不在前台时发系统通知",
    ]) {
      expect(descs, `这句是布局/标签已经说过的：${gone}`).not.toContain(gone);
    }
  });
});
