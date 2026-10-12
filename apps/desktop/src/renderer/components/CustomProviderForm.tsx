// S7：设置页里的「自定义接口」表单 —— 填地址 + 钥匙 → 拉取模型 → 勾选 → 存盘。
//
// 三条纪律照抄命令行那一侧（两边共用 src 里的同一套核心，所以行为不会分叉）：
//   · **钥匙明文零进 React state**：输入框是**非受控**的（用 ref 取值），与同页现有的 BYOK 输入框同一条纪律。
//   · **「拉取」零副作用**：它只调 providerDiscover（不改任何文件），要存必须再点「保存」。
//   · **缺的字段摆出来**：目录与探测都没给的项（常见：价格）在界面上明说"得你自己填"，
//     绝不替用户填一个假数（调研里 Cline/Roo 用 128000/0 兜底，它自己的注释承认会把付费请求记成 $0）。
import { useCallback, useEffect, useRef, useState } from "react";
import { suggestApiKeyEnv, suggestProviderId, type DiscoveredRow } from "../../../../../src/providers/provider-draft";
import { Ic } from "./icons";

type Protocol = "openai" | "anthropic" | "gemini";

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

export function CustomProviderForm(props: {
  /** 保存成功后通知外层：设置页据此重拉 provider 清单，App 据此重拉模型面。 */
  onSaved?: () => void;
}): React.JSX.Element {
  const [baseURL, setBaseURL] = useState("");
  const [keyEnv, setKeyEnv] = useState("");
  const [protocol, setProtocol] = useState<Protocol>("openai");
  const [busy, setBusy] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoverState | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // 模型选择弹窗（2026-10-07 业主反馈：一条一条勾太麻烦 → 弹窗 + 全选/全不选）。
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);

  const onUrlBlur = useCallback(() => {
    if (baseURL.trim() === "" || keyEnv.trim() !== "") return;
    const id = suggestProviderId(baseURL);
    setKeyEnv(suggestApiKeyEnv(id.id));
    if (id.note !== undefined) setNotice(id.note);
  }, [baseURL, keyEnv]);

  const refresh = useCallback(async () => {
    setError(null);
    setNotice(null);
    setDiscovered(null);
    if (baseURL.trim() === "") {
      setError("先填接口地址（如 https://api.deepseek.com/v1）");
      return;
    }
    if (keyEnv.trim() === "") {
      setError("先填 key 的环境变量名（如 DEEPSEEK_API_KEY）——我们按变量名读，不把钥匙写进配置文件");
      return;
    }
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
      const all: Record<string, boolean> = {};
      for (const row of r.rows) all[row.id] = true;
      setSelected(all);
      setPickerOpen(true); // 拉到清单直接弹选择窗，别让用户在表单里翻一整面墙
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [baseURL, keyEnv, protocol]);

  const save = useCallback(async () => {
    if (discovered === null) return;
    const models = discovered.rows
      .filter((row) => selected[row.id] === true)
      .map((row) => ({
        id: row.id,
        ...(row.contextWindow !== undefined ? { contextWindow: row.contextWindow } : {}),
        ...(row.maxOutputTokens !== undefined ? { maxOutputTokens: row.maxOutputTokens } : {}),
        ...(row.price !== undefined ? { price: row.price } : {}),
        ...(row.reasoningEfforts !== undefined ? { reasoningEfforts: [...row.reasoningEfforts] } : {}),
        ...(row.inputModalities !== undefined ? { inputModalities: [...row.inputModalities] } : {}),
      }));
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
        label: suggestProviderId(discovered.baseURL).id,
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
      // 保存完直接把它设成当前通道：用户的意图就是「我要用它」，让他在设置里再点一次 provider
      // 下拉是多余的一步（那一步的缺失正是「填完了但对话页还是演示」的原因）。
      //
      // 但这一步**必须与"保存"分开报**：走到这里时配置已经落盘、也已经装上了，
      // 只是没能切过去而已。2026-10-06 实测就出过这种局面（写设置通道当时还拿着内置清单），
      // 两条混成一个红字错误，用户以为整个操作白做了。
      const providerId = suggestProviderId(discovered.baseURL).id;
      const firstModel = models[0]?.id ?? "";
      let switchNote = "，并已设为当前通道";
      try {
        await window.agent.setSettings({ provider: providerId, ...(firstModel !== "" ? { model: firstModel } : {}) });
      } catch (err) {
        switchNote = `。但**没能自动切过去**（${err instanceof Error ? err.message : String(err)}）——可以在上面的 provider 下拉里手动选它`;
      }
      setNotice(
        `已保存：${providerId}（文件 ${r.path}，${String(r.providers.length)} 家，本次装上 ${String(r.installed)} 家；默认模型 ${firstModel === "" ? "未指定" : firstModel}）${switchNote}。key 走 safeStorage，明文不落盘。`,
      );
      props.onSaved?.();
      // 2026-10-07 用户实测踩到：原来只清钥匙输入框，**没清地址与变量名** ⇒ 接着加第二家时
      // 那两格还留着上一家的值（变量名尤其危险：两家共用一个 env，钥匙互相覆盖、上游报 401）。
      // 保存成功 = 这一家的事办完了，整份表单归零，下一家从干净的格子开始。
      if (keyInput.current) keyInput.current.value = "";
      setBaseURL("");
      setKeyEnv("");
      setProtocol("openai");
      setDiscovered(null);
      setSelected({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [discovered, selected]);

  return (
    <div className="sp-group">
      <div className="sp-gtitle">自定义接口（接自己的模型，不改源码）</div>
      <p className="sp-desc">
        填地址与 key 的环境变量名 → 拉取模型清单 → 勾选要用的 → 保存。会写进本工作区的
        <code>.agent/providers.json</code>；「拉取」不改任何文件。
      </p>
      <div className="sp-row">
        <span className="l"><span className="lt">接口地址</span><span className="ld">OpenAI 兼容填到 /v1 这一层</span></span>
        <input
          type="text"
          aria-label="自定义接口地址"
          value={baseURL}
          placeholder="https://api.deepseek.com/v1"
          disabled={busy}
          onChange={(e) => setBaseURL(e.target.value)}
          onBlur={onUrlBlur}
        />
      </div>
      <div className="sp-row">
        <span className="l"><span className="lt">协议</span><span className="ld">复用现有三支适配器</span></span>
        <select aria-label="自定义接口协议" value={protocol} disabled={busy} onChange={(e) => setProtocol(e.target.value as Protocol)}>
          <option value="openai">openai（含 DeepSeek / GLM / 中转）</option>
          <option value="anthropic">anthropic</option>
          <option value="gemini">gemini</option>
        </select>
      </div>
      <div className="sp-row">
        <span className="l">
          <span className="lt">key 环境变量名</span>
          <span className="ld">填变量的**名字**（不是钥匙）；配置文件里只存这个名字</span>
        </span>
        <input
          type="text"
          aria-label="自定义接口 key 环境变量名"
          value={keyEnv}
          placeholder="DEEPSEEK_API_KEY"
          disabled={busy}
          onChange={(e) => setKeyEnv(e.target.value)}
        />
      </div>
      {envNameHint(keyEnv) !== null && <div className="sp-note warn">{envNameHint(keyEnv)}</div>}
      <div className="sp-row">
        <span className="l">
          <span className="lt">API key</span>
          <span className="ld">只存本机钥匙串；本地端点多数不校验，随便填一个也行；也可以留空只设环境变量</span>
        </span>
        <input ref={keyInput} type="password" aria-label="自定义接口 API key" placeholder="粘贴 API key（可选）" disabled={busy} />
        <button className="mini-btn" disabled={busy} onClick={() => void refresh()}>拉取模型</button>
      </div>

      {discovered !== null && (
        <>
          <div className="sp-note">
            探测到 {String(discovered.rows.length)} 条
            {discovered.matchedProviderId !== undefined ? `｜目录认出：${discovered.matchedProviderId}` : ""}
            ｜目录来源：{discovered.catalogOrigin === "live" ? "刚拉到的" : discovered.catalogOrigin === "cache" ? "本地缓存" : "内置快照"}
            {discovered.truncated > 0 ? `｜另有 ${String(discovered.truncated)} 条未列出` : ""}
          </div>
          {discovered.catalogNote !== undefined && <div className="sp-note">目录：{discovered.catalogNote}</div>}
          {/* 2026-10-07 业主反馈：清单铺在表单里一条条勾太麻烦 → 收进弹窗（全选/全不选 + 整行点选）。
              表单上只留一行摘要 + 「选择模型」入口；保存流程不变（save() 仍按 selected 过滤）。 */}
          {(() => {
            const total = discovered.rows.length;
            const picked = discovered.rows.filter((row) => selected[row.id] === true).length;
            return (
              <div className="sp-row">
                <span className="l">
                  <span className="lt">启用模型</span>
                  <span className="ld">已选 {String(picked)} / {String(total)}；点「选择模型」批量增减（支持全选 / 全不选）</span>
                </span>
                <button className="mini-btn" disabled={busy} onClick={() => setPickerOpen(true)}>选择模型…</button>
              </div>
            );
          })()}
          {discovered.missing.length > 0 && (
            <div className="sp-note">这几项目录也查不到，存下来之后得你自己补：{discovered.missing.join(" / ")}</div>
          )}
          {discovered.warnings.map((w) => (
            <div key={w} className="sp-note">注意：{w}</div>
          ))}
          <div className="sp-row">
            <span className="l"><span className="lt">保存</span><span className="ld">写入工作区配置并立即生效</span></span>
            <button className="mini-btn primary" disabled={busy} onClick={() => void save()}>保存到工作区</button>
          </div>
          {pickerOpen && (
            <ModelPickModal
              rows={discovered.rows}
              selected={selected}
              {...(busy ? { busy: true } : {})}
              onChange={setSelected}
              onDone={() => setPickerOpen(false)}
            />
          )}
        </>
      )}
      {error !== null && <div className="sp-note err">{error}</div>}
      {notice !== null && <div className="sp-note">{notice}</div>}
    </div>
  );
}

/** 本地/内网地址判定（与服务端 approve 的口径保持一致：loopback + 私网段 + *.local）。
 *  抽成导出函数是因为**它必须被用两次**：拉取（allowLocal）与保存（allowLocalEndpoint）。
 *  2026-10-06 实测踩到：第一版只在拉取那一步用了它，于是「拉取成功但保存被拒」——
 *  服务端报「只允许 https / 127.0.0.1 是本地地址」，而用户根本没地方表达"我就是要走本地"。 */
export function isLocalEndpointURL(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return /^(localhost|127\.|\[?::1\]?|0\.0\.0\.0)/i.test(url.trim());
  }
  if (host === "localhost" || host === "::1" || host === "[::1]" || host === "0.0.0.0") return true;
  if (host.endsWith(".local")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local
  }
  return false;
}

/** 变量名字段的即时体检。服务端那条错误要等到保存才弹，而用户在那之前就该看到。
 *  最常见的错法是**把钥匙本身填进这一格**（两行挨着，很容易看串），所以这里专门点破它。 */
export function envNameHint(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (/^(sk|sk-ant|sk-or|gsk|xai|gpt|bearer)[-_]/i.test(v) || /^\S{24,}$/.test(v) && /[a-z]/.test(v) && /\d/.test(v)) {
    return "这看着像**钥匙本身**。这一格要填变量的**名字**（如 DEEPSEEK_API_KEY）——钥匙填在下面「API key」那一行。";
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(v)) {
    return "变量名一般是大写字母 + 数字 + 下划线（如 DEEPSEEK_API_KEY）。";
  }
  return null;
}

/** 选择弹窗的批量置位（纯函数判卷出口）：全选 / 全不选。 */
export function selectAllRows(rows: readonly DiscoveredRow[], value: boolean): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const row of rows) next[row.id] = value;
  return next;
}

