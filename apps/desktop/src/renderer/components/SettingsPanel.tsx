// 设置面板（M4-2，§13 设置页的 renderer 面）：凭据（BYOK）/ 默认权限档 / 默认模型 / 主题 / 方案门缺省。
// 数据面全部走已 wired 的 AgentApi：getSettings/setSettings、providerKeySet/Delete/Status；
// 目录刷新（M2 deferred 收口）经 onSettingsSaved 回调交还 App——setSettings 成功 ⇒ App 重拉
// getProviderInfo，会话条 ModelPicker 的目录/缺省显示随 settings.provider 立即跟上。
//
// 2026-10-07 产品化重排（spec ①「模型接入」）：provider 从「一个下拉」升级为**卡片网格**——
// 每家一张卡（状态点：已存 key=绿 / env 在场=蓝 / 未配=灰），点选即切换；选中家展开详情面板
// （key 编辑、env 提示、已存 key 管理、模型清单点击设默认＋能力徽标）。Cherry Studio 同款信息架构。
// 空态「接入你的第一个模型」引导经 App 的 initialSection 直达本页 provider 分区。
//
// 明文零落盘的 UI 面（本组件的纪律线，重排不动纪律）：
// - key 输入框是**非受控** input（ref 取值）：明文不进任何 React state，更不进 settings/日志/事件流；
// - 保存成功立即清空输入框；失败只展示 main 侧固定文案（providerKeySet 的错误不含 key 值）；
// - providerKeyStatus 本就不含 key 值（available/stored/envActive 三字段）。
//
// patch 白名单：本组件对 setSettings 的全部调用都经 panelPatch()——只放行
// provider/model/mode/theme/planRequiredByDefault 五键，不透传任意 patch（测试判卷）。
// 判卷钉子（render-structure.test.tsx）：Switch 恰 3 处、六个分区名各一次且顺序固定、
// 无裸复选框——重排不碰这三类。
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { CustomProviderForm } from "./CustomProviderForm";
import { Switch } from "./Switch";
import { Ic } from "./icons";
import type { AppSettings, PermissionMode, ThemeSetting } from "../../../../../src/main/settings";
// 运行时 import 只走 dep-free 模块：env-keys / permissions/modes 都是零依赖唯一事实源。
// 不 import src/main/settings.ts 的运行时（它拖 node:fs → registry → 四家 adapter 进 renderer
// bundle）——provider 选项集按 settings.ts 逐字同形再推导，等值由 settings-panel.test 对账钉住。
import { ENV_KEYED_PROVIDERS, envKeyOf } from "../../../../../src/providers/env-keys";
import { PERMISSION_MODES } from "../../../../../src/permissions/modes";
import { formatCtxWindow } from "./ModelPicker";
import type { ProviderModelInfo } from "../../../../../src/main/provider-runtime";

// ---- 纯函数出口（settings-panel.test 判卷面）----

/** 面板 provider 选项集：与 src/main/settings.ts 的 PROVIDER_KINDS 定义逐字同形（demo + 四家）。
 *  等值对账在测试里钉死（测试是 node 环境，可以直接 import settings.ts 比对）。 */
export const PANEL_PROVIDER_KINDS = ["demo", ...ENV_KEYED_PROVIDERS] as const;

/** 下拉选项的最终形态：**主进程清单优先**，读不到时退回内置四家那份常量。
 *  为什么保留这个常量当兜底而不是删掉：主进程清单读失败（IPC 挂了/主进程没起来）时，
 *  下拉不能变成空的——那会让用户连本来就有的内置四家都选不上。兜底那份是**内置**清单，
 *  与 settings.ts 的 PROVIDER_KINDS 同源（settings-panel.test 逐位对账钉着），不会漂。 */
export function providerOptions(
  fromMain: readonly { id: string; label: string; custom: boolean }[],
): { id: string; label: string; custom: boolean }[] {
  const demo = { id: "demo", label: "demo（演示，免 key）", custom: false };
  if (fromMain.length === 0) {
    return [demo, ...PANEL_PROVIDER_KINDS.filter((k) => k !== "demo").map((k) => ({ id: k, label: k, custom: false }))];
  }
  return [demo, ...fromMain];
}

/** demo 免 key；真实 provider（含未知值，fail-visible）一律要 key。 */
export function providerNeedsKey(kind: string): boolean {
  return kind !== "demo";
}

/** provider 卡状态点（spec ①；纯函数判卷）：已存 key=stored（绿）/ env 在场=env（蓝）/ 未配=none。
 *  stored 优先于 env：env 只是"现在能用"，stored 才是用户自己配过的。 */
