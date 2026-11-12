// 自动化任务页（定时工作流模板、保唤开关、任务启停与运行历史）。
import { useEffect, useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Activity, ChevronDown, FileText, Info, ListChecks, Target, TriangleAlert } from "lucide-react";
import type { AutomationDefinition, AutomationSchedule } from "../../../../../src/main/automations";
import type { HistoryEntry, ScheduleSnapshot } from "../../../../../src/main/scheduler";
import { fullTime } from "../memory-view";
import { PAGE_CONTEXT_ITEMS } from "../navigation";
import { activates } from "./a11y-activate";
import { ConfirmDialog } from "./ConfirmDialog";
import { IdleTaskPane } from "./IdleTaskPane";
import { PageFrame } from "./PageFrame";
import { Banner } from "./settings-ui";
import { Switch } from "./Switch";
import { Drawer, Notice } from "./app-page-chrome";
// 自动化任务表单的版式（只含 .ap-form 前缀的规则，够不着插件页那份共用表单）。
import "./automation-form.css";

// 第 1108 页：标题「自动化 工作流」已说明域，副标题不再复述「按时间自动执行工作流」；
// 只留布局说不出的两件事：触发方式与运行结果。两处 PageFrame 共用一句，避免副本漂移。
const AUTOMATION_SUBTITLE = "按时间触发，保留每次运行结果。";

/** AutomationSchedule 判别联合 → 一行人话（七 kind 全覆盖；不编造 cron 字段）。 */
export function scheduleLabel(s: AutomationSchedule): string {
  switch (s.kind) {
    case "once": return `一次性 · ${s.at}`;
    case "interval": return `每 ${String(s.everyMinutes)} 分钟`;
    case "hourly": return `每小时 :${String(s.minute).padStart(2, "0")}`;
    case "daily": return `每天 ${s.time}`;
    case "weekly": return `每周 ${s.weekdays.map((d) => ["日", "一", "二", "三", "四", "五", "六"][d] ?? String(d)).join("/")} ${s.time}`;
    case "monthly": return `每月 ${String(s.monthDay)} 号 ${s.time}`;
    case "custom": return `每 ${String(s.everyDays)} 天 ${s.time}`;
  }
}

/** 反向映射（2026-10-18 编辑任务）：四种表单排程 → 表单字段；monthly/custom 返回 null
 *  （面板表单只覆盖四 kind，不猜、不把复杂排程降级成近似值）。 */
export function scheduleToForm(s: AutomationSchedule): { kind: "once" | "interval" | "daily" | "weekly"; time: string; every: string; at: string; weekdays: number[] } | null {
  switch (s.kind) {
    case "daily": return { kind: "daily", time: s.time, every: "60", at: "", weekdays: [1] };
    case "weekly": return { kind: "weekly", time: s.time, every: "60", at: "", weekdays: [...s.weekdays] };
    case "interval": return { kind: "interval", time: "09:00", every: String(s.everyMinutes), at: "", weekdays: [1] };
    case "once": return { kind: "once", time: "09:00", every: "60", at: s.at, weekdays: [1] };
    default: return null;
  }
}

export function buildSchedule(kind: string, time: string, everyMinutes: string, at: string, weekdays: number[]): AutomationSchedule {
  switch (kind) {
    case "interval": return { kind: "interval", everyMinutes: Number(everyMinutes) || 0 };
    case "daily": return { kind: "daily", time };
    case "weekly": return { kind: "weekly", weekdays, time };
    default: return { kind: "once", at };
  }
}

/** 运行历史在页上只铺最近这么多条（第 934 页）：超出必须在标题里说清，不把尾部冒充整份。 */
const HISTORY_SHOWN = 20;

