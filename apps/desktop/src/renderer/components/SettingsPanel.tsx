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
import { Search, X } from "lucide-react";
import type { AppSettings, CapabilityReadout, ProviderInfo } from "../../../../../src/main/ipc-protocol";
import type { TextSizeSetting } from "../../../../../src/main/settings";
import { SettingsPage } from "./settings-ui";
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
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
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
    void window.agent.getSettings().then((s) => { setS(s); setTextSize(s.textSize); }).catch((err: unknown) => {
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
    setUpdateMsg("检查中…");
    void window.agent.checkUpdate().then((r) => {
      setUpdateMsg(
        r.state === "unconfigured" ? "未配置更新端点"
        : r.state === "error" ? `检查未完成：${r.message}`
        : r.state === "up-to-date" ? "已是最新"
        : `发现新版本 ${r.version}`,
      );
    }).catch((err: unknown) => {
      setUpdateMsg(`检查未完成：${err instanceof Error ? err.message : String(err)}`);
    });
  };

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
          <button className="mini-btn" onClick={props.onClose} aria-label="关闭设置（Esc）">← 返回</button>
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
            <SettingsPage title="通用">
              <GeneralSection
                settings={settings}
                textSize={textSize}
                onSave={(patch) => { void save(patch); }}
                onCtrlTab={saveCtrlTab}
                onTextSize={(next) => { setTextSize(next); void saveSettingKey("textSize", next); }}
              />
            </SettingsPage>
          )}

          {section === "provider" && (
            <SettingsPage title="模型与 Provider">
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
            <SettingsPage title="权限与安全">
              <PermissionsSection settings={settings} onSave={(patch) => { void save(patch); }} />
            </SettingsPage>
          )}

          {section === "shortcuts" && (
            <SettingsPage title="快捷键">
              <ShortcutsSection />
            </SettingsPage>
          )}

          {/* 高级段（2026-10-18 补）：这些字段此前一直在 settings 里生效却没有开关。
              走 saveKey 单键直写（不走 panelPatch 白名单——那份白名单与其判卷口径保持原样，
              与 saveCtrlTab 同一条路）。 */}
          {section === "advanced" && settings !== null && (
            <SettingsPage title="高级">
              <AdvancedSection settings={settings} onSaveKey={saveSettingKey} />
            </SettingsPage>
          )}

          {section === "about" && (
            <SettingsPage title="关于与更新">
              <AboutSection
                version={about?.version ?? null}
                updateMsg={updateMsg}
                onCheckUpdate={checkUpdate}
                updateManifestUrl={settings?.updateManifestUrl ?? ""}
                onSaveManifest={(url) => { void saveSettingKey("updateManifestUrl", url); }}
              />
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
