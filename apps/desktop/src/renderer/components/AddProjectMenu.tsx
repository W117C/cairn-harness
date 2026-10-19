// 「添加项目」四入口菜单（brief 第二节）：打开文件夹… / 新建项目… / 从 Git 仓库克隆… / 最近打开。
// 全程零路径手输（原则 1）：打开与克隆位置都走系统选择器；克隆表单只收 URL + 选位置 + 预览。
// 文案走 STR；菜单 = Radix DropdownMenu。
import { useEffect, useRef, useState, type FormEvent } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FolderOpen, FolderPlus, GitBranch, History, X } from "lucide-react";
import type { ProjectRecord } from "../../../../../src/main/ipc-protocol";
import { STR } from "../strings";
import { scheduleAfterOverlayDismissal } from "./overlay-focus";

/** 仓库名预览（与 main 侧 repoNameFromUrl 同判据的薄镜像，仅用于「将克隆到：」预览——
 *  真正落盘名以 main 为准；认不出就不显示预览尾巴，不编假名字）。 */
function repoNamePreview(url: string): string | null {
  const tail = url.replace(/\/+$/, "").split(/[/:]/).pop() ?? "";
  if (tail === "" || /\s/.test(tail)) return null;
  const name = tail.endsWith(".git") ? tail.slice(0, -4) : tail;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : null;
}

export function AddProjectMenu(props: {
  onPickDirectory: () => Promise<string | null>;
  onAddProject: (path: string) => Promise<void>;
  onOpenNewProjectDialog: () => void;
  onCloneProject: (url: string, parentDir: string) => Promise<void>;
  /** 已在场的项目路径（「最近打开」里对应条目禁用 + 标「已添加」）。 */
  activePaths: readonly string[];
}): React.JSX.Element {
  const [recent, setRecent] = useState<ProjectRecord[] | null>(null);
  const [recentNote, setRecentNote] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneParent, setCloneParent] = useState<string | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const cloneInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!cloneOpen) return;
    return scheduleAfterOverlayDismissal(() => { cloneInput.current?.focus(); });
  }, [cloneOpen]);

  const loadRecent = (): void => {
    setRecent(null);
    setRecentNote(null);
    void window.agent.listProjects({ includeRemoved: true, recentFirst: true }).then(
      (all) => { setRecent(all.slice(0, 8)); },
      (err: unknown) => { setRecentNote(err instanceof Error ? err.message : String(err)); },
    );
  };

  const pickFolder = (): void => {
    setFolderError(null);
    void props.onPickDirectory().then((picked) => {
      if (picked === null) return;
      void props.onAddProject(picked).catch((err: unknown) => {
        setFolderError(err instanceof Error ? err.message : String(err));
      });
    });
  };

  const submitClone = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const url = cloneUrl.trim();
    if (url === "") { setCloneError(STR.addProject.cloneUrlLabel); return; }
    if (cloneParent === null) { setCloneError(STR.addProject.cloneLocationUnset); return; }
    setCloneBusy(true);
    setCloneError(null);
    try {
      await props.onCloneProject(url, cloneParent);
      setCloneUrl("");
      setCloneParent(null);
      setCloneOpen(false);
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloneBusy(false);
    }
  };

  return (
    <div className="add-project">
      <DropdownMenu.Root
        onOpenChange={(open) => { if (open) loadRecent(); }}
      >
        <DropdownMenu.Trigger asChild>
          <button className="add-project-btn" title={STR.addProject.titleTip}>
            <FolderPlus size={13} />
            {STR.addProject.title}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content className="pop-rd" side="top" align="start" sideOffset={4}>
          <DropdownMenu.Item className="menu-item" title={STR.addProject.openFolderTip} onSelect={pickFolder}>
            <span className="mi-ico" aria-hidden="true"><FolderOpen size={12} /></span>
            {STR.addProject.openFolder}
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" title={STR.addProject.newProjectTip} onSelect={() => { props.onOpenNewProjectDialog(); }}>
            <span className="mi-ico" aria-hidden="true"><FolderPlus size={12} /></span>
            {STR.addProject.newProject}
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" title={STR.addProject.cloneTip} onSelect={() => { setCloneOpen(true); }}>
            <span className="mi-ico" aria-hidden="true"><GitBranch size={12} /></span>
            {STR.addProject.clone}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="menu-item" title={STR.addProject.recent}>
              <span className="mi-ico" aria-hidden="true"><History size={12} /></span>
              {STR.addProject.recent}
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent className="pop-rd">
              {recent === null && recentNote === null && <DropdownMenu.Item className="menu-item" disabled>{STR.common.creating}</DropdownMenu.Item>}
              {recentNote !== null && <DropdownMenu.Item className="menu-item" disabled>{recentNote}</DropdownMenu.Item>}
              {recent !== null && recent.length === 0 && (
                <DropdownMenu.Item className="menu-item" disabled>{STR.addProject.recentEmpty}</DropdownMenu.Item>
              )}
              {(recent ?? []).map((p) => {
                const already = props.activePaths.includes(p.path);
                return (
                  <DropdownMenu.Item
                    key={p.id}
                    className="menu-item"
                    disabled={already}
                    title={p.path}
                    onSelect={() => { void props.onAddProject(p.path).catch(() => undefined); }}
                  >
                    <span>{p.name}{already ? ` · ${STR.addProject.recentAdded}` : ""}</span>
                    <span className="sub">{p.path}</span>
                  </DropdownMenu.Item>
                );
              })}
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      {folderError !== null && <div className="form-error" role="alert">{folderError}</div>}

      {/* 克隆表单（菜单内联展开后落面板）：URL + 选择位置 + 预览；零路径手输。 */}
      {cloneOpen && (
        <form className="clone-form" onSubmit={(e) => void submitClone(e)}>
          <div className="clone-head">
            <span>{STR.addProject.clone}</span>
            <button type="button" className="iconbtn sm" aria-label={STR.addProject.cloneCancel} title={STR.addProject.cloneCancel} onClick={() => { setCloneOpen(false); setCloneError(null); }}>
              <X size={12} />
            </button>
          </div>
          <input
            ref={cloneInput}
            aria-label={STR.addProject.cloneUrlLabel}
            placeholder={STR.addProject.cloneUrlPlaceholder}
            value={cloneUrl}
            onChange={(e) => { setCloneUrl(e.target.value); }}
          />
          <div className="clone-row">
            <button
              type="button"
              className="mini-btn"
              title={STR.addProject.clonePickLocation}
              onClick={() => {
                void props.onPickDirectory().then((picked) => { if (picked !== null) setCloneParent(picked); });
              }}
            >
              {STR.addProject.clonePickLocation}
            </button>
            <span className="sp-dim">
              {cloneParent === null
                ? STR.addProject.cloneLocationUnset
                : STR.addProject.clonePreview.replace("{dir}", `${cloneParent}/${repoNamePreview(cloneUrl) ?? "…"}`)}
            </span>
          </div>
          {cloneError !== null && <div className="form-error" role="alert">{cloneError}</div>}
          <button className="mini-btn primary" type="submit" disabled={cloneBusy}>
            {cloneBusy ? STR.addProject.cloning : STR.addProject.cloneStart}
          </button>
        </form>
      )}
    </div>
  );
}
