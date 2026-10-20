import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface Session {
  id: string;
  title: string;
  sub: string;
  kind: "idle" | "run" | "wait" | "bad";
  group: string;
}

export interface StreamItem {
  kind: "user" | "assistant" | "tool" | "delivery";
  text: string;
  tool?: string;
  ok?: boolean;
  detail?: string;
  /** 模型 reasoning 正文（只有真拿到才填，缺席不摆空壳） */
  thinking?: string;
}

export interface QueuedSend {
  id: number;
  text: string;
}

const SESSIONS: Session[] = [
  { id: "s1", title: "把第 404 页那 5 根锚点杀掉", sub: "10-06", kind: "idle", group: "deepseek harness" },
  { id: "s2", title: "给 verify 尺补 cause 归属", sub: "正在跑 · 2 分钟", kind: "run", group: "deepseek harness" },
  { id: "s3", title: "路由开关进 CLI 面", sub: "等你拍板 · 41 秒", kind: "wait", group: "deepseek harness" },
  { id: "s4", title: "清理孤儿 worktree", sub: "验证红 · 2 条断言", kind: "bad", group: "deepseek harness" },
  { id: "s5", title: "这段报错是什么意思", sub: "昨天 22:15", kind: "idle", group: "最近" },
  { id: "s6", title: "帮我把周报口吻改软一点", sub: "10-06", kind: "idle", group: "最近" },
];

const INITIAL_STREAM: StreamItem[] = [
  { kind: "user", text: "给 verify 的每条红加上原因归属，环境类的别混进真失败里。" },
  {
    kind: "assistant",
    text: "先读 src/agent/verify.ts 的分类，再动投影面。",
    thinking:
      "每条红都要带原因归属：python3 缺、门没装、树不干净都不算真失败。归因函数得放在 verify.ts 里，" +
      "投影面才读得到；判卷要喂构造语料，真仓数据分辨不出这个语义差。",
  },
  { kind: "tool", tool: "read_file", text: "src/agent/verify.ts", ok: true, detail: "486 行 · 180ms" },
  { kind: "tool", tool: "edit_file", text: "VerifyCause 扩到 8 值", ok: true, detail: "＋18 −4" },
  { kind: "tool", tool: "run_shell", text: "pnpm test", ok: false, detail: "2 条断言红 · exit 1" },
  { kind: "assistant", text: "第 3 次验证通过了，145 条全绿。" },
  {
    kind: "delivery",
    text: "本轮改了 3 个文件 · ＋41 −7｜验证通过 · 第 3/3 次｜未验证：无｜下一步：改动已验证，可进入审查",
  },
];

