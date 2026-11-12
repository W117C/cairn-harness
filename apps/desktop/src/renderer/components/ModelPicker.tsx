// C-21 `ModelPicker`（§5.4 Row3）——P2-2 合并单面（brief 三节：模型 chip「模型名 · 思考强度」，
// 点击一个弹窗：搜索 + 模型列表（上下文长度 / 思考 / 图片能力）+ 下半区思考强度 Segmented）。
// 旧两视图（思考面 × 换模型面）作废：一屏说全——上列表、下思考段，少一次翻面。
// 触发条 = 单芯片形态：`deepseek-chat · 思考 关 ⌄`（档词 = 关/低/中/强/最高；未声明支持不带思考段）。
// 数据面不变（唯一事实源仍是 `getProviderInfo()`，本层不造第二份）；文案全出处 STR。
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, Info, Search, Settings, SlidersHorizontal, X } from "lucide-react";
import type { ProviderInfo } from "../../../../../src/main/ipc-protocol";
import { formatTokens } from "../derived/format-tokens";
import { STR } from "../strings";
import { isCompositionEnter } from "../ime";
import { Popover, usePopoverDismiss } from "./Popover";
import {
  readThinkingHidden,
  visibleThinkingLevels,
  toggleThinkingHidden,
  reconcileVisibleLevel,
  writeThinkingHidden,
} from "../state/thinking-prefs";
import "./model-menu.css";

/** 菜单宽度上限（与 model-menu.css 的 `max-width: min(420px, calc(100vw - 24px))` 同一把尺）。
 *  CSS 是 fit-content（240–420）：这里取**最大**宽度做右沿夹取的保守假设。取 344 会让
 *  实际 420 宽的菜单在 880 窄窗右缘溢出 76px（2026-11-05 审计抓到）。 */
export const MODEL_MENU_WIDTH = 420;
/** 弹层与窗口边缘的最小留白（与 CSS 的 `100vw - 24px` 一致：左右各 12px）。 */
const MODEL_MENU_GUTTER = 12;

/** 向上打开的真实可用高度：38px 标题栏 + 6px 间隙。空间不足交给布局选择向下开。 */
export function modelMenuMaxHeight(triggerTop: number): number {
  return Math.max(0, Math.min(560, Math.floor(triggerTop - 44)));
}

/** 水平落点（纯函数）：默认左对齐触发器，但整块必须留在窗口内（左右各让 12px）。
 *
 *  模型控制移到输入框右侧后，触发条贴着窗口右沿；344px 的菜单若仍一律 `left: 0`
 *  向右开，右半会被窗口切掉——模型行的「窗口 …」、图片徽标、思考档与说明只剩半截
 *  （真机窄窗复现）。夹取后菜单向左让位；窗口更窄时 CSS 会把宽度收到 `100vw - 24px`，
 *  这里同步收宽度，保证算出的左沿与真实渲染宽度是同一把尺。 */
export function modelMenuLeft(triggerLeft: number, viewportWidth: number): number {
  const width = Math.min(MODEL_MENU_WIDTH, Math.max(0, viewportWidth - MODEL_MENU_GUTTER * 2));
  const maxLeft = Math.max(MODEL_MENU_GUTTER, viewportWidth - MODEL_MENU_GUTTER - width);
  return Math.min(Math.max(triggerLeft, MODEL_MENU_GUTTER), maxLeft);
}

/** 菜单可用的横向边界：最近的横向裁剪祖先（主区 `.main` 是 `overflow-x: clip`；
 *  右侧窗格打开时它会变窄，只按窗口宽度算仍会被主区裁掉）。没有就退回窗口。 */
