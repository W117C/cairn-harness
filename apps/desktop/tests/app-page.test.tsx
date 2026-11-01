// 应用页判卷（插件 / 自动化任务 / 技能中心 / 记忆系统）：人话反解纯函数 + 页体并入设置。
// 口径：七 kind 人话全覆盖（不编造字段）；表单四 kind 映射；分区顺序/标签单一事实源（PAGE_ORDER/PAGE_META）。
// 2026-10-16（记忆页重做）追加：抽屉顺序（D）/ 索引逐行渲染（E）/ 相对时间（F）——抽屉要点击才开、
// SSR 不可达，按本仓惯例走源码哨兵钉（紧邻事实源，防回退）。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AppPageBody, AutomationPane, PAGE_META, PAGE_ORDER, buildSchedule, scheduleLabel } from "../src/renderer/components/AppPage";
import { WorktreesPane } from "../src/renderer/components/WorktreesPane";
import { readAppSurface } from "./helpers/app-surface";

describe("scheduleLabel（七 kind 人话）", () => {
  it("每种 kind 一句人话，不编造字段", () => {
    expect(scheduleLabel({ kind: "once", at: "2026-11-01T09:00:00" })).toBe("一次性 · 2026-11-01T09:00:00");
    expect(scheduleLabel({ kind: "interval", everyMinutes: 60 })).toBe("每 60 分钟");
    expect(scheduleLabel({ kind: "hourly", minute: 5 })).toBe("每小时 :05");
    expect(scheduleLabel({ kind: "daily", time: "09:00" })).toBe("每天 09:00");
    expect(scheduleLabel({ kind: "weekly", weekdays: [1, 5], time: "09:30" })).toBe("每周 一/五 09:30");
    expect(scheduleLabel({ kind: "monthly", monthDay: 1, time: "08:00" })).toBe("每月 1 号 08:00");
    expect(scheduleLabel({ kind: "custom", everyDays: 3, time: "07:00" })).toBe("每 3 天 07:00");
  });
});

describe("buildSchedule（表单四 kind 映射）", () => {
  it("interval/daily/weekly/once 各自成形（参数原样，非法留给服务端校验）", () => {
    expect(buildSchedule("interval", "", "60", "", [])).toEqual({ kind: "interval", everyMinutes: 60 });
    expect(buildSchedule("daily", "09:00", "", "", [])).toEqual({ kind: "daily", time: "09:00" });
    expect(buildSchedule("weekly", "09:30", "", "", [1, 5])).toEqual({ kind: "weekly", weekdays: [1, 5], time: "09:30" });
    expect(buildSchedule("once", "", "", "2026-11-01T09:00:00", [])).toEqual({ kind: "once", at: "2026-11-01T09:00:00" });
  });

  it("interval 非数字 ⇒ 0（会被服务端拒绝并回显错误，不在界面侧假装合法）", () => {
    expect(buildSchedule("interval", "", "abc", "", [])).toEqual({ kind: "interval", everyMinutes: 0 });
  });
});

describe("页体并入设置（v7.1 业主裁）：AppPageBody + 事实源", () => {
  it("AppPageBody forwards the selected plugin filter without inventing another state owner", () => {
    const source = readAppSurface();
    expect(source).toContain("filter={activeFilter}");
    expect(source).toContain("onFilter={setActiveFilter}");
  });

  it("page frames do not render duplicate pane pills", () => {
    const source = readAppSurface();
    expect(source).not.toContain("<PanePills");
  });

  it("PAGE_ORDER 顺序固定、PAGE_META 标签齐备（设置页导航从这里渲染，不许各抄一份）", () => {
    expect(PAGE_ORDER).toEqual(["plugins", "automation", "skills", "memory", "worktrees"]);
    expect(PAGE_ORDER.map((p) => PAGE_META[p].label)).toEqual(["插件", "自动化任务", "技能中心", "记忆系统", "工作树"]);
  });

  it("工作树页：孤儿逐条列出 + 清理按钮；空态不摆假列表", () => {
    const html = renderToStaticMarkup(<WorktreesPane snap={{ workspace: "/tmp/ws", orphans: ["worker-3"], details: [{ name: "worker-3", dirty: true }] }} onError={() => undefined} refresh={() => undefined} />);
    expect(html).toContain("wt-worker-3");
    expect(html).toContain("清理");
    expect(html).toContain("有未提交改动");
    expect(html).toContain('data-dirty="true"');
    // 清理目标必须带快照的工作区：切项目后 activeWorkspace 是旧值，clean 不能拿它去删。
    expect(html).toContain('data-workspace="/tmp/ws"');
    const empty = renderToStaticMarkup(<WorktreesPane snap={{ workspace: "/tmp/ws", orphans: [] }} onError={() => undefined} refresh={() => undefined} />);
    expect(empty).toContain("没有遗留的工作树");
  });

  it("SSR 首帧：页体带 aria-label 与诚实占位（快照未到时说明，不摆空壳内容）", () => {
    const html = renderToStaticMarkup(<AppPageBody page="automation" />);
    expect(html).toContain('aria-label="自动化任务"');
    expect(html).toContain('class="page-frame"');
    expect(html).toContain('<h1 class="page-frame-title">自动化任务</h1>');
    expect(html).toContain("正在读取快照…");
  });
});

