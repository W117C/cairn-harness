import { RotateCw, Search } from "lucide-react";
import type { PageFilterItem } from "../navigation";

export interface PageFrameProps {
  title: string;
  search?: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  };
  onRefresh?: () => void;
  filters?: readonly PageFilterItem[];
  activeFilter?: string;
  onFilter?: (id: string) => void;
  inlineFilter?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function PageFrame(props: PageFrameProps): React.JSX.Element {
  const filters = props.filters ?? [];
  const selectedFilter = props.activeFilter ?? filters[0]?.id ?? "";

  return (
    <section className="page-frame">
      <header className="page-frame-head">
        <h1 className="page-frame-title">{props.title}</h1>
        <div className="page-frame-actions">
          {props.actions}
          {props.search !== undefined && (
            <label className="page-frame-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={props.search.value}
                placeholder={props.search.label}
                aria-label={props.search.label}
                onChange={(event) => { props.search?.onChange(event.target.value); }}
              />
            </label>
          )}
          {filters.length > 0 && props.onFilter !== undefined && (
            <select
              className={"page-frame-filter" + (props.inlineFilter === true ? " page-frame-filter-inline" : "")}
              aria-label="筛选"
              value={selectedFilter}
              onChange={(event) => { props.onFilter?.(event.target.value); }}
            >
              {filters.map((filter) => (
                <option key={filter.id} value={filter.id}>{filter.label}</option>
              ))}
            </select>
          )}
          {props.onRefresh !== undefined && (
            <button
              type="button"
              className="iconbtn"
              aria-label="刷新"
              title="刷新"
              onClick={props.onRefresh}
            >
              <RotateCw size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      <div className="page-frame-content">{props.children}</div>
    </section>
  );
}
