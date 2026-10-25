import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
import type { ClarifyQuestion,PlanProposal } from "../../../../../src/events";
import type { StickyScroll } from "../useStickyScroll";
// useAppCommands: extracted without changing event or callback behavior.
import { useEffect,useRef } from "react";
import type { AskPayload,ProjectRecord } from "../../../../../src/main/ipc-protocol";
import type { MenuCommandId } from "../../shared/menu-commands";
import type { PaletteAction,SectionId } from "../app-controls";
import { type FindBarHandle } from "../app-controls";
import { commandAllowed,isEditableTarget,overlayBlocked,readGateInput } from "../command-gate";
import { type PaneKind } from "../pane-registry";
import { paneShortcutFor } from "../pane-shortcuts";
import { classifyDrop } from "../sessions-view";
import { STR } from "../strings";
import { toast } from "../toast";

interface AppCommandsDeps {
  togglePane: (kind: PaneKind) => void;
  closeLastPane: () => boolean;
  newSession: () => void;
  cycleSession: (dir: 1 | -1) => boolean;
  cycleView: () => void;
  openComposerMenu: (kind: "model" | "perm" | "effort") => void;
  toggleSidebar: () => void;
  togglePluginSidebar: () => void;
  closePluginSidebar: () => void;
  pluginSidebarOpen: boolean;
  cancelRunHeal: (sid: string) => void;
  runningActive: boolean;
  activeId: string | null;
  cheatOpen: boolean;
  toggleCheat: () => void;
  closeCheat: () => void;
  ctrlTabCycle: boolean;
  composerMenuBlock: "暂不可切换：正在载入排队消息…" | "暂不可切换：正在创建会话…" | "暂不可切换：先处理上方的决定卡…" | null;
  askForActive: AskPayload | null;
  pendingClarify: { callId: string; questions: ClarifyQuestion[]; } | null;
  pendingPlan: { callId: string; plan: PlanProposal; } | null;
  requestPickElement: () => void;
  outlineOpen: boolean;
  setOutlineOpen: Dispatch<SetStateAction<boolean>>;
  stick: StickyScroll;
  toggleInspector: () => void;
  toggleFocusMode: () => void;
  handleOpenPalette: () => void;
  pickAndAddProject: () => Promise<void>;
  setSettingsSection: Dispatch<SetStateAction<SectionId | undefined>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  paletteOpen: boolean;
  findOpen: boolean;
  setFindOpen: Dispatch<SetStateAction<boolean>>;
  closeFind: () => void;
  startBarRename: () => boolean;
  findStep: (dir: 1 | -1) => boolean;
  closeSessionToHome: () => void;
  cycleSessionOrToast: (dir: 1 | -1) => void;
  handlePaletteAction: (action: PaletteAction) => void;
  openFindBar: () => void;
  findRef: MutableRefObject<FindBarHandle | null>;
  setDragOverApp: Dispatch<SetStateAction<boolean>>;
  projectsRef: MutableRefObject<ProjectRecord[]>;
  handleAddProject: (path: string) => Promise<void>;
}

