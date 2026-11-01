// C-21 `ModelPicker`（§5.4 Row3）——P2-2 合并单面（brief 三节：模型 chip「模型名 · 思考强度」，
// 点击一个弹窗：搜索 + 模型列表（上下文长度 / 思考 / 图片能力）+ 下半区思考强度 Segmented）。
// 旧两视图（思考面 × 换模型面）作废：一屏说全——上列表、下思考段，少一次翻面。
// 触发条 = 单芯片形态：`deepseek-chat · 思考 关 ⌄`（档词 = 关/低/中/强/最高；未声明支持不带思考段）。
// 数据面不变（唯一事实源仍是 `getProviderInfo()`，本层不造第二份）；文案全出处 STR。
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Eye, Info, Search, Settings, SlidersHorizontal } from "lucide-react";
import type { ProviderInfo } from "../../../../../src/main/ipc-protocol";
import { formatTokens } from "../derived/format-tokens";
import { STR } from "../strings";
import { isCompositionEnter } from "../ime";
import { Popover, usePopoverDismiss } from "./Popover";
import { menuNavIndex } from "./popover-keys";
import {
  readThinkingHidden,
  visibleThinkingLevels,
  toggleThinkingHidden,
  reconcileVisibleLevel,
  writeThinkingHidden,
} from "../state/thinking-prefs";
import "./model-menu.css";

/** 向上打开的真实可用高度：38px 标题栏 + 6px 间隙。空间不足交给布局选择向下开。 */
export function modelMenuMaxHeight(triggerTop: number): number {
  return Math.max(0, Math.min(560, Math.floor(triggerTop - 44)));
}

