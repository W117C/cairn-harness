// C-21 `ModelPicker`（§5.4 Row3）——2026-10-07 对齐原型（design/prototype.html modelBtn/modelPop）。
//
// 触发条 = 原型的单芯片形态：`deepseek-chat · 思考 off ⌄`（模型与思考程度**一个控件**——
// 业主指名对齐原型后从"独立分段控件"回归；此前把思考塞进菜单、又拆出来的两版都废止）。
// 菜单 = 搜索 → key 提示 → 注册档位（分组+徽标） → 思考程度（capability 裁决，未声明禁用+说明）
// → 演示 → 管理入口。数据面不变（唯一事实源仍是 `getProviderInfo()`，本层不造第二份）。
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderInfo } from "../../../../../src/main/ipc-protocol";
import { Ic, providerHue } from "./icons";

/** 菜单项：registryId = null 即「演示」（run 时不透传 model，走 settings 缺省）。 */
export interface ModelOption {
  registryId: string | null;
  label: string;
  provider: string | null;
  tier?: string;
  ctxWindow?: number;
  /** 识图能力（能力在菜单里可见，用户不用去猜模型名）。 */
  vision?: boolean;
}

/** 档位徽标文字。**必须有文字**：只靠颜色的徽标对色觉障碍用户等于没有（规范 a11y 条）。 */
export function tierBadge(tier: string | undefined): string {
  switch (tier) {
    case "cheap":
      return "便宜";
    case "standard":
      return "标准";
    case "strong":
      return "强";
    default:
      return "未定档";
  }
}

