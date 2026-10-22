// C-18 ComposerCard（P2 重做：＋菜单四入口 / 权限色点 / 模型+思考合并弹窗 / 附件 chips / ⌘V 粘贴 / @ 走模糊搜索）。
// 沿革（行为语义按代际保留）：
//  · 2026-10-15（第二十遍业主裁「上下文环 → 带上百分数」）：用量环照 v3-lite .ring——环心带上下文百分数、
//    环钉在发送/中断钮左侧；未知窗口/本会话未跑=「—」（不假报 0，title 分口径说清）。
//  · v2.17 运行中可沟通：运行中不禁输入——回车=入队、⌘/Ctrl+↩=入队并打断；权限档运行中禁用；
//    模型档位菜单内锁定而思考档可调（C-21）。
//  · 第二十四遍业主裁 A②「Tab 想下一条」：建议只在按 Tab 时出手；空框空闲右侧一枚 Tab 键帽。
// P2 契约（plan 2026-10-16）：
//  · ＋菜单四项（上传文件…/添加文件夹…/粘贴截图（⌘V）/引用最近文件）——**零路径手输**（旧手输入口清退）；
//  · 附件 chip = 图标 + 文件名 + 大小（拿不到不显）+ 项目外小盾牌（tooltip 说审批）；点击 = 项目内 open、
//    项目外 revealInFinder（路径只进 tooltip）；删除钮保留；
//  · ⌘V 粘贴：clipboardData.files 非空才 preventDefault（文本粘贴不劫持）→ pathForFile 或 saveTempFile；
//  · @ 引用走 workspaceSearch（debounce 120ms、扁平列表带面包屑、目录=定范围再搜、选中文件=清 token 落 chip）；
//  · 拖拽分流（复用 classifyDrop）：项目内文件/目录=附件（无盾牌）、项目外文件=附件+盾牌、
//    项目外目录=提示（不自动加为项目，避免误触）；
//  · 发送钮 title「发送（⏎）」、停止钮 title「停止（⌘.）」；⌘. 在本组件 keydown 通道挂通（统一表在 P3-3）。
// 文案全出处 STR（本文件零裸中文）；副作用全在 App（send/cancel/setSettings/compact）。
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../toast";
import { relInWorkspace } from "../workspace-rel";
import type { PermissionMode, ProviderInfo, RunAttachmentReference, SuggestNextResult } from "../../../../../src/main/ipc-protocol";
import type { RunPhase } from "../projections";
import { ArrowUp, ChevronDown, ChevronRight, Clock, FileText, Folder, Image as ImageIcon, Loader2, Plus, Puzzle, Shield, ShieldAlert, X } from "lucide-react";
import { classifyDrop } from "../sessions-view";
import { formatTokens } from "./format-tokens";
import { ModelPicker, THINKING_LEVELS } from "./ModelPicker";
import { MODE_LABEL, ModeDot, PermissionMenu } from "./PermissionMenu";
import { Popover, usePopoverDismiss, useMenuKeyboard } from "./Popover";
import { mentionBreadcrumb, parseMentionQuery, replaceMentionToken } from "../mention";
import { STR } from "../strings";
import { slashItems, type SlashSkill } from "../slash";
import { DRAFTS_KEY, HOME_DRAFT_KEY } from "../drafts";

/** 用量环几何（v3-lite .ring 同比例：28px 钮、环径 23、环心 9.5px 数字）：
 *  r=11.5 ⇒ 2πr≈72.26；strokeDashoffset 按百分比折算弧长。 */
const USAGE_RING_R = 11.5;
const USAGE_RING_C = 2 * Math.PI * USAGE_RING_R;

/** @ 模糊搜索的 debounce（P2-4：输入停顿 120ms 才发通道查询）。 */
const MENTION_DEBOUNCE_MS = 120;

/** 拖放路径（蓝本 §3.1）：走 preload 的 webUtils 桥（pathForFile）；桥缺席（旧 preload）返回
 *  null——不造假路径（宁可不加引用，也不添一条主进程必拒的伪路径）。 */
function filePathOf(file: File): string | null {
  const api = window.agent as unknown as { pathForFile?: (f: File) => string };
  try {
    const p = api.pathForFile?.(file);
    return p !== undefined && p !== "" ? p : null;
  } catch {
    return null;
  }
}

/** 加入队列钮的显隐判据（纯函数，判卷锚）：运行中且**有话说**才出现——
 *  空输入下只留打断钮，不摆一枚禁用的灰钟（v7.1 业主裁；旧形态是常驻 + disabled）。 */
export function showQueueButton(running: boolean, canSend: boolean): boolean {
  return running && canSend;
}

/** 附件 chip 图标分类（纯函数，判卷锚）：图片族按扩展名认，其余文件兜底（目录由 kind 决定）。 */
export function fileIconKind(name: string): "image" | "file" {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  return ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "svg", "avif"].includes(ext) ? "image" : "file";
}

/** 附件小字大小（拿不到不显；B/KB/MB 人话刻度——纯函数）。 */
export function formatSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return STR.composer.dash;
  if (n < 1024) return String(n);
  if (n < 1024 * 1024) return `${String(Math.round(n / 102.4) / 10)} KB`;
  return `${String(Math.round(n / 1024 / 102.4) / 10)} MB`;
}

/** 渲染层附件条目：RunAttachmentReference + 展示字段（size 拿不到不显；outside = 项目外挂盾牌）。
 *  发送前经 stripRenderFields 剥回 RunAttachmentReference 形状——主进程协议面不动。 */
interface AttachmentItem extends RunAttachmentReference {
  size?: number;
  outside?: boolean;
}

/** 发送前剥离渲染字段（判卷锚：onSend 仍收 RunAttachmentReference 形状）。 */
export function stripRenderFields(list: readonly AttachmentItem[]): RunAttachmentReference[] {
  return list.map((a) => ({ path: a.path, kind: a.kind, explicit: a.explicit }));
}

const baseNameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

// 草稿持久化（2026-10-18）：localStorage 在渲染层已有先例（侧栏宽度/浏览器白名单）。
// 只存文本草稿；附件不落盘（路径可能失效，不能让下次启动带着一堆已删除的文件）。
let storedDraftsCache: Map<string, string> | null = null;

function storedDrafts(): Map<string, string> {
  if (storedDraftsCache !== null) return storedDraftsCache;
  storedDraftsCache = new Map();
  if (typeof window === "undefined") return storedDraftsCache;
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY);
    const obj: unknown = raw === null ? null : JSON.parse(raw);
    if (obj !== null && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === "string") storedDraftsCache.set(k, v);
      }
    }
  } catch { /* 坏数据当没有 */ }
  return storedDraftsCache;
}

/** 附件 chip 的图标位（2026-10-18）：图片附件走主进程取 40px 缩略图（data URL）；
 *  失败/非图片退回原图标——缩略图是识别加速，不是必需面，静默降级。 */
function AttachIcon(props: { path: string; kind: "file" | "directory" }): React.JSX.Element {
  const isImage = props.kind === "file" && fileIconKind(props.path) === "image";
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    void window.agent.attachmentThumb(props.path).then((r) => {
      if (alive && r.ok && r.dataUrl !== undefined) setThumb(r.dataUrl);
    }, () => undefined);
    return () => { alive = false; };
  }, [props.path, isImage]);
  if (props.kind === "directory") return <Folder size={11} />;
  if (thumb !== null) return <img className="ac-thumb" src={thumb} alt="" />;
  return fileIconKind(props.path) === "image" ? <ImageIcon size={11} /> : <FileText size={11} />;
}

