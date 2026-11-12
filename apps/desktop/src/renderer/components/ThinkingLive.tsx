import { BrainCircuit, ChevronRight, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { lastThinkingLine } from "../derived/thinking-line";
import { Markdown } from "../markdown";
import type { StreamActions } from "../stream-actions";
import { isNearBottom } from "../useStickyScroll";
import type { ViewMode } from "../view-mode";
import { CairnLoader } from "./CairnLoader";
import { truncateSummary } from "./stream-model";

/** 流式思考的折叠态 ticker（2026-11-08 第 1042 页，zcode ReasoningTrigger 同形）：
 *  单行显示「正在想的最后一行」，溢出时跟到行尾 + 两端渐隐；新行到来按 key 重挂滚入。 */
function ThinkingTicker({ line }: { line: { key: string; text: string } }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = (): void => {
      const over = el.scrollWidth > el.clientWidth + 1;
      setOverflowing(over);
      if (over) el.scrollLeft = el.scrollWidth;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [line.key, line.text]);
  return (
    <span className="think-preview think-ticker" ref={ref} data-overflow={overflowing ? "true" : "false"}>
      <span className="think-ticker-line" key={line.key}>{line.text}</span>
    </span>
  );
}

/** 展开体滚动边缘状态（第 1044 页）：只有「那一侧还有内容没读到」才淡出。
 *  纯函数，判卷与真机都对同一个 DOM 量；1px 容差吃掉亚像素滚动误差。 */
function scrollEdges(el: HTMLDivElement): { top: boolean; bottom: boolean } {
  return { top: el.scrollTop > 1, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 };
}

/** 思考行（live）：可点开 + 计时。判卷钉住的锚（role/aria/think-live/think-elapsed/
 *  默认展开/折叠体）全保留；文案与字形随产品化更新。
 *  view 档位（蓝本 §3.4）：Normal 档默认折叠（思考不进阅读面）；Thinking/Verbose 档默认展开。
 *  **不给 view 时维持旧默认（有正文即展开）**——render-structure 判卷锚依赖该默认。
 *  2026-11-08（第 1042 页，zcode 同形）：运行中不再锁死折叠——互斥锁的病因是流式正文
 *  无限长高顶跳阅读面；展开体限高 240px + 自动跟尾后根因消失。折叠态由 ticker 实时给
 *  「正在想的最后一行」，不再是开头 120 字的陈旧摘要。
 *  2026-11-08（第 1044 页，zcode ReasoningContent 同形）：限高后该补上下滚动边缘渐隐——
 *  贴顶/贴底各自独立，首行与末行都不会被无端吃掉；只在布尔值跨边界时 setState，
 *  滚动过程不重渲染长正文（Stream 那棵大树的纪律）。 */
export function ThinkingLive(props: { seq: number; thinking?: string; running?: boolean; view?: ViewMode; onCopyText?: StreamActions["onCopyText"] }): React.JSX.Element {
  const hasBody = props.thinking !== undefined && props.thinking !== "";
  const defaultOpen = props.view === undefined ? hasBody : props.view !== "normal" && hasBody;
  const running = props.running !== false;
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [edges, setEdges] = useState<{ top: boolean; bottom: boolean }>({ top: false, bottom: false });
  const open = expanded ?? defaultOpen;
  const bodyId = useId();
  useEffect(() => {
    setExpanded(null);
  }, [props.view]);
  // 这里只能量到本次挂载观察到的时间，历史记录没有可靠起止，不能补一个 0s。
  const [elapsed, setElapsed] = useState<number | null>(running ? 0 : null);
  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);
  // 自动跟尾（zcode ReasoningContent 同口径）：流式追加时贴底；用户上滚即停、回底恢复
  // （复用回底钮的 40px 贴底判定）；重新展开时重置为跟尾。
  const textRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  useEffect(() => {
    if (open) followRef.current = true;
  }, [open]);
  useEffect(() => {
    const el = textRef.current;
    if (el === null || !open) return;
    // 跟尾（运行中）与边缘状态同拍落定：先写 scrollTop 再量，否则拿到的是上一帧的边界。
    if (running && followRef.current) el.scrollTop = el.scrollHeight;
    const next = scrollEdges(el);
    setEdges((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
  }, [props.thinking, running, open]);
  const tickerLine = running && !open && hasBody ? lastThinkingLine(props.thinking!) : null;
  return (
    <div
      className={"row think" + (open ? " open" : "")}
      key={`t${props.seq}`}
      data-running={running}
    >
      <button type="button" className="think-toggle think-line" role="button" aria-expanded={open} aria-controls={bodyId}
        aria-label={running ? (open ? "模型思考中，点击折叠" : "模型思考中，点击展开说明") : "查看思考记录"}
        onClick={() => { setExpanded(!open); }}>
        <span className="think-main">
          <span className="chev" aria-hidden="true"><ChevronRight size={10} /></span>
          <BrainCircuit className="think-icon" size={14} aria-hidden="true" />
          <span className="think-label">{running ? "思考中" : "思考记录"}</span>
          {running && <span className="think-live" aria-hidden="true"><CairnLoader /></span>}
          {elapsed !== null && <span className="think-elapsed" role="timer" aria-label={`已思考 ${String(elapsed)} 秒`} title="本次在界面中观察到的时长，不代表完整思考耗时">{elapsed}s</span>}
        </span>
        {!open && hasBody && (tickerLine !== null
          ? <ThinkingTicker line={tickerLine} />
          : <span className="think-preview">{truncateSummary(props.thinking!, 120)}</span>)}
      </button>
      {/* 复制入口挂在行头右侧（2026-10-31）：此前它是思考体里的独占一行，正文被推到它下面 30px，
          展开后先看到一屏空白。现在悬停/聚焦才现身，正文从第一行开始读。 */}
      {props.onCopyText !== undefined && hasBody && (
        <div className="thinking-actions">
          <button className="process-copy" aria-label="复制思考记录" title="复制思考记录" onClick={() => props.onCopyText?.(props.thinking!)}><Copy size={12} /> 复制</button>
        </div>
      )}
      <div id={bodyId} className="think-body" data-open={open ? "true" : "false"} aria-hidden={!open}>
        {/* 边缘状态挂在**不滚动**的父盒上：CSS mask 落在滚动容器本身会随内容坐标走，
            贴底时视口里只看得到遮罩中段（像素对照实测无效）；父盒固定在视口边缘才真的淡出。 */}
        <div className="think-body-inner"
          data-fade-top={edges.top ? "true" : "false"}
          data-fade-bottom={edges.bottom ? "true" : "false"}>
          {props.thinking !== undefined && props.thinking !== "" ? (
            <div className="think-text" ref={textRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                followRef.current = isNearBottom(el);
                const next = scrollEdges(el);
                setEdges((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
              }}><Markdown text={props.thinking} {...(props.onCopyText !== undefined ? { onCopy: props.onCopyText } : {})} /></div>
          ) : (
            <>
              正在思考（可以调档位；这家没吐思考正文时这里就是空的）。
              <span className="off-note">思考与正文分开落事件，不把推理内容混进转录。</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
