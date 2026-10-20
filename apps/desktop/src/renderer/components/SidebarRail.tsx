import { Folder, PanelLeft, Plus, Search, Settings2, Terminal } from "lucide-react";

/** 收起侧栏后仍可继续工作；动作复用展开态的同一入口。 */
export function SidebarRail(props: {
  onExpand: () => void;
  onNewTask: () => void;
  onSearch: () => void;
  onFiles: () => void;
  onTerminal: () => void;
  onSettings: () => void;
}) {
  return <nav className="sidebar-rail" aria-label="侧栏快捷入口">
    <button className="iconbtn" aria-label="展开侧栏" title="展开侧栏（⌘B）" onClick={props.onExpand}><PanelLeft size={17} /></button>
    <button className="iconbtn" aria-label="新建任务" title="新建任务（⌘N）" onClick={props.onNewTask}><Plus size={18} /></button>
    <button className="iconbtn" aria-label="搜索会话与命令" title="搜索会话与命令（⌘K）" onClick={props.onSearch}><Search size={17} /></button>
    <div className="rail-divider" />
    <button className="iconbtn" aria-label="打开文件窗格" title="工作区文件" onClick={props.onFiles}><Folder size={17} /></button>
    <button className="iconbtn" aria-label="打开终端窗格" title="终端" onClick={props.onTerminal}><Terminal size={17} /></button>
    <button className="iconbtn rail-settings" aria-label="打开设置" title="设置与偏好" onClick={props.onSettings}><Settings2 size={17} /></button>
  </nav>;
}
