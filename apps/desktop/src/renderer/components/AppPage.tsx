// 应用页（插件 / 自动化任务 / 技能中心 / 记忆系统）——Claude 蓝本 v1 重建。
// v7.1 业主裁：四页不再自带整页宿主——以「页体」（AppPageBody）并入**设置页分区**渲染；
// 侧栏页脚只留头像菜单（设置/关于入菜单）。
// 每页组织：统计行（仅真实字段）+ 工具行（搜索/筛选/排序）+ 列表 + 详情抽屉。
// 数据面：getState() 真快照；操作走既有 IPC（scheduleUpsert/Delete/RunNow、pluginDecide、deleteMemory）。
// 未接通的能力显式标「待接」——不摆空壳。（技能指令正文 2026-10-18 接通；插件技能/命令清单同批列出。）
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNow } from "../useNow";
import { ConfirmDialog } from "./ConfirmDialog";
import { WorktreesPane } from "./WorktreesPane";
import { BookOpen, Brain, Clock, Puzzle } from "lucide-react";
import type { MemorySnapshot } from "../../../../../src/main/ipc-protocol";
import type { AutomationDefinition, AutomationSchedule } from "../../../../../src/main/automations";
import type { ScheduleSnapshot, HistoryEntry } from "../../../../../src/main/scheduler";
import type { PluginPanelSnapshot } from "../../../../../src/agent/plugins";
import { STR } from "../strings";
import { Switch } from "./Switch";
import { EmptyState } from "./settings-ui";
import { activates } from "./a11y-activate";
import { bodyLines, fullTime, indexLines, relativeTime } from "../memory-view";
import { renderInline } from "../markdown";
import { PAGE_META, PAGE_ORDER, type PageId } from "./settings-nav";

export { PAGE_META, PAGE_ORDER, type PageId };

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

/** cron 人话反解（表单四 kind 输入 → schedule 对象；非法输入由 submit 时校验返回）。 */
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

function Stats(props: { items: Array<{ k: string; v: string | number; warn?: boolean }> }): React.JSX.Element {
  return (
    <div className="ap-stats">
      {props.items.map((s) => (
        <div key={s.k} className={"ap-stat" + (s.warn === true ? " warn" : "")}>
          <div className="k">{s.k}</div>
          <div className="v num">{String(s.v)}</div>
        </div>
      ))}
    </div>
  );
}

function Toolbar(props: {
  query: string; onQuery: (q: string) => void;
  filters: readonly { id: string; label: string }[]; filter: string; onFilter: (f: string) => void;
  sortLabel?: string; onSort?: () => void;
}): React.JSX.Element {
  return (
    <div className="ap-toolbar">
      <input
        className="ap-search"
        value={props.query}
        placeholder="搜索…"
        aria-label="搜索"
        onChange={(e) => props.onQuery(e.target.value)}
      />
      <div className="ap-fchips">
        {props.filters.map((f) => (
          <button key={f.id} className={"chip" + (props.filter === f.id ? " on" : "")} onClick={() => props.onFilter(f.id)}>
            {f.label}
          </button>
        ))}
        {props.onSort !== undefined && (
          <button className="chip" onClick={props.onSort}>{props.sortLabel ?? "排序"}</button>
        )}
      </div>
    </div>
  );
}

function Drawer(props: { title: string; sub?: string; subTitle?: string; onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <aside className="ap-drawer" aria-label="详情">
      <div className="ap-drawer-head">
        <span className="nm">{props.title}</span>
        <button className="mini-btn" onClick={props.onClose}>关闭</button>
      </div>
      {props.sub !== undefined && <div className="ap-drawer-sub" title={props.subTitle}>{props.sub}</div>}
      <div className="ap-drawer-body">{props.children}</div>
    </aside>
  );
}

function Notice(props: { text: string | null }): React.JSX.Element | null {
  if (props.text === null) return null;
  return <div className="ap-notice" role="status">{props.text}</div>;
}

// ── 插件页 ────────────────────────────────────────────────────────