// 定时任务模板（2026-11-04 业主截图形制）：四张常用工程节奏卡，点卡 = 预填新建表单。
// prompt 都是完整句子（卡片 desc 截断只是版面，不是省略号省掉了半句话）。
interface AutomationTemplate {
  name: string;
  icon: React.JSX.Element;
  desc: string;
  scheduleLine: string;
  tier: "read-only" | "workspace-write" | "danger-full-access";
  prompt: string;
  schedule: AutomationSchedule;
}
const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    name: "晨会动态",
    icon: <Target size={15} aria-hidden="true" />,
    desc: "汇总上一个工作日以来的提交、模块变化、CI 状态和待跟进事项，最终生成不超过 6 条的晨会口述摘要。只读分析，不改任何文件。",
    scheduleLine: "每工作日 09:00",
    tier: "read-only",
    prompt: "汇总上一个工作日以来的提交（git log）、模块变化、CI 状态和待跟进事项，生成不超过 6 条的晨会口述摘要。只读分析，不改任何文件。",
    schedule: { kind: "weekly", weekdays: [1, 2, 3, 4, 5], time: "09:00" },
  },
  {
    name: "风险扫描",
    icon: <Activity size={15} aria-hidden="true" />,
    desc: "检查最近 24 小时的代码变更，识别运行错误、数据丢失、权限绕过、资源泄漏及跨端兼容等高置信风险，并附代码位置与建议修法。只读分析。",
    scheduleLine: "每天 10:00",
    tier: "read-only",
    prompt: "检查最近 24 小时的代码变更（git diff/log），识别运行错误、数据丢失、权限绕过、资源泄漏及跨端兼容等高置信风险，并附代码位置与建议修法。只读分析，不改任何文件。",
    schedule: { kind: "daily", time: "10:00" },
  },
  {
    name: "发布简报",
    icon: <FileText size={15} aria-hidden="true" />,
    desc: "整理本周合并的 PR 和 commit，按功能、修复、体验及工程改进分类，生成团队版和面向用户的精简发布说明各一份，落到 outputs/。",
    scheduleLine: "每周五 16:00",
    tier: "workspace-write",
    prompt: "整理本周合并的 PR 和 commit（git log），按功能、修复、体验及工程改进分类，生成团队版与面向用户的精简发布说明各一份，写到 outputs/ 目录。",
    schedule: { kind: "weekly", weekdays: [5], time: "16:00" },
  },
  {
    name: "文档同步检查",
    icon: <ListChecks size={15} aria-hidden="true" />,
    desc: "对照最近 7 天的代码、配置、接口与文档变更，识别已改变公开行为但文档尚未同步的高置信差异，并附文件路径和需要更新的小节。只读分析。",
    scheduleLine: "每周三 15:00",
    tier: "read-only",
    prompt: "对照最近 7 天的代码、配置、接口与文档变更，识别已改变公开行为但文档尚未同步的高置信差异，并附文件路径和需要更新的小节。只读分析，不改任何文件。",
    schedule: { kind: "weekly", weekdays: [3], time: "15:00" },
  },
];

/** 保唤行（截图那一条）：ⓘ + 一句话 + 开关。开关读写 settings.keepAwake——
 *  主进程经 powerSaveBlocker('prevent-app-suspension') 落地（kernel-host 注入缝）。 */
function AutomationWakeRow(): React.JSX.Element {
  const [on, setOn] = useState<boolean | null>(null); // null = 读取中（开关禁用，不摆假态）
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    setOn(null);
    setError(null);
    void window.agent.getSettings().then((s) => { if (alive) setOn(s.keepAwake === true); }).catch((err: unknown) => {
      if (alive) setError(`保持唤醒设置读取失败：${err instanceof Error ? err.message : String(err)}`);
    });
    return () => { alive = false; };
  }, [attempt]);
  const toggle = (next: boolean): void => {
    if (on === null || saving) return;
    const previous = on;
    setSaving(true);
    setError(null);
    setOn(next);
    void window.agent.setSettings({ keepAwake: next }).then((s) => setOn(s.keepAwake === true)).catch((err: unknown) => {
      setOn(previous);
      setError(`保持唤醒设置保存失败：${err instanceof Error ? err.message : String(err)}`);
    }).finally(() => setSaving(false));
  };
  return (
    <div className="at-wake">
      <Info size={14} aria-hidden="true" />
      <span className="at-wake-text">{error !== null
        ? <span className="danger-text" role="alert">{error}</span>
        : "Cairn 运行会话时保持电脑唤醒。"}</span>
      {on === null && error !== null && <button type="button" className="mini-btn" aria-label="重新读取保持唤醒设置" onClick={() => setAttempt((value) => value + 1)}>重试</button>}
      {on === null && error === null && <span className="sp-dim" role="status">读取中…</span>}
      {on !== null && <Switch
        label="保持电脑唤醒"
        checked={on === true}
        busy={saving}
        onText="开"
        offText="关"
        onChange={toggle}
      />}
    </div>
  );
}

