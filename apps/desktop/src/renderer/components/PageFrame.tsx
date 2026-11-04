import { RotateCw, Search } from "lucide-react";
import type { PageFilterItem } from "../navigation";

export interface PageFrameProps {
  title: string;
  /** 标题的暗色尾缀（2026-11-04 自动化页「自动化 工作流」双色调形制）；缺省不渲染。 */
  titleAccent?: string;
  /** 标题下的一句副标题（暗色说明行）；缺省不渲染。 */
  subtitle?: string;
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
        <h1 className="page-frame-title">
          {props.title}
          {props.titleAccent !== undefined && <span className="page-frame-title-accent"> {props.titleAccent}</span>}
        </h1>
        {props.subtitle !== undefined && <p className="page-frame-subtitle">{props.subtitle}</p>}
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
