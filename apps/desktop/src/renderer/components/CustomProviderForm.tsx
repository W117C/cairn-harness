// 设置页「自定义接口」表单（Claude 蓝本 v1 重建）：填地址 + 钥匙 → 拉取模型 → 勾选 → 存盘。
// 2026-10-16（模型/通道页重做）：分步视觉（①地址 ②协议 ③变量名 ④密钥；拉取后面出 ⑤启用模型 + 保存），
// 行走 SettingsRow（220px 标签列、卡内距一致）、控件走 Field（36px/8px、统一宽 ≤420）；逻辑零改动。
// 三条纪律照抄命令行那一侧（两边共用 src 里的同一套核心，行为不分叉）：
//   · 钥匙明文零进 React state（输入框非受控，用 ref 取值）；
//   · 「拉取」零副作用（只调 providerDiscover，不改任何文件；要存必须再点「保存」）；
//   · 缺的字段摆出来（missing 明说"得你自己补"，绝不替用户填假数）。
// 本地端点判定（isLocalEndpointURL）必须被"拉取"与"保存"两处用同一份——这是 2026-10-06
// 「能探测、存不进」事故的回归面（源码级哨兵在 render-structure.test 里钉着）。
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { suggestApiKeyEnv, suggestProviderId, type DiscoveredRow } from "../../../../../src/providers/provider-draft";
import { ACTIVE_REASONING_EFFORTS, normalizeThinkingDeclaration } from "../../../../../src/providers/reasoning";
import { STR } from "../strings";
import { isLocalEndpointURL, selectAllRows } from "./provider-form";
import { ModalSurface } from "./ModalSurface";
import { Field, SettingsRow } from "./settings-ui";

type Protocol = "openai" | "anthropic" | "gemini";

/** 表单里**每个模型一条**的思考声明：支持哪些档（四档里挑，空 = 不支持）+ 首选哪一档。
 *
 *  为什么要有这一格（业主 2026-11-03：「让用户可以自己配置模型思考能力」）：门是照能力表开的，
 *  能力表只认 `reasoningEfforts`；而自定义家（自建 / 中转 / 第三方）今天只有探测能给这个值 ——
 *  `/models` 不自述档位的服务就永远是「不支持」，用户在界面上无处声明。这里把它变成可编辑的。 */
export interface ThinkingDraft {
  levels: string[];
  default: string;
}

/** 声明草稿 → 存盘字段（纯函数）：档位留空 = 不写（= 不支持）；首选为「关」= 不写（缺席即关）。 */
export function declarationPayload(draft: ThinkingDraft | undefined): { reasoningEfforts?: readonly string[]; reasoningDefault?: string } {
  const decl = normalizeThinkingDeclaration(draft?.levels ?? [], draft?.default);
  return {
    ...(decl.levels.length > 0 ? { reasoningEfforts: decl.levels } : {}),
    ...(decl.default !== "off" ? { reasoningDefault: decl.default } : {}),
  };
}

/** 声明的初值（纯函数）：**已存配置优先**——用户手写的声明不许被一次「获取模型」覆盖掉，
 *  没存过的才用探测值（上游 `/models` 自述）。两处都不给 ⇒ 空声明（= 不支持，界面整段禁用）。 */
export function initialDeclarations(
  rows: readonly Pick<DiscoveredRow, "id" | "reasoningEfforts">[],
  saved?: readonly { id: string; reasoningEfforts?: readonly string[]; reasoningDefault?: string }[],
): Record<string, ThinkingDraft> {
  const out: Record<string, ThinkingDraft> = {};
  for (const row of rows) {
    const kept = saved?.find((m) => m.id === row.id);
    const decl = normalizeThinkingDeclaration(
      kept !== undefined ? kept.reasoningEfforts ?? [] : row.reasoningEfforts ?? [],
      kept?.reasoningDefault,
    );
    out[row.id] = { levels: [...decl.levels], default: decl.default };
  }
  return out;
}

/** 勾选的行 + 各自的思考声明 → `providerSave` 的 models 载荷（纯函数；判卷钉在这里）。
 *  声明就是**接线本身**：漏了它，界面上的勾选不会变成能力表里的档位。 */
