// DOM 级判卷（用户要求 ⑥「桌面表单补 DOM 级判卷」；也正是反馈 ②「模型选择没有界面设计」的验收面）。
//
// 本仓没有 jsdom / testing-library，所以这里用**服务端渲染**（react-dom/server）把组件渲染成真 HTML
// 再断言 —— 它验的是「用户实际会看到什么」，而不是「我们调用了什么函数」：
//   · 分组、档位徽标文字、上下文窗口、当前项打勾、演示项的诚实标注、key 未配置的置顶行
//   · 元素的可访问属性（aria-label / aria-haspopup / aria-selected / disabled）
//   · React 的转义（模型名里的尖括号必须是文本，不能被当成标签）
//
// 覆盖不到的：点击后状态怎么变。那部分按仓里的既有做法抽成纯函数判卷（flattenModels / groupModels /
// pickerKeyNotice / describeSelection / validateProjectName），并在真窗口冒烟里走一遍主路径。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelMenu, ModelPicker, type ModelOption } from "../src/renderer/components/ModelPicker";
import { NewProjectCard } from "../src/renderer/components/NewProjectCard";
import type { ProviderInfo } from "../../../src/main/ipc-protocol";

function model(id: string, provider: string, name: string, tier: string, ctxWindow: number) {
  return {
    id,
    provider,
    model: name,
    tier: tier as "cheap" | "standard" | "strong",
    ctxWindow,
    capability: {
      modelId: id,
      provider,
      availability: "unverified" as const,
      thinking: { supported: false, values: ["off"] as const, default: "off" as const },
      attachments: { text: true, image: false },
    },
  };
}

const info: ProviderInfo = {
  kind: "openai",
  provider: "OpenAI",
  model: "gpt-4o",
  modelId: "openai-standard",
  models: [
    model("openai-standard", "openai", "gpt-4o", "standard", 128_000),
    model("deepseek-chat", "deepseek", "deepseek-chat", "cheap", 1_000_000),
  ],
  keyConfigured: true,
  providers: [
    { id: "openai", label: "OpenAI", custom: false },
    { id: "deepseek", label: "DeepSeek", custom: true },
  ],
};

const OPTIONS: ModelOption[] = [
  { registryId: null, label: "演示", provider: null },
  { registryId: "openai-standard", label: "gpt-4o", provider: "openai", tier: "standard", ctxWindow: 128_000 },
  { registryId: "deepseek-chat", label: "deepseek-chat", provider: "deepseek", tier: "cheap", ctxWindow: 1_000_000 },
];

