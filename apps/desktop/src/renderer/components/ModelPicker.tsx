// C-21 `ModelPicker`（§5.4 Row3）——P2-2 合并单面（brief 三节：模型 chip「模型名 · 思考强度」，
// 点击一个弹窗：搜索 + 模型列表（上下文长度 / 思考 / 图片能力）+ 下半区思考强度 Segmented）。
// 旧两视图（思考面 × 换模型面）作废：一屏说全——上列表、下思考段，少一次翻面。
// 触发条 = 单芯片形态：`deepseek-chat · 思考 关 ⌄`（档词 = 关/低/中/强；未声明支持不带思考段）。
// 数据面不变（唯一事实源仍是 `getProviderInfo()`，本层不造第二份）；文案全出处 STR。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Eye, Info, Settings } from "lucide-react";
import type { ProviderInfo } from "../../../../../src/main/ipc-protocol";
import { STR } from "../strings";
import { Popover, usePopoverDismiss } from "./Popover";

/** 向上弹的菜单最多能有多高：触发条上沿到窗口顶（扣 38px 标题栏 + 6px 间隙）。
 *  空屏的输入卡在屏幕中部，菜单 393px 高会顶穿标题栏——真机实测第一行「deepseek-chat」
 *  被窗口上沿切掉。这条把可用高度算出来交给 style.maxHeight，超出的部分在菜单内滚动。
 *  240 是下限（再矮就连搜索框+两行都放不下，宁可让菜单贴边也不能压成一条缝）。 */
export function modelMenuMaxHeight(triggerTop: number): number {
  return Math.max(240, Math.min(560, Math.floor(triggerTop - 44)));
}

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
      return STR.modelPicker.tierCheap;
    case "standard":
      return STR.modelPicker.tierStandard;
    case "strong":
      return STR.modelPicker.tierStrong;
    default:
      return STR.modelPicker.tierUndefined;
  }
}

/** 上下文窗口的人话写法（12000 → 12k，1_000_000 → 1M）。缺省给「—」而不是 0。 */
export function formatCtxWindow(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n <= 0) return STR.composer.dash;
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
  const options: ModelOption[] = [{ registryId: null, label: STR.modelPicker.demo, provider: null }];
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
  const raw = value === null ? STR.modelPicker.demo : (options.find((o) => o.registryId === value)?.label ?? value);
  return raw.length > 140 ? `${raw.slice(0, 139)}…` : raw;
}

/** key 未配置时的置顶提示（fail-visible）。配好了就返回 null。
 *  demo 不算「未配置」—— 它按设计不需要 key（规范里单列一条）。 */
export function pickerKeyNotice(info: ProviderInfo | null): string | null {
  if (info === null || info.kind === "demo") return null;
  if (info.keyConfigured) return null;
  return STR.modelPicker.unconfiguredKey.replace("{provider}", info.provider);
}

/** 选中项描述（触发条的 title 唯一事实源；三态都说人话）。 */
export function describeSelection(value: string | null, options: readonly ModelOption[]): string {
  if (value === null) return STR.modelPicker.demoDesc;
  const hit = options.find((o) => o.registryId === value);
  if (!hit) return STR.modelPicker.fallbackDesc.replace("{value}", value);
  const provider = hit.provider ? STR.modelPicker.descProvider.replace("{provider}", hit.provider) : "";
  const tier = hit.tier !== undefined ? STR.modelPicker.descTier.replace("{tier}", tierBadge(hit.tier)) : "";
  const ctx = hit.ctxWindow !== undefined ? STR.modelPicker.descCtx.replace("{ctx}", formatCtxWindow(hit.ctxWindow)) : "";
  return STR.modelPicker.descName.replace("{name}", hit.label) + provider + tier + ctx;
}