export function modelsFromPicker(
  rows: readonly DiscoveredRow[],
  selected: Record<string, boolean>,
  thinking: Record<string, ThinkingDraft> = {},
): { id: string; contextWindow?: number; maxOutputTokens?: number; price?: DiscoveredRow["price"]; reasoningEfforts?: readonly string[]; reasoningDefault?: string; inputModalities?: readonly string[] }[] {
  return rows
    .filter((row) => selected[row.id] === true)
    .map((row) => ({
      id: row.id,
      ...(row.contextWindow !== undefined ? { contextWindow: row.contextWindow } : {}),
      ...(row.maxOutputTokens !== undefined ? { maxOutputTokens: row.maxOutputTokens } : {}),
      ...(row.price !== undefined ? { price: row.price } : {}),
      // 声明由用户那格说了算（探测值只是它的初值）：空 = 明确「不支持」。
      ...declarationPayload(thinking[row.id]),
      ...(row.inputModalities !== undefined ? { inputModalities: [...row.inputModalities] } : {}),
    }));
}

/** 档位短词 + 说明（唯一出处 = STR.modelPicker：菜单里的思考段与这里必须同一套词，不另抄一份）。 */
const LEVEL_WORDS: Readonly<Record<string, { short: string; hint: string }>> = {
  low: { short: STR.modelPicker.thinkLow, hint: STR.modelPicker.thinkLowHint },
  medium: { short: STR.modelPicker.thinkMedium, hint: STR.modelPicker.thinkMediumHint },
  high: { short: STR.modelPicker.thinkHigh, hint: STR.modelPicker.thinkHighHint },
  max: { short: STR.modelPicker.thinkMax, hint: STR.modelPicker.thinkMaxHint },
};

interface DiscoverState {
  baseURL: string;
  keyEnv: string;
  protocol: Protocol;
  rows: DiscoveredRow[];
  missing: string[];
  warnings: string[];
  catalogOrigin: string;
  catalogNote?: string;
  /** 上游被截断的条数（>0 要说出来）。 */
  truncated: number;
  matchedProviderId?: string;
}

function rowMeta(row: DiscoveredRow): string {
  return (
    `窗口 ${String(row.contextWindow ?? "—")}｜价 ` +
    (row.price === undefined
      ? "未提供"
      : `${String(row.price.inputPerMTok ?? "?")}/${String(row.price.outputPerMTok ?? "?")}`) +
    `｜${row.origin === "both" ? "探测+目录" : row.origin === "discovery" ? "探测" : "目录"}` +
    `｜思考 ${row.reasoningEfforts !== undefined && row.reasoningEfforts.length > 0 ? row.reasoningEfforts.join("/") : "不支持"}`
  );
}

/** 模型选择弹窗（拉取后自动弹出）：整行点选 + 全选/全不选；关闭由「完成」/遮罩收窗。
 *  选择结果写回表单 selected，保存流程（save 按 selected 过滤）单源不动。
 *
 *  2026-11-03：勾选的行下面多一条**思考声明**（四档勾选 + 首选档）——档位留空 = 该模型不支持思考，
 *  它就照旧在模型菜单里整段禁用（fail-visible，不谎称可调）。 */