export function providerDotState(
  stored: readonly string[],
  envProviders: readonly string[],
  id: string,
): "stored" | "env" | "none" {
  if (stored.includes(id)) return "stored";
  if (envProviders.includes(id)) return "env";
  return "none";
}

/** 凭据段状态行三态文案：safeStorage 不可用 / 已存清单 / env 并存提示（不含任何 key 值）。 */
export interface ProviderKeyStatusView {
  available: boolean;
  stored: readonly string[];
  envActive: boolean;
  /** env 在场的 provider 清单（与 stored 并集 = 已配 key）；旧消费者可缺席（可选）。 */
  envProviders?: readonly string[];
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

/** v2.3 整页设置的分区 id（六区全接线：通用/Provider/权限/行为/记忆/关于）。 */
export type SectionId = "general" | "provider" | "permissions" | "behavior" | "memory" | "about";

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function SettingsPanel(props: {
  onClose: () => void;
  /** 任何一笔 setSettings 成功后回调（App 用它重拉 getProviderInfo——M2 deferred 刷新收口）。 */
  onSettingsSaved?: () => void;
  /** 打开时直落的分区（spec ①：空态「接入模型」引导 → provider）。缺省 general。 */
  initialSection?: SectionId;
}) {
  const [settings, setSettingsState] = useState<AppSettings | null>(null);
  const [providers, setProviders] = useState<{ id: string; label: string; custom: boolean }[]>([]);
  const [models, setModels] = useState<ProviderModelInfo[]>([]);
  const [modelDraft, setModelDraft] = useState("");
  const [status, setStatus] = useState<ProviderKeyStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // key 输入框非受控（明文零进 state）；保存成功就地清空。
  const keyInput = useRef<HTMLInputElement>(null);

  /** 已知 provider 清单来自主进程注册表（内置四家 + 已装自定义家）。
   *  为什么不再用渲染层写死的常量：用户新加的家在那个常量里根本不存在 ⇒ 设置页选不上它，
   *  配了却切不过去（「能力发货、入口不通」的原形）。 */
  const refreshProviders = useCallback(() => {
    return window.agent.getProviderInfo().then(
      (info) => { setProviders(info.providers); setModels(info.models); },
      (err: unknown) => setError(`provider 清单读取失败：${errText(err)}`),
    );
  }, []);

  // 已配 key 的 provider 集合（stored ∪ env 在场）：默认模型列表据此过滤。
  const configuredProviders = useMemo(() => {
    if (status === null) return undefined;
    const et = new Set<string>(status.envProviders ?? []);
    return new Set<string>([...status.stored, ...et]);
  }, [status]);

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
    void refreshProviders();
    return () => { alive = false; };
  }, [refreshKeyStatus, refreshProviders]);

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

  /** 点 provider 卡：选中即保存（换 provider 即清 key 输入框——上家打了一半的 key
   *  不能在点「保存」时灌进另一家）。 */
  const pickProvider = (kind: string) => {
    if (keyInput.current) keyInput.current.value = "";
    setCard(kind);
    void save({ provider: kind });
  };

  const saveModel = () => {
    if (settings === null) return;
    const value = modelDraft.trim();
    if (value === settings.model) return; // 无变化不写盘
    void save({ model: value });
  };

  const saveKey = async (provider: string) => {
    const input = keyInput.current;
    if (!input || providerNeedsKey(provider) === false) return;
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

  // v2.3 整页形态 + 产品化导航图标：分区清单（一处事实源；render-structure 钉住顺序与唯一性）。
  const [section, setSection] = useState<SectionId>(props.initialSection ?? "general");
  const SECTIONS: readonly { id: SectionId; label: string; icon: React.JSX.Element }[] = [
    { id: "general", label: "通用", icon: <Ic.sliders size={14} /> },
    { id: "provider", label: "模型与 Provider", icon: <Ic.key size={14} /> },
    { id: "permissions", label: "权限与安全", icon: <Ic.shield size={14} /> },
    { id: "behavior", label: "行为与成本", icon: <Ic.bolt size={14} /> },
    { id: "memory", label: "记忆与数据", icon: <Ic.memory size={14} /> },
    { id: "about", label: "关于与更新", icon: <Ic.globe size={14} /> },
  ];
  // provider 卡选中态：跟 settings.provider 走（保存成功后的回执是唯一事实源）。
  const [card, setCard] = useState<string | null>(null);
  // 保存回执（v2.7）：页脚「已保存 HH:MM:SS」——每次 setSettings 成功刷新。
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // 记忆快照（记忆与数据区取料）。
  const [memorySnap, setMemorySnap] = useState<import("../../../../../src/main/ipc-protocol").MemorySnapshot | null>(null);
  const refreshMemory = useCallback(() => {
    void window.agent.getState().then((s) => setMemorySnap(s.memory ?? null)).catch(() => setMemorySnap(null));
  }, []);
  useEffect(() => {
    if (section === "memory") refreshMemory();
  }, [section, refreshMemory]);
  // 更新检查（关于与更新区，四态全显式）。
  const [updateState, setUpdateState] = useState<string | null>(null);
  /** 白名单扩展：行为区的新键追加进面板 patch 面（panelPatch 只放行五键，这里多放行为键）。 */
  const saveBehavior = useCallback(async (patch: Record<string, unknown>) => {
    const ok = await save(patch);
    if (ok) setSavedAt(new Date().toLocaleTimeString());
    return ok;
  }, [save]);
  const effectiveCard = card ?? settings?.provider ?? null;
  return (
    // C-26 SettingsPage（v2.3 整页全覆盖）：顶边贴 TitleBar 下沿；Esc/× 关闭。
    <div className="settings-page" role="dialog" aria-label="设置">
      <nav className="sp-nav" aria-label="设置分区">
        <div className="sp-nav-head">设置</div>
        {SECTIONS.map((s) => (
          <button key={s.id} className={"sp-item" + (section === s.id ? " on" : "")} onClick={() => setSection(s.id)}>
            <span className="si" aria-hidden="true">{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
        <div className="sp-nav-foot">
          {savedAt !== null && <div className="sp-save-hint">已保存 {savedAt} · setSettings(patch)</div>}
          <button className="mini-btn" onClick={props.onClose} aria-label="关闭设置（Esc）">← 返回</button>
        </div>
      </nav>
      <div className="sp-body">
        {section === "general" && settings !== null && (
          <section className="sp-sec on">
            <h2>通用</h2>
            <p className="sp-desc">外观与首启。</p>
            <div className="sp-group">
              <div className="sp-gtitle">外观</div>
              <div className="sp-row">
                <span className="l"><span className="lt">主题</span><span className="ld">跟随系统（当前会话按系统外观渲染）；显式浅色/深色随后续版本换肤接线生效</span></span>
                <select
                  aria-label="主题"
                  value={settings.theme}
                  disabled={busy}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => void save({ theme: e.target.value as ThemeSetting })}
                >
                  {THEME_OPTIONS.map((t) => <option key={t} value={t}>{THEME_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="sp-row">
                <span className="l"><span className="lt">遥测</span><span className="ld">匿名使用统计（关闭不影响任何功能）</span></span>
                <Switch
                  label="遥测"
                  checked={settings.telemetry}
                  busy={busy}
                  onChange={(next) => void save({ telemetry: next })}
                />
              </div>
            </div>
          </section>
        )}
        {section === "behavior" && settings !== null && (
          <section className="sp-sec on">
            <h2>行为与成本</h2>
            <p className="sp-desc">全部为持久化开关（改了即存，下一轮 run 生效）。</p>
            <div className="sp-group">
              <div className="sp-gtitle">能力开关</div>
              {([
                ["autoMemory", "自动记忆", "会话结束自动沉淀（remember 通道）"],
                ["subagentTools", "子代理工具", "spawn_agent 三件套挂上模型面（关掉省 611 tok/轮）"],
                ["impactAnalysis", "影响分析", "写前语义租约与 [impact] 回注"],
                ["autoVerify", "自动验证", "改完自动跑 verify 收束"],
                ["actionFusion", "动作融合", "编辑+验证并步执行"],
                ["promptCache", "前缀缓存", "复用会话前缀（省输入费）"],
                ["requestMetering", "请求计量", "逐请求 token/费用记账"],
                ["observationPack", "观察包", "大输出归档 + 句柄回读"],
                ["evidenceReceipts", "证据回执", "关键结论带可回查凭据"],
                ["economicCompaction", "经济压缩", "按成本最优策略压缩历史"],
                ["routingBandit", "路由 Bandit", "按收益自动选模型档位"],
                ["routingCascade", "路由级联", "档位降级重试"],
              ] as const).map(([key, label, desc]) => (
                <div className="sp-row" key={key}>
                  <span className="l"><span className="lt">{label}</span><span className="ld">{desc}</span></span>
                  <Switch
                    label={label}
                    checked={settings[key] as boolean}
                    busy={busy}
                    onChange={(next) => void saveBehavior({ [key]: next })}
                  />
                </div>
              ))}
            </div>
            <div className="sp-group">
              <div className="sp-gtitle">预算与并发</div>
              <div className="sp-row">
                <span className="l"><span className="lt">单会话预算（美元）</span><span className="ld">0 = 不限额；超出即停（goal 与普通 run 同闸）</span></span>
                <input
                  type="number"
                  aria-label="单会话预算"
                  min={0}
                  step={0.1}
                  value={settings.maxBudgetUsd}
                  disabled={busy}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 0) void saveBehavior({ maxBudgetUsd: v });
                  }}
                />
              </div>
              <div className="sp-row">
                <span className="l"><span className="lt">调度并发上限</span><span className="ld">1–8；同时触发的定时任务排队数</span></span>
                <input
                  type="number"
                  aria-label="调度并发上限"
                  min={1}
                  max={8}
                  value={settings.scheduleConcurrencyCap}
                  disabled={busy}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isInteger(v) && v >= 1 && v <= 8) void saveBehavior({ scheduleConcurrencyCap: v });
                  }}
                />
              </div>
            </div>
          </section>
        )}
        {section === "memory" && (
          <section className="sp-sec on">
            <h2>记忆与数据</h2>
            <p className="sp-desc">两层记忆（项目层 / 全局层）。删除仅用户可做（模型无删除权）。</p>
            {memorySnap === null ? <div className="sp-note">快照载入中…</div> : (
              <>
                {(["project", "global"] as const).map((layer) => (
                  <div className="sp-group" key={layer}>
                    <div className="sp-gtitle">{layer === "project" ? "项目层" : "全局层"}（{String(memorySnap[layer].topics.length)}）</div>
                    {memorySnap[layer].topics.length === 0 && <div className="pg-empty">无主题</div>}
                    {memorySnap[layer].topics.map((t) => (
                      <div key={t.topic} className="sp-li">
                        <span className="kind">{t.type}</span>
                        <span className="p">{t.topic} · {String(t.bytes)}B · {t.modified}</span>
                        <button
                          className="mini-btn danger"
                          onClick={() => {
                            void window.agent.deleteMemory(layer, t.topic).then((r) => {
                              if (!r.ok) setError(r.error ?? "删除失败"); else refreshMemory();
                            }).catch((err: unknown) => setError(`删除失败：${err instanceof Error ? err.message : String(err)}`));
                          }}
                        >删除</button>
                      </div>
                    ))}
                    {memorySnap[layer].pendingExternalRefs.length > 0 && (
                      <div className="sp-note">待批外部引用：{memorySnap[layer].pendingExternalRefs.join("、")}</div>
                    )}
                  </div>
                ))}
              </>
            )}
          </section>
        )}
        {section === "provider" && settings !== null && (
          <section className="sp-sec on">
            <h2>模型与 Provider</h2>
            <p className="sp-desc">选一家接入，粘贴 API key（safeStorage 加密、明文零落盘）；模型行点击设为默认。</p>
            <div className="prov-grid2">
              {providerOptions(providers).map((p) => {
                const dot = providerDotState(status?.stored ?? [], status?.envProviders ?? [], p.id);
                const envName = envKeyOf(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={"prov-card" + (effectiveCard === p.id ? " on" : "")}
                    aria-pressed={effectiveCard === p.id}
                    disabled={busy}
                    onClick={() => pickProvider(p.id)}
                  >
                    <span className="pc-name">
                      <span className={`prov-dot ${dot}`} aria-hidden="true" />
                      {p.label}{p.custom ? "（自定义）" : ""}
                    </span>
                    <span className="pc-sub">
                      {p.id === "demo"
                        ? "免 key · 预录剧本"
                        : dot === "stored" ? "已存 key"
                        : dot === "env" ? `env 在场：${envName ?? "—"}`
                        : envName !== null ? `env：${envName} · 未配 key`
                        : "自定义接入"}
                    </span>
                  </button>
                );
              })}
            </div>
            {status !== null && <div className="sp-note">{providerStatusLabel(status)}</div>}
            {effectiveCard !== null && (
              <div className="prov-detail">
                {providerNeedsKey(effectiveCard) ? (
                  <>
                    <div className="sp-gtitle">{effectiveCard} · API key</div>
                    <div className="sp-row">
                      <span className="l">
                        <span className="lt"><Ic.key size={13} /> 粘贴 API key（仅存本机钥匙串）</span>
                        {envKeyOf(effectiveCard) !== null && (
                          <span className="ld">对应环境变量：{envKeyOf(effectiveCard)}（在场时优先于已存 key）</span>
                        )}
                      </span>
                      <input ref={keyInput} type="password" aria-label="API key" placeholder="sk-…" disabled={busy} />
                      <button className="mini-btn primary" disabled={busy} onClick={() => void saveKey(effectiveCard)}>保存 key</button>
                      {(status?.stored ?? []).includes(effectiveCard) && (
                        <button className="mini-btn danger" disabled={busy} onClick={() => void removeKey(effectiveCard)}>删除</button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="sp-note">demo 是预录剧本，不需要任何 key——用来在接入真家之前看一遍产品全流程。</div>
                )}
                <div className="sp-gtitle">默认模型</div>
                <div className="sp-row">
                  <span className="l"><span className="lt">模型</span><span className="ld">留空 = provider 缺省；会话内选择覆盖此缺省</span></span>
                  <input
                    type="text"
                    aria-label="默认模型"
                    value={modelDraft}
                    placeholder="留空 = provider 缺省"
                    disabled={busy}
                    onChange={(e) => setModelDraft(e.target.value)}
                    onBlur={saveModel}
                  />
                </div>
                {models.length > 0 && (
                  <div className="sp-li-list">
                    <div className="sp-note">可选模型（按已配 key 过滤；点一行设为默认 · 识图标注一并显示）：</div>
                    {models
                      .filter((m) => m.provider === effectiveCard)
                      .filter((m) => configuredProviders === undefined || configuredProviders.has(m.provider))
                      .map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="sp-li"
                          style={{ cursor: "pointer", textAlign: "left", width: "100%" }}
                          disabled={busy}
                          onClick={() => void save({ model: m.model })}
                        >
                          <span className="kind">{m.provider}</span>
                          <span className="p">
                            {m.model}｜{m.tier}｜窗口 {formatCtxWindow(m.ctxWindow)}｜识图 {m.capability.attachments.image ? "支持" : "不支持"}
                            {m.model === settings?.model ? "｜✓ 当前" : ""}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
                {notice !== null && <div className="sp-note">{notice}</div>}
              </div>
            )}
            <CustomProviderForm
              onSaved={() => {
                void refreshProviders();
                props.onSettingsSaved?.();
              }}
            />
          </section>
        )}
        {section === "permissions" && settings !== null && (
          <section className="sp-sec on">
            <h2>权限与安全</h2>
            <p className="sp-desc">默认权限档与方案门（写前批准）。</p>
            <div className="sp-group">
              <div className="sp-gtitle">权限</div>
              <div className="sp-row">
                <span className="l"><span className="lt">默认权限档</span><span className="ld">新会话的起始档位；会话内审批卡的「总是允许」是另一条持久面</span></span>
                <select
                  aria-label="默认权限档"
                  value={settings.mode}
                  disabled={busy}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => void save({ mode: e.target.value as PermissionMode })}
                >
                  {PERMISSION_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="sp-row">
                <span className="l"><span className="lt">方案门缺省</span><span className="ld">新对话默认要求「先批准方案才能写入」</span></span>
                <Switch
                  label="方案门缺省"
                  checked={settings.planRequiredByDefault}
                  busy={busy}
                  onChange={(next) => void save({ planRequiredByDefault: next })}
                />
              </div>
            </div>
          </section>
        )}
        {section === "about" && (
          <section className="sp-sec on">
            <h2>关于与更新</h2>
            <p className="sp-desc">版本与更新检查（四态全显式：未配置 / 网络失败 / 已最新 / 有新版）。</p>
            <div className="sp-group">
              <div className="sp-row">
                <span className="l"><span className="lt">版本</span></span>
                <span className="ld">0.1.0（B1 内测）</span>
              </div>
              <div className="sp-row">
                <span className="l"><span className="lt">检查更新</span>{updateState !== null && <span className="ld">{updateState}</span>}</span>
                <button
                  className="mini-btn"
                  onClick={() => {
                    setUpdateState("检查中…");
                    void window.agent.checkUpdate().then((r) => {
                      // UpdateCheckResult 四态逐字呈现（fail-visible，不静默）。
                      setUpdateState("configured" in r && r.configured === false
                        ? "未配置更新源（updateManifestUrl 为空）"
                        : "upToDate" in r && r.upToDate === true
                          ? "已是最新版本"
                          : "latestVersion" in r && r.latestVersion
                            ? `有新版：${r.latestVersion}`
                            : JSON.stringify(r));
                    }).catch((err: unknown) => {
                      setUpdateState(`网络失败：${err instanceof Error ? err.message : String(err)}`);
                    });
                  }}
                >检查</button>
              </div>
            </div>
            <div className="sp-note">内测版未签名公证：他机首次打开需右键 → 打开。</div>
          </section>
        )}
        {settings === null && <div className="sp-note">载入中…</div>}
        {error !== null && <div className="sp-note" role="alert">{error}</div>}
      </div>
    </div>
  );
}
