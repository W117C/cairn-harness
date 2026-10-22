// 设置页（批 6 换壳 · 总纲阶段 2-3 + 改动清单阶段 6）：
//   壳只留三件事：左导航（settings-nav 是唯一事实源，渲染锚不动）+ 状态管理（settings/status/cap/回执）+
//   工作台四分区接线（AppPageBody；导航元数据已抽到轻量 settings-nav，避免命令面板拉入整页）。
//   正文四段全在 settings-sections.tsx（通用 / 模型与 Provider / 权限与安全 / 关于与更新），
//   公共件走 settings-ui（SettingsPage/SettingsSection/SettingsRow）。
//   「修改即保存」静态行 → 右下「已保存 ✓」短暂指示（清单阶段 6）；
//   字段级保存（无全局保存键，SettingsStore patch 语义）；校验失败行内红字，不静默。
// 纯函数资产（panelPatch / providerStatusLabel / …）随迁 settings-sections，
// 本文件重导出保旧 import 面（settings-panel.test 判卷锚不动）。
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Search, X } from "lucide-react";
import type { AgentApi, AppSettings, CapabilityReadout, ProviderInfo } from "../../../../../src/main/ipc-protocol";
import type { TextSizeSetting, UiSizeSetting } from "../../../../../src/main/settings";
import { SettingsPage, SettingsRow, SettingsSection } from "./settings-ui";
import {
  AboutSection,
  AdvancedSection,
  GeneralSection,
  PermissionsSection,
  ProviderSection,
  SEARCH_CONFIG_HINT,
  ShortcutsSection,
  defaultKeyProvider,
  panelPatch,
} from "./settings-sections";
import { AppPageBody, type PageId } from "./AppPage";
import { ModalSurface } from "./ModalSurface";
import { PAGE_ORDER, SECTIONS, filterSections, type SectionId } from "./settings-nav";

export { SECTIONS, type SectionId };

// 纯函数资产重导出（原在壳内定义；判卷 import 面不动）。
export {
  PANEL_PATCH_KEYS,
  panelPatch,
  PANEL_PROVIDER_KINDS,
  providerNeedsKey,
  defaultKeyProvider,
  providerStatusLabel,
  searchCapabilityLabel,
  SEARCH_CONFIG_HINT,
} from "./settings-sections";

const PAGE_SECTION_IDS = new Set<string>(PAGE_ORDER);

/* ── 更新区（P1 修复 · 2026-10-22）：「发现新版本」不能是一句死胡同 ────────────────
   实测缺陷：旧实现只把检查结果的 version 拼成「发现新版本 X」⇒ manifest 里的下载页
   URL 与更新说明被静默丢掉；渲染层对 openExternal 零调用点 ⇒ 用户看到"有新版"却无处可去。
   现在：available 态带出版本 + 更新说明 + 一个可点动作，动作**只**走主进程通道
   agent.openExternal（http(s) 白名单在主进程，manifest 注入协议进不来）。 */

/** 主进程检查结果（从 AgentApi 派生——渲染层不直接引 updater 模块）。 */
type UpdateCheckResult = Awaited<ReturnType<AgentApi["checkUpdate"]>>;

/** 更新区读数。available 变体必须带 url/notes：丢掉它们＝把"有新版"变成死胡同。 */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "unconfigured" }
  | { kind: "error"; message: string }
  | { kind: "up-to-date" }
  | { kind: "available"; version: string; url: string; notes?: string; openError: string | null };

/** 检查结果 → 读数（url/notes 原样带出，不在这一步丢）。 */
export function updateStateOf(r: UpdateCheckResult): UpdateState {
  if (r.state === "available") return { kind: "available", version: r.version, url: r.url, notes: r.notes, openError: null };
  if (r.state === "error") return { kind: "error", message: r.message };
  if (r.state === "unconfigured") return { kind: "unconfigured" };
  return { kind: "up-to-date" };
}

