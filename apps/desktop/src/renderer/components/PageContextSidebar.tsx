import type { AppDestination } from "../app-controls";
import {
  APP_DESTINATION_LABEL,
  type PageFilterItem,
} from "../navigation";

export interface PageContextSidebarProps {
  destination: AppDestination;
  items: readonly PageFilterItem[];
  activeFilter: string;
  onFilter: (id: string) => void;
}

const EMPTY: Record<AppDestination, string> = {
  chat: "暂无对话",
  plugins: "暂无可筛选插件",
  memory: "暂无记忆层",
  automation: "暂无任务状态",
};

export function PageContextSidebar(props: PageContextSidebarProps): React.JSX.Element {
  const label = APP_DESTINATION_LABEL[props.destination];

  return (
    <nav className="page-context-sidebar" aria-label={`${label}上下文`}>
      {props.items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="page-context-item"
          aria-pressed={props.activeFilter === item.id}
          onClick={() => { props.onFilter(item.id); }}
        >
          {item.label}
        </button>
      ))}
      {props.items.length === 0 && (
        <p className="page-context-empty">{EMPTY[props.destination]}</p>
      )}
    </nav>
  );
}
