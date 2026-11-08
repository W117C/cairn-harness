import { Folder, Plus, Search, Terminal } from "lucide-react";

/** 收起侧栏后仍可继续工作；动作复用展开态的同一入口。
 *
 *  2026-10-31 去重（业主截图：两列图标栏 + 底部同款「设置」出现两次）：
 *  本分栏只保留 **Chat 上下文动作**。两枚重复入口已下架——
 *   - 「展开侧栏」在标题栏（TitleBar 的 PanelLeft，⌘B），本栏再放一枚就是同屏两个同形按钮；
 *   - 「打开设置」在全局能力轨底部（AppRail），本栏再放一枚会在窗口左下角出现两个一模一样的滑杆图标。
 *  同一条语义只留一个可见入口：本栏不再接收 onExpand / onSettings。 */
export function SidebarRail(props: {
  onNewTask: () => void;
  onSearch: () => void;
  onFiles: () => void;
  onTerminal: () => void;
}) {
  return <div className="sidebar-rail" role="group" aria-label="侧栏快捷入口">
    <button className="iconbtn" aria-label="新建任务" title="新建任务（⌘N）" onClick={props.onNewTask}><Plus size={18} /></button>
    <button className="iconbtn" aria-label="搜索会话与命令" title="搜索会话与命令（⌘K）" onClick={props.onSearch}><Search size={17} /></button>
    <div className="rail-divider" />
    <button className="iconbtn" aria-label="打开文件窗格" title="工作区文件" onClick={props.onFiles}><Folder size={17} /></button>
    <button className="iconbtn" aria-label="打开终端窗格" title="终端" onClick={props.onTerminal}><Terminal size={17} /></button>
  </div>;
}
