// C-32 ChangeSummaryCard（2026-11-03 按 DSH 官方 ChangedFiles 卡重做内容与逻辑）：
//
// DSH 的交付卡只回答一件事：**这一轮改了哪些文件、每个文件增删多少行**。
//   · 单文件：标题「已编辑 <文件名>」+ 文件类型图标，不铺文件列表；块头保留 +N/−M 或二进制/过大。
//   · 多文件：标题「已编辑 N 个文件」+ 合计 +N/−M；列表按记录顺序，默认前 4 行，超过才出「全部 N 个文件」。
//   · 每一行/块头在右侧 Sidebar 打开本轮 review；悬停把统计换成「在侧边栏预览」。
//
// Cairn 没有 DSH 的 changes 摘要路由，行数由 useChangeStats 逐文件读 changeDiff 得到；
// 验证状态/四问清单不再塞进这张卡（DSH 卡没有这些格），仍保留在「变更」窗格里。
import { useEffect, useRef, useState, type JSX } from "react";
import { ChevronDown, ChevronUp, FileCode2, FileText } from "lucide-react";
import type { TurnDelivery } from "../projections";
import { useChangeStats, type ChangeStat } from "../use-change-stats";
import type { ChangeDiffPayload } from "../../../../../src/main/change-diff";

const basenameOf = (path: string): string => path.split("/").pop() ?? path;

const CODE_EXT = /\.(?:[cm]?[jt]sx?|css|scss|html?|json|ya?ml|toml|py|rb|rs|go|java|kt|swift|c|cc|cpp|h|hpp|sh|zsh|fish|sql|md|mdx)$/i;
const isCodePath = (path: string): boolean => CODE_EXT.test(path);

function Stat(props: { stat: ChangeStat | undefined }): JSX.Element {
  const s = props.stat;
  if (s === undefined || s.kind === "loading") return <span className="cf-muted" aria-label="正在统计改动">…</span>;
  if (s.kind === "binary") return <span className="cf-muted">二进制</span>;
  if (s.kind === "oversized") return <span className="cf-muted">过大</span>;
  if (s.kind === "error") return <span className="cf-muted" title={s.message}>—</span>;
  return (
    <>
      <span className="cf-add">+{String(s.add)}</span>
      <span className="cf-del">−{String(s.del)}</span>
    </>
  );
}

function aggregate(files: TurnDelivery["files"], stats: Record<string, ChangeStat>): { add: number; del: number; pending: boolean; binary: boolean; oversized: boolean; error: boolean } {
  let add = 0;
  let del = 0;
  let pending = false;
  let binary = false;
  let oversized = false;
  let error = false;
  for (const f of files) {
    const s = stats[f.path];
    if (s === undefined || s.kind === "loading") pending = true;
    else if (s.kind === "counts") { add += s.add; del += s.del; }
    else if (s.kind === "binary") binary = true;
    else if (s.kind === "oversized") oversized = true;
    else error = true;
  }
  return { add, del, pending, binary, oversized, error };
}


/** DSH 的 500ms 悬停预览：不显示 hunk 头，只给逐行 diff；宽度比卡窄 48px、最高 420px（CSS）。 */
function ChangePreview(props: { path: string; stat: ChangeStat | undefined; payload: ChangeDiffPayload | undefined }) {
  const p = props.payload;
  return (
    <div className="change-preview" role="dialog" aria-label={`${props.path} 的改动预览`}>
      <div className="change-preview-head">
        <span className="cp-path">{props.path}</span>
        <span className="cp-stat"><Stat stat={props.stat} /></span>
      </div>
      {p === undefined
        ? <div className="change-preview-note">正在读取改动…</div>
        : p.ok !== true
          ? <div className="change-preview-note">{p.error}</div>
          : p.truncated
            ? <div className="change-preview-note">文件过大，只显示截断前的改动</div>
            : p.hunks.length === 0
              ? <div className="change-preview-note">两侧内容相同</div>
              : (
                <div className="change-preview-body">
                  {p.hunks.flatMap((h, hi) => h.lines.map((l, li) => (
                    <div className={`cp-line ${l.kind}`} key={`${String(hi)}:${String(li)}`}>
                      <span className="cp-ln">{l.oldNo === null ? "" : String(l.oldNo)}</span>
                      <span className="cp-ln">{l.newNo === null ? "" : String(l.newNo)}</span>
                      <span className="cp-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                      <span className="cp-text">{l.text}</span>
                    </div>
                  )))}
                </div>
              )}
    </div>
  );
}

