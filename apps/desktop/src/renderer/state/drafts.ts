// 状态簇·输入与草稿（Phase 2 · 批 2.3）。
//
// 分层契约（见 src/renderer/LAYERING.md）：
//   · 本层**不含 JSX**（没有一行动态标签）；
//   · 本层**不 import components/**（I2）——组件往下长、状态往上长，两条路不许交叉；
//   · 钩子只吐「状态 + 动作」，不吐界面。
//
// 搬移口径：代码**逐行原样**搬过来（判卷钉的是声明行与依赖数组的写法，搬家不改写法）。
import { useCallback, useRef, useState } from "react";
import type { RunAttachmentReference } from "../../../../../src/main/ipc-protocol";
import { readDraftIds } from "../drafts";

/** 钩子需要的外部动作（错误条/提示条住在 App 的会话键控面上，状态簇不自己持一份）。 */
export interface ComposerDraftsDeps {
  setLastError: (message: string, sessionId?: string) => void;
  setLastNotice: (message: string, sessionId?: string) => void;
}

export interface ComposerDraftsState {
  // 空态 pills / 编辑 / 回放共用的「填入输入框」信号：seq 每次递增 ⇒ 连续点同一条建议也能再次填入。
  injectedText: string | undefined;
  injectedTextSeq: number;
  injectText: (text: string) => void;
  setInjectedText: React.Dispatch<React.SetStateAction<string | undefined>>;
  setInjectedTextSeq: React.Dispatch<React.SetStateAction<number>>;
  // 草稿桶搬家通道（`{from, to, seq}`）：Composer's 草稿桶跟着换键。
  draftRemap: { from: string; to: string; seq: number } | undefined;
  draftRemapSeq: React.MutableRefObject<number>;
  setDraftRemap: (v: { from: string; to: string; seq: number } | undefined) => void;
  // 发送失败回滚：Composer 提交即清空输入框，失败时把原文/附件还回去（按会话归属，切走了只存桶）。
  draftRestore: { forSession: string | null; text: string; attachments: RunAttachmentReference[]; seq: number } | undefined;
  draftRestoreSeq: React.MutableRefObject<number>;
  setDraftRestore: (v: { forSession: string | null; text: string; attachments: RunAttachmentReference[]; seq: number } | undefined) => void;
  // 有草稿的会话（2026-10-18）：启动从 localStorage 读一次，之后 Composer 防抖上报；侧栏画铅笔。
  // 键是草稿桶键（draftKeyFor：工作区引用键，首页 null 不记），不是裸会话 id。
  draftIds: Set<string>;
  noteDraft: (draftKey: string | null, has: boolean) => void;
  // 编辑并重发的上下文（2026-10-18）：点「编辑」会立刻建新分支并切换会话，但界面上没有一句话
  // 说明“你现在在新分支里编辑第 N 轮，原会话不动”——静默切换最容易让人以为原会话被改了。
  editCtx: { originId: string; originTitle: string; forkId: string; round: number } | null;
  editCtxRef: React.MutableRefObject<{ originId: string; originTitle: string; forkId: string; round: number } | null>;
  setEditCtx: (v: { originId: string; originTitle: string; forkId: string; round: number } | null) => void;
  // v7 附为上下文（§2.3 路径右键）：附件注入信号（seq 递增触发一次 append；与 injectedText 同式）。
  injectedAttachment: { path: string; kind: "file" | "directory"; seq: number } | undefined;
  attachFromPane: (rel: string, kind: "file" | "directory") => void;
  // v7 元素选择（§3.6 ⌘⇧S）：App 递增信号 → browser 窗格对活动标签发起选择；结果拼文 append 进输入框。
  pickSignal: number;
  setPickSignal: (n: number | ((prev: number) => number)) => void;
  injectedAppend: { text: string; seq: number } | undefined;
  handlePickResult: (r: { selector: string; snippet: string; url: string }) => void;
  // 快捷键开 composer 菜单信号（§3.6 ⌘⇧I/M/E）：seq 单调递增即"开一次"。
  composerMenuSignal: { kind: "perm" | "model" | "effort"; seq: number } | null;
  openComposerMenu: (kind: "perm" | "model" | "effort") => void;
}

