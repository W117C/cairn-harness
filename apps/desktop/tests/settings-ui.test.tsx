// 批 6（《全局 UI 视觉重构》总纲阶段 2 公共组件 + 细则 §六 设置页）：
// SettingsPage（20px 标题 + ≤960px 内容列，2026-10-16 模型/通道页重做 A/B）/
// SettingsSection（caption 档 tertiary 组标题在卡上方 + surface 卡 14 圆角）/
// SettingsRow（220px 标题列 + 弹性控件列左对齐、56px 行高、1px 分隔线、窄宽单列，2026-10-16 C）/
// Field/Badge/StatusDot（控件 36px/8px 四态、徽章、状态点，2026-10-16 新增）/
// EmptyState（图标+标题+说明+主按钮）/ OptionCard（单选卡：选中强调描边淡底、danger 档危险色）/
// Banner（信息/警告 + 可折叠「查看详情」）。
// 组标题字号口径（细则三处一致「caption 档 tertiary」优先于总纲「15px/600」——克制小标签式；页面标题承担 20px）。
// 2026-10-21：caption-xs 按业主 §4.4 由 12.5 改回 11（`--fs-caption-xs` = 0.6875rem），
// 于是本处不再钉死具体像素，只钉「吃 caption 刻度」这一事实。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readAppSurface } from "./helpers/app-surface";
import { Badge, Banner, EmptyState, Field, OptionCard, SettingsPage, SettingsRow, SettingsSection, StatusDot } from "../src/renderer/components/settings-ui";
import { ShortcutsSection } from "../src/renderer/components/settings-sections";

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const refinementPath = new URL("../src/renderer/components/settings-refinement.css", import.meta.url);
const refinement = existsSync(refinementPath) ? readFileSync(refinementPath, "utf8") : "";
function block(css: string, sel: string): string {
  const i = css.indexOf(`\n${sel} {`);
  if (i < 0) throw new Error(`CSS 块不存在：${sel}`);
  return css.slice(i, css.indexOf("}", i));
}