export function ModelPickModal(props: {
  rows: readonly DiscoveredRow[];
  selected: Record<string, boolean>;
  busy?: boolean;
  onChange: (next: Record<string, boolean>) => void;
  onDone: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** 每模型的思考声明（缺省 = 全空 = 不支持；旧调用面不受影响）。 */
  thinking?: Record<string, ThinkingDraft>;
  /** 声明改动（唯一出口；表单持有这份状态）。不给 = 只读展示。 */
  onThinkingChange?: (id: string, next: ThinkingDraft) => void;
}): React.JSX.Element {
  const picked = props.rows.filter((row) => props.selected[row.id] === true).length;
  const toggleLevel = (rowId: string, level: string): void => {
    const cur = props.thinking?.[rowId] ?? { levels: [], default: "off" };
    const levels = cur.levels.includes(level) ? cur.levels.filter((l) => l !== level) : [...cur.levels, level];
    // 勾掉首选那一档 ⇒ 首选跟着落回「关」（不许留一个不在支持集里的首选档）。
    const next: ThinkingDraft = { levels, default: levels.includes(cur.default) ? cur.default : "off" };
    props.onThinkingChange?.(rowId, next);
  };
  return (
    <div className="cp-overlay" role="presentation" onClick={props.onDone}>
      <ModalSurface
        className="cp-modal"
        label="选择要启用的模型"
        onClose={props.onDone}
        returnFocusRef={props.returnFocusRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cp-modal-head">
          <span className="num">已选 {String(picked)} / {String(props.rows.length)}</span>
          <button className="mini-btn" disabled={props.busy === true} onClick={() => props.onChange(selectAllRows(props.rows, true))}>全选</button>
          <button className="mini-btn" disabled={props.busy === true} onClick={() => props.onChange(selectAllRows(props.rows, false))}>全不选</button>
          <button className="mini-btn primary" onClick={props.onDone}>完成</button>
        </div>
        <div className="cp-modal-list">
          {props.rows.map((row) => {
            const on = props.selected[row.id] === true;
            const draft = props.thinking?.[row.id] ?? { levels: [], default: "off" };
            return (
              <div className="cp-model" key={row.id}>
                <button
                  role="checkbox"
                  aria-checked={on}
                  className={"cp-row" + (on ? " on" : "")}
                  disabled={props.busy === true}
                  onClick={() => props.onChange({ ...props.selected, [row.id]: !on })}
                >
                  <span className="cp-check" aria-hidden="true">{on ? "✓" : ""}</span>
                  <span className="nm mono-k">{row.id}</span>
                  <span className="sub">{rowMeta(row)}</span>
                </button>
                {/* 声明只在勾选的行上摆出来（没启用的模型不需要声明），且只在可编辑时摆。 */}
                {on && props.onThinkingChange !== undefined && (
                  <div className="cp-th" role="group" aria-label={`${row.id} 的思考档位`}>
                    {ACTIVE_REASONING_EFFORTS.map((lv) => {
                      const word = LEVEL_WORDS[lv];
                      const pickedLevel = draft.levels.includes(lv);
                      return (
                        <button
                          key={lv}
                          type="button"
                          className="cp-th-chip"
                          aria-pressed={pickedLevel}
                          title={word?.hint}
                          disabled={props.busy === true}
                          onClick={() => toggleLevel(row.id, lv)}
                        >{word?.short ?? lv}</button>
                      );
                    })}
                    <label className="cp-th-def">
                      <span>首选</span>
                      <select
                        aria-label={`${row.id} 的首选思考档`}
                        value={draft.default}
                        disabled={props.busy === true}
                        onChange={(e) => props.onThinkingChange?.(row.id, { levels: draft.levels, default: e.target.value })}
                      >
                        <option value="off">{STR.modelPicker.thinkOff}</option>
                        {ACTIVE_REASONING_EFFORTS.filter((lv) => draft.levels.includes(lv)).map((lv) => (
                          <option key={lv} value={lv}>{LEVEL_WORDS[lv]?.short ?? lv}</option>
                        ))}
                      </select>
                    </label>
                    {/* 空档位 = 不支持思考：明说，别让用户以为「勾了才有档」是显示问题。 */}
                    {draft.levels.length === 0 && <span className="cp-th-note">未勾选档位 = 该模型不支持思考（选择器里整段禁用）</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ModalSurface>
    </div>
  );
}

export function CustomProviderForm(props: {
  /** 保存成功后通知外层：设置页据此重拉 provider 清单，App 据此重拉模型面。 */
  onSaved?: () => void;
  /** 编辑模式（2026-10-24 业主：自定义供应商在右详情就地编辑）：预填已存配置，保存按同名覆盖。
   *  null/缺席 = 新增模式（原行为）。
   *  `models` 是每个模型已存的**思考声明**（2026-11-03）：有了它，改 key 再保存不会把用户手写的
   *  `reasoningEfforts` / `reasoningDefault` 冲掉；缺席 = 按探测值回填（老载荷/CLI 路径）。 */
  editing?: {
    id: string;
    label: string;
    protocol: string;
    baseURL: string;
    apiKeyEnv: string;
    modelIds: readonly string[];
    models?: readonly { id: string; reasoningEfforts?: readonly string[]; reasoningDefault?: string }[];
  } | null;
}): React.JSX.Element {
  const [baseURL, setBaseURL] = useState("");
  const [protocol, setProtocol] = useState<Protocol>("openai");
  const [busy, setBusy] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoverState | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  /** 每个模型一条的思考声明（唯一出口 = 选择弹窗里的那条；保存时逐条落盘）。 */
  const [thinking, setThinking] = useState<Record<string, ThinkingDraft>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const pickerButton = useRef<HTMLButtonElement | null>(null);
  // 编辑模式预填：baseURL/protocol 从已存配置回填；key 留空 = 不修改（保存时 keyValue 空串即不改）。
  useEffect(() => {
    if (props.editing === null || props.editing === undefined) return;
    setBaseURL(props.editing.baseURL);
    setProtocol(props.editing.protocol as Protocol);
  }, [props.editing?.id]);

  const refresh = useCallback(async () => {
    setError(null);
    setNotice(null);
    setDiscovered(null);
    if (baseURL.trim() === "") {
      setError("先填接口地址（如 https://api.deepseek.com/v1）");
      return;
    }
    const keyEnv = suggestApiKeyEnv(suggestProviderId(baseURL).id);
    setBusy(true);
    try {
      const keyValue = keyInput.current?.value ?? "";
      const r = await window.agent.providerDiscover({
        baseURL: baseURL.trim(),
        protocol,
        keyEnv: keyEnv.trim(),
        ...(keyValue !== "" ? { keyValue } : {}),
        ...(isLocalEndpointURL(baseURL.trim()) ? { allowLocal: true } : {}),
      });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setDiscovered({ ...r, baseURL: baseURL.trim(), keyEnv: keyEnv.trim(), protocol });
      const savedIds = props.editing?.modelIds;
      const all: Record<string, boolean> = {};
      for (const row of r.rows) all[row.id] = savedIds === undefined ? true : savedIds.includes(row.id);
      setSelected(all);
      // 思考声明的初值：已存的手写声明优先，其余用探测值（见 initialDeclarations）。
      setThinking(initialDeclarations(r.rows, props.editing?.models));
      setPickerOpen(true); // 拉到清单直接弹选择窗，别让用户在表单里翻一整面墙
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [baseURL, protocol]);

  const save = useCallback(async () => {
    if (discovered === null) return;
    // 载荷构造抽成纯函数（判卷钉在那里）：勾选 × 每个模型自己的思考声明 → models 数组。
    const models = modelsFromPicker(discovered.rows, selected, thinking);
    if (models.length === 0) {
      setError("一条都没勾：至少选一个模型再存");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const keyValue = keyInput.current?.value ?? "";
      const r = await window.agent.providerSave({
        providerId: suggestProviderId(discovered.baseURL).id,
        label: props.editing?.label ?? suggestProviderId(discovered.baseURL).id,
        protocol: discovered.protocol,
        baseURL: discovered.baseURL,
        apiKeyEnv: discovered.keyEnv,
        // 拉取那一步用过的同一个判定，必须也在保存时说一遍：漏了它就等于"能探测、存不进"。
        ...(isLocalEndpointURL(discovered.baseURL) ? { allowLocalEndpoint: true } : {}),
        models,
        ...(keyValue !== "" ? { keyValue } : {}),
      });
      if (!r.ok) {
        const detail = (r.problems ?? []).map((p) => `${p.where === "" ? "(顶层)" : p.where}：${p.message}`).join("；");
        setError(detail === "" ? r.error : `${r.error}——${detail}`);
        return;
      }
      // 保存完直接把它设成当前通道；但这一步必须与"保存"分开报（保存已落盘，只是切没切过去是两件事）。
      // 编辑模式沿用原 id/label（同名覆盖）；新增模式按 baseURL 推导。
      const providerId = props.editing?.id ?? suggestProviderId(discovered.baseURL).id;
      const firstModel = models[0]?.id ?? "";
      let switchNote = "，并已设为当前通道";
      try {
        await window.agent.setSettings({ provider: providerId, ...(firstModel !== "" ? { model: firstModel } : {}) });
      } catch (err) {
        switchNote = `。但**没能自动切过去**（${err instanceof Error ? err.message : String(err)}）——可以在模型菜单里手动选它`;
      }
      setNotice(
        `已保存 ${String(models.length)} 个模型${switchNote}。可在对话输入框选择使用，密钥已安全保存在本机。`,
      );
      props.onSaved?.();
      // 保存后清空表单（新增模式），避免把上一家的密钥带到另一家；编辑模式保留预填继续改。
      if (keyInput.current) keyInput.current.value = "";
      if (props.editing === null || props.editing === undefined) {
        setBaseURL("");
        setProtocol("openai");
      }
      setDiscovered(null);
      setSelected({});
      setThinking({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [discovered, selected, thinking, props]);

  const localHint = baseURL.trim() !== "" && isLocalEndpointURL(baseURL.trim());
  // 2026-10-16（模型/通道页重做）：行改 SettingsRow（220px 标签列，卡内距与其余卡一致）、
  // 控件走 Field（36px/8px/统一宽 ≤420、select 自绘箭头）；顶部说明压一行、全文收进「帮助」。
  const step = (n: number, text: string): React.JSX.Element => (
    <><span className="ss-step">{String(n)}</span>{text}</>
  );
  return (
    <section className="ap-sec">
      <div className="cp-intro">
        <p className="cp-intro-line">
          {(props.editing === null || props.editing === undefined)
            ? "填写接口地址和 API Key，获取模型后勾选保存。"
            : `编辑「${props.editing.label}」：改完重新「获取模型」勾选保存（同名覆盖，输入框的模型选择不受影响）。`}
        </p>
        <details className="ss-help">
          <summary>帮助</summary>
          <div className="ss-help-body">
            支持兼容 OpenAI、Anthropic 和 Gemini 的模型服务。密钥通过系统安全存储保存，获取到模型后选择要启用的项目即可。
          </div>
        </details>
      </div>
      <SettingsRow label={step(1, "接口地址")}>
        <Field width="full">
          <input
            type="text"
            aria-label="自定义接口地址"
            value={baseURL}
            placeholder="https://api.deepseek.com/v1"
            disabled={busy}
            onChange={(e) => setBaseURL(e.target.value)}
          />
        </Field>
        {localHint && <span className="sp-tag">本地模型服务</span>}
      </SettingsRow>
      <SettingsRow label={step(2, "协议")}>
        <Field width="full" select>
          <select aria-label="自定义接口协议" value={protocol} disabled={busy} onChange={(e) => setProtocol(e.target.value as Protocol)}>
            <option value="openai">openai（含 DeepSeek / GLM / 中转）</option>
            <option value="anthropic">anthropic</option>
            <option value="gemini">gemini</option>
          </select>
        </Field>
      </SettingsRow>
      <SettingsRow label={step(3, "API Key")}>
        <Field width="full">
          <input ref={keyInput} type="password" aria-label="自定义接口 API key" placeholder="粘贴 API key（可选）" disabled={busy} />
        </Field>
        <button className="mini-btn" disabled={busy} onClick={() => void refresh()}>获取模型</button>
        <span className="ss-hint">密钥只保存在本机安全存储中。本地免密服务可留空。</span>
      </SettingsRow>

      {discovered !== null && (
        <>
          <div className="sp-note">
            探测到 {String(discovered.rows.length)} 条
            {discovered.matchedProviderId !== undefined ? `｜目录认出：${discovered.matchedProviderId}` : ""}
            ｜目录来源：{discovered.catalogOrigin === "live" ? "刚拉到的" : discovered.catalogOrigin === "cache" ? "本地缓存" : "内置快照"}
            {discovered.truncated > 0 ? `｜另有 ${String(discovered.truncated)} 条未列出` : ""}
          </div>
          {discovered.catalogNote !== undefined && <div className="sp-note">目录：{discovered.catalogNote}</div>}
          <SettingsRow label={step(4, "启用模型")}>
            <button ref={pickerButton} className="mini-btn" disabled={busy} onClick={() => setPickerOpen(true)}>选择模型…</button>
            <span className="ss-hint">
              已选 {String(discovered.rows.filter((row) => selected[row.id] === true).length)} / {String(discovered.rows.length)}
            </span>
          </SettingsRow>
          {discovered.missing.length > 0 && (
            <div className="sp-note">服务未提供以下模型信息：{discovered.missing.join(" / ")}</div>
          )}
          {discovered.warnings.map((w) => (
            <div key={w} className="sp-note">注意：{w}</div>
          ))}
          <SettingsRow label="保存">
            <button className="mini-btn primary" disabled={busy} onClick={() => void save()}>保存到工作区</button>
          </SettingsRow>
          {pickerOpen && (
            <ModelPickModal
              rows={discovered.rows}
              selected={selected}
              {...(busy ? { busy: true } : {})}
              onChange={setSelected}
              onDone={() => setPickerOpen(false)}
              returnFocusRef={pickerButton}
              thinking={thinking}
              onThinkingChange={(id, next) => setThinking((cur) => ({ ...cur, [id]: next }))}
            />
          )}
        </>
      )}
      {error !== null && <div className="sp-note err" role="alert">{error}</div>}
      {notice !== null && <div className="sp-note" role="status">{notice}</div>}
    </section>
  );
}
