// C-39…C-42 应用页（v2.6）：插件 / 自动化任务 / 技能中心 / 记忆系统——整页覆盖，与设置同宿主。
// 组织件全按原型：pgStats（概览统计，仅真实字段）+ pgToolbar（搜索/筛选 chips/排序）+ pg-split
// （列表 + 340px sticky 详情抽屉）。全部字段走 getState() 真快照；无后端的能力显式标「待接」。
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MemorySnapshot,
} from "../../../../../src/main/ipc-protocol";
import type { AutomationDefinition } from "../../../../../src/main/automations";
import type { ScheduleSnapshot, HistoryEntry } from "../../../../../src/main/scheduler";
import type { PluginPanelSnapshot } from "../../../../../src/agent/plugins";
import { Switch } from "./Switch";

type Snapshot = {
  plugins?: PluginPanelSnapshot;
  schedule?: ScheduleSnapshot;
  memory?: MemorySnapshot;
};

type PageId = "plugins" | "automation" | "skills" | "memory";

/** AutomationSchedule 判别联合 → 一行人话（七 kind 全覆盖；不编造 cron 字段）。 */
function scheduleLabel(s: { kind: string } & Record<string, unknown>): string {
  switch (s.kind) {
    case "once": return `一次性 · ${String(s.at)}`;
    case "interval": return `每 ${String(s.everyMinutes)} 分钟`;
    case "hourly": return `每小时 :${String(s.minute).padStart(2, "0")}`;
    case "daily": return `每天 ${String(s.time)}`;
    case "weekly": return `每周 ${(s.weekdays as number[]).map((d) => ["日", "一", "二", "三", "四", "五", "六"][d] ?? String(d)).join("/")} ${String(s.time)}`;
    case "monthly": return `每月 ${String(s.monthDay)} 号 ${String(s.time)}`;
    case "custom": return `每 ${String(s.everyDays)} 天 ${String(s.time)}`;
    default: return String(s.kind);
  }
}

function Stats(props: { items: Array<{ k: string; v: string | number; warn?: boolean }> }) {  return (
    <div className="pg-stats">
      {props.items.map((s) => (
        <div key={s.k} className={"pg-stat" + (s.warn === true ? " warn" : "")}>
          <div className="k">{s.k}</div>
          <div className="v num">{typeof s.v === "number" ? String(s.v) : s.v}</div>
        </div>
      ))}
    </div>
  );
}

