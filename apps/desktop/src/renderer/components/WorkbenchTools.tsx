import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, FileDiff } from "lucide-react";
import { PANE_META, type PaneKind } from "../pane-registry";
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

/** 工具只在需要时出现；改动是直接导航，已挂载的窗格也应切到前台。
 *
 *  2026-11-04 业主两件事：
 *  ① 显示缺陷（截图：菜单被裁成一条灰边）——内容此前内联渲染在工具栏里，被 overflow:hidden
 *     的祖先裁掉（DOM 里 220×351/9 项俱全、画面上没有）。修法 = 包 `DropdownMenu.Portal`
 *     （PaneDock 的菜单包了所以没事）。
 *  ② 「做的太复杂了，容纳的东西太多了」——菜单从 9 项砍到两段：窗格只留文件/终端/浏览器
 *     （改动走顶栏「改动」钮），方案/任务/旁路窗格走右栏「＋」菜单与既有快捷键（⌘⇧P 等
 *     判卷在 pane-shortcuts），这里不再复述一遍。 */
const TOOL_PANES: readonly PaneKind[] = ["file", "terminal", "browser"];

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
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="pop-rd" data-workbench-menu="true" side="bottom" align="end" sideOffset={4}>
          {TOOL_PANES.map(kind => (
            <DropdownMenu.Item key={kind} className="menu-item" onSelect={() => props.onOpenPane(kind)}>
              <span>{props.paneTabs.includes(kind) ? "查看" : "打开"}{PANE_META[kind].label}窗格</span>
              <span className="sub">{paneShortcutKeys(kind)}</span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="menu-sep" />
          {props.hasSession && (
            <DropdownMenu.CheckboxItem className="menu-item" checked={props.inspectorOpen} onCheckedChange={props.onToggleInspector}>
              <span>{props.inspectorOpen ? "收起右侧面板" : "显示右侧面板"}</span><span className="sub">⌘⌥I</span>
            </DropdownMenu.CheckboxItem>
          )}
          <DropdownMenu.CheckboxItem className="menu-item" aria-label="插件侧栏" aria-controls="mod-sidebar" checked={props.pluginSidebarOpen} onCheckedChange={props.onTogglePluginSidebar}>
            <span>{props.pluginSidebarOpen ? "收起已加载插件" : "已加载插件"}</span><span className="sub">⌘⌥B</span>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem className="menu-item" aria-label={props.focusMode ? "退出专注模式" : "进入专注模式"} checked={props.focusMode} onCheckedChange={props.onToggleFocusMode}>
            <span>{props.focusMode ? "退出专注模式" : "进入专注模式"}</span><span className="sub">⌘⌥F</span>
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </>;
}
