// 批 6（总纲阶段 3-1/3-2 + 细则 §六）：设置页正文四段拆分重建——
// 通用 = 外观/语言/快捷键三卡（主题 = 3 选项卡带小预览图）；模型与 Provider 三段
// （当前通道与密钥 / 联网搜索 / 自定义接口）；权限与安全 = 四档 OptionCard（自动 = danger + 警示行）
// + 方案门通俗文案 + 网络只读行；关于与更新保持。全部走 settings-ui 公共件（ss-* 结构锚）。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readAppSurface } from "./helpers/app-surface";
import {
  AboutSection,
  GeneralSection,
  PermissionsSection,
  ProviderSection,
  licenseLabel,
  providerStatusLabel,
  providerStatusParts,
} from "../src/renderer/components/settings-sections";
import { DEFAULT_SETTINGS, type AppSettings, type TextSizeSetting, type UiSizeSetting } from "../../../src/main/settings";

const S = (over: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_SETTINGS, ...over });
const noop = (): void => undefined;

const STATUS = { available: true, stored: [] as string[], envActive: false };
/** 识图默认读数：未声明（本仓 cn:hy3 今天的真形状）。需要别的态时就地覆写。 */
const VISION = { state: "undeclared" as const, modelId: "cn:hy3", declaredModalities: [] as readonly string[] };

