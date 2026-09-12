// M4b §2.4 新手引导（§13 验收「新手引导走通全部设置项」）：
// 4 步向导，§13 七组设置项逐组有入口/确认（清单 ONBOARDING_GROUPS 是覆盖面的单一事实源——
// 单测与 commercial-check 按它断言七组不缺）。首次启动（settings.onboarded=false）弹出；
// 完成落 settings.onboarded=true 不再弹；设置页「重新运行引导」可重跑。
// SSR 安全：window 访问全部收进事件回调（渲染路径零 window 依赖），headless renderToStaticMarkup 不抛。
import { useState, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppSettings, PermissionMode, StateResponse } from "../main/ipc-protocol";
import type { LicenseState } from "../main/license";
import type { UpdateCheckResult } from "../main/updater";

/** license 状态徽标文案（renderer 侧单一事实源；license.ts 引 node:crypto，renderer 只 type-only import）。 */
export function licenseStatusLabel(s: LicenseState): string {
  if (s.state === "valid") return "license 有效（" + s.licensee + "）";
  if (s.state === "expired") return "license 已过期（" + s.expiresAt.slice(0, 10) + "）";
  if (s.state === "inactive") return "未激活（无 license 文件，功能不阻断）";
  return "license 无效：" + s.reason;
}

/** §13 七组设置项 → 向导步号与入口说明（覆盖清单；缺组 = 单测/commercial-check 红）。 */
export interface OnboardingGroup {
  id: "provider" | "permission" | "ui" | "schedule" | "memory" | "telemetry" | "about";
  label: string;
  step: 1 | 2 | 3 | 4;
  entry: string;
}

export const ONBOARDING_GROUPS: readonly OnboardingGroup[] = [
  { id: "provider", label: "Provider 管理（BYOK key · 单价表）", step: 1, entry: "下方输入并保存 key 到钥匙串；单价在设置页 Provider 组查看" },
  { id: "permission", label: "权限档位（沙箱状态 · 产出代码安全模式）", step: 2, entry: "确认档位 / 沙箱 / 安全模式" },
  { id: "ui", label: "UI（主题 · 面板布局）", step: 2, entry: "选择主题；布局在右栏切换器随时调整" },
  { id: "schedule", label: "定时任务", step: 3, entry: "确认定时会话并发上限；任务管理在右栏 schedule 面板" },
  { id: "memory", label: "记忆管理", step: 3, entry: "确认会话结束自动沉淀开关；面板在右栏「记忆」" },
  { id: "telemetry", label: "遥测开关（默认关）", step: 3, entry: "确认遥测保持关闭（V1 无上报通道 = 零数据出门）" },
  { id: "about", label: "关于 / 更新（版本 · license · 检查更新）", step: 4, entry: "查看版本与 license 状态；更新源在设置页关于/更新组配置" },
] as const;

export const ONBOARDING_STEP_TITLES: readonly string[] = [
  "欢迎 · BYOK key",
  "权限与 UI",
  "安全模式 · 定时 · 记忆 · 遥测",
  "关于 / 更新 · 完成",
] as const;

export interface OnboardingWizardProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: AppSettings | null;
  sandbox: StateResponse["sandbox"] | null;
  license: LicenseState | null;
  providerKeys: StateResponse["providerKeys"] | null;
  appVersion: string;
  /** 与设置页同一 patchSettings（落主进程 settings 持久化）。 */
  onSettings: (patch: Partial<AppSettings>) => void;
  /** 完成（第 4 步）：宿主落 onboarded=true 并关向导。 */
  onFinish: () => void;
  /** 可选初始步（演示/验收注入点；缺省 1 = 用户路径恒从欢迎步开始）。 */
  defaultStep?: 1 | 2 | 3 | 4;
}

/** 单组确认控件（GROUP_CONTROLS 覆盖 ONBOARDING_GROUPS 全部 id——缺 id 渲染「缺失」占位，
 *  单测断言「无缺失」，结构性保证七组走通）。 */
