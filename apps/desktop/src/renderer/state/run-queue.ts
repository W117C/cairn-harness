import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
// useRunQueue: extracted without changing event or callback behavior.
import { useCallback,useRef } from "react";
import type { AgentEvent,AskPayload,RunAttachmentReference,RunResponse } from "../../../../../src/main/ipc-protocol";
import { parseGoalCommand,type GoalCommand } from "../goal-command";
import { userTextOfRound } from "../projections";
import { continueAfterRun,drainQueue,isSessionEndDistillAsk,shouldHealStaleRun,takeQueued,toSessionQueueEntries,type QueuedSend } from "../send-queue";
import { STR } from "../strings";
import { toast } from "../toast";
import { runKey } from "./session-identity";
import { seedNewSessionThinking } from "./thinking-selection";
import type { ThinkingEffort } from "../../../../../src/providers/capabilities";

interface RunQueueDeps {
  setQueueLocal: (sid: string, list: QueuedSend[]) => void;
  queueWrites: MutableRefObject<Map<string, Promise<unknown>>>;
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
  modeRef: MutableRefObject<"default" | "read-only" | "guided" | "auto">;
  selections: MutableRefObject<Map<string, string | null>>;
  activeId: string | null;
  editCtxRef: MutableRefObject<{ originId: string; originTitle: string; forkId: string; round: number; } | null>;
  setEditCtx: (v: { originId: string; originTitle: string; forkId: string; round: number; } | null) => void;
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
  const { setQueueLocal, queueWrites, setLastError, sendQueue, setStoppedIds, runningSet, lastDeltaAt, runGen, runStartBySession, force, thinkingBySession, pendingThinking, modeRef, selections, activeId, editCtxRef, setEditCtx, askById, setLastNotice, queueSeq, setPendingSend, activeWorkspace, setActiveWorkspace, activate, refreshSessions, setDraftRestore, draftRestoreSeq, compactNow, activeIdRef, eventsRef } = deps;
  const keyOf = (id: string): string => runKey(activeWorkspace, id);
  const setQueueFor = useCallback((sid: string, list: QueuedSend[]) => {
    const key = keyOf(sid);
    setQueueLocal(key, list);
    const prev = queueWrites.current.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => window.agent.queueSet(sid, toSessionQueueEntries(list), activeWorkspace ?? undefined));
    queueWrites.current.set(key, next);
    void next.then(
      (r) => { if (!r.ok) setLastError(`发送队列保存失败：${r.error ?? "未知错误"}`, sid); },
      (err: unknown) => setLastError(`发送队列保存失败：${err instanceof Error ? err.message : String(err)}`, sid),
    ).finally(() => {
      if (queueWrites.current.get(key) === next) queueWrites.current.delete(key);
    });
  }, [setLastError, setQueueLocal]);
  /** 本轮收束后出队：队首出表并返回；空队列 null（调用方停表）。 */
  const takeQueuedHead = useCallback((sid: string): QueuedSend | null => {
    const { head, rest } = takeQueued(sendQueue.current.get(keyOf(sid)) ?? []);
    if (head !== null) setQueueFor(sid, rest);
    return head;
  }, [setQueueFor]);

  /** 一条消息 → 一轮 run；收束后自动派队列下一条（顺序派发唯一实现在 send-queue.drainQueue）。
   *  不重入 send：send 要判 activeId，后台会话的续发必须显式钉住 sid。
   *  本轮失败（ok=false 或抛出）→ 停表：剩余队列留在表里，等用户处理；用户主动打断不算失败。 */
  const runOn = useCallback(async (sid: string, first: { text: string; attachments: RunAttachmentReference[] }) => {
    await drainQueue(first, async (msg) => {
      setStoppedIds((prev) => {
        if (!prev.has(sid)) return prev;
        const fresh = new Set(prev);
        fresh.delete(sid);
        return fresh;
      });
      runningSet.current.add(keyOf(sid));
      lastDeltaAt.current.delete(sid);
      // 代际号（2026-10-18 真机：打断并发送后新 run 在跑、running 却为 false）：旧 run 的
      // finally 会把**新 run**刚置上的旗摘掉——经典“旧清理清掉新状态”。每次起跑领一个号，
      // 清理/停止态写入只在“号还是自己的”时生效。
      const myGen = (runGen.current.get(sid) ?? 0) + 1;
      runGen.current.set(sid, myGen);
      runStartBySession.current.set(sid, Date.now());
      force((n) => n + 1);
      try {
        const thinking = thinkingBySession.current.get(sid);
        const res = (await window.agent.run({
          message: msg.text, mode: modeRef.current, sessionId: sid, model: selections.current.get(sid) ?? undefined,
          ...(thinking !== undefined ? { thinking: thinking as "off" | "low" | "medium" | "high" } : {}),
          ...(msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
        })) as RunResponse & { aborted?: boolean };
        if ((runGen.current.get(sid) ?? 0) === myGen) {
          setStoppedIds((prev) => {
            const want = res.aborted === true;
            if (prev.has(sid) === want) return prev;
            const fresh = new Set(prev);
            if (want) fresh.add(sid); else fresh.delete(sid);
            return fresh;
          });
        }
        const keepGoing = continueAfterRun(res);
        if (!keepGoing) setLastError(res.error ?? "本轮运行失败", sid);
        return keepGoing;
      }
      catch (err) {
        setLastError(`本轮运行失败：${err instanceof Error ? err.message : String(err)}`, sid);
        return false;
      }
      finally {
        if ((runGen.current.get(sid) ?? 0) === myGen) runningSet.current.delete(keyOf(sid));
        // 起点随这一轮一起收掉（收之前先判代际：新 run 已经起跑时不能把它的起点删了）。
        if ((runGen.current.get(sid) ?? 0) === myGen) runStartBySession.current.delete(sid);
        force((n) => n + 1);
      }
    }, () => takeQueuedHead(sid));
  }, [setLastError, takeQueuedHead]);

  const send = useCallback(async (text: string, attachments: RunAttachmentReference[] = []) => {
    const sid = activeId;
    if (sid !== null && editCtxRef.current?.forkId === sid) setEditCtx(null);
    // 运行中发送 = 入队（收束后 runOn 的循环自动派下一条）。判据用 ref 不用渲染态：
    // 收束与点击在同一拍竞争时，runningSet 是唯一真值。
    if (sid !== null && runningSet.current.has(keyOf(sid))) {
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
      setQueueFor(sid, [...(sendQueue.current.get(keyOf(sid)) ?? []), { id: ++queueSeq.current, text, attachments }]);
      return;
    }
    const isNew = sid === null;
    if (isNew) setPendingSend(true);
    let id: string | undefined;
    try {
      const created = await window.agent.createSession(activeWorkspace ?? undefined);
      const newId = created.id;
      // 空屏直接发任务：渲染层 activeWorkspace 还是 null，而主进程已把会话建在它的默认
      // 工作区里。不从回包采纳 ⇒ 文件/终端/diff/回滚整路「工作区未知」，侧栏也不高亮这一行。
      if (activeWorkspace === null) setActiveWorkspace(created.workspace);
      id = newId;
      if (isNew) {
        // 空屏上选的思考档必须落在**这条**新会话上；否则芯片显示「思考 强」、请求里没有 thinking。
        seedNewSessionThinking(newId, pendingThinking, thinkingBySession.current);
        activate(newId);
        refreshSessions();
      }
      const goalCmd = pendingGoal.current;
      if (goalCmd !== null) {
        pendingGoal.current = null;
        const g = await window.agent.setGoal({ sessionId: newId, objective: goalCmd.objective, ...(goalCmd.maxTurns !== undefined ? { maxTurns: goalCmd.maxTurns } : {}), ...(goalCmd.maxUsd !== undefined ? { maxUsd: goalCmd.maxUsd } : {}) });
        if (!g.ok) setLastError(STR.goal.setFail.replace("{reason}", g.error ?? "未知原因"), newId);
      }
      await runOn(newId, { text, attachments });
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
  const sendWithGoal = useCallback((text: string, attachments: RunAttachmentReference[]): void => {
    // /compact 是**命令**，不是消息（2026-10-18 同 /goal 病）：此前斜杠项把字塞进输入框，
    // 发出去只是一条普通消息，从没调用过 compact 通道；菜单里的「压缩历史…」才是真入口。
    if (text.trim() === "/compact") {
      compactNow();
      return;
    }
    const cmd = parseGoalCommand(text);
    if (cmd === null) { void send(text, attachments); return; }
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

  /** 消息操作条「重跑这一轮」（2026-10-17，Claude 式重试）：取该轮用户输入再发一次，追加为新轮。
   *  与「回放」的区别：回放 = fork 新会话 + 只填不发；重跑 = 当前会话原地再来一轮。运行中不动作。 */
  const handleRetryRound = useCallback((round: number) => {
    const sid = activeIdRef.current;
    if (sid === null || runningSet.current.has(keyOf(sid))) return;
    const text = userTextOfRound(eventsRef.current, round);
    if (text === null) { setLastError("重跑失败：找不到该轮的输入原文", sid); return; }
    void send(text);
  }, [send, setLastError]);

  /** 重启恢复：不自动执行，用户显式点「继续发送」才把队首交给同一条 runOn/权限/沙箱链路。
   *  （第十三遍拆出按 sid 版：陈旧旗自愈要按点击时的会话派发，不随 activeId 漂。） */
  const resumeQueueFor = useCallback((sid: string) => {
    if (runningSet.current.has(keyOf(sid))) return;
    const first = takeQueuedHead(sid);
    if (first === null) return;
    void runOn(sid, first).catch((err: unknown) => {
      setLastError(`恢复发送失败：${err instanceof Error ? err.message : String(err)}`, sid);
    });
  }, [runOn, setLastError, takeQueuedHead]);
  const resumeQueue = useCallback(() => {
    const sid = activeIdRef.current;
    if (sid !== null) resumeQueueFor(sid);
  }, [resumeQueueFor]);

  /** 打断/停止的唯一实现（第十三遍·业主实测「排队中·打断并发送，点击没有反应」）：main 答
   *  {ok:false,「会话不在运行」}＝本实例「运行中」是陈旧旗——旧代码 void 掉结果，点了像没点。
   *  现在摘旗重渲染，再照「停止后队列照派」的既有语义把队列续上（对「打断并发送」＝用户按的
   *  正是「这条现在发」；对停止钮＝与正常打断同形）。同拍竞态守卫见 shouldHealStaleRun。 */
  const cancelRunHeal = useCallback((sid: string) => {
    const genAtClick = runGen.current.get(sid) ?? 0;
    void window.agent.runCancel(sid).then((res) => {
      const heal = shouldHealStaleRun({
        cancelOk: res.ok,
        genAtClick,
        genNow: runGen.current.get(sid) ?? 0,
        flagPresent: runningSet.current.has(keyOf(sid)),
      });
      if (!heal) return;
      runningSet.current.delete(keyOf(sid));
      force((n) => n + 1);
      resumeQueueFor(sid); // 无队列 ⇒ 自然 no-op
    }).catch(() => undefined);
  }, [resumeQueueFor]);


  return { setQueueFor, send, sendWithGoal, handleRetryLast, handleRetryRound, resumeQueue, cancelRunHeal };
}