describe("批 6：设置页公共组件（SSR 结构）", () => {
  it("SettingsPage：20px 页面标题 + ≤720px 内容列", () => {
    const h = renderToStaticMarkup(<SettingsPage title="通用"><div id="x" /></SettingsPage>);
    expect(h).toContain("ss-page");
    expect(h).toContain("ss-title");
    expect(h).toContain("通用");
    expect(h).toContain("ss-content");
    expect(h).toContain('id="x"');
  });

  it("SettingsSection：caption 档组标题在卡上方（hint 可选）+ surface 卡容器", () => {
    const h = renderToStaticMarkup(
      <SettingsSection title="外观" hint="主题与密度">
        <div id="row" />
      </SettingsSection>,
    );
    expect(h).toContain("ss-sec");
    expect(h).toContain("ss-sec-head");
    expect(h).toContain("外观");
    expect(h).toContain("主题与密度");
    expect(h).toContain("ss-card");
    expect(h).toContain('id="row"');
    const bare = renderToStaticMarkup(<SettingsSection title="快捷键"><span /></SettingsSection>);
    expect(bare).not.toContain("ss-sec-hint");
  });

  it("页面标题与说明组成独立页头，分组名使用真正的二级标题", () => {
    const h = renderToStaticMarkup(
      <SettingsPage title="通用" desc="外观、文字与输入习惯。">
        <SettingsSection title="外观"><div /></SettingsSection>
      </SettingsPage>,
    );
    expect(h).toContain('<header class="ss-head"><h1 class="ss-title">通用</h1><p class="ss-desc">外观、文字与输入习惯。</p></header>');
    expect(h).toContain('<h2 class="ss-sec-title">外观</h2>');
  });

  it("快捷键速查：双列键帽+说明，13 行；窄窗一列", () => {
    const h = renderToStaticMarkup(<ShortcutsSection />);
    expect(h).toContain('class="kx-list"');
    expect(h).toContain('<kbd class="kx-keys">⌘N</kbd>');
    expect(h).toContain('class="kx-what">新任务');
    expect((h.match(/class="kx-row"/g) ?? []).length).toBe(13);
    expect(h).toContain("完整速查表");
    const list = block(styles, ".kx-list");
    expect(list).toContain("repeat(2, minmax(0, 1fr))");
    expect(block(styles, ".kx-row")).toContain("grid-template-columns: 108px minmax(0, 1fr)");
    expect(block(styles, ".kx-keys")).toContain("font-family: var(--mono)");
    expect(styles).toContain("@media (max-width: 760px)");
  });

  it("SettingsRow：左标题+说明、右控件；desc 可选", () => {
    const h = renderToStaticMarkup(
      <SettingsRow label="界面语言" desc="菜单与提示文案的语言">
        <select aria-label="locale"><option>中文</option></select>
      </SettingsRow>,
    );
    expect(h).toContain("ss-row");
    expect(h).toContain("ss-row-label");
    expect(h).toContain("界面语言");
    expect(h).toContain("ss-row-desc");
    expect(h).toContain("菜单与提示文案的语言");
    expect(h).toContain("ss-row-ctl");
    expect(h).toContain("locale");
    const bare = renderToStaticMarkup(<SettingsRow label="版本"><span /></SettingsRow>);
    expect(bare).not.toContain("ss-row-desc");
  });

  it("EmptyState：图标+标题+说明+按钮；说明/按钮可缺省不占位", () => {
    const h = renderToStaticMarkup(
      <EmptyState
        icon={<svg data-ico="1" />}
        title="还没有技能"
        desc="在输入框输入技能名即可调用。"
        action={<button className="mini-btn primary">新建任务</button>}
      />,
    );
    expect(h).toContain("ss-empty");
    expect(h).toContain('data-ico="1"');
    expect(h).toContain("还没有技能");
    expect(h).toContain("在输入框输入技能名即可调用。");
    expect(h).toContain("新建任务");
    const bare = renderToStaticMarkup(<EmptyState title="还没有记忆" />);
    expect(bare).not.toContain("ss-empty-desc");
    expect(bare).not.toContain("ss-empty-action");
  });

  it("OptionCard：单选圆点 + 标题/说明上下排；选中 = aria-checked + on 类；danger 档危险色", () => {
    const h = renderToStaticMarkup(
      <OptionCard checked title="引导 · 按风险放行" desc="低风险自动、高风险出卡" onSelect={() => undefined} />,
    );
    expect(h).toContain("ss-opt");
    expect(h).toContain('role="radio"');
    expect(h).toContain('aria-checked="true"');
    expect(h).toContain("ss-opt on");
    expect(h).toContain("ss-opt-dot");
    expect(h).toContain("低风险自动、高风险出卡");
    const danger = renderToStaticMarkup(
      <OptionCard checked={false} danger title="自动 · 免审批" desc="危险：全部放行（出网仍审批）" warn="仅在你确知后果时使用" onSelect={() => undefined} />,
    );
    expect(danger).toContain("danger");
    expect(danger).toContain('aria-checked="false"');
    expect(danger).toContain("ss-opt-warn");
    expect(danger).toContain("仅在你确知后果时使用");
  });

  it("Banner：tone 类；有详情时出「查看详情」折叠（原生 details），无详情不出", () => {
    const withDetails = renderToStaticMarkup(
      <Banner tone="warn" details={<code>{'{"search":{}}'}</code>}>
        联网搜索未配：web_search 工具不会出现
      </Banner>,
    );
    expect(withDetails).toContain("ss-banner");
    expect(withDetails).toContain("warn");
    expect(withDetails).toContain("联网搜索未配");
    expect(withDetails).toContain("<details");
    expect(withDetails).toContain("查看详情");
    const bare = renderToStaticMarkup(<Banner tone="info">桌面端调度器已接线</Banner>);
    expect(bare).toContain("info");
    expect(bare).not.toContain("<details");
  });
});

