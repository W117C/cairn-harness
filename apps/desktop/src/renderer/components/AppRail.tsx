import { Brain, Clock3, MessageSquare, Puzzle, Settings2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { AppDestination } from "../app-controls";
import { APP_DESTINATIONS, APP_DESTINATION_LABEL } from "../navigation";

export interface AppRailProps {
  destination: AppDestination;
  onOpen: (destination: AppDestination) => void;
  onSettings: () => void;
  badges?: Partial<Record<AppDestination, number>>;
  /** Chat 上下文动作（收起侧栏时的快捷入口）。
   *  2026-10-31 去重：此前它是**第二条 48px 图标栏**，与全局轨并排 ⇒ 同屏两列图标、
   *  底部两枚同款「设置」。现在并进本轨，用一条分隔线与全局目的地分开——全窗口只有一条左轨。 */
  actions?: ReactNode;
}

const ICON: Record<AppDestination, LucideIcon> = {
  chat: MessageSquare,
  plugins: Puzzle,
  memory: Brain,
  automation: Clock3,
};

export function AppRail(props: AppRailProps): React.JSX.Element {
  const activeItem = useRef<HTMLButtonElement | null>(null);
  const previousDestination = useRef(props.destination);
  useEffect(() => {
    if (previousDestination.current === props.destination) return;
    previousDestination.current = props.destination;
    activeItem.current?.focus({ preventScroll: true });
  }, [props.destination]);

  return (
    <nav className="app-rail" aria-label="全局功能">
      <div className="app-rail-main">
        {APP_DESTINATIONS.map((destination) => {
          const Icon = ICON[destination];
          const label = APP_DESTINATION_LABEL[destination];
          const badge = props.badges?.[destination];
          const hasBadge = badge !== undefined && Number.isInteger(badge) && badge > 0;
          return (
            <button
              key={destination}
              type="button"
              className="app-rail-item"
              ref={props.destination === destination ? activeItem : undefined}
              data-destination={destination}
              aria-label={hasBadge ? `${label}，${String(badge)} 项` : label}
              aria-current={props.destination === destination ? "page" : undefined}
              title={label}
              onClick={() => { props.onOpen(destination); }}
            >
              <Icon size={17} aria-hidden="true" />
              {hasBadge && <span className="app-rail-badge" aria-hidden="true">{badge > 99 ? "99+" : String(badge)}</span>}
            </button>
          );
        })}
        {props.actions !== undefined && (
          <div className="rail-context">
            <div className="app-rail-divider" aria-hidden="true" />
            {props.actions}
          </div>
        )}
      </div>
      <button
        type="button"
        className="app-rail-item app-rail-settings"
        aria-label="设置"
        title="设置"
        onClick={props.onSettings}
      >
        <Settings2 size={17} aria-hidden="true" />
      </button>
    </nav>
  );
}