describe("批 6：通用段（外观 / 语言 / 字号 / 快捷键 四卡）", () => {
  const menu = (over: Partial<AppSettings> = {}, textSize: TextSizeSetting = "md", uiSize: UiSizeSetting = "2"): string =>
    renderToStaticMarkup(<GeneralSection settings={S(over)} textSize={textSize} uiSize={uiSize} onSave={noop} onCtrlTab={noop} onTextSize={noop} onUiSize={noop} onWindowVibrancy={noop} />);

  it("六组标题在场（ss-sec 卡式分组，含窗口实验）", () => {
    const h = menu();
    for (const t of ["外观", "窗口", "语言", "字号", "组件尺寸", "快捷键"]) expect(h).toContain(t);
    expect((h.match(/class="ss-sec"/g) ?? []).length).toBe(6);
    expect(h).toContain("窗口材质");
    expect(h).toContain("默认关");
  });

  it("主题 = 3 个带小预览图的选项卡；选中项恰一枚 on（强调描边交给 CSS 哨兵）", () => {
    const h = menu({ theme: "dark" });
    // 只数**主题组**内的 theme-opt（字号组复用同一个 class，全文数会算成 6 个）
    const themeGroup = h.slice(h.indexOf('aria-label="主题"'), h.indexOf('aria-label="文字大小"'));
    expect((themeGroup.match(/class="theme-opt[ "]/g) ?? []).length).toBe(3);
    expect((themeGroup.match(/class="theme-opt on"/g) ?? []).length).toBe(1);
    // 2026-10-24 业主：色块小预览撤下，纯文字选项（theme-thumb 零残留）
    expect((themeGroup.match(/class="theme-thumb/g) ?? []).length).toBe(0);
    for (const t of ["跟随系统", "亮", "暗"]) expect(h).toContain(t);
    // 选中者 = dark 那颗（索引序：system/light/dark）
    const opts = [...themeGroup.matchAll(/class="theme-opt( on)?"/g)];
    expect(opts.length).toBe(3);
    expect(opts[2][1]).toBe(" on");
  });

  it("Ctrl+Tab 行：开关在场、说明改到标签下方（通俗句）", () => {
    const h = menu();
    expect(h).toContain("Ctrl+Tab 切会话");
    expect(h).toContain("曾被误触？关掉它，只留 ⌘⇧[ / ⌘⇧] 循环会话。");
    expect(h).toContain("ss-row-desc");
  });

  it("语言行：单语静态说明（英文未接，不摆可切换的空壳）", () => {
    const h = menu();
    expect(h).toContain("中文（简体）");
    expect(h).toContain("英文界面尚未接入");
    expect(h).not.toContain("English");
    expect(h).not.toContain('aria-label="界面语言"');
  });

  // 2026-10-18 字号段：CSS 三档（html[data-text-size=sm|md|lg] → --rem-scale .92|1|1.08）
  // 与「每个字号 calc 乘 --rem-scale」早就写好，但 data-text-size 从未被任何代码写过 =
  // 三档是死代码、用户无处调字号。现在补上控件与接线。
  it("字号段：三档单选，选中态跟着 props.textSize", () => {
    for (const [size, idx] of [["sm", 0], ["md", 1], ["lg", 2]] as const) {
      const h = menu({}, size);
      expect(h).toContain("文字大小");
      expect(h).toContain('aria-label="文字大小"');
      // 三档齐、且各带一个按档变字号的 A 预览
      // 边界到「组件尺寸」组之前——两组都复用 theme-opt / ts-thumb class，全文数会串组。
      const tsGroup = h.slice(h.indexOf('aria-label="文字大小"'), h.indexOf('aria-label="界面密度"'));
      expect([...tsGroup.matchAll(/class="ts-thumb" data-ts="(sm|md|lg)"/g)].map((m) => m[1])).toEqual(["sm", "md", "lg"]);
      // 字号组里恰一枚 on，且是传入的那一档（theme-opt 与主题组复用同一 class，按组分）
      const opts = [...tsGroup.matchAll(/class="theme-opt( on)?"/g)];
      expect(opts.length).toBe(3);
      expect(opts.findIndex((m) => m[1] === " on")).toBe(idx);
    }
  });

  it("组件尺寸段：五档单选，选中态跟着 props.uiSize（双轴尺寸轴 · 销 G2）", () => {
    for (const [size, idx] of [["1", 0], ["2", 1], ["3", 2], ["4", 3], ["5", 4]] as const) {
      const h = menu({}, "md", size);
      expect(h).toContain("界面密度");
      expect(h).toContain('aria-label="界面密度"');
      const uiGroup = h.slice(h.indexOf('aria-label="界面密度"'));
      expect([...uiGroup.matchAll(/class="ts-thumb" data-ui="([1-5])"/g)].map((m) => m[1])).toEqual(["1", "2", "3", "4", "5"]);
      const opts = [...uiGroup.matchAll(/class="theme-opt( on)?"/g)];
      expect(opts.length).toBe(5);
      expect(opts.findIndex((m) => m[1] === " on")).toBe(idx);
    }
  });

  it("双轴正交：字号段与尺寸段各自独立，改一档不动另一档", () => {
    const a = menu({}, "lg", "1");
    const b = menu({}, "lg", "5");
    // 字号都停在 lg（尺寸档变化不影响文字轴）
    expect(a.slice(a.indexOf('aria-label="文字大小"'), a.indexOf('aria-label="界面密度"'))).toContain('data-ts="lg"');
    expect(b.slice(b.indexOf('aria-label="文字大小"'), b.indexOf('aria-label="界面密度"'))).toContain('data-ts="lg"');
    // 但选中态分别落在第 1 / 第 5 档
    const pick = (h: string) => [...h.slice(h.indexOf('aria-label="界面密度"')).matchAll(/class="theme-opt( on)?"/g)].findIndex((m) => m[1] === " on");
    expect(pick(a)).toBe(0);
    expect(pick(b)).toBe(4);
  });

  it("字号段的说明不撒谎（说清是整界面一起缩放）", () => {
    const h = menu();
    expect(h).toContain("整界面文字一起缩放");
  });
});

describe("批 6：模型与 Provider 三段", () => {
  const provider = (over: {
    status?: typeof STATUS;
    cap?: { search: { kind: "unset" } | { kind: "ok" } | { kind: "broken"; message: string }; searchEndpoint?: string;
      vision: { state: "declared" | "undeclared" | "unverified"; modelId: string | null; declaredModalities: readonly string[] } } | null;
    checkMsg?: { tone: "wait" | "ok" | "err"; text: string; hint?: string } | null;
    providers?: readonly { id: string; label: string; custom: boolean }[];
    models?: readonly { id: string; provider: string }[];
  } = {}): string =>
    renderToStaticMarkup(
      <ProviderSection
        settings={S({ provider: "glm" })}
        status={over.status ?? STATUS}
        providers={over.providers ?? [
          { id: "glm", label: "glm", custom: false },
          { id: "openai", label: "openai", custom: false },
          { id: "anthropic", label: "anthropic", custom: false },
          { id: "gemini", label: "gemini", custom: false },
        ]}
        models={over.models ?? []}
        cap={over.cap === undefined ? null : over.cap}
        keyProvider="glm"
        onKeyProviderChange={noop}
        keyInputRef={{ current: null }}
        busy={false}
        onSaveKey={noop}
        onDeleteKey={noop}
        checkMsg={over.checkMsg ?? null}
        onCheck={noop}
        onCustomSaved={noop}
        onOpenSearch={noop}
      />,
    );

  it("三卡标题：当前通道与密钥 / 联网搜索 / 识图能力（自定义接口已合并进详情，2026-10-24 业主）", () => {
    const h = provider();
    for (const t of ["当前通道与密钥", "联网搜索", "识图能力"]) expect(h).toContain(t);
    expect(h).not.toContain("自定义接口");
    // 4 → 3（2026-10-24：自定义接口合并进右详情的编辑/新增表单，独立卡撤下）。
    expect((h.match(/class="ss-sec"/g) ?? []).length).toBe(3);
  });

  it("当前通道行：provider 名 + 查看说明；检查连接（结果就地显示在这卡内）", () => {
    const h = provider({ checkMsg: { tone: "ok", text: "连接成功：发现 3 个可用模型" } });
    expect(h).toContain("glm");
    expect(h).toContain("模型与思考档位在输入框处切换（下一轮派活生效）");
    expect(h).toContain("检查连接");
    expect(h).toContain("连接成功：发现 3 个可用模型");
    // 「不消耗额度」进 tooltip（title），不再占行内
    expect(h).toContain("向 glm 拉一次模型清单（不消耗模型额度）");
  });

  it("供应商管理（2026-10-24 参照 Codex 供应商页）：左列表选通道 + 右详情表单（堆叠字段）+ 徽章可删", () => {
    const h = provider({ status: { available: true, stored: ["glm"], envActive: true } });
    expect(h).toContain("pv-split");        // 左列表 + 右详情
    expect(h).toContain("pv-item");        // 供应商行（状态点 + 名称）
    expect(h).toContain("智谱 GLM");        // kind id 上屏前翻人话
    expect(h).toContain("pv-detail-name"); // 详情头 = 选中供应商名
    expect(h).toContain("保存到钥匙串");
    expect(h).toContain("添加供应商");       // 列表底部添加入口（详情里出空白新增表单）
    // API Key 字段：标签在上、输入 + 保存按钮同一行
    expect(h).toContain("ss-flabel");
    expect(h).toContain('class="ss-frow"');
    expect(h.indexOf("ss-frow") < h.indexOf('type="password"')).toBe(true);
    expect(h.indexOf('type="password"') < h.indexOf("保存到钥匙串")).toBe(true);
    // 已存 key 的徽章（按选中通道过滤）+ env 提示色小字
    expect(h).toContain("ss-badge");
    expect(h).toContain('aria-label="删除 glm 的 key"');
    expect(h).toContain("ss-hint tip");
    expect(h).toContain("检测到环境变量，将优先使用");
    expect(h).not.toContain("已存 key：");
  });

  it("自定义供应商进左列表（用户可添加更多大模型供应商，2026-10-24 业主）", () => {
    const h = provider({
      providers: [
        { id: "glm", label: "glm", custom: false },
        { id: "openai", label: "openai", custom: false },
        { id: "anthropic", label: "anthropic", custom: false },
        { id: "gemini", label: "gemini", custom: false },
        { id: "agnes", label: "agnes", custom: true },
        { id: "deepseek-x", label: "DeepSeek 中转", custom: true },
      ],
      models: [
        { id: "agnes-2.5-flash", provider: "agnes" },
        { id: "deepseek-chat", provider: "deepseek-x" },
      ],
    });
    expect(h).toContain("自定义");           // 分组标签
    expect(h).toContain("agnes");           // 自定义行进列表
    expect(h).toContain("DeepSeek 中转");
  });

  it("自定义详情分支：右详情就地编辑（表单预填 + 同名覆盖），独立「自定义接口」卡已撤（2026-10-24 业主：两块合并）", () => {
    const stream = readAppSurface();
    expect(stream).toContain("const activeCustom = customSelId !== null && customs.some((p) => p.id === customSelId) ? customSelId : null;");
    // 选中自定义 → 详情内嵌编辑表单（预填 editing；key 分支隔离，预填不带进新增）；添加供应商 → 空白表单。
    expect(stream).toContain('<CustomProviderForm key={`edit-${activeCustom}`} editing={editingEntry}');
    expect(stream).toContain('<CustomProviderForm key="add"');
    expect(stream).toContain('<span className="pv-detail-name">添加供应商</span>');
    // 编辑表单的回填源 = providerCustomList（新 IPC）。
    expect(stream).toContain("window.agent.providerCustomList()");
  });

  it("联网搜索（2026-10-16 重做）：状态点行 + 去配置 + 查看详情折叠含配法原文；已配 = 绿点、无去配置", () => {
    const unset = provider({ cap: { search: { kind: "unset" }, vision: VISION } });
    // 只看**联网搜索那一段**（识图能力段自己有 warn 条，不能让它替搜索段背锅）。
    const unsetSec = unset.slice(unset.indexOf("联网搜索"), unset.indexOf("识图能力"));
    expect(unsetSec).toContain("尚未配置可用的搜索服务");
    expect(unsetSec).toContain("配置联网搜索");
    expect(unsetSec).not.toContain("复制配置片段");
    expect(unsetSec).not.toContain(".agent/config.json");
    expect(unsetSec).not.toContain("{query}");
    const ok = provider({ cap: { search: { kind: "ok" }, searchEndpoint: "https://searx.example", vision: VISION } });
    const okSec = ok.slice(ok.indexOf("联网搜索"), ok.indexOf("识图能力"));
    expect(okSec).toContain('data-tone="ok"');            // 已配 = 绿点
    expect(okSec).toContain("配置联网搜索");
    expect(okSec).not.toContain("ss-banner warn");
    expect(ok).toContain("已配置联网搜索");
  });

  // 识图能力（2026-10-16）：undeclared 必须出 warn 条，且那句要把「调用成功 ≠ 看得懂」说出来。
  // 实测被误读的正是这一格：render_image 成功回执 ⇒ 认为模型看过并理解了那张图。
  it("识图未声明：warn 条在场，且明说调用成功不等于上游看得懂", () => {
    const h = provider({ cap: { search: { kind: "ok" }, vision: { state: "undeclared", modelId: "cn:hy3", declaredModalities: [] } } });
    expect(h).toContain("ss-banner warn");
    expect(h).toContain("cn:hy3");
    expect(h).toContain("「调用成功」不等于上游看得懂");
    // 已声明时不出 warn（那不再是缺口，只是没实测——desc 里说清）。
    const declared = provider({ cap: { search: { kind: "ok" }, vision: { state: "declared", modelId: "m", declaredModalities: ["text", "image"] } } });
    // 只看识图那一段（它自己不出 warn；搜索段此时也不出）。
    const visionSec = declared.slice(declared.indexOf("识图能力"));
    expect(visionSec).not.toContain("ss-banner warn");
    expect(declared).toContain("这是配置声明，未经带凭据实测");
    // 取不到选中模型 ⇒ 未验证，不猜它支不支持。
    const unknown = provider({ cap: { search: { kind: "ok" }, vision: { state: "unverified", modelId: null, declaredModalities: [] } } });
    expect(unknown).toContain("未验证");
  });

  it("自定义表单在场（合并进详情后组件仍渲染——由编辑/新增分支挂载）", () => {
    const stream = readAppSurface();
    expect(stream).toContain('aria-label="自定义接口地址"');
    expect(stream).toContain('placeholder="https://api.deepseek.com/v1"');
  });
});

describe("批 6：权限与安全段（OptionCard 四档 + danger 自动）", () => {
  const perms = (over: Partial<AppSettings> = {}): string =>
    renderToStaticMarkup(<PermissionsSection settings={S(over)} onSave={noop} />);

  it("四档 OptionCard（role=radio 恰四枚）；当前档恰一枚 on", () => {
    const h = perms({ mode: "guided" });
    expect((h.match(/role="radio"/g) ?? []).length).toBe(4);
    expect((h.match(/ss-opt on( |")/g) ?? []).length).toBe(1);
    for (const t of ["只读", "默认 · 逐次审批", "引导 · 按风险放行", "自动 · 低风险免批"]) expect(h).toContain(t);
  });

  it("「自动」= danger 档 + 警示行（不拿整行变色冒充）", () => {
    const h = perms();
    expect(h).toContain("ss-opt danger");
    expect(h).toContain("ss-opt-warn");
    // 口径与 PermissionMenu 的 MODE_LABEL 同源：auto 免的是"逐笔问写"，不是"什么都不问"
    // （riskAskAt 仍是 high）。旧文案「全部放行」让用户以为切了就万事大吉 ⇒ 实测读成"切换没用"。
    expect(h).toContain("高风险动作仍会出卡");
    expect(h).not.toContain("全部放行");
  });

  it("方案门：开关 + 通俗文案「写文件前先提交方案，等我批准」；网络 = 只读说明行（无控件）", () => {
    const h = perms();
    expect(h).toContain("写文件前先提交方案，等我批准");
    expect(h).toContain("网络");
    expect(h).toContain("默认断网");
    // 网络行不给按钮/开关（只读说明）——该行的 ctl 里不出现 button
    const netRowAt = h.indexOf("网络");
    const rowEnd = h.indexOf("ss-row-ctl", netRowAt);
    const ctlClose = h.indexOf("</div>", rowEnd);
    expect(h.slice(rowEnd, ctlClose)).not.toContain("<button");
  });
});

// 2026-10-16（模型/通道页重做）：凭据状态拆三件——徽章清单 / 状态行 / env 提示各走各的样式位；
// providerStatusLabel 改为由 parts 拼回，对外字符串逐字不变（settings-panel.test 的三态断言是锚）。
describe("凭据状态三件（providerStatusParts）", () => {
  it("已存 key ⇒ 徽章清单、line 空（徽章已表达不重复摆字）、envHint 拆出", () => {
    const p = providerStatusParts({ available: true, stored: ["glm", "openai"], envActive: true });
    expect(p.stored).toEqual(["glm", "openai"]);
    expect(p.line).toBe("");
    expect(p.envHint).toBe("检测到环境变量，将优先使用");
    expect(p.tone).toBe("ok");
  });

  it("未存 ⇒ line=尚未存储任何 key；safeStorage 不可用 ⇒ warn 且不虚报徽章（fail-closed）", () => {
    expect(providerStatusParts({ available: true, stored: [], envActive: false })).toEqual({
      line: "尚未存储任何 key", stored: [], envHint: null, tone: "ok",
    });
    const bad = providerStatusParts({ available: false, stored: ["glm"], envActive: true });
    expect(bad.tone).toBe("warn");
    expect(bad.stored).toEqual([]);
    expect(bad.line).toContain("fail-closed");
  });

  it("拼回恒等：label = parts 拼回（对外串逐字不变，旧三态断言继续作锚）", () => {
    const s = { available: true, stored: ["glm"], envActive: true };
    const p = providerStatusParts(s);
    expect(`已存 key：${p.stored.join("、")}；${p.envHint ?? ""}`).toBe(providerStatusLabel(s));
    expect(providerStatusLabel(s)).toBe("已存 key：glm；检测到环境变量，将优先使用");
  });
});

describe("批 6：关于与更新段", () => {
  it("版本 + 检查更新 + 诊断信息折叠区（术语收容所）", () => {
    const h = renderToStaticMarkup(
      <AboutSection version="0.1.0" updateMsg={null} onCheckUpdate={noop} diagnostics="调度器：serveScheduler 常驻；journal 投影正常。" />,
    );
    expect(h).toContain("关于与更新");
    expect(h).toContain("0.1.0");
    expect(h).toContain("检查更新");
    expect(h).toContain("诊断信息");
    expect(h).toContain("serveScheduler");
  });
});

describe("批 6：样式哨兵（主题选项卡/段落样式）", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  it(".theme-opt = 纯文字药丸（2026-10-24 业主：色块撤下）；选中 = 强调描边 + 淡底", () => {
    expect(styles).toMatch(/\.theme-opt\.on \{[^}]*accent-control[^}]*\}/);
    expect(styles).not.toContain(".theme-thumb");
  });
  it(".ss-banner 样式在（信息/警告两 tone）", () => {
    expect(styles).toMatch(/\.ss-banner\.warn \{[^}]*color-risk/);
  });
});
describe("许可证状态一行话（四态全显式）", () => {
  it("valid / expired / invalid / inactive 各有话说，未读取不冒充未激活", () => {
    expect(licenseLabel({ state: "valid", licensee: "Acme", expiresAt: null })).toBe("有效 · Acme");
    expect(licenseLabel({ state: "valid", licensee: "Acme", expiresAt: "2027-01-01" })).toContain("至 2027-01-01");
    expect(licenseLabel({ state: "expired", licensee: "Acme", expiresAt: "2026-01-01" })).toBe("已过期 · Acme");
    expect(licenseLabel({ state: "invalid", reason: "签名不符" })).toBe("无效 · 签名不符");
    expect(licenseLabel({ state: "inactive" })).toBe("未激活");
    expect(licenseLabel(null)).toBe("未读取");
  });
});