export function useAppCommands(deps: AppCommandsDeps) {
  const { togglePane, closeLastPane, newSession, cycleSession, cycleView, openComposerMenu, toggleSidebar, togglePluginSidebar, closePluginSidebar, pluginSidebarOpen, cancelRunHeal, runningActive, activeId, cheatOpen, toggleCheat, closeCheat, ctrlTabCycle, composerMenuBlock, askForActive, pendingClarify, pendingPlan, requestPickElement, outlineOpen, setOutlineOpen, stick, toggleInspector, toggleFocusMode, handleOpenPalette, pickAndAddProject, setSettingsSection, setSettingsOpen, paletteOpen, findOpen, setFindOpen, closeFind, startBarRename, findStep, closeSessionToHome, cycleSessionOrToast, handlePaletteAction, openFindBar, findRef, setDragOverApp, projectsRef, handleAddProject } = deps;
  const hotkeysRef = useRef({ togglePane, closeLastPane, newSession, cycleSession, cycleView, openComposerMenu, toggleSidebar, togglePluginSidebar, closePluginSidebar, pluginSidebarOpen, cancelRun: cancelRunHeal, running: runningActive, activeId, cheatOpen, toggleCheat, closeCheat, ctrlTabCycle, composerMenuBlock, gatePending: askForActive !== null || pendingClarify !== null || pendingPlan !== null, requestPickElement, outlineOpen, setOutlineOpen, jumpTop: () => stick.scrollToTop("smooth"), jumpBottom: () => stick.scrollToBottom("smooth"), toggleInspector, toggleFocusMode, openPalette: handleOpenPalette, openFolder: () => { void pickAndAddProject(); }, openSettings: () => { setSettingsSection(undefined); setSettingsOpen(true); }, paletteOpen, findOpen, openFind: () => { setFindOpen(true); }, closeFind, startRename: startBarRename, findStep, closeSessionToHome, cycleSessionOrToast });
  hotkeysRef.current = { togglePane, closeLastPane, newSession, cycleSession, cycleView, openComposerMenu, toggleSidebar, togglePluginSidebar, closePluginSidebar, pluginSidebarOpen, cancelRun: cancelRunHeal, running: runningActive, activeId, cheatOpen, toggleCheat, closeCheat, ctrlTabCycle, composerMenuBlock, gatePending: askForActive !== null || pendingClarify !== null || pendingPlan !== null, requestPickElement, outlineOpen, setOutlineOpen, jumpTop: () => stick.scrollToTop("smooth"), jumpBottom: () => stick.scrollToBottom("smooth"), toggleInspector, toggleFocusMode, openPalette: handleOpenPalette, openFolder: () => { void pickAndAddProject(); }, openSettings: () => { setSettingsSection(undefined); setSettingsOpen(true); }, paletteOpen, findOpen, openFind: () => { setFindOpen(true); }, closeFind, startRename: startBarRename, findStep, closeSessionToHome, cycleSessionOrToast };
  /** 原生菜单命令 → 既有动作（蓝本 §5.2 菜单树）。**唯一**一张菜单分发表：类型是
   *  `Record<MenuCommandId, () => void>` ⇒ 菜单里加一条而这里不接，typecheck 直接红。
   *  菜单项自己不实现行为，全部转发到既有能力——同一个动作两条入口（键盘/菜单）必须同源，
   *  否则迟早出现「⌘N 建会话、菜单新建建别的东西」这种两套口径。表放 ref：订阅挂一次，动作取最新帧。 */
  const menuCommandsRef = useRef<Record<MenuCommandId, () => void> | null>(null);
  menuCommandsRef.current = {
    "new-session": () => { newSession(); },
    "open-folder": () => { void pickAndAddProject(); },
    "close-session": closeSessionToHome,
    "export-transcript": () => { handlePaletteAction("export-transcript"); },
    "compact": () => { handlePaletteAction("compact"); },
    "find": openFindBar,
    "find-next": () => { findStep(1); },
    // 查找条没开时「查找上一个」也要有回执（与「查找…」同一口径：没会话就说没会话）
    "find-prev": () => { if (!findStep(-1)) toast.error("先打开一个会话再查找"); },
    "palette": handleOpenPalette,
    "toggle-sidebar": toggleSidebar,
    "toggle-inspector": toggleInspector,
    "toggle-theme": () => { handlePaletteAction("toggle-theme"); },
    "cycle-perm": () => { handlePaletteAction("cycle-perm"); },
    "copy-transcript": () => { handlePaletteAction("copy-transcript"); },
    "prev-session": () => { cycleSessionOrToast(-1); },
    "next-session": () => { cycleSessionOrToast(1); },
    "jump-top": () => { stick.scrollToTop("smooth"); },
    "jump-bottom": () => { stick.scrollToBottom("smooth"); },
    "settings": () => { setSettingsSection(undefined); setSettingsOpen(true); },
    "cheat-sheet": () => { toggleCheat(); },
    "about": () => { setSettingsSection("about"); setSettingsOpen(true); },
  };
  useEffect(() => {
    // 原生菜单（main 进程）→ 这里分发。id 与 main/menu-template.ts 同表；未知 id 静默丢弃
    // （版本错配时的旧 main 不该把渲染层带崩）。
    return window.agent.onMenu((id) => {
      const fn = menuCommandsRef.current?.[id as MenuCommandId];
      if (fn === undefined) return;
      // ⚠️ 与 keydown 路径**同一道门**（2026-10-20 独立评审追出的 HIGH）：
      // macOS 上 `registerAccelerator:false` 是**空操作**（Electron 的 typings 标着
      // `@platform linux,win32`）⇒ 那些键被系统注册给了菜单 ⇒ macOS 把键交给菜单、
      // 渲染层的 keydown 根本不响 ⇒ 菜单转发过来的命令**绕过了 keydown 那道浮层门**。
      // 实测形状：确认卡（「删除会话确认」）开着时按 ⌘W ⇒ 会话被关掉回到主页，而那张卡还开着。
      // 判据（浮层在不在 / 移动光标的命令要不要让给输入框）都在 command-gate.ts 一处。
      if (!commandAllowed(id as string, readGateInput(hotkeysRef.current.paletteOpen))) return;
      fn();
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const h = hotkeysRef.current;
      // 浮层在不在 ⇒ 快捷键一律不动作（与菜单路径**同一道门**，见 command-gate.ts）。
      if (overlayBlocked(readGateInput(h.paletteOpen))) return;
      if (e.key === "Escape") {
        // 站点授权弹层自己吃 Esc（2026-10-18）：全局这里让路，否则按 Esc 想关弹层会顺带停掉本轮。
        if (document.querySelector('.bp-permit[role="alertdialog"]') !== null) return;
        if (h.pluginSidebarOpen) { e.preventDefault(); h.closePluginSidebar(); return; }
        // Esc 智慧停止（§7.3 禁令的正面写法）：浮层优先——开着菜单/弹层/速查表/目录时 Esc 只关它，不动运行。
        // capture 阶段检查：此刻菜单还开着，能可靠判定；等冒泡时 Radix 已把它关了。
        if (h.cheatOpen) { e.preventDefault(); h.closeCheat(); return; }
        if (h.outlineOpen) { e.preventDefault(); h.setOutlineOpen(false); return; }
        if (h.findOpen) { e.preventDefault(); h.closeFind(); return; }
        // 审批/澄清/计划卡在场 ⇒ Esc 什么都不做（2026-10-20 真机实测的坑）：卡面写着
        // 「Esc 不做决议」，旧实现却会让全局 Esc 顺带取消整轮——用户想关掉卡，任务没了。
        // 停止仍有明确出口：卡上的停止键 / ⌘. / 状态条；Esc 不承担这个语义。
        if (h.gatePending) return;
        // 侧栏是常驻 `role=listbox`（收起时 display:none 也照样命中），不能把它当「浮层开着」。
        // 只让真正会出现的浮层短路：侧栏排除后，Esc 才能按速查表承诺停掉本轮。
        if (document.querySelector(".pop.show, .pop-rd, [role='menu'][data-state='open'], [role='listbox']:not(.sidenav)") !== null) return;
        if (h.running && h.activeId !== null) { e.preventDefault(); h.cancelRun(h.activeId); }
        return;
      }
      // F2 重命名当前会话（2026-10-18）：裸键，不要求修饰；输入框聚焦时让给文本编辑。
      // 主页没有会话可改名 ⇒ 给一句回执（2026-10-18：此前 preventDefault 后什么都没发生）。
      if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (!isEditableTarget(e.target)) {
          e.preventDefault();
          if (!h.startRename()) toast(STR.shortcut.renameNeedsSession);
        }
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      // §3.6 Ctrl+Tab / Ctrl+Shift+Tab = 下一个 / 上一个会话（全平台 Ctrl；§7.3.3「可关闭」：
      // 设置页 ctrlTabCycle 关掉即整键让路——不 preventDefault、不切换，浏览器/系统行为透传）。
      if (e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!h.ctrlTabCycle) return;
        e.preventDefault();
        h.cycleSessionOrToast(e.shiftKey ? -1 : 1);
        return;
      }
      // 窗格族走 pane-shortcuts.ts 单一表：键位、修饰键、落点同源（速查表也从同一张表生成）；
      // 多按了修饰键不匹配，交给下面的普通键处理（不误吞）。
      const paneKind = paneShortcutFor(e.code, { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
      if (paneKind !== null) {
        e.preventDefault();
        h.togglePane(paneKind);
        return;
      }
      const shift = e.shiftKey;
      switch (e.code) {
        case "ArrowUp": // ⌘↑ 回顶（v7.2 长对话导航）；输入框聚焦时让给文本编辑（不劫持）
          if (!shift && !e.altKey && !isEditableTarget(e.target)) { e.preventDefault(); h.jumpTop(); }
          break;
        case "ArrowDown": // ⌘↓ 回底（v7.2，同「回到底部」浮钮）；输入框里让给文本编辑
          if (!shift && !e.altKey && !isEditableTarget(e.target)) { e.preventDefault(); h.jumpBottom(); }
          break;
        case "Backslash": // ⌘\ 关最近打开的窗格（§3.4）
          // 2026-10-18 修两处：① 旧实现 `tabs.slice(0,-1)` 取数组尾项，而数组顺序会被
          //    拖拽/⌥↑⌥↓ 重排——重排后关掉的就不是「最近打开」的那个，文档承诺落空；
          //    改从 paneOpenOrder（只增不减的打开顺序）里找最后一位仍在场的。
          //    ② 空窗格时 slice(0,-1) 仍是空数组，键却被 preventDefault 吃掉 ⇒ 按了没反应。
          //    现在没有可关的窗格就不 preventDefault，让键继续往外走（不吞）。
          if (!shift) {
            if (h.closeLastPane()) e.preventDefault();
          }
          break;
        case "KeyB": // ⌘B 侧栏；⌘⌥B 插件侧栏（⌘⇧B 浏览器窗格已由 pane-shortcuts 表接走）
          if (e.altKey) { e.preventDefault(); h.togglePluginSidebar(); }
          else { e.preventDefault(); h.toggleSidebar(); }
          break;
        case "KeyF": // ⌘F 对话内查找（⌘⇧F 文件窗格已由 pane-shortcuts 表接走）；⌘⌥F 专注模式
          if (e.altKey && !shift) { e.preventDefault(); h.toggleFocusMode(); }
          else if (!shift && !e.altKey && h.activeId !== null) { e.preventDefault(); h.openFind(); findRef.current?.focus(); }
          break;
        case "BracketRight": // ⌘⇧] 下一个会话（§3.6）
          if (shift) { e.preventDefault(); h.cycleSessionOrToast(1); }
          break;
        case "BracketLeft": // ⌘⇧[ 上一个会话（§3.6）
          if (shift) { e.preventDefault(); h.cycleSessionOrToast(-1); }
          break;
        case "KeyN": // ⌘N 新会话（§3.6）
          if (!shift) { e.preventDefault(); h.newSession(); }
          break;
        case "KeyO": // Ctrl+O 循环视图三档（§3.6，全平台 Ctrl）；⌘O 打开文件夹（P3-3）
          if (e.ctrlKey) { e.preventDefault(); h.cycleView(); }
          else if (!shift && !e.altKey) { e.preventDefault(); h.openFolder(); }
          break;
        case "KeyG": // ⌘G / ⇧⌘G 查找下一个 / 上一个（Claude Edit > Find Next/Previous 的标准键）
          // 落点/开合口径在 findStep 一处（菜单「查找下一个」共用同一出口）。
          if (e.altKey) break;
          if (h.findStep(shift ? -1 : 1)) e.preventDefault();
          break;
        case "KeyK": // ⌘K 命令面板（P3-3 · brief 八）
          if (!shift && !e.altKey) { e.preventDefault(); h.openPalette(); }
          break;
        case "Period": // ⌘. 停止本轮（P3-3 全局；输入框聚焦时由 Composer 自己处理，不双发；无运行安全 no-op）
          if (!shift && !e.altKey && !isEditableTarget(e.target) && h.running && h.activeId !== null) {
            e.preventDefault();
            h.cancelRun(h.activeId);
          }
          break;
        case "Comma": // ⌘, 设置（P3-3 · brief 九）
          if (!shift && !e.altKey) { e.preventDefault(); h.openSettings(); }
          break;
        // ⌘⇧I / ⌘⇧M / ⌘⇧E：输入区被锁时给一句「为什么」，不再 preventDefault 后静默（2026-10-18）。
        // ⌘⇧E 走 effort 焦点：同一个模型菜单，但打开后落到思考档分段（不再与 ⌘⇧I 完全同路）。
        case "KeyI": // ⌘⌥I 检查器；⌘⇧I 模型菜单（§3.6）
          if (e.altKey && !shift) {
            e.preventDefault();
            h.toggleInspector();
          } else if (shift) {
            e.preventDefault();
            if (h.composerMenuBlock !== null) toast(h.composerMenuBlock);
            else h.openComposerMenu("model");
          }
          break;
        case "KeyM": // ⌘⇧M 权限模式菜单（§3.6）；⌘⌥M 仍是插件侧栏的兼容别名
          if (e.altKey && !shift) {
            e.preventDefault();
            h.togglePluginSidebar();
          } else if (shift) {
            e.preventDefault();
            if (h.composerMenuBlock !== null) toast(h.composerMenuBlock);
            else h.openComposerMenu("perm");
          }
          break;
        case "KeyE": // ⌘⇧E effort 菜单（单芯片裁定：思考档就在模型菜单里）
          if (shift) {
            e.preventDefault();
            if (h.composerMenuBlock !== null) toast(h.composerMenuBlock);
            else h.openComposerMenu("effort");
          }
          break;
        case "KeyS": // ⌘⇧S 浏览器元素选择（§3.6；页内焦点时由主进程 before-input-event 捕获，同效）
          if (shift) { e.preventDefault(); h.requestPickElement(); }
          break;
        case "KeyW": // ⌘W 关会话回主页（蓝本 §3.6；窗口关闭走红绿灯——菜单已相应定制）
          // 回执口径在 closeSessionToHome 一处（菜单「关闭会话」共用同一出口）。
          if (!shift) {
            e.preventDefault();
            h.closeSessionToHome();
          }
          break;
        case "Slash": // ⌘/ 快捷键速查（蓝本 §3.6「查看全部」）
          if (!shift) { e.preventDefault(); h.toggleCheat(); }
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); };
  }, []);
  // 全局拖放（brief 第四节 + §3.1 防导航）：拖文件进窗口亮「添加为项目」提示；落下时——
  //   已被内层认领（Composer 卡片附件，先于 window 冒泡跑过，defaultPrevented 留痕）⇒ 不重复处理；
  //   目录 ⇒ 登记为项目（DataTransfer.files 不带 isDirectory，用 webkitGetAsEntry 分流）；
  //   其余一律 preventDefault——否则 Electron 会把整窗导航成 file://。
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault();
      if (hasFiles(e)) {
        setDragOverApp(true);
        if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDragLeave = (e: DragEvent): void => {
      // 只有真离开窗口才熄提示（窗口内子元素之间移动会反复触发 leave，relatedTarget 非空）。
      if (e.relatedTarget === null) setDragOverApp(false);
    };
    const onDrop = (e: DragEvent): void => {
      const claimed = e.defaultPrevented; // 先读后写：preventDefault 自身也会置位这个旗。
      e.preventDefault();
      setDragOverApp(false);
      if (claimed) return;
      const api = window.agent as unknown as { pathForFile?: (f: File) => string };
      const dropped: { path: string; isDirectory: boolean }[] = [];
      for (const it of Array.from(e.dataTransfer?.items ?? [])) {
        if (it.kind !== "file") continue;
        const entry = it.webkitGetAsEntry?.();
        const f = it.getAsFile();
        const p = f !== null ? api.pathForFile?.(f) : undefined;
        if (p !== undefined && p !== "") dropped.push({ path: p, isDirectory: entry?.isDirectory === true });
      }
      // 分流判据走纯函数（判卷资产）：这里只取 projects 支——目录拖入即添加；
      // inProject / outside（文件）留给 Composer 落点（P2 附件升级时接）。
      const { projects: dirPaths } = classifyDrop(dropped, projectsRef.current.map((p) => p.path));
      if (dirPaths.length === 0) return;
      void (async () => {
        for (const p of dirPaths) {
          await handleAddProject(p).catch((err: unknown) => {
            toast.error(`添加项目失败：${err instanceof Error ? err.message : String(err)}`);
          });
        }
      })();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleAddProject]);

  return {  };
}
