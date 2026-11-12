// 插件侧栏/面板视图（供 PluginSurface 按需加载；整页目的地由 PluginsWorkspace 承担）。
import { useEffect, useMemo, useState } from "react";
import { Puzzle } from "lucide-react";
import type { PluginPanelSnapshot } from "../../../../../src/agent/plugins";
import { STR } from "../strings";
import { Switch } from "./Switch";
import { EmptyState } from "./settings-ui";
import { McpServerRow } from "./McpServerRow";
import { PageFrame } from "./PageFrame";
import { categoryLabel } from "./plugins/labels";
import { Drawer, PaneCard } from "./app-page-chrome";

const LEGACY_PLUGIN_FILTERS = [
  { id: "all", label: "全部" },
  { id: "trusted", label: "已信任" },
  { id: "untrusted", label: "未信任" },
] as const;

export function PluginsPane(props: {
  snap: PluginPanelSnapshot;
  onError: (m: string) => void;
  refresh: () => void;
  filter?: string;
  onFilter?: (filter: string) => void;
  onInvoke?: (invoke: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [localFilter, setLocalFilter] = useState("all");
  const [sel, setSel] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
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
  // 第 1145 页：MCP 汇总结论按快照记忆；抽屉/信任开关等局部状态不重建两张表。
  const mcpSummaries = useMemo(() => plugins.mcpServerSummaries ?? [], [plugins.mcpServerSummaries]);
  const { activeMcpByPlugin, mcpSummaryByKey } = useMemo(() => {
    // 第 1120 页：MCP 激活计数/汇总按一次遍历建表，行与详情不再各自 filter/find。
    const activeMcpByPlugin = new Map<string, number>();
    const mcpSummaryByKey = new Map<string, (typeof mcpSummaries)[number]>();
    for (const s of mcpSummaries) {
      if (s.active) activeMcpByPlugin.set(s.plugin, (activeMcpByPlugin.get(s.plugin) ?? 0) + 1);
      mcpSummaryByKey.set(s.key, s);
    }
    return { activeMcpByPlugin, mcpSummaryByKey };
  }, [mcpSummaries]);
  const activeMcpTools = useMemo(() => plugins.activeMcpTools ?? [], [plugins.activeMcpTools]);
  // 旧快照/手写夹具没有这三格时显示「未记录」，不把缺席读成「没有激活」。
  const hasMcpActiveData = plugins.mcpServerSummaries !== undefined
    || plugins.activeMcpServers !== undefined || plugins.activeMcpTools !== undefined;
  const filter = props.filter ?? localFilter;
  const setFilter = props.onFilter ?? setLocalFilter;
  const q = query.trim().toLowerCase();
  // 第 1139 页：插件行、选中项与所选插件的 MCP 行按输入记忆；抽屉/表单等局部状态不重扫。
  const rows = useMemo(() => plugins.plugins
    .filter((p) => (filter === "all" ? true : filter === "trusted" ? p.trust === "trusted" : p.trust !== "trusted"))
    .filter((p) => (p.name + p.scope).toLowerCase().includes(q)), [plugins.plugins, filter, q]);
  const selected = useMemo(() => sel === null ? null : plugins.plugins.find((x) => x.name === sel) ?? null, [plugins.plugins, sel]);
  const selectedMcp = useMemo(() => selected === null ? [] : plugins.mcpServers.filter((m) => m.plugin === selected.name), [plugins.mcpServers, selected]);
  useEffect(() => { setBodyFor(null); }, [sel]);
  // 批 6（总纲阶段 3-3）：数据为 0 时只显示 EmptyState，不摆统计卡与筛选。
  if (plugins.plugins.length === 0) {
    return (
      <PageFrame
        title="插件"
        search={{ label: "搜索插件", value: query, onChange: setQuery }}
        onRefresh={props.refresh}
        filters={LEGACY_PLUGIN_FILTERS}
        activeFilter={filter}
        onFilter={setFilter}
      >
        <EmptyState
          icon={<Puzzle size={22} />}
          title="还没有插件"
          desc="把插件文件夹放进工作区的 .agent/plugins/ 目录即可被 Cairn 加载。"
        />
      </PageFrame>
    );
  }
  // 双列卡片默认铺 6 张，其余收进「查看…另有 N 项」（与技能中心同款，2026-10-24）。
  const shown = showAll ? rows : rows.slice(0, 6);
  const hidden = rows.length - shown.length;
  return (
    <PageFrame
      title="插件"
      search={{ label: "搜索插件", value: query, onChange: setQuery }}
      onRefresh={props.refresh}
      filters={LEGACY_PLUGIN_FILTERS}
      activeFilter={filter}
      onFilter={setFilter}
    >
      <div className={"ap-split" + (selected !== null ? " has-drawer" : "")}>
        <div className="ap-gridcol">
          {rows.length === 0 && <div className="ap-empty">没有匹配的插件</div>}
          <div className="ap-grid">
            {shown.map((p) => {
              const activeForPlugin = activeMcpByPlugin.get(p.name) ?? 0;
              return (
                <PaneCard
                  key={p.name}
                  ico={p.name.slice(0, 1).toUpperCase()}
                  name={p.name}
                  sub={`${p.scope} · 技能 ${String(p.counts.skills)} · MCP ${String(p.counts.mcp)}${activeForPlugin > 0 ? " · 已激活 " + String(activeForPlugin) : ""}`}
                  trusted={p.trust === "trusted"}
                  trustTitle={p.trust === "trusted" ? "已信任" : "未信任——点卡片查看并决定"}
                  selected={sel === p.name}
                  onOpen={() => setSel(p.name)}
                />
              );
            })}
          </div>
          {hidden > 0 && (
            <button className="ap-more" onClick={() => setShowAll(true)}>
              查看{shown.slice(-2).map((p) => p.name).join("、")}，另有 {String(hidden)} 项
            </button>
          )}
        </div>
        {selected !== null && (
          <Drawer key={sel} title={selected.name} sub={`${selected.scope} · 信任态：${selected.trust}`} onClose={() => setSel(null)}>
            <section className="ap-sec">
              <h3>组成</h3>
              <div className="ap-kv">
                <span>{categoryLabel("skills")} {String(selected.counts.skills)} · {categoryLabel("commands")} {String(selected.counts.commands)} · {categoryLabel("agents")} {String(selected.counts.agents)} · {categoryLabel("hooks")} {String(selected.counts.hooks)} · {categoryLabel("mcp")} {String(selected.counts.mcp)}（激活 {hasMcpActiveData ? String(activeMcpByPlugin.get(selected.name) ?? 0) : "—"}） · {categoryLabel("lsp")} {String(selected.counts.lspActive)}/{String(selected.counts.lsp)}</span>
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
              {selectedMcp.length === 0 && <div className="ap-empty">无 MCP 服务</div>}
              {selectedMcp.map((m) => {
                const key = selected.name + "/" + m.server;
                const toolPrefix = "mcp__plugin_" + selected.name + "_" + m.server + "__";
                const activeNames = activeMcpTools
                  .filter((s) => s.startsWith(toolPrefix))
                  .map((s) => s.slice(toolPrefix.length));
                // 旧快照可能只有 activeMcpServers / activeMcpTools 没有 summaries：按原始集回退，
                // 不把「有 active 记录但缺汇总」显示成未激活。
                const summary = mcpSummaryByKey.get(key)
                  ?? ((plugins.activeMcpServers ?? []).includes(key)
                    ? { key, plugin: selected.name, server: m.server, toolCount: m.tools.length, active: true, activeMode: "server" as const, activeToolCount: m.tools.length }
                    : activeNames.length > 0
                      ? { key, plugin: selected.name, server: m.server, toolCount: m.tools.length, active: true, activeMode: "tools" as const, activeToolCount: activeNames.length }
                      : undefined);
                return (
                  <McpServerRow
                    key={m.server}
                    server={m.server}
                    state={m.state}
                    toolCount={m.tools.length}
                    {...(summary !== undefined ? { summary } : {})}
                    activeToolNames={activeNames}
                    {...(m.error !== undefined ? { error: m.error } : {})}
                    hasData={hasMcpActiveData}
                  />
                );
              })}
            </section>
          </Drawer>
        )}
      </div>
    </PageFrame>
  );
}