describe("批 6：设置页公共组件（CSS 口径哨兵）", () => {
  it("设置页加载局部样式：紧凑无衬线标题，760px 内容列与全宽滚动容器", () => {
    expect(readAppSurface().includes('import "./settings-refinement.css"')).toBe(true);
    const t = block(refinement, ".sp-page .ss-head > .ss-title");
    expect(t).toContain("font-family: inherit");
    expect(t).toContain("font-size: 22px");
    expect(t).toContain("font-weight: var(--fw-semibold)");
    expect(t).toContain("letter-spacing: -0.02em");
    const page = block(refinement, ".sp-page .sp-body > .ss-page");
    expect(page).toContain("max-width: 760px");
    expect(page).toContain("margin: 0 auto");
    expect(block(refinement, ".sp-page .sp-body")).not.toContain("max-width");
  });

  it("分组靠间距与细线分层，正文不再包嵌套外卡片", () => {
    const title = block(refinement, ".sp-page .ss-sec-head > .ss-sec-title");
    expect(title).toContain("font-family: inherit");
    expect(title).toContain("font-size: var(--fs-body-md)");
    expect(title).toContain("font-weight: var(--fw-semibold)");
    const card = block(refinement, ".sp-page .ss-card");
    expect(card).toContain("border: 0");
    expect(card).toContain("border-radius: 0");
    expect(card).toContain("background: transparent");
    expect(block(refinement, ".sp-page .ss-content > .ss-sec + .ss-sec")).toContain("border-top: 1px solid var(--hairline)");
  });

  it("表单标签稳定占一列，控件可收缩；窄内容列回落单列防止挤成碎字", () => {
    const row = block(refinement, ".sp-page .ss-row");
    expect(row).toContain("grid-template-columns: minmax(150px, 1fr) minmax(0, 1.5fr)");
    expect(row).toContain("align-items: center");
    expect(row).toContain("min-height: 60px");
    expect(block(refinement, ".sp-page .ss-row-ctl")).toContain("justify-content: flex-end");
    expect(refinement).toMatch(/@container \(max-width: 560px\)[\s\S]*\.sp-page \.ss-row \{ grid-template-columns: minmax\(0, 1fr\)/);
    expect(refinement).toMatch(/@container \(max-width: 560px\)[\s\S]*\.sp-page \.ss-row-ctl \{ justify-content: flex-start/);
    expect(block(refinement, ".sp-page .pv-detail .ss-frow .ss-field")).toContain("min-width: 0");
    expect(refinement).toContain('.sp-page .pv-split { grid-template-columns: minmax(0, 1fr);');
  });

  it(".ss-opt 选中 = 强调描边 + 淡底；danger 档 = 危险色描边（不铺大红底）", () => {
    const on = styles.match(/\.ss-opt\.on \{[^}]*\}/) ?? [""];
    expect(on[0]).toContain("accent-control");
    expect(styles).toContain(".ss-opt.danger .ss-opt-title");
    expect(styles).toMatch(/\.ss-opt\.danger \{[^}]*color-danger/);
  });

  it(".ss-empty 垂直居中、不摆统计卡（无背景/无统计节点）", () => {
    const e = block(styles, ".ss-empty");
    expect(e).toContain("align-items: center");
    expect(e).not.toContain("background: hsl(var(--bg-000))");
  });
});

// 2026-10-16（模型/通道页重做）：控件契约三件——Field（36px/8px/四态/自绘箭头）、
// Badge（已存 key 徽章）、StatusDot（联网搜索状态点）。判卷钉形态与 CSS 定值两面。
describe("2026-10-16：控件契约三件（Field / Badge / StatusDot）", () => {
  const tokens = readFileSync(new URL("../src/renderer/tokens.css", import.meta.url), "utf8");

  it("Field：宽度档 data-w + select 自绘箭头；CSS 定 36px / --radius-field / 禁用降透明", () => {
    const h = renderToStaticMarkup(
      <Field width="lg" select><select aria-label="x"><option>a</option></select></Field>,
    );
    expect(h).toContain('class="ss-field"');
    expect(h).toContain('data-w="lg"');
    expect(h).toContain('data-select="true"');
    const bare = renderToStaticMarkup(<Field><input aria-label="y" /></Field>);
    expect(bare).toContain('data-w="md"'); // 缺省档
    expect(bare).not.toContain("data-select");
    const f = block(styles, ".ss-field > input, .ss-field > select");
    expect(f).toContain("height: 36px");
    expect(f).toContain("border-radius: var(--radius-field)");
    expect(styles).toContain(".ss-field > input:disabled, .ss-field > select:disabled { opacity: 0.55; cursor: default; }");
    expect(styles).toContain(".ss-field[data-select] > select { appearance: none; padding-right: 32px; }");
    expect(styles).toContain('.ss-field[data-w="full"] { flex: 1 1 240px; width: 100%; max-width: 420px; }');
    // 控件行第二行容器（真机实测：密钥行三者相加 685px > 634px 必换行）——
    // 100% 基宽强制换行 + 行内 gap 8px，输入与按钮恒同行。
    const sub = block(styles, ".ss-ctl-sub");
    expect(sub).toContain("flex: 1 1 100%");
    expect(sub).toContain("gap: var(--space-sm)");
    // 8px 控件圆角走 token（唯一源在 tokens.css）
    expect(tokens).toMatch(/--radius-field:\s*calc\(0\.5rem \* var\(--size-scale\)\);/);
  });

  it("Badge：中性胶囊；给 onRemove 才出「×」（aria-label 由调用方给全）", () => {
    const withX = renderToStaticMarkup(<Badge onRemove={() => undefined} removeLabel="删除 glm 的 key">glm</Badge>);
    expect(withX).toContain("ss-badge");
    expect(withX).toContain('aria-label="删除 glm 的 key"');
    const plain = renderToStaticMarkup(<Badge>glm</Badge>);
    expect(plain).toContain("ss-badge neutral");
    expect(plain).not.toContain("<button");
  });

  it("StatusDot：三 tone（ok 绿 / warn 橙 / off 灰）走语义 token；纯装饰不朗读", () => {
    const dot = renderToStaticMarkup(<StatusDot tone="warn" />);
    expect(dot).toContain('data-tone="warn"');
    expect(dot).toContain('aria-hidden="true"');
    expect(styles).toMatch(/\.ss-dot\[data-tone="ok"\] \{ background: hsl\(var\(--success\)\); \}/);
    expect(styles).toMatch(/\.ss-dot\[data-tone="warn"\] \{ background: hsl\(var\(--color-risk\)\); \}/);
  });
});

describe("SettingsPage 分区说明（2026-10-21）", () => {
  it("desc 在位时渲染一行说明；缺省不摆空段落", () => {
    const withDesc = renderToStaticMarkup(<SettingsPage title="通用" desc="外观、文字与输入习惯。"><div /></SettingsPage>);
    expect(withDesc).toContain("外观、文字与输入习惯。");
    const without = renderToStaticMarkup(<SettingsPage title="通用"><div /></SettingsPage>);
    expect(without).not.toContain("ss-desc");
  });
});

describe("设置卡内主按钮的身份（2026-11-01 第 862 页）", () => {
  it("卡内不再另涂一套品牌珊瑚：primary 与全应用同一条 --btn-primary-* 令牌", () => {
    // 业主用色裁决：品牌珊瑚只出现在品牌标记本身；要强调用对比而不是色相。
    // 此前只有 `.ss-card` 里的 `mini-btn primary` 被改涂 accent-brand ⇒ 同一个语义控件
    // 两套长相，且设置页最响的一块是一枚珊瑚键（真机 06-settings-provider 截图）。
    expect(styles).not.toMatch(/\.ss-card \.mini-btn\.primary[^{]*\{[^}]*accent-brand/);
    expect(styles).not.toContain(".ss-card .mini-btn.primary");
    // 反向自证：全局那条确实读令牌（不是把两处一起删掉造成假绿）。
    expect(styles).toMatch(/\.mini-btn\.primary \{ background: var\(--btn-primary-bg\)/);
    // 卡内按钮的尺寸档仍在（本次只撤色相，不动 36px 这一档）。
    expect(block(styles, ".ss-card .mini-btn")).toContain("height: 36px");
  });
});

describe("分区标题与行标签不重复（第 892 页 · 让布局说话）", () => {
  /** 扫源码：同一 SettingsSection 里，行标签不许是分区标题的子串。
 *  ≥3 字才判：「关于与更新」分区里有一行就叫「更新」，那是短词的巧合包含，不是同词重复
 *  （变异自检：把行标签改成分区标题的 ≥3 字子串，本判卷会红）。 */
  const FILES = [
    "../src/renderer/components/settings-sections.tsx",
    "../src/renderer/components/settings/NetworkSection.tsx",
    "../src/renderer/components/settings/UsageSection.tsx",
  ];
  it("没有「分区标题 ⊃ 行标签」的同屏重复", () => {
    const dups: string[] = [];
    for (const rel of FILES) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      for (const m of src.matchAll(/SettingsSection title="([^"]+)"([\s\S]*?)<\/SettingsSection>/g)) {
        const [, title, body] = m;
        for (const lm of body.matchAll(/SettingsRow label="([^"]+)"/g)) {
          const lab = lm[1];
          if (lab.length >= 3 && title.includes(lab)) dups.push(`${rel} :: ${title} ⊃ ${lab}`);
        }
      }
    }
    expect(dups, "同屏同词：\n" + dups.join("\n")).toEqual([]);
  });
});