/** 应用页状态与动作：发送、排队、打断、会话切换、右栏开关、设置导航。 */
export function useAppState() {
  const [activeId, setActiveId] = useState("s2");
  const [streams, setStreams] = useState<Record<string, StreamItem[]>>({ s2: INITIAL_STREAM });
  const [queues, setQueues] = useState<Record<string, QueuedSend[]>>({});
  const [running, setRunning] = useState<Set<string>>(new Set(["s2"]));
  const [railOpen, setRailOpen] = useState(true);
  const [rpOpen, setRpOpen] = useState(true);
  const [rpTab, setRpTab] = useState("审查");
  const [settingsSection, setSettingsSection] = useState("常规");
  const [mode, setMode] = useState("默认");
  const [planGate, setPlanGate] = useState(false);
  const [fullAccess, setFullAccess] = useState(false);
  const [autoVerify, setAutoVerify] = useState(true);
  const [actionFusion, setActionFusion] = useState(false);
  const [language, setLanguage] = useState("中文");
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const seq = useRef(0);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 设置项持久化：预览里用 localStorage，避免刷新即丢。
  useEffect(() => {
    const raw = localStorage.getItem("cairn-preview-settings");
    if (raw === null) return;
    try {
      const saved = JSON.parse(raw) as Partial<{
        mode: string;
        planGate: boolean;
        fullAccess: boolean;
        autoVerify: boolean;
        actionFusion: boolean;
        language: string;
      }>;
      if (typeof saved.mode === "string") setMode(saved.mode);
      if (typeof saved.planGate === "boolean") setPlanGate(saved.planGate);
      if (typeof saved.fullAccess === "boolean") setFullAccess(saved.fullAccess);
      if (typeof saved.autoVerify === "boolean") setAutoVerify(saved.autoVerify);
      if (typeof saved.actionFusion === "boolean") setActionFusion(saved.actionFusion);
      if (typeof saved.language === "string") setLanguage(saved.language);
    } catch {
      // 坏值不拦启动，沿用默认
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "cairn-preview-settings",
      JSON.stringify({ mode, planGate, fullAccess, autoVerify, actionFusion, language }),
    );
  }, [mode, planGate, fullAccess, autoVerify, actionFusion, language]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const notify = useCallback((text: string) => {
    setToast(text);
    const t = setTimeout(() => setToast((cur) => (cur === text ? null : cur)), 1800);
    return () => clearTimeout(t);
  }, []);

  const items = useMemo(() => streams[activeId] ?? [], [streams, activeId]);
  const queue = useMemo(() => queues[activeId] ?? [], [queues, activeId]);
  const isRunning = running.has(activeId);

  const append = useCallback(
    (sid: string, item: StreamItem) => {
      setStreams((prev) => ({ ...prev, [sid]: [...(prev[sid] ?? []), item] }));
    },
    [],
  );

  const setQueueFor = useCallback((sid: string, next: QueuedSend[]) => {
    setQueues((prev) => ({ ...prev, [sid]: next }));
  }, []);

  /** 跑一轮：先追加用户消息，跑完后追加回复与交付摘要。 */
  const runTurn = useCallback(
    (sid: string, text: string) => {
      append(sid, { kind: "user", text });
      setRunning((prev) => {
        const next = new Set(prev);
        next.add(sid);
        return next;
      });
      const timer = setTimeout(() => {
        timers.current.delete(sid);
        append(sid, { kind: "assistant", text: `收到：${text}（预览里不会真的调用模型）` });
        append(sid, {
          kind: "delivery",
          text: "本轮改了 0 个文件｜验证：未运行｜未验证：0 个｜下一步：运行验证后再审查",
        });
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(sid);
          return next;
        });
        // 收束后自动派队列里的下一条
        setQueues((prev) => {
          const rest = prev[sid] ?? [];
          if (rest.length === 0) return prev;
          const [head, ...tail] = rest;
          setTimeout(() => runTurn(sid, head.text), 0);
          return { ...prev, [sid]: tail };
        });
      }, 1400);
      timers.current.set(sid, timer);
    },
    [append],
  );

  /** 发送：运行中入队，空闲直接跑。 */
  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "") return false;
      if (isRunning) {
        seq.current += 1;
        setQueueFor(activeId, [...queue, { id: seq.current, text: trimmed }]);
        notify("已加入队列，本轮结束后自动发送");
        return true;
      }
      runTurn(activeId, trimmed);
      return true;
    },
    [activeId, isRunning, notify, queue, runTurn, setQueueFor],
  );

  /** 打断：停当前轮，并把队首立刻派出去。 */
  const interrupt = useCallback(
    (index?: number) => {
      const timer = timers.current.get(activeId);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.current.delete(activeId);
      }
      const nextQueue = [...queue];
      if (typeof index === "number" && index >= 0 && index < nextQueue.length) {
        const [picked] = nextQueue.splice(index, 1);
        nextQueue.unshift(picked);
      }
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(activeId);
        return next;
      });
      const head = nextQueue.shift();
      setQueueFor(activeId, nextQueue);
      if (head !== undefined) {
        notify("已打断，优先发送队首");
        runTurn(activeId, head.text);
      } else {
        notify("已打断当前运行");
      }
    },
    [activeId, notify, queue, runTurn, setQueueFor],
  );

  const removeQueued = useCallback(
    (index: number) => {
      const next = queue.filter((_, i) => i !== index);
      setQueueFor(activeId, next);
      notify("已移出队列");
    },
    [activeId, notify, queue, setQueueFor],
  );

  return {
    sessions: SESSIONS,
    activeId,
    setActiveId,
    items,
    queue,
    isRunning,
    send,
    interrupt,
    removeQueued,
    railOpen,
    setRailOpen,
    rpOpen,
    setRpOpen,
    rpTab,
    setRpTab,
    settingsSection,
    setSettingsSection,
    mode,
    setMode,
    planGate,
    setPlanGate,
    fullAccess,
    setFullAccess,
    autoVerify,
    setAutoVerify,
    actionFusion,
    setActionFusion,
    language,
    setLanguage,
    toast,
    notify,
    settingsOpen,
    setSettingsOpen,
  };
}
