// 两步首启（M4-3，§2.4 onboarded 判据的 renderer 面）：Step1 选/添加工作区 → Step2 凭据
// （选 demo 演示 或 配一家 key）⇒ 完成 setSettings({onboarded:true})。「跳过」允许——
// 不强迫 key，demo 是唯一免 key 路径（保通机关见 onboardingCompletePatch 与 saveKey 的
// 落盘次序：真实 provider 只在 key 保存成功那一刻才随之一并落盘，**本组件动作**永不留下
// 「选了真家却没 key」的配置，无 key 完成恒保持 demo。M4-4 措辞收窄（T3 账本 deferred）：
// 该保证只覆盖首启面自身动作——首启期侧栏 ⚙ 设置入口仍可达，可经 T2 面板配出「真家无 key」，
// 不在本保通面内）。
//
// 首启面覆盖主区（App 侧按 needsOnboarding 裁决）：期间不渲染 composer——未配置就派活的
// 窗口不存在。数据面全走已 wired 的 AgentApi：listProjects/addProject（M3 桥）、
// getSettings/setSettings、providerKeySet/Status（T1/T2 面）。
//
// 凭据段复用勘定（报告记录）：**复用数据面，不提炼 CredentialsSection 共享组件**。
// SettingsPanel 的凭据段与面板级 busy/error/notice 三态跨区块耦合（key 保存会清掉模型段
// 的报错、也会 disable 其余四段控件），提炼成共享组件必须把 provider/busy/error/notice/
// status/keyInput 六份状态提参改线，T2 已审定的行为面（跨区块互斥）很难原样保持——
// 违反「提炼性重构需保持行为面不变」。故本组件直接 import SettingsPanel 的纯函数出口
// （PANEL_PROVIDER_KINDS / providerNeedsKey / providerStatusLabel / panelPatch）＋沿用同一
// 组 settings-* 样式类与 DOM 形状；明文零落盘纪律同款（key 输入非受控、保存成功即清、
// 换 provider 即清）。与面板唯一的语义差：provider 草稿不随点选落盘（见 saveKey）。
import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import type { ProjectRecord } from "../../../../../src/main/ipc-protocol";
import type { AppSettings } from "../../../../../src/main/settings";
// 运行时 import 只走 dep-free 模块（env-keys）；settings.ts 只做 type-only（同 SettingsPanel 先例，
// 不拖 node:fs/registry 进 renderer bundle）。纯函数出口复用 SettingsPanel 的同一份事实源。
import {
  PANEL_PROVIDER_KINDS,
  panelPatch,
  providerNeedsKey,
  providerStatusLabel,
  type ProviderKeyStatusView,
} from "./SettingsPanel";
import { envKeyOf } from "../../../../../src/providers/env-keys";

// ---- 纯函数出口（onboarding.test 判卷面）----

/** 首启判据（任务书 Interfaces 逐字）：!onboarded。App 用它裁决首启面是否覆盖主区；
 *  settings.ts 缺省 onboarded=false ⇒ 首次启动必先进首启面。 */
export function needsOnboarding(settings: Pick<AppSettings, "onboarded">): boolean {
  return !settings.onboarded;
}

/** 完成动作的唯一 patch（硬约束钉死）：完成首启只落 onboarded 这一个键——provider/model
 *  等其余键一律不混入（「跳过＝保持 demo」的保通前提）。toEqual 逐键判卷。 */
export function onboardingCompletePatch(): { onboarded: true } {
  return { onboarded: true };
}

export type OnboardingStep = "workspace" | "credentials";

export interface OnboardingState {
  step: OnboardingStep;
  /** Step1 选定的工作区（canonical 绝对路径；null = 未选，不许推进）。 */
  workspace: string | null;
}

export type OnboardingAction =
  | { type: "selectWorkspace"; path: string }
  | { type: "advance" }
  | { type: "back" };

export function initialOnboardingState(): OnboardingState {
  return { step: "workspace", workspace: null };
}