describe("ModelPicker 触发条（真 HTML）", () => {
  it("是个带 aria 的可点按钮，title 就是选中项描述", () => {
    const html = renderToStaticMarkup(<ModelPicker infos={[info]} value="deepseek-chat" onChange={() => undefined} />);
    expect(html).toContain('aria-label="模型选择"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("deepseek-chat"); // 短名
    expect(html).toContain("窗口 1M"); // title 里的描述也带窗口
    expect(html).not.toContain('role="listbox"'); // 没打开就没有菜单
  });

  it("会话内显式选择 ⇒ 触发条上现出小圆点", () => {
    const withDot = renderToStaticMarkup(
      <ModelPicker infos={[info]} value="deepseek-chat" sessionOverride onChange={() => undefined} />,
    );
    expect(withDot).toContain("mp-dot");
    const without = renderToStaticMarkup(<ModelPicker infos={[info]} value="deepseek-chat" onChange={() => undefined} />);
    expect(without).not.toContain("mp-dot");
  });

  it("演示选中时触发条显示「演示」，title 写明不产生真实调用", () => {
    const html = renderToStaticMarkup(<ModelPicker infos={[info]} value={null} onChange={() => undefined} />);
    expect(html).toContain(">演示<");
    expect(html).toContain("不产生真实调用");
  });
});

describe("ModelMenu 菜单（真 HTML）", () => {
  const render = (over: Partial<Parameters<typeof ModelMenu>[0]> = {}): string =>
    renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} {...over} />,
    );

  it("按 provider 分节，每行都有档位文字与上下文窗口", () => {
    const html = render();
    expect(html).toContain(">openai<");
    expect(html).toContain(">deepseek<");
    // 档位徽标是**文字**（规范 a11y 条：不只靠颜色）
    expect(html).toContain("标准 · 窗口 128k");
    expect(html).toContain("便宜 · 窗口 1M");
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="模型列表"');
  });

  it("当前项打勾且 aria-selected 为真，其它项不打勾", () => {
    const html = render();
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('class="check">✓<');
    // 三条选项里恰好一条被选中
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
  });

  it("演示项常驻，且写着「预录剧本 · 不产生真实调用 · 结果与你的任务无关」", () => {
    const html = render();
    expect(html).toContain(">演示<");
    expect(html).toContain("预录剧本 · 不产生真实调用 · 结果与你的任务无关");
  });

  it("key 未配置 ⇒ 置顶警示行 + 可跳设置，但**不**因此禁掉整列", () => {
    // 2026-10-06 修正：旧判据钉的是"整列禁用"，而那条规则本身是错的 —— key 按家算，
    // 拿当前通道的状态去灰掉别人家的模型，正好造成用户实测的"列表出来了但点不动"。
    const html = render({ keyNotice: "OpenAI 未配置 key · 去设置配置" });
    expect(html).toContain("⚠ OpenAI 未配置 key · 去设置配置");
    expect(html).toContain("点这里去设置");
    expect(html).toContain("mp-warn");
    expect((html.match(/disabled=""/g) ?? []).length).toBe(0);
  });

  it("运行中 ⇒ 整列禁用（含「演示」）：跑着的时候不该换模型", () => {
    const html = render({ running: true });
    // 三条选项全部带 disabled（菜单里「演示」出现两次：分节标题 + 那一行的名字，取最后一次）
    const labelAt = html.lastIndexOf(">演示<");
    const demoOpenTag = html.slice(html.lastIndexOf("<button", labelAt), labelAt);
    expect(demoOpenTag).toContain('disabled=""');
    expect(demoOpenTag).toContain('role="option"');
    expect((html.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(3);
  });

  it("key 未配置只是**提示**：整列仍可点（key 按家算，不能拿当前通道的状态灰掉别人家的模型）", () => {
    // 2026-10-06 用户实测「列表出来了但点不动」的第二处根因：旧实现拿当前通道的 key 状态禁整列。
    // 但那两条模型可能属于另一家（那家有 key），灰掉它们等于把用户想要的能力藏起来。
    const html = render({ keyNotice: "OpenAI 未配置 key · 去设置配置" });
    expect(html).toContain("⚠ OpenAI 未配置 key · 去设置配置"); // 提示还在
    expect((html.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(0); // 但一行都不禁
  });

  it("目录为空 ⇒ 明确说「去设置里接一家自己的」，而不是给个空菜单", () => {
    const html = render({ options: [{ registryId: null, label: "演示", provider: null }] });
    expect(html).toContain("当前目录里没有可选模型");
    expect(html).toContain("去设置里接一家自己的");
  });

  it("模型名里的尖括号被转义成文本（是 DOM 文本，不是拼字符串）", () => {
    const html = render({
      options: [{ registryId: "x", label: "<script>x</script>", provider: "gw", tier: "strong", ctxWindow: 8000 }],
      value: "x",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("NewProjectCard（③ 的入口：真 HTML）", () => {
  it("两个带标签的输入 + 两个按钮；名字为空时「创建并进入」是禁用的", () => {
    const html = renderToStaticMarkup(<NewProjectCard onCreated={() => undefined} />);
    expect(html).toContain('aria-label="项目名"');
    expect(html).toContain('aria-label="项目位置"');
    expect(html).toContain("会成为文件夹名");
    expect(html).toContain("留空 = ~/CairnProjects");
    expect(html).toContain("选择位置");
    // 名字为空 ⇒ 禁用（用户不用点了才知道）
    const createBtn = html.slice(html.lastIndexOf("mini-btn primary") - 120, html.lastIndexOf("mini-btn primary") + 60);
    expect(createBtn).toContain('disabled=""');
    expect(html).toContain("创建并进入");
  });
});

// ⑤ 左栏对齐原型（prototype.html 的 `.section-head` 三枚图标按钮 + `.pop down` 筛选菜单 + `.ws-search-row`）
import { Sidebar, SESSION_FILTERS, SESSION_FILTER_NOTE, filterSessions } from "../src/renderer/components/Sidebar";

// 显式标注：Sidebar 要 WorkspaceSession[]，而筛选判据还要 origin（定时任务）这一格
type TestSession = Parameters<typeof Sidebar>[0]["sessions"][number] & { origin?: "scheduled" };
const SESSIONS: TestSession[] = [
  { id: "s1", title: "修左栏样式", mtimeMs: 1, lines: 3, workspace: "/tmp/ws" },
  { id: "s2", title: "接自定义模型", mtimeMs: 2, lines: 4, pinned: true, workspace: "/tmp/ws" },
  { id: "s3", title: "归档的旧活", mtimeMs: 3, lines: 5, archived: true, workspace: "/tmp/ws" },
  { id: "s4", title: "每日巡检", mtimeMs: 4, lines: 6, origin: "scheduled" as const, workspace: "/tmp/ws" },
];

function sidebarHtml(over: Partial<Parameters<typeof Sidebar>[0]> = {}): string {
  // 显式收口成组件的 props 类型：本包开了 exactOptionalPropertyTypes，
  // Partial<T> 展开出来的 `T[K] | undefined` 过不了那一关（与组件行为无关，是夹具的写法问题）。
  const props = {
    sessions: SESSIONS,
    workspaces: [],
    activeWorkspace: null,
    activeId: null,
    running: new Set<string>(),
    mode: "auto" as const,
    providerInfo: null,
    onSelect: () => undefined,
    onNew: () => undefined,
    onSwitchWorkspace: () => undefined,
    onAddWorkspace: async () => undefined,
    onPickDirectory: () => Promise.resolve(null),
    onOpenSettings: () => undefined,
    onOpenPage: () => undefined,
    ...over,
  } as Parameters<typeof Sidebar>[0];
  return renderToStaticMarkup(<Sidebar {...props} />);
}

describe("⑤ 左栏：原型里那三枚图标按钮都在", () => {
  it("搜索会话 / 筛选会话 / 新建工作区 三枚都渲染出来，且都带 aria-label", () => {
    const html = sidebarHtml();
    expect(html).toContain('aria-label="搜索会话"');
    expect(html).toContain('aria-label="筛选会话"');
    expect(html).toContain('aria-label="新建工作区"');
    expect((html.match(/class="iconbtn sm"/g) ?? []).length).toBe(3);
  });

  it("没展开时不渲染筛选菜单与搜索框（点了才有，不是常驻空壳）", () => {
    const html = sidebarHtml();
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain("ws-search-row");
  });
});

describe("⑤ 左栏筛选：只列有数据支撑的项，并把缺的那半边说清楚", () => {
  it("四项属性筛选（不是原型那六个实时状态——数据面没有那个字段）", () => {
    expect(SESSION_FILTERS.map((f) => f.label)).toEqual(["全部", "运行中", "已固定", "已归档", "定时任务"]);
  });

  it("脚注诚实说明实时状态为什么没做（同原型的 .menu-note 口吻）", () => {
    expect(SESSION_FILTER_NOTE).toContain("本进程里正在跑");
    expect(SESSION_FILTER_NOTE).toContain("先不摆空壳");
  });

  it("「运行中」按本进程在跑的会话过滤（不是空壳项）", () => {
    expect(filterSessions(SESSIONS, { search: "", filter: "running", running: new Set(["s2"]) }).map((s) => s.id)).toEqual(["s2"]);
    expect(filterSessions(SESSIONS, { search: "", filter: "running", running: new Set<string>() })).toHaveLength(0);
  });

  it("筛选真的按属性过滤", () => {
    expect(filterSessions(SESSIONS, { search: "", filter: "all" })).toHaveLength(4);
    expect(filterSessions(SESSIONS, { search: "", filter: "pinned" }).map((s) => s.id)).toEqual(["s2"]);
    expect(filterSessions(SESSIONS, { search: "", filter: "archived" }).map((s) => s.id)).toEqual(["s3"]);
    expect(filterSessions(SESSIONS, { search: "", filter: "scheduled" }).map((s) => s.id)).toEqual(["s4"]);
  });

  it("搜索按标题与 id 匹配，且忽略大小写与首尾空格", () => {
    expect(filterSessions(SESSIONS, { search: "左栏", filter: "all" }).map((s) => s.id)).toEqual(["s1"]);
    expect(filterSessions(SESSIONS, { search: "  S4  ", filter: "all" }).map((s) => s.id)).toEqual(["s4"]);
    expect(filterSessions(SESSIONS, { search: "不存在", filter: "all" })).toHaveLength(0);
  });

  it("搜索与筛选叠加（两个条件都要满足）", () => {
    expect(filterSessions(SESSIONS, { search: "旧", filter: "archived" }).map((s) => s.id)).toEqual(["s3"]);
    expect(filterSessions(SESSIONS, { search: "旧", filter: "pinned" })).toHaveLength(0);
  });
});

// ④ 设置页/插件页的控件（用户实测反馈：设置里的按键「全只有勾选和不勾选」）
import { readFileSync } from "node:fs";
import { Switch } from "../src/renderer/components/Switch";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel";

describe("④ Switch：不是裸复选框，而是一个说人话的开关", () => {
  const render = (over: Partial<Parameters<typeof Switch>[0]> = {}): string =>
    renderToStaticMarkup(<Switch label="遥测" checked={false} onChange={() => undefined} {...over} />);

  it("语义是 switch（读屏读成开/关），且 aria-checked 跟真值走", () => {
    expect(render({ checked: true })).toContain('role="switch"');
    expect(render({ checked: true })).toContain('aria-checked="true"');
    expect(render({ checked: false })).toContain('aria-checked="false"');
    expect(render()).toContain('aria-label="遥测"');
  });

  it("状态有文字：已开启 / 已关闭，而不是只有勾的形态", () => {
    expect(render({ checked: true })).toContain("已开启");
    expect(render({ checked: false })).toContain("已关闭");
  });

  it("可以自定义状态词（插件信任用「已信任 / 未信任」）", () => {
    const html = render({ checked: true, onText: "已信任", offText: "未信任" });
    expect(html).toContain("已信任");
    expect(html).not.toContain("已开启");
  });

  it("在忙 ⇒ 禁用且状态位写「保存中…」，title 也解释原因（禁用不许没解释）", () => {
    const html = render({ busy: true });
    expect(html).toContain('disabled=""');
    expect(html).toContain("保存中…");
    expect(html).toContain('title="保存中…"');
  });

  it("不是复选框（这正是用户说的问题）", () => {
    expect(render()).not.toContain('type="checkbox"');
  });
});

describe("④ 设置页：三处裸复选框已换成开关", () => {
  const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("设置页里不再有裸复选框，三处都走 Switch", () => {
    // 这里用源码级断言而不是 SSR 渲染：设置页的各段要等 IPC 回来的 settings（非空）才渲染，
    // 服务端渲染拿不到 → SSR 出来的是空壳，验不到那三行。Switch 自身的渲染行为在上面的用例里验过。
    const panel = src("../src/renderer/components/SettingsPanel.tsx");
    expect(panel).not.toContain('type="checkbox"');
    expect((panel.match(/<Switch/g) ?? []).length).toBe(3);
    expect(panel).toContain('label="遥测"');
    expect(panel).toContain('label="方案门缺省"');
  });
});

describe("④ 插件信任：单向按钮 → 双向开关（误点可撤销）", () => {
  it("pluginDecide 收到的是开关的目标值，而不是写死的 true", () => {
    // 源码级回归哨兵：曾经这里是 pluginDecide(p.name, true) + 一个只能「信任」的按钮，
    // 误点之后在界面上无法撤销（通道本身支持 false，是入口缺了一半）。
    const src = readFileSync(new URL("../src/renderer/components/AppPage.tsx", import.meta.url), "utf8");
    expect(src).toContain("pluginDecide(p.name, next)");
    expect(src).not.toContain("pluginDecide(p.name, true)");
    expect(src).toContain('label="信任该插件"');
    expect(src).toContain('onText="已信任"');
  });
});

describe("设置页左侧导航：一处事实源，不许重复", () => {
  it("六个分区各出现一次、顺序固定（用户实测：行为与成本/记忆与数据 曾各出现两次）", () => {
    const html = renderToStaticMarkup(<SettingsPanel onClose={() => undefined} />);
    const nav = html.slice(html.indexOf('aria-label="设置分区"'), html.indexOf('class="sp-nav-foot"'));
    const labels = ["通用", "模型与 Provider", "权限与安全", "行为与成本", "记忆与数据", "关于与更新"];
    for (const label of labels) {
      const n = (nav.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
      expect(n, `${label} 出现了 ${String(n)} 次`).toBe(1);
    }
    // 顺序也钉住（顺序错乱同样是导航不可用的形态）
    const idx = labels.map((l) => nav.indexOf(`>${l}<`));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("不再出现第二个硬编码的导航渲染（回归哨兵）", () => {
    const src = readFileSync(new URL("../src/renderer/components/SettingsPanel.tsx", import.meta.url), "utf8");
    expect(src).not.toContain('{["行为与成本", "记忆与数据"].map');
  });
});

// 2026-10-06 用户实测：接本地端点（http://127.0.0.1:…）时保存被自己拦下三条错。
// 根因是表单只在「拉取」那一步送了 allowLocal，保存时**漏送** ⇒ 能探测、存不进。
import { isLocalEndpointURL, envNameHint } from "../src/renderer/components/CustomProviderForm";

describe("自定义接口：本地端点（用户实测那条路的判据）", () => {
  it("认得出本地/内网地址（loopback、私网段、.local）", () => {
    for (const u of [
      "http://127.0.0.1:8080/v1",
      "http://localhost:1234/v1",
      "http://[::1]:8080",
      "https://10.0.0.5/v1",
      "https://192.168.1.20:8000/v1",
      "https://172.16.3.4/v1",
      "https://box.local/v1",
    ]) {
      expect(isLocalEndpointURL(u), u).toBe(true);
    }
    for (const u of ["https://api.deepseek.com/v1", "https://api.openai.com", "https://8.8.8.8/v1"]) {
      expect(isLocalEndpointURL(u), u).toBe(false);
    }
  });

  it("把钥匙填进「变量名」那一格会被当场点破（而不是等到保存才报）", () => {
    expect(envNameHint("sk-abcdef1234567890abcdef")).toContain("钥匙本身");
    expect(envNameHint("DEEPSEEK_API_KEY")).toBeNull();
    expect(envNameHint("")).toBeNull();
    expect(envNameHint("lowercase_name")).toContain("大写字母");
  });

  it("源码级回归哨兵：保存请求必须带上 allowLocalEndpoint（漏了就是这次的 bug 复发）", () => {
    const src = readFileSync(new URL("../src/renderer/components/CustomProviderForm.tsx", import.meta.url), "utf8");
    expect(src).toContain("allowLocalEndpoint: true");
    expect(src).toContain("isLocalEndpointURL");
    // 同一判定必须被用两次（拉取 allowLocal + 保存 allowLocalEndpoint），不许只留一处
    expect((src.match(/isLocalEndpointURL\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

// 用户实测：「等待大模型输出时没有动态效果、没有时间显示」+「点不开思考行」。
import { ThinkingLive } from "../src/renderer/components/Stream";

describe("C-31 思考行（live）：有计时、可点开", () => {
  it("渲染出来带走秒位（初始 0s）、三点动画容器、折叠体，并且行本身可点", () => {
    const html = renderToStaticMarkup(<ThinkingLive seq={1} />);
    expect(html).toContain(">思考中<");
    expect(html).toContain("think-live");
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("0s");
    expect(html).toContain("think-body"); // 折叠体在 DOM 里（靠 .open 显隐，不是没渲染）
    expect(html).toContain("think-elapsed");
  });

  it("计时位是 tabular-nums 的独立位（走秒不跳动），并挂了 aria-live", () => {
    const html = renderToStaticMarkup(<ThinkingLive seq={2} />);
    expect(html).toContain("think-elapsed");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="模型思考中，点击展开说明"');
  });
});

// 思考正文：投影里与正文分开累计；渲染时有内容就默认展开。
import { projectStream } from "../src/renderer/projections";
import type { AgentEvent } from "../../../src/main/ipc-protocol";

describe("思考正文：投影与渲染", () => {
  const ev = (e: unknown) => e as AgentEvent;

  it("thinking_delta 累计到行的 thinking，不进 text（转录不脏）", () => {
    const rows = projectStream([
      ev({ type: "thinking_delta", callId: "c1", text: "先算一下" }),
      ev({ type: "thinking_delta", callId: "c1", text: "再核对" }),
      ev({ type: "assistant_delta", callId: "c1", text: "答案是" }),
    ]);
    const live = rows.find((r) => r.kind === "assistant" && r.live === true);
    expect(live).toBeDefined();
    if (live?.kind !== "assistant") return;
    expect(live.thinking).toBe("先算一下再核对");
    expect(live.text).toBe("答案是"); // 正文没被思考污染
  });

  it("终稿到达 ⇒ 思考**挂到终稿行上保留**（输出结束后还看得见）", () => {
    // 用户要求：模型输出结束后思考动画结束、时间定格，但"想了什么"不能跟着消失。
    const rows = projectStream([
      ev({ type: "thinking_delta", callId: "c1", text: "想想" }),
      ev({ type: "assistant_message", content: "终稿" }),
    ]);
    const final = rows.find((r) => r.kind === "assistant" && r.live !== true);
    if (final?.kind !== "assistant") return;
    expect(final.thinking).toBe("想想");
  });

  it("思考不串到下一轮（桶已清）", () => {
    const rows = projectStream([
      ev({ type: "thinking_delta", callId: "c1", text: "第一轮想的" }),
      ev({ type: "assistant_message", content: "终稿1" }),
      ev({ type: "thinking_delta", callId: "c2", text: "第二轮想的" }),
      ev({ type: "assistant_message", content: "终稿2" }),
    ]);
    const finals = rows.filter((r) => r.kind === "assistant" && r.live !== true);
    expect(finals).toHaveLength(2);
    if (finals[0]?.kind === "assistant") expect(finals[0].thinking).toBe("第一轮想的");
    if (finals[1]?.kind === "assistant") expect(finals[1].thinking).toBe("第二轮想的");
  });

  it("渲染：有思考正文 ⇒ 默认展开且正文在里面；没有 ⇒ 折叠占位", () => {
    const withThink = renderToStaticMarkup(<ThinkingLive seq={1} thinking="我在想…" />);
    expect(withThink).toContain("我在想…");
    expect(withThink).toContain("row think open"); // 有内容默认展开
    const empty = renderToStaticMarkup(<ThinkingLive seq={2} />);
    expect(empty).not.toContain("row think open");
    expect(empty).toContain("这家没吐思考正文时这里就是空的");
  });
});

// 思考档位（2026-10-07 对齐原型 modelBtn/modelPop）：触发条 = 「模型 · 思考 off」单芯片，
// 菜单里出「思考程度（ThinkingEffort）」段——独立分段控件那一版按业主指名废止。
import { filterModelOptions } from "../src/renderer/components/ModelPicker";

describe("思考档位：模型单芯片 + 菜单内的思考程度段（原型形态）", () => {
  const menu = (over: Partial<Parameters<typeof ModelMenu>[0]> = {}): string =>
    renderToStaticMarkup(
      <ModelMenu options={OPTIONS} value="deepseek-chat" onPick={() => undefined} onThinkingChange={() => undefined} {...over} />,
    );

  it("触发条 = 「deepseek-chat · 思考 off」单芯片（原型字面）", () => {
    const html = renderToStaticMarkup(
      <ModelPicker infos={[info]} value="deepseek-chat" onChange={() => undefined} thinking="off" onThinkingChange={() => undefined} />,
    );
    expect(html).toContain("deepseek-chat · 思考 off");
    // 不给 onThinkingChange（如旧消费者）就不显示思考段——触发条保持纯模型名
    const plain = renderToStaticMarkup(<ModelPicker infos={[info]} value="deepseek-chat" onChange={() => undefined} />);
    expect(plain).not.toContain("· 思考");
  });

  it("声明支持 ⇒ off/low/medium/high 四档都在、当前档打勾（aria-selected 计 2）", () => {
    const html = menu({ thinkingSupported: true, thinking: "low" });
    expect(html).toContain("思考程度（ThinkingEffort）");
    for (const label of ["off", "low", "medium", "high"]) expect(html).toContain(`>${label}<`);
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(2); // 模型一档 + 思考一档
  });

  it("未声明支持 ⇒ 只有 off 可点，其余禁用 + 说明怎么解锁（不摆空壳）", () => {
    const html = menu({ thinkingSupported: false });
    expect(html).toContain("capability 未支持");
    expect(html).toContain("reasoningEfforts");
    // 三档被禁用（off 不算）
    expect((html.match(/disabled=""/g) ?? []).length).toBe(3);
  });
});

describe("模型菜单搜索（spec ②）", () => {
  it("filterModelOptions：空查询=原列表；命中 label 或 provider（大小写不敏感）", () => {
    expect(filterModelOptions(OPTIONS, "")).toHaveLength(3);
    expect(filterModelOptions(OPTIONS, "ds").map((o) => o.registryId)).toEqual(["deepseek-chat"]);
    expect(filterModelOptions(OPTIONS, "GPT").map((o) => o.registryId)).toEqual(["openai-standard"]);
    expect(filterModelOptions(OPTIONS, "不存在的")).toHaveLength(0);
  });

  it("「演示」不是被搜的对象：非空查询下永不出现", () => {
    expect(filterModelOptions(OPTIONS, "演")).toHaveLength(0);
    expect(filterModelOptions(OPTIONS, "deepseek").some((o) => o.provider === null)).toBe(false);
  });
});

// 模型选择弹窗（2026-10-07 业主反馈：自定义接口拉到清单后一条条勾太麻烦 → 弹窗 + 全选/全不选）。
import { ModelPickModal, selectAllRows } from "../src/renderer/components/CustomProviderForm";

const PICK_ROWS = [
  { id: "agnes-2.5-pro-alpha", contextWindow: 1_000_000, origin: "catalog" as const },
  { id: "agnes-3.0-flash", origin: "catalog" as const },
  { id: "agnes-video-2.5", origin: "discovery" as const },
];

describe("模型选择弹窗：全选/全不选 + 整行点选", () => {
  it("批量置位是纯函数：一键置全部行，不漏不串", () => {
    expect(selectAllRows(PICK_ROWS, true)).toEqual({
      "agnes-2.5-pro-alpha": true, "agnes-3.0-flash": true, "agnes-video-2.5": true,
    });
    expect(selectAllRows(PICK_ROWS, false)).toEqual({
      "agnes-2.5-pro-alpha": false, "agnes-3.0-flash": false, "agnes-video-2.5": false,
    });
  });

  it("真 HTML：计数行、两个批量按钮、勾选态走 aria-checked", () => {
    const html = renderToStaticMarkup(
      <ModelPickModal rows={PICK_ROWS} selected={selectAllRows(PICK_ROWS, false)} onChange={() => undefined} onDone={() => undefined} />,
    );
    expect(html).toContain('aria-label="选择要启用的模型"');
    expect(html).toContain("已选 0 / 3");
    expect(html).toContain(">全选</button>");
    expect(html).toContain(">全不选</button>");
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(0);
    const partial = renderToStaticMarkup(
      <ModelPickModal rows={PICK_ROWS} selected={{ "agnes-3.0-flash": true }} onChange={() => undefined} onDone={() => undefined} />,
    );
    expect(partial).toContain("已选 1 / 3");
    expect((partial.match(/aria-checked="true"/g) ?? []).length).toBe(1);
  });
});
