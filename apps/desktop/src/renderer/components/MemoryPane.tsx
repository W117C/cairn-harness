// 记忆系统页（项目层/全局层主题浏览、MEMORY.md 索引渲染、导出与删除）。
import { Fragment, useState } from "react";
import { BookOpen, Brain } from "lucide-react";
import type { MemorySnapshot } from "../../../../../src/main/ipc-protocol";
import { renderInline } from "../markdown";
import { bodyLines, fullTime, indexLines, memoryExportMarkdown, memoryRows, relativeTime } from "../memory-view";
import { PAGE_CONTEXT_ITEMS } from "../navigation";
import { useNow } from "../useNow";
import { activates } from "./a11y-activate";
import { ConfirmDialog } from "./ConfirmDialog";
import { PageFrame } from "./PageFrame";
import { EmptyState } from "./settings-ui";
import { Drawer, Notice } from "./app-page-chrome";

export function MemoryPane(props: {
  snap: MemorySnapshot;
  onError: (m: string) => void;
  refresh: () => void;
  filter?: string;
  onFilter?: (filter: string) => void;
  /** 直达设置·高级的「记忆与成本」（沉淀开关在那里，记忆页此前无处可去）。 */
  onOpenMemorySettings?: () => void;
}): React.JSX.Element {
  const memory = props.snap;
  const [query, setQuery] = useState("");
  const [localFilter, setLocalFilter] = useState("all");
  const [sortByName, setSortByName] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const now = useNow();
  // 删除主题确认（2026-10-17：原生 confirm → 产品自绘卡）
  const [topicAsk, setTopicAsk] = useState<{ layer: "project" | "global"; topic: string } | null>(null);
  const filter = props.filter ?? localFilter;
  const setFilter = props.onFilter ?? setLocalFilter;
  const sorted = memoryRows(memory, query, filter, sortByName);
  // 「全部」下按层分组：24 条同一权重堆在一起读不出边界。筛选到单层时不摆组头（那行会被读成重复）。
  const grouped = filter === "all";
  const [selLayer, selTopic] = sel === null ? [null, null] : [sel.slice(0, sel.indexOf(":")), sel.slice(sel.indexOf(":") + 1)];
  const selected = selLayer === null ? null : (selLayer === "project" ? memory.project : memory.global).topics.find((t) => t.topic === selTopic) ?? null;
  const selectedLayer = selLayer === "project" ? memory.project : memory.global;
  const exportMemory = async (): Promise<void> => {
    setExportBusy(true);
    setNotice(null);
    try {
      const r = await window.agent.exportMemory(memoryExportMarkdown(memory), "cairn-memory.md");
      if (r.ok) setNotice(`已导出：${r.path ?? "记忆文件"}`);
      else if (r.canceled !== true) props.onError(`导出记忆失败：${r.error ?? "未知原因"}`);
    } catch (err) {
      props.onError(`导出记忆失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportBusy(false);
    }
  };
  // 批 6（总纲阶段 3-3）：数据为 0 时只显示 EmptyState，不摆统计卡与筛选。
  if (memory.project.topics.length + memory.global.topics.length === 0) {
    return (
      <PageFrame
        title="记忆"
        search={{ label: "搜索记忆", value: query, onChange: setQuery }}
        onRefresh={props.refresh}
        filters={PAGE_CONTEXT_ITEMS.memory}
        activeFilter={filter}
        onFilter={setFilter}
      >
        <EmptyState
          icon={<Brain size={22} />}
          title="还没有记忆"
          desc="Cairn 会在对话中记下项目约定和你的偏好。"
          {...(props.onOpenMemorySettings !== undefined
            ? { action: <button className="mini-btn primary" title="自动沉淀、跨文件波及等开关在设置·高级里" onClick={props.onOpenMemorySettings}>记忆设置…</button> }
            : {})}
        />
      </PageFrame>
    );
  }
  return (
    <PageFrame
      title="记忆"
      search={{ label: "搜索记忆", value: query, onChange: setQuery }}
      onRefresh={props.refresh}
      filters={PAGE_CONTEXT_ITEMS.memory}
      activeFilter={filter}
      onFilter={setFilter}
    >
      <div className="memory-toolbar">
        <div className="ap-summary" role="status">
          <span className="ap-summary-item">项目层 <strong>{String(memory.project.topics.length)}</strong></span>
          <span className="ap-summary-item">全局层 <strong>{String(memory.global.topics.length)}</strong></span>
          <span className={"ap-summary-item" + (memory.project.pendingExternalRefs.length + memory.global.pendingExternalRefs.length > 0 ? " warn" : "")}>
            待批引用 <strong>{String(memory.project.pendingExternalRefs.length + memory.global.pendingExternalRefs.length)}</strong>
          </span>
        </div>
        <div className="ap-toolbar">
          <select className="memory-sort" aria-label="记忆排序" value={sortByName ? "name" : "recent"} onChange={(event) => setSortByName(event.target.value === "name")}>
            <option value="recent">最近更新</option>
            <option value="name">按名称</option>
          </select>
          <button className="mini-btn" disabled={exportBusy} onClick={() => { void exportMemory(); }}>
            {exportBusy ? "导出中…" : "导出记忆…"}
          </button>
          {props.onOpenMemorySettings !== undefined && (
            <button className="mini-btn" onClick={props.onOpenMemorySettings} title="自动沉淀、跨文件波及等开关在设置·高级里">
              记忆设置…
            </button>
          )}
        </div>
      </div>
      <div className="ap-actions-row"><Notice text={notice} /></div>
      <div className={"ap-split" + (selected !== null ? " has-drawer" : "")}>
        <div className="ap-list memory-list">
          {sorted.length === 0 && <div className="ap-empty">没有匹配的主题</div>}
          {sorted.map((r, index) => (
            <Fragment key={`${r.layer}:${r.topic.topic}`}>
              {grouped && (index === 0 || sorted[index - 1]?.layer !== r.layer) && (
                <div className="ap-group-label">
                  {r.layer === "project" ? "项目层" : "全局层"} · {String(sorted.filter((x) => x.layer === r.layer).length)}
                </div>
              )}
              <div
                className={"ap-item" + (sel === `${r.layer}:${r.topic.topic}` ? " on" : "")}
                onClick={() => setSel(`${r.layer}:${r.topic.topic}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (activates(e)) { e.preventDefault(); setSel(`${r.layer}:${r.topic.topic}`); } }}
              >
                {/* H（2026-10-16）：名称单行省略；F：元信息走相对时间（悬停给完整时间）。
                    层别只在「全部」的组头读，行内不再重复同一枚徽标。 */}
                <span className="memory-title" title={r.topic.topic}><BookOpen size={14} aria-hidden="true" /><span className="nm">{r.topic.topic}</span></span>
                <span className="sub" title={fullTime(r.topic.modified)}>
                  {r.topic.type === "project" ? "项目" : r.topic.type === "global" ? "全局" : r.topic.type}
                  {" · "}
                  {String(r.topic.bytes)} B · {relativeTime(r.topic.modified, now)}
                </span>
                {r.topic.body.trim() !== "" && <span className="memory-preview">{bodyLines(r.topic.body)[0]}</span>}
              </div>
            </Fragment>
          ))}
        </div>
        {selected !== null && (
          <Drawer
            title={selected.topic}
            sub={`${selLayer === "project" ? "项目层" : "全局层"} · ${String(selected.bytes)} B · ${relativeTime(selected.modified, now)}`}
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
            {(memory.project.pendingExternalRefs.length + memory.global.pendingExternalRefs.length > 0) && <section className="ap-sec">
              <h3>待批外部引用</h3>
              {/* 摘要里的「待批引用」是两层合计；本层为空时说明另一层的条目仍列在下面（标「另层」）。 */}
              {selectedLayer.pendingExternalRefs.length === 0 && (
                <div className="ap-li">
                  <span className="p">本层没有待批引用（摘要里的数字含两层；另一层的在下面标「另层」）</span>
                </div>
              )}
              {selectedLayer.pendingExternalRefs.map((p) => <div key={p} className="ap-li"><span className="kind">引用</span><span className="p">{p}</span></div>)}
              {(selLayer === "project" ? memory.global : memory.project).pendingExternalRefs.map((p) => (
                <div key={"other:" + p} className="ap-li"><span className="kind">另层</span><span className="p">{p}</span></div>
              ))}
            </section>}
            {/* D：危险操作收进面板底部——描边红小按钮 + 二次确认（ConfirmDialog）。 */}
            <div className="ap-drawer-foot">
              <section className="ap-sec">
                <h3>删除</h3>
                <div className="ap-kv">只有你能删（模型没有删除权）；删除后立即生效。</div>
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
    </PageFrame>
  );
}
