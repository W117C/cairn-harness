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
import { readFileSync } from "node:fs";
import { Badge, Banner, EmptyState, Field, OptionCard, SettingsPage, SettingsRow, SettingsSection, StatusDot } from "../src/renderer/components/settings-ui";
import { ShortcutsSection } from "../src/renderer/components/settings-sections";

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
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

  it("快捷键速查：双列键帽+说明，12 行；窄窗一列", () => {
    const h = renderToStaticMarkup(<ShortcutsSection />);
    expect(h).toContain('class="kx-list"');
    expect(h).toContain('<kbd class="kx-keys">⌘N</kbd>');
    expect(h).toContain('class="kx-what">新任务');
    expect((h.match(/class="kx-row"/g) ?? []).length).toBe(12);
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
  it(".ss-title = 20px / --fw-bold；内容列 960px 水平居中（2026-10-16 重做 A：滚动容器撑满、内容列收口）", () => {
    const t = block(styles, ".ss-title");
    expect(t).toContain("font-size: var(--fs-title-md)");
    expect(t).toContain("font-weight: var(--fw-bold)");
    // 宽度与居中的单一落点：sp-body 的内容列包装规则（原 .ss-page 自带 720 上限已下架）
    expect(styles).toContain(".sp-body > .ss-page, .sp-body > .ap-body { max-width: 960px; margin: 0 auto; width: 100%; }");
    expect(block(styles, ".sp-body")).not.toContain("max-width"); // 滚动容器自身不再设宽（A 的根因）
    expect(block(styles, ".ss-page")).not.toContain("max-width");
  });

  it(".ss-sec-head 组标题 = caption 档 tertiary；.ss-card = surface + 描边 + v3 10 圆角 + 20 内距", () => {
    expect(block(styles, ".ss-sec-head")).toContain("font-size: var(--fs-caption-xs)");
    expect(block(styles, ".ss-sec-head")).toContain("color: hsl(var(--text-400))");
    const card = block(styles, ".ss-card");
    expect(card).toContain("border-radius: var(--radius-pop-v3)"); // 10（v3 panel-radius）
    expect(card).toContain("hsl(var(--bg-000))");
    expect(card).toContain("1px solid var(--hairline-strong)");
    expect(card).toContain("padding: 0");
  });

  it(".ss-row = 220px 标题列 + 弹性控件列（左对齐，2026-10-16 C）；行间 1px 分隔线；窄宽单列", () => {
    const row = block(styles, ".ss-row");
    expect(row).toContain("grid-template-columns: 220px minmax(0, 1fr)");
    expect(row).toContain("min-height: 56px");
    expect(row).toContain("border-top: 1px solid var(--hairline)");
    expect(styles).toContain(".ss-card > .ss-row:first-child { border-top: 0; }");
    // 控件列不再右对齐（「控件被挤到右半边」的反向钉）
    expect(block(styles, ".ss-row-ctl")).not.toContain("justify-content: flex-end");
    // 窄宽媒体查询：标题列收进单列（800px 窗口仍两列，控件换行不溢出）
    expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]{0,300}\.ss-row \{ grid-template-columns: minmax\(0, 1fr\)/);
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