export function useComposerDrafts(deps: ComposerDraftsDeps): ComposerDraftsState {
  const { setLastError, setLastNotice } = deps;

  const [injectedText, setInjectedText] = useState<string | undefined>(undefined);
  const [injectedTextSeq, setInjectedTextSeq] = useState(0);
  const injectedSeqRef = useRef(0);
  const injectText = useCallback((text: string) => {
    setInjectedText(text);
    setInjectedTextSeq(++injectedSeqRef.current);
  }, []);
  // 草稿桶搬家通道（`{from, to, seq}`）：Composer's 草稿桶跟着换键。
  // ① 重命名换 id：否则 Composer 在渲染期把字存回旧 id、再读新 id 的空桶；
  // ② 「回到原会话」删掉第 1 轮编辑建的空分支：那份未发出去的稿得跟着用户走
  //    （2026-10-20 独立评审追出，LOW-MEDIUM）——删会话不删草稿 ⇒ 稿子变孤儿。
  const [draftRemap, setDraftRemap] = useState<{ from: string; to: string; seq: number } | undefined>(undefined);
  const draftRemapSeq = useRef(0);
  // 发送失败回滚：Composer 提交即清空输入框，失败时把原文/附件还回去（按会话归属，切走了只存桶）。
  const [draftRestore, setDraftRestore] = useState<{ forSession: string | null; text: string; attachments: RunAttachmentReference[]; seq: number } | undefined>(undefined);
  const draftRestoreSeq = useRef(0);
  // 有草稿的会话（2026-10-18）：启动从 localStorage 读一次，之后 Composer 防抖上报；侧栏画铅笔。
  const [draftIds, setDraftIds] = useState<Set<string>>(() => readDraftIds());
  const noteDraft = useCallback((draftKey: string | null, has: boolean): void => {
    if (draftKey === null) return;
    setDraftIds((prev) => {
      if (prev.has(draftKey) === has) return prev;
      const next = new Set(prev);
      if (has) next.add(draftKey); else next.delete(draftKey);
      return next;
    });
  }, []);
  // 编辑并重发的上下文（2026-10-18）：点「编辑」会立刻建新分支并切换会话，但界面上没有一句话
  // 说明“你现在在新分支里编辑第 N 轮，原会话不动”——静默切换最容易让人以为原会话被改了。
  const [editCtx, setEditCtx] = useState<{ originId: string; originTitle: string; forkId: string; round: number } | null>(null);
  const editCtxRef = useRef(editCtx);
  editCtxRef.current = editCtx;
  // v7 附为上下文（§2.3 路径右键）：附件注入信号（seq 递增触发一次 append；与 injectedText 同式）。
  const [injectedAttachment, setInjectedAttachment] = useState<{ path: string; kind: "file" | "directory"; seq: number } | undefined>(undefined);
  const attachSeqRef = useRef(0);
  const attachFromPane = useCallback((rel: string, kind: "file" | "directory") => {
    void window.agent.workspacePathAction(rel, "abs").then((r) => {
      if (r.ok && r.path !== undefined) {
        attachSeqRef.current += 1;
        setInjectedAttachment({ path: r.path, kind, seq: attachSeqRef.current });
        setLastNotice(`已引用：${rel}（送出时随附件读取）`);
      } else {
        setLastError(`引用失败：${r.error ?? "无法解析工作区路径"}`);
      }
    }, (err: unknown) => {
      setLastError(`引用失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [setLastError, setLastNotice]);
  // v7 元素选择（§3.6 ⌘⇧S）：App 递增信号 → browser 窗格对活动标签发起选择；结果拼文 append 进输入框。
  const [pickSignal, setPickSignal] = useState(0);
  const [injectedAppend, setInjectedAppend] = useState<{ text: string; seq: number } | undefined>(undefined);
  const appendSeqRef = useRef(0);
  const handlePickResult = useCallback((r: { selector: string; snippet: string; url: string }) => {
    appendSeqRef.current += 1;
    const lines = [
      `浏览器中选中的页面元素（${r.url}）：`,
      `选择器：${r.selector}`,
      ...(r.snippet !== "" ? [`HTML 片段：${r.snippet}`] : []),
    ];
    setInjectedAppend({ text: lines.join("\n"), seq: appendSeqRef.current });
    setLastNotice("已把选中元素写入输入框");
  }, [setLastNotice]);
  // 快捷键开 composer 菜单信号（§3.6 ⌘⇧I/M/E）：seq 单调递增即"开一次"。
  const [composerMenuSignal, setComposerMenuSignal] = useState<{ kind: "perm" | "model" | "effort"; seq: number } | null>(null);
  const menuSeqRef = useRef(0);
  const openComposerMenu = useCallback((kind: "perm" | "model" | "effort") => {
    menuSeqRef.current += 1;
    setComposerMenuSignal({ kind, seq: menuSeqRef.current });
  }, []);

  return {
    injectedText,
    injectedTextSeq,
    injectText,
    setInjectedText,
    setInjectedTextSeq,
    draftRemap,
    draftRemapSeq,
    setDraftRemap,
    draftRestore,
    draftRestoreSeq,
    setDraftRestore,
    draftIds,
    noteDraft,
    editCtx,
    editCtxRef,
    setEditCtx,
    injectedAttachment,
    attachFromPane,
    pickSignal,
    setPickSignal,
    injectedAppend,
    handlePickResult,
    composerMenuSignal,
    openComposerMenu,
  };
}