export function PluginsPane(props: { snap: PluginPanelSnapshot; onError: (m: string) => void; refresh: () => void; onInvoke?: (invoke: string) => void }): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sel, setSel] = useState<string | null>(null);
  const [trustBusy, setTrustBusy] = useState<string | null>(null);
  // 插件技能的正文预览（2026-10-18）：按 /plugin:skill 拉一次，展开/收起不重复请求。
  const [bodyFor, setBodyFor] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, { loading: boolean; text?: string; error?: string }>>({});
  // userConfig 编辑草稿（只存在渲染层；敏感值写入后不回读，输入框保持空=不变）。
  const [ucDraft, setUcDraft] = useState<Record<string, string>>({});
  const [ucBusy, setUcBusy] = useState(false);
  useEffect(() => { setUcDraft({}); }, [sel]);
  const toggleBody = (invoke: string): void => {
    if (bodyFor === invoke) { setBodyFor(null); return; }
    setBodyFor(invoke);
    if (bodies[invoke] !== undefined) return;
    setBodies((prev) => ({ ...prev, [invoke]: { loading: true } }));
    void window.agent.skillBody(invoke).then((r) => {
      setBodies((prev) => ({ ...prev, [invoke]: r.ok ? { loading: false, text: r.body ?? "" } : { loading: false, error: r.error ?? "读取失败" } }));
    }).catch((err: unknown) => {
      setBodies((prev) => ({ ...prev, [invoke]: { loading: false, error: err instanceof Error ? err.message : String(err) } }));
    });
  };
  const plugins = props.snap;
  const q = query.trim().toLowerCase();
  const rows = plugins.plugins
    .filter((p) => (filter === "all" ? true : filter === "trusted" ? p.trust === "trusted" : p.trust !== "trusted"))
    .filter((p) => (p.name + p.scope).toLowerCase().includes(q));
  const selected = sel === null ? null : plugins.plugins.find((x) => x.name === sel) ?? null;
  useEffect(() => { setBodyFor(null); }, [sel]);
  // 批 6（总纲阶段 3-3）：数据为 0 时只显示 EmptyState，不摆统计卡与筛选。
  if (plugins.plugins.length === 0) {
    return (
      <EmptyState
        icon={<Puzzle size={22} />}
        title="还没有插件"
        desc="把插件文件夹放进工作区的 .agent/plugins/ 目录即可被 Cairn 加载。"
      />
    );
  }
  return (
    <>
      <Stats items={[
        { k: "已加载", v: plugins.plugins.length },
        { k: "已信任", v: plugins.plugins.filter((p) => p.trust === "trusted").length },
        { k: "未信任", v: plugins.plugins.filter((p) => p.trust !== "trusted").length, warn: plugins.plugins.some((p) => p.trust !== "trusted") },
        { k: "MCP 连接", v: `${String(plugins.mcpServers.filter((m) => m.state === "connected").length)}/${String(plugins.mcpServers.length)}` },
      ]} />
      <Toolbar
        query={query} onQuery={setQuery} filter={filter} onFilter={setFilter}
        filters={[{ id: "all", label: "全部" }, { id: "trusted", label: "已信任" }, { id: "untrusted", label: "未信任" }]}
      />
      <div className={"ap-split" + (selected !== null ? " has-drawer" : "")}>
        <div className="ap-list">
          {rows.length === 0 && <div className="ap-empty">没有匹配的插件</div>}
          {rows.map((p) => (
            <div key={p.name} className={"ap-item" + (sel === p.name ? " on" : "")} onClick={() => setSel(p.name)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (activates(e)) { e.preventDefault(); setSel(p.name); } }}>
              <span className="nm">{p.name}</span>
              <span className={"sp-tag" + (p.trust === "trusted" ? " ok" : "")}>{p.trust === "trusted" ? "已信任" : "未信任"}</span>
              <span className="sub">{p.scope} · 技能 {String(p.counts.skills)} · MCP {String(p.counts.mcp)}</span>
            </div>
          ))}
        </div>
        {selected !== null && (
          <Drawer title={selected.name} sub={`${selected.scope} · 信任态：${selected.trust}`} onClose={() => setSel(null)}>
            <section className="ap-sec">
              <h3>组成</h3>
              <div className="ap-kv">
                <span>技能 {String(selected.counts.skills)} · 命令 {String(selected.counts.commands)} · agents {String(selected.counts.agents)} · hooks {String(selected.counts.hooks)} · MCP {String(selected.counts.mcp)} · LSP {String(selected.counts.lspActive)}/{String(selected.counts.lsp)}</span>
              </div>
            </section>
            <section className="ap-sec">
              <h3>技能（{String(selected.skills?.length ?? 0)}）</h3>
              {(selected.skills ?? []).length === 0
                ? <div className="ap-empty">该插件没有技能条目</div>
                : (selected.skills ?? []).map((sk) => (
                  <div key={sk.invoke} className="plugin-skill">
                    <div className="ap-li">
                      <span className="kind mono-k">{sk.invoke}</span><span className="p">{sk.description}</span>
                      <button className="mini-btn" aria-expanded={bodyFor === sk.invoke} onClick={() => toggleBody(sk.invoke)}>
                        {bodyFor === sk.invoke ? "收起正文" : "读正文"}
                      </button>
                    </div>
                    {bodyFor === sk.invoke && (
                      bodies[sk.invoke]?.loading === true ? <div className="ap-empty">读取中…</div>
                      : bodies[sk.invoke]?.error !== undefined ? <div className="ap-empty">读取失败：{bodies[sk.invoke]?.error}</div>
                      : <pre className="skill-body">{bodies[sk.invoke]?.text}</pre>
                    )}
                  </div>
                ))}
            </section>
            <section className="ap-sec">
              <h3>命令（{String(selected.commands?.length ?? 0)}）</h3>
              {(selected.commands ?? []).length === 0
                ? <div className="ap-empty">该插件没有命令条目</div>
                : (selected.commands ?? []).map((c) => (
                  <div key={c.invoke} className="ap-li"><span className="kind mono-k">{c.invoke}</span><span className="p">{c.description}</span>{props.onInvoke !== undefined && <button className="mini-btn" onClick={() => { props.onInvoke?.(c.invoke); }}>{STR.pluginSurface.fill}</button>}</div>
                ))}
            </section>
            <section className="ap-sec">
              <h3>配置（{String(selected.userConfig?.length ?? 0)}）</h3>
              {(selected.userConfig ?? []).length === 0
                ? <div className="ap-empty">该插件没有声明 userConfig</div>
                : (selected.userConfig ?? []).map((f) => {
                  const key = selected.name + "::" + f.key;
                  return (
                    <div className="ap-form-row" key={f.key}>
                      <label className="ap-k" htmlFor={"uc-" + key}>{f.title ?? f.key}{f.required ? " *" : ""}</label>
                      <div className="ap-form-ctl">
                        <input
                          id={"uc-" + key}
                          type={f.sensitive ? "password" : "text"}
                          autoComplete="off"
                          value={ucDraft[key] ?? ""}
                          placeholder={f.hasValue ? "已设置（留空保持不变）" : f.missing ? "未设置（必填）" : "未设置"}
                          onChange={(e) => setUcDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                        />
                        {f.sensitive && <span className="sub">值经 safeStorage 加密，界面不回显</span>}
                        {f.description !== undefined && <span className="sub">{f.description}</span>}
                      </div>
                    </div>
                  );
                })}
              {(selected.userConfig ?? []).length > 0 && (
                <button
                  className="mini-btn primary"
                  disabled={ucBusy}
                  onClick={() => {
                    const values: Record<string, string> = {};
                    for (const [k, v] of Object.entries(ucDraft)) {
                      if (!k.startsWith(selected.name + "::")) continue;
                      if (v === "") continue; // 留空 = 保持不变（含敏感值无法回显）
                      values[k.slice(selected.name.length + 2)] = v;
                    }
                    if (Object.keys(values).length === 0) { props.onError("没有要保存的配置项（留空 = 保持不变）"); return; }
                    setUcBusy(true);
                    void window.agent.pluginUserConfigSet(selected.name, values).then((r) => {
                      if (!r.ok) props.onError(r.error ?? "配置保存失败");
                      else { setUcDraft({}); props.refresh(); }
                    }).catch((err: unknown) => props.onError(`配置保存失败：${err instanceof Error ? err.message : String(err)}`))
                      .finally(() => setUcBusy(false));
                  }}
                >保存配置</button>
              )}
            </section>
            <section className="ap-sec">
              <h3>信任</h3>
              <div className="ap-kv">未信任不激活（技能与 MCP 均不挂载）；决议走 pluginDecide。</div>
              <Switch
                label="信任该插件"
                checked={selected.trust === "trusted"}
                busy={trustBusy === selected.name}
                onText="已信任"
                offText="未信任"
                onChange={(next) => {
                  setTrustBusy(selected.name);
                  void window.agent.pluginDecide(selected.name, next).then((r) => {
                    if (!r.ok) props.onError(r.error ?? "信任决议失败");
                    else props.refresh();
                  }).catch((err: unknown) => props.onError(`信任决议失败：${err instanceof Error ? err.message : String(err)}`))
                    .finally(() => setTrustBusy(null));
                }}
              />
            </section>
            {(selected.errors.length > 0 || selected.warnings.length > 0) && (
              <section className="ap-sec">
                <h3>错误与警告</h3>
                {selected.errors.map((e, i) => <div key={`e${String(i)}`} className="ap-li"><span className="kind err">错误</span><span className="p">{e}</span></div>)}
                {selected.warnings.map((w, i) => <div key={`w${String(i)}`} className="ap-li"><span className="kind">警告</span><span className="p">{w}</span></div>)}
              </section>
            )}
            <section className="ap-sec">
              <h3>该插件 MCP</h3>
              {plugins.mcpServers.filter((m) => m.plugin === selected.name).length === 0 && <div className="ap-empty">无 MCP 服务</div>}
              {plugins.mcpServers.filter((m) => m.plugin === selected.name).map((m) => (
                <div key={m.server} className="ap-li">
                  <span className={"kind" + (m.state === "connected" ? " ok" : "")}>{m.state}</span>
                  <span className="p">{m.server} · {String(m.tools.length)} 工具{m.error !== undefined ? ` · ${m.error}` : ""}</span>
                </div>
              ))}
            </section>
          </Drawer>
        )}
      </div>
    </>
  );
}

