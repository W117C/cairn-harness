// C-18 ComposerCard（对齐原型 modelBtn/permBtn/meterBtn/attachBtn 的 row3 形态）。
// 2026-10-07 二次修订（业主指名对齐 design/prototype.html）：
//   · 控件行 = ＋附件 · 权限档⌄ · 「模型 · 思考 off」⌄（单芯片，思考段在菜单里） · meter · 发送；
//   · meter 回归纯文本 ↑in ↓out（原型同款，不再塞图标）；
//   · 状态条 = 原型 renderStatus 的诚实版：N 轮 · M 步（· 速率）｜总量 tok（· 缓存命中）｜上下文水位，
//     只报拿得到的数据（缺缓存读/未知窗口就不显那一格，不编数）；
//   · ＋附件走真通道（RunRequest.attachments，main 侧校验）：目录引用用系统选择器，路径手输兜底。
// Row2 输入（textarea 自增高、IME 守卫）；副作用全在 App（send/cancel/setSettings/compact）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PermissionMode, ProviderInfo, RunAttachmentReference } from "../../../../../src/main/ipc-protocol";
import type { RunPhase } from "../projections";
import { formatTokens } from "./TokenPanel";
import { ModelPicker, THINKING_LEVELS } from "./ModelPicker";
import { Ic } from "./icons";

const MODE_LABEL: Record<PermissionMode, { label: string; desc: string; warn?: boolean }> = {
  "read-only": { label: "只读", desc: "写工具一律拒" },
  default: { label: "默认 · 逐次审批", desc: "每次写/跑都出卡" },
  guided: { label: "引导 · 按风险放行", desc: "低风险自动、高风险出卡" },
  auto: { label: "自动 · 免审批", desc: "危险：全部放行（出网仍审批按需）", warn: true },
};

function Pop(props: { open: boolean; up?: boolean; children: ReactNode; style?: React.CSSProperties }) {
  return <div className={`pop${props.up ? " up" : " down"}${props.open ? " show" : ""}`} role="menu" style={props.style}>{props.children}</div>;
}