function groupControl(
  id: OnboardingGroup["id"],
  props: OnboardingWizardProps,
  ctx: {
    keyInput: string;
    setKeyInput: (v: string) => void;
    keyNote: string | null;
    saveKey: () => void;
  },
): ReactElement {
  const { settings, sandbox, license, providerKeys, onSettings } = props;
  switch (id) {
    case "provider":
      return (
        <div className="space-y-2" data-m4b-onboard-group="provider">
          <div className="flex items-center gap-2">
            <Input
              type="password"
              className="h-8 flex-1"
              placeholder={providerKeys?.envActive ? "M0_API_KEY env 已在（优先，二者并存）" : "粘贴 provider key（保存到钥匙串，明文零落盘）"}
              value={ctx.keyInput}
              data-m4b-onboard-key=""
              onChange={(e) => ctx.setKeyInput(e.target.value)}
            />
            <Button size="sm" disabled={ctx.keyInput.trim() === ""} data-m4b-onboard-key-save="" onClick={ctx.saveKey}>
              保存到钥匙串
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {providerKeys?.available ? (
              <Badge variant="secondary">safeStorage 可用</Badge>
            ) : (
              <Badge variant="destructive">safeStorage 不可用 → 拒存（fail-closed，不落明文）</Badge>
            )}
            {(providerKeys?.stored.length ?? 0) > 0 && <Badge variant="outline">已存：{providerKeys?.stored.join("、")}</Badge>}
          </div>
          {ctx.keyNote !== null && <div className="text-xs text-muted-foreground" data-m4b-onboard-key-note="">{ctx.keyNote}</div>}
          <div className="text-xs text-muted-foreground">当前单价（USD/百万 token）：{String(settings?.budgetPricePerMTok ?? 0)}（成本闸组可改）</div>
        </div>
      );
    case "permission":
      return (
        <div className="space-y-2" data-m4b-onboard-group="permission">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">档位</span>
            <Select value={settings?.mode ?? "default"} onValueChange={(v) => onSettings({ mode: v as PermissionMode })}>
              <SelectTrigger className="h-8 w-52" data-m4b-onboard-mode=""><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="read-only">read-only（只读）</SelectItem>
                <SelectItem value="default">default（写操作需批准）</SelectItem>
                <SelectItem value="auto">auto（自主）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">沙箱状态</span>
            {sandbox?.available ? (
              <Badge variant="secondary">Seatbelt 已启用</Badge>
            ) : (
              <Badge variant="destructive">不可用：{sandbox?.reason ?? "检测中"}（写操作逐条强制审批）</Badge>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">产出代码安全模式</span>
            <Select value={settings?.safeMode ?? "report"} onValueChange={(v) => onSettings({ safeMode: v as AppSettings["safeMode"] })}>
              <SelectTrigger className="h-8 w-52" data-m4b-onboard-safe=""><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">off（关闭）</SelectItem>
                <SelectItem value="report">report（静态快筛，默认）</SelectItem>
                <SelectItem value="gate">gate（写工具强制审批）</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    case "ui":
      return (
        <div className="flex items-center justify-between gap-2" data-m4b-onboard-group="ui">
          <span className="text-xs text-muted-foreground">主题</span>
          <Select value={settings?.theme ?? "system"} onValueChange={(v) => onSettings({ theme: v as AppSettings["theme"] })}>
            <SelectTrigger className="h-8 w-52" data-m4b-onboard-theme=""><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="system">跟随系统</SelectItem>
              <SelectItem value="light">浅色</SelectItem>
              <SelectItem value="dark">深色</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    case "schedule":
      return (
        <div className="flex items-center justify-between gap-2" data-m4b-onboard-group="schedule">
          <span className="text-xs text-muted-foreground">同时运行的定时会话上限</span>
          <Input
            type="number"
            min={1}
            max={8}
            className="h-8 w-28"
            value={String(settings?.scheduleConcurrencyCap ?? 2)}
            data-m4b-onboard-cap=""
            onChange={(e) => onSettings({ scheduleConcurrencyCap: Math.min(8, Math.max(1, Number(e.target.value) || 1)) })}
          />
        </div>
      );
    case "memory":
      return (
        <div className="flex items-center justify-between gap-2" data-m4b-onboard-group="memory">
          <span className="text-xs text-muted-foreground">会话结束自动沉淀</span>
          <Checkbox checked={settings?.autoMemory ?? true} data-m4b-onboard-memory="" onCheckedChange={(v) => onSettings({ autoMemory: v === true })} />
        </div>
      );
    case "telemetry":
      return (
        <div className="space-y-1" data-m4b-onboard-group="telemetry">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">遥测</span>
            <Checkbox checked={settings?.telemetry ?? false} data-m4b-onboard-telemetry="" onCheckedChange={(v) => onSettings({ telemetry: v === true })} />
          </div>
          <div className="text-[11px] text-muted-foreground">默认关。V1 无任何上报实现——没有通道 = 最强「零数据出门」保证。</div>
        </div>
      );
    case "about":
      return (
        <div className="space-y-2" data-m4b-onboard-group="about">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">版本 {props.appVersion}</Badge>
            {license && <Badge variant={license.state === "valid" ? "secondary" : license.state === "invalid" ? "destructive" : "outline"}>{licenseStatusLabel(license)}</Badge>}
          </div>
          <div className="text-[11px] text-muted-foreground">更新源 / 检查更新 / license 详情在设置页「关于 / 更新」组；完成向导后随时可回看全部设置项。</div>
        </div>
      );
  }
}

/** 4 步向导（Dialog 壳）。radix Dialog 走 portal——SSR 冒烟与测试渲染内层 OnboardingSteps（坑七十）。 */
export function OnboardingWizard(props: OnboardingWizardProps): ReactElement {
  const { open, onOpenChange } = props;
  const [step, setStep] = useState<1 | 2 | 3 | 4>(props.defaultStep ?? 1);
  const [keyInput, setKeyInput] = useState("");
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const ctx = { keyInput, setKeyInput, keyNote, saveKey };
  const canSaveKey = typeof window !== "undefined" && typeof window.agent?.providerKeySet === "function";

  function saveKey(): void {
    if (!canSaveKey || keyInput.trim() === "") return;
    // key 只经 IPC 传给主进程 safeStorage（密文落盘）；明文不进日志/事件流，输入框即清
    void window.agent
      .providerKeySet("glm", keyInput)
      .then((r) => {
        setKeyNote(r.ok ? "已保存到钥匙串（明文零落盘；重启后自动解密生效，env 路径优先）" : "保存失败：" + (r.error ?? "未知"));
        if (r.ok) setKeyInput("");
      })
      .catch((err: unknown) => setKeyNote("保存失败：" + (err instanceof Error ? err.message : String(err))));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-m4b-onboard="">
        {/* a11y：radix 要求 Content 内有 Title；视觉标题在内层普通标签（SSR 安全） */}
        <DialogTitle className="sr-only">新手引导</DialogTitle>
        <OnboardingSteps {...props} step={step} setStep={setStep} keyCtx={ctx} />
      </DialogContent>
    </Dialog>
  );
}

/** 向导内层（无 Dialog 壳）：portal 内内容不进静态标记，SSR 冒烟与测试直接渲染本组件。 */
export interface OnboardingStepsProps extends OnboardingWizardProps {
  step: 1 | 2 | 3 | 4;
  setStep: (s: 1 | 2 | 3 | 4) => void;
  keyCtx: { keyInput: string; setKeyInput: (v: string) => void; keyNote: string | null; saveKey: () => void };
}

export function OnboardingSteps(props: OnboardingStepsProps): ReactElement {
  const { step, setStep, settings, onFinish } = props;
  const ctx = props.keyCtx;
  const groupsOf = (s: number): OnboardingGroup[] => ONBOARDING_GROUPS.filter((g) => g.step === s);
  const last = step === 4;
  return (
    <>
      <div className="flex flex-col gap-2" data-slot="dialog-header">
        <h2 className="text-base leading-none font-semibold">新手引导 · {String(step)}/4 {ONBOARDING_STEP_TITLES[step - 1]}</h2>
        <p className="text-sm text-muted-foreground">
          走通全部设置项（§13 七组）；每步可跳过，随时可在设置页回看或「重新运行引导」。
        </p>
      </div>
      {settings && (
        <div className="flex flex-col gap-4 py-1 text-sm">
          {groupsOf(step).map((g) => (
            <section key={g.id} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-medium">{g.label}</div>
                <Badge variant="outline" className="shrink-0 text-[10px]">{g.id}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">{g.entry}</div>
              {groupControl(g.id, props, ctx)}
            </section>
          ))}
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button size="sm" variant="ghost" disabled={step === 1} data-m4b-onboard-prev="" onClick={() => setStep((step - 1) as 1 | 2 | 3 | 4)}>
              上一步
            </Button>
            {last ? (
              <Button size="sm" data-m4b-onboard-finish="" onClick={onFinish}>
                完成并进入（不再弹出）
              </Button>
            ) : (
              <Button size="sm" data-m4b-onboard-next="" onClick={() => setStep((step + 1) as 2 | 3 | 4)}>
                下一步
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** 更新检查结果 → 显式态文案（设置页与向导共用；未配置/失败绝不静默）。 */
export function updateResultLabel(r: UpdateCheckResult): string {
  if (r.state === "unconfigured") return "未配置更新源（设置 updateManifestUrl 后可检查）";
  if (r.state === "error") return "检查失败：" + r.message;
  if (r.state === "up-to-date") return "已是最新（" + r.manifestVersion + "）";
  return "有新版 " + r.version + "（当前 " + r.currentVersion + "）";
}
