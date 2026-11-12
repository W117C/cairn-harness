// 模型与 Provider 段（第 1072 页从 settings-sections.tsx 按区拆分）——当前通道与密钥 / 能力两分区。
// 私有 PROVIDER_LABELS 随段走；纯函数资产（providerStatusParts / providerNeedsKey / visionCapabilityLabel）
// 从叶子模块 ./provider-assets 读（不 import monolith，无回流环）；monolith 重导出保旧 import 面。
import { useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import { Plus } from "lucide-react";
import type { AppSettings } from "../../../../../../src/main/ipc-protocol";
import { Badge, Field, SettingsSection, SettingsRow, StatusDot } from "../settings-ui";
import { STR } from "../../strings";
import { CustomProviderForm } from "../CustomProviderForm";
import { providerNeedsKey, providerStatusParts, visionCapabilityLabel } from "./provider-assets";

// ── 模型与 Provider 三段（当前通道与密钥 / 联网搜索 / 自定义接口）──────────

/** 供应商显示名（2026-10-24 参照 Codex 供应商页的左列表）：kind id 是机器名，界面上给人话。 */
const PROVIDER_LABELS: Record<string, string> = {
  demo: "Demo",
  glm: STR.provider.glmLabel,
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

export function ProviderSection(props: {
  settings: AppSettings | null;
  status: { available: boolean; stored: string[]; envActive: boolean };
  /** 已知供应商清单（内置 + 已装自定义）——来自 getProviderInfo，不再写死四个。 */
  providers: readonly { id: string; label: string; custom: boolean }[];
  /** 全量真模型（按 provider 归数给自定义供应商的详情用）。 */
  models: readonly { id: string; provider: string }[];
  /** 能力读数只消费 search/searchEndpoint/vision 三格（结构子集，同 searchCapabilityLabel 的口径）。
   *  vision 是 2026-10-16 加的：把「模型声明了图片输入」与「上游真的看得懂」分开——
     *  前者是配置事实，后者要带凭据实测，而后者今天一次都没有做过。 */
  cap: { search: { kind: "unset" } | { kind: "ok" } | { kind: "broken"; message: string }; searchEndpoint?: string;
    vision: { state: "declared" | "undeclared" | "unverified"; modelId: string | null; declaredModalities: readonly string[] } } | null;
  /** 能力读取失败的原因（cap 为 null 且此值非空 ⇒ 显示错误，不显示「正在读取配置…」）。 */
  capError?: string | null;
  keyProvider: string;
  onKeyProviderChange: (p: string) => void;
  keyInputRef: MutableRefObject<HTMLInputElement | null>;
  busy: boolean;
  onSaveKey: () => void;
  onDeleteKey: (p: string) => void;
  checkMsg: { tone: "wait" | "ok" | "err"; text: string; hint?: string } | null;
  onCheck: () => void;
  onCustomSaved: () => void;
  /** 直接进入可填写和测试的联网设置。 */
  onOpenSearch: () => void;
}): React.JSX.Element {
  const provider = props.settings?.provider ?? "—";
  // 分区头给人话名字（DeepSeek），不印配置里的机器 id（deepseek）；未登记才回落原值。
  const providerLabel = useMemo(() => props.providers.find((p) => p.id === provider)?.label ?? provider, [props.providers, provider]);
  const statusParts = providerStatusParts(props.status);
  const capErrorText = props.cap === null && (props.capError ?? "") !== ""
    ? STR.provider.capReadFailedPrefix + props.capError
    : null;
  // 换选中的供应商即清空 key 输入框：输入框里残留的是**上一个通道**的半截输入，留着必出错。
  useEffect(() => {
    if (props.keyInputRef.current !== null) props.keyInputRef.current.value = "";
  }, [props.keyProvider, props.keyInputRef]);
  // 自定义供应商的选中态：点列表里的自定义行 = 在右详情**就地编辑**（表单预填，同名覆盖）。
  const [customSelId, setCustomSelId] = useState<string | null>(null);
  // 第 1151 页：自定义供应商列表与编辑项按 providers/选择记忆；表单输入不重扫。
  const customs = useMemo(() => props.providers.filter((p) => p.custom), [props.providers]);
  const activeCustom = customSelId !== null && customs.some((p) => p.id === customSelId) ? customSelId : null;
  // 新增模式：点「添加供应商」= 详情里出一张空白自定义表单（原独立卡合并进详情，2026-10-24 业主）。
  const [addMode, setAddMode] = useState(false);
  // 已装自定义供应商的预填数据（编辑表单的回填源；不含 key 明文）。
  const [customEntries, setCustomEntries] = useState<readonly { id: string; label: string; protocol: string; baseURL: string; apiKeyEnv: string; modelIds: readonly string[] }[]>([]);
  // 读取失败不能一直停在「正在读取配置…」：那会把 IPC 失败伪装成加载中（第 1086 页）。
  const [customLoadError, setCustomLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (activeCustom === null && !addMode) return;
    setCustomLoadError(null);
    setCustomEntries([]);
    void window.agent.providerCustomList().then((r) => {
      if (r.ok) setCustomEntries(r.entries);
      else setCustomLoadError(r.error ?? STR.provider.loadConfigUnknownError);
    }).catch((err: unknown) => {
      setCustomLoadError(err instanceof Error ? err.message : String(err));
    });
  }, [activeCustom, addMode, props.onCustomSaved]);
  const editingEntry = useMemo(() => activeCustom !== null ? customEntries.find((e) => e.id === activeCustom) ?? null : null, [customEntries, activeCustom]);
  return (
    <>
      {/* 摘要进分区头（第 892 页）：分区名已经写着「当前通道与密钥」，下面第一行又贴一次
          「当前通道」⇒ 同一屏两处同词，而那一行的全部内容就是一枚值 + 六个字。
          现在值与生效时机挂在分区标题右侧，读到的顺序不变（先结论、再列表/表单）。 */}
      {/* 分区头只留结论：当前通道与其生效时机放一句人话，不再把名词、标签、短句挤成三截。 */}
      <SettingsSection title={STR.provider.channelTitle} hint={STR.provider.channelHint.replace("{provider}", providerLabel)}>
        {/* 供应商管理（2026-10-24 参照 Codex 供应商页）：左列表（状态点=已存 key）选通道，
            右侧详情 = 该通道的密钥表单（标签在上、字段整行）。换选中即清空 key 输入框。 */}
        <div className="pv-split">
          <div className="pv-list" role="tablist" aria-label={STR.provider.providersAria}>
            {(props.providers.filter((p) => !p.custom && providerNeedsKey(p.id))).map((p) => (
              <button
                key={p.id}
                className={"pv-item" + (activeCustom === null && props.keyProvider === p.id ? " on" : "")}
                role="tab"
                aria-selected={activeCustom === null && props.keyProvider === p.id}
                onClick={() => { setCustomSelId(null); setAddMode(false); props.onKeyProviderChange(p.id); }}
              >
                <StatusDot tone={props.status.stored.includes(p.id) ? "ok" : "off"} />
                <span className="pv-item-name">{PROVIDER_LABELS[p.id] ?? p.label}</span>
                {props.settings?.provider === p.id && <span className="sp-tag">{STR.provider.currentTag}</span>}
              </button>
            ))}
            {customs.length > 0 && <div className="pv-list-label">{STR.provider.customGroup}</div>}
            {customs.map((p) => (
              <button
                key={p.id}
                className={"pv-item" + (activeCustom === p.id ? " on" : "")}
                role="tab"
                aria-selected={activeCustom === p.id}
                onClick={() => { setAddMode(false); setCustomSelId(p.id); }}
              >
                <StatusDot tone={props.status.stored.includes(p.id) ? "ok" : "off"} />
                <span className="pv-item-name">{p.label}</span>
                {props.settings?.provider === p.id && <span className="sp-tag">{STR.provider.currentTag}</span>}
              </button>
            ))}
            <button
              className={"pv-add" + (addMode ? " on" : "")}
              aria-pressed={addMode}
              onClick={() => { setCustomSelId(null); setAddMode(true); }}
            >
              <Plus size={12} aria-hidden="true" />
              <span>{STR.provider.addProvider}</span>
            </button>
          </div>
          <div className="pv-detail">
            {activeCustom !== null ? (
              <>
                <div className="pv-detail-head">
                  <span className="pv-detail-name">{customs.find((p) => p.id === activeCustom)?.label ?? activeCustom}</span>
                </div>
                {/* 就地编辑：表单预填已存配置，保存按同名覆盖（2026-10-24 业主：两块合并）。
                    key = 编辑/新增分支各持独立实例——条件链同位复用会把上一家的预填带进新增表单。 */}
                {editingEntry === null ? (
                  customLoadError !== null ? (
                    <div className="sp-note err" role="alert">{STR.provider.loadConfigFailedPrefix}{customLoadError}</div>
                  ) : (
                    <div className="ap-empty">{STR.provider.loadingConfig}</div>
                  )
                ) : (
                  <CustomProviderForm key={`edit-${activeCustom}`} editing={editingEntry} onSaved={() => { props.onCustomSaved(); }} />
                )}
              </>
            ) : addMode ? (
              <>
                <div className="pv-detail-head">
                  <span className="pv-detail-name">{STR.provider.addProvider}</span>
                </div>
                <CustomProviderForm key="add" onSaved={() => { setAddMode(false); props.onCustomSaved(); }} />
              </>
            ) : (
              <>
                <div className="pv-detail-head">
                  <span className="pv-detail-name">{PROVIDER_LABELS[props.keyProvider] ?? props.keyProvider}</span>
                  <button
                    type="button"
                    className="mini-btn"
                    disabled={props.checkMsg?.tone === "wait"}
                    title={STR.provider.checkTitle.replace("{provider}", props.keyProvider)}
                    onClick={props.onCheck}
                  >
                    {STR.provider.checkConnection}
                  </button>
                </div>
                {/* key 只进系统钥匙串，不落明文文件。 */}
                <div className="ss-field-block">
                  <label className="ss-flabel" htmlFor="provider-api-key">API Key</label>
                  <div className="ss-frow">
                    <Field width="full">
                      <input id="provider-api-key" ref={props.keyInputRef} type="password" aria-label="API key" placeholder={STR.provider.apiKeyPlaceholder} />
                    </Field>
                    <button className="mini-btn primary" disabled={props.busy} onClick={props.onSaveKey}>
                      {props.busy ? STR.provider.saveBusy : STR.provider.saveKey}
                    </button>
                  </div>
                </div>
                <div className="ss-key-status">
                  {statusParts.stored.filter((p) => p === props.keyProvider).map((p) => (
                    <Badge key={p} onRemove={() => props.onDeleteKey(p)} removeLabel={STR.provider.removeKey.replace("{provider}", p)}>{p}</Badge>
                  ))}
                  {statusParts.line !== "" && (
                    <span className={"ss-hint" + (statusParts.tone === "warn" ? " err" : "")}>{props.status.available ? statusParts.line : STR.provider.safeStorageBlocked}</span>
                  )}
                  {statusParts.envHint !== null && <span className="ss-hint tip">{statusParts.envHint}</span>}
                </div>
                {props.checkMsg !== null && (
                  <div className={`sp-note ${props.checkMsg.tone === "ok" ? "ok" : props.checkMsg.tone === "err" ? "err" : ""}`} role="status">
                    {props.checkMsg.text}
                    {props.checkMsg.hint !== undefined && <div className="sp-dim">{props.checkMsg.hint}</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={STR.provider.capabilitiesTitle}>
        <SettingsRow label={STR.provider.webSearch}>
          <div className="ss-search">
            <StatusDot tone={props.cap?.search.kind === "ok" ? "ok" : "off"} />
            <span className="ss-search-line">{capErrorText ?? (props.cap === null ? STR.provider.loadingConfig : props.cap.search.kind === "ok" ? STR.provider.searchConfigured : STR.provider.searchUnset)}</span>
            <button type="button" className="mini-btn" onClick={props.onOpenSearch}>{STR.provider.openSearch}</button>
          </div>
        </SettingsRow>
        {/* 识图能力（第 886 页改语法，不改口径）：三态原先是三种右列——一个「—」、
            一整条页面级 Banner、一句 desc 加一枚把句首词重复一遍的「已声明/未验证」药丸
            ⇒ 同一个「能力」分区里两行各说各的话。现在与上一行同一语法：
            状态点 + 状态句；未声明/未验证仍**可扫读**（琥珀点 + 风险墨），
            那句「调用成功 ≠ 看得懂」的原文一字未动。 */}
        <SettingsRow label={STR.provider.vision}>
          <div className="ss-search">
            <StatusDot tone={props.cap === null ? (capErrorText !== null ? "warn" : "off") : props.cap.vision.state === "declared" ? "ok" : props.cap.vision.state === "undeclared" ? "warn" : "off"} />
            <span className="ss-search-line" data-warn={props.cap !== null && props.cap.vision.state !== "declared" ? "true" : undefined}>
              {capErrorText ?? (props.cap === null ? STR.provider.visionLoading : visionCapabilityLabel(props.cap))}
            </span>
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