// ── 自动化任务页 ──────────────────────────────────────────────────

export function AutomationPane(props: { snap: ScheduleSnapshot; onError: (m: string) => void; refresh: () => void }): React.JSX.Element {
  const schedule = props.snap;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
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

  const q = query.trim().toLowerCase();
  const rows = schedule.tasks
    .filter((t) => (filter === "all" ? true : filter === "on" ? t.enabled : !t.enabled))
    .filter((t) => (t.name + t.prompt).toLowerCase().includes(q));
  const list = useMemo(() => (sortByName ? [...rows].sort((a, b) => a.name.localeCompare(b.name, "zh")) : rows), [rows, sortByName]);
  const selected = sel === null ? null : schedule.tasks.find((x) => x.id === sel) ?? null;

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

  // 表单抽成变量：空态里的「新建任务」主按钮直接开它（批 6 总纲阶段 3-3）。
  const createForm = creating ? (
    <div className="ap-form">
      <div className="ap-form-row">
        <label className="ap-k" htmlFor="at-name">名称</label>
        <input id="at-name" value={fName} placeholder="如：每日巡检" onChange={(e) => setFName(e.target.value)} />
      </div>
      <div className="ap-form-row">
        <span className="ap-k">排程</span>
        <div className="ap-form-ctl">
          <select value={fKind} onChange={(e) => setFKind(e.target.value as typeof fKind)}>
            <option value="daily">每天</option>
            <option value="interval">每 N 分钟</option>
            <option value="weekly">每周</option>
            <option value="once">一次性</option>
          </select>
          {fKind === "daily" && <input aria-label="时间 HH:MM" value={fTime} placeholder="09:00" onChange={(e) => setFTime(e.target.value)} />}
          {fKind === "weekly" && (
            <>
              <span className="ap-weekdays">
                {["日", "一", "二", "三", "四", "五", "六"].map((d, i) => (
                  <button
                    key={d}
                    className={"chip" + (fWeekdays.includes(i) ? " on" : "")}
                    onClick={() => setFWeekdays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))}
                  >{d}</button>
                ))}
              </span>
              <input aria-label="时间 HH:MM" value={fTime} placeholder="09:00" onChange={(e) => setFTime(e.target.value)} />
            </>
          )}
          {fKind === "interval" && <input aria-label="每 N 分钟" value={fEvery} placeholder="60" onChange={(e) => setFEvery(e.target.value)} />}
          {fKind === "once" && <input aria-label="ISO 时间" value={fAt} placeholder="2026-11-01T09:00:00" onChange={(e) => setFAt(e.target.value)} />}
        </div>
      </div>
      <div className="ap-form-row">
        <label className="ap-k" htmlFor="at-tier">权限档</label>
        <select id="at-tier" value={fTier} onChange={(e) => setFTier(e.target.value as typeof fTier)}>
          <option value="read-only">read-only（只读）</option>
          <option value="workspace-write">workspace-write（工作区写）</option>
          <option value="danger-full-access">danger-full-access（全权 · 慎用）</option>
        </select>
      </div>
      <div className="ap-form-row">
        <label className="ap-k" htmlFor="at-prompt">提示词</label>
        <textarea id="at-prompt" rows={3} value={fPrompt} placeholder="触发时成为新会话首条消息" onChange={(e) => setFPrompt(e.target.value)} />
      </div>
      <div className="ap-form-row">
        <span className="ap-k" />
        <div className="ap-form-ctl">
          <button className="mini-btn primary" disabled={busy || fName.trim() === "" || fPrompt.trim() === ""} onClick={submitCreate}>
            {busy ? (editing === null ? "创建中…" : "保存中…") : (editing === null ? "创建" : "保存")}
          </button>
          {editing !== null && <span className="sp-dim">正在编辑「{editing.name}」；启用状态/时区/模型保持不变。</span>}
          <span className="sp-dim">触发时自动发起新对话；无人值守场景下，需要审批的操作一律拒绝。</span>
        </div>
      </div>
    </div>
  ) : null;

  // 任务为 0 但历史非空 ⇒ 不能只显示 EmptyState：运行历史仍在快照里，
  // 旧分支会让「删光任务」后的运行历史/统计整块不可见（空态隐藏真实数据）。
  if (schedule.tasks.length === 0 && schedule.history.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Clock size={22} />}
          title="还没有定时任务"
          desc="到点会自动发起新的对话。"
          action={<button className="mini-btn primary" onClick={() => setCreating(true)}>新建任务</button>}
        />
        {createForm}
        <Notice text={notice} />
      </>
    );
  }

  return (
    <>
      <Stats items={[
        { k: "任务", v: schedule.tasks.length },
        { k: "启用中", v: schedule.tasks.filter((t) => t.enabled).length },
        { k: "运行中", v: schedule.running },
        { k: "队列", v: schedule.queued },
      ]} />
      <Toolbar
        query={query} onQuery={setQuery} filter={filter} onFilter={setFilter}
        filters={[{ id: "all", label: "全部" }, { id: "on", label: "启用" }, { id: "off", label: "停用" }]}
        sortLabel={sortByName ? "按名称" : "默认序"} onSort={() => setSortByName((v) => !v)}
      />
      <div className="ap-actions-row">
        <button className="mini-btn primary" onClick={() => setCreating((v) => { if (v) setEditing(null); return !v; })} aria-expanded={creating}>
          {creating ? "收起表单" : "＋ 新建任务"}
        </button>
        <Notice text={notice} />
      </div>
      {createForm}
      <div className={"ap-split" + (selected !== null ? " has-drawer" : "")}>
        <div>
          <div className="ap-list">
            {list.length === 0 && <div className="ap-empty">没有匹配的任务</div>}
            {list.map((t) => (
              <div key={t.id} className={"ap-item" + (sel === t.id ? " on" : "")} onClick={() => setSel(t.id)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (activates(e)) { e.preventDefault(); setSel(t.id); } }}>
                <span className="nm">{t.name}</span>
                <span className={"sp-tag" + (t.enabled ? " ok" : "")}>{t.enabled ? "启用" : "停用"}</span>
                <span className="sub mono-k">{scheduleLabel(t.schedule)}</span>
                {t.nextRunAt !== undefined && <span className="r sub">下次 {new Date(t.nextRunAt).toLocaleString()}</span>}
              </div>
            ))}
          </div>
          <div className="ap-gtitle">运行历史（{String(schedule.history.length)} 条）</div>
          <div className="ap-list">
            {schedule.history.length === 0 && <div className="ap-empty">暂无运行记录</div>}
            {schedule.history.slice(0, 20).map((h: HistoryEntry, i: number) => (
              <div key={i} className="ap-li">
                <span className="kind">{h.state}</span>
                <span className="p">{h.due_at} · {h.task_name}{h.session_id !== undefined ? ` · ${h.session_id}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
        {selected !== null && (
          <Drawer title={selected.name} sub={`${scheduleLabel(selected.schedule)} · 时区 ${selected.timeZone}`} onClose={() => setSel(null)}>
            <section className="ap-sec">
              <h3>提示词</h3>
              <div className="ap-prompt">{selected.prompt}</div>
            </section>
            <section className="ap-sec">
              <h3>操作</h3>
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
              <h3>说明</h3>
              <div className="ap-kv">权限档 {selected.permissionTier} · 错过时段自动补跑：{selected.catchUp ? "开" : "关"} · 触发时自动发起新对话，需要审批的操作一律拒绝。</div>
            </section>
          </Drawer>
        )}
      </div>
      <div className="ap-note">任务在后台按时触发；错过的时段会在应用启动后自动补跑（{schedule.startupDone ? "已补跑" : "待补跑"}）；同时最多运行 {String(schedule.cap)} 个任务。</div>
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
    </>
  );
}

// ── 技能中心页 ────────────────────────────────────────────────────

export function SkillsPane(props: { snap: PluginPanelSnapshot; onError: (m: string) => void; refresh: () => void }): React.JSX.Element {
  const plugins = props.snap;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sel, setSel] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const rows = plugins.looseSkills
    .filter((s) => (filter === "all" ? true : filter === "trusted" ? s.trust === "trusted" : s.trust !== "trusted"))
    .filter((s) => (s.invoke + s.description).toLowerCase().includes(q));
  const selected = sel === null ? null : plugins.looseSkills.find((x) => x.invoke === sel) ?? null;
  const selectedName = selected?.name ?? null;
  const scope = selected === null ? undefined : plugins.toolScopes.find((x) => x.invoke === selected.invoke);
  // 指令正文（2026-10-18 §8 #15）：快照只带元信息，正文按需走 agent:skill-body。
  // 信任之前能读到它做什么，是「批准」这个动作的前提。
  const [body, setBody] = useState<null | { loading: boolean; text?: string; truncated?: boolean; path?: string; error?: string }>(null);
  useEffect(() => {
    if (selectedName === null) { setBody(null); return; }
    let alive = true;
    setBody({ loading: true });
    void window.agent.skillBody(selectedName).then((r) => {
      if (!alive) return;
      setBody(r.ok
        ? { loading: false, text: r.body ?? "", truncated: r.truncated === true, path: r.path }
        : { loading: false, error: r.error ?? "读取失败" });
    }).catch((err: unknown) => {
      if (alive) setBody({ loading: false, error: err instanceof Error ? err.message : String(err) });
    });
    return () => { alive = false; };
  }, [selectedName]);
  // 批 6（总纲阶段 3-3）：数据为 0 时只显示 EmptyState，不摆统计卡与筛选。
  if (plugins.looseSkills.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={22} />}
        title="还没有技能"
        desc="在输入框输入技能名即可调用。"
      />
    );
  }
  return (
    <>
      <Stats items={[
        { k: "可用技能", v: plugins.looseSkills.length },
        { k: "已信任", v: plugins.looseSkills.filter((s) => s.trust === "trusted").length },
        { k: "未信任", v: plugins.looseSkills.filter((s) => s.trust !== "trusted").length, warn: plugins.looseSkills.some((s) => s.trust !== "trusted") },
        { k: "MCP", v: plugins.mcpServers.length },
      ]} />
      <Toolbar
        query={query} onQuery={setQuery} filter={filter} onFilter={setFilter}
        filters={[{ id: "all", label: "全部" }, { id: "trusted", label: "已信任" }, { id: "untrusted", label: "未信任" }]}
      />
      <div className={"ap-split" + (selected !== null ? " has-drawer" : "")}>
        <div className="ap-list">
          {rows.length === 0 && <div className="ap-empty">没有匹配的技能</div>}
          {rows.map((s) => (
            <div key={s.invoke} className={"ap-item" + (sel === s.invoke ? " on" : "")} onClick={() => setSel(s.invoke)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (activates(e)) { e.preventDefault(); setSel(s.invoke); } }}>
              <span className="nm mono-k">{s.invoke}</span>
              <span className={"sp-tag" + (s.trust === "trusted" ? " ok" : "")}>{s.trust === "trusted" ? "已信任" : "未信任"}</span>
              <span className="sub">{s.description}</span>
            </div>
          ))}
        </div>
        {selected !== null && (
          <Drawer title={selected.invoke} sub={selected.description} onClose={() => setSel(null)}>
            <section className="ap-sec">
              <h3>来源</h3>
              <div className="ap-kv">独立技能（loose）· 信任态 {selected.trust}</div>
              <Switch
                label="信任该技能"
                checked={selected.trust === "trusted"}
                onText="已信任"
                offText="未信任"
                onChange={(next) => {
                  void window.agent.pluginDecide(selected.name, next).then((r) => {
                    if (!r.ok) props.onError(r.error ?? "信任决议失败"); else props.refresh();
                  }).catch((err: unknown) => props.onError(`信任决议失败：${err instanceof Error ? err.message : String(err)}`));
                }}
              />
            </section>
            <section className="ap-sec">
              <h3>权限联动（toolScopes）</h3>
              {scope === undefined && <div className="ap-empty">本 turn 无申报记录</div>}
              {scope !== undefined && (
                <div className="ap-li"><span className="kind">scope</span><span className="p">allow: {scope.allow.length > 0 ? scope.allow.join("、") : "—"} · deny: {scope.deny.length > 0 ? scope.deny.join("、") : "—"}</span></div>
              )}
            </section>
            <section className="ap-sec">
              <h3>指令正文</h3>
              {body === null || body.loading ? (
                <div className="ap-empty">读取中…</div>
              ) : body.error !== undefined ? (
                <div className="ap-empty">读取失败：{body.error}</div>
              ) : (
                <>
                  <pre className="skill-body">{body.text}</pre>
                  {body.truncated === true && <div className="sp-dim">正文过长，仅显示前 20000 字符。</div>}
                  {body.path !== undefined && <div className="sp-dim mono-k">{body.path}</div>}
                </>
              )}
            </section>
          </Drawer>
        )}
      </div>
      <div className="ap-note">在输入框输入技能名即可调用。</div>
    </>
  );
}

// ── 记忆系统页 ────────────────────────────────────────────────────

export function MemoryPane(props: { snap: MemorySnapshot; onError: (m: string) => void; refresh: () => void }): React.JSX.Element {
  const memory = props.snap;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortByName, setSortByName] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const now = useNow();
  // 删除主题确认（2026-10-17：原生 confirm → 产品自绘卡）
  const [topicAsk, setTopicAsk] = useState<{ layer: "project" | "global"; topic: string } | null>(null);
  const q = query.trim().toLowerCase();
  type Row = { layer: "project" | "global"; topic: MemorySnapshot["project"]["topics"][number] };
  const rows: Row[] = [
    ...memory.project.topics.map((t) => ({ layer: "project" as const, topic: t })),
    ...memory.global.topics.map((t) => ({ layer: "global" as const, topic: t })),
  ].filter((r) => (filter === "all" ? true : filter === r.layer))
    .filter((r) => (r.topic.topic + r.topic.type).toLowerCase().includes(q));
  const sorted = sortByName ? [...rows].sort((a, b) => a.topic.topic.localeCompare(b.topic.topic, "zh")) : rows;
  const [selLayer, selTopic] = sel === null ? [null, null] : (sel.split(":") as [string, string]);
  const selected = selLayer === null ? null : (selLayer === "project" ? memory.project : memory.global).topics.find((t) => t.topic === selTopic) ?? null;
  const selectedLayer = selLayer === "project" ? memory.project : memory.global;
  // 批 6（总纲阶段 3-3）：数据为 0 时只显示 EmptyState，不摆统计卡与筛选。
  if (memory.project.topics.length + memory.global.topics.length === 0) {
    return (
      <EmptyState
        icon={<Brain size={22} />}
        title="还没有记忆"
        desc="Cairn 会在对话中记下项目约定和你的偏好。"
      />
    );
  }
  return (
    <>
      <Stats items={[
        { k: "项目层", v: memory.project.topics.length },
        { k: "全局层", v: memory.global.topics.length },
        {
          k: "待批外部引用",
          v: memory.project.pendingExternalRefs.length + memory.global.pendingExternalRefs.length,
          warn: memory.project.pendingExternalRefs.length + memory.global.pendingExternalRefs.length > 0,
        },
      ]} />
      <Toolbar
        query={query} onQuery={setQuery} filter={filter} onFilter={setFilter}
        filters={[{ id: "all", label: "全部" }, { id: "project", label: "项目层" }, { id: "global", label: "全局层" }]}
        sortLabel={sortByName ? "按名称" : "最近更新"} onSort={() => setSortByName((v) => !v)}
      />
      <div className="ap-actions-row"><Notice text={notice} /></div>
      <div className={"ap-split" + (selected !== null ? " has-drawer" : "")}>
        <div className="ap-list">
          {sorted.length === 0 && <div className="ap-empty">没有匹配的主题</div>}
          {sorted.map((r) => (
            <div
              key={`${r.layer}:${r.topic.topic}`}
              className={"ap-item" + (sel === `${r.layer}:${r.topic.topic}` ? " on" : "")}
              onClick={() => setSel(`${r.layer}:${r.topic.topic}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (activates(e)) { e.preventDefault(); setSel(`${r.layer}:${r.topic.topic}`); } }}
            >
              {/* H（2026-10-16）：名称单行省略、类型标签钉右；F：元信息走相对时间（悬停给完整时间）。 */}
              <span className="nm">{r.topic.topic}</span>
              <span className="sub" title={fullTime(r.topic.modified)}>{r.topic.type} · {String(r.topic.bytes)}B · {relativeTime(r.topic.modified, now)}</span>
              <span className="sp-tag">{r.layer === "project" ? "项目层" : "全局层"}</span>
            </div>
          ))}
        </div>
        {selected !== null && (
          <Drawer
            title={selected.topic}
            sub={`${selLayer === "project" ? "项目层" : "全局层"} · ${selected.type} · ${String(selected.bytes)}B · ${relativeTime(selected.modified, now)}`}
            subTitle={fullTime(selected.modified)}
            onClose={() => setSel(null)}
          >
            {/* D（2026-10-16 记忆页重做）：顺序 = 标题+元信息 → 主题正文 → 索引 → 待批外部引用 → 删除（底置）。
                主题正文 v13 接通：正文随快照来（frontmatter 已剥）；空正文给一句话回落，不摆空壳。 */}
            <section className="ap-sec">
              <h3>主题正文</h3>
              {bodyLines(selected.body).length === 0 && <div className="ap-empty">此主题暂无正文</div>}
              <div className="ap-drawer-body">
                {bodyLines(selected.body).map((line, i) => (
                  <div key={String(i)} className="ap-body-line">{renderInline(line)}</div>
                ))}
              </div>
            </section>
            <section className="ap-sec">
              <h3>索引（MEMORY.md）</h3>
              {selectedLayer.index === null
                ? <div className="ap-empty">尚无索引</div>
                : (
                  // E：逐行渲染（行首「- 」已剥；**加粗**/`代码` 交 renderInline，原样上屏问题修在这里）。
                  <div className="ap-index">
                    {indexLines(selectedLayer.index).map((line, i) => (
                      <div key={String(i)} className="ap-index-line">{renderInline(line)}</div>
                    ))}
                  </div>
                )}
            </section>
            <section className="ap-sec">
              <h3>待批外部引用</h3>
              {selectedLayer.pendingExternalRefs.length === 0 && (
                <div className="ap-li"><span className="p">本层无（统计数含两层，见下）</span></div>
              )}
              {selectedLayer.pendingExternalRefs.map((p) => <div key={p} className="ap-li"><span className="kind">引用</span><span className="p">{p}</span></div>)}
              {(selLayer === "project" ? memory.global : memory.project).pendingExternalRefs.map((p) => (
                <div key={"other:" + p} className="ap-li"><span className="kind">另层</span><span className="p">{p}</span></div>
              ))}
            </section>
            {/* D：危险操作收进面板底部——描边红小按钮 + 二次确认（window.confirm，既有语义不变）。 */}
            <div className="ap-drawer-foot">
              <section className="ap-sec">
                <h3>删除</h3>
                <div className="ap-kv">仅用户可删（模型无删除权，§8.1.7）；删除后立即生效。</div>
                <button
                  className="mini-btn danger-text"
                  onClick={() => { setTopicAsk({ layer: selLayer as "project" | "global", topic: selected.topic }); }}
                >删除主题</button>
              </section>
            </div>
          </Drawer>
        )}
      </div>
      {topicAsk !== null && (
        <ConfirmDialog
          title={`删除记忆主题「${topicAsk.topic}」？`}
          note="删除后立即生效；该主题下的记忆条目一并移除。"
          confirmLabel="删除"
          danger
          onClose={() => setTopicAsk(null)}
          onConfirm={() => {
            const ask = topicAsk;
            setTopicAsk(null);
            void window.agent.deleteMemory(ask.layer, ask.topic).then((r) => {
              if (!r.ok) props.onError(r.error ?? "删除失败");
              else { setSel(null); setNotice("主题已删除"); props.refresh(); }
            }).catch((err: unknown) => props.onError(`删除失败：${err instanceof Error ? err.message : String(err)}`));
          }}
        />
      )}
    </>
  );
}

