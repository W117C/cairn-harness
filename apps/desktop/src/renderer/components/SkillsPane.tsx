// 技能中心页（独立 loose 技能卡片、信任决议与 SKILL.md 正文按需读取）。
import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import type { PluginPanelSnapshot } from "../../../../../src/agent/plugins";
import { PageFrame } from "./PageFrame";
import { EmptyState } from "./settings-ui";
import { Switch } from "./Switch";
import { Drawer, PaneCard } from "./app-page-chrome";

const SKILL_FILTER_ITEMS = [
  { id: "all", label: "全部" },
  { id: "trusted", label: "已信任" },
  { id: "untrusted", label: "未信任" },
] as const;

export function SkillsPane(props: {
  snap: PluginPanelSnapshot;
  onError: (m: string) => void;
  refresh: () => void;
  filter?: string;
  onFilter?: (filter: string) => void;
}): React.JSX.Element {
  const plugins = props.snap;
  const [query, setQuery] = useState("");
  const [localFilter, setLocalFilter] = useState("all");
  const [sel, setSel] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const filter = props.filter === undefined || props.filter === "" ? localFilter : props.filter;
  const setFilter = props.onFilter ?? setLocalFilter;
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
      <PageFrame
        title="技能中心"
        search={{ label: "搜索技能", value: query, onChange: setQuery }}
        onRefresh={props.refresh}
        filters={SKILL_FILTER_ITEMS}
        activeFilter={filter}
        onFilter={setFilter}
        inlineFilter
      >
        <EmptyState
          icon={<BookOpen size={22} />}
          title="还没有技能"
          desc="在输入框输入技能名即可调用。"
        />
      </PageFrame>
    );
  }
  // 双列卡片默认铺 6 张（3 行 × 2 列），其余收进「查看…另有 N 项」——参照 Codex 自定义页。
  const shown = showAll ? rows : rows.slice(0, 6);
  const hidden = rows.length - shown.length;
  return (
    <PageFrame
      title="技能中心"
      search={{ label: "搜索技能", value: query, onChange: setQuery }}
      onRefresh={props.refresh}
      filters={SKILL_FILTER_ITEMS}
      activeFilter={filter}
      onFilter={setFilter}
      inlineFilter
    >
      <div className={"ap-split" + (selected !== null ? " has-drawer" : "")}>
        <div className="ap-gridcol">
          {rows.length === 0 && <div className="ap-empty">没有匹配的技能</div>}
          <div className="ap-grid">
            {shown.map((s) => (
              <PaneCard
                key={s.invoke}
                ico={s.invoke.slice(0, 1).toUpperCase()}
                name={s.invoke}
                sub={s.description}
                trusted={s.trust === "trusted"}
                trustTitle={s.trust === "trusted" ? "已信任" : "未信任——点卡片查看并决定"}
                selected={sel === s.invoke}
                onOpen={() => setSel(s.invoke)}
              />
            ))}
          </div>
          {hidden > 0 && (
            <button className="ap-more" onClick={() => setShowAll(true)}>
              查看{shown.slice(-2).map((s) => s.invoke).join("、")}，另有 {String(hidden)} 项
            </button>
          )}
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
    </PageFrame>
  );
}
