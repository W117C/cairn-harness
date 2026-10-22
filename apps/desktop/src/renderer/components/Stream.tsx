// 事件流（Claude 蓝本 v1 重建；锚点契约全保留）：
//   user 行 = 右侧气泡正文（原型 v3-lite .u：surface-2 + 右下角尾；业主 18.41.11 裁「用户和大模型
//   的对话左右区分」——样式层落位，DOM 锚不动；hover 出复制/分叉/还原/折叠）；assistant 行 = 左侧 ✦ 标记
//   + markdown 正文（流式期光标；hover 出复制/回放/朗读/赞踩）；工具行 = 状态字形 + mono 头 + 展开
//   （折叠行含 摘要 + 耗时（有 then 显示））；连续工具行成步骤簇；思考行可折叠走动。
// P3-1 收口（计划稿）：操作条分叉落 user 行（fork 到该轮）、回放落 agent 行（fork + 注入该轮输入不
//   发送）；四类行带 data-event-id 锚（1-based 行号——timeline 跳转落点）；顶部 .gen-bar 生成中细条。
// v7.2 长对话导航（蓝本未及面，§9 登记）：① 轮折叠——已收轮整组收成一行摘要（第 N 轮 + 首句），
//   运行中的最后一轮不许折（不把正在流的内容藏了）；折叠行保留 data-round-anchor（目录跳转的落点）。
//   ② 目录所需的纯函数（turnSummaries/truncateSummary/foldAllButLast/canFoldRound）在本文件导出。
// 判卷锚（render-structure.test.tsx）：.row.user/.row.assistant/.row.error-row/.toolcluster、
// data-round-anchor、think-live/think-body/think-elapsed/aria 全套、复制/还原 aria-label ——
// 全部逐字保留（本文件换形态与图标，不动锚）。
// 图标 = lucide-react（ADR 0003）。
import { AlertTriangle,Check,ChevronRight,ChevronUp,CircleDashed,Copy,Eye,FileCode2,FileText,Folder,GitBranch,History,Image as ImageIcon,Loader2,Pencil,Pin,RotateCcw,RotateCw,Sparkles,Square,ThumbsDown,ThumbsUp,Volume2 } from "lucide-react";
import { Fragment,memo,useEffect,useId,useState } from "react";
import type { ChangeDiffPayload } from "../../../../../src/main/change-diff";
import { eventRefKey, type EventRef } from "../../../../../src/events/session-ref";
import { Markdown } from "../markdown";
import { relativeTime,type StreamRow } from "../projections";
import { userMessageCopy } from "../transcript";
import { useNow } from "../useNow";
import type { ViewMode } from "../view-mode";
import { DiffView } from "./DiffView";
import { canFoldRound,truncateSummary } from "./stream-model";

export type { StreamActions } from "../stream-actions";
export { canFoldRound,foldAllButLast,truncateSummary,turnSummaries } from "./stream-model";

/** 写文件类工具（展开区行内 diff 的判定面；与 ApprovalCard toolIcon 的写族一致）。 */
const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch"]);

/** 写文件类工具 + args JSON 里的 path → diff 目标路径；其余工具 / 非法 args → null（不摆差异区）。
 *  P3-1 Step 2（计划稿）：工具卡展开区的行内 diff 走 changeDiff 懒加载（既有 DiffView 复用）。 */
export function writeDiffPathOf(tool: string, args: string | undefined, path?: string): string | null {
  if (!WRITE_TOOLS.has(tool)) return null;
  if (path !== undefined && path !== "") return path;
  if (args === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(args);
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = (parsed as { path?: unknown }).path;
    return typeof p === "string" && p !== "" ? p : null;
  } catch {
    return null;
  }
}

function RowTime(props: { ts?: number }) {
  const now = useNow();
  if (props.ts === undefined) return null;
  return (
    <span className="row-time" title={new Date(props.ts).toLocaleString()}>
      {relativeTime(now, props.ts)}
    </span>
  );
}

/** 工具行一句话摘要的动词层（阶段 2 · brief §二.4 例：「抓取 api-docs.deepseek.com/news」）。
 *  已知工具给中文动词；未知工具 null——宁缺不编（渲染层回落「· 摘要」形态）。 */