export function ChangeSummaryCard(props: {
  delivery: TurnDelivery;
  /** DSH ChangedFiles 的块头/行动作：打开本轮 review 并选中该文件（Cairn = 「变更」窗格）。 */
  onOpenChanges?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const previewTimer = useRef<number | null>(null);
  const schedulePreview = (path: string): void => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => { setPreview(path); }, 500);
  };
  const closePreview = (): void => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = null;
    setPreview(null);
  };
  useEffect(() => {
    if (preview === null) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") closePreview(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [preview]);
  useEffect(() => () => { if (previewTimer.current !== null) window.clearTimeout(previewTimer.current); }, []);
  const d = props.delivery;
  const { stats, payloads } = useChangeStats(d.files);
  if (d.files.length === 0) return null; // DSH：没有改动摘要就不出卡
  const single = d.files.length === 1 ? d.files[0]! : null;
  const visible = expanded ? d.files : d.files.slice(0, 4);
  const foldable = d.files.length > 4;
  const sum = aggregate(d.files, stats);
  const headerLabel = single !== null ? `查看 ${single.path} 的改动` : "在侧边栏查看本轮改动";
  const openReview = (path: string): void => {
    if (props.onOpenChanges !== undefined) props.onOpenChanges(path);
    else if (foldable) setExpanded((v) => !v);
  };
  const statNode = single !== null
    ? <Stat stat={stats[single.path]} />
    : sum.pending
      ? <span className="cf-muted" aria-label="正在统计改动">…</span>
      : sum.add + sum.del > 0
        ? <><span className="cf-add">+{String(sum.add)}</span><span className="cf-del">−{String(sum.del)}</span></>
        : sum.binary ? <span className="cf-muted">二进制</span>
          : sum.oversized ? <span className="cf-muted">过大</span>
            : sum.error ? <span className="cf-muted">—</span>
              : <><span className="cf-add">+0</span><span className="cf-del">−0</span></>;
  return (
    <>
      <div className="changes-card" data-single={single !== null ? "true" : "false"} onMouseLeave={closePreview}>
        <button
          type="button"
          className="changes-head"
          aria-label={headerLabel}
          title={single !== null ? single.path : headerLabel}
          onClick={() => { openReview(single?.path ?? d.files[0]!.path); }}
          {...(single !== null ? { onMouseEnter: () => { schedulePreview(single.path); }, onFocus: () => { schedulePreview(single.path); } } : {})}
        >
          <span className="cf-ico" aria-hidden="true">
            {single === null || isCodePath(single.path) ? <FileCode2 size={20} /> : <FileText size={20} />}
          </span>
          <span className="cf-heading">
            <span className="cf-t">{single !== null ? `已编辑 ${basenameOf(single.path)}` : `已编辑 ${String(d.files.length)} 个文件`}</span>
            <span className="cf-subtitle">
              <span className="cf-stats num">{statNode}</span>
              <span className="cf-preview-hint">在侧边栏预览</span>
            </span>
          </span>
        </button>
        {single === null && (
          <>
            <ul className="changes-list" aria-label="改动文件">
              {visible.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className="change-row"
                    title={f.path}
                    aria-label={`查看 ${f.path} 的改动`}
                    onClick={() => { openReview(f.path); }}
                    onMouseEnter={() => { schedulePreview(f.path); }}
                    onFocus={() => { schedulePreview(f.path); }}
                  >
                    <span className="change-row-path">{f.path}</span>
                    <span className="change-row-counts"><Stat stat={stats[f.path]} /></span>
                  </button>
                </li>
              ))}
            </ul>
            {foldable && (
              <button
                type="button"
                className="changes-more"
                aria-expanded={expanded}
                onClick={() => { setExpanded((v) => !v); }}
              >
                <span>{expanded ? "收起" : `全部 ${String(d.files.length)} 个文件`}</span>
                {expanded ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
              </button>
            )}
          </>
        )}
        {preview !== null && (
          <ChangePreview path={preview} stat={stats[preview]} payload={payloads[preview]} />
        )}
      </div>
    </>
  );
}
