import type { PermissionMode } from "../../../../../src/main/ipc-protocol";
import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
// useRunQueue: extracted without changing event or callback behavior.
import { useCallback,useMemo,useRef } from "react";
import type { AgentEvent,AskPayload,RunAttachmentReference,RunResponse } from "../../../../../src/main/ipc-protocol";
import { parseGoalCommand,type GoalCommand } from "../goal-command";
import { userTextOfRound } from "../projections";
import { continueAfterRun,drainQueue,isSessionEndDistillAsk,shouldHealStaleRun,steerAccepted,steerRouteOf,type QueuedSend } from "../send-queue";
import { STR } from "../strings";
import { toast } from "../toast";
import { runKey } from "./session-identity";
import { seedNewSessionThinking } from "./thinking-selection";
import { saveSessionPrefs } from "./session-prefs";
import type { ThinkingEffort } from "../../../../../src/providers/capabilities";
import { createQueuePersistence } from "./queue-persistence";
import type { SessionEditContext } from "../sessions-view";

/** 预览/后台会话的发送结果：调用方据此给回执，不靠猜运行态。 */
export interface SendOutcome {
  outcome: "steered" | "queued" | "started" | "failed";
  error?: string;
}

interface RunQueueDeps {
  setQueueLocal: (sid: string, list: QueuedSend[]) => void;
  queueWrites: MutableRefObject<Map<string, Promise<unknown>>>;
  queueDirty: MutableRefObject<Set<string>>;
  setLastError: (message: string, sessionId?: string | undefined) => void;
  sendQueue: MutableRefObject<Map<string, QueuedSend[]>>;
  setStoppedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  runningSet: MutableRefObject<Set<string>>;
  lastDeltaAt: MutableRefObject<Map<string, number>>;
  runGen: MutableRefObject<Map<string, number>>;
  runStartBySession: MutableRefObject<Map<string, number>>;
  force: Dispatch<SetStateAction<number>>;
  thinkingBySession: MutableRefObject<Map<string, string>>;
  /** 空屏上选的思考档：新会话落成时用它填 thinkingBySession（旧实现直接丢）。 */
  pendingThinking: ThinkingEffort;
  modeRef: MutableRefObject<PermissionMode>;
  selections: MutableRefObject<Map<string, string | null>>;
  activeId: string | null;
  editCtxRef: MutableRefObject<SessionEditContext | null>;
  setEditCtx: (v: SessionEditContext | null) => void;
  askById: MutableRefObject<Map<string, AskPayload>>;
  setLastNotice: (message: string, sessionId?: string | undefined) => void;
  queueSeq: MutableRefObject<number>;
  setPendingSend: Dispatch<SetStateAction<boolean>>;
  activeWorkspace: string | null;
  setActiveWorkspace: (workspace: string) => void;
  activate: (id: string | null) => void;
  refreshSessions: () => Promise<void>;
  setDraftRestore: (v: { forSession: string | null; text: string; attachments: RunAttachmentReference[]; seq: number; } | undefined) => void;
  draftRestoreSeq: MutableRefObject<number>;
  compactNow: () => void;
  activeIdRef: MutableRefObject<string | null>;
  eventsRef: MutableRefObject<AgentEvent[]>;
}

