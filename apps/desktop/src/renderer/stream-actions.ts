import type { StreamRow } from "./projections";
export interface StreamActions {
  /** eventId → 当前生效评分（listFeedback 投影）；缺席 = 未评。 */
  feedback?: ReadonlyMap<number, "up" | "down">;
  feedbackBusy?: (eventId: number) => boolean;
  pinBusy?: (eventId: number) => boolean;
  annotationPending?: (eventId: number) => boolean;
  /** 赞/踩真提交（core submitFeedback 落 sidecar）；rating=null = 撤销。 */
  onFeedback?: (eventId: number, rating: "up" | "down" | null) => void;
  /** 文件级回滚（core revertTurn；确认与结果提示在 App）。 */
  onRevertTurn?: (round: number) => void;
  /** 复制行文本（剪贴板与失败面在 App）。 */
  onCopyText?: (text: string) => Promise<boolean> | void;
  /** 打开用户消息里的附件（2026-10-18）：芯片从纯展示变成可点——点了用系统默认应用打开。 */
  onOpenAttachment?: (path: string) => void;
  /** 分叉（P3-1 操作条）：从 user 这条消息所在轮 fork 出新会话（core forkSession；原会话不动）。 */
  onBranch?: (round: number) => void;
  /** 编辑并重发（2026-10-18）：在前一轮上下文的**新分支**里填入这条消息原文，用户改完再发；
   *  原会话不动。第 1 轮没有前置上下文 ⇒ App 侧新建空会话后填入。 */
  onEditRound?: (round: number, text: string) => void;
  /** 回放（P3-1 操作条，agent 行）：fork 到该轮 + 切到新会话 + 把该轮用户输入注入输入框（不自动发送）。
   *  传事件 id（1-based 行号）——轮号与输入原文由 App 从事件日志投影（roundOfEvent/userTextOfRound）。 */
  onReplay?: (eventId: number) => void;
  /** 朗读（§2.2 操作条 read aloud）：macOS say；speakingEventId 控按钮态。 */
  onSpeak?: (eventId: number, text: string) => void;
  /** 正在朗读的那条（eventId）；缺席/null = 没有在念。 */
  speakingEventId?: number | null;
  /** 轮折叠开合（v7.2）：折叠钮与展开钮共用；缺席 = 不渲染折叠面。 */
  onToggleFold?: (round: number) => void;
  /** 错误行「重试」（brief 六：「错误态：清晰原因 + 重试」）：用最后一轮的输入再跑一轮
   *  （追加为新轮，不改写历史；运行中不摆——App 侧同样以 runningSet 兜底）。 */
  onRetryLast?: () => void;
  /** 是否正在跑（重试按钮的显隐依据之一；缺席按未运行处理）。 */
  running?: boolean;
  /** 打开产物（工具交付物直达）。缺席 = 不渲染产物入口（老调用方与判卷不受影响）。 */
  onOpenArtifact?: (a: { kind: "image" | "html" | "svg" | "text"; path: string; note?: string }) => void;
  /** 重跑该轮（Claude 式重试，2026-10-17）：用这一轮的用户输入再发一次（追加为新轮）。
   *  运行中不渲染——此刻再排一轮语义含糊；App 侧另以 runningSet 兜底。 */
  onRetryRound?: (round: number) => void;
  /** 消息置顶（2026-10-20 · 销 G6 / 规范 §3.11 操作条 pin）：落 sidecar pins.jsonl。
   *  缺席 = 不渲染 pin 钮（老调用方与判卷不受影响）。 */
  onPin?: (eventId: number, pinned: boolean) => void;
  /** 当前已置顶的锚点（eventId 集合）；缺席 = 无置顶。渲染即挂载（eager），靠 CSS 显隐。 */
  pinnedEventIds?: ReadonlySet<number>;
}