/** 思考档位词表（分段短词族：关/低/中/强；id 即请求侧字面量，不动；文案出处 STR）。 */
export const THINKING_LEVELS = [
  { id: "off", short: STR.modelPicker.thinkOff, hint: STR.modelPicker.thinkOffHint },
  { id: "low", short: STR.modelPicker.thinkLow, hint: STR.modelPicker.thinkLowHint },
  { id: "medium", short: STR.modelPicker.thinkMedium, hint: STR.modelPicker.thinkMediumHint },
  { id: "high", short: STR.modelPicker.thinkHigh, hint: STR.modelPicker.thinkHighHint },
] as const;

/** 「信号开菜单」这一步的判据（纯函数）：seq 前进一次 = 开一次。
 *
 *  `prev === null` 是**首帧**（含重挂后的首帧）：那时只对齐基线、不开。
 *  这一支是修的那一格：ModelPicker 按 `key={draftKey}` 在切会话时重挂，重挂把「上一次见过的 seq」
 *  这个 ref 复位掉了，而 Composer 那边的 seq 不会复位、还留着上一次 ⌘⇧I 的值 ⇒ 重挂后的 picker
 *  以为"seq 前进了一大截"⇒ **切会话时菜单自己弹开**，悬在新会话的输入框上抢焦点。
 *  语义不变：「seq 前进一次 = 开一次」，而**重挂不算前进**。
 *
 *  seq 回退（< prev）也不开：基线不倒退，避免下一次前进被算成"连跳两格"而开两次。 */
export function nextOpenSeqState(
  prev: number | null,
  incoming: number | undefined,
): { open: boolean; baseline: number | null } {
  if (incoming === undefined) return { open: false, baseline: prev };
  if (prev === null) return { open: false, baseline: incoming };
  if (incoming <= prev) return { open: false, baseline: prev };
  return { open: true, baseline: incoming };
}

