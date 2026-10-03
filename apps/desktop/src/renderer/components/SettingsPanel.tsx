// 设置面板（M4-2，§13 设置页的 renderer 面）：凭据（BYOK）/ 默认权限档 / 默认模型 / 主题 / 方案门缺省。
// 数据面全部走已 wired 的 AgentApi：getSettings/setSettings、providerKeySet/Delete/Status；
// 目录刷新（M2 deferred 收口）经 onSettingsSaved 回调交还 App——setSettings 成功 ⇒ App 重拉
// getProviderInfo，会话条 ModelPicker 的目录/缺省显示随 settings.provider 立即跟上。
//
// 明文零落盘的 UI 面（本组件的纪律线）：
// - key 输入框是**非受控** input（ref 取值）：明文不进任何 React state，更不进 settings/日志/事件流；
// - 保存成功立即清空输入框；失败只展示 main 侧固定文案（providerKeySet 的错误不含 key 值）；
// - providerKeyStatus 本就不含 key 值（available/stored/envActive 三字段）。
//
// patch 白名单：本组件对 setSettings 的全部调用都经 panelPatch()——只放行
// provider/model/mode/theme/planRequiredByDefault 五键，不透传任意 patch（测试判卷）。
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { AppSettings, PermissionMode, ThemeSetting } from "../../../../../src/main/settings";
// 运行时 import 只走 dep-free 模块：env-keys / permissions/modes 都是零依赖唯一事实源。
// 不 import src/main/settings.ts 的运行时（它拖 node:fs → registry → 四家 adapter 进 renderer
// bundle）——provider 选项集按 settings.ts 逐字同形再推导，等值由 settings-panel.test 对账钉住。
import { ENV_KEYED_PROVIDERS, envKeyOf } from "../../../../../src/providers/env-keys";
import { PERMISSION_MODES } from "../../../../../src/permissions/modes";

// ---- 纯函数出口（settings-panel.test 判卷面）----

/** 面板 provider 选项集：与 src/main/settings.ts 的 PROVIDER_KINDS 定义逐字同形（demo + 四家）。
 *  等值对账在测试里钉死（测试是 node 环境，可以直接 import settings.ts 比对）。 */
export const PANEL_PROVIDER_KINDS = ["demo", ...ENV_KEYED_PROVIDERS] as const;

/** demo 免 key；真实 provider（含未知值，fail-visible）一律要 key。 */
export function providerNeedsKey(kind: string): boolean {
  return kind !== "demo";
}

/** 凭据段状态行三态文案：safeStorage 不可用 / 已存清单 / env 并存提示（不含任何 key 值）。 */
export interface ProviderKeyStatusView {
  available: boolean;
  stored: readonly string[];
  envActive: boolean;
}

export function providerStatusLabel(status: ProviderKeyStatusView): string {
  if (!status.available) return "安全存储不可用：key 无法保存（fail-closed，不落明文）";
  const base = status.stored.length === 0 ? "尚未存储任何 key" : `已存 key：${status.stored.join("、")}`;
  return status.envActive ? `${base}；检测到环境变量 key（env 优先于已存）` : base;
}

/** patch 白名单（任务书 Interfaces 逐字）：面板允许构造的 AppSettings 键面。 */
export const PANEL_PATCH_KEYS = ["provider", "model", "mode", "theme", "planRequiredByDefault"] as const;
export type PanelPatchKey = (typeof PANEL_PATCH_KEYS)[number];
export type PanelPatch = Partial<Pick<AppSettings, PanelPatchKey>>;

/** 只放行白名单五键；undefined 值视同缺席（防止把 undefined 灌进 settings 浅合并盖掉真值）。 */
export function panelPatch(patch: Record<string, unknown>): PanelPatch {
  const out: Record<string, unknown> = {};
  for (const key of PANEL_PATCH_KEYS) {
    const value = patch[key];
    if (value !== undefined) out[key] = value;
  }
  return out as PanelPatch;
}

// ---- 组件 ----

