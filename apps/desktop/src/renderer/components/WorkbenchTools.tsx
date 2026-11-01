import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, FileDiff } from "lucide-react";
import { PANE_META, PANE_OPENABLE, type PaneKind } from "../pane-registry";
import { paneShortcutKeys } from "../pane-shortcuts";

export interface WorkbenchToolsProps {
  hasSession: boolean;
  paneTabs: readonly PaneKind[];
  fileCount: number;
  inspectorOpen: boolean;
  pluginSidebarOpen: boolean;
  focusMode: boolean;
  onOpenPane: (kind: PaneKind) => void;
  onToggleInspector: () => void;
  onTogglePluginSidebar: () => void;
  onToggleFocusMode: () => void;
}

/** 工具只在需要时出现；改动是直接导航，已挂载的窗格也应切到前台。 */
export function WorkbenchTools(props: WorkbenchToolsProps) {
  return <>
    {props.hasSession && <button
      className="tb-btn tb-action"
      data-workbench-changes="true"
      aria-label={`查看本会话改动（${String(props.fileCount)} 个文件）`}
      title={`查看本会话改动（${paneShortcutKeys("changes")}）`}
      onClick={() => props.onOpenPane("changes")}
    >
      <FileDiff size={14} aria-hidden="true" />
      <span>改动</span>
      {props.fileCount > 0 && <span className="tb-action-count num" aria-hidden="true">{String(props.fileCount)}</span>}
    </button>}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="tb-btn tb-action" aria-label="工作台工具" title="工作台工具">
          <span>工具</span><ChevronDown size={12} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="pop-rd" data-workbench-menu="true" side="bottom" align="end" sideOffset={4}>
        {props.hasSession && <>
          {PANE_OPENABLE.filter(k => k !== "changes").map(kind => (
            <DropdownMenu.Item key={kind} className="menu-item" onSelect={() => props.onOpenPane(kind)}>
              <span>{props.paneTabs.includes(kind) ? "查看" : "打开"}{PANE_META[kind].label}窗格</span>
              <span className="sub">{paneShortcutKeys(kind)}</span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.CheckboxItem className="menu-item" checked={props.inspectorOpen} onCheckedChange={props.onToggleInspector}>
            <span>{props.inspectorOpen ? "收起右侧面板" : "显示右侧面板"}</span><span className="sub">⌘⌥I</span>
          </DropdownMenu.CheckboxItem>
        </>}
        <DropdownMenu.CheckboxItem className="menu-item" aria-label="插件侧栏" aria-controls="mod-sidebar" checked={props.pluginSidebarOpen} onCheckedChange={props.onTogglePluginSidebar}>
          <span>{props.pluginSidebarOpen ? "收起插件侧栏" : "打开插件侧栏"}</span><span className="sub">⌘⌥B</span>
        </DropdownMenu.CheckboxItem>
        <DropdownMenu.CheckboxItem className="menu-item" aria-label={props.focusMode ? "退出专注模式" : "进入专注模式"} checked={props.focusMode} onCheckedChange={props.onToggleFocusMode}>
          <span>{props.focusMode ? "退出专注模式" : "进入专注模式"}</span><span className="sub">⌘⌥F</span>
        </DropdownMenu.CheckboxItem>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </>;
}