function menuBounds(from: HTMLElement | null): { left: number; right: number } {
  let el = from?.parentElement ?? null;
  while (el !== null && el !== document.body) {
    if (getComputedStyle(el).overflowX !== "visible") {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }
    el = el.parentElement;
  }
  return { left: 0, right: window.innerWidth };
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

/** 真模型铺平（provider 分组交给菜单的分节）。
 *  多个 ProviderInfo 会重复铺同一行 ⇒ 按 spec.id 去重，顺序保持首见。
 *
 *  「演示」**不在列表里**（业主 2026-11-01 裁：「不要演示」）：演示仍是 app 的缺省通道，
 *  芯片照旧显示它的名字（`shortModelName` / `describeSelection`），只是不再占一格可选项。 */
export function flattenModels(infos: readonly ProviderInfo[]): ModelOption[] {
  const options: ModelOption[] = [];
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

/** 按 provider 分组（保持首见顺序）。无 provider 的项（演示通道）不归组。 */
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

/** provider id → 人话标签（唯一事实源 = `ProviderInfo.providers`，主进程从注册表铺出来）。
 *  组头原先直接印 id（「custom」「agnes-ai」）——用户看到的是配置里的机器名，不是这家叫什么。
 *  没登记在册的 id 兜底回 id（不猜、不编）。 */
export function providerLabelMap(infos: readonly ProviderInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const info of infos) {
    for (const p of info.providers) {
      if (p.label !== "" && !map.has(p.id)) map.set(p.id, p.label);
    }
  }
  return map;
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
  { id: "xhigh", short: STR.modelPicker.thinkXhigh, hint: STR.modelPicker.thinkXhighHint },
  { id: "max", short: STR.modelPicker.thinkMax, hint: STR.modelPicker.thinkMaxHint },
] as const;

const THINKING_BY_ID = new Map<string, (typeof THINKING_LEVELS)[number]>(THINKING_LEVELS.map((level) => [level.id, level] as const));

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
  // left 总会给（右沿夹取）；top 只在矮窗口的「窗口内浮层」档给，正常档仍吃 .pop.up/.down 的贴边。
  const [menuPosition, setMenuPosition] = useState<{ top?: number; left: number }>();
  useLayoutEffect(() => {
    if (!open) { setMenuMax(undefined); return; }
    const update = (): void => {
      const rect = box.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const layout = modelMenuLayout(rect.top, rect.bottom, window.innerHeight);
      setMenuMax(layout.maxHeight);
      setMenuUp(layout.up);
      // 在裁剪祖先的坐标系里夹取，再换算回 `.mp` 的相对偏移。
      const bounds = menuBounds(box.current);
      const left = modelMenuLeft(rect.left - bounds.left, bounds.right - bounds.left) + bounds.left - rect.left;
      setMenuPosition(layout.viewportTop === undefined
        ? { left }
        : { top: layout.viewportTop - rect.top, left });
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
  // 第 1119 页：infos 不变时（搜索输入/高亮变化）不再重建模型表与标签表。
  const allOptions = useMemo(() => flattenModels(props.infos), [props.infos]);
  const options = useMemo(() => props.configuredProviders === undefined
    ? allOptions
    : allOptions.filter((o) => o.provider !== null && props.configuredProviders!.has(o.provider)), [allOptions, props.configuredProviders]);
  // 组头显示人话标签（「DeepSeek」而不是「deepseek」）——标签表随 infos 一路带下来。
  const providerLabels = useMemo(() => providerLabelMap(props.infos), [props.infos]);
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
  const levelLabel = THINKING_BY_ID.get(level)?.short ?? STR.modelPicker.thinkOff;
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
          providerLabels={providerLabels}
          value={props.value}
          maxHeight={menuMax}
          viewportPosition={menuPosition}
          {...(props.disabled === true || props.running === true ? { running: true } : {})}
          initialFocus={props.initialFocus}
          keyNotice={notice}
          onClose={close}
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

/** 菜单面板：root（模型/思考强度 cell）、model（列表+搜索）、effort（档位行）。 */
type Pane = "root" | "model" | "effort";

/** 菜单本体（2026-11-04 业主裁：做成 DeepSeek 官方 harness `ui-model-selection` 一模一样的两级面板）。
 *  root = 「模型 / 思考强度」两枚 cell（label + 当前值 + 右尖括号），点进去才是各自的面板；
 *  模型面 = 搜索（>4 个模型才出现，带清除 ×）+ provider 分组（组头吸顶）+ 名称行 + 尾随 ✓；
 *  思考面 = 档位 radio 行（旧底部 Segmented 下架）。Esc / ⇧Tab 先退回 root 再关菜单；
 *  Tab 在行上 = 选中该行，在搜索框 = 接受高亮行（对标 DeepSeek MenuSelect 键位）。
 *  既有契约全保留：运行中只禁模型行；key 提示置顶 root；1–9 快选；档位自定义（收起档）；
 *  不支持思考 ⇒ 思考面空态 + 配置折叠（ADR-0009 fail-visible）；「演示」不在列表里。
 *  判卷序列见 render-structure.test.tsx / model-picker-axis.test.tsx。 */
export function ModelMenu(props: {
  options: readonly ModelOption[];
  /** provider id → 人话标签（组头显示它；没登记在册的 id 兜底回 id）。 */
  providerLabels?: ReadonlyMap<string, string>;
  value: string | null;
  /** 运行中：模型列表整列禁用（规范「运行中 disabled」）；**思考强度不在此列**——
   *  v7.2 业主裁：思考档是「下一轮派活」的旋钮，跑着也能拧（只随 capability 锁）。 */
  running?: boolean;
  /** key 未配置时的置顶提示行（root 面板底部）；undefined / null = 不显示。 */
  keyNotice?: string | null;
  onPick: (registryId: string | null) => void;
  onOpenSettings?: () => void;
  /** 向上开时允许的最大高度（px）；undefined = 不限制（测试/旧调用）。
   *  视觉上限照 DeepSeek 卡片 ≤360px（超出滚动；空间不足时取实际可用高度）。 */
  maxHeight?: number;
  /** 弹层落点（相对 `.mp`）：left 始终给（窗口右沿夹取）；top 只在矮窗口的窗口内浮层档给。 */
  viewportPosition?: { top?: number; left?: number };
  up?: boolean;
  /** 当前思考档位（缺省 off）。 */
  thinking?: string;
  /** 当前模型**自己声明**的思考档位；给了就只出这些档（对标 Codex 的 supportedReasoningEfforts）。
   *  不给 = 沿用全局四档（旧行为；未声明支持的模型整段禁用，见下）。 */
  thinkingLevels?: readonly string[];
  /** 当前模型是否**声明**支持思考档位；未声明 ⇒ 思考面出空态 + 配置折叠（ADR-0009 fail-visible）。 */
  thinkingSupported?: boolean;
  onThinkingChange?: (level: string) => void;
  /** 打开落点（2026-10-18）：effort = 直落思考面（⌘⇧E）；model = 直落模型面聚焦搜索（⌘⇧I）；
   *  缺省（点击开）= root 面板；未选模型（演示）时 root 没有可显示的值 ⇒ 直落模型面。 */
  initialFocus?: "model" | "effort";
  /** 请求关闭（⇧Tab 在 root / 退无可退时的 Esc 之外通道；开合真相在上层）。 */
  onClose?: () => void;
}): React.JSX.Element {
  const wantEffort = props.onThinkingChange !== undefined;
  const [pane, setPane] = useState<Pane>(() =>
    props.initialFocus === "effort" ? "effort"
    : props.initialFocus === "model" || props.value === null ? "model"
    : "root",
  );
  const [query, setQuery] = useState("");
  const [hl, setHl] = useState(() => {
    // 高亮落在当前选中的那一行；选中项不在列表里（演示通道）⇒ 回到首行，不越界。
    const ordered = groupModels(props.options).flatMap((g) => g.models);
    return Math.max(0, ordered.findIndex((m) => m.registryId === props.value));
  });
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const effortRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const modelCellRef = useRef<HTMLButtonElement | null>(null);
  const effortCellRef = useRef<HTMLButtonElement | null>(null);
  // DeepSeek 规则：目录 >4 个模型才出搜索；更短的目录不需要搜。
  const showSearch = props.options.length > 4;
  // 第 1124 页：搜索/高亮变化不重建目录——filter/group/flat/index 都按上一层引用记忆。
  const filtered = useMemo(() => filterModelOptions(props.options, showSearch ? query : ""), [props.options, showSearch, query]);
  const groups = useMemo(() => groupModels(filtered), [filtered]);
  const flat: ModelOption[] = useMemo(() => groups.flatMap((g) => g.models), [groups]);
  // 第 1102 页：组内每行原先 indexOfModel(m) 扫全表（菜单打开时 O(n²)）；一次 Map 建索引。
  const flatIndex = useMemo(() => new Map(flat.map((m, i) => [m, i] as const)), [flat]);
  const indexOfModel = (m: ModelOption): number => flatIndex.get(m) ?? 0;
  const warn = props.keyNotice !== undefined && props.keyNotice !== null;
  const modelsDisabled = props.running === true;
  const supported = props.thinkingSupported === true;
  const level = props.thinking ?? "off";
  // root 思考 cell 的当前值（档位短词；不支持时显示「不支持」注记）。
  const levelLabel = THINKING_BY_ID.get(level)?.short ?? STR.modelPicker.thinkOff;
  // 档位列表 = **当前模型声明的档**（对标 Codex：每个模型带自己的 supportedReasoningEfforts）。
  // 模型没声明 ⇒ 思考面出空态（fail-visible，见下）。
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
  const levelLabelOf = (id: string): string => THINKING_BY_ID.get(id)?.short ?? id;
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
  // 面板切换后把焦点送进当前面板（对标 DeepSeek：drill 进的面板聚焦当前值那一行；
  // root 不抢焦点——触发条保持焦点）。⌘⇧E 首帧（pane 初始即 effort）同走这里：
  // 聚焦当前档那一行（不支持 ⇒ 聚焦面板容器）。
  // 注：↑/↓ 只在本面板（Popover）内生效——触发条在 Popover 外，它的键盘事件到不了这里。
  useEffect(() => {
    if (pane === "root") return;
    const raf = requestAnimationFrame(() => {
      if (pane === "model") {
        if (showSearch) { searchRef.current?.focus({ preventScroll: true }); return; }
        const checked = listRef.current?.querySelector<HTMLButtonElement>('button[aria-selected="true"]:not(:disabled)')
          ?? listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
        checked?.focus({ preventScroll: true });
        checked?.scrollIntoView({ block: "nearest" });
        return;
      }
      const checked = effortRef.current?.querySelector<HTMLButtonElement>('button[aria-selected="true"]:not(:disabled)')
        ?? effortRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
      if (checked !== null && checked !== undefined) {
        checked.focus({ preventScroll: true });
        checked.scrollIntoView({ block: "nearest" });
      } else {
        effortRef.current?.focus({ preventScroll: true }); // 空态/不支持：聚焦面板容器，读屏报空态
      }
      // ⌘⇧E 的落点承诺：聚焦后把当前行滚进视口（真机窄窗下当前档可能在滚动区外）。
      checked?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [pane, showSearch]);

  // 键位（对标 DeepSeek MenuSelect）：Esc / ⇧Tab 先退回 root 再关菜单；Tab 在行上 = 选中该行，
  // 在搜索框 = 接受高亮行；↑/↓ 在搜索框 = 移动高亮（焦点留在搜索框），其余场合 = 行间移动焦点；
  // 1–9 快选第 N 项（蓝本 §3.6；数字在搜索框里是输入，让路）。
  const onMenuKeyDown = (e: React.KeyboardEvent): void => {
    if (isCompositionEnter(e, null)) return;
    const key = e.key;
    const inSearch = e.target === searchRef.current;
    // 1–9 快选（模型面；搜索框里的数字是**输入**不是选择——先让路）。
    // 运行中锁定模型（v7.2：行 disabled + 键盘同口径，思考档行不锁）——否则鼠标被闸挡住、
    // 键盘 1–9 照样换模型，同一扇门两把锁。
    if (pane === "model" && !inSearch && /^[1-9]$/.test(key)) {
      if (modelsDisabled) return;
      const target = flat[Number(key) - 1];
      if (target !== undefined) { e.preventDefault(); props.onPick(target.registryId); }
      return;
    }
    if (key === "Enter" && inSearch) {
      // 搜索框聚焦时的 Enter = 接受高亮行（组字态已在函数头被拦下）。运行中同样不捡模型。
      if (modelsDisabled) return;
      const target = flat[hl];
      if (target !== undefined) { e.preventDefault(); props.onPick(target.registryId); }
      return;
    }
    if (key === "Escape" || (key === "Tab" && e.shiftKey)) {
      if (pane !== "root") {
        // 先退回 root，别让 usePopoverDismiss 的文档级 Esc 把菜单整个关掉。
        e.preventDefault();
        e.stopPropagation();
        back(pane);
      } else if (key === "Tab") {
        e.preventDefault();
        props.onClose?.();
      }
      return;
    }
    if (key === "Tab") {
      e.preventDefault();
      const active = document.activeElement;
      const onButton = active instanceof HTMLButtonElement && surfaceRef.current?.contains(active) === true && active !== searchRef.current;
      if (onButton) { active.click(); return; }
      if (inSearch) {
        if (modelsDisabled) return;
        const target = flat[hl];
        if (target !== undefined) props.onPick(target.registryId);
        return;
      }
      // 焦点在面板容器（不在任何行上，如空态 focus 落在 .mp-effort）：送进当前值那一行
      //（root cell / 选中行 / 当前档行）。
      const checked = surfaceRef.current?.querySelector<HTMLButtonElement>('button[aria-selected="true"]:not(:disabled)')
        ?? surfaceRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
      checked?.focus();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      e.preventDefault();
      const dir = key === "ArrowDown" ? 1 : -1;
      if (pane === "model" && showSearch && inSearch) {
        if (flat.length === 0) return;
        setHl((h) => (h + dir + flat.length) % flat.length);
        return;
      }
      moveFocus(dir);
    }
  };

  /** Leave a drilled pane for the root one, handing the keyboard back to its cell. */
  const back = (from: Exclude<Pane, "root">): void => {
    const cell = from === "model" ? modelCellRef : effortCellRef;
    setPane("root");
    window.requestAnimationFrame(() => { cell.current?.focus(); });
  };

  /** 行间移动焦点（DeepSeek moveFocus：焦点在触发条时，前进进首行、后退进末行）。 */
  const moveFocus = (offset: number): void => {
    const items = Array.from(surfaceRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (items.length === 0) return;
    const active = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = active === -1
      ? (offset > 0 ? 0 : items.length - 1)
      : (active + offset + items.length) % items.length;
    items[next]?.focus();
  };


  return (
    <Popover
      open
      up={props.up !== false}
      className="mp-pop"
      role="dialog"
      aria-label={STR.modelPicker.menuAria}
      onKeyDown={onMenuKeyDown}
      style={{
        // DeepSeek 卡片视觉上限 360px：更高的列表在内部滚动（空间不足时仍取实际可用高度）。
        maxHeight: props.maxHeight === undefined ? undefined : Math.min(props.maxHeight, 360),
        // top 只在窗口内浮层档出现；否则保留 .pop.up/.down 的 bottom/top 贴边。
        ...(props.viewportPosition?.top === undefined ? {} : { top: props.viewportPosition.top, bottom: "auto" }),
        ...(props.viewportPosition?.left === undefined ? {} : { left: props.viewportPosition.left }),
      }}
    >
      {pane === "root" && (
        <div className="mp-cells">
          <button type="button" ref={modelCellRef} className="mp-cell" onClick={() => setPane("model")}>
            <span className="mp-cell-label">{STR.modelPicker.menuModel}</span>
            <span className="mp-cell-value">{shortModelName(props.value, props.options)}</span>
            <ChevronRight size={12} aria-hidden="true" />
          </button>
          {wantEffort && (
            <button type="button" ref={effortCellRef} className="mp-cell" onClick={() => setPane("effort")}>
              <span className="mp-cell-label">{STR.modelPicker.effortLabel}</span>
              <span className="mp-cell-value">{supported ? levelLabel : STR.modelPicker.unsupportedNote}</span>
            </button>
          )}
          {warn && (
            <button type="button" className="menu-item mp-warn" onClick={() => props.onOpenSettings?.()}>
              <span>⚠ {props.keyNotice}</span>
            </button>
          )}
          {props.onOpenSettings !== undefined && (
            <div className="mp-foot">
              <button type="button" className="menu-item" onClick={() => props.onOpenSettings?.()}>
                <Settings size={12} aria-hidden="true" />
                <span>{STR.modelPicker.manage}</span>
              </button>
            </div>
          )}
        </div>
      )}
      {pane === "model" && (
        <>
          {showSearch && (
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
                onChange={(e) => { setQuery(e.target.value); setHl(0); }}
              />
              {query !== "" && (
                <button
                  type="button"
                  className="mp-search-clear"
                  aria-label={STR.modelPicker.searchClear}
                  onClick={() => { setQuery(""); searchRef.current?.focus(); }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <div id={listId} className="mp-models" role="listbox" aria-label={STR.modelPicker.menuAria} ref={listRef}>
            {groups.map((g, gi) => (
              <div key={g.provider} className={"mp-group" + (gi > 0 ? " separated" : "")}>
                {/* 组头显示人话标签（ProviderInfo.providers）；没登记在册就显示原 id。 */}
                <div className="mp-group-label">{props.providerLabels?.get(g.provider) ?? g.provider}</div>
                {g.models.map((m) => (
                  <button
                    key={m.registryId ?? "model"}
                    type="button"
                    role="option"
                    id={optionId(indexOfModel(m))}
                    aria-selected={m.registryId === props.value}
                    className="menu-item"
                    disabled={modelsDisabled}
                    tabIndex={showSearch ? -1 : 0}
                    data-highlighted={indexOfModel(m) === hl}
                    title={STR.modelPicker.tierMeta.replace("{tier}", tierBadge(m.tier)).replace("{ctx}", formatCtxWindow(m.ctxWindow))}
                    onPointerMove={() => setHl(indexOfModel(m))}
                    onFocus={() => setHl(indexOfModel(m))}
                    onClick={() => props.onPick(m.registryId)}
                  >
                    <span className="mi-name">{m.label}</span>
                    {m.vision === true && (
                      <span className="v-badge" title={STR.modelPicker.visionTip}>
                        <Eye size={10} aria-hidden="true" />
                        <span>{STR.modelPicker.visionBadge}</span>
                      </span>
                    )}
                    {m.registryId === props.value && <span className="check">✓</span>}
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && (
              <div className="pop-label mp-empty" role="status">
                {query.trim() === "" ? STR.modelPicker.noModels : STR.modelPicker.noMatch.replace("{q}", query.trim())}
              </div>
            )}
          </div>
        </>
      )}
      {pane === "effort" && (
        <div className="mp-effort" ref={effortRef} tabIndex={-1} role="listbox" aria-label={STR.modelPicker.effortAria} data-unsupported={supported ? undefined : "true"}>
          {/* 运行中注记只在真有可调的东西时出现（未声明支持的模型不谎称「思考程度可调」）。 */}
          {modelsDisabled && supported && <div className="menu-note">{STR.modelPicker.runningNote}</div>}
          {supported ? (
            <>
              {levels.map((lv) => (
                <button
                  key={lv.id}
                  type="button"
                  role="option"
                  data-e={lv.id}
                  title={lv.hint}
                  aria-selected={level === lv.id}
                  className="menu-item"
                  onClick={() => { props.onThinkingChange?.(lv.id); props.onClose?.(); }}
                >
                  <span className="mi-name">{lv.short}</span>
                  {level === lv.id && <span className="check">✓</span>}
                </button>
              ))}
              {declared !== undefined && declared.length > 1 && (
                <div className="mp-foot">
                  <button type="button" className="menu-item th-custom" aria-expanded={editingEfforts}
                    onClick={() => { setEditingEfforts(!editingEfforts); }}>
                    <SlidersHorizontal size={12} aria-hidden="true" />
                    <span>{editingEfforts ? STR.modelPicker.effortDone : STR.modelPicker.effortCustom}</span>
                  </button>
                </div>
              )}
              {editingEfforts && (
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
            </>
          ) : (
            <>
              {/* 只有一句明说（ADR-0009：fail-visible，不谎称可调）；「这家没提供思考能力」收进折叠里，
                  不再在它旁边摆第三句话——展开后 whyBody 把机制讲全。 */}
              <div className="mp-empty" role="status">{STR.modelPicker.unsupportedNote}</div>
              <details className="th-why">
                <summary className="th-info">
                  <Info size={12} className="th-info-ico" aria-hidden="true" />
                  <span className="th-info-link">{STR.modelPicker.whyLink}</span>
                </summary>
                <div className="th-why-body">
                  <p>{STR.modelPicker.whySummary}</p>
                  <p>{STR.modelPicker.whyBody}</p>
                </div>
              </details>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}