export function useRunQueue(deps: RunQueueDeps) {
  const { setQueueLocal, queueWrites, queueDirty, setLastError, sendQueue, setStoppedIds, runningSet, lastDeltaAt, runGen, runStartBySession, force, thinkingBySession, pendingThinking, modeRef, selections, activeId, editCtxRef, setEditCtx, askById, setLastNotice, queueSeq, setPendingSend, activeWorkspace, setActiveWorkspace, activate, refreshSessions, setDraftRestore, draftRestoreSeq, compactNow, activeIdRef, eventsRef } = deps;
  // 默认目标只跟随当前渲染；异步发送与后台恢复显式携带工作区，不反写后来切换的窗口上下文。
  const workspaceRef = useRef<string | null>(activeWorkspace);
  workspaceRef.current = activeWorkspace;
  const keyOf = (id: string): string => runKey(workspaceRef.current, id);
  const persistence = useMemo(() => createQueuePersistence({
    sendQueue, queueWrites, queueDirty, setQueueLocal, setLastError, changed: () => force((n) => n + 1),
  }), [sendQueue, queueWrites, queueDirty, setQueueLocal, setLastError, force]);
  const setQueueFor = useCallback((sid: string, list: QueuedSend[], workspace?: string | null) =>
    persistence.setQueueFor(sid, list, workspace === undefined ? workspaceRef.current : workspace), [persistence]);
  const takeQueuedHead = persistence.takeQueuedHead;
  const draining = useRef(new Set<string>());

  /** 一条消息 → 一轮 run；收束后自动派队列下一条（顺序派发唯一实现在 send-queue.drainQueue）。
   *  不重入 send：send 要判 activeId，后台会话的续发必须显式钉住 sid。
   *  本轮失败（ok=false 或抛出）→ 停表：剩余队列留在表里，等用户处理；用户主动打断不算失败。 */
  const runOn = useCallback(async (sid: string, first: { text: string; attachments: RunAttachmentReference[] } | null, workspace?: string | null): Promise<(RunResponse & { aborted?: boolean }) | null> => {
    // 预览/后台会话可属于另一工作区：这一轮的键按目标工作区算，**不改**主会话的 workspaceRef。
    // 新建会话用 createSession 返回的工作区；主路径也显式携带自己的目标。
    const runWs = workspace === undefined ? workspaceRef.current : workspace;
    const key = runKey(runWs, sid);
    if (draining.current.has(key)) return { ok: false, accepted: false, error: "session already running or being deleted" };
    draining.current.add(key);
    force((n) => n + 1);
    try {
      // null 是显式恢复入口；预留整条 drain 后再等待持久化，连续点击不能重复取队首。
      const initial = first ?? await takeQueuedHead(sid, runWs, true);
      if (initial === null) return null;
      let firstResponse: (RunResponse & { aborted?: boolean }) | null = null;
      await drainQueue(initial, async (msg) => {
        setStoppedIds((prev) => {
          if (!prev.has(sid)) return prev;
          const fresh = new Set(prev);
          fresh.delete(sid);
          return fresh;
        });
        runningSet.current.add(key);
        lastDeltaAt.current.delete(sid);
        // 代际号（2026-10-18 真机：打断并发送后新 run 在跑、running 却为 false）：旧 run 的
        // finally 会把**新 run**刚置上的旗摘掉——经典“旧清理清掉新状态”。每次起跑领一个号，
        // 清理/停止态写入只在“号还是自己的”时生效。
        const myGen = (runGen.current.get(sid) ?? 0) + 1;
        runGen.current.set(sid, myGen);
        runStartBySession.current.set(sid, Date.now());
        force((n) => n + 1);
        try {
          const thinking = thinkingBySession.current.get(key);
          const res = (await window.agent.run({
            message: msg.text, mode: modeRef.current, sessionId: sid, model: selections.current.get(key) ?? undefined,
            ...(runWs !== null ? { workspace: runWs } : {}),
            ...(thinking !== undefined ? { thinking: thinking as "off" | "low" | "medium" | "high" } : {}),
            ...(msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
          })) as RunResponse & { aborted?: boolean };
          if (res.ok === false && res.accepted === false && "id" in msg && typeof msg.id === "number") {
            // 主进程明确没有接收用户轮才恢复；执行失败已经落了用户消息，重入队会重复派活。
            setQueueFor(sid, [{ id: msg.id, text: msg.text, attachments: msg.attachments }, ...(sendQueue.current.get(key) ?? [])], runWs);
          }
          if (firstResponse === null) firstResponse = res;
          if ((runGen.current.get(sid) ?? 0) === myGen) {
            setStoppedIds((prev) => {
              const want = res.aborted === true;
              if (prev.has(sid) === want) return prev;
              const fresh = new Set(prev);
              if (want) fresh.add(sid); else fresh.delete(sid);
              return fresh;
            });
          }
          const keepGoing = res.ok === false && res.accepted === false ? false : continueAfterRun(res);
          if (!keepGoing) setLastError(res.error ?? "本轮运行失败", sid);
          return keepGoing;
        }
        catch (err) {
          setLastError(`本轮运行失败：${err instanceof Error ? err.message : String(err)}`, sid);
          return false;
        }
        finally {
          if ((runGen.current.get(sid) ?? 0) === myGen) runningSet.current.delete(key);
          // 起点随这一轮一起收掉（收之前先判代际：新 run 已经起跑时不能把它的起点删了）。
          if ((runGen.current.get(sid) ?? 0) === myGen) runStartBySession.current.delete(sid);
          force((n) => n + 1);
        }
      }, () => takeQueuedHead(sid, runWs));
      return firstResponse;
    } finally {
      draining.current.delete(key); force((n) => n + 1);
    }
  }, [setLastError, setQueueFor, takeQueuedHead]);

  /** 任意会话的发送入口（预览窗格/后台会话）：与主发送共用插话、队列与 runOn 管線。
   *  `running` 由调用方按目标会话的真实事件态传入；缺省才读本实例 runningSet。
   *  返回值只描述**这一句话**的去向，不代替流里的成败（run 返回 ok:false 已经送达，不回滚）。 */
  const sendTo = useCallback(async (
    sid: string,
    workspace: string | null,
    text: string,
    attachments: RunAttachmentReference[] = [],
    options: { forceQueue?: boolean; running?: boolean } = {},
  ): Promise<SendOutcome> => {
    const runWs = workspace ?? workspaceRef.current;
    const key = runKey(runWs, sid);
    const running = (options.running ?? runningSet.current.has(key)) || draining.current.has(key);
    if (running) {
      if (steerRouteOf({ sessionId: sid, running: true, forceQueue: options.forceQueue === true, attachmentCount: attachments.length }) === "steer") {
        const steered = await window.agent.runSteer(sid, text, runWs ?? undefined).catch(() => ({ ok: false as const }));
        if (steerAccepted(steered)) return { outcome: "steered" };
      }
      setQueueFor(sid, [...(sendQueue.current.get(key) ?? []), { id: ++queueSeq.current, text, attachments }], runWs);
      return { outcome: "queued" };
    }
    try {
      const res = await runOn(sid, { text, attachments }, runWs);
      // 预览的事件态可能比主进程晚一拍：主进程说「已在运行」时这句话还没送达，
      // 与主发送同一条不丢字语义——先试插话，再入队。
      if (res !== null && res.ok === false && /already running|已在运行|正在运行/u.test(res.error ?? "")) {
        const steered = await window.agent.runSteer(sid, text, runWs ?? undefined).catch(() => ({ ok: false as const }));
        if (steerAccepted(steered)) return { outcome: "steered" };
        setQueueFor(sid, [...(sendQueue.current.get(key) ?? []), { id: ++queueSeq.current, text, attachments }], runWs);
        return { outcome: "queued" };
      }
      if (res !== null && !res.ok) return { outcome: "failed", error: res.error ?? "运行被拒绝" };
      return { outcome: "started" };
    } catch (err) {
      return { outcome: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  }, [queueSeq, runOn, setQueueFor]);

  /** `forceQueue`（第 9 点）：只入队、不插话。运行中那颗「加入队列」钮点下去必须真的排队——
   *  按钮写着「加入队列」却把话插进当前轮，就是按钮在说谎。 */
  const send = useCallback(async (text: string, attachments: RunAttachmentReference[] = [], forceQueue = false) => {
    const sid = activeId;
    // 会话与工作区是一对目标；插话 await 期间切窗口上下文也不能改写消息归属。
    const sendWorkspace = activeWorkspace;
    const sendKey = sid === null ? null : runKey(sendWorkspace, sid);
    const editCtx = editCtxRef.current;
    if (editCtx?.forkId === sid && editCtx.workspace === sendWorkspace) setEditCtx(null);
    // 运行中发送 = 入队（收束后 runOn 的循环自动派下一条）。判据用 ref 不用渲染态：
    // 收束与点击在同一拍竞争时，runningSet 是唯一真值。
    if (sid !== null && (runningSet.current.has(sendKey!) || draining.current.has(sendKey!))) {
      // 对话优先跳沉（owner 实证 2026-10-15「记忆沉淀挡住正常对话了」）：本轮收尾的自动沉淀
      // 正卡在合并审批时，用户按下发送 = 「接着聊」的最高信号——立即拒掉该审批让 run 收束、
      // 队列开派；否则这条消息会排在记忆审批后面（distill 在 runAgent 尾部，run 不 settle
      // 队列不动）。拒是 fire-and-forget + 随后同拍同步入队：若 await 审批收束后再入队，
      // run 可能先 settle、drain 读到空队列收摊，这条消息就孤在表里再没人派。
      const pendingAsk = askById.current.get(sid);
      if (pendingAsk !== undefined && isSessionEndDistillAsk(pendingAsk)) {
        void window.agent.decide(pendingAsk.askId, false).catch(() => undefined);
        setLastNotice("已跳过本轮全局记忆写入（你在继续对话；下次收尾再试）", sid);
      }
      // ---- 第 9 点·轮中插话：先试着**送进正在跑的那一轮** ----
      // 顺序很重要：先入队再快速失败没有意义（用户会看到「等待发送」却其实已经送达）。
      // 判据以主进程的应答为准（`ok:true` = 这一轮真收到了），而不是渲染层自己的 runningSet：
      // runningSet 可能比主进程早一瞬收束（或晚一拍），那一瞬的差正好决定这句话是插话还是下一条任务。
      // 主进程说「不在运行」⇒ 落回下面那条入队，**一个字都不丢**。
      //
      // 纯文本才走插话：附件（图片/文件引用）那条路要过引用校验与附件装载，属下一次 run 的入口，
      // 半路塞进当前轮会把校验绕开。带附件的消息照旧入队。
      // 三条路的分岔在纯函数里（`steerRouteOf`），这里只执行：判据不依赖 DOM/运行态那一层，
      // 才能被判卷钉死（第 681 页记的冒烟失败的根因就是那一层在离屏界面里立不住）。
      if (steerRouteOf({ sessionId: sid, running: true, forceQueue, attachmentCount: attachments.length }) === "steer") {
        const steered = await window.agent.runSteer(sid, text, sendWorkspace ?? undefined).catch(() => ({ ok: false as const }));
        if (steerAccepted(steered)) {
          // 回执必须说清是「已插话」还是「已排队」：两种后果差一整轮的工作。
          setLastNotice(STR.composer.steerSent, sid);
          return;
        }
      }
      setQueueFor(sid, [...(sendQueue.current.get(sendKey!) ?? []), { id: ++queueSeq.current, text, attachments }], sendWorkspace);
      return;
    }
    const isNew = sid === null;
    if (isNew) setPendingSend(true);
    let id = sid;
    try {
      let newId = sid;
      let runWorkspace = sendWorkspace;
      // 续聊、重试和重跑都追加到当前会话；只有首页首发才创建会话。
      if (newId === null) {
        const created = await window.agent.createSession(activeWorkspace ?? undefined);
        newId = created.id;
        id = newId;
        runWorkspace = created.workspace ?? activeWorkspace;
        // 空屏首发采纳主进程实际使用的默认工作区。
        if (activeWorkspace === null) setActiveWorkspace(created.workspace);
        // 空屏上选的思考档必须落在**这条**新会话上；否则芯片显示「思考 强」、请求里没有 thinking。
        seedNewSessionThinking(newId, pendingThinking, thinkingBySession.current, runWorkspace);
        if (pendingThinking !== "off") {
          try { await saveSessionPrefs(newId, { thinking: pendingThinking }, runWorkspace ?? undefined); }
          catch (error) { setLastError(`会话思考档保存失败：${error instanceof Error ? error.message : String(error)}`, newId); }
        }
        activate(newId);
        refreshSessions();
      }
      const goalCmd = pendingGoal.current;
      if (goalCmd !== null) {
        pendingGoal.current = null;
        const g = await window.agent.setGoal({ sessionId: newId, objective: goalCmd.objective, ...(goalCmd.maxTurns !== undefined ? { maxTurns: goalCmd.maxTurns } : {}), ...(goalCmd.maxUsd !== undefined ? { maxUsd: goalCmd.maxUsd } : {}) });
        if (!g.ok) setLastError(STR.goal.setFail.replace("{reason}", g.error ?? "未知原因"), newId);
      }
      // 这一轮显式携带来源工作区；迟到的发送不能重写用户后来切到的窗口上下文。
      setPendingSend(false);
      const firstRes = await runOn(newId, { text, attachments }, runWorkspace);
      // 主进程明确没把这一轮收进日志（accepted === false，例如项目外附件审批被拒/超时）
      // ⇒ Composer 提交时已清空，这里必须把原文与附件还给输入框；队列那条路由 runOn
      // 自己按 id 回队，首条消息没有 id，只能在这里补。`accepted` 缺席 = 未知，不回滚
      // （旧主进程/协议兜底时消息可能已经送达，回滚会变成重复发送）。
      if (firstRes !== null && firstRes.ok === false && firstRes.accepted === false) {
        setDraftRestore({ forSession: newId, text, attachments, seq: ++draftRestoreSeq.current });
      }
    }
    catch (err) {
      setLastError(`本轮运行失败：${err instanceof Error ? err.message : String(err)}`, id ?? "");
      // 这条消息没能派出去：把原文与附件还给输入框（Composer 提交时已清空）。
      // 只回滚「抛出」这一支——run 返回 {ok:false} 时消息已经送达，回滚会造成重复发送。
      setDraftRestore({ forSession: id ?? null, text, attachments, seq: ++draftRestoreSeq.current });
    }
    finally {
      pendingGoal.current = null; // 建会话失败时别把旧目标挂到下一次 send 上
      setPendingSend(false);
      force((n) => n + 1);
    }
  }, [activeId, activeWorkspace, activate, refreshSessions, runOn, setQueueFor, setLastError, setLastNotice, pendingThinking]);
  /** /goal <目标>（2026-10-18）：先把目标写进会话（setGoal），再用目标原文起第一轮。
   *  此前斜杠项只往输入框塞字，发出去就是一条普通消息，目标从未被设过。 */
  // 首页发 /goal 时还没有会话可挂目标：先记下来，等 send 建好会话、拿到 id 再 setGoal。
  const pendingGoal = useRef<GoalCommand | null>(null);
  const sendWithGoal = useCallback((text: string, attachments: RunAttachmentReference[], forceQueue = false): void => {
    // /compact 是**命令**，不是消息（2026-10-18 同 /goal 病）：此前斜杠项把字塞进输入框，
    // 发出去只是一条普通消息，从没调用过 compact 通道；菜单里的「压缩历史…」才是真入口。
    if (text.trim() === "/compact") {
      compactNow();
      return;
    }
    const cmd = parseGoalCommand(text);
    if (cmd === null) { void send(text, attachments, forceQueue); return; }
    const sid = activeIdRef.current;
    if (cmd.objective === "") { toast.error(STR.goal.emptyObjective); return; }
    if (sid === null) {
      // 首页：先让 send 建会话，建好后再落目标（见 send 里的 pendingGoal 分支）。
      pendingGoal.current = cmd;
      void send(cmd.objective, attachments);
      return;
    }
    void window.agent.setGoal({ sessionId: sid, objective: cmd.objective, ...(cmd.maxTurns !== undefined ? { maxTurns: cmd.maxTurns } : {}), ...(cmd.maxUsd !== undefined ? { maxUsd: cmd.maxUsd } : {}) }).then((r) => {
      if (!r.ok) { setLastError(STR.goal.setFail.replace("{reason}", r.error ?? "未知原因"), sid); return; }
      void send(cmd.objective, attachments);
    }, (err: unknown) => {
      setLastError(STR.goal.setFail.replace("{reason}", err instanceof Error ? err.message : String(err)), sid);
    });
  }, [send, setLastError, toast]);

  /** 错误行「重试」（brief 六）：拿最后一轮的用户输入再跑一轮——**追加为新轮，不改写历史**
   *  （本仓事件日志只追加；改写要另开覆盖通道，不在本轮范围）。运行中不动作：Stream 已按
   *  running 隐按钮，这里再兜一次，防键盘/程序化触发双发。 */
  const handleRetryLast = useCallback(() => {
    const sid = activeIdRef.current;
    if (sid === null || runningSet.current.has(keyOf(sid))) return;
    let rounds = 0;
    for (const e of eventsRef.current) if (e.type === "user_message") rounds += 1;
    const text = rounds === 0 ? null : userTextOfRound(eventsRef.current, rounds);
    if (text === null) { setLastError("重试失败：找不到上一轮的输入原文", sid); return; }
    void send(text);
  }, [send, setLastError]);

  /** 重启恢复：不自动执行，用户显式点「继续发送」才把队首交给同一条 runOn/权限/沙箱链路。
   *  （第十三遍拆出按 sid 版：陈旧旗自愈要按点击时的会话派发，不随 activeId 漂。） */
  const resumeQueueFor = useCallback((sid: string, workspace?: string | null) => {
    const runWs = workspace === undefined ? workspaceRef.current : workspace;
    if (runningSet.current.has(runKey(runWs, sid))) return;
    void runOn(sid, null, runWs).catch((err: unknown) => {
      setLastError(`恢复发送失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [runOn, setLastError]);
  const resumeQueue = useCallback(() => {
    const sid = activeIdRef.current;
    if (sid !== null) resumeQueueFor(sid);
  }, [resumeQueueFor]);

  /** 打断/停止的唯一实现（第十三遍·业主实测「排队中·打断并发送，点击没有反应」）：main 答
   *  {ok:false,「会话不在运行」}＝本实例「运行中」是陈旧旗——旧代码 void 掉结果，点了像没点。
   *  现在摘旗重渲染，再照「停止后队列照派」的既有语义把队列续上（对「打断并发送」＝用户按的
   *  正是「这条现在发」；对停止钮＝与正常打断同形）。同拍竞态守卫见 shouldHealStaleRun。 */
  const cancelRunHeal = useCallback((sid: string, workspace?: string | null) => {
    const runWs = workspace === undefined ? workspaceRef.current : workspace;
    const key = runKey(runWs, sid);
    const genAtClick = runGen.current.get(sid) ?? 0;
    void window.agent.runCancel(sid, runWs ?? undefined).then((res) => {
      if (!res.ok && res.code !== undefined) {
        setLastError(res.error ?? "停止失败：会话目标校验未通过", sid);
        return;
      }
      const heal = shouldHealStaleRun({
        cancelOk: res.ok,
        genAtClick,
        genNow: runGen.current.get(sid) ?? 0,
        flagPresent: runningSet.current.has(key),
      });
      if (!heal) return;
      runningSet.current.delete(key);
      force((n) => n + 1);
      resumeQueueFor(sid, runWs); // 无队列 ⇒ 自然 no-op
    }).catch((err: unknown) => {
      // 拒绝（通道异常/窗口销毁/main 抛错）与 resolve-{ok:false} 同口径：停止失败要说出来，
      // 不续队列、不派发（第 1082 页；同文件 resumeQueueFor 的 reject 早已接 setLastError）。
      setLastError(`停止失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [resumeQueueFor, setLastError]);


  const activeKey = activeId === null ? null : runKey(activeWorkspace, activeId);
  const queueSaving = activeKey !== null && queueWrites.current.has(activeKey);
  const queueSaveFailed = activeKey !== null && queueDirty.current.has(activeKey) && !queueSaving;
  return { queueSaving, queueSaveFailed, setQueueFor, send, sendTo, sendWithGoal, handleRetryLast, resumeQueue, resumeQueueFor, cancelRunHeal };
}