const TOOL_VERBS: Readonly<Record<string, string>> = {
  read_file: "读取",
  write_file: "写入",
  edit_file: "编辑",
  apply_patch: "打补丁",
  run_shell: "运行",
  list_dir: "列目录",
  web_fetch: "抓取",
  web_search: "搜索",
  spawn_agent: "派发子任务",
  read_image: "读图",
};
export function toolVerb(tool: string): string | null {
  return TOOL_VERBS[tool] ?? null;
}

/** 工具耗时文本（P3-1 · 折叠行「图标 + 摘要 + 耗时 + 状态符」的耗时位）：
 *  <1s 毫秒 / <10s 一位小数秒 / <60s 整数秒 / 其余「XmYs」（秒为 0 省「s」）。负值/非数按 0。 */
export function formatDuration(ms: number): string {
  const v = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (v < 1000) return `${String(Math.round(v))}ms`;
  const s = v / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${String(Math.round(s))}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  return rs === 0 ? `${String(m)}m` : `${String(m)}m${String(rs)}s`;
}

/** 工具状态：未返回结果与失败分开，停转后不继续转圈或暗示成功。 */
function ToolGlyph(props: { pending?: boolean; interrupted?: boolean; ok?: boolean }) {
  if (props.interrupted) return <span className="glyph interrupted" aria-label="未收到结果"><CircleDashed size={12} /></span>;
  if (props.pending) return <span className="glyph pending" aria-label="执行中"><Loader2 size={12} /></span>;
  if (props.ok === false) return <span className="glyph failed" aria-label="失败"><AlertTriangle size={12} /></span>;
  return <span className="glyph ok" aria-label="完成"><Check size={12} /></span>;
}