export function ModelPicker(props: {
  infos: readonly ProviderInfo[];
  value: string | null;
  onChange: (registryId: string | null) => void;
  disabled?: boolean;
  /** 运行中（v7.2 业主裁）：模型档位照旧锁定，但**触发器不灰、菜单照开**——思考程度是
   *  「下一轮派活」的旋钮，跑着也能拧（透传给 ModelMenu 做「模型行禁用」）。 */
  running?: boolean;
  /** 「去设置配置」/「管理模型」的入口。 */
  onOpenSettings?: () => void;
  /** 这是**会话内**显式选择（与全局缺省不同）：触发条上点一个小圆点，规范要求可区分。 */
  sessionOverride?: boolean;
  /** 当前思考档位（缺省 off）；给了就在触发条上显示「· 思考 关」并在菜单里出思考强度区。 */
  thinking?: string;
  /** 当前模型是否声明支持思考档位。未声明 ⇒ 触发条不带「· 思考」段；菜单思考段整区禁用 +
   *  注「当前模型不支持思考强度」（brief 三节；不摆空壳也不噤声——为什么+怎么解锁在折叠里）。 */
  thinkingSupported?: boolean;
  onThinkingChange?: (level: string) => void;
  /** 已配置 key 的 provider id 集合（stored ∪ env 在场）。给了之后：列表里**只保留**该集合内
   *  provider 的真模型；未给 = 不过滤（测试/只读场景）。 */
  configuredProviders?: ReadonlySet<string>;
  /** 快捷键开菜单信号（蓝本 §3.6 ⌘⇧I/⌘⇧E）：seq 递增即开一次；不给 = 不响应。 */
  openSeq?: number;
  /** 打开落点（2026-10-18）：model = 聚焦搜索框（⌘⇧I / 点击）；effort = 滚到并聚焦思考档（⌘⇧E）。
   *  两者开的是同一个菜单，但快捷键的承诺不同，落点必须不同。 */
  initialFocus?: "model" | "effort";
  /** 用户自己点开触发器（2026-10-18）：让上层把落点复位成 model，避免上一次 ⌘⇧E 的焦点意图残留。 */
  onUserOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // 菜单向上开，高度必须让出标题栏：空屏输入卡在中部，393px 菜单会顶穿窗口上沿。
  const [menuMax, setMenuMax] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!open) { setMenuMax(undefined); return; }
    const update = (): void => {
      const top = box.current?.getBoundingClientRect().top;
      if (top !== undefined) setMenuMax(modelMenuMaxHeight(top));
    };
    update();
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("resize", update); };
  }, [open]);
  // 信号开菜单：seq 前进且未被**硬锁**（disabled：门槛/排队读回）才开。
  // v7.2 业主裁后 running 不再折进 disabled ⇒ ⌘⇧E 运行中也能开（思考档要能调）。
  //
  // 首帧只**对齐**、不开（2026-10-19 独立评审追出）：ModelPicker 按 `key={draftKey}` 在切会话时
  // 重挂（见 Composer.tsx 的注释），重挂会把 `lastOpenSeq` 这个 ref 复位成 0；而 Composer 那边的
  // `pickerOpenSeq` 不会重挂、还留着上一次 ⌘⇧I 的值（3 之类）⇒ 重挂后的 picker 看到
  // "openSeq(3) > lastOpenSeq(0)" ⇒ **切会话时菜单自己弹开**，悬在新会话的输入框上抢焦点——
  // 正是那个 key 原本要防的症状（"模型搜索框还开着"）。
  // 修法：首帧把基线对齐到当前 openSeq（此后只在它**真的前进**时开），语义不变：
  // "seq 前进一次 = 开一次"，重挂不算前进。
  const lastOpenSeq = useRef<number | null>(null);
  useEffect(() => {
    if (props.openSeq === undefined) return;
    const step = nextOpenSeqState(lastOpenSeq.current, props.openSeq);
    lastOpenSeq.current = step.baseline;
    if (step.open && props.disabled !== true) setOpen(true);
  }, [props.openSeq, props.disabled]);
  const allOptions = flattenModels(props.infos);
  const options = props.configuredProviders === undefined
    ? allOptions
    : allOptions.filter((o) => o.provider === null || props.configuredProviders!.has(o.provider));
  const info = props.infos[0] ?? null;
  const notice = pickerKeyNotice(info);
  const level = props.thinking ?? "off";
  const levelLabel = THINKING_LEVELS.find((l) => l.id === level)?.short ?? STR.modelPicker.thinkOff;

  const close = useCallback(() => setOpen(false), []);
  // 外点 / Esc 关闭：单源在 Popover（阶段 1 共享化；行为与旧内联监听逐条同构）。
  usePopoverDismiss(open, close, box);

  const pick = (registryId: string | null): void => {
    props.onChange(registryId);
    close();
  };

  return (
    <div className="mp" ref={box}>
      <button
        type="button"
        className="mp-trigger"
        aria-label={STR.modelPicker.triggerAria}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={describeSelection(props.value, options)}
        disabled={props.disabled}
        onClick={() => { props.onUserOpen?.(); setOpen((v) => !v); }}
      >
        <span className="mp-name">
          {shortModelName(props.value, options)}
          {/* 「· 思考 X」段只在模型真声明支持时出现——没能力的模型不带这个按键面（业主 22.01 裁）。 */}
          {props.onThinkingChange !== undefined && props.thinkingSupported === true
            ? STR.modelPicker.thinkingChip.replace("{level}", levelLabel)
            : ""}
        </span>
        {props.sessionOverride === true && <span className="mp-dot" aria-label={STR.modelPicker.sessionDotAria} />}
        <span className="mp-caret" aria-hidden="true"><ChevronDown size={10} /></span>
      </button>
      {open && (
        <ModelMenu
          options={options}
          value={props.value}
          maxHeight={menuMax}
          {...(props.disabled === true || props.running === true ? { running: true } : {})}
          initialFocus={props.initialFocus ?? "model"}
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

/** 菜单本体（P2-2 合并单面）：搜索 + 模型列表 + 下半区思考强度 Segmented。
 *  纯展示、可服务端渲染。
 *
 *  判卷约束（render-structure.test.tsx 钉住的序列不许变形）：分组头 `>openai<`、
 *  子行 `标准 · 窗口 128k`、勾 `class="check">✓<`、`⚠ OpenAI 未配置 key · 去设置配置`
 *  （⚠ 字面量**豁免**于全局 emoji 清理）、空目录两串、aria-selected 计数、running disabled 计数；
 *  思考段钉分段 aria-pressed / title 逐档说明 / 未声明整段禁用数。 */
export function ModelMenu(props: {
  options: readonly ModelOption[];
  value: string | null;
  /** 运行中：模型列表整列禁用（规范「运行中 disabled」）；**思考强度不在此列**——
   *  v7.2 业主裁：思考档是「下一轮派活」的旋钮，跑着也能拧（只随 capability 锁）。 */
  running?: boolean;
  /** key 未配置时的置顶提示行；undefined / null = 不显示。 */
  keyNotice?: string | null;
  onPick: (registryId: string | null) => void;
  onOpenSettings?: () => void;
  /** 向上开时允许的最大高度（px）；undefined = 不限制（测试/旧调用）。 */
  maxHeight?: number;
  /** 当前思考档位（缺省 off）。 */
  thinking?: string;
  /** 当前模型是否**声明**支持思考档位；未声明 ⇒ 整区禁用 + 注记 + 配置折叠（fail-visible）。 */
  thinkingSupported?: boolean;
  onThinkingChange?: (level: string) => void;
  /** 打开落点（2026-10-18）：effort = 首帧把焦点送进思考档分段（⌘⇧E）；
   *  model = 保持搜索框 autofocus（⌘⇧I / 点击）。 */
  initialFocus?: "model" | "effort";
}): React.JSX.Element {
  const wantEffort = props.onThinkingChange !== undefined;
  const [query, setQuery] = useState("");
  const [hl, setHl] = useState(0);
  const filtered = filterModelOptions(props.options, query);
  const groups = groupModels(filtered);
  const demoVisible = query.trim() === "";
  const flat: ModelOption[] = [
    ...groups.flatMap((g) => g.models),
    ...(demoVisible ? [{ registryId: null, label: STR.modelPicker.demo, provider: null } as ModelOption] : []),
  ];
  const warn = props.keyNotice !== undefined && props.keyNotice !== null;
  const modelsDisabled = props.running === true;
  const supported = props.thinkingSupported === true;
  const level = props.thinking ?? "off";
  const currentLevel = THINKING_LEVELS.find((l) => l.id === level) ?? THINKING_LEVELS[0];
  // ⌘⇧E 的落点（2026-10-18）：首帧滚到思考分段并聚焦当前档按钮；模型不声明思考时
  // 分段整区禁用——聚焦分组本身（读屏仍报「思考强度，不可用」+ 下方说明），不静默。
  const effortRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (props.initialFocus !== "effort") { searchRef.current?.focus(); return; }
    const box = effortRef.current;
    if (box === null) return;
    const target = box.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? box;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
  }, [props.initialFocus]);

  const onKeyNav = (e: React.KeyboardEvent): void => {
    // 蓝本 §3.6：在打开的列表里 1–9 选第 N 项。搜索框里的数字是**输入**不是选择——先让路。
    if (/^[1-9]$/.test(e.key) && !(e.target instanceof HTMLInputElement)) {
      const target = flat[Number(e.key) - 1];
      if (target !== undefined) { e.preventDefault(); props.onPick(target.registryId); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(h + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      const target = flat[hl];
      if (target !== undefined) { e.preventDefault(); props.onPick(target.registryId); }
    }
  };

  return (
    <Popover
      open
      up
      className="mp-pop"
      role="listbox"
      aria-label={STR.modelPicker.menuAria}
      onKeyDown={onKeyNav}
      {...(props.maxHeight !== undefined ? { style: { maxHeight: props.maxHeight } } : {})}
    >
      <div className="mp-search">
        <input
          ref={searchRef}
          type="text"
          aria-label={STR.modelPicker.searchAria}
          placeholder={STR.modelPicker.searchPlaceholder}
          value={query}
          autoFocus
          onChange={(e) => { setQuery(e.target.value); setHl(0); }}
        />
      </div>
      {warn && (
        <button type="button" className="menu-item mp-warn" onClick={() => props.onOpenSettings?.()}>
          <span>⚠ {props.keyNotice}</span>
          <span className="sub">{STR.modelPicker.goSettings}</span>
        </button>
      )}
      {groups.map((g) => (
        <div key={g.provider}>
          <div className="mp-group-label">
            {/* 分组圆点：中性灰（v7.1 业主裁——按 provider 名取色相是装饰性用色，会被误读成状态点）。 */}
            <span className="g-dot" aria-hidden="true" />
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
                {STR.modelPicker.tierMeta.replace("{tier}", tierBadge(m.tier)).replace("{ctx}", formatCtxWindow(m.ctxWindow))}
              </span>
              {m.vision === true && <span className="v-badge" title={STR.modelPicker.visionTip}><Eye size={11} /></span>}
              {m.registryId === props.value && <span className="check">✓</span>}
            </button>
          ))}
        </div>
      ))}
      {groups.length === 0 && !demoVisible && (
        <div className="pop-label">{STR.modelPicker.noMatch.replace("{q}", query.trim())}</div>
      )}
      {groups.length === 0 && demoVisible && (
        <div className="pop-label">{STR.modelPicker.noModels}</div>
      )}
      {demoVisible && (
        <button
          type="button"
          role="option"
          aria-selected={props.value === null}
          className="menu-item"
          disabled={props.running === true}
          // 行副文案放短词（长句在 300px 菜单里折成两行、行高翻倍）；完整免责句进 title 与触发条。
          title={STR.modelPicker.demoTitle}
          onClick={() => props.onPick(null)}
        >
          <span className="mi-name">{STR.modelPicker.demo}</span>
          <span className="sub">{STR.modelPicker.demoSub}</span>
          {props.value === null && <span className="check">✓</span>}
        </button>
      )}
      {wantEffort && (
        <>
          <div className="menu-sep" />
          {/* 运行中注记只在真有可调的东西时出现（未声明支持的模型不谎称「思考程度可调」）。 */}
          {modelsDisabled && supported && <div className="menu-note">{STR.modelPicker.runningNote}</div>}
          <div className="pop-label">{STR.modelPicker.effortLabel}</div>
          <div className="th-row" role="group" aria-label={STR.modelPicker.effortGroupAria} ref={effortRef} tabIndex={-1} data-effort-anchor="true">
            {THINKING_LEVELS.map((lv) => (
              <button
                key={lv.id}
                type="button"
                data-e={lv.id}
                title={lv.hint}
                aria-pressed={level === lv.id}
                disabled={!supported}
                onClick={() => { props.onThinkingChange?.(lv.id); }}
              >{lv.short}</button>
            ))}
          </div>
          {supported ? (
            <div className="th-hint">{currentLevel.hint}</div>
          ) : (
            <>
              <div className="th-off" role="status">{STR.modelPicker.unsupportedNote}</div>
              <details className="th-why">
                <summary className="th-info">
                  <Info size={12} className="th-info-ico" aria-hidden="true" />
                  <span>{STR.modelPicker.whySummary}</span>
                  <span className="th-info-link">{STR.modelPicker.whyLink}</span>
                </summary>
                <div className="th-why-body">{STR.modelPicker.whyBody}</div>
              </details>
            </>
          )}
        </>
      )}
      {props.onOpenSettings !== undefined && (
        <div className="mp-foot">
          <button type="button" className="menu-item" onClick={() => props.onOpenSettings?.()}>
            <Settings size={12} />
            <span>{STR.modelPicker.manage}</span>
          </button>
        </div>
      )}
    </Popover>
  );
}