export function Composer(props: {
  disabled?: boolean;
  /** 禁用原因（2026-10-18）：占位文案必须与真实锁因一致——门未决不能写成「正在创建会话」。
   *  缺省（旧调用面）沿用 disabled+running 的旧推断。 */
  disabledReason?: "gate" | "queue" | "creating";
  mode: PermissionMode;
  running: boolean;
  stopped: boolean;
  activeId: string | null;
  providerInfo: ProviderInfo | null;
  pickerValue: string | null;
  usage: { inputTokens: number; outputTokens: number; usageCount: number; cacheReadTokens: number; lastInputTokens: number };
  phaseLabel: string;
  /** 运行相位（App 投影）：状态条的数据源。 */
  phase: RunPhase;
  /** 本轮运行秒数（App 秒表）。 */
  elapsedSec: number;
  /** 主会话累计 tool_call 步数（meter「共 N 步」）。 */
  steps: number;
  /** 本轮（最后一个 user_message 之后）tool_call 步数——运行状态条用；缺省视为 0（旧调用面不必全改）。 */
  runSteps?: number;
  /** 所选模型的上下文窗口（算水位用；未知 = 不显那一格）。 */
  ctxWindow?: number;
  /** 当前工作区绝对路径（@ 搜索范围 / 项目内外判定 / 项目内文件「点开」）——未选项目 = null/缺省。 */
  workspacePath?: string | null;
  /** 本会话已引用文件（最近在前）：＋菜单「引用最近文件」子菜单数据面（App 内存级维护）。 */
  recentRefs?: readonly string[];
  /** 新引用一条文件（App 记录进本会话历史；目录不算）。 */
  onReferenceAdded?: (path: string) => void;
  /** EmptyState pill 填入的文案（C-24：填入不发送）。App 用 key 重置触发。 */
  injectedText?: string;
  /** 与 injectedText 配对：seq 递增即触发一次（同一段文案连点两次也要重新填入）。 */
  injectedTextSeq?: number;
  /** 会话重命名换 id：把草稿/附件桶从旧 id 迁到新 id。 */
  draftRemap?: { from: string; to: string; seq: number };
  /** 发送失败回滚：把原文与附件还给对应会话的输入框（用户已切走则只存桶，切回可见）。 */
  restoreDraft?: { forSession: string | null; text: string; attachments: readonly RunAttachmentReference[]; seq: number };
  /** 已发提示历史（2026-10-18）：打开旧会话时从投影行回填；本实例发过的会覆盖本地桶。 */
  promptHistory?: readonly string[];
  /** v7 附件注入（§2.3 路径右键「附为上下文」）：seq 递增触发一次 append；与 injectedText 同式。 */
  injectedAttachment?: { path: string; kind: "file" | "directory"; seq: number };
  /** v7 文本追加注入（元素选择结果等）：seq 递增触发一次 append 到草稿尾（不覆盖——与覆盖式 injectedText 分工）。 */
  injectedAppend?: { text: string; seq: number };
  onSend: (text: string, attachments: RunAttachmentReference[]) => void;
  onCancel: () => void;
  onModeChange: (mode: PermissionMode) => void;
  onModelChange: (registryId: string | null) => void;
  /** 当前思考档位（缺省 off）；透传给 ModelPicker（原型单芯片形态）。 */
  thinking?: string;
  onThinkingChange?: (level: string) => void;
  /** 模型菜单「管理模型」/ key 提示行的去处。 */
  onOpenSettings?: () => void;
  /** 本会话是否已显式选过模型（触发条上的小圆点）。 */
  modelSessionOverride?: boolean;
  /** 已配 key 的 provider 集合（ModelPicker 据此只显示有 key 可调的模型；不给 = 不过滤）。 */
  configuredProviders?: ReadonlySet<string>;
  /** 当前工作区的 loose skills（斜杠菜单；App 经 agent:list-skills 取，切项目刷新）。 */
  skills?: readonly SlashSkill[];
  /** 系统目录选择（附件「添加文件夹…」用；缺省不给 = 不显示该入口）。 */
  onPickDirectory?: () => Promise<string | null>;
  /** v8 系统文件选择（附件「上传文件…」用；多选，取消 ⇒ null）；缺省不给 = 不显示该入口。 */
  onPickFiles?: () => Promise<string[] | null>;
  onCompact: () => void;
  /** 快捷键开菜单信号（蓝本 §3.6 ⌘⇧I/M/E）：seq 递增开一次；
   *  perm = 权限档菜单；model / effort 都开单芯片菜单（合并形态：思考档就在模型菜单里）。 */
  menuSignal?: { kind: "perm" | "model" | "effort"; seq: number } | null;
  /** v9「Tab 想下一条」（业主 2026-10-16 裁 A②）：空输入框按 Tab 触发——App 侧拼上下文摘录并
   *  走 agent:suggestNext 单发模型调用；结果只填不发、不覆盖已敲的字；失败上屏分类 hint。
   *  缺省不给 = 不摆键帽、Tab 无色（旧消费者零行为不变）。 */
  onSuggestNext?: () => Promise<SuggestNextResult>;
  /** 草稿有无（2026-10-18）：给侧栏画“有草稿”标记；id=null 表示首页。 */
  onDraftPresence?: (sessionId: string | null, hasDraft: boolean) => void;
}) {
  const [text, setText] = useState("");
  // 附件引用（RunRequest.attachments）：chip 列表 + ＋弹层；发送后清空。
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  // 每会话草稿（2026-10-18 真机抓到的串稿）：Composer 常驻不随会话重挂，旧实现切会话时
  // 把 A 的草稿原样带到 B（还会把 B 的草稿写回 A）。按 activeId 分桶：切走存、切回取；
  // 发送时删键（否则发完再切回又把它捞回来）。home 用常量键。
  const draftKey = props.activeId ?? HOME_DRAFT_KEY;
  const draftsRef = useRef<Map<string, string>>(storedDrafts());
  // 附件 chip 与草稿同病（切会话会带着别人选的附件去发）：同一把键分桶。
  const attachByKey = useRef(new Map<string, AttachmentItem[]>());
  // 已发提示历史（2026-10-18）：↑ 取上一条、↓ 往回走；只在空输入框/正在翻历史时接管方向键，
  // 不抢多行草稿里的光标移动。按会话分桶（与草稿同一把键）。
  const historyRef = useRef(new Map<string, string[]>());
  const histIndexRef = useRef(-1);
  const draftKeyRef = useRef(draftKey);
  if (draftKeyRef.current !== draftKey) {
    draftsRef.current.set(draftKeyRef.current, text); // 渲染期调整（guard 后 setState 同组件合法）：先于 injectedText 效果
    attachByKey.current.set(draftKeyRef.current, attachments);
    draftKeyRef.current = draftKey;
    setText(draftsRef.current.get(draftKey) ?? "");
    setAttachments(attachByKey.current.get(draftKey) ?? []);
  }
  // 旧会话历史回填：本地桶还没有这个会话时，用投影行填一次（之后以本地发送栈为准）。
  useEffect(() => {
    const h = props.promptHistory;
    if (h === undefined || h.length === 0 || historyRef.current.has(draftKey)) return;
    historyRef.current.set(draftKey, [...h].slice(0, 50));
  }, [draftKey, props.promptHistory]);

  // 切会话收浮层（2026-10-18 真机：@ 菜单会悬在空输入框上跨会话不关）：mention/附件/权限/
  // 最近文件菜单都属于「上一段对话的现场」，切走即关；悬着的 mention 防抖也作废，免得回填到新会话。
  // 「想下一条」也是模型调用：切走即作废在飞结果，否则 A 的建议会填进 B 的输入框。
  const suggestSeq = useRef(0);
  useEffect(() => {
    setMention(null);
    setMenu("none");
    setRecentOpen(false);
    setMenuDismissed(null);
    setSuggestNote(null);
    setSuggesting(false);
    suggestSeq.current += 1;
    histIndexRef.current = -1;
    if (mentionTimer.current !== null) { window.clearTimeout(mentionTimer.current); mentionTimer.current = null; }
    mentionSeq.current += 1;
  }, [draftKey]);

  // 首次挂载：把上次退出时留下的当前会话草稿读回来（之后靠切会话/发送的正常流程）。
  useEffect(() => {
    const saved = draftsRef.current.get(draftKey);
    if (saved !== undefined && saved !== "") setText((cur) => (cur === "" ? saved : cur));
    // 只在挂载时读一次；draftKey 的变化由上面的换桶逻辑负责。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 草稿落盘：防抖 300ms；切会话/发送也会触发（text 变化），写的是整张桶表（≤ 几十个会话）。
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        // 当前会话的字还在 text 里（切走时才写回桶），所以快照要显式补上/删掉当前键。
        const snap: Record<string, string> = Object.fromEntries(draftsRef.current);
        if (text !== "") snap[draftKey] = text;
        else delete snap[draftKey];
        window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(snap));
        props.onDraftPresence?.(props.activeId ?? null, text.trim() !== "");
      } catch { /* 存不下则本会话内生效 */ }
    }, 300);
    return () => window.clearTimeout(t);
  }, [text, draftKey]);
  // pill 填入：injectedText 变化时覆盖草稿并聚焦（不直接发送——C-24 裁定）。
  useEffect(() => { autoResize(); }, [draftKey]);
  const lastInjected = useRef<string | undefined>(undefined);
  const lastInjectedSeq = useRef(0);
  useEffect(() => {
    if (props.injectedText === undefined) return;
    const seq = props.injectedTextSeq ?? 0;
    const seqChanged = seq !== 0 && seq !== lastInjectedSeq.current;
    const textChanged = props.injectedText !== lastInjected.current;
    if (!seqChanged && !textChanged) return;
    lastInjectedSeq.current = seq;
    lastInjected.current = props.injectedText;
    setText(props.injectedText);
    taRef.current?.focus();
  }, [props.injectedText, props.injectedTextSeq]);
  // 重命名换 id：渲染期已把字/附件存回旧桶并读了新桶（空），这里把旧桶搬到新键并回填。
  const lastRemap = useRef(0);
  useEffect(() => {
    const r = props.draftRemap;
    if (r === undefined || r.seq === lastRemap.current) return;
    lastRemap.current = r.seq;
    const moved = draftsRef.current.get(r.from);
    if (moved !== undefined && !draftsRef.current.has(r.to)) draftsRef.current.set(r.to, moved);
    draftsRef.current.delete(r.from);
    const movedAttach = attachByKey.current.get(r.from);
    if (movedAttach !== undefined && !attachByKey.current.has(r.to)) attachByKey.current.set(r.to, movedAttach);
    attachByKey.current.delete(r.from);
    if (draftKeyRef.current === r.to && moved !== undefined) setText((cur) => (cur === "" ? moved : cur));
    if (draftKeyRef.current === r.to && movedAttach !== undefined) {
      setAttachments((cur) => (cur.length === 0 ? movedAttach : cur));
    }
  }, [props.draftRemap]);
  // 发送失败回滚：当前正在看这个会话 ⇒ 还回输入框；已切走 ⇒ 只存桶，切回时照常读回。
  // 用户已经重新敲了字则不覆盖（原文仍在桶里，不会被抹掉）。
  const lastRestore = useRef(0);
  useEffect(() => {
    const r = props.restoreDraft;
    if (r === undefined || r.seq === lastRestore.current) return;
    lastRestore.current = r.seq;
    const key = r.forSession ?? HOME_DRAFT_KEY;
    if (key !== draftKeyRef.current) {
      if (r.text !== "") draftsRef.current.set(key, r.text);
      if (r.attachments.length > 0) attachByKey.current.set(key, [...r.attachments]);
      return;
    }
    setText((cur) => (cur === "" ? r.text : cur));
    if (r.attachments.length > 0) setAttachments((cur) => (cur.length === 0 ? [...r.attachments] : cur));
    taRef.current?.focus();
  }, [props.restoreDraft]);
  const [menu, setMenu] = useState<"none" | "perm" | "meter" | "attach">("none");
  // v7 附件注入（路径右键「附为上下文」）：seq 变化 append 一次（同一路径已在列表则不加）。
  const lastInjectedAttachment = useRef(0);
  // 附件/权限两个菜单的外点与 Esc 关闭（2026-10-17 真机实证：菜单开着按 Esc 不关，点外面也不关——
  // Composer 只 import 了 Popover 基座，漏了 usePopoverDismiss；模型菜单有、这两个没有）。
  const attachWrapRef = useRef<HTMLDivElement | null>(null);
  const permWrapRef = useRef<HTMLDivElement | null>(null);
  // 用量环的明细浮层（2026-10-19 独立评审追出）：此前只有 attach/perm 两个菜单接了
  // usePopoverDismiss，用量浮层两个手势都不认 ⇒ 点开后按 Esc 不关、点外面也不关，
  // 它一直钉在输入框上方盖着内容，用户只能再点一次环、或点里面的「压缩历史…」、或切会话。
  // 每一个别的浮层（附件/权限/模型/芯片/mention/slash）都两个手势都关，这一支独自关不掉
  // 读起来就是坏控件。
  const meterWrapRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => { setMenu("none"); }, []);
  usePopoverDismiss(menu === "attach", closeMenu, attachWrapRef);
  usePopoverDismiss(menu === "perm", closeMenu, permWrapRef);
  usePopoverDismiss(menu === "meter", closeMenu, meterWrapRef);
  // 键盘导航（2026-10-18）：两个自绘菜单支持 ↓/↑ / Home / End，焦点在触发钮上时 ↓ 也能开菜单；
  // 此前只有 Tab 能进菜单，与模型菜单/命令面板的手感不一致。
  const setAttachOpen = useCallback((open: boolean) => { setMenu(open ? "attach" : "none"); }, []);
  const setPermOpen = useCallback((open: boolean) => { setMenu(open ? "perm" : "none"); }, []);
  const attachKeys = useMenuKeyboard(menu === "attach", setAttachOpen, attachWrapRef);
  const permKeys = useMenuKeyboard(menu === "perm", setPermOpen, permWrapRef);
  useEffect(() => {
    const a = props.injectedAttachment;
    if (a === undefined || a.seq === lastInjectedAttachment.current) return;
    lastInjectedAttachment.current = a.seq;
    setAttachments((prev) => (prev.some((x) => x.path === a.path) ? prev : [...prev, { path: a.path, kind: a.kind, explicit: true }]));
    if (a.kind === "file") props.onReferenceAdded?.(a.path);
  }, [props.injectedAttachment]);
  // v7 文本追加注入（元素选择）：seq 变化 append 一次到草稿尾（不覆盖已写的字）；聚焦待编辑。
  const lastInjectedAppend = useRef(0);
  useEffect(() => {
    const a = props.injectedAppend;
    if (a === undefined || a.seq === lastInjectedAppend.current) return;
    lastInjectedAppend.current = a.seq;
    setText((prev) => (prev.trim() === "" ? a.text : `${prev}\n${a.text}`));
    requestAnimationFrame(() => { taRef.current?.focus(); });
  }, [props.injectedAppend]);
  // 拖放引用（蓝本 §3.1）：高亮态 + 全局 drop 拦截在 App（防拖出窗口导致整窗导航）。
  const [dragging, setDragging] = useState(false);
  const wsPath = props.workspacePath ?? null;
  // 与历史附件芯片同一口径（2026-10-18）：macOS /tmp 与 /private/tmp 是同一处，裸前缀会误判。
  const inWorkspace = (p: string): boolean => relInWorkspace(wsPath, p) !== null;
  const addAttachment = (item: AttachmentItem): void => {
    setAttachments((prev) => (prev.some((a) => a.path === item.path) ? prev : [...prev, item]));
    if (item.kind === "file") props.onReferenceAdded?.(item.path);
  };
  // C-37 SlashMenu：输入以 `/` 开头（无空格）时出现；内置 /compact 与 /goal。
  // Esc 关闭（2026-10-18）：此前斜杠菜单根本没有 Esc 路径；mention 只在“已有命中”时处理，
  // 加载中/零命中的 Esc 落到空处。dismissed 按菜单记，文本一变就复位（继续打字会重新打开）。
  const [menuDismissed, setMenuDismissed] = useState<"slash" | "mention" | null>(null);
  // 斜杠菜单的键盘选中（2026-10-18）：此前只能鼠标点；↑↓/⏎ 是命令面板的肌肉记忆。
  const [slashActive, setSlashActive] = useState(0);
  useEffect(() => { setMenuDismissed(null); }, [text]);
  const slashQuery = text.startsWith("/") && !text.includes(" ") ? text.slice(1).toLowerCase() : null;
  const SLASH_ITEMS = slashItems([
    { invoke: "/compact", desc: STR.composer.slashCompact },
    { invoke: "/goal", desc: STR.composer.slashGoal },
  ], props.skills ?? []);
  const slashHits = slashQuery === null || menuDismissed === "slash" ? [] : SLASH_ITEMS.filter((s) => s.invoke.slice(1).startsWith(slashQuery));
  useEffect(() => { setSlashActive(0); }, [slashQuery]);
  const chooseSlash = (item: { invoke: string; desc: string }): void => {
    setText(`${item.invoke} `);
    requestAnimationFrame(() => { taRef.current?.focus(); autoResize(); });
  };
  // @引用（P2-4）：触发段 → debounce 120ms → workspaceSearch 扁平模糊搜索；目录 = 定范围再搜；
  // 选中文件 = 清 @段 落附件 chip。逐层下钻的旧语义（mentionTarget 族）随改薄下架。
  const [mention, setMention] = useState<{
    start: number;
    query: string;
    hits: { path: string; kind: "file" | "directory" }[] | null;
    note?: string;
    truncated?: boolean;
    active: number;
  } | null>(null);
  const mentionTimer = useRef<number | null>(null);
  const mentionSeq = useRef(0);
  // 浮层的外部收口（2026-10-18）：点卡片外面关菜单；Esc 在焦点已移出输入框时也能关。
  const cardRef = useRef<HTMLDivElement | null>(null);
  const mentionVisible = mention !== null && menuDismissed !== "mention";
  const mentionList = mention === null || mention.hits === null ? [] : mention.hits.slice(0, 12);
  // 外部点击 / 焦点在外时的 Esc：菜单开着才挂监听。
  // 2026-10-18 修：此前「卡片内点击一律不关」把模型/权限/附件按钮也豁免了——斜杠菜单开着再点
  // 模型菜单，两个弹层同屏叠放（真机 `slash-menu.show` 与 `mp-pop` 同时在场）。现在只豁免
  // ①菜单自身（点选要走自己的 click）、②输入区（继续打字，菜单按文本变化收口）；
  // 卡片内其它控件 = 用户去了别处，先收菜单。
  useEffect(() => {
    const slashOpen = slashHits.length > 0;
    if (!slashOpen && !mentionVisible) return;
    const dismiss = (): void => {
      if (slashOpen) setMenuDismissed("slash");
      if (mentionVisible) { setMention(null); setMenuDismissed("mention"); }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      dismiss();
    };
    const onPointer = (e: PointerEvent): void => {
      const t = e.target;
      if (t instanceof Element && t.closest(".slash-menu, .mention-menu, textarea") !== null) return;
      dismiss();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [slashHits.length, mentionVisible]);
  const refreshMention = (value: string, caret: number): void => {
    if (mentionTimer.current !== null) {
      window.clearTimeout(mentionTimer.current);
      mentionTimer.current = null;
    }
    const parsed = parseMentionQuery(value, caret);
    if (parsed === null) {
      setMention(null);
      return;
    }
    // 没有项目时不再静默（placeholder 明说 @ 能引用文件，按了却毫无反应是死路）：
    // 摆一条菜单说明「先选项目」，用户知道下一步该点哪儿。
    if (wsPath === null) {
      setMention({ start: parsed.start, query: parsed.query, hits: [], note: STR.composer.mentionNoWorkspace, active: 0 });
      return;
    }
    // 只敲了 @ 还没敲字：不缩成「没反应」，摆一行「输入文件名开始搜索」（空查询不发搜索请求）。
    if (parsed.query === "") {
      setMention({ start: parsed.start, query: "", hits: [], note: STR.composer.mentionTypeHint, active: 0 });
      return;
    }
    const seq = ++mentionSeq.current;
    const { start, query } = parsed;
    setMention({ start, query, hits: null, active: 0 });
    mentionTimer.current = window.setTimeout(() => {
      mentionTimer.current = null;
      void window.agent.workspaceSearch(wsPath, query).then((r) => {
        if (mentionSeq.current !== seq) return;
        setMention((cur) => {
          if (cur === null || cur.start !== start || cur.query !== query) return cur;
          if (!r.ok) return { ...cur, hits: [], note: STR.composer.mentionSearchFail.replace("{reason}", r.error) };
          return { ...cur, hits: r.hits, active: 0, ...(r.truncated ? { truncated: true, note: STR.composer.mentionTruncated } : {}) };
        });
      }, (err: unknown) => {
        if (mentionSeq.current !== seq) return;
        const brief = err instanceof Error ? err.message : String(err);
        setMention((cur) => (cur !== null && cur.start === start ? { ...cur, hits: [], note: STR.composer.mentionSearchFail.replace("{reason}", brief) } : cur));
      });
    }, MENTION_DEBOUNCE_MS);
  };
  const chooseMention = (hit: { path: string; kind: "file" | "directory" }): void => {
    if (mention === null) return;
    const caretNow = taRef.current?.selectionStart ?? text.length;
    if (hit.kind === "directory") {
      // 目录 = 定范围：token 变 @目录/，随即在该范围再搜。
      const value = replaceMentionToken(text, mention.start, caretNow, `@${hit.path}/`);
      setText(value);
      setMention(null);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta !== null) { ta.focus(); ta.setSelectionRange(value.length, value.length); }
        refreshMention(value, value.length);
      });
      return;
    }
    // 文件 = 引用：清 @段（chip 是可视化真相），解析绝对路径后落附件 chip。
    const value = replaceMentionToken(text, mention.start, caretNow, "");
    setText(value);
    setMention(null);
    void window.agent.workspacePathAction(hit.path, "abs").then((r) => {
      if (r.ok && r.path !== undefined) {
        addAttachment({ path: r.path, kind: "file", explicit: true, outside: !inWorkspace(r.path) });
      }
      // 解析失败：不动文本以外的东西——run 前主进程还会复核一次（不静默吞输入）。
    }, () => undefined);
    requestAnimationFrame(() => { taRef.current?.focus(); autoResize(); });
  };
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // IME 组字守卫（C-27）：拼音组字期间 Enter 不发送（中文输入必需）。
  const composing = useRef(false);
  const disabled = props.disabled === true;
  const canSend = !disabled && text.trim() !== "";
  // 想下一条（第二十四遍）：建议不再常驻——空框空闲时只摆 Tab 键帽（发现性）；按 Tab 才出手。
  const suggestArmed = props.onSuggestNext !== undefined && !disabled && !props.running && text === "";
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  // ＋菜单「引用最近文件」子菜单开合（内联展开，不套第二层弹层）。
  const [recentOpen, setRecentOpen] = useState(false);
  // 快捷键开菜单信号（蓝本 §3.6 ⌘⇧I/M/E）：perm → 权限档；model/effort → 单芯片菜单（透传 openSeq）。
  const lastMenuSignal = useRef(0);
  const [pickerOpenSeq, setPickerOpenSeq] = useState(0);
  // 打开落点（2026-10-18）：⌘⇧I 与 ⌘⇧E 都开同一个单芯片菜单，但承诺不同——
  // I 是「找模型」（聚焦搜索框），E 是「拧思考档」（滚到并聚焦强度分段）。
  const [pickerFocus, setPickerFocus] = useState<"model" | "effort">("model");
  useEffect(() => {
    const sig = props.menuSignal;
    if (sig === undefined || sig === null || sig.seq === lastMenuSignal.current) return;
    lastMenuSignal.current = sig.seq;
    if (disabled) return;
    if (sig.kind === "perm") { setMenu("perm"); setPickerOpenSeq(0); }
    else {
      setPickerFocus(sig.kind === "effort" ? "effort" : "model");
      setMenu("none");
      setPickerOpenSeq(sig.seq);
    }
  }, [props.menuSignal, disabled]);
  const autoResize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    // 上限读样式层（蓝本 §2.2：输入框约 8 行后滚动）——单一源在 CSS，JS 不另写一个数。
    const cap = Number.parseFloat(getComputedStyle(ta).maxHeight);
    ta.style.height = `${String(Number.isFinite(cap) ? Math.min(ta.scrollHeight, cap) : ta.scrollHeight)}px`;
  };
  // v2.17 运行中可沟通：运行中 onSend 走 App 的按会话队列（回车=入队）；
  // interrupt=true（⌘/Ctrl+Enter）时先入队再打断本轮——收束在轮界，队列随即派发（App 侧语义）。
  const submit = (opts?: { interrupt?: boolean }) => {
    if (!canSend) return;
    props.onSend(text.trim(), stripRenderFields(attachments));
    const sent = text.trim();
    if (sent !== "") {
      const hist = historyRef.current.get(draftKeyRef.current) ?? [];
      historyRef.current.set(draftKeyRef.current, [sent, ...hist].slice(0, 50));
    }
    histIndexRef.current = -1;
    if (opts?.interrupt === true && props.running) props.onCancel();
    setText("");
    draftsRef.current.delete(draftKeyRef.current);
    attachByKey.current.delete(draftKeyRef.current);
    setAttachments([]);
    setMention(null);
    setSuggestNote(null);
    setRecentOpen(false);
    requestAnimationFrame(autoResize);
  };
  // ⌘V 粘贴素材（P2-3）：File 有 pathForFile（Finder 复制）→ 直落附件；否则（截图 blob）→ saveTempFile。
  // 失败 fail-visible（提示行）；文本粘贴不劫持（clipboardData.files 为空直接放行）。
  const attachFromFiles = (files: readonly File[]): void => {
    for (const f of files) {
      const p = filePathOf(f);
      if (p !== null) {
        addAttachment({ path: p, kind: "file", explicit: true, outside: !inWorkspace(p), ...(Number.isFinite(f.size) ? { size: f.size } : {}) });
        continue;
      }
      void f.arrayBuffer()
        .then((buf) => window.agent.saveTempFile({ name: f.name !== "" ? f.name : "paste.png", bytes: new Uint8Array(buf) }))
        .then((r) => {
          if (r.ok && r.path !== undefined) {
            addAttachment({ path: r.path, kind: "file", explicit: true, outside: !inWorkspace(r.path), ...(Number.isFinite(f.size) && f.size > 0 ? { size: f.size } : {}) });
          } else {
            setSuggestNote(STR.composer.pasteFail.replace("{reason}", r.error ?? STR.composer.pasteEmpty));
          }
        })
        .catch((err: unknown) => {
          setSuggestNote(STR.composer.pasteFail.replace("{reason}", err instanceof Error ? err.message : String(err)));
        });
    }
  };
  // ＋菜单「粘贴截图（⌘V）」：读系统剪贴板图像 → 临时文件 → 附件。空/被拒 = 提示，不静默。
  const pasteFromClipboard = (): void => {
    const clip: Clipboard | undefined = navigator.clipboard;
    if (clip === undefined || typeof clip.read !== "function") {
      toast(STR.composer.pasteEmpty);
      return;
    }
    void clip.read().then(async (items) => {
      const blobs: Blob[] = [];
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type === undefined) continue;
        blobs.push(await it.getType(type));
      }
      if (blobs.length === 0) { toast(STR.composer.pasteEmpty); return; }
      for (const blob of blobs) {
        const name = blob.type === "image/jpeg" ? "paste.jpg" : blob.type === "image/png" ? "paste.png" : "paste.bin";
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const r = await window.agent.saveTempFile({ name, bytes });
        if (r.ok && r.path !== undefined) {
          addAttachment({ path: r.path, kind: "file", explicit: true, outside: !inWorkspace(r.path), ...(blob.size > 0 ? { size: blob.size } : {}) });
        } else {
          toast.error(STR.composer.pasteFail.replace("{reason}", r.error ?? STR.composer.pasteEmpty));
        }
      }
    }).catch(() => { toast(STR.composer.pasteEmpty); }); // 无内容 / 拒授权同口径（fail-visible）
  };
  const modeInfo = MODE_LABEL[props.mode];
  const thinkingSupported = (() => {
    const spec = props.providerInfo?.models.find((m) => m.id === props.pickerValue);
    return spec?.capability.thinking.supported === true;
  })();
  // 批 4：状态条整行已拆——轮/步/tok/缓存的读数并入环 tooltip（hover 明细）与用量弹层；
  // 环心仍是上下文水位百分数。只报拿得到的数据，未知分开说清。
  const usage = props.usage;
  const totalTok = usage.inputTokens + usage.outputTokens;
  const cachePct = usage.cacheReadTokens > 0 && usage.inputTokens > 0
    ? Math.min(99, Math.round((usage.cacheReadTokens / (usage.cacheReadTokens + usage.inputTokens)) * 100))
    : null;
  const ctxPct = props.ctxWindow !== undefined && props.ctxWindow > 0 && usage.lastInputTokens > 0
    ? Math.min(100, Math.round((usage.lastInputTokens / props.ctxWindow) * 100))
    : null;
  // 环心读数口径（v3-lite：环心=上下文水位百分数；拿不到读数就「—」，且两种「未知」分开说清——
  // 窗口没声明 vs 本会话还没跑过，故障排查时是两回事）。
  const ctxWindowDeclared = props.ctxWindow !== undefined && props.ctxWindow > 0;
  const ringFacts: string[] = [];
  if (totalTok > 0) ringFacts.push(STR.composer.ringTokens.replace("{n}", formatTokens(totalTok)));
  if (usage.usageCount > 0) ringFacts.push(STR.composer.ringRounds.replace("{n}", String(usage.usageCount)));
  if (props.steps > 0) ringFacts.push(STR.composer.ringSteps.replace("{n}", String(props.steps)));
  if (cachePct !== null) ringFacts.push(STR.composer.ringCache.replace("{n}", String(cachePct)));
  const ringTail = ringFacts.length > 0 ? ` · ${ringFacts.join(" · ")}` : "";
  const ringTitle = ctxPct !== null
    ? STR.composer.ringTitlePct.replace("{pct}", String(ctxPct)).replace("{tail}", ringTail)
    : ctxWindowDeclared
      ? STR.composer.ringTitleNoData.replace("{tail}", ringTail)
      : STR.composer.ringTitleUnknown.replace("{tail}", ringTail);
  const ringAria = ctxPct !== null
    ? STR.composer.ringAriaPct.replace("{pct}", String(ctxPct))
    : ctxWindowDeclared ? STR.composer.ringAriaNoData : STR.composer.ringAriaUnknown;
  const recentRefs = props.recentRefs ?? [];
  // 插件命令带（G1 的按钮带半边，2026-10-21）：只列已信任、带命名空间的命令；
  // 点一下填入 `/plugin:command `，不直接发送（沿用 C-24 的「填入不发送」口径）。
  const pluginSkills = (props.skills ?? []).filter((s) => s.trust === "trusted" && s.invoke.includes(":")).slice(0, 4);
  return (
    <>
      {pluginSkills.length > 0 && (
        <div className="plugin-strip" aria-label={STR.composer.pluginStripAria}>
          <span className="plugin-strip-label"><Puzzle size={11} aria-hidden="true" />{STR.composer.pluginStripLabel}</span>
          {pluginSkills.map((s) => {
            const invoke = s.invoke.replace(/^\/+/, "");
            return (
              <button
                key={s.invoke}
                className="plugin-chip"
                title={s.description.trim() === "" ? invoke : s.description}
                onClick={() => { chooseSlash({ invoke: `/${invoke}`, desc: s.description }); }}
              >
                {invoke}
              </button>
            );
          })}
        </div>
      )}
      <div
        ref={cardRef}
        className="composer-card"
        data-composer-card="true"
        data-phase={props.activeId === null ? "hero" : "conversation"}
        data-disabled={disabled ? "true" : "false"}
        data-dragging={dragging ? "true" : "false"}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            if (!dragging) setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          // 只有真正离开卡片才清高亮（在子元素之间移动会反复触发 leave）
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          // P2-4 分流（复用 classifyDrop）：文件按项目内外分桶；
          // 目录 = 项目内落目录附件、项目外只提示（不自动加为项目，避免误触——加项目走侧栏/窗口投放）。
          const dtItems = Array.from(e.dataTransfer.items ?? []);
          const entries: { path: string; isDirectory: boolean; size: number }[] = [];
          const files = Array.from(e.dataTransfer.files);
          for (let i = 0; i < files.length; i++) {
            const f = files[i]!;
            const p = filePathOf(f);
            if (p === null) continue;
            const entry = dtItems[i]?.webkitGetAsEntry?.() ?? null;
            entries.push({ path: p, isDirectory: entry?.isDirectory === true, size: f.size });
          }
          if (entries.length === 0) return;
          const fileEntries = entries.filter((en) => !en.isDirectory);
          const { outside } = classifyDrop(
            fileEntries.map((en) => ({ path: en.path, isDirectory: false })),
            wsPath !== null ? [wsPath] : [],
          );
          // 无项目（范围空）时 classifyDrop 全落 outside——但"项目外"无从谈起，不挂盾牌。
          const outsideSet = new Set(wsPath === null ? [] : outside);
          let hinted = false;
          for (const en of entries) {
            if (en.isDirectory && !inWorkspace(en.path)) { hinted = true; continue; }
            addAttachment({
              path: en.path,
              kind: en.isDirectory ? "directory" : "file",
              explicit: true,
              ...(!en.isDirectory ? { outside: outsideSet.has(en.path) } : {}),
              ...(Number.isFinite(en.size) && en.size > 0 && !en.isDirectory ? { size: en.size } : {}),
            });
          }
          if (hinted) toast(STR.composer.dropDirHint);
        }}
      >
        {/* 运行状态条（2026-10-18）：phaseLabel/elapsed/steps 三件此前只传不用——用户看得到停止键，
            却看不到“在等审批 / 思考中 / 已停止”，也看不到跑了多久。仅在跑或已停时占位。 */}
        {(props.running || props.stopped) && (
          <div className="cc-phase" role="status" aria-live="polite">
            <span className="cc-phase-dot" data-running={props.running ? "true" : "false"} aria-hidden="true" />
            <span>{props.phaseLabel}</span>
            {props.running && <span className="cc-phase-dim">{String(props.elapsedSec)}s</span>}
            {(props.runSteps ?? 0) > 0 && <span className="cc-phase-dim">{String(props.runSteps)} 步</span>}
          </div>
        )}
        {/* C-37 斜杠菜单（内置两条 + 工作区 loose skills；2026-10-18 接通 §8 #14） */}
        {slashHits.length > 0 && (
          <div className="slash-menu pop show" role="menu">
            {slashHits.map((s, idx) => (
              <button
                key={s.invoke}
                className={"menu-item" + (idx === Math.min(slashActive, slashHits.length - 1) ? " on" : "")}
                role="menuitem"
                onClick={() => { chooseSlash(s); }}
              >
                <span>{s.invoke}</span>
                <span className="sub">{s.desc}</span>
              </button>
            ))}
          </div>
        )}
        {/* @引用（P2-4）：扁平模糊搜索；相对路径带面包屑灰字；选中文件=落 chip，选中目录=定范围再搜 */}
        {mentionVisible && mention !== null && (
          <div className="mention-menu pop show" role="listbox" aria-label={STR.composer.mentionAria}>
            {mention.hits === null && <div className="menu-note">{STR.common.loading}</div>}
            {mention.hits !== null && mentionList.length === 0 && (
              <div className="menu-note">{mention.note ?? STR.composer.mentionEmpty}</div>
            )}
            {mentionList.map((hit, i) => {
              const crumb = mentionBreadcrumb(hit.path);
              return (
                <button
                  key={`${hit.kind}:${hit.path}`}
                  className={"menu-item" + (i === mention.active ? " on" : "")}
                  role="option"
                  aria-selected={i === mention.active}
                  onMouseDown={(e) => { e.preventDefault(); chooseMention(hit); }}
                  onMouseEnter={() => { setMention((cur) => (cur !== null ? { ...cur, active: i } : cur)); }}
                >
                  <span className="mi-ico" aria-hidden="true">{hit.kind === "directory" ? <Folder size={12} /> : <FileText size={12} />}</span>
                  <span>{crumb.name}{hit.kind === "directory" ? "/" : ""}</span>
                  <span className="sub">{crumb.dir}</span>
                </button>
              );
            })}
            {mention.hits !== null && mentionList.length > 0 && mention.note !== undefined && (
              <div className="menu-note">{mention.note}</div>
            )}
            {/* 无结果时不摆「↑↓ 选择 · ⏎ 引用」——没有可选项的按键说明是误导。 */}
            {mentionList.length > 0 && <div className="menu-note">{STR.composer.mentionNav}</div>}
          </div>
        )}
        {/* 附件 chips（P2-3）：图标 + 文件名 + 大小（拿不到不显）+ 项目外盾牌；点击=打开/定位；路径只进 tooltip */}
        {attachments.length > 0 && (
          <div className="attach-strip show">
            {attachments.map((a, i) => (
              <span key={`${a.path}:${String(i)}`} className="attach-chip">
                <button
                  type="button"
                  className="ac-main"
                  title={a.outside === true ? STR.composer.attachOutsideTip : STR.composer.attachOpenTip.replace("{path}", a.path)}
                  onClick={() => {
                    const rel = relInWorkspace(wsPath, a.path);
                    if (rel !== null) {
                      void window.agent.workspacePathAction(rel, "open").catch(() => undefined);
                    } else {
                      // 项目外：打开可能危险，只显示位置（revealInFinder）。
                      void window.agent.revealInFinder(a.path).catch(() => undefined);
                    }
                  }}
                >
                  <span className="ac-ico" aria-hidden="true">
                    <AttachIcon path={a.path} kind={a.kind} />
                  </span>
                  <span className="ac-name">{baseNameOf(a.path)}</span>
                  {a.size !== undefined && <span className="ac-size num">{STR.composer.fileSize.replace("{n}", formatSize(a.size))}</span>}
                  {!inWorkspace(a.path) && (
                    <span className="ac-shield" title={STR.composer.attachOutsideTip}><Shield size={10} /></span>
                  )}
                </button>
                <button
                  type="button"
                  className="x"
                  aria-label={STR.composer.attachRemove.replace("{path}", a.path)}
                  onClick={() => { setAttachments((prev) => prev.filter((_, j) => j !== i)); }}
                ><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="row2">
          <textarea
            data-composer-input="true"
            ref={taRef}
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={
              suggesting ? STR.composer.placeholderSuggesting       // 想下一条加载态（Tab 出手中）
              : disabled && props.disabledReason === "gate" ? STR.composer.placeholderGate
              : disabled && props.disabledReason === "queue" ? STR.composer.placeholderQueue
              : disabled && props.disabledReason === "creating" ? STR.composer.placeholderCreating
              : disabled && props.running ? STR.composer.placeholderGate
              : disabled ? STR.composer.placeholderCreating
              : props.stopped ? STR.composer.placeholderStopped
              : STR.composer.placeholder                            // 运行中也用这条：排队语义不摆常驻提示（业主裁）
            }
            aria-label={STR.composer.inputAria}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              histIndexRef.current = -1; // 一动笔就退出历史浏览
              if (suggestNote !== null) setSuggestNote(null); // 一动笔，旧提示即撤（不留过期文案）
              autoResize();
              refreshMention(v, e.target.selectionStart ?? v.length);
            }}
            onClick={(e) => { refreshMention(text, (e.target as HTMLTextAreaElement).selectionStart ?? text.length); }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onPaste={(e) => {
              // P2-3：剪贴板带文件（截图/复制的文件）才接管；纯文本粘贴不劫持。
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length === 0) return;
              e.preventDefault();
              attachFromFiles(files);
            }}
            onKeyDown={(e) => {
              // Esc 先收浮层（2026-10-18）：斜杠/mention 开着时 Esc 只关菜单，不动草稿。
              // 不依赖“有命中”——加载中/零命中的 mention 也要能 Esc 掉。
              if (e.key === "Escape") {
                if (slashHits.length > 0) { e.preventDefault(); setMenuDismissed("slash"); return; }
                if (mentionVisible) { e.preventDefault(); setMention(null); setMenuDismissed("mention"); return; }
              }
              // 斜杠菜单键盘选中（2026-10-18）：↑↓ 移动，⏎/Tab 填入；Enter 不再直发整段 "/x"。
              if (slashHits.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashActive((i) => (i + 1) % slashHits.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashActive((i) => (i - 1 + slashHits.length) % slashHits.length);
                  return;
                }
                if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                  e.preventDefault();
                  chooseSlash(slashHits[Math.min(slashActive, slashHits.length - 1)]!);
                  return;
                }
              }
              // @mention 菜单开着时先吃导航键（↑↓ 选项 / Enter 或 Tab 引用 / Esc 关）——Enter 不发送。
              if (mentionVisible && mentionList.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMention({ ...mention, active: (mention.active + 1) % mentionList.length });
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMention({ ...mention, active: (mention.active - 1 + mentionList.length) % mentionList.length });
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  chooseMention(mentionList[Math.min(mention.active, mentionList.length - 1)]!);
                  return;
                }
              }
              // ↑/↓ 已发提示历史（2026-10-18）：空输入框按 ↑ 取上一条；↓ 往回走，走到底回空。
              // 只在空输入框或正在翻历史时接管，不抢多行草稿里的光标移动；菜单开着时上面的块先吃。
              const hist = historyRef.current.get(draftKeyRef.current) ?? [];
              if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (text === "" || histIndexRef.current >= 0)) {
                if (e.key === "ArrowUp" && hist.length > 0) {
                  e.preventDefault();
                  const next = Math.min(histIndexRef.current + 1, hist.length - 1);
                  histIndexRef.current = next;
                  setText(hist[next]!);
                  requestAnimationFrame(autoResize);
                  return;
                }
                if (e.key === "ArrowDown" && histIndexRef.current >= 0) {
                  e.preventDefault();
                  const next = histIndexRef.current - 1;
                  histIndexRef.current = next;
                  setText(next < 0 ? "" : hist[next]!);
                  requestAnimationFrame(autoResize);
                  return;
                }
              }
              // ⌘./Ctrl+. = 停止生成（P2-2：先在 Composer 通道挂通；统一快捷键表 P3-3 落）。
              if ((e.metaKey || e.ctrlKey) && e.key === ".") {
                if (props.running) {
                  e.preventDefault();
                  props.onCancel();
                }
                return;
              }
              // 想下一条（第二十四遍·业主 22.02 裁）：空输入框 + 空闲 + 有接线 ⇒ Tab 单发一次
              // 上下文建议（只填不发；Shift+Tab 不劫持——反向焦点照走；加载中再按 Tab 是静默等待）。
              if (props.onSuggestNext !== undefined && e.key === "Tab" && !e.shiftKey && !disabled && !props.running && text === "") {
                e.preventDefault();
                if (suggesting) return;
                const onSuggest = props.onSuggestNext;
                setSuggestNote(null);
                setSuggesting(true);
                const my = ++suggestSeq.current;
                void onSuggest().then((r) => {
                  if (suggestSeq.current !== my) return; // 已切会话：结果作废（不能填进新会话）
                  setSuggesting(false);
                  if (r.ok) {
                    setText((cur) => (cur === "" ? r.text : cur)); // 拉回时用户已敲字 ⇒ 不覆盖
                    requestAnimationFrame(autoResize);
                    taRef.current?.focus();
                  } else {
                    setSuggestNote(r.hint); // 失败 fail-visible（分类文案来自 main）
                  }
                }).catch((err: unknown) => {
                  if (suggestSeq.current !== my) return;
                  setSuggesting(false);
                  const brief = err instanceof Error ? err.message : String(err);
                  setSuggestNote(STR.composer.suggestionFail.replace("{brief}", brief.slice(0, 60)));
                });
                return;
              }
              if (e.key !== "Enter" || e.shiftKey || e.altKey) return;
              if (composing.current) return;
              e.preventDefault();
              // ⌘/Ctrl+Enter：运行中=打断并发送（入队后打断）；空闲时与回车同义。
              submit(e.metaKey || e.ctrlKey ? { interrupt: true } : undefined);
            }}
          />
          {suggestArmed && (
            <span className="suggest-kbd" title={STR.composer.suggestionKbdTip} aria-hidden="true">Tab</span>
          )}
          {suggestNote !== null && (
            <div className="suggest-note" role="status">{suggestNote}</div>
          )}
        </div>
        <div className="row3">
          {/* ＋附件（RunRequest.attachments）：四入口零路径手输——上传文件…/添加文件夹…/粘贴截图（⌘V）/引用最近文件。 */}
          <div style={{ position: "relative" }} ref={attachWrapRef} onKeyDown={attachKeys}>
            <button
              className="attach-btn"
              title={STR.composer.attachTitle}
              aria-haspopup="menu"
              aria-expanded={menu === "attach"}
              disabled={disabled}
              onClick={() => setMenu(menu === "attach" ? "none" : "attach")}
            ><Plus size={13} /></button>
            <Popover open={menu === "attach"} up role="menu" style={{ minWidth: 270 }}>
              <div className="pop-label">{STR.composer.attachLabel}</div>
              {props.onPickFiles !== undefined && (
                <button
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenu("none");
                    void props.onPickFiles?.().then((files) => {
                      if (files === null || files.length === 0) return;
                      for (const p of files) addAttachment({ path: p, kind: "file", explicit: true, outside: !inWorkspace(p) });
                    }, () => undefined);
                  }}
                >
                  <span>{STR.composer.attachUpload}</span><span className="sub">{STR.composer.attachUploadSub}</span>
                </button>
              )}
              {props.onPickDirectory !== undefined && (
                <button
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenu("none");
                    void props.onPickDirectory?.().then((dir) => {
                      if (dir !== null && dir !== "") {
                        addAttachment({ path: dir, kind: "directory", explicit: true });
                      }
                    }, () => undefined);
                  }}
                >
                  <span>{STR.composer.attachFolder}</span><span className="sub">{STR.composer.attachFolderSub}</span>
                </button>
              )}
              <button
                className="menu-item"
                role="menuitem"
                onClick={() => { setMenu("none"); pasteFromClipboard(); }}
              >
                <span>{STR.composer.attachPaste}</span><span className="sub">{STR.composer.attachPasteSub}</span>
              </button>
              {/* 引用最近文件：本会话已引用历史（空 = disabled + tooltip 说明，不摆空壳）。 */}
              <button
                className="menu-item"
                role="menuitem"
                disabled={recentRefs.length === 0}
                title={recentRefs.length === 0 ? STR.composer.attachRecentEmpty : undefined}
                onClick={() => setRecentOpen((v) => !v)}
              >
                <span>{STR.composer.attachRecent}</span>
                <span className="sub">{String(recentRefs.length)}</span>
                <span className="ac-chev" aria-hidden="true"><ChevronRight size={11} /></span>
              </button>
              {recentOpen && recentRefs.map((p) => (
                <button
                  key={p}
                  className="menu-item ac-recent"
                  role="menuitem"
                  title={p}
                  onClick={() => { addAttachment({ path: p, kind: "file", explicit: true, outside: !inWorkspace(p) }); }}
                >
                  <span className="mi-ico" aria-hidden="true">{fileIconKind(p) === "image" ? <ImageIcon size={12} /> : <FileText size={12} />}</span>
                  <span>{baseNameOf(p)}</span>
                </button>
              ))}
            </Popover>
          </div>
          {/* 权限 chip + 菜单同一相对容器（2026-10-17）：菜单原先是 chip 的兄弟节点，锚到 composer
              卡左缘、外点/Esc 也无归属；包一层后锚到 chip、dismiss 有落点。 */}
          <div style={{ position: "relative", display: "inline-flex" }} ref={permWrapRef} onKeyDown={permKeys}>
            <button
              className="ctl"
              aria-haspopup="menu"
              aria-expanded={menu === "perm"}
              onClick={() => setMenu(menu === "perm" ? "none" : "perm")}
              disabled={disabled || props.running}
            >
              <ModeDot mode={props.mode} />
              {modeInfo.warn === true ? <ShieldAlert size={13} /> : <Shield size={13} />}
              <span>{modeInfo.label}</span>
              <span className="ctl-caret" aria-hidden="true"><ChevronDown size={10} /></span>
            </button>
            <Popover open={menu === "perm"} up role="menu" style={{ minWidth: 280 }}>
              {/* 权限档菜单（批 5 提取为组件）：色点 + 图标 + 两行副标题 +「自动」二次确认（见 PermissionMenu.tsx）。
                  条件渲染（关即卸载）——confirming 态不跨开合残留（真机实证过常驻挂载的残留 bug）。 */}
              {menu === "perm" && (
                <PermissionMenu mode={props.mode} onModeChange={props.onModeChange} onClose={closeMenu} />
              )}
            </Popover>
          </div>
          <ModelPicker
            // 切会话重挂（2026-10-18）：模型菜单是 Composer 之外的局部开合状态，不重挂的话
            // 会悬在新会话上（真机：@/附件/权限菜单已收，模型搜索框还开着）。
            key={draftKey}
            infos={props.providerInfo ? [props.providerInfo] : []}
            value={props.pickerValue}
            disabled={disabled}
            running={props.running}
            onChange={props.onModelChange}
            {...(props.onOpenSettings !== undefined ? { onOpenSettings: props.onOpenSettings } : {})}
            {...(props.modelSessionOverride === true ? { sessionOverride: true } : {})}
            {...(props.onThinkingChange !== undefined
              ? {
                  thinking: props.thinking,
                  onThinkingChange: props.onThinkingChange,
                  thinkingSupported,
                }
              : {})}
            {...(props.configuredProviders !== undefined ? { configuredProviders: props.configuredProviders } : {})}
            openSeq={pickerOpenSeq}
            initialFocus={pickerFocus}
            onUserOpen={() => setPickerFocus("model")}
          />
          <span className="spacer" />
          {/* 用量环（v3-lite .ring：环心带上下文百分数；环钉在发送/中断钮左侧——原型 .bar 列序
              模型芯片弹性、ctxRing 与 send 贴右。「模型选择器旁」§3.5 语义随同一控件行保持）。 */}
          <div className="usage-slot" ref={meterWrapRef}>
            <button
              className="usage-ring"
              aria-label={ringAria}
              title={ringTitle}
              aria-expanded={menu === "meter"}
              onClick={() => setMenu(menu === "meter" ? "none" : "meter")}
            >
              <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
                <circle className="ur-track" cx="14" cy="14" r={USAGE_RING_R} />
                <circle
                  className="ur-bar"
                  cx="14" cy="14" r={USAGE_RING_R}
                  style={{
                    strokeDasharray: USAGE_RING_C,
                    strokeDashoffset: USAGE_RING_C * (1 - (ctxPct ?? 0) / 100),
                  }}
                />
              </svg>
              {/* 环心数字=上下文水位（原型 <b>62</b> 同式；拿不到读数=「—」，不假报 0） */}
              <b className="ur-num">{ctxPct !== null ? String(ctxPct) : STR.composer.dash}</b>
            </button>
            <Popover open={menu === "meter"} up role="menu" style={{ left: "auto", right: 0 }}>
              <div className="meter-detail">
                <div className="pop-label">{STR.composer.meterTitle}</div>
                <div className="mt-row"><span>{STR.composer.meterInput}</span><b>{formatTokens(usage.inputTokens)}</b></div>
                <div className="mt-row"><span>{STR.composer.meterOutput}</span><b>{formatTokens(usage.outputTokens)}</b></div>
                <div className="mt-row"><span>{STR.composer.meterCacheRead}</span><b>{usage.cacheReadTokens > 0 ? formatTokens(usage.cacheReadTokens) : STR.composer.dash}</b></div>
                <div className="mt-row"><span>{STR.composer.meterRounds}</span><b>{String(usage.usageCount)}</b></div>
                {/* 批 4：状态条拆进来——步数与上下文行（环 hover 之外的常驻明细）。 */}
                <div className="mt-row"><span>{STR.composer.meterSteps}</span><b>{String(props.steps)}</b></div>
                <div className="mt-row">
                  <span>{STR.composer.meterCtx}</span>
                  <b>
                    {ctxPct !== null && props.ctxWindow !== undefined
                      ? STR.composer.meterCtxDetail
                          .replace("{pct}", String(ctxPct))
                          .replace("{used}", formatTokens(usage.lastInputTokens))
                          .replace("{max}", formatTokens(props.ctxWindow))
                      : ctxWindowDeclared ? STR.composer.meterCtxNoData : STR.composer.meterCtxUnknown}
                  </b>
                </div>
                <div className="menu-note">{STR.composer.meterNote}</div>
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { props.onCompact(); setMenu("none"); }}>{STR.composer.meterCompact}</button>
              </div>
            </Popover>
          </div>
          {/* 加入队列钮（运行中）：**有话说才出现**——空输入下只留打断钮，不摆禁用的灰钟（v7.1 业主裁）。 */}
          {showQueueButton(props.running, canSend) && (
            <button
              className="send-btn queue"
              aria-label={STR.composer.queueAria}
              title={STR.composer.queueTitle}
              onClick={() => { submit(); }}
            >
              <Clock size={13} />
            </button>
          )}
          {props.running ? (
            <button className="send-btn stop" aria-label={STR.composer.stopAria} title={STR.composer.stopTitle} onClick={props.onCancel}>
              {/* 批 4：转圈内嵌——加载中的转圈放进发送按钮里（变停止钮），不单独出现。 */}
              <Loader2 size={13} />
            </button>
          ) : (
            <button className="send-btn" aria-label={STR.composer.sendAria} title={STR.composer.sendTitle} disabled={!canSend} onClick={() => { submit(); }}>
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// 思考档位词表随单芯片形态在 ModelPicker（THINKING_LEVELS）；此处 re-export 保持旧 import 可用。
export { THINKING_LEVELS };