/** 「检查更新」→ 读数（网络失败也是显式态，绝不静默）。 */
export async function checkUpdateState(): Promise<UpdateState> {
  try {
    return updateStateOf(await window.agent.checkUpdate());
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** 主进程拒绝打开时把原因并进读数（错误面要看得见，不能吞）。 */
export function withOpenError(state: UpdateState, message: string): UpdateState {
  return state.kind === "available" ? { ...state, openError: message } : state;
}

/** 打开下载页：只走主进程通道 agent.openExternal（http(s) 白名单在主进程）。
 *  外链不经渲染层——渲染层不自己开浏览器、也不改地址栏。 */
export async function openUpdateUrl(url: string, onError: (message: string) => void): Promise<void> {
  let message: string | null = null;
  try {
    const r = await window.agent.openExternal(url);
    if (!r.ok) message = r.error ?? "打开下载页失败";
  } catch (err) {
    message = `打开下载页失败：${err instanceof Error ? err.message : String(err)}`;
  }
  if (message !== null) onError(message);
}

/** 「发现新版本」卡：版本 + 更新说明 + 一个可点动作（打开下载页）。 */
export function UpdateOffer(props: {
  version: string;
  url: string;
  notes?: string;
  /** 主进程拒绝时的错误文案；null = 无。 */
  error: string | null;
  /** 打开失败回调（面板接自己的读数）。 */
  onError: (message: string) => void;
}): React.JSX.Element {
  return (
    <SettingsSection title="新版本">
      <SettingsRow label={`发现新版本 ${props.version}`} desc={props.notes}>
        <button type="button" className="mini-btn" title={props.url} onClick={() => openUpdateUrl(props.url, props.onError)}>
          打开下载页
        </button>
      </SettingsRow>
      {props.error !== null && <div className="sp-note err" role="alert">{props.error}</div>}
    </SettingsSection>
  );
}

export function SettingsPanel(props: {
  onClose: () => void;
  initialSection?: SectionId;
  onSettingsSaved?: () => void;
}): React.JSX.Element {
  const [section, setSection] = useState<SectionId>(props.initialSection ?? "general");
  const [settings, setS] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<{ available: boolean; stored: string[]; envActive: boolean }>({ available: true, stored: [], envActive: false });
  const [about, setAbout] = useState<{ version: string } | null>(null);
  // 能力在场性读数（搜索端点配没配）。null = 还没问到 / 问失败——那一格显示「读不到」，
  // 不显示「已配」：把读不到当成配好，正是这个面板要修的那类假象。
  const [cap, setCap] = useState<CapabilityReadout | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ kind: "idle" });
  const [keyProvider, setKeyProvider] = useState(defaultKeyProvider);
  // 「检查连接」的三态回执：保存成功 ≠ 服务可用，两件事分开显示（主进程只 GET 模型清单，不耗额度）。
  const [checkMsg, setCheckMsg] = useState<{ tone: "wait" | "ok" | "err"; text: string; hint?: string } | null>(null);
  // 右下保存状态指示（替换原「修改即保存」静态行）：短暂显示后淡出，不占版式。
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // key 明文零进 React state：输入框非受控，用 ref 取值（与旧实现同一条纪律）。
  const keyInput = useRef<HTMLInputElement | null>(null);
  // 字号档（2026-10-18）：与 App 的 live state 同源，但设置页自己持一份初值，
  // 保存后立刻回灌（不等 App 的 getSettings 回流）——点下去就要看见变化。
  const [textSize, setTextSize] = useState<TextSizeSetting>("md");
  const [uiSize, setUiSize] = useState<UiSizeSetting>("2");
  // 分区搜索（2026-10-18）：收窄左栏九个分区；Esc 两级（有字先清空，空着才失焦）。
  const [navQuery, setNavQuery] = useState("");
  const navSearchRef = useRef<HTMLInputElement | null>(null);
  const visibleSections = useMemo(() => filterSections(navQuery), [navQuery]);

  const pulse = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2200);
  };

  useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
  }, []);

  const refresh = () => {
    void window.agent.getSettings().then((s) => { setS(s); setTextSize(s.textSize); setUiSize(s.uiSize); }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    void window.agent.providerKeyStatus().then((s) => setStatus({ available: s.available, stored: s.stored, envActive: s.envActive })).catch(() => undefined);
  };

  useEffect(() => {
    refresh();
    void window.agent.getState().then((s) => setAbout(s.about ?? null)).catch(() => setAbout(null));
    void window.agent.capabilities().then(setCap).catch(() => setCap(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    try {
      const next = await window.agent.setSettings(panelPatch(patch));
      setS(next);
      pulse("已保存 ✓");
      props.onSettingsSaved?.();
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** Ctrl+Tab 会话循环（§3.6/§7.3.3）：不走 panelPatch（那份白名单与其判卷口径保持原样），单键直调同一条通道。 */
  const saveCtrlTab = (next: boolean) => {
    setError(null);
    void window.agent.setSettings({ ctrlTabCycle: next }).then((updated) => {
      setS(updated);
      pulse("已保存 ✓");
      props.onSettingsSaved?.();
    }, (err: unknown) => {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    });
  };

  /** 单键直写（2026-10-18 高级段用）：与 saveCtrlTab 同一条路——不进 panelPatch 白名单。
   *  为什么不开白名单：那份白名单被判卷钉成六键，且它存在的理由（locale 曾被静默丢成 {}）
   *  仍然成立；把新键塞进去等于改判据来迁就实现。单键直调是仓里已有的正解。
   *  校验在调用方（AdvancedSection 的 parseBudgetField）——后端对非法值静默回退默认，
   *  界面必须先拦住并说清，否则「已保存」与实际存的值不符。 */
  const saveSettingKey = async (key: string, value: boolean | number | string): Promise<void> => {
    setError(null);
    try {
      const next = await window.agent.setSettings({ [key]: value });
      setS(next);
      pulse("已保存 ✓");
      props.onSettingsSaved?.();
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const saveKey = async () => {
    setError(null);
    setBusy(true);
    try {
      const value = keyInput.current?.value ?? "";
      if (value.trim() === "") { setError("key 为空，没有保存"); return; }
      const r = await window.agent.providerKeySet(keyProvider, value);
      if (!r.ok) { setError(`key 保存失败：${r.error ?? "未知错误"}`); return; }
      if (keyInput.current) keyInput.current.value = "";
      const st = await window.agent.providerKeyStatus();
      setStatus({ available: st.available, stored: st.stored, envActive: st.envActive });
      pulse(`key 已存入钥匙串（${keyProvider}）`);
      props.onSettingsSaved?.();
    } catch (err) {
      setError(`key 保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteKey = async (provider: string) => {
    setError(null);
    try {
      const r = await window.agent.providerKeyDelete(provider);
      if (!r.ok) { setError(`key 删除失败：${r.error ?? "未知错误"}`); return; }
      const st = await window.agent.providerKeyStatus();
      setStatus({ available: st.available, stored: st.stored, envActive: st.envActive });
      pulse(`key 已删除（${provider}）`);
      props.onSettingsSaved?.();
    } catch (err) {
      setError(`key 删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const runCheck = () => {
    setCheckMsg({ tone: "wait", text: `正在检查 ${keyProvider} 连接…` });
    void window.agent.providerCheck(keyProvider).then((r) => {
      if (r.ok) {
        const sample = r.sample.length > 0 ? `（例如 ${r.sample.join("、")}）` : "";
        setCheckMsg({ tone: "ok", text: `连接成功：发现 ${String(r.modelCount)} 个可用模型${sample}` });
      } else {
        setCheckMsg({ tone: "err", text: `连接失败：${r.message}`, hint: r.hint });
      }
    }).catch((err: unknown) => {
      setCheckMsg({ tone: "err", text: `连接失败：${err instanceof Error ? err.message : String(err)}` });
    });
  };

  const checkUpdate = () => {
    setUpdate({ kind: "checking" });
    void checkUpdateState().then(setUpdate);
  };

  /** 打开下载页被主进程拒绝：原因并进读数（错误面要看得见，不能吞）。 */
  const onUpdateOpenError = (message: string) => {
    setUpdate((prev) => withOpenError(prev, message));
  };

  // 「更新」行的文案（读数的唯一出口；措辞与旧实现逐字不变）。
  const updateMsg =
    update.kind === "idle" ? null
    : update.kind === "checking" ? "检查中…"
    : update.kind === "unconfigured" ? "未配置更新端点"
    : update.kind === "error" ? `检查未完成：${update.message}`
    : update.kind === "up-to-date" ? "已是最新"
    : `发现新版本 ${update.version}`;

  /** 复制搜索配法（clipboard 访问留在壳层，ProviderSection 纯展示）。 */
  const copyHint = () => {
    void navigator.clipboard.writeText(SEARCH_CONFIG_HINT).then(
      () => pulse("已复制配置片段 ✓"),
      () => setError("复制失败：剪贴板不可用，请手动选中复制"),
    );
  };

  return (
    <ModalSurface className="sp-page" label="设置" onClose={props.onClose}>
      <div className="sp-shell">
        <nav className="sp-nav" aria-label="设置分区">
          {/* 返回必须在 ModalSurface 内部（2026-10-21 评审抓到的 Critical）：settings 打开时
              isolateOutside 会把 titlebar/shell 标成 inert，鼠标点不到工具栏上的返回。
              这里用面板内按钮；工具栏只负责 chrome（设置时不摆侧栏开关）。 */}
          <button className="sp-back" onClick={props.onClose} aria-label="关闭设置（Esc）">
            <ChevronLeft size={13} aria-hidden="true" />
            <span>返回</span>
          </button>
          {/* 分区搜索（2026-10-18 补）：此前九个分区只能靠肉眼扫——⌘K 是「跳到某分区」的导航，
              不是「在设置里找东西」。现在导航列顶部一行搜索，边打边收窄。
              口径诚实：匹配的是**分区名与同义词**（SECTION_KEYWORDS），不是每个开关的标签——
              不把「全文搜索」说成有的样子。 */}
          <div className="sp-nav-search">
            <Search size={12} aria-hidden="true" />
            <input
              className="sp-nav-search-input"
              type="text"
              value={navQuery}
              placeholder="搜索设置分区…"
              aria-label="搜索设置分区"
              onChange={(e) => setNavQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (navQuery !== "") { setNavQuery(""); return; }
                  (e.target as HTMLInputElement).blur();
                  return;
                }
                if (e.key === "Enter" || e.key === "ArrowDown") {
                  const first = visibleSections[0];
                  if (first !== undefined) { e.preventDefault(); setSection(first); }
                }
              }}
            />
            {navQuery.trim() !== "" && (
              <button className="sp-nav-search-x" aria-label="清空搜索" title="清空搜索" onClick={() => { setNavQuery(""); navSearchRef.current?.focus(); }}>
                <X size={11} />
              </button>
            )}
          </div>
          {visibleSections.map((id) => {
            const s = SECTIONS.find((x) => x.id === id);
            if (s === undefined) return null;
            const i = SECTIONS.indexOf(s);
            return (
              <Fragment key={s.id}>
                {/* 分组标签：工作台四分区与「设置」本分区在导航上分开（纯标记，不可点）。 */}
                {s.id === "plugins" && i > 0 && <div className="sp-nav-label" aria-hidden="true">工作台</div>}
                <button
                  className={"sp-nav-item" + (section === s.id ? " on" : "")}
                  aria-current={section === s.id ? "page" : undefined}
                  onClick={() => setSection(s.id)}
                >
                  <span className="sp-ni-ico" aria-hidden="true">{s.icon}</span>
                  {s.label}
                </button>
              </Fragment>
            );
          })}
          {/* 搜索无命中：说清「没有匹配的分区」，别留一个空导航列让人以为设置坏了。 */}
          {visibleSections.length === 0 && (
            <div className="sp-nav-empty">没有匹配「{navQuery.trim()}」的分区</div>
          )}
          {/* 导航列底部留白（原「修改即保存」静态行已按清单撤除，改为右下瞬时指示）。 */}
          <div className="sp-nav-foot" aria-hidden="true" />
        </nav>
        <div className="sp-body">
          {error !== null && <div className="sp-note err" role="alert">{error}</div>}
          {settings === null && section !== "about" && !PAGE_SECTION_IDS.has(section) && <div className="sp-note">正在载入设置…</div>}

          {/* 工作台四分区（并入页体）：自取 getState() 快照，错误走同一错误条。 */}
          {PAGE_SECTION_IDS.has(section) && <AppPageBody page={section as PageId} onError={setError} />}

          {section === "general" && settings !== null && (
            <SettingsPage title="通用" desc="外观、文字与输入习惯。">
              <GeneralSection
                settings={settings}
                textSize={textSize}
                uiSize={uiSize}
                onSave={(patch) => { void save(patch); }}
                onCtrlTab={saveCtrlTab}
                onTextSize={(next) => { setTextSize(next); void saveSettingKey("textSize", next); }}
                onUiSize={(next) => { setUiSize(next); void saveSettingKey("uiSize", next); }}
                onWindowVibrancy={(next) => { void saveSettingKey("windowVibrancy", next); }}
              />
            </SettingsPage>
          )}

          {section === "provider" && (
            <SettingsPage title="模型与 Provider" desc="当前通道、密钥与自定义接口。">
              <ProviderSection
                settings={settings}
                status={status}
                cap={cap}
                keyProvider={keyProvider}
                onKeyProviderChange={setKeyProvider}
                keyInputRef={keyInput}
                busy={busy}
                onSaveKey={() => void saveKey()}
                onDeleteKey={(p) => void deleteKey(p)}
                checkMsg={checkMsg}
                onCheck={runCheck}
                onCustomSaved={() => { refresh(); props.onSettingsSaved?.(); }}
                onCopyHint={copyHint}
              />
            </SettingsPage>
          )}

          {section === "permissions" && settings !== null && (
            <SettingsPage title="权限与安全" desc="审批档位、网络与写入边界。">
              <PermissionsSection settings={settings} onSave={(patch) => { void save(patch); }} />
            </SettingsPage>
          )}

          {section === "shortcuts" && (
            <SettingsPage title="快捷键" desc="键盘入口与速查。">
              <ShortcutsSection />
            </SettingsPage>
          )}

          {/* 高级段（2026-10-18 补）：这些字段此前一直在 settings 里生效却没有开关。
              走 saveKey 单键直写（不走 panelPatch 白名单——那份白名单与其判卷口径保持原样，
              与 saveCtrlTab 同一条路）。 */}
          {section === "advanced" && settings !== null && (
            <SettingsPage title="高级" desc="记忆、成本与隐私。">
              <AdvancedSection settings={settings} onSaveKey={saveSettingKey} />
            </SettingsPage>
          )}

          {section === "about" && (
            <SettingsPage title="关于与更新" desc="版本、更新与诊断。">
              <AboutSection
                version={about?.version ?? null}
                updateMsg={updateMsg}
                onCheckUpdate={checkUpdate}
                updateManifestUrl={settings?.updateManifestUrl ?? ""}
                onSaveManifest={(url) => { void saveSettingKey("updateManifestUrl", url); }}
              />
              {/* 有新版时给出**去处**：版本 + 更新说明 + 打开下载页（只走主进程通道）。 */}
              {update.kind === "available" && (
                <UpdateOffer
                  version={update.version}
                  url={update.url}
                  notes={update.notes}
                  error={update.openError}
                  onError={onUpdateOpenError}
                />
              )}
            </SettingsPage>
          )}
        </div>
        {flash !== null && (
          <div className="sp-save-flash" role="status" aria-live="polite">{flash}</div>
        )}
      </div>
    </ModalSurface>
  );
}

// 旧组件导出的 ProviderInfo 引用保留（外部按需）——避免未使用告警的清理由编译器把关。
export type { ProviderInfo };