/** 空间不足时向下打开；高度只取真实可用空间，不能靠最小高度越出窗口。 */
export function modelMenuLayout(top: number, bottom: number, viewportHeight: number): { up: boolean; maxHeight: number; viewportTop?: number } {
  const above = modelMenuMaxHeight(top);
  const below = Math.max(0, Math.min(560, Math.floor(viewportHeight - bottom - 8)));
  // 矮窗口两边都放不下一份可操作的列表时，改用窗口内浮层。
  if (Math.max(above, below) < 260) return { up: false, maxHeight: Math.max(0, viewportHeight - 56), viewportTop: 44 };
  // 哪边空间大就往哪边开。旧判据是 `above >= min(320, below)`：上方只要凑够 320 就赢，
  // 于是 1440×900 的空屏上（上 327 / 下 456）明明下面多出 129px 却仍向上开——
  // 列表被挤到 139px（内容 209px），最后一个 provider 的组头露着、它那一行模型整行看不见，
  // 读起来就是一个空分组（真机自查 `模型分组裁剪自查` 抓到过：dangling: ["glm"]）。
  const up = above >= below;
  return { up, maxHeight: up ? above : below };
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
  /** 该模型**自己声明**的思考档位（capability.thinking.values）；未声明支持 = 缺席。
   *  对标 Codex：每个模型带自己的 supportedReasoningEfforts，菜单按**当前模型**出档，
   *  而不是把全局四档硬塞给所有模型（此前能给不支持的档 ⇒ 请求被 provider 拒）。 */
  thinkingLevels?: readonly string[];
  /** 该模型的缺省思考档（capability.thinking.default）。 */
  thinkingDefault?: string;
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

/** 上下文窗口的人话写法（第 937 页）：与用量环 / 检查器 / 时间线 / 用量页同一把尺（`formatTokens`）。
 *  这里原来自己写了一套（12000 → `12k`、1_000_000 → `1M`）⇒ 同一个窗口在模型菜单写「128k」、
 *  在用量浮层写「128.0k」。缺省仍给「—」而不是 0。 */
export function formatCtxWindow(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n <= 0) return STR.composer.dash;
  return formatTokens(n);
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
      const th = spec.capability.thinking;
      options.push({
        registryId: spec.id,
        label: spec.model,
        provider: spec.provider,
        tier: spec.tier,
        ctxWindow: spec.ctxWindow,
        ...(spec.capability.attachments.image === true ? { vision: true } : {}),
        ...(th.supported === true ? { thinkingLevels: th.values, thinkingDefault: th.default } : {}),
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

/** 换模型后思考档的**归位**（对标 Codex 的 `supportedReasoningEfforts` + `defaultReasoningEffort`：
 *  当前档不被新模型支持 ⇒ 落到该模型的缺省档 ⇒ 再退 ⇒ 该模型声明的第一档）。
 *
 *  模型**没声明**思考（levels 缺席）⇒ 归位到 "off"：给不支持思考的模型发思考参数
 *  = 白烧 token（provider 侧会拒）。
 *
 *  纯函数、可判卷；调用方在**换模型**与**渲染芯片**两处都用它 ⇒ 界面显示的档
 *  与真正发出去的档永远是同一个（此前两者会分叉：芯片显示旧档、请求发新档）。 */
export function reconcileThinkingLevel(
  current: string,
  levels: readonly string[] | undefined,
  fallback: string | undefined,
): string {
  if (levels === undefined || levels.length === 0) return "off";
  if (levels.includes(current)) return current;
  if (fallback !== undefined && levels.includes(fallback)) return fallback;
  return levels[0] ?? "off";
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

/** 思考档位词表（分段短词族：关/低/中/强/最高；id 即请求侧字面量，不动；文案出处 STR）。 */
export const THINKING_LEVELS = [
  { id: "off", short: STR.modelPicker.thinkOff, hint: STR.modelPicker.thinkOffHint },
  { id: "low", short: STR.modelPicker.thinkLow, hint: STR.modelPicker.thinkLowHint },
  { id: "medium", short: STR.modelPicker.thinkMedium, hint: STR.modelPicker.thinkMediumHint },
  { id: "high", short: STR.modelPicker.thinkHigh, hint: STR.modelPicker.thinkHighHint },
  { id: "max", short: STR.modelPicker.thinkMax, hint: STR.modelPicker.thinkMaxHint },
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
  /** 开合**由上层持有**（2026-10-28 · 第 752 页）：模型菜单此前自己一份 open 态，
   *  与 Composer 的浮层槽（用量环/附件/权限）**互不知情** ⇒ 模型菜单开着时点用量环，
   *  两个浮层同屏叠放（真机复现：几何真的重叠，用量浮层盖住模型菜单右半）。
   *  现在开合真相在 Composer 一处，本组件是受控件。 */
  open?: boolean;
  /** 请求开/关（受控件的唯一出口）：上层据此收口同带的其他浮层。 */
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  // 受控优先：给了 `open` 就以外部为准；没给（嵌用面）退回内部态（旧行为不变）。
  const controlled = props.open !== undefined;
  const open = controlled ? props.open === true : internalOpen;
  const setOpen = useCallback((next: boolean): void => {
    if (props.onOpenChange !== undefined) {
      props.onOpenChange(next);
      return;
    }
    setInternalOpen(next);
  }, [props.onOpenChange]);
  const box = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 菜单向上开，高度必须让出标题栏：空屏输入卡在中部，393px 菜单会顶穿窗口上沿。
  const [menuMax, setMenuMax] = useState<number | undefined>(undefined);
  const [menuUp, setMenuUp] = useState(true);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>();
  useLayoutEffect(() => {
    if (!open) { setMenuMax(undefined); return; }
    const update = (): void => {
      const rect = box.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const layout = modelMenuLayout(rect.top, rect.bottom, window.innerHeight);
      setMenuMax(layout.maxHeight);
      setMenuUp(layout.up);
      setMenuPosition(layout.viewportTop === undefined ? undefined : {
        top: layout.viewportTop - rect.top,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 356)) - rect.left,
      });
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
  // 当前选中模型**自己声明**的思考档（缺席 = 该模型不支持思考）。
  const selected = options.find((o) => o.registryId === props.value);
  // 芯片显示的是**当前档**（用户设的那一档 = 真正发出去的那一档；既有契约）。
  const level = props.thinking ?? "off";
  // 归位档：当前档不被该模型支持时的落点（对标 Codex 的 defaultReasoningEffort）。
  // 归位**不在显示层偷换**（芯片不许显示一档、请求发另一档），
  // 而是由下面的 effect 把它写回状态 ⇒ 显示与请求永远同一个。
  const reconciled = reconcileThinkingLevel(level, selected?.thinkingLevels, selected?.thinkingDefault);
  const levelLabel = THINKING_LEVELS.find((l) => l.id === level)?.short ?? STR.modelPicker.thinkOff;
  // 首次挂载不弹（那是「进场」）；换过模型之后才弹（那是「值变了」）。
  const everPicked = useRef(false);
  // 换模型 ⇒ 思考档归位（对标 Codex）：两条路径都走这里——用户在菜单里点模型，
  // 以及父级直接换 value（切会话 / 恢复会话 / provider 列表变了）。
  // 只在「归位档 ≠ 当前档」时写回，避免来回写回造成死循环。
  useEffect(() => {
    if (props.onThinkingChange === undefined) return;
    if (reconciled !== level) props.onThinkingChange(reconciled);
    // 依赖只认 value：档本身变化不该再触发一次归位（那是 effect 自己写的）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  const close = useCallback(() => setOpen(false), [setOpen]);
  // 外点 / Esc 关闭：单源在 Popover（阶段 1 共享化；行为与旧内联监听逐条同构）。
  usePopoverDismiss(open, close, box, triggerRef);

  const pick = (registryId: string | null): void => {
    // 换模型 ⇒ 思考档**归位**（对标 Codex）：新模型不支持当前档时，当场落到它的缺省档
    // 并通知上层。否则给不支持思考的模型发思考参数（provider 侧会拒）。
    const next = options.find((o) => o.registryId === registryId);
    const nextLevel = reconcileThinkingLevel(level, next?.thinkingLevels, next?.thinkingDefault);
    if (nextLevel !== level) props.onThinkingChange?.(nextLevel);
    everPicked.current = true;
    props.onChange(registryId);
    close();
  };

  return (
    <div className="mp" ref={box}>
      <button
        type="button"
        className="mp-trigger"
        ref={triggerRef}
        aria-label={STR.modelPicker.triggerAria}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={describeSelection(props.value, options)}
        disabled={props.disabled}
        onClick={() => { props.onUserOpen?.(); setOpen(!open); }}
      >
        {/* 芯片的值变了 ⇒ 名字这一格**重挂** ⇒ 播放「弹一下」的动效（对标 Claude 的
            cds-pill-pop：上冲 40% 时长到 1.32，再落回，overshoot 收尾）。
            key 变了 ⇒ React 重挂 ⇒ CSS 动画重播（不必手动重置动画状态）。 */}
        <span className="mp-name" key={`mp-name-${String(props.value)}`} data-pop={everPicked.current ? "true" : "false"}>
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
          up={menuUp}
          options={options}
          value={props.value}
          maxHeight={menuMax}
          viewportPosition={menuPosition}
          {...(props.disabled === true || props.running === true ? { running: true } : {})}
          initialFocus={props.initialFocus ?? "model"}
          keyNotice={notice}
          {...(props.onOpenSettings !== undefined ? { onOpenSettings: props.onOpenSettings } : {})}
          {...(props.onThinkingChange !== undefined
            ? {
                thinking: reconciled,
                thinkingSupported: props.thinkingSupported === true,
                ...(selected?.thinkingLevels !== undefined ? { thinkingLevels: selected.thinkingLevels } : {}),
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
  viewportPosition?: { top: number; left: number };
  up?: boolean;
  /** 当前思考档位（缺省 off）。 */
  thinking?: string;
  /** 当前模型**自己声明**的思考档位；给了就只出这些档（对标 Codex 的 supportedReasoningEfforts）。
   *  不给 = 沿用全局四档（旧行为；未声明支持的模型整段禁用，见下）。 */
  thinkingLevels?: readonly string[];
  /** 当前模型是否**声明**支持思考档位；未声明 ⇒ 整区禁用 + 注记 + 配置折叠（fail-visible）。 */
  thinkingSupported?: boolean;
  onThinkingChange?: (level: string) => void;
  /** 打开落点（2026-10-18）：effort = 首帧把焦点送进思考档分段（⌘⇧E）；
   *  model = 保持搜索框 autofocus（⌘⇧I / 点击）。 */
  initialFocus?: "model" | "effort";
}): React.JSX.Element {
  const wantEffort = props.onThinkingChange !== undefined;
  const [query, setQuery] = useState("");
  const [hl, setHl] = useState(() => {
    const ordered = [...groupModels(props.options).flatMap((g) => g.models), { registryId: null }];
    return Math.max(0, ordered.findIndex((m) => m.registryId === props.value));
  });
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
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
  // 档位列表 = **当前模型声明的档**（对标 Codex：每个模型带自己的 supportedReasoningEfforts）。
  // 此前无论哪个模型都摆全局四档 ⇒ 能选到该模型不支持的档（请求会被 provider 拒）。
  // 模型没声明 ⇒ 沿用四档但整段禁用（fail-visible，见下方 unsupportedNote）。
  const declared = props.thinkingLevels;
  // 2026-10-31 · 业主「有多少档、用户可以自己定义，但默认从上游得知」：
  // 声明表仍由上游决定（capability），用户只能收起不想看到的档（存 localStorage，见 state/thinking-prefs）。
  const [hidden, setHidden] = useState<readonly string[]>(() => {
    if (props.value === null) return [];
    return readThinkingHidden()[props.value] ?? [];
  });
  const [editingEfforts, setEditingEfforts] = useState(false);
  useEffect(() => {
    setHidden(props.value === null ? [] : readThinkingHidden()[props.value] ?? []);
    setEditingEfforts(false);
  }, [props.value]);
  const declaredIds = declared ?? THINKING_LEVELS.map((l) => l.id);
  const visibleIds = visibleThinkingLevels(declaredIds, hidden);
  const levels: readonly { id: string; short: string; hint: string }[] = (declared === undefined || declared.length === 0
    ? THINKING_LEVELS.map((l) => l.id)
    : declaredIds
  ).filter((id) => visibleIds.includes(id)).map((id) => THINKING_LEVELS.find((l) => l.id === id) ?? { id, short: id, hint: "" });
  const levelLabelOf = (id: string): string => THINKING_LEVELS.find((l) => l.id === id)?.short ?? id;
  const modelDefaultLevel = props.options.find((o) => o.registryId === props.value)?.thinkingDefault;
  // 用户收起当前档 ⇒ 当场归位（显示与请求永远同一个；与换模型归位同一条契约）。
  useEffect(() => {
    if (!supported) return;
    const next = reconcileVisibleLevel(level, levels.map((l) => l.id), modelDefaultLevel);
    if (next !== level) props.onThinkingChange?.(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, props.value]);
  const commitHidden = (next: readonly string[]): void => {
    if (props.value === null) return;
    const map = { ...readThinkingHidden(), [props.value]: next };
    writeThinkingHidden(map);
    setHidden(next);
  };
  const optionId = (index: number): string => `${listId}-option-${index}`;
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]')?.scrollIntoView({ block: "nearest" });
  }, [hl, query]);
  // ⌘⇧E 的落点（2026-10-18）：首帧滚到思考分段并聚焦当前档按钮；模型不声明思考时
  // 分段整区禁用——聚焦分组本身（读屏仍报「思考强度，不可用」+ 下方说明），不静默。
  const effortRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (props.initialFocus !== "effort") { searchRef.current?.focus(); return; }
    const box = effortRef.current;
    if (box === null) return;
    const target = box.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)') ?? box.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? box;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
  }, [props.initialFocus]);

  const onKeyNav = (e: React.KeyboardEvent): void => {
    if (isCompositionEnter(e, null) || modelsDisabled) return;
    const targetElement = e.target as HTMLElement;
    const inSearch = targetElement === searchRef.current;
    if (!inSearch && targetElement.closest('[role="option"]') === null) return;
    // 蓝本 §3.6：在打开的列表里 1–9 选第 N 项。搜索框里的数字是**输入**不是选择——先让路。
    if (/^[1-9]$/.test(e.key) && !(e.target instanceof HTMLInputElement)) {
      const target = flat[Number(e.key) - 1];
      if (target !== undefined) { e.preventDefault(); props.onPick(target.registryId); }
      return;
    }
    const next = inSearch && (e.key === "Home" || e.key === "End") ? null : menuNavIndex(e.key, hl, flat.length);
    if (next !== null) { e.preventDefault(); setHl(next); }
    else if (e.key === "Enter") {
      const target = flat[hl];
      if (target !== undefined) { e.preventDefault(); props.onPick(target.registryId); }
    }
  };

  return (
    <Popover
      open
      up={props.up !== false}
      className="mp-pop"
      role="dialog"
      aria-label={STR.modelPicker.menuAria}
      onKeyDown={onKeyNav}
      style={{ maxHeight: props.maxHeight, ...(props.viewportPosition === undefined ? {} : { bottom: "auto", ...props.viewportPosition }) }}
    >
      <div className="mp-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={flat[hl] === undefined || modelsDisabled ? undefined : optionId(hl)}
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
        </button>
      )}
      <div id={listId} className="mp-models" role="listbox" aria-label={STR.modelPicker.menuAria} ref={listRef}>
      {groups.map((g, gi) => (
        <div key={g.provider} className={"mp-group" + (gi > 0 ? " separated" : "")}>
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
              id={optionId(flat.indexOf(m))}
              aria-selected={m.registryId === props.value}
              className="menu-item"
              disabled={modelsDisabled}
              tabIndex={-1}
              data-highlighted={flat.indexOf(m) === hl}
              title={STR.modelPicker.tierMeta.replace("{tier}", tierBadge(m.tier)).replace("{ctx}", formatCtxWindow(m.ctxWindow))}
              onPointerMove={() => setHl(flat.indexOf(m))}
              onFocus={() => setHl(flat.indexOf(m))}
              onClick={() => props.onPick(m.registryId)}
            >
              <span className="mi-name">{m.label}</span>
              <span className="sub">
                {m.ctxWindow !== undefined ? formatCtxWindow(m.ctxWindow) : ""}
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
          id={optionId(flat.length - 1)}
          aria-selected={props.value === null}
          className="menu-item"
          tabIndex={-1}
          data-highlighted={hl === flat.length - 1}
          onPointerMove={() => setHl(flat.length - 1)}
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
      </div>
      <div className="mp-controls">
      {wantEffort && (
        <>
          <div className="menu-sep" />
          {/* 运行中注记只在真有可调的东西时出现（未声明支持的模型不谎称「思考程度可调」）。 */}
          {modelsDisabled && supported && <div className="menu-note">{STR.modelPicker.runningNote}</div>}
          <div className="th-head">
            <span className="pop-label">{STR.modelPicker.effortLabel}</span>
            {supported && declared !== undefined && declared.length > 1 && (
              <button
                type="button"
                className="th-custom"
                aria-expanded={editingEfforts}
                onClick={() => { setEditingEfforts(!editingEfforts); }}
              >
                <SlidersHorizontal size={11} aria-hidden="true" />
                {editingEfforts ? STR.modelPicker.effortDone : STR.modelPicker.effortCustom}
              </button>
            )}
          </div>
          {!editingEfforts ? (
            <div className="th-row" role="group" aria-label={STR.modelPicker.effortGroupAria} ref={effortRef} tabIndex={-1} data-effort-anchor="true">
              {levels.map((lv) => (
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
          ) : (
            <div className="th-edit" role="group" aria-label={STR.modelPicker.effortEditAria}>
              <p className="th-edit-note">{STR.modelPicker.effortEditNote.replace("{levels}", declaredIds.filter((id) => id !== "off").join(" / ") || STR.modelPicker.effortUndeclared)}</p>
              <div className="th-edit-list">
                {declaredIds.filter((id) => id !== "off").map((id) => {
                  const on = !hidden.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className="th-edit-chip"
                      onClick={() => { commitHidden(toggleThinkingHidden(hidden, id, declaredIds)); }}
                    >
                      <span className="th-edit-box" aria-hidden="true">{on ? "✓" : ""}</span>
                      <span>{levelLabelOf(id)}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="th-reset" onClick={() => { commitHidden([]); }}>
                {STR.modelPicker.effortReset}
              </button>
            </div>
          )}
          {!supported && (
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
      </div>
    </Popover>
  );
}