describe("记忆页重做（2026-10-16 业主裁 · D/E/F · 源码哨兵）", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/AppPage.tsx", import.meta.url)), "utf8");

  it("D：抽屉顺序 = 主题正文 → 索引 → 待批外部引用 → 删除（底置、描边红小按钮 + 二次确认）", () => {
    let last = -1;
    for (const h3 of ["<h3>主题正文</h3>", "<h3>索引（MEMORY.md）</h3>", "<h3>待批外部引用</h3>", "<h3>删除</h3>"]) {
      const at = src.indexOf(h3);
      expect(at, h3).toBeGreaterThan(last);
      last = at;
    }
    expect(src).toContain("ap-drawer-foot");                      // 删除收进面板底部
    expect(src).toContain('className="mini-btn danger-text"');    // 描边红小按钮
    // 2026-10-17：二次确认从原生 confirm 换成 ConfirmDialog（danger 实底 + 后果说明）。
    expect(src).toContain("<ConfirmDialog");
    expect(src).toContain("setTopicAsk({ layer: selLayer as \"project\" | \"global\", topic: selected.topic })");
    expect(src).toContain('confirmLabel="删除"');
    expect(src).not.toContain("window.confirm(");
  });

  it("E：索引逐行渲染（indexLines + renderInline）——** 不再原样上屏", () => {
    expect(src).toContain("indexLines(selectedLayer.index)");
    expect(src).toContain("renderInline(line)");
    expect(src).not.toContain('<pre className="ap-index"');       // 旧直出体下架
  });

  it("F：元信息相对时间（列表与抽屉），悬停给完整时间", () => {
    // 2026-10-18：now 改由 useNow() 提供（页面停留时相对时间会自己走），参数序不变。
    expect(src).toContain("relativeTime(r.topic.modified, now)");
    expect(src).toContain("const now = useNow();");
    expect(src).toContain("title={fullTime(r.topic.modified)}");
    expect(src).toContain("subTitle={fullTime(selected.modified)}");
  });

  it("H：列表行顺序 = 名称 / 元信息 / 类型标签（标签钉右；省略交给 .ap-item 的 CSS 契约）", () => {
    const rowAt = src.indexOf('<span className="nm">{r.topic.topic}</span>');
    const subAt = src.indexOf('<span className="sub" title={fullTime(r.topic.modified)}>');
    const tagAt = src.indexOf('<span className="sp-tag">{r.layer === "project" ? "项目层" : "全局层"}</span>');
    expect(rowAt).toBeGreaterThan(-1);
    expect(subAt).toBeGreaterThan(rowAt);
    expect(tagAt).toBeGreaterThan(subAt);
  });

  it("G/H/E 样式哨兵：统计等分整行、名称可省略、标签不缩、索引行渲染样式在", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
    // G：按实际枚数等分（原 repeat(4,1fr) 写死四轨 ⇒ 3 枚时右空一轨）
    expect(css).toContain(".ap-stats { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--space-sm); }");
    // H：名称单行省略 + 标签不缩
    expect(css).toMatch(/\.ap-item \.nm \{[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/\.ap-item \.sp-tag \{ flex: none; \}/);
    // E：索引逐行卡内样式在
    expect(css).toContain(".ap-index-line");
    expect(css).toContain(".ap-drawer-foot");
  });

  // 2026-10-16 补通道（业主「解决问题」单）：主题正文进快照后，「主题正文」区不再摆「待接」占位。
  it("主题正文补通道：渲染 selected.body 逐行（renderInline），「待接」占位下架", () => {
    const secAt = src.indexOf("<h3>主题正文</h3>");
    const secEnd = src.indexOf("<h3>索引（MEMORY.md）</h3>");
    expect(secAt).toBeGreaterThan(-1);
    expect(secEnd).toBeGreaterThan(secAt);
    const sec = src.slice(secAt, secEnd);
    expect(sec).not.toContain("待接");                    // 占位下架（通道已接）
    expect(sec).not.toContain("快照不含正文");
    expect(sec).toContain("bodyLines(selected.body)");    // 正文切行走同一纯函数纪律
    expect(sec).toContain("renderInline(line)");
    expect(sec).toContain('className="ap-drawer-body"');
    expect(sec).toContain("此主题暂无正文");               // 空正文回落不摆空壳
    // 空态文案只在空数组分支（有正文时不渲染回落句）
    expect(sec.indexOf("bodyLines(selected.body)") < sec.indexOf("此主题暂无正文")).toBe(true);
  });
});