const THEME_OPTIONS: readonly ThemeSetting[] = ["system", "light", "dark"];
const THEME_LABELS: Record<ThemeSetting, string> = { system: "跟随系统", light: "浅色", dark: "深色" };

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function SettingsPanel(props: {
  onClose: () => void;
  /** 任何一笔 setSettings 成功后回调（App 用它重拉 getProviderInfo——M2 deferred 刷新收口）。 */
  onSettingsSaved?: () => void;
}) {
  const [settings, setSettingsState] = useState<AppSettings | null>(null);
  const [modelDraft, setModelDraft] = useState("");
  const [status, setStatus] = useState<ProviderKeyStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // key 输入框非受控（明文零进 state）；保存成功就地清空。
  const keyInput = useRef<HTMLInputElement>(null);

  const refreshKeyStatus = useCallback(() => {
    return window.agent.providerKeyStatus().then(setStatus).catch((err: unknown) => {
      setError(`key 状态读取失败：${errText(err)}`);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void window.agent.getSettings().then((s) => {
      if (!alive) return;
      setSettingsState(s);
      setModelDraft(s.model);
    }).catch((err: unknown) => {
      if (alive) setError(`设置读取失败：${errText(err)}`);
    });
    void refreshKeyStatus();
    return () => { alive = false; };
  }, [refreshKeyStatus]);

  /** 五键白名单出面板：所有保存的唯一通道（含失败 fail-visible；错误条不回显输入内容）。 */
  const save = useCallback(async (patch: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await window.agent.setSettings(panelPatch(patch));
      setSettingsState(next);
      if (patch.model !== undefined) setModelDraft(next.model);
      props.onSettingsSaved?.();
      return true;
    } catch (err) {
      setError(`设置保存失败：${errText(err)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [props.onSettingsSaved]);

  const changeProvider = (kind: string) => {
    // 换 provider 即清 key 输入框：上家打了一半的 key 不能在点「保存」时灌进另一家。
    if (keyInput.current) keyInput.current.value = "";
    void save({ provider: kind });
  };

  const saveModel = () => {
    if (settings === null) return;
    const value = modelDraft.trim();
    if (value === settings.model) return; // 无变化不写盘
    void save({ model: value });
  };

  const saveKey = async () => {
    const input = keyInput.current;
    const provider = settings?.provider;
    if (!input || !provider || providerNeedsKey(provider) === false) return;
    // 明文只在这个局部变量里走一站（IPC → main 的 safeStorage），不进 state/console/错误条。
    const key = input.value;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await window.agent.providerKeySet(provider, key);
      if (r.ok) {
        input.value = ""; // 成功即清输入框（明文零残留）
        setNotice(`已存入 ${provider} 的 key（safeStorage 加密）。重启 cairn 后经启动注入生效；该家已设的环境变量仍优先。`);
        await refreshKeyStatus();
      } else {
        setError(r.error ?? "key 保存失败");
      }
    } catch (err) {
      setError(`key 保存失败：${errText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async (provider: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await window.agent.providerKeyDelete(provider);
      if (r.ok) setNotice(`已删除 ${provider} 的已存 key`);
      else setError(r.error ?? "key 删除失败");
      await refreshKeyStatus();
    } catch (err) {
      setError(`key 删除失败：${errText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    // 安静弹出面（spec §6.1：左栏左下角「设置」入口开），无遮罩层——颜色只用既有变量。
    <div className="settings-popover" role="dialog" aria-label="设置">
      <div className="settings-head">
        <h2>设置</h2>
        <button className="btn-ghost" onClick={props.onClose} aria-label="关闭设置">×</button>
      </div>
      {settings === null ? (
        <div className="settings-hint">载入中…</div>
      ) : (
        <>
          {/* 凭据（BYOK）：provider 预设全集（demo+四家）⇒ 真实家出 key 录入行；stored 列表逐家可删。 */}
          <section className="settings-section">
            <div className="sec-title">凭据（BYOK）</div>
            <label className="settings-row">
              provider
              <select
                aria-label="provider 预设"
                value={settings.provider}
                disabled={busy}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => changeProvider(e.target.value)}
              >
                {PANEL_PROVIDER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === "demo" ? "demo（演示，免 key）" : kind}
                  </option>
                ))}
              </select>
            </label>
            {providerNeedsKey(settings.provider) && (
              <>
                <div className="settings-keyrow">
                  <input
                    ref={keyInput}
                    type="password"
                    aria-label="API key"
                    placeholder="粘贴 API key（仅存本机钥匙串）"
                    disabled={busy}
                  />
                  <button className="btn-primary" disabled={busy} onClick={() => void saveKey()}>保存 key</button>
                </div>
                {envKeyOf(settings.provider) !== null && (
                  <div className="settings-hint">
                    对应环境变量：{envKeyOf(settings.provider)}（该变量在场时优先于已存 key）
                  </div>
                )}
              </>
            )}
            {status !== null && <div className="settings-status">{providerStatusLabel(status)}</div>}
            {status?.available === true && status.stored.length > 0 && (
              <div>
                {status.stored.map((p) => (
                  <div key={p} className="settings-stored">
                    <span>{p}</span>
                    <button className="btn-ghost" disabled={busy} onClick={() => void removeKey(p)}>删除</button>
                  </div>
                ))}
              </div>
            )}
            {notice !== null && <div className="settings-status">{notice}</div>}
          </section>
          {/* 默认权限档：PERMISSION_MODES 全集（松紧序即声明序，唯一事实源在 src/permissions/modes）。 */}
          <section className="settings-section">
            <div className="sec-title">默认权限档</div>
            <label className="settings-row">
              档位
              <select
                aria-label="默认权限档"
                value={settings.mode}
                disabled={busy}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => void save({ mode: e.target.value as PermissionMode })}
              >
                {PERMISSION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <div className="settings-hint">新会话的起始档位；会话内审批卡的「总是允许」是另一条持久面。</div>
          </section>
          {/* 默认模型：settings 为缺省、会话条 ModelPicker 的 per-session 选择覆盖（M2-4 语义）。
              main 侧按注册表校验（未知模型拒绝落盘），错误由此面板同面提示。 */}
          <section className="settings-section">
            <div className="sec-title">默认模型</div>
            <div className="settings-keyrow">
              <input
                type="text"
                aria-label="默认模型"
                value={modelDraft}
                placeholder="留空 = provider 缺省"
                disabled={busy}
                onChange={(e) => setModelDraft(e.target.value)}
                onBlur={saveModel}
              />
              <button className="btn-primary" disabled={busy} onClick={() => void saveModel()}>应用</button>
            </div>
            <div className="settings-hint">留空 = provider 缺省；会话内模型选择器的选择覆盖此缺省（settings 是缺省值，会话选择优先）。</div>
          </section>
          {/* 主题：本任务只落设置面（偏好持久化）；CSS 换肤应用随 M5 接线——文案不假装已生效。 */}
          <section className="settings-section">
            <div className="sec-title">主题</div>
            <label className="settings-row">
              外观
              <select
                aria-label="主题"
                value={settings.theme}
                disabled={busy}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => void save({ theme: e.target.value as ThemeSetting })}
              >
                {THEME_OPTIONS.map((t) => <option key={t} value={t}>{THEME_LABELS[t]}</option>)}
              </select>
            </label>
            <div className="settings-hint">当前版本保存偏好；界面换肤随后续版本接线生效。</div>
          </section>
          {/* 方案门缺省：planRequiredByDefault（settings.ts §plan 模式默认档）。 */}
          <section className="settings-section">
            <div className="sec-title">方案门缺省</div>
            <label className="settings-row">
              <input
                type="checkbox"
                checked={settings.planRequiredByDefault}
                disabled={busy}
                onChange={(e) => void save({ planRequiredByDefault: e.target.checked })}
              />
              新对话默认要求「先批准方案才能写入」
            </label>
            <div className="settings-hint">composer 旁的即时方案开关以此为此后的初值。</div>
          </section>
          {error !== null && <div className="form-error">{error}</div>}
        </>
      )}
    </div>
  );
}
