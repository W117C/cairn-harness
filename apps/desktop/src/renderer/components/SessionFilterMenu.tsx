// 侧栏会话筛选菜单（2026-11-01：从 Sidebar 抽出，Sidebar 触到 1200 行帽）。
//
// 为什么不用 Radix DropdownMenu：本仓装的 2.2 版 popper 在侧栏里退成 position:static，
// 菜单会落到 x=87 的左缘并盖住项目名（真机截图）。这里用仓库自己的 Popover 基座：
// 浮层锚在触发器外层 `.side-filter-wrap`（position:relative），右下贴按钮；
// 外点/Esc 关闭仍走 usePopoverDismiss，键盘与读屏语义用 menuitemradio/checkbox。
import { useRef, useState } from "react";
import { Check, Filter } from "lucide-react";
import { STR } from "../strings";
import { SESSION_FILTERS, SESSION_FILTER_NOTE, type SessionFilterId } from "../sessions-view";
import { Popover, useMenuKeyboard, usePopoverDismiss } from "./Popover";
import "./sidebar-filter.css";

export function SessionFilterMenu(props: {
  filter: SessionFilterId;
  filterCounts: readonly { id: SessionFilterId; label: string; count: number }[];
  density: "comfortable" | "compact";
  onChangeFilter: (next: SessionFilterId) => void;
  onChangeDensity: (next: "comfortable" | "compact") => void;
}): React.JSX.Element {
  const info = SESSION_FILTERS.find((f) => f.id === props.filter) ?? SESSION_FILTERS[0];
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const close = (): void => { setOpen(false); };
  usePopoverDismiss(open, close, boxRef, buttonRef);
  // 2026-11-02 审查补漏：换成自绘菜单后丢掉了方向键导航（Radix 原本提供）。
  // role=menu + menuitemradio 的键盘契约必须自己补上，否则键盘用户进得去、选不了。
  const onMenuKeys = useMenuKeyboard(open, setOpen, boxRef);
  return (
    <div className="side-filter-wrap" ref={boxRef}>
      <button
        ref={buttonRef}
        type="button"
        className="iconbtn side-filter-btn"
        data-active={props.filter !== "all"}
        aria-label={`${STR.filter.title}：${info.label}`}
        title={`${STR.filter.title}：${info.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={onMenuKeys}
        onClick={() => { setOpen((value) => !value); }}
      >
        <Filter size={14} />
      </button>
      <Popover
        open={open}
        className="side-filter-menu"
        role="menu"
        aria-label={STR.filter.title}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
            buttonRef.current?.focus();
            return;
          }
          onMenuKeys(event);
        }}
      >
        {props.filterCounts.map((f) => (
          <button
            key={f.id}
            type="button"
            role="menuitemradio"
            aria-checked={props.filter === f.id}
            aria-label={`${f.label}（${String(f.count)}）`}
            data-filter={f.id}
            className="menu-item"
            title={f.id === "running" ? SESSION_FILTER_NOTE : undefined}
            onClick={() => { props.onChangeFilter(f.id); close(); }}
          >
            <span className="side-filter-label">{f.label}</span>
            <span className="sub num">{f.count}</span>
            <span className="side-filter-check" aria-hidden="true">{props.filter === f.id ? <Check size={13} /> : null}</span>
          </button>
        ))}
        <div className="menu-sep" role="separator" />
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={props.density === "compact"}
          aria-label={STR.filter.compact}
          className="menu-item"
          onClick={() => {
            props.onChangeDensity(props.density === "compact" ? "comfortable" : "compact");
            close();
          }}
        >
          <span className="side-filter-label">{STR.filter.compact}</span>
          <span className="side-filter-check" aria-hidden="true">{props.density === "compact" ? <Check size={13} /> : null}</span>
        </button>
      </Popover>
    </div>
  );
}