/** 两步状态机（纯函数）：Step1 选/添加工作区 → Step2 凭据。守卫：未选工作区不推进
 *  （Step1 是必答题）；credentials 无第三步；back 保留已选工作区。 */
export function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "selectWorkspace":
      if (state.workspace === action.path) return state;
      return { ...state, workspace: action.path };
    case "advance":
      if (state.workspace === null) return state; // Step1 必答：选/添加一个工作区才能进凭据步
      if (state.step === "workspace") return { ...state, step: "credentials" };
      return state; // 已在 credentials：无第三步
    case "back":
      if (state.step === "credentials") return { ...state, step: "workspace" };
      return state;
  }
}

// ---- 组件 ----

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function Onboarding(props: {
  /** 注册工作区清单（App 挂载拉取＋添加后刷新，与侧栏同一份 state）。 */
  projects: ProjectRecord[];
  /** 添加工作区（App.addWorkspace：addProject 桥＋清单刷新），返回 canonical 路径供选中。 */
  onAddWorkspace: (path: string) => Promise<string>;
  /** 工作区选定即回调（App 落 activeWorkspace——完成后新任务落此工作区，M3-3 语义）。 */
  onSelectWorkspace: (path: string) => void;
  /** 完成回调（onboarded:true 已由本组件落盘成功后触发；App 据此退出首启面）。 */
  onComplete: () => void;
}) {
  const [state, dispatch] = useReducer(onboardingReducer, undefined, initialOnboardingState);
  // Step2：provider 草稿（demo 起步）。demo 点选即时落盘（显式选免 key 路径，幂等）；
  // 真实 provider 仅随 key 保存成功一并落盘（saveKey）——草稿不落盘，跳过恒保持 demo。
  const [provider, setProvider] = useState<string>("demo");
  const [status, setStatus] = useState<ProviderKeyStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [addPath, setAddPath] = useState("");
  // key 输入框非受控（明文零进 React state/settings/日志——SettingsPanel 同款纪律）。
  const keyInput = useRef<HTMLInputElement>(null);

  const refreshKeyStatus = useCallback(() => {
    return window.agent.providerKeyStatus().then(setStatus).catch((err: unknown) => {
      setError(`key 状态读取失败：${errText(err)}`);
    });
  }, []);

  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus]);

  // 选定即上抛（单一同步点）：完成后新任务落所选工作区（App.activeWorkspace）。
  useEffect(() => {
    if (state.workspace !== null) props.onSelectWorkspace(state.workspace);
  }, [state.workspace, props.onSelectWorkspace]);

  const changeProvider = (kind: string) => {
    if (keyInput.current) keyInput.current.value = ""; // 换 provider 即清 key 输入框（防串家）
    setProvider(kind);
    if (kind === "demo") {
      // 显式选 demo＝显式选免 key 路径：即时落盘（缺省即 demo，幂等；也覆盖「先配了真家
      // 又改回 demo」的反悔）。patch 经 panelPatch 白名单，只可能带 provider 一键。
      setBusy(true);
      setError(null);
      setNotice(null);
      window.agent.setSettings(panelPatch({ provider: kind })).then(() => {
        setNotice("已选演示模式（demo，免 key）。");
      }).catch((err: unknown) => {
        setError(`设置保存失败：${errText(err)}`);
      }).finally(() => setBusy(false));
    }
  };

  const saveKey = async () => {
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
        // 次序纪律：先 key 后 provider——provider 落盘只在 key 已就位之后（若反序，中途失败
        // 会留下「选了真家却没 key」的配置；首启面不生产这种状态）。
        await window.agent.setSettings(panelPatch({ provider }));
        setNotice(`已配好 ${provider}（safeStorage 加密）。重启 cairn 后经启动注入生效；该家已设的环境变量仍优先。`);
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

  // 完成动作（硬约束）：只落 onboarded 这一个键（onboardingCompletePatch 钉死）。
  // 「跳过」与本按钮同一动作——不配 key 的完成就是跳过，demo 路径恒可达。
  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    setError(null);
    try {
      await window.agent.setSettings(onboardingCompletePatch());
      props.onComplete();
    } catch (err) {
      setError(`完成首启失败：${errText(err)}`);
      setFinishing(false);
    }
  };

  // Step1 添加工作区：App.addWorkspace（addProject 桥）成功后按 canonical 路径选中——
  // registry 会 realpath 化（如 macOS /tmp → /private/tmp），选中必须用返回值，不能用输入原文。
  const submitAdd = async (e: FormEvent) => {
    e.preventDefault();
    const path = addPath.trim();
    if (path === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const canonical = await props.onAddWorkspace(path);
      setAddPath("");
      dispatch({ type: "selectWorkspace", path: canonical });
    } catch (err) {
      setError(`添加工作区失败：${errText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <h2>欢迎使用 Cairn</h2>
        <div className="settings-hint">
          两步完成首启：选一个工作区，再配凭据。不强迫 key——随时可以跳过凭据，以演示模式（demo，免 key）开始。
        </div>
        {state.step === "workspace" ? (
          /* Step 1：选/添加工作区（复用 M3 的 listProjects 清单＋addProject 桥）。 */
          <section className="settings-section">
            <div className="sec-title">第 1 步 · 选择工作区</div>
            {props.projects.length === 0 ? (
              <div className="settings-hint">尚未注册工作区——在下方添加一个（项目文件夹的绝对路径）。</div>
            ) : (
              <div className="onboarding-ws-list">
                {props.projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={"onboarding-ws" + (state.workspace === p.path ? " active" : "")}
                    onClick={() => dispatch({ type: "selectWorkspace", path: p.path })}
                  >{p.path}</button>
                ))}
              </div>
            )}
            <form className="onboarding-add" onSubmit={(e) => void submitAdd(e)}>
              <input
                aria-label="工作区绝对路径"
                placeholder="项目文件夹绝对路径，如 /Users/you/proj"
                value={addPath}
                disabled={busy}
                onChange={(e) => setAddPath(e.target.value)}
              />
              <button className="btn-primary" type="submit" disabled={busy || addPath.trim() === ""}>添加</button>
            </form>
            <div className="settings-hint">点选上面任意工作区，或添加新的；选定后才能进入下一步。</div>
          </section>
        ) : (
          /* Step 2：凭据（可跳过）。DOM 形状与数据面复用 SettingsPanel 凭据段（见文件头勘定）。 */
          <section className="settings-section">
            <div className="sec-title">第 2 步 · 凭据（可跳过）</div>
            <label className="settings-row">
              provider
              <select
                aria-label="provider 预设"
                value={provider}
                disabled={busy}
                onChange={(e) => changeProvider(e.target.value)}
              >
                {PANEL_PROVIDER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === "demo" ? "demo（演示，免 key）" : kind}
                  </option>
                ))}
              </select>
            </label>
            {providerNeedsKey(provider) && (
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
                {envKeyOf(provider) !== null && (
                  <div className="settings-hint">
                    对应环境变量：{envKeyOf(provider)}（该变量在场时优先于已存 key）
                  </div>
                )}
                <div className="settings-hint">选择真实 provider 并保存 key 成功后才会生效；只点选不保存，完成时仍保持演示模式。</div>
              </>
            )}
            {status !== null && <div className="settings-status">{providerStatusLabel(status)}</div>}
            {notice !== null && <div className="settings-status">{notice}</div>}
          </section>
        )}
        {error !== null && <div className="form-error">{error}</div>}
        <div className="onboarding-actions">
          {state.step === "credentials" && (
            <button className="btn-ghost" disabled={finishing} onClick={() => dispatch({ type: "back" })}>← 上一步</button>
          )}
          {state.step === "workspace" ? (
            <button
              className="btn-primary"
              disabled={state.workspace === null || busy}
              onClick={() => dispatch({ type: "advance" })}
            >下一步</button>
          ) : (
            <>
              <button className="btn-ghost" disabled={finishing || busy} onClick={() => void finish()}>跳过（不配 key）</button>
              <button className="btn-primary" disabled={finishing || busy} onClick={() => void finish()}>完成</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