/** 模板网格（截图下半区）：两列卡片 = 图标 + 名称 / 两三行描述 / 底部排程行。 */
function TemplateGrid(props: { onPick: (tpl: AutomationTemplate) => void }): React.JSX.Element {
  return (
    <section className="at-templates" aria-label="定时任务模板">
      <h2 className="at-templates-title">定时任务模板</h2>
      <div className="at-template-grid">
        {AUTOMATION_TEMPLATES.map((tpl) => (
          <button key={tpl.name} className="at-template-card" onClick={() => props.onPick(tpl)}>
            <span className="at-template-head">{tpl.icon}<span>{tpl.name}</span></span>
            <span className="at-template-desc">{tpl.desc}</span>
            <span className="at-template-schedule">{tpl.scheduleLine}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function AutomationPane(props: {
  snap: ScheduleSnapshot;
  onError: (m: string) => void;
  refresh: () => void;
  workspace?: string | null;
  filter?: string;
  onFilter?: (filter: string) => void;
}): React.JSX.Element {
  const schedule = props.snap;
  const [idleView, setIdleView] = useState(false);
  // 装载期坏档 / 坏行上屏（2026-10-30）：桌面没有控制台，只 warn 的后果是
  // 「automations.json 坏了 ⇒ 页面写着还没有定时任务，新建又被拒」，用户无从知道原因。
  // 坏档时任务表恰好是空的 ⇒ 空态分支也必须摆这条横幅。
  const warningBanner = schedule.warnings.length === 0 ? null : (
    <Banner
      tone="warn"
      icon={<TriangleAlert size={13} />}
      {...(schedule.warnings.length > 1
        ? { details: <div>{schedule.warnings.map((w) => <div key={w}>{w}</div>)}</div> }
        : {})}
    >
      {schedule.definitionsCorrupt
        ? `${schedule.warnings[0] ?? ""}。修好之前，新建、修改、删除任务都会被拒绝。`
        : schedule.warnings.length === 1
          ? `装载警告：${schedule.warnings[0] ?? ""}`
          : `有 ${String(schedule.warnings.length)} 条装载警告；其余任务照常运行。`}
    </Banner>
  );
  const [query, setQuery] = useState("");
  const [localFilter, setLocalFilter] = useState("all");
  const [sortByName, setSortByName] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 新建表单（表单四 kind：once / interval / daily / weekly）。
  const [creating, setCreating] = useState(false);
  const [fName, setFName] = useState("");
  const [fPrompt, setFPrompt] = useState("");
  const [fKind, setFKind] = useState<"once" | "interval" | "daily" | "weekly">("daily");
  const [fTime, setFTime] = useState("09:00");
  const [fEvery, setFEvery] = useState("60");
  const [fAt, setFAt] = useState("");
  const [fWeekdays, setFWeekdays] = useState<number[]>([1]);
  const [fTier, setFTier] = useState<"read-only" | "workspace-write" | "danger-full-access">("read-only");
  const [busy, setBusy] = useState(false);
  // 编辑态（2026-10-18）：整条任务留底（enabled/timeZone/catchUp/model 在保存时原样带回，
  // 表单只改 name/prompt/排程/档位——局部 upsert 会把未展示字段重置成默认值）。
  const [editing, setEditing] = useState<AutomationDefinition | null>(null);
  // 删除任务确认（2026-10-17：原生 confirm → 产品自绘卡）
  const [deleteAsk, setDeleteAsk] = useState<{ id: string; name: string } | null>(null);

  const filter = props.filter ?? localFilter;
  const setFilter = props.onFilter ?? setLocalFilter;
  const q = query.trim().toLowerCase();
  // 第 1138 页：rows 先记忆，list 的排序 memo 才有依赖稳定性；选中项同理。
  const rows = useMemo(() => schedule.tasks
    .filter((t) => (filter === "all" ? true : filter === "on" ? t.enabled : !t.enabled))
    .filter((t) => (t.name + t.prompt).toLowerCase().includes(q)), [schedule.tasks, filter, q]);
  const list = useMemo(() => (sortByName ? [...rows].sort((a, b) => a.name.localeCompare(b.name, "zh")) : rows), [rows, sortByName]);
  const selected = useMemo(() => sel === null ? null : schedule.tasks.find((x) => x.id === sel) ?? null, [schedule.tasks, sel]);

  const submitCreate = () => {
    setNotice(null);
    setBusy(true);
    const def: Partial<AutomationDefinition> = {
      ...(editing ?? {}),
      name: fName.trim(),
      prompt: fPrompt,
      schedule: buildSchedule(fKind, fTime, fEvery, fAt, fWeekdays),
      permissionTier: fTier,
    };
    void window.agent.scheduleUpsert(def, true).then((r) => {
      if (!r.ok) { props.onError(r.error ?? (editing === null ? "创建失败" : "保存失败")); return; }
      const wasEditing = editing !== null;
      setCreating(false);
      setEditing(null);
      setFName(""); setFPrompt(""); setFAt("");
      setNotice(wasEditing ? "任务已更新（按新排程重算下次触发）" : "任务已创建（触发 = 全新会话 · unattended）");
      props.refresh();
    }).catch((err: unknown) => props.onError(`${editing === null ? "创建" : "保存"}失败：${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setBusy(false));
  };

  /** 开表单（新建）：先清编辑态，否则会带着上一条任务的底子开。 */
  const openCreateForm = (): void => { setEditing(null); setCreating(true); };
  /** 收表单：空态分支不渲染工具行，「取消」是那儿唯一的退路。 */
  const closeCreateForm = (): void => { setEditing(null); setCreating(false); };
  /** 模板预填（2026-11-04 截图形制）：点模板卡/下拉项 = 带着整套字段开新建表单。 */
  const applyTemplate = (tpl: AutomationTemplate): void => {
    setEditing(null);
    setFName(tpl.name);
    setFPrompt(tpl.prompt);
    const fields = scheduleToForm(tpl.schedule);
    if (fields === null) { setFKind("daily"); setFTime("09:00"); }
    else { setFKind(fields.kind); setFTime(fields.time); setFEvery(fields.every); setFAt(fields.at); setFWeekdays(fields.weekdays); }
    setFTier(tpl.tier);
    setCreating(true);
  };

  // 表单抽成变量；空态里的「新建任务」与工具行的「＋新建任务」走同一条开合路径。
  // 2026-11-03：空态与表单不再同时在场——点开表单后空态整块让位（此前空态留在原位、
  // 表单摊在它下面，一屏两块在说同一件事）；表单自带「取消」，空态下也有退路
  // （空态分支不渲染工具行，此前点了「新建任务」只能靠工具行的「收起表单」收，而它不在场）。
  const createForm = creating ? (
    <div className="ap-form" role="region" aria-label={editing === null ? "新建任务" : "编辑任务"}>
      <h2 className="ap-form-title">{editing === null ? "新建任务" : "编辑任务"}</h2>
      <div className="ap-form-row">
        <label className="ap-k" htmlFor="at-name">名称</label>
        <input id="at-name" value={fName} placeholder="如：每日巡检" onChange={(e) => setFName(e.target.value)} />
      </div>
      <div className="ap-form-row">
        <label className="ap-k" htmlFor="at-prompt">提示词</label>
        <textarea id="at-prompt" rows={4} value={fPrompt} placeholder="到时间后，让 Cairn 做什么？" onChange={(e) => setFPrompt(e.target.value)} />
      </div>
      <div className="ap-form-settings" data-kind={fKind}>
      <div className="ap-form-row">
        <span className="ap-k">排程</span>
        <div className="ap-form-ctl">
          <select aria-label="排程频率" value={fKind} onChange={(e) => setFKind(e.target.value as typeof fKind)}>
            <option value="daily">每天</option>
            <option value="interval">每 N 分钟</option>
            <option value="weekly">每周</option>
            <option value="once">一次性</option>
          </select>
          {(fKind === "daily" || fKind === "weekly") && <input type="time" aria-label="时间 HH:MM" value={fTime} onChange={(e) => setFTime(e.target.value)} />}
          {fKind === "interval" && <input type="number" min={1} aria-label="每 N 分钟" value={fEvery} placeholder="60" onChange={(e) => setFEvery(e.target.value)} />}
          {fKind === "once" && <input aria-label="ISO 时间" value={fAt} placeholder="2026-11-01T09:00:00" onChange={(e) => setFAt(e.target.value)} />}
          {fKind === "weekly" && (
            <span className="ap-weekdays">
              {["日", "一", "二", "三", "四", "五", "六"].map((d, i) => (
                <button
                  key={d}
                  aria-pressed={fWeekdays.includes(i)}
                  className={"chip" + (fWeekdays.includes(i) ? " on" : "")}
                  onClick={() => setFWeekdays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))}
                >{d}</button>
              ))}
            </span>
          )}
        </div>
      </div>
      <div className="ap-form-row">
        <label className="ap-k" htmlFor="at-tier">权限档</label>
        <select id="at-tier" value={fTier} onChange={(e) => setFTier(e.target.value as typeof fTier)}>
          <option value="read-only">只读</option>
          <option value="workspace-write">可修改工作区</option>
          <option value="danger-full-access">完全访问（慎用）</option>
        </select>
      </div>
      </div>
      <div className="ap-form-note">
        {editing !== null && <span className="sp-dim">正在编辑「{editing.name}」；启用状态/时区/模型保持不变。</span>}
        <span className="sp-dim">触发时自动发起新对话；无人值守场景下，需要审批的操作一律拒绝。</span>
      </div>
      <div className="ap-form-actions">
        <button className="mini-btn" disabled={busy} onClick={closeCreateForm}>取消</button>
        <button className="mini-btn primary" disabled={busy || fName.trim() === "" || fPrompt.trim() === ""} onClick={submitCreate}>
          {busy ? (editing === null ? "创建中…" : "保存中…") : (editing === null ? "创建" : "保存")}
        </button>
      </div>
    </div>
  ) : null;

  const tabs = (
    <div className="automation-views" role="group" aria-label="自动化类型">
      <button className={`mini-btn${idleView ? "" : " primary"}`} aria-pressed={!idleView} onClick={() => setIdleView(false)}>定时任务</button>
      <button className={`mini-btn${idleView ? " primary" : ""}`} aria-pressed={idleView} onClick={() => setIdleView(true)}>闲时队列</button>
    </div>
  );
  if (idleView) return <IdleTaskPane key={props.workspace ?? ""} tabs={tabs} filter={filter} onFilter={setFilter} />;

  // 任务为 0 但历史非空 ⇒ 不能只显示 EmptyState：运行历史仍在快照里，
  // 旧分支会让「删光任务」后的运行历史/统计整块不可见（空态隐藏真实数据）。
  if (schedule.tasks.length === 0 && schedule.history.length === 0) {
    return (
      <PageFrame
        title="自动化"
        titleAccent="工作流"
        subtitle={AUTOMATION_SUBTITLE}
        actions={tabs}
        search={{ label: "搜索任务", value: query, onChange: setQuery }}
        onRefresh={props.refresh}
        filters={PAGE_CONTEXT_ITEMS.automation}
        activeFilter={filter}
        onFilter={setFilter}
      >
        {warningBanner}
        {creating ? createForm : (
          /* 空态大卡（2026-11-04 业主截图形制）：居中一句 + 白色胶囊下拉（模板/空白）。
             下拉内容必须包 Portal——页体容器 overflow:hidden 会把内联弹层裁掉（工具菜单同款坑）。 */
          <div className="at-hero">
            <div className="at-hero-card">
              <div className="at-hero-empty">还没有定时任务</div>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button className="at-hero-create" aria-haspopup="menu">
                    创建定时任务
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="pop-rd" side="bottom" align="center" sideOffset={6}>
                    {AUTOMATION_TEMPLATES.map((tpl) => (
                      <DropdownMenu.Item key={tpl.name} className="menu-item" onSelect={() => applyTemplate(tpl)}>
                        <span>{tpl.name}</span>
                        <span className="sub">{tpl.scheduleLine}</span>
                      </DropdownMenu.Item>
                    ))}
                    <DropdownMenu.Separator className="menu-sep" />
                    <DropdownMenu.Item className="menu-item" onSelect={openCreateForm}>
                      <span>空白自定义</span>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        )}
        <AutomationWakeRow />
        <TemplateGrid onPick={applyTemplate} />
        <Notice text={notice} />
      </PageFrame>
    );
  }

  return (
    <PageFrame
      title="自动化"
      titleAccent="工作流"
      subtitle={AUTOMATION_SUBTITLE}
      actions={tabs}
      search={{ label: "搜索任务", value: query, onChange: setQuery }}
      onRefresh={props.refresh}
      filters={PAGE_CONTEXT_ITEMS.automation}
      activeFilter={filter}
      onFilter={setFilter}
    >
      {warningBanner}
      <AutomationWakeRow />
      {/* 2026-11-02：与记忆页同形——四张统计卡换成一行紧凑摘要（此前同一套页框架两套统计形态）。 */}
      <div className="automation-toolbar">
      <div className="ap-summary" role="status">
        <span className="ap-summary-item">任务 <strong>{String(schedule.tasks.length)}</strong></span>
        <span className="ap-summary-item">启用中 <strong>{String(schedule.tasks.filter((t) => t.enabled).length)}</strong></span>
        <span className="ap-summary-item" title={`同时最多运行 ${String(schedule.cap)} 个；启动时自动补跑${schedule.startupDone ? "已完成" : "待进行"}`}>运行中 <strong>{String(schedule.running)}</strong>/{String(schedule.cap)}</span>
        <span className="ap-summary-item">队列 <strong>{String(schedule.queued)}</strong></span>
      </div>
      <div className="ap-toolbar">
        <select className="memory-sort" aria-label="任务排序" value={sortByName ? "name" : "default"} onChange={(event) => setSortByName(event.target.value === "name")}>
          <option value="default">默认顺序</option><option value="name">按名称</option>
        </select>
        <button className="mini-btn primary" onClick={() => { if (creating) closeCreateForm(); else openCreateForm(); }} aria-expanded={creating}>
          {creating ? "收起表单" : "＋ 新建任务"}
        </button>
      </div>
      </div>
      <Notice text={notice} />
      {createForm}
      <div className={"ap-split" + (selected !== null ? " has-drawer" : "")}>
        <div>
          <div className="ap-list automation-list">
            {list.length === 0 && <div className="ap-empty">没有匹配的任务</div>}
            {list.map((t) => (
              <div key={t.id} className={"ap-item" + (sel === t.id ? " on" : "")} onClick={() => setSel(t.id)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (activates(e)) { e.preventDefault(); setSel(t.id); } }}>
                <span className="nm" title={t.name}>{t.name}</span>
                <span className={"sp-tag" + (t.enabled ? " ok" : "")}>{t.enabled ? "启用" : "停用"}</span>
                <span className="sub" title={scheduleLabel(t.schedule)}>{scheduleLabel(t.schedule)}</span>
                {t.nextRunAt !== undefined && <span className="r sub">下次 {fullTime(t.nextRunAt)}</span>}
              </div>
            ))}
          </div>
          {/* 没有历史就不摆「运行历史（0 条）」+「暂无运行记录」两层空话：区块本身缺席即是答案。 */}
          {schedule.history.length > 0 && <div className="ap-gtitle">
            运行历史（{String(schedule.history.length)} 条{schedule.history.length > HISTORY_SHOWN ? ` · 只显示最近 ${String(HISTORY_SHOWN)} 条` : ""}）
          </div>}
          {schedule.history.length > 0 && <div className="ap-list">
            {schedule.history.slice(0, HISTORY_SHOWN).map((h: HistoryEntry, i: number) => (
              <div key={i} className="ap-li">
                <span className="kind">{h.state}</span>
                <span className="p">{fullTime(h.due_at)} · {h.task_name}{h.session_id !== undefined ? ` · ${h.session_id}` : ""}</span>
              </div>
            ))}
          </div>}
        </div>
        {selected !== null && (
          <Drawer key={selected.id} title={selected.name} sub={`${scheduleLabel(selected.schedule)} · ${selected.timeZone}`} onClose={() => setSel(null)}>
            <section className="ap-sec">
              <h3>提示词</h3>
              <div className="ap-prompt">{selected.prompt}</div>
            </section>
            <section className="ap-sec">
              <div className="ap-actions-row">
                <button
                  className="mini-btn"
                  onClick={() => {
                    const fields = scheduleToForm(selected.schedule);
                    if (fields === null) { props.onError("该排程类型（monthly/custom）暂不支持在面板编辑"); return; }
                    setFName(selected.name);
                    setFPrompt(selected.prompt);
                    setFKind(fields.kind); setFTime(fields.time); setFEvery(fields.every); setFAt(fields.at); setFWeekdays(fields.weekdays);
                    setFTier(selected.permissionTier);
                    setEditing(selected);
                    setCreating(true);
                    setSel(null);
                  }}
                >编辑任务</button>
                <Switch
                  label="启用任务"
                  checked={selected.enabled}
                  onText="启用"
                  offText="停用"
                  onChange={(next) => {
                    void window.agent.scheduleUpsert({ ...selected, enabled: next }, false).then((r) => {
                      if (!r.ok) props.onError(r.error ?? "更新失败"); else props.refresh();
                    }).catch((err: unknown) => props.onError(`更新失败：${err instanceof Error ? err.message : String(err)}`));
                  }}
                />
                <button
                  className="mini-btn"
                  onClick={() => {
                    void window.agent.scheduleRunNow(selected.id).then((r) => {
                      if (!r.ok) props.onError(r.error ?? "触发失败");
                      else setNotice("已触发 · 新会话运行中");
                    }).catch((err: unknown) => props.onError(`触发失败：${err instanceof Error ? err.message : String(err)}`));
                  }}
                >立即运行</button>
                <button
                  className="mini-btn danger-text"
                  onClick={() => { setDeleteAsk({ id: selected.id, name: selected.name }); }}
                >删除</button>
              </div>
            </section>
            <section className="ap-sec">
              <div className="ap-kv">权限档 {selected.permissionTier} · 补跑{selected.catchUp ? "开" : "关"} · 需审批的操作自动拒绝</div>
            </section>
          </Drawer>
        )}
      </div>
      {deleteAsk !== null && (
        <ConfirmDialog
          title={`删除任务「${deleteAsk.name}」？`}
          note="删除后不再触发；已产生的运行历史保留。"
          confirmLabel="删除"
          danger
          onClose={() => setDeleteAsk(null)}
          onConfirm={() => {
            const ask = deleteAsk;
            setDeleteAsk(null);
            void window.agent.scheduleDelete(ask.id).then((r) => {
              if (!r.ok) props.onError(r.error ?? "删除失败");
              else { setSel(null); setNotice("任务已删除"); props.refresh(); }
            }).catch((err: unknown) => props.onError(`删除失败：${err instanceof Error ? err.message : String(err)}`));
          }}
        />
      )}
      <TemplateGrid onPick={applyTemplate} />
    </PageFrame>
  );
}