function Toolbar(props: {
  query: string; onQuery: (q: string) => void;
  filters: readonly { id: string; label: string }[]; filter: string; onFilter: (f: string) => void;
  sortLabel?: string; onSort?: () => void;
}) {
  return (
    <div className="pg-toolbar">
      <div className="pg-search">
        <input value={props.query} placeholder="搜索…" onChange={(e) => props.onQuery(e.target.value)} />
      </div>
      <div className="pg-fchips">
        {props.filters.map((f) => (
          <button key={f.id} className={"fch" + (props.filter === f.id ? " on" : "")} onClick={() => props.onFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {props.onSort !== undefined && (
        <div className="fch sort"><button className="fch" onClick={props.onSort}>{props.sortLabel}</button></div>
      )}
    </div>
  );
}

function Drawer(props: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="pg-drawer">
      <div className="pd-head">
        <span className="nm">{props.title}</span>
        <button className="mini-btn" onClick={props.onClose}>关闭</button>
      </div>
      {props.sub !== undefined && <div className="pd-sub">{props.sub}</div>}
      {props.children}
    </aside>
  );
}

export function AppPage(props: {
  page: PageId;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortByName, setSortByName] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  // ④：信任决议进行中（开关要显示保存中并禁用，而不是点了没反应）
  const [trustBusy, setTrustBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.agent.getState().then(setSnap).catch((err: unknown) => {
      props.onError(`快照读取失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [props.onError]);
  useEffect(() => { refresh(); }, [refresh]);

  const plugins = snap?.plugins;
  const schedule = snap?.schedule;
  const memory = snap?.memory;

  // 每页分支内的过滤（不用联合 useMemo：四页数据形状不同，泛型收窄反而伤类型面）。
  const q = query.trim().toLowerCase();
  const pluginRows = props.page === "plugins" && plugins !== undefined
    ? plugins.plugins
        .filter((p) => (filter === "all" ? true : filter === "trusted" ? p.trust === "trusted" : p.trust !== "trusted"))
        .filter((p) => (p.name + p.scope).toLowerCase().includes(q))
    : [];
  const taskRows: AutomationDefinition[] = props.page === "automation" && schedule !== undefined
    ? schedule.tasks
        .filter((t: AutomationDefinition) => (filter === "all" ? true : filter === "on" ? t.enabled : !t.enabled))
        .filter((t: AutomationDefinition) => (t.name + t.prompt).toLowerCase().includes(q))
    : [];
  const skillRows = props.page === "skills" && plugins !== undefined
    ? plugins.looseSkills
        .filter((s) => (filter === "all" ? true : filter === "trusted" ? s.trust === "trusted" : s.trust !== "trusted"))
        .filter((s) => (s.invoke + s.description).toLowerCase().includes(q))
    : [];

  const TITLE: Record<PageId, string> = { plugins: "插件", automation: "自动化任务", skills: "技能中心", memory: "记忆系统" };

  return (
    <div className="settings-page" role="dialog" aria-label={TITLE[props.page]}>
      <nav className="sp-nav" aria-label="应用页导航">
        <div className="sp-nav-head">{TITLE[props.page]}</div>
        {(["plugins", "automation", "skills", "memory"] as const).map((p) => (
          <button key={p} className="sp-item" disabled={p === props.page} style={p === props.page ? { opacity: 0.55 } : undefined}>
            {TITLE[p]}
          </button>
        ))}
        <div className="sp-nav-foot">
          <button className="mini-btn" onClick={props.onClose}>← 返回</button>
        </div>
      </nav>
      <div className="ap-wrap">
        {/* 插件页 */}
        {props.page === "plugins" && (
          <>
            {plugins === undefined ? <div className="pg-empty">插件运行时未加载（无插件环境）</div> : (
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
                <div className={"pg-split" + (sel !== null ? " has-drawer" : "")}>
                  <div className="sp-group">
                    {pluginRows.length === 0 && <div className="pg-empty">没有匹配的插件</div>}
                    {pluginRows.map((p) => (
                      <div key={p.name} className={"pg-item" + (sel === p.name ? " on" : "")} onClick={() => setSel(p.name)} role="button" tabIndex={0}>
                        <span className="nm">{p.name}</span>
                        <span className={"sp-tag" + (p.trust === "trusted" ? " ok" : "")}>{p.trust === "trusted" ? "已信任" : "未信任"}</span>
                        <span className="sub">{p.scope} · 技能 {String(p.counts.skills)} · MCP {String(p.counts.mcp)}</span>
                      </div>
                    ))}
                  </div>
                  {sel !== null && (() => {
                    const p = plugins.plugins.find((x) => x.name === sel);
                    if (p === undefined) return null;
                    return (
                      <Drawer title={p.name} sub={`${p.scope} · 信任态：${p.trust}`} onClose={() => setSel(null)}>
                        <div className="sp-group">
                          <div className="sp-row"><span className="l"><span className="lt">组成</span></span><span className="ld">技能 {String(p.counts.skills)} · 命令 {String(p.counts.commands)} · agents {String(p.counts.agents)} · hooks {String(p.counts.hooks)} · MCP {String(p.counts.mcp)} · LSP {String(p.counts.lspActive)}/{String(p.counts.lsp)}</span></div>
                          <div className="sp-row">
                            <span className="l"><span className="lt">信任</span><span className="ld">未信任不激活（技能与 MCP 均不挂载）；决议走 pluginDecide</span></span>
                            {/* ④ 2026-10-06：这里原来是**单向**的「信任」按钮 —— 误点信任后界面上没法撤销
                                （通道本身是双向的：pluginDecide(name, trusted) 接受 false）。
                                改成双向开关，并把决议结果立刻反映到界面上。 */}
                            <Switch
                              label="信任该插件"
                              checked={p.trust === "trusted"}
                              busy={trustBusy === p.name}
                              onText="已信任"
                              offText="未信任"
                              onChange={(next) => {
                                setTrustBusy(p.name);
                                void window.agent
                                  .pluginDecide(p.name, next)
                                  .then((r) => {
                                    if (!r.ok) props.onError(r.error ?? "信任决议失败");
                                    else refresh();
                                  })
                                  .catch((err: unknown) =>
                                    props.onError(`信任决议失败：${err instanceof Error ? err.message : String(err)}`),
                                  )
                                  .finally(() => setTrustBusy(null));
                              }}
                            />
                          </div>
                        </div>
                        {(p.errors.length > 0 || p.warnings.length > 0) && (
                          <div className="sp-group">
                            <div className="sp-gtitle">错误与警告</div>
                            {p.errors.map((e, i) => <div key={`e${String(i)}`} className="sp-li"><span className="kind">错误</span><span className="p">{e}</span></div>)}
                            {p.warnings.map((w, i) => <div key={`w${String(i)}`} className="sp-li"><span className="kind">警告</span><span className="p">{w}</span></div>)}
                          </div>
                        )}
                        <div className="sp-gtitle">该插件 MCP</div>
                        <div className="sp-group">
                          {plugins.mcpServers.filter((m) => m.plugin === p.name).length === 0 && <div className="pg-empty">无 MCP 服务</div>}
                          {plugins.mcpServers.filter((m) => m.plugin === p.name).map((m) => (
                            <div key={m.server} className="sp-li">
                              <span className={"kind" + (m.state === "connected" ? " ok" : "")}>{m.state}</span>
                              <span className="p">{m.server} · {String(m.tools.length)} 工具{m.error !== undefined ? ` · ${m.error}` : ""}</span>
                            </div>
                          ))}
                        </div>
                      </Drawer>
                    );
                  })()}
                </div>
              </>
            )}
          </>
        )}
        {/* 自动化页 */}
        {props.page === "automation" && (
          <>
            {schedule === undefined ? <div className="pg-empty">调度器未初始化</div> : (
              <>
                <Stats items={[
                  { k: "任务", v: schedule.tasks.length },
                  { k: "启用中", v: schedule.tasks.filter((t: AutomationDefinition) => t.enabled).length },
                  { k: "运行中", v: schedule.running },
                  { k: "队列", v: schedule.queued },
                ]} />
                <Toolbar
                  query={query} onQuery={setQuery} filter={filter} onFilter={setFilter}
                  filters={[{ id: "all", label: "全部" }, { id: "on", label: "启用" }, { id: "off", label: "停用" }]}
                  sortLabel={sortByName ? "按名称" : "默认序"} onSort={() => setSortByName((v) => !v)}
                />
                <div className={"pg-split" + (sel !== null ? " has-drawer" : "")}>
                  <div>
                    <div className="sp-group">
                      {(() => {
                        const list = sortByName ? [...taskRows].sort((a, b) => a.name.localeCompare(b.name, "zh")) : taskRows;
                        if (list.length === 0) return <div className="pg-empty">没有匹配的任务</div>;
                        return list.map((t: AutomationDefinition) => (
                          <div key={t.id} className={"pg-item" + (sel === t.id ? " on" : "")} onClick={() => setSel(t.id)} role="button" tabIndex={0}>
                            <span className="nm">{t.name}</span>
                            <span className={"sp-tag" + (t.enabled ? " ok" : "")}>{t.enabled ? "启用" : "停用"}</span>
                            <span className="sub mono-k">{scheduleLabel(t.schedule)}</span>
                            {t.nextRunAt !== undefined && <span className="r sub">下次 {new Date(t.nextRunAt).toLocaleString()}</span>}
                          </div>
                        ));
                      })()}
                    </div>
                    <div className="sp-gtitle">运行历史（journal 投影 · {String(schedule.history.length)}）</div>
                    <div className="sp-group">
                      {schedule.history.length === 0 && <div className="pg-empty">暂无运行记录</div>}
                      {schedule === undefined ? null : schedule.history.slice(0, 20).map((h: HistoryEntry, i: number) => (
                        <div key={i} className="sp-li">
                          <span className="kind">{h.state}</span>
                          <span className="p">{h.due_at} · {h.task_name}{h.session_id !== undefined ? ` · ${h.session_id}` : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {sel !== null && (() => {
                    const sched = schedule;
                    if (sched === undefined) return null;
                    const t = sched.tasks.find((x: AutomationDefinition) => x.id === sel);
                    if (t === undefined) return null;
                    return (
                      <Drawer title={t.name} sub={`${scheduleLabel(t.schedule)} · 时区 ${t.timeZone}`} onClose={() => setSel(null)}>
                        <div className="sp-group">
                          <div className="sp-row"><span className="l"><span className="lt">提示词</span></span></div>
                          <div className="sp-row"><span className="ld" style={{ whiteSpace: "pre-wrap" }}>{t.prompt}</span></div>
                          <div className="sp-row">
                            <span className="l"><span className="lt">启用</span><span className="ld">scheduleUpsert 写回；停用不触发</span></span>
                            <button
                              className="mini-btn primary"
                              onClick={() => {
                                void window.agent.scheduleUpsert({ ...t, enabled: !t.enabled }, false).then((r) => {
                                  if (!r.ok) props.onError(r.error ?? "更新失败"); else refresh();
                                }).catch((err: unknown) => props.onError(`更新失败：${err instanceof Error ? err.message : String(err)}`));
                              }}
                            >{t.enabled ? "停用" : "启用"}</button>
                          </div>
                          <div className="sp-row">
                            <span className="l"><span className="ld">触发 = 全新会话（unattended）；无人值守审批 fail-closed</span></span>
                            <button
                              className="mini-btn"
                              onClick={() => {
                                void window.agent.scheduleRunNow(t.id).then((r) => {
                                  if (!r.ok) props.onError(r.error ?? "触发失败"); else props.onError("已触发（新会话运行中）");
                                }).catch((err: unknown) => props.onError(`触发失败：${err instanceof Error ? err.message : String(err)}`));
                              }}
                            >立即运行</button>
                          </div>
                        </div>
                      </Drawer>
                    );
                  })()}
                </div>
                <div className="sp-note">桌面端调度器已常驻接线（serveScheduler）；启动补跑 {schedule.startupDone ? "已执行" : "抖动期内"}；并发上限 {String(schedule.cap)}。</div>
              </>
            )}
          </>
        )}
        {/* 技能中心页 */}
        {props.page === "skills" && (
          <>
            {plugins === undefined ? <div className="pg-empty">插件运行时未加载</div> : (
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
                <div className={"pg-split" + (sel !== null ? " has-drawer" : "")}>
                  <div className="sp-group">
                    {skillRows.length === 0 && <div className="pg-empty">没有匹配的技能</div>}
                    {skillRows.map((s) => (
                      <div key={s.invoke} className={"pg-item" + (sel === s.invoke ? " on" : "")} onClick={() => setSel(s.invoke)} role="button" tabIndex={0}>
                        <span className="nm mono-k">{s.invoke}</span>
                        <span className={"sp-tag" + (s.trust === "trusted" ? " ok" : "")}>{s.trust === "trusted" ? "已信任" : "未信任"}</span>
                        <span className="sub">{s.description}</span>
                      </div>
                    ))}
                  </div>
                  {sel !== null && (() => {
                    const s = plugins.looseSkills.find((x) => x.invoke === sel);
                    if (s === undefined) return null;
                    const scope = plugins.toolScopes.find((x) => x.invoke === sel);
                    return (
                      <Drawer title={s.invoke} sub={s.description} onClose={() => setSel(null)}>
                        <div className="sp-group">
                          <div className="sp-row"><span className="l"><span className="lt">来源</span></span><span className="ld">独立技能（loose）· 信任态 {s.trust}</span></div>
                        </div>
                        <div className="sp-gtitle">权限联动（toolScopes）</div>
                        <div className="sp-group">
                          {scope === undefined && <div className="pg-empty">本 turn 无申报记录</div>}
                          {scope !== undefined && (
                            <div className="sp-li"><span className="kind">scope</span><span className="p">allow: {scope.allow.length > 0 ? scope.allow.join("、") : "—"} · deny: {scope.deny.length > 0 ? scope.deny.join("、") : "—"}</span></div>
                          )}
                        </div>
                        <div className="sp-gtitle">指令正文</div>
                        <div className="sp-group"><div className="sp-row"><span className="l"><span className="ld">快照不含正文，需新增通道（§8 #15）</span></span><span className="sp-tag">待接</span></div></div>
                      </Drawer>
                    );
                  })()}
                </div>
                <div className="sp-note">在输入框以调用名触发，正文由 main 侧 expandSkillInvocation 展开。</div>
              </>
            )}
          </>
        )}
        {/* 记忆页 */}
        {props.page === "memory" && (
          <>
            {memory === undefined ? <div className="pg-empty">记忆层未初始化</div> : (
              <>
                <Stats items={[
                  { k: "项目层", v: memory.project.topics.length },
                  { k: "全局层", v: memory.global.topics.length },
                  { k: "待批外部引用", v: memory.project.pendingExternalRefs.length + memory.global.pendingExternalRefs.length, warn: memory.project.pendingExternalRefs.length + memory.global.pendingExternalRefs.length > 0 },
                ]} />
                <Toolbar
                  query={query} onQuery={setQuery} filter={filter} onFilter={setFilter}
                  filters={[{ id: "all", label: "全部" }, { id: "project", label: "项目层" }, { id: "global", label: "全局层" }]}
                  sortLabel={sortByName ? "按名称" : "最近更新"} onSort={() => setSortByName((v) => !v)}
                />
                <div className={"pg-split" + (sel !== null ? " has-drawer" : "")}>
                  <div className="sp-group">
                    {(() => {
                      type Row = { layer: "project" | "global"; topic: typeof memory extends null ? never : NonNullable<Snapshot["memory"]>["project"]["topics"][number] };
                      const rows: Row[] = [
                        ...memory.project.topics.map((t) => ({ layer: "project" as const, topic: t })),
                        ...memory.global.topics.map((t) => ({ layer: "global" as const, topic: t })),
                      ].filter((r) => (filter === "all" ? true : filter === r.layer))
                        .filter((r) => (r.topic.topic + r.topic.type).toLowerCase().includes(query.trim().toLowerCase()));
                      const sorted = sortByName ? [...rows].sort((a, b) => a.topic.topic.localeCompare(b.topic.topic, "zh")) : rows;
                      if (sorted.length === 0) return <div className="pg-empty">没有匹配的主题</div>;
                      return sorted.map((r) => (
                        <div key={`${r.layer}:${r.topic.topic}`} className={"pg-item" + (sel === `${r.layer}:${r.topic.topic}` ? " on" : "")} onClick={() => setSel(`${r.layer}:${r.topic.topic}`)} role="button" tabIndex={0}>
                          <span className="nm">{r.topic.topic}</span>
                          <span className="sp-tag">{r.layer === "project" ? "项目层" : "全局层"}</span>
                          <span className="sub">{r.topic.type} · {String(r.topic.bytes)}B · {r.topic.modified}</span>
                        </div>
                      ));
                    })()}
                  </div>
                  {sel !== null && (() => {
                    const [layer, topic] = sel.split(":");
                    const src = layer === "project" ? memory.project : memory.global;
                    const t = src.topics.find((x) => x.topic === topic);
                    if (t === undefined) return null;
                    return (
                      <Drawer title={t.topic} sub={`${layer === "project" ? "项目层" : "全局层"} · ${t.type} · ${String(t.bytes)}B · ${t.modified}`} onClose={() => setSel(null)}>
                        <div className="sp-group">
                          <div className="sp-row">
                            <span className="l"><span className="lt">删除</span><span className="ld">仅用户可删（模型无删除权，§8.1.7）；删除后立即生效</span></span>
                            <button
                              className="mini-btn danger"
                              onClick={() => {
                                void window.agent.deleteMemory(layer as "project" | "global", t.topic).then((r) => {
                                  if (!r.ok) props.onError(r.error ?? "删除失败"); else { setSel(null); refresh(); }
                                }).catch((err: unknown) => props.onError(`删除失败：${err instanceof Error ? err.message : String(err)}`));
                              }}
                            >删除主题</button>
                          </div>
                        </div>
                        <div className="sp-gtitle">待批外部引用</div>
                        <div className="sp-group">
                          {src.pendingExternalRefs.length === 0 && <div className="pg-empty">无</div>}
                          {src.pendingExternalRefs.map((p) => <div key={p} className="sp-li"><span className="kind">引用</span><span className="p">{p}</span></div>)}
                        </div>
                        <div className="sp-note">索引（MEMORY.md）全文在抽屉下一批接（快照已带 index 字段）。</div>
                      </Drawer>
                    );
                  })()}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export type { PageId };