const ToolRow = memo(function ToolRow(props: Extract<StreamRow, { kind: "tool" }> & { view?: ViewMode; onOpenArtifact?: (a: NonNullable<Extract<StreamRow, { kind: "tool" }>["artifact"]>) => void }) {
  // Verbose 档默认全展开（蓝本 §3.4）；不给 view（旧消费者/判卷）保持折叠默认。
  const [open, setOpen] = useState(props.view === "verbose");
  useEffect(() => {
    if (props.view !== undefined) setOpen(props.view === "verbose");
  }, [props.view]);
  const r = props;
  const verb = toolVerb(r.tool);
  // 写文件类行的行内 diff（P3-1 Step 2）：展开 + 成功收口后才懒加载（changeDiff 既有通道）；
  // 失败原文上屏（fail-visible），通道无应答如实说。
  const diffPath = writeDiffPathOf(r.tool, r.args, r.path);
  const [diff, setDiff] = useState<{ loading: boolean; payload: ChangeDiffPayload | null }>({ loading: false, payload: null });
  useEffect(() => {
    if (!open || r.ok !== true || diffPath === null) return;
    let alive = true;
    setDiff({ loading: true, payload: null });
    void window.agent
      .changeDiff({ path: diffPath })
      .then((payload) => { if (alive) setDiff({ loading: false, payload: payload ?? { ok: false, error: "通道无应答（主进程未返回差异数据）" } }); })
      .catch((err: unknown) => { if (alive) setDiff({ loading: false, payload: { ok: false, error: err instanceof Error ? err.message : String(err) } }); });
    return () => { alive = false; };
  }, [open, r.ok, diffPath]);
  return (
    <div className={`row tool${open ? " open" : ""}`} data-event-id={String(r.seq + 1)}>
      <button className="tool-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="chev" aria-hidden="true"><ChevronRight size={10} /></span>
        <ToolGlyph pending={r.pending} interrupted={r.interrupted} ok={r.ok} />
        <span className="tname">{r.tool}</span>
        <span className="tsum">{verb !== null ? `${verb} ${r.summary}` : `· ${r.summary}`}</span>
        {r.interrupted && <span className="tdur">未收到结果</span>}
        {r.ts !== undefined && r.then !== undefined && (
          <span className="tdur">{formatDuration(r.then - r.ts)}</span>
        )}
        {/* 2026-10-17：工具行不再挂绝对时间戳。brief §二.4 的折叠行要素 = 图标 + 摘要 + 耗时 + 状态；
            同一行同时出现「5.9s」和「15 分钟前」两份时间，读起来是噪音（真机目验）。
            绝对时间仍可从时间线窗格/事件日志取得，不丢信息。 */}
      </button>
      {open && (
        <div className="tool-body">
          {/* 展开区（brief §二.4）：原始参数 JSON 默认折叠，点击才见；老事件（无 args）回落摘要。 */}
          {r.args !== undefined ? (
            <div className="kv">
              <span className="k">原始参数（JSON）</span>
              <pre>{r.args}</pre>
            </div>
          ) : (
            <div className="kv">
              <span className="k">摘要</span>
              <pre>{r.summary}</pre>
            </div>
          )}
          {r.output !== undefined && (
            <div className="kv tool-output" data-failed={r.ok === false}>
              <span className="k">返回内容</span>
              <pre>{r.output === "" ? "（空输出）" : r.output}</pre>
              {r.outputTruncated && <span className="tool-output-note">仅显示前 10,000 字符；完整内容可在事件日志中查看。</span>}
            </div>
          )}
        {/* 行内 diff（P3-1 Step 2 · 计划稿）：写文件类且已成功收口——changeDiff 懒加载 + DiffView 复用。 */}
        {diffPath !== null && r.ok === true && (
          <div className="kv">
            <span className="k">文件差异</span>
            {diff.loading && <div className="isp-empty">正在读快照与当前文件…</div>}
            {!diff.loading && diff.payload !== null && (
              diff.payload.ok ? (
                <DiffView hunks={diff.payload.hunks} truncated={diff.payload.truncated} />
              ) : (
                <div className="ap-notice err" role="alert">{diff.payload.error}</div>
              )
            )}
          </div>
        )}
        {/* 产物入口（2026-10-16）：工具交付了东西就给一个直达按钮，用户不必自己去仓库里翻。
            图标按 kind 选——可预览的页面给「眼睛」，图片给「图」，其余给「源码」。 */}
        {r.artifact !== undefined && props.onOpenArtifact !== undefined && (
          <div className="kv">
            <span className="k">产物</span>
            <div className="artifact-actions">
              <button className="mini-btn" onClick={() => props.onOpenArtifact!(r.artifact!)}>
                {r.artifact.kind === "html" || r.artifact.kind === "svg"
                  ? <><Eye size={11} /> 打开预览</>
                  : r.artifact.kind === "image"
                    ? <><ImageIcon size={11} /> 看图</>
                    : <><FileCode2 size={11} /> 看源码</>}
              </button>
              <code className="artifact-path" title={r.artifact.path}>{r.artifact.path}</code>
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
});

/** 摘要 → 调用列表 → 单次输入/输出；展开选择不随流式追加或收口重置。 */
function ToolCluster(props: { rows: Extract<StreamRow, { kind: "tool" }>[]; view?: ViewMode; onOpenArtifact?: StreamActions["onOpenArtifact"] }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const open = props.view === undefined || props.view === "verbose" || expanded;
  const pending = props.rows.filter((r) => r.pending);
  const failures = props.rows.filter((r) => r.ok === false);
  const interrupted = props.rows.filter((r) => r.interrupted);
  const latest = pending.at(-1);
  const failure = failures.at(-1);
  return (
    <div className="toolcluster" data-tool-group={String(props.rows[0]?.seq)}>
      {props.view !== undefined && props.view !== "verbose" && (
        <button className="tool-group-toggle" aria-expanded={open} aria-controls={id} onClick={() => setExpanded(!expanded)}>
          <ChevronRight className="chev" size={12} aria-hidden="true" />
          <ToolGlyph pending={latest !== undefined} interrupted={latest === undefined && interrupted.length > 0} ok={failures.length === 0} />
          <span>{props.rows.length} 次工具调用</span>
          {latest !== undefined && <span className="tool-group-detail">执行中 · {toolVerb(latest.tool) ?? latest.tool} {latest.summary}</span>}
          {interrupted.length > 0 && <span className="tool-group-detail">{interrupted.length} 次未收到结果</span>}
          {/* 失败这一行分两截：**标记**（N 次失败）留在危险色，**正文**（失败摘要）降到正文色——
              「四行散文整段用危险色是在阅读面里喊」；标记三重（左侧红三角 / N 次失败 / 重试钮）仍在，
              失败照样显眼，而文案回到「内容」的身份（2026-10-22 目验后补上，见 PROGRESS 第 662 页）。 */}
          {failures.length > 0 && (
            <span className="tool-group-failure">
              <span className="tool-group-failure-count">{failures.length} 次失败</span>
              {!open && failure?.output ? <span className="tool-group-failure-detail"> · {truncateSummary(failure.output, 240)}</span> : null}
            </span>
          )}
        </button>
      )}
      <div id={id} className="tool-group-body" hidden={!open}>
        {props.rows.map((r) => <ToolRow key={r.seq} {...r}
          {...(props.view !== undefined ? { view: props.view } : {})}
          {...(props.onOpenArtifact !== undefined ? { onOpenArtifact: props.onOpenArtifact } : {})} />)}
      </div>
    </div>
  );
}

import type { StreamActions } from "../stream-actions";

function AssistantActions(props: { text: string; eventId: number; round: number; speaking: boolean; actions: StreamActions }) {
  const current = props.actions.feedback?.get(props.eventId) ?? null;
  const { onCopyText, onFeedback, onReplay, onSpeak, onRetryRound, onPin } = props.actions;
  const pinned = props.actions.pinnedEventIds?.has(props.eventId) === true;
  const feedbackBusy = props.actions.feedbackBusy?.(props.eventId) === true;
  const pinBusy = props.actions.pinBusy?.(props.eventId) === true;
  const running = props.actions.running === true;
  return (
    <span className="row-actions" data-saving={props.actions.annotationPending?.(props.eventId) === true}>
      <button className="row-action" aria-label="复制这行输出" title="复制" onClick={() => onCopyText?.(props.text)}>
        <Copy size={12} />
      </button>
      {onPin !== undefined && (
        <button
          className={`row-action${pinned ? " on" : ""}`}
          aria-label={pinned ? "取消置顶这条输出" : "置顶这条输出"}
          aria-pressed={pinned}
          disabled={pinBusy}
          aria-busy={pinBusy}
          title={pinned ? "已置顶（再点取消）" : "置顶：钉在会话大纲里，长对话好找"}
          onClick={() => onPin(props.eventId, !pinned)}
        >{pinBusy ? <Loader2 size={12} /> : <Pin size={12} />}</button>
      )}
      {onRetryRound !== undefined && !running && (
        <button
          className="row-action"
          aria-label={`重跑第 ${String(props.round)} 轮`}
          title="重跑这一轮：用当时的输入再发一次（追加为新的一轮）"
          onClick={() => onRetryRound(props.round)}
        ><RotateCw size={12} /></button>
      )}
      {onReplay !== undefined && (
        <button
          className="row-action"
          aria-label={`回放到第 ${String(props.round)} 轮`}
          title="回放：从该轮起新建会话并填入当时的输入，原会话不动"
          onClick={() => onReplay(props.eventId)}
        ><RotateCcw size={12} /></button>
      )}
      {onSpeak !== undefined && (
        <button
          className={`row-action${props.speaking ? " on" : ""}`}
          aria-label={props.speaking ? "停止朗读" : "朗读这条输出"}
          aria-pressed={props.speaking}
          title={props.speaking ? "停止朗读" : "朗读（macOS 系统语音）"}
          onClick={() => onSpeak(props.eventId, props.text)}
        >{props.speaking ? <Square size={11} /> : <Volume2 size={12} />}</button>
      )}
      <button
        className={`row-action${current === "up" ? " on" : ""}`}
        aria-label={current === "up" ? "取消点赞" : "赞这条输出"}
        aria-pressed={current === "up"}
        disabled={feedbackBusy}
        aria-busy={feedbackBusy}
        title={current === "up" ? "已赞（再点撤销）" : "赞"}
        onClick={() => onFeedback?.(props.eventId, current === "up" ? null : "up")}
      >{feedbackBusy ? <Loader2 size={12} /> : <ThumbsUp size={12} />}</button>
      <button
        className={`row-action${current === "down" ? " on" : ""}`}
        aria-label={current === "down" ? "取消点踩" : "踩这条输出"}
        aria-pressed={current === "down"}
        disabled={feedbackBusy}
        aria-busy={feedbackBusy}
        title={current === "down" ? "已踩（再点撤销）" : "踩"}
        onClick={() => onFeedback?.(props.eventId, current === "down" ? null : "down")}
      >{feedbackBusy ? <Loader2 size={12} /> : <ThumbsDown size={12} />}</button>
    </span>
  );
}

/** 思考行（live）：可点开 + 计时。判卷钉住的锚（role/aria/think-live/think-elapsed/
 *  默认展开/折叠体）全保留；文案与字形随产品化更新。
 *  view 档位（蓝本 §3.4）：Normal 档默认折叠（思考不进阅读面）；Thinking/Verbose 档默认展开。
 *  **不给 view 时维持旧默认（有正文即展开）**——render-structure 判卷锚依赖该默认。 */
export function ThinkingLive(props: { seq: number; thinking?: string; running?: boolean; view?: ViewMode }): React.JSX.Element {
  const hasBody = props.thinking !== undefined && props.thinking !== "";
  const defaultOpen = props.view === undefined ? hasBody : props.view !== "normal" && hasBody;
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (props.view !== undefined) setOpen(props.view !== "normal" && hasBody);
  }, [props.view, hasBody]);
  const [elapsed, setElapsed] = useState(0);
  const running = props.running !== false;
  useEffect(() => {
    // running=false 时清掉定时器，elapsed 保留最后一次的值 ⇒ 定格在最终秒数（不继续跳）。
    if (!running) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);
  return (
    <div
      className={"row think" + (open ? " open" : "")}
      key={`t${props.seq}`}
      role="button"
      aria-expanded={open}
      aria-label="模型思考中，点击展开说明"
      onClick={() => setOpen((v) => !v)}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}
    >
      <div className="think-line">
        <span className="chev" aria-hidden="true"><ChevronRight size={10} /></span>
        <span className="think-label">{running ? "思考中" : "思考完成"}</span>
        {running ? (
          <span className="think-live" aria-hidden="true"><i /><i /><i /></span>
        ) : (
          <span className="think-done" aria-label="思考完成"><Check size={12} /></span>
        )}
        <span className="think-elapsed" aria-live="polite">{elapsed}s</span>
      </div>
      <div className="think-body">
        {props.thinking !== undefined && props.thinking !== "" ? (
          // 逐段累计的思考正文（来自 thinking_delta；与正文分开落事件，转录不脏）
          <span className="think-text">{props.thinking}</span>
        ) : (
          <>
            正在思考（可以调档位；这家没吐思考正文时这里就是空的）。
            <span className="off-note">思考与正文分开落事件，不把推理内容混进转录。</span>
          </>
        )}
      </div>
    </div>
  );
}

// 历史行按字段复用；增量只更新真正改变的行，完整 DOM 与定位锚继续保留。
/** 祖先行来源标记（计划 Task 5）：这一行属于父/祖会话文件，不是当前子会话自己的行。 */
function SourceTag(props: { at?: EventRef; inherited?: boolean }) {
  const ref = props.at;
  if (ref === undefined || props.inherited !== true) return null;
  return (
    <span className="row-source" title={`继承自会话 ${ref.sessionId}（第 ${String(ref.eventId)} 行）`}>
      来自 {ref.sessionId}
    </span>
  );
}

const UserRowView = memo(function UserRowView({ actions, canFold, flash, eventRef, sourceRow, ...r }: Extract<StreamRow, { kind: "user" }> & { actions?: StreamActions; canFold: boolean; flash: boolean; eventRef?: EventRef; sourceRow?: boolean }) {
  return (
  <div className={"row user" + (flash ? " flash" : "")} data-event-id={String(r.seq + 1)} {...(eventRef !== undefined ? { "data-event-ref": eventRefKey(eventRef), "data-source-session": eventRef.sessionId } : {})} style={{ scrollMarginTop: 14 }}>
    <span className="t" data-round-anchor={String(r.round)}>{r.text}</span>
    <SourceTag at={eventRef} inherited={sourceRow} />
    {/* 用户消息的附件（2026-10-18）：此前发出去就再也看不见——本轮起 user_message 事件带引用，
        历史/重放都能显示“这条消息带了哪些文件”。 */}
    {r.attachments !== undefined && r.attachments.length > 0 && (
      <span className="ur-attach">
        {r.attachments.map((a, i) => {
          const name = a.path.split("/").filter(Boolean).pop() ?? a.path;
          const body = (
            <>
              {a.kind === "directory" ? <Folder size={10} /> : <FileText size={10} />}
              <span>{name}</span>
            </>
          );
          return actions?.onOpenAttachment !== undefined ? (
            <button
              type="button"
              className="ur-attach-chip"
              key={i}
              title={`${a.path}（点击用默认应用打开）`}
              aria-label={`打开附件 ${name}`}
              onClick={() => actions.onOpenAttachment?.(a.path)}
            >{body}</button>
          ) : (
            <span className="ur-attach-chip" key={i} title={a.path}>{body}</span>
          );
        })}
      </span>
    )}
    <span className="meta">
      {(actions?.onCopyText !== undefined || actions?.onBranch !== undefined || actions?.onEditRound !== undefined || actions?.onToggleFold !== undefined) && (
        <span className="row-actions">
          {actions?.onCopyText !== undefined && (
            <button className="row-action" aria-label="复制这条消息" title="复制" onClick={() => actions.onCopyText?.(userMessageCopy(r.text, r.attachments))}>
              <Copy size={12} />
            </button>
          )}
          {actions?.onEditRound !== undefined && (
            <button
              className="row-action"
              aria-label={`编辑第 ${String(r.round)} 轮消息（新建分支）`}
              title="编辑：在新分支里改后重发，原会话不动"
              onClick={() => actions.onEditRound?.(r.round, r.text)}
            ><Pencil size={12} /></button>
          )}
          {actions?.onBranch !== undefined && (
            <button
              className="row-action"
              aria-label={`从这条消息分叉新会话（到第 ${String(r.round)} 轮）`}
              title="分叉：从该轮起新建会话，原会话不动"
              onClick={() => actions.onBranch?.(r.round)}
            ><GitBranch size={12} /></button>
          )}
          {actions?.onCopyText !== undefined && (
            <button
              className="row-action"
              aria-label={`还原第 ${String(r.round)} 轮改动过的文件`}
              title={`还原第 ${String(r.round)} 轮的文件改动`}
              onClick={() => actions.onRevertTurn?.(r.round)}
            ><History size={12} /></button>
          )}
          {actions?.onToggleFold !== undefined && canFold && (
            <button
              className="row-action"
              aria-label={`折叠第 ${String(r.round)} 轮`}
              title="折叠这一轮（收成一行）"
              onClick={() => actions.onToggleFold?.(r.round)}
            ><ChevronUp size={12} /></button>
          )}
        </span>
      )}
      <RowTime ts={r.ts} />
    </span>
  </div>
  );
});

const AssistantRowView = memo(function AssistantRowView({ actions, caret, eventRef, sourceRow, ...r }: Extract<StreamRow, { kind: "assistant" }> & { actions?: StreamActions; caret: boolean; eventRef?: EventRef; sourceRow?: boolean }) {
  return (
  <div className="row assistant" data-event-id={String(r.eventId)} {...(eventRef !== undefined ? { "data-event-ref": eventRefKey(eventRef), "data-source-session": eventRef.sessionId } : {})}>
    <span className="spark" aria-hidden="true"><Sparkles size={13} /></span>
    <span className="t">
      {/* 追字光标在正文末尾行内（caret 进最后一个文本块），终稿到达或会话停转即消失。 */}
      {r.text !== "" ? (
        <Markdown
          text={r.text}
          {...(actions?.onCopyText !== undefined ? { onCopy: actions.onCopyText } : {})}
          {...(caret ? { caret: true } : {})}
        />
      ) : (
        caret && <span className="cursor" aria-hidden="true" />
      )}
    </span>
    {!r.live && actions && (
      <AssistantActions
        text={r.text}
        eventId={r.eventId}
        round={r.round}
        speaking={actions.speakingEventId === r.eventId}
        actions={actions}
      />
    )}
    <SourceTag at={eventRef} inherited={sourceRow} />
    <span className="meta"><RowTime ts={r.ts} /></span>
  </div>
  );
});

/** 流本体（会话消息流）。
 *
 *  **为什么整棵包一层 memo**（2026-10-22 性能面）：这棵树在长会话里能到四万七千个 DOM 节点，
 *  而 App 是它的父级、每有一个与流无关的状态变化（每秒的计时器、输入框一个字、侧栏拖宽…）
 *  就会重渲染一次 App ⇒ 整棵树被重新 diff 一遍。实测形态：运行中每秒一跳的计时器，
 *  让一棵**没有新消息**的流每秒重算一次。
 *  ⇒ 这里用 memo 把「与流无关的父级重渲染」挡在门外：**props 全部稳定**（rows/actions 在 App 侧
 *  已是 useMemo，view/streaming/foldedRounds/flashRound 都是 state）⇒ props 没变就不重渲染。
 *  切会话仍按 App 侧那个 `key` 重挂（行内局部状态不跨会话复用，见 App.tsx 的注释）。
 *  流里唯一自己跳的计时器在 `ThinkingLive` 子组件里（它自己管自己），不受这一层影响。 */
export const Stream = memo(function Stream(props: {
  rows: StreamRow[];
  actions?: StreamActions;
  view?: ViewMode;
  streaming?: boolean;
  /** 已折叠的轮（v7.2）；缺席 = 不折。 */
  foldedRounds?: ReadonlySet<number>;
  /** 刚跳到的轮：该轮用户行闪一下（目录跳转的落点反馈）。 */
  flashRound?: number | null;
  /** 显示序 → 来源引用（指针分叉）：有它就按 eventRefKey 做 DOM 键与来源标记。 */
  refs?: ReadonlyMap<number, EventRef> | null;
  /** 祖先行的显示序（来源标记由此挂）。 */
  inherited?: ReadonlySet<number> | null;
}) {
  const actions = props.actions;
  const view = props.view;
  const folded = props.foldedRounds;
  const refOfRow = (seq: number): EventRef | undefined => props.refs?.get(seq);
  const keyOf = (prefix: string, seq: number): string => {
    const ref = refOfRow(seq);
    return ref === undefined ? `${prefix}${String(seq)}` : `${prefix}${eventRefKey(ref)}`;
  };
  // 追字光标只在**本会话真在跑**时亮：历史里未结的桶（被中断没落终稿）照实渲染文本，
  // 但不摆一个"正在输入"的活光标——那是把停当成了动（诚实口径）。undefined = 旧默认（亮）。
  const caretOn = props.streaming !== false;
  const streaming = props.streaming !== false;
  // 光标只归**最后一条** live 行（v7.1）：一轮里可能有多个 API 段各自成行，光标全亮会
  // 让读者以为多处在输入；正在流的永远是最尾那一段。
  const lastLiveSeq = (() => {
    for (let i = props.rows.length - 1; i >= 0; i--) {
      const r = props.rows[i]!;
      if (r.kind === "assistant" && r.live === true) return r.seq;
    }
    return -1;
  })();
  // 按轮分组（v7.2）：user 行开新组；其后各行归当前组——tool/error 行**不带 round 字段**，
  // 按序归组是唯一不编数据的口径。首个 user 之前的行 round=null，恒不折。
  const groups: Array<{ key: string; round: number | null; rows: StreamRow[] }> = [];
  for (const r of props.rows) {
    if (r.kind === "user") {
      groups.push({ key: keyOf("g", r.seq), round: r.round, rows: [r] });
    } else {
      const cur = groups[groups.length - 1];
      if (cur === undefined) groups.push({ key: "g0", round: null, rows: [r] });
      else cur.rows.push(r);
    }
  }
  const lastRound = (() => {
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i]!;
      if (g.round !== null) return g.round;
    }
    return null;
  })();

  // 一组行 → 节点（与旧逐行循环同构：连续 tool 行收进同一簇；其余行打断簇）。
  const renderGroup = (rows: readonly StreamRow[], canFold: boolean): Array<{ key: string; node: React.ReactNode }> => {
    const out: Array<{ key: string; node: React.ReactNode }> = [];
    let cluster: Extract<StreamRow, { kind: "tool" }>[] = [];
    const flush = () => {
      if (cluster.length === 0) return;
      const toolRows = cluster;
      const key = `c${String(toolRows[0]!.seq)}`;
      cluster = [];
      out.push({
        key,
        node: (
          <ToolCluster rows={toolRows}
            {...(view !== undefined ? { view } : {})}
            {...(actions?.onOpenArtifact !== undefined ? { onOpenArtifact: actions.onOpenArtifact } : {})} />
        ),
      });
    };
    for (const r of rows) {
      switch (r.kind) {
        case "tool":
          cluster.push(r);
          break;
        case "user": {
          flush();
          out.push({
            key: keyOf("u", r.seq),
            node: (
              <UserRowView {...r} canFold={canFold} flash={props.flashRound === r.round} {...(refOfRow(r.seq) !== undefined ? { eventRef: refOfRow(r.seq), sourceRow: props.inherited?.has(r.seq) === true } : {})} {...(actions !== undefined ? { actions } : {})} />
            ),
          });
          break;
        }
        case "assistant": {
          flush();
          // live 行前挂一条思考行（有思考正文就渲染；正文来自 thinking_delta 桶）。
          if (r.live || (r.thinking !== undefined && r.thinking !== "")) {
            out.push({
              key: `t${r.seq}`,
              node: (
                <ThinkingLive
                  seq={r.seq}
                  thinking={r.thinking}
                  running={streaming && r.live === true && r.text === ""}
                  {...(view !== undefined ? { view } : {})}
                />
              ),
            });
          }
          out.push({
            key: keyOf("a", r.seq),
            node: (
              <AssistantRowView {...r} caret={r.live === true && caretOn && r.seq === lastLiveSeq} {...(refOfRow(r.seq) !== undefined ? { eventRef: refOfRow(r.seq), sourceRow: props.inherited?.has(r.seq) === true } : {})} {...(actions !== undefined ? { actions } : {})} />
            ),
          });
          break;
        }
        case "error": {
          flush();
          // 错误行「重试」（brief 六）：运行中不摆（重试=再排一轮，此刻点击语义含糊）；
          // App 侧同样以 runningSet 兜底，键盘/程序化打开也不会双发。
          const canRetry = actions?.onRetryLast !== undefined && actions.running !== true;
          out.push({
            key: `e${r.seq}`,
            node: (
              <div className="row error-row" data-event-id={String(r.seq + 1)}>
                <span className="err-glyph" aria-hidden="true"><AlertTriangle size={14} /></span>
                <span className="t">{r.text}</span>
                <span className="meta">
                  {canRetry && (
                    <button
                      className="err-retry"
                      aria-label="重试上一轮"
                      title="用上一轮的输入再跑一次（追加为新的一轮）"
                      onClick={() => actions?.onRetryLast?.()}
                    ><RotateCw size={11} /> 重试</button>
                  )}
                  <RowTime ts={r.ts} />
                </span>
              </div>
            ),
          });
          break;
        }
      }
    }
    flush();
    return out;
  };

  const out: Array<{ key: string; node: React.ReactNode }> = [];
  for (const g of groups) {
    if (g.round !== null && folded?.has(g.round) === true) {
      const round = g.round;
      const u = g.rows[0];
      const text = u !== undefined && u.kind === "user" ? u.text : "";
      out.push({
        key: `f${g.key}`,
        node: (
          <div className="row user folded-turn" style={{ scrollMarginTop: 14 }} data-round-anchor={String(round)}>
            <button
              className="fold-head"
              aria-expanded={false}
              aria-label={`展开第 ${String(round)} 轮（已折叠）`}
              title="点击展开这一轮"
              onClick={() => actions?.onToggleFold?.(round)}
            >
              <span className="chev" aria-hidden="true"><ChevronRight size={10} /></span>
              <span className="fold-round">第 {String(round)} 轮</span>
              <span className="fold-sum">{truncateSummary(text)}</span>
            </button>
            <span className="meta"><RowTime ts={u?.ts} /></span>
          </div>
        ),
      });
      continue;
    }
    out.push(...renderGroup(g.rows, g.round !== null && canFoldRound(g.round, lastRound, streaming)));
  }
  // 行数组经 Fragment 带上 key（out 条目本就持有稳定键；此前裸 map 丢键会刷 dev 警告）。
  // 生成中顶栏细进度条（P3-1）：sticky 贴顶不随滚动，running 态跑马灯（styles.css），
  // 亮度由 data-running 驱动——idle 时透明（常驻不推布局，防状态切换抖动）。
  return (
    <>
      <div className="gen-bar" data-running={streaming ? "true" : "false"} aria-hidden="true" />
      {out.map((o) => <Fragment key={o.key}>{o.node}</Fragment>)}
    </>
  );
});
