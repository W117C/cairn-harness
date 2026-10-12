// 统一图标库（spec ④「图标与交互」→ 2026-10-07 二次修订：**原型 prototype.html 的图标逐字照抄**）。
// 为什么自研而不引 lucide：本仓纪律是渲染层零新增依赖（打包零新增依赖同源）；
// 而且此前组件里 emoji（👍👎⧉⟲）与手绘 SVG 混用、笔画粗细不一，正是"不像产品"的来源之一。
// 两个网格并存：原型侧图标是 14 viewBox（vb:14，路径与原型逐字同源——业主的视觉基准），
// 补充图标是 16 viewBox。纪律：只有这里画图标；组件一律 import { Ic.xxx }，不许再内联路径。
import type { CSSProperties } from "react";

const DEFS: Record<string, { vb: number; el: React.ReactNode }> = {
  // ── 原型逐字（14 网格；design/prototype.html 的 svg path 原样搬入） ──
  compose: { vb: 14, el: <><rect x="1.9" y="1.9" width="10.2" height="10.2" rx="3.2" /><path d="m9 3.9-4 4-.6 2.2 2.2-.6 4-4z" /></> },
  plugins: { vb: 14, el: <><path d="M7 1.9 8.3 3.2 7 4.5 5.7 3.2Z" /><path d="M12.1 7 10.8 8.3 9.5 7l1.3-1.3Z" /><path d="M7 12.1 5.7 10.8 7 9.5l1.3 1.3Z" /><path d="M1.9 7 3.2 5.7 4.5 7 3.2 8.3Z" /></> },
  clock: { vb: 14, el: <><circle cx="7" cy="7" r="5.2" /><path d="M7 4.2V7l2 1.2" /></> },
  book: { vb: 14, el: <><path d="M2.2 3.2c1.6-.8 3.2-.8 4.8 0v7.6c-1.6-.8-3.2-.8-4.8 0Z" /><path d="M11.8 3.2c-1.6-.8-3.2-.8-4.8 0v7.6c1.6-.8 3.2-.8 4.8 0Z" /></> },
  memory: { vb: 14, el: <><circle cx="4" cy="4.4" r="1.6" /><circle cx="10" cy="4.4" r="1.6" /><circle cx="7" cy="10.4" r="1.6" /><path d="M5.3 5.6 6.4 8.9M8.7 5.6 7.6 8.9M5.6 4.4h2.8" /></> },
  search: { vb: 14, el: <><circle cx="6.2" cy="6.2" r="4" /><path d="m9.4 9.4 2.8 2.8" /></> },
  filter: { vb: 14, el: <><path d="M2.2 4.4h3.4M9.1 4.4h2.7M2.2 7h5.8M10.4 7h1.4M2.2 9.6h2M6.9 9.6h4.9" /></> },
  folder: { vb: 14, el: <path d="M1.8 4.4c0-.83.67-1.5 1.5-1.5h1.9l1.4 1.5h4.1c.83 0 1.5.67 1.5 1.5v3.7c0 .83-.67 1.5-1.5 1.5H3.3c-.83 0-1.5-.67-1.5-1.5Z" /> },
  folderPlus: { vb: 14, el: <><rect x="2" y="2" width="10" height="10" rx="2.8" /><path d="M7 4.6v4.8M4.6 7h4.8" /></> },
  settings: { vb: 14, el: <><circle cx="7" cy="7" r="2.2" /><path d="M7 1.6v1.6M7 10.8v1.6M1.6 7h1.6M10.8 7h1.6M3.2 3.2l1.1 1.1M9.7 9.7l1.1 1.1M10.8 3.2l-1.1 1.1M4.3 9.7l-1.1 1.1" /></> },
  shield: { vb: 14, el: <path d="M7 1.8 12 3.6v3.2c0 2.8-2 4.7-5 5.4-3-.7-5-2.6-5-5.4V3.6Z" /> },
  shieldAlert: { vb: 14, el: <><path d="M7 1.8 12 3.6v3.2c0 2.8-2 4.7-5 5.4-3-.7-5-2.6-5-5.4V3.6Z" /><path d="M7 5.4v2.4" /><path d="M7 10v.01" /></> },
  // ── 补充图标（16 网格） ──
  plus: { vb: 16, el: <><path d="M8 3.2v9.6" /><path d="M3.2 8h9.6" /></> },
  sidebarLeft: { vb: 16, el: <><rect x="2" y="3" width="12" height="10" rx="1.8" /><path d="M6 3v10" /></> },
  panelRight: { vb: 16, el: <><rect x="2" y="3" width="12" height="10" rx="1.8" /><path d="M10 3v10" /></> },
  send: { vb: 16, el: <><path d="M8 13V3.2" /><path d="M3.8 7.4 8 3.2l4.2 4.2" /></> },
  stop: { vb: 16, el: <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.4" fill="currentColor" stroke="none" /> },
  spark: { vb: 16, el: <path d="M8 1.8 9.4 6.6 14.2 8 9.4 9.4 8 14.2 6.6 9.4 1.8 8 6.6 6.6Z" fill="currentColor" stroke="none" /> },
  copy: { vb: 16, el: <><rect x="5.7" y="5.7" width="7.1" height="7.1" rx="1.3" /><path d="M10.3 3.2H4.7c-.9 0-1.6.7-1.6 1.6v5.6" /></> },
  check: { vb: 16, el: <path d="m3.2 8.6 3.2 3.2 6.4-7.2" /> },
  thumbUp: { vb: 16, el: <><path d="M4.9 13.2V7.4" /><path d="M4.9 7.4 7.9 2.9c.3-.5.9-.6 1.3-.3.3.2.4.6.3.9l-.7 2.6h3.4c.8 0 1.4.8 1.2 1.5l-1 4.2c-.1.6-.7 1.1-1.4 1.1H4.9Z" /><path d="M4.9 7.4H2.6v5.8h2.3" /></> },
  thumbDown: { vb: 16, el: <><path d="M11.1 2.8v5.8" /><path d="M11.1 8.6l-3 4.5c-.3.5-.9.6-1.3.3-.3-.2-.4-.6-.3-.9l.7-2.6H3.8c-.8 0-1.4-.8-1.2-1.5l1-4.2c.1-.6.7-1.1 1.4-1.1h6.1Z" /><path d="M11.1 8.6h2.3V2.8h-2.3" /></> },
  revert: { vb: 16, el: <><path d="M3 3.4v3.4h3.4" /><path d="M3.2 6.8a5.2 5.2 0 1 0 1.4-3.4L3 5" /></> },
  alert: { vb: 16, el: <><path d="M8 2.4 14 12.8H2Z" /><path d="M8 6.4v2.8" /><path d="M8 11.2v.01" /></> },
  brain: { vb: 16, el: <><path d="M7.2 3.1c-1.6-.6-3.4.3-3.8 2-1 .4-1.6 1.4-1.4 2.5.1.7.5 1.3 1.1 1.7-.2 1.3.6 2.5 1.9 2.8.7.2 1.5 0 2.2-.4V3.1Z" /><path d="M8.8 3.1c1.6-.6 3.4.3 3.8 2 1 .4 1.6 1.4 1.4 2.5-.1.7-.5 1.3-1.1 1.7.2 1.3-.6 2.5-1.9 2.8-.7.2-1.5 0-2.2-.4V3.1Z" /></> },
  chevronDown: { vb: 16, el: <path d="m4.5 6.5 3.5 3.5 3.5-3.5" /> },
  chevronRight: { vb: 16, el: <path d="m6.5 4.5 3.5 3.5-3.5 3.5" /> },
  x: { vb: 16, el: <><path d="m4 4 8 8" /><path d="m12 4-8 8" /></> },
  pencil: { vb: 16, el: <path d="m10.4 2.9 2.7 2.7-7.7 7.7-3.4.7.7-3.4Z" /> },
  trash: { vb: 16, el: <><path d="M2.8 4.2h10.4" /><path d="M6 4.2V2.9h4v1.3" /><path d="m4 4.2.6 8.2c.1.7.6 1.3 1.4 1.3h4c.8 0 1.3-.6 1.4-1.3l.6-8.2" /><path d="M6.6 7v4" /><path d="M9.4 7v4" /></> },
  pause: { vb: 16, el: <><rect x="4.4" y="3" width="2.5" height="10" rx="1" fill="currentColor" stroke="none" /><rect x="9.1" y="3" width="2.5" height="10" rx="1" fill="currentColor" stroke="none" /></> },
  play: { vb: 16, el: <path d="M5 3.2v9.6L12.8 8Z" fill="currentColor" stroke="none" /> },
  target: { vb: 16, el: <><circle cx="8" cy="8" r="5.4" /><circle cx="8" cy="8" r="2.2" /><path d="M8 8h.01" /></> },
  plug: { vb: 16, el: <><path d="M5.4 2.4v3.4" /><path d="M10.6 2.4v3.4" /><path d="M4 5.8h8v2.4c0 1.9-1.5 3.4-3.4 3.4h-1.2C5.5 11.6 4 10.1 4 8.2Z" /><path d="M8 11.6v2" /></> },
  timer: { vb: 16, el: <><circle cx="8" cy="8.8" r="4.6" /><path d="M8 6.6V9l1.5 1" /><path d="M5.8 1.8h4.4" /><path d="M8 1.8V4" /></> },
  key: { vb: 16, el: <><circle cx="5.2" cy="10.8" r="2.4" /><path d="M6.9 9.1 13.2 2.8" /><path d="m10.9 5.1 1.9 1.9" /><path d="m9.2 6.8 1.7 1.7" /></> },
  eye: { vb: 16, el: <><path d="M1.8 8S4.2 3.8 8 3.8 14.2 8 14.2 8 11.8 12.2 8 12.2 1.8 8 1.8 8Z" /><circle cx="8" cy="8" r="1.8" /></> },
  globe: { vb: 16, el: <><circle cx="8" cy="8" r="5.4" /><path d="M2.6 8h10.8" /><path d="M8 2.6c-3.2 3.4-3.2 7.4 0 10.8" /><path d="M8 2.6c3.2 3.4 3.2 7.4 0 10.8" /></> },
  bolt: { vb: 16, el: <path d="M8.8 1.8 3.6 9.2h3.5l-.9 5 5.4-7.4H8.1Z" /> },
  arrowUp: { vb: 16, el: <><path d="M8 13V3" /><path d="M3.8 7.2 8 3l4.2 4.2" /></> },
  loader: { vb: 16, el: <path d="M13.2 8A5.2 5.2 0 1 1 8 2.8" /> },
  sliders: { vb: 16, el: <><path d="M2.4 5h4.2" /><path d="M10.8 5h2.8" /><circle cx="8.7" cy="5" r="1.7" /><path d="M2.4 11h1.8" /><path d="M8.4 11h5.2" /><circle cx="6.3" cy="11" r="1.7" /></> },
  history: { vb: 16, el: <><path d="M3 3.4v3.4h3.4" /><path d="M3.2 6.8a5.2 5.2 0 1 0 1.4-3.4L3 5" /><path d="M8 5.4V8l1.8 1.2" /></> },
  file: { vb: 16, el: <><path d="M4 2.6h5l3 3v7.8c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V3.6c0-.6.4-1 1-1Z" /><path d="M9 2.6v3h3" /></> },
  message: { vb: 16, el: <path d="M13.4 8.4c0 2.5-2.4 4.4-5.4 4.4-.6 0-1.2-.1-1.7-.2L3 13.6l.8-2.4C3 10.4 2.6 9.4 2.6 8.4c0-2.5 2.4-4.4 5.4-4.4s5.4 1.9 5.4 4.4Z" /> },
};

const PATHS: Record<string, React.ReactNode> = Object.fromEntries(
  Object.entries(DEFS).map(([name, def]) => [name, def.el]),
);

export type IconName = keyof typeof DEFS;

export function Icon(props: { name: IconName; size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }) {
  const def = DEFS[props.name];
  return (
    <svg
      viewBox={`0 0 ${String(def.vb)} ${String(def.vb)}`}
      width={props.size ?? 14}
      height={props.size ?? 14}
      fill="none"
      stroke="currentColor"
      strokeWidth={props.strokeWidth ?? 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      style={props.style}
      aria-hidden="true"
    >
      {def.el}
    </svg>
  );
}

/** 具名短导出（组件里 Ic.copy 比 Icon name="copy" 短）。
 *  模块加载时一次性建全表：不能每次取属性都造新组件——那样 React 每轮渲染都视为
 *  不同组件类型而整棵重挂（reconciliation 杀手）。 */
interface IconComponent {
  (p: { size?: number; strokeWidth?: number; className?: string }): React.JSX.Element;
  displayName?: string;
}

export const Ic = Object.fromEntries(
  (Object.keys(PATHS) as IconName[]).map((name) => {
    const C: IconComponent = (p = {}) => (
      <Icon name={name}
        {...(p.size !== undefined ? { size: p.size } : {})}
        {...(p.strokeWidth !== undefined ? { strokeWidth: p.strokeWidth } : {})}
        {...(p.className !== undefined ? { className: p.className } : {})} />
    );
    C.displayName = `Ic.${name}`;
    return [name, C] as const;
  }),
) as Record<IconName, IconComponent>;

/** provider → 品牌色相（确定性哈希；同一 provider 恒同色，跨重启稳定）。
 *  只取色相，饱和度/亮度由 CSS 收口（浅深主题各自适配）。 */
export function providerHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