// ── 页体（并入设置页后的形态）──────────────────────────────────────
// v7.1 业主裁：四个入口不再自带整页宿主与页内导航——只导出「页体」，由设置页按分区渲染；
// 数据面不变（getState() 真快照），标题与图标事实源仍是 PAGE_META。

type Snapshot = { plugins?: PluginPanelSnapshot; schedule?: ScheduleSnapshot; memory?: MemorySnapshot; worktree?: { workspace: string; orphans: string[] } };

/** 页体：按 page 自取一份 getState() 快照并渲染对应面板（宿主只管分区切换，不管数据）。 */
export function AppPageBody(props: {
  page: PageId;
  onError: (message: string) => void;
}): React.JSX.Element {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const refresh = useCallback(() => {
    void window.agent.getState().then(setSnap).catch((err: unknown) => {
      props.onError(`快照读取失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [props.onError]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="ap-body" aria-label={PAGE_META[props.page].label}>
      {snap === null && <div className="ap-empty">正在读取快照…</div>}
      {snap !== null && props.page === "plugins" && (
        snap.plugins === undefined
          ? <div className="ap-empty">插件运行时未加载（无插件环境）</div>
          : <PluginsPane snap={snap.plugins} onError={props.onError} refresh={refresh} />
      )}
      {snap !== null && props.page === "automation" && (
        snap.schedule === undefined
          ? <div className="ap-empty">调度器未初始化</div>
          : <AutomationPane snap={snap.schedule} onError={props.onError} refresh={refresh} />
      )}
      {snap !== null && props.page === "skills" && (
        snap.plugins === undefined
          ? <div className="ap-empty">插件运行时未加载</div>
          : <SkillsPane snap={snap.plugins} onError={props.onError} refresh={refresh} />
      )}
      {snap !== null && props.page === "memory" && (
        snap.memory === undefined
          ? <div className="ap-empty">记忆层未初始化</div>
          : <MemoryPane snap={snap.memory} onError={props.onError} refresh={refresh} />
      )}
      {snap !== null && props.page === "worktrees" && (
        snap.worktree === undefined
          ? <div className="ap-empty">工作区未解析（无可用工作区）</div>
          : <WorktreesPane snap={snap.worktree} onError={props.onError} refresh={refresh} />
      )}
    </div>
  );
}