export function Composer(props: {
  disabled?: boolean;
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
  /** 主会话 tool_call 步数（状态条「M 步」）。 */
  steps: number;
  /** 所选模型的上下文窗口（算水位用；未知 = 不显那一格）。 */
  ctxWindow?: number;
  workspaceLabel: string | null;
  /** EmptyState pill 填入的文案（C-24：填入不发送）。App 用 key 重置触发。 */
  injectedText?: string;
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
  /** 系统目录选择（附件「目录引用」用；缺省不给就只留手输路径）。 */
  onPickDirectory?: () => Promise<string | null>;
  onCompact: () => void;
}) {
  const [text, setText] = useState("");
  // 附件引用（RunRequest.attachments）：chip 列表 + ＋弹层；发送后清空。
  const [attachments, setAttachments] = useState<RunAttachmentReference[]>([]);
  const [pathDraft, setPathDraft] = useState("");
  // pill 填入：injectedText 变化时覆盖草稿并聚焦（不直接发送——C-24 裁定）。
  const lastInjected = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (props.injectedText !== undefined && props.injectedText !== lastInjected.current) {
      lastInjected.current = props.injectedText;
      setText(props.injectedText);
      taRef.current?.focus();
    }
  }, [props.injectedText]);
  const [menu, setMenu] = useState<"none" | "perm" | "meter" | "attach">("none");
  // C-37 SlashMenu：输入以 `/` 开头（无空格）时出现；内置 /compact 与 /goal。
  const slashQuery = text.startsWith("/") && !text.includes(" ") ? text.slice(1).toLowerCase() : null;
  const SLASH_ITEMS: readonly { invoke: string; desc: string }[] = [
    { invoke: "/compact", desc: "压缩历史（对模型做一次摘要收束）" },
    { invoke: "/goal", desc: "设定长任务目标（轮次/美元上限）" },
  ];
  const slashHits = slashQuery === null ? [] : SLASH_ITEMS.filter((s) => s.invoke.slice(1).startsWith(slashQuery));
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // IME 组字守卫（C-27）：拼音组字期间 Enter 不发送（中文输入必需）。
  const composing = useRef(false);
  const disabled = props.disabled === true;
  const canSend = !disabled && text.trim() !== "";
  const autoResize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${String(Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.4)))}px`;
  };
  const submit = () => {
    if (!canSend) return;
    props.onSend(text.trim(), attachments);
    setText("");
    setAttachments([]);
    setPathDraft("");
    requestAnimationFrame(autoResize);
  };
  const modeInfo = MODE_LABEL[props.mode];
  const thinkingSupported = (() => {
    const spec = props.providerInfo?.models.find((m) => m.id === props.pickerValue);
    return spec?.capability.thinking.supported === true;
  })();
  // 状态条（原型 renderStatus 逐字形态）：`N 轮 · M 步（· 速率）｜X tok（· 缓存命中）｜上下文 ▓ Z%`。
  // 只报拿得到的数据；一格都没得报就整条留空（原型空态即空条，不摆「新任务/快捷键」这类填充字）。
  const usage = props.usage;
  const totalTok = usage.inputTokens + usage.outputTokens;
  const speed = props.running && props.elapsedSec > 0 && usage.outputTokens > 0
    ? Math.round(usage.outputTokens / props.elapsedSec)
    : null;
  const cachePct = usage.cacheReadTokens > 0 && usage.inputTokens > 0
    ? Math.min(99, Math.round((usage.cacheReadTokens / (usage.cacheReadTokens + usage.inputTokens)) * 100))
    : null;
  const ctxPct = props.ctxWindow !== undefined && props.ctxWindow > 0 && usage.lastInputTokens > 0
    ? Math.min(100, Math.round((usage.lastInputTokens / props.ctxWindow) * 100))
    : null;
  const leftParts: string[] = [];
  if (usage.usageCount > 0) leftParts.push(`${String(usage.usageCount)} 轮`);
  if (props.steps > 0) leftParts.push(`${String(props.steps)} 步`);
  if (speed !== null && speed > 0) leftParts.push(`${String(speed)} tok/s`);
  const hasStrip = leftParts.length > 0 || totalTok > 0 || ctxPct !== null;
  return (
    <>
      {props.workspaceLabel !== null && (
        <div className="ctx-row">
          <span className="ctx-chip" aria-label="当前工作区">
            <Ic.folder size={12} />
            {props.workspaceLabel}<span className="wt-tag">本地</span>
          </span>
        </div>
      )}
      <div className="composer-card" data-disabled={disabled ? "true" : "false"}>
        {/* C-37 斜杠菜单（内置两条；技能调用名清单需插件快照扩字段，§8 #14 待接） */}
        {slashHits.length > 0 && (
          <div className="slash-menu pop show" role="menu">
            {slashHits.map((s) => (
              <button
                key={s.invoke}
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  setText(`${s.invoke} `);
                  taRef.current?.focus();
                }}
              >
                <span>{s.invoke}</span>
                <span className="sub">{s.desc}</span>
              </button>
            ))}
          </div>
        )}
        {/* 附件引用 chips（原型 .attach-strip；发送后清空） */}
        {attachments.length > 0 && (
          <div className="attach-strip show">
            {attachments.map((a, i) => (
              <span key={`${a.path}:${String(i)}`} className="attach-chip">
                {a.path}
                <button
                  className="x"
                  aria-label={`移除引用 ${a.path}`}
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                ><Ic.x size={10} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="row2">
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={props.running ? "会话运行中…（点 ⏹ 打断）" : props.stopped ? "已停止 · 可继续派活" : "发消息或创建任务，/ 调用指令"}
            aria-label="任务输入"
            onChange={(e) => { setText(e.target.value); autoResize(); }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
                if (composing.current) return;
                e.preventDefault();
                submit();
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
            }}
          />
        </div>
        <div className="row3">
          {/* ＋附件（RunRequest.attachments）：目录引用走系统选择器；路径手输兜底（fail-visible 在 main 校验）。 */}
          <div style={{ position: "relative" }}>
            <button
              className="attach-btn"
              title="添加文件 / 目录引用"
              aria-haspopup="menu"
              aria-expanded={menu === "attach"}
              disabled={disabled}
              onClick={() => setMenu(menu === "attach" ? "none" : "attach")}
            ><Ic.plus size={13} /></button>
            <Pop open={menu === "attach"} up style={{ minWidth: 270 }}>
              <div className="pop-label">附件引用（RunRequest.attachments）</div>
              {props.onPickDirectory !== undefined && (
                <button
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenu("none");
                    void props.onPickDirectory?.().then((dir) => {
                      if (dir !== null && dir !== "") {
                        setAttachments((prev) => prev.some((a) => a.path === dir)
                          ? prev
                          : [...prev, { path: dir, kind: "directory", explicit: true }]);
                      }
                    }, () => undefined);
                  }}
                >
                  <span>目录引用…</span><span className="sub">系统选择器 · 目录内文本按引用读取</span>
                </button>
              )}
              <div className="menu-note" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="text"
                  aria-label="按路径添加引用"
                  placeholder="/绝对/路径/到/文件"
                  value={pathDraft}
                  style={{ flex: 1, border: "1px solid var(--hairline)", borderRadius: 6, padding: "3px 8px", font: "inherit", fontSize: "var(--fs-xs)", background: "var(--surface)", color: "var(--text-1)", outline: 0 }}
                  onChange={(e) => setPathDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const p = pathDraft.trim();
                      if (p !== "") setAttachments((prev) => prev.some((a) => a.path === p) ? prev : [...prev, { path: p, kind: "file", explicit: true }]);
                      setPathDraft("");
                    }
                  }}
                />
                <button
                  className="mini-btn"
                  onClick={() => {
                    const p = pathDraft.trim();
                    if (p !== "") setAttachments((prev) => prev.some((a) => a.path === p) ? prev : [...prev, { path: p, kind: "file", explicit: true }]);
                    setPathDraft("");
                  }}
                >添加</button>
              </div>
              <div className="menu-note">手输路径按**文件**引用；目录请用上面的选择器。本地引用由 main 在 run 前校验，工作区外走既有外部引用审批。</div>
            </Pop>
          </div>
          <button
            className="ctl"
            aria-haspopup="menu"
            aria-expanded={menu === "perm"}
            onClick={() => setMenu(menu === "perm" ? "none" : "perm")}
            disabled={disabled}
          >
            {modeInfo.warn === true ? <Ic.shieldAlert size={13} /> : <Ic.shield size={13} />}
            <span>{modeInfo.label}</span>
            <span className="ctl-caret" aria-hidden="true"><Ic.chevronDown size={10} /></span>
          </button>
          <Pop open={menu === "perm"} up style={{ minWidth: 280 }}>
            <div className="pop-label">权限档（下一轮派活生效）</div>
            {(Object.keys(MODE_LABEL) as PermissionMode[]).map((m) => (
              <button
                key={m}
                className="menu-item"
                role="menuitem"
                onClick={() => { props.onModeChange(m); setMenu("none"); }}
              >
                {MODE_LABEL[m].warn === true && <span className="risk-dot" aria-hidden="true" />}
                <span>{MODE_LABEL[m].label}</span>
                <span className="sub">{MODE_LABEL[m].desc}</span>
                {m === props.mode && <span className="check">✓</span>}
              </button>
            ))}
          </Pop>
          <ModelPicker
            infos={props.providerInfo ? [props.providerInfo] : []}
            value={props.pickerValue}
            disabled={disabled}
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
          />
          <span className="spacer" />
          <div style={{ position: "relative" }}>
            <button
              className="meter num"
              title="用量明细"
              aria-expanded={menu === "meter"}
              onClick={() => setMenu(menu === "meter" ? "none" : "meter")}
            >
              <span>↑{formatTokens(usage.inputTokens)}</span>
              <span>↓{formatTokens(usage.outputTokens)}</span>
            </button>
            <Pop open={menu === "meter"} up style={{ left: "auto", right: 0 }}>
              <div className="meter-detail">
                <div className="pop-label">本会话用量</div>
                <div className="mt-row"><span>输入</span><b>{formatTokens(usage.inputTokens)}</b></div>
                <div className="mt-row"><span>输出</span><b>{formatTokens(usage.outputTokens)}</b></div>
                <div className="mt-row"><span>缓存读</span><b>{usage.cacheReadTokens > 0 ? formatTokens(usage.cacheReadTokens) : "—"}</b></div>
                <div className="mt-row"><span>轮数</span><b>{String(usage.usageCount)}</b></div>
                <div className="menu-note">缓存读/写上游未上报时显示「—」，不按 0 计。<br />未折算金额（价表不可知）。</div>
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { props.onCompact(); setMenu("none"); }}>压缩历史…</button>
              </div>
            </Pop>
          </div>
          {props.running ? (
            <button className="send-btn stop" aria-label="打断本轮" title="打断本轮" onClick={props.onCancel}>
              <Ic.stop size={12} />
            </button>
          ) : (
            <button className="send-btn" aria-label="发送" disabled={!canSend} onClick={submit}>
              <Ic.send size={14} />
            </button>
          )}
        </div>
      </div>
      {hasStrip && (
        <div className="status-strip">
          {leftParts.length > 0 && <span className="num">{leftParts.join(" · ")}</span>}
          <span className="sp" />
          {totalTok > 0 && (
            <span className="num">
              {formatTokens(totalTok)} tok
              {cachePct !== null ? ` · 缓存命中 ${String(cachePct)}%` : ""}
            </span>
          )}
          {ctxPct !== null && (
            <span className="ctx-meter num">
              上下文
              <span className="ctx-bar"><i style={{ width: `${String(ctxPct)}%` }} /></span>
              {String(ctxPct)}%
            </span>
          )}
        </div>
      )}
    </>
  );
}

// 思考档位词表已随单芯片形态迁回 ModelPicker（THINKING_LEVELS）；此处 re-export 保持旧 import 可用。
export { THINKING_LEVELS };