// 2026-10-30：自动化文件坏掉时，页面上要能读到「哪份文件、什么原因、还能不能写」。
// 此前只 console.warn（桌面没有控制台），空态还写着「还没有定时任务」——把失败伪装成空。
describe("自动化页：装载警告上屏（空态分支也要摆）", () => {
  const corrupt = {
    tasks: [], history: [], running: 0, queued: 0, cap: 2, startupDone: true, tzNotes: {},
    warnings: [`调度任务文件损坏：/tmp/cairn/automations.json（JSON 解析失败）——修好或删除该文件后重试，本次不覆盖`],
    definitionsCorrupt: true,
  };
  const clean = { ...corrupt, warnings: [], definitionsCorrupt: false };

  it("坏档：横幅点名文件与原因，并说清写路径会被拒；空态仍在（不是二选一）", () => {
    const html = renderToStaticMarkup(<AutomationPane snap={corrupt} onError={() => undefined} refresh={() => undefined} />);
    expect(html).toContain("调度任务文件损坏");
    expect(html).toContain("/tmp/cairn/automations.json");
    expect(html).toContain("新建、修改、删除任务都会被拒绝");
    expect(html, "坏档整页只剩空态 = 用户读成「本来就没有任务」").toContain("还没有定时任务");
    expect(html).toContain("ss-banner warn");
  });

  it("缺文件 / 正常：不摆警告横幅（缺席不是失败）", () => {
    const html = renderToStaticMarkup(<AutomationPane snap={clean} onError={() => undefined} refresh={() => undefined} />);
    expect(html).not.toContain("调度任务文件损坏");
    expect(html).not.toContain("ss-banner warn");
    expect(html).toContain("还没有定时任务");
  });

  it("坏条目（文件仍可写）：横幅说「已跳过」，不说写路径会被拒", () => {
    const partial = {
      ...clean,
      warnings: ["automations.json 第 2 条无效已跳过：name 缺失"],
      definitionsCorrupt: false,
    };
    const html = renderToStaticMarkup(<AutomationPane snap={partial} onError={() => undefined} refresh={() => undefined} />);
    expect(html).toContain("已跳过");
    expect(html).toContain("name 缺失");
    expect(html).not.toContain("新建、修改、删除任务都会被拒绝");
  });
});

// 第 934 页：运行历史把 due_at 的原始 ISO 直接摆上屏（旁边「下次」却是 toLocaleString），
// 且只铺 20 条却不说——25 条时标题写着 25，列表只到 20，尾部被当成整份读。
describe("自动化页：时间口径与历史截断要说清", () => {
  const task = {
    id: "t1", name: "每日备份", prompt: "备份仓库", schedule: { kind: "daily", time: "03:00" },
    timeZone: "Asia/Shanghai", permissionTier: "read-only", catchUp: "skip", enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    nextRunAt: "2026-11-02T03:00:00.000Z",
  };
  const entry = (i: number) => ({
    task_id: "t1", task_name: "每日备份", occurrence_key: `t1:${String(i)}`,
    due_at: "2026-11-01T03:00:00.000Z", decision: "triggered", state: "triggered",
    at: "2026-11-01T03:00:01.000Z",
  });
  const snap = (n: number) => ({
    tasks: [task], history: Array.from({ length: n }, (_, i) => entry(i)),
    running: 0, queued: 0, cap: 2, startupDone: true, tzNotes: {}, warnings: [], definitionsCorrupt: false,
  }) as never;

  it("due_at 与「下次」都按本地时间显示，不摆原始 ISO", () => {
    const html = renderToStaticMarkup(<AutomationPane snap={snap(1)} onError={() => undefined} refresh={() => undefined} />);
    expect(html).not.toContain("2026-11-01T03:00:00.000Z");
    expect(html).not.toContain("2026-11-02T03:00:00.000Z");
    expect(html).toContain("2026-11-01");
    expect(html).toContain("2026-11-02");
  });

  it("超过 20 条：标题说清只显示最近 20 条（不把尾部冒充整份）", () => {
    const html = renderToStaticMarkup(<AutomationPane snap={snap(25)} onError={() => undefined} refresh={() => undefined} />);
    expect(html).toContain("运行历史（25 条 · 只显示最近 20 条）");
  });

  it("不超过 20 条：不加那句（说多了也是噪音）", () => {
    const html = renderToStaticMarkup(<AutomationPane snap={snap(3)} onError={() => undefined} refresh={() => undefined} />);
    expect(html).toContain("运行历史（3 条）");
    expect(html).not.toContain("只显示最近");
  });
});

describe("目的地错误不泄漏到对话", () => {
  it("AppPage 的 reportError 只写本页 operationError，不再回调工作台 lastError", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/AppPage.tsx", import.meta.url)), "utf8");
    expect(src).not.toContain("props.onError?.(message)");
    const view = readFileSync(fileURLToPath(new URL("../src/renderer/panes/WorkbenchView.tsx", import.meta.url)), "utf8");
    const pageCall = view.slice(view.indexOf("<AppPageBody"), view.indexOf("/>", view.indexOf("<AppPageBody")) + 2);
    expect(pageCall).not.toContain("onError=");
  });
});