function rowMeta(row: DiscoveredRow): string {
  return (
    `窗口 ${row.contextWindow ?? "—"}｜价 ` +
    (row.price === undefined
      ? "未提供"
      : `${String(row.price.inputPerMTok ?? "?")}/${String(row.price.outputPerMTok ?? "?")}`) +
    `｜${row.origin === "both" ? "探测+目录" : row.origin === "discovery" ? "探测" : "目录"}` +
    `｜思考 ${row.reasoningEfforts !== undefined && row.reasoningEfforts.length > 0 ? row.reasoningEfforts.join("/") : "不支持"}`
  );
}

/** 模型选择弹窗（拉取后自动弹出）：整行点选 + 全选/全不选；Esc / 点遮罩 / 关闭钮 / 确定 均收窗。
 *  选择结果直接写回表单的 selected，保存流程（save 按 selected 过滤）一字不动。 */
export function ModelPickModal(props: {
  rows: readonly DiscoveredRow[];
  selected: Readonly<Record<string, boolean>>;
  onChange: (next: Record<string, boolean>) => void;
  onDone: () => void;
  busy?: boolean;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") props.onDone(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props]);
  const picked = props.rows.filter((row) => props.selected[row.id] === true).length;
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) props.onDone(); }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="选择要启用的模型">
        <div className="modal-head">
          <h3>选择要启用的模型</h3>
          <span className="m-count num">已选 {String(picked)} / {String(props.rows.length)}</span>
          <button type="button" className="iconbtn sm" aria-label="关闭" onClick={props.onDone}>
            <Ic.x size={12} />
          </button>
        </div>
        <div className="modal-tools">
          <button type="button" className="mini-btn" disabled={props.busy === true} onClick={() => props.onChange(selectAllRows(props.rows, true))}>全选</button>
          <button type="button" className="mini-btn" disabled={props.busy === true} onClick={() => props.onChange(selectAllRows(props.rows, false))}>全不选</button>
          <span className="ld" style={{ fontSize: "11px", color: "var(--text-3)" }}>整行点选可切换；目录没给的项（如价格）存完可在 .agent/providers.json 里补</span>
        </div>
        <div className="modal-list">
          {props.rows.map((row) => {
            const on = props.selected[row.id] === true;
            return (
              <button
                key={row.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={`选择模型 ${row.id}`}
                disabled={props.busy === true}
                className="pick-row"
                onClick={() => props.onChange({ ...props.selected, [row.id]: !on })}
              >
                <span className="pick-box" aria-hidden="true"><Ic.check size={11} /></span>
                <span className={"pk-name" + (on ? "" : " off")}>{row.id}</span>
                <span className="pk-meta">{rowMeta(row)}</span>
              </button>
            );
          })}
        </div>
        <div className="modal-foot">
          <span className="hint">至少选一个才能保存</span>
          <span className="spacer" />
          <button type="button" className="btn primary" disabled={props.busy === true || picked === 0} onClick={props.onDone}>确定</button>
        </div>
      </div>
    </div>
  );
}