/** 上下文窗口的人话写法（12000 → 12k，1_000_000 → 1M）。缺省给「—」而不是 0。 */
export function formatCtxWindow(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? String(m) : m.toFixed(1)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** demo 常驻首项「演示」，其余按 spec 铺平（provider 分组交给菜单的分节）。
 *  多个 ProviderInfo 会重复铺同一行 ⇒ 按 spec.id 去重，顺序保持首见。 */
export function flattenModels(infos: readonly ProviderInfo[]): ModelOption[] {
  const options: ModelOption[] = [{ registryId: null, label: "演示", provider: null }];
  const seen = new Set<string>();
  for (const info of infos) {
    for (const spec of info.models) {
      if (seen.has(spec.id)) continue;
      seen.add(spec.id);
      options.push({
        registryId: spec.id,
        label: spec.model,
        provider: spec.provider,
        tier: spec.tier,
        ctxWindow: spec.ctxWindow,
        ...(spec.capability.attachments.image === true ? { vision: true } : {}),
      });
    }
  }
  return options;
}

export interface ModelGroup {
  provider: string;
  models: ModelOption[];
}

/** 按 provider 分组（保持首见顺序）。「演示」不归组 —— 它不是某个 provider 的档位。 */
export function groupModels(options: readonly ModelOption[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  const index = new Map<string, ModelGroup>();
  for (const o of options) {
    if (o.provider === null) continue;
    const hit = index.get(o.provider);
    if (hit) hit.models.push(o);
    else {
      const g: ModelGroup = { provider: o.provider, models: [o] };
      index.set(o.provider, g);
      groups.push(g);
    }
  }
  return groups;
}

/** 菜单搜索（纯函数判卷）。子序列模糊匹配（"ds" 命中 deepseek——fuzzy finder 惯例），
 *  大小写不敏感，命中 label 或 provider；「演示」只在空查询时出现——它不是被搜的对象。 */
export function filterModelOptions(options: readonly ModelOption[], query: string): ModelOption[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...options];
  const fuzzy = (hay: string): boolean => {
    const h = hay.toLowerCase();
    let i = 0;
    for (const ch of h) {
      if (ch === q[i]) i += 1;
      if (i === q.length) return true;
    }
    return false;
  };
  return options.filter((o) =>
    o.provider !== null && (fuzzy(o.label) || fuzzy(o.provider)),
  );
}

/** 触发条上的短名（规范：截断 140）。 */
export function shortModelName(value: string | null, options: readonly ModelOption[]): string {
  const raw = value === null ? "演示" : (options.find((o) => o.registryId === value)?.label ?? value);
  return raw.length > 140 ? `${raw.slice(0, 139)}…` : raw;
}

/** key 未配置时的置顶提示（fail-visible）。配好了就返回 null。
 *  demo 不算「未配置」—— 它按设计不需要 key（规范里单列一条）。 */
export function pickerKeyNotice(info: ProviderInfo | null): string | null {
  if (info === null || info.kind === "demo") return null;
  if (info.keyConfigured) return null;
  return `${info.provider} 未配置 key · 去设置配置`;
}

/** 选中项描述（触发条的 title 唯一事实源；三态都说人话）。 */
export function describeSelection(value: string | null, options: readonly ModelOption[]): string {
  if (value === null) return "模型：演示（预录剧本 · 不产生真实调用）";
  const hit = options.find((o) => o.registryId === value);
  if (!hit) return `模型：${value}（不在当前目录，实际回落设置里的缺省）`;
  const provider = hit.provider ? ` · ${hit.provider}` : "";
  const tier = hit.tier !== undefined ? ` · ${tierBadge(hit.tier)}` : "";
  const ctx = hit.ctxWindow !== undefined ? ` · 窗口 ${formatCtxWindow(hit.ctxWindow)}` : "";
  return `模型：${hit.label}${provider}${tier}${ctx}`;
}

/** 思考档位词表（原型词汇：off/low/medium/high；请求侧同字面量）。 */
export const THINKING_LEVELS = [
  { id: "off", label: "off", hint: "不发思考参数——最省、最快" },
  { id: "low", label: "low", hint: "轻量思考（1k token 预算）——简单改笔" },
  { id: "medium", label: "medium", hint: "中等思考（4k）——多数任务的默认档" },
  { id: "high", label: "high", hint: "深度思考（16k）——难题、方案设计、跨文件推理" },
] as const;

export function ModelPicker(props: {
  infos: readonly ProviderInfo[];
  value: string | null;
  onChange: (registryId: string | null) => void;
  disabled?: boolean;
  /** 「去设置配置」/「管理模型」的入口。 */
  onOpenSettings?: () => void;
  /** 这是**会话内**显式选择（与全局缺省不同）：触发条上点一个小圆点，规范要求可区分。 */
  sessionOverride?: boolean;
  /** 当前思考档位（缺省 off）；给了就在触发条上显示「· 思考 off」并在菜单里出档位段。 */
  thinking?: string;
  /** 当前模型是否声明支持思考档位（未声明 ⇒ low/medium/high 禁用 + 说明，不摆空壳）。 */
  thinkingSupported?: boolean;
  onThinkingChange?: (level: string) => void;
  /** 已配置 key 的 provider id 集合（stored ∪ env 在场）。给了之后：列表里**只保留**该集合内
   *  provider 的真模型；未给 = 不过滤（测试/只读场景）。 */
  configuredProviders?: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const allOptions = flattenModels(props.infos);
  const options = props.configuredProviders === undefined
    ? allOptions
    : allOptions.filter((o) => o.provider === null || props.configuredProviders!.has(o.provider));
  const info = props.infos[0] ?? null;
  const notice = pickerKeyNotice(info);
  const level = props.thinking ?? "off";
  const levelLabel = THINKING_LEVELS.find((l) => l.id === level)?.label ?? "off";

  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (box.current !== null && !box.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const pick = (registryId: string | null): void => {
    props.onChange(registryId);
    close();
  };

  return (
    <div className="mp" ref={box}>
      <button
        type="button"
        className="mp-trigger"
        aria-label="模型选择"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={describeSelection(props.value, options)}
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mp-name">
          {shortModelName(props.value, options)}
          {props.onThinkingChange !== undefined ? ` · 思考 ${levelLabel}` : ""}
        </span>
        {props.sessionOverride === true && <span className="mp-dot" aria-label="本会话已显式选择" />}
        <span className="mp-caret" aria-hidden="true"><Ic.chevronDown size={10} /></span>
      </button>
      {open && (
        <ModelMenu
          options={options}
          value={props.value}
          {...(props.disabled === true ? { running: true } : {})}
          keyNotice={notice}
          {...(props.onOpenSettings !== undefined ? { onOpenSettings: props.onOpenSettings } : {})}
          {...(props.onThinkingChange !== undefined
            ? {
                thinking: level,
                thinkingSupported: props.thinkingSupported === true,
                onThinkingChange: props.onThinkingChange,
              }
            : {})}
          onPick={pick}
        />
      )}
    </div>
  );
}

/** 菜单本体（纯展示、可服务端渲染；搜索态是组件内局部状态，SSR 时即空查询）。
 *
 *  判卷约束（render-structure.test.tsx 逐字钉住的序列不许变形）：
 *  分组头 `>openai<`、子行 `标准 · 窗口 128k`、勾 `class="check">✓<`、
 *  `⚠ OpenAI 未配置 key · 去设置配置`（⚠ 字面量**豁免**于全局 emoji 清理）、
 *  空目录两串、aria-selected 计数（模型+思考各一）、running disabled 计数、
 *  思考未声明时 disabled 计数。 */
export function ModelMenu(props: {
  options: readonly ModelOption[];
  value: string | null;
  /** 运行中：注册档位整列禁用（规范「运行中 disabled」）。 */
  running?: boolean;
  /** key 未配置时的置顶提示行；undefined / null = 不显示。 */
  keyNotice?: string | null;
  onPick: (registryId: string | null) => void;
  onOpenSettings?: () => void;
  /** 当前思考档位（缺省 off）。 */
  thinking?: string;
  /** 当前模型是否**声明**支持思考档位；未声明 ⇒ off 以外全禁 + 说明（fail-visible）。 */
  thinkingSupported?: boolean;
  onThinkingChange?: (level: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [hl, setHl] = useState(0);
  const filtered = filterModelOptions(props.options, query);
  const groups = groupModels(filtered);
  const demoVisible = query.trim() === "";
  const flat: ModelOption[] = [
    ...groups.flatMap((g) => g.models),
    ...(demoVisible ? [{ registryId: null, label: "演示", provider: null } as ModelOption] : []),
  ];
  const warn = props.keyNotice !== undefined && props.keyNotice !== null;
  const modelsDisabled = props.running === true;
  const level = props.thinking ?? "off";

  const onKeyNav = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(h + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      const target = flat[hl];
      if (target !== undefined) { e.preventDefault(); props.onPick(target.registryId); }
    }
  };

  return (
    <div className="pop show mp-pop" role="listbox" aria-label="模型列表" onKeyDown={onKeyNav}>
      <div className="mp-search">
        <input
          type="text"
          aria-label="搜索模型"
          placeholder="搜索模型或 provider…"
          value={query}
          autoFocus
          onChange={(e) => { setQuery(e.target.value); setHl(0); }}
        />
      </div>
      {warn && (
        <button type="button" className="menu-item mp-warn" onClick={() => props.onOpenSettings?.()}>
          <span>⚠ {props.keyNotice}</span>
          <span className="sub">点这里去设置</span>
        </button>
      )}
      {groups.map((g) => (
        <div key={g.provider}>
          <div className="mp-group-label">
            <span className="g-dot" style={{ background: `hsl(${String(providerHue(g.provider))} 42% 52%)` }} aria-hidden="true" />
            <span>{g.provider}</span>
          </div>
          {g.models.map((m) => (
            <button
              key={m.registryId ?? "demo"}
              type="button"
              role="option"
              aria-selected={m.registryId === props.value}
              className="menu-item"
              disabled={modelsDisabled}
              onClick={() => props.onPick(m.registryId)}
            >
              <span className="mi-name">{m.label}</span>
              <span className="sub">
                {tierBadge(m.tier)} · 窗口 {formatCtxWindow(m.ctxWindow)}
              </span>
              {m.vision === true && <span className="v-badge" title="支持识图（可发图片）"><Ic.eye size={11} /></span>}
              {m.registryId === props.value && <span className="check">✓</span>}
            </button>
          ))}
        </div>
      ))}
      {groups.length === 0 && !demoVisible && <div className="pop-label">没有匹配「{query.trim()}」的模型</div>}
      {groups.length === 0 && demoVisible && (
        <div className="pop-label">当前目录里没有可选模型 —— 去设置里接一家自己的</div>
      )}
      {props.onThinkingChange !== undefined && (
        <>
          <div className="pop-label">思考程度（ThinkingEffort）</div>
          {THINKING_LEVELS.map((lv) => {
            const locked = props.thinkingSupported !== true && lv.id !== "off";
            return (
              <button
                key={lv.id}
                type="button"
                role="option"
                aria-selected={level === lv.id}
                className="menu-item"
                disabled={modelsDisabled || locked}
                title={locked ? "该模型未声明思考档位支持" : undefined}
                onClick={() => { props.onThinkingChange?.(lv.id); }}
              >
                <span className="mi-name">{lv.label}</span>
                <span className="sub">{locked ? "capability 未支持" : lv.hint}</span>
                {level === lv.id && <span className="check">✓</span>}
              </button>
            );
          })}
          {props.thinkingSupported !== true && (
            <div className="menu-note">
              这家/这个模型没声明支持思考档位（low/medium/high 显式禁用，不摆空壳）。在
              <code>.agent/providers.json</code> 给该模型加 <code>reasoningEfforts</code>（如
              <code>["low","high"]</code>）即可解锁；强行发上游不认的参数会被拒。
            </div>
          )}
        </>
      )}
      {demoVisible && (
        <>
          <div className="pop-label">演示</div>
          <button
            type="button"
            role="option"
            aria-selected={props.value === null}
            className="menu-item"
            disabled={props.running === true}
            onClick={() => props.onPick(null)}
          >
            <span className="mi-name">演示</span>
            <span className="sub">预录剧本 · 不产生真实调用 · 结果与你的任务无关</span>
            {props.value === null && <span className="check">✓</span>}
          </button>
        </>
      )}
      {props.onOpenSettings !== undefined && (
        <div className="mp-foot">
          <button type="button" className="menu-item" onClick={() => props.onOpenSettings?.()}>
            <Ic.settings size={12} />
            <span>在设置中管理模型与接入…</span>
          </button>
        </div>
      )}
    </div>
  );
}
