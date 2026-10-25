import type { Dispatch,MutableRefObject,SetStateAction } from 'react';
// useProjectActions: extracted without changing event or callback behavior.
import { useCallback } from "react";
import type { ProjectDiagnosis,ProjectRecord } from "../../../../../src/main/ipc-protocol";
import { STR } from "../strings";
import { toast } from "../toast";

interface ProjectActionsDeps {
  setProjects: Dispatch<SetStateAction<ProjectRecord[]>>;
  setRegistryNotice: Dispatch<SetStateAction<string | null>>;
  setImportDiagnosis: Dispatch<SetStateAction<{ name: string; diagnosis: ProjectDiagnosis; } | null>>;
  setLastError: (message: string, sessionId?: string | undefined) => void;
  refreshSessions: () => Promise<void>;
  setActiveWorkspace: Dispatch<SetStateAction<string | null>>;
  activeWorkspaceRef: MutableRefObject<string | null>;
  setProjectRemoveConfirm: Dispatch<SetStateAction<ProjectRecord | null>>;
  newSessionRef: MutableRefObject<(() => void) | null>;
}

/** 新建项目的两条通道：`blank` 只建目录+登记（createProject），其余走模板（projectCreateFromTemplate）。
 *  单源给渲染层与判卷看，别在两处各写一个 templateId === "blank"。 */
export function createProjectKind(templateId: string): "blank" | "template" {
  return templateId === "blank" ? "blank" : "template";
}

export function useProjectActions(deps: ProjectActionsDeps) {
  const { setProjects, setRegistryNotice, setImportDiagnosis, setLastError, refreshSessions, setActiveWorkspace, activeWorkspaceRef, setProjectRemoveConfirm, newSessionRef } = deps;
  const refreshProjects = useCallback(async (): Promise<void> => {
    const registered = await window.agent.listProjects();
    setProjects(registered);
    setRegistryNotice(null);
  }, []);

  /** v12 导入诊断：只读判定，失败如实报错（诊断是提示面，取不到就说取不到，不摆假绿）。 */
  const diagnoseImported = useCallback(async (name: string, path: string): Promise<void> => {
    try {
      const diagnosis = await window.agent.projectDiagnose(path);
      setImportDiagnosis({ name, diagnosis });
    } catch (err) {
      setLastError(STR.errors.diagnoseFailed.replace("{message}", err instanceof Error ? err.message : String(err)));
    }
  }, [setLastError]);

  /** 打开文件夹 / 拖入 / 最近打开共用：登记 → 刷新 → Toast（名字取注册表返回值，不猜路径尾段）。 */
  const handleAddProject = useCallback(async (path: string): Promise<void> => {
    const record = await window.agent.addProject({ path });
    await refreshProjects();
    refreshSessions();
    toast.success(STR.toast.projectAdded.replace("{name}", record.name));
    void diagnoseImported(record.name, record.path);
  }, [refreshProjects, refreshSessions, diagnoseImported]);

  /** 克隆：先克隆后登记；成功切过去 + Toast；失败 throw（表单内 fail-visible 显示 git 原话）。 */
  const handleCloneProject = useCallback(async (url: string, parentDir: string): Promise<void> => {
    const cloned = await window.agent.gitClone({ url, parentDir });
    if (!cloned.ok) throw new Error(cloned.error);
    const record = await window.agent.addProject({ path: cloned.path });
    await refreshProjects();
    refreshSessions();
    setActiveWorkspace(record.path);
    activeWorkspaceRef.current = record.path;
    toast.success(STR.toast.projectCloned.replace("{name}", record.name));
    void diagnoseImported(record.name, record.path);
  }, [refreshProjects, refreshSessions, diagnoseImported]);

  /** 显示名 / 默认运行位置：同路径 upsert（addProject 既有语义，零新通道）。 */
  const handleUpdateProject = useCallback(async (p: ProjectRecord, patch: { name?: string; defaultLocation?: string }): Promise<void> => {
    try {
      await window.agent.addProject({
        path: p.path,
        name: patch.name ?? p.name,
        defaultLocation: patch.defaultLocation ?? p.defaultLocation,
      });
      await refreshProjects();
      refreshSessions();
    } catch (err) {
      // 内联改名是 fire-and-forget：失败必须上屏，不能变成未处理的 rejection。
      setLastError(`项目更新失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshProjects, refreshSessions, setLastError]);

  /** 移除项目（必问闸 + 明说不删文件；确认文案走 STR——「不删除文件」四个字必须在）。
   *  2026-10-17：确认由原生 window.confirm 换成产品自绘卡；真正执行拆到 doRemoveProject。 */
  const doRemoveProject = useCallback(async (p: ProjectRecord): Promise<void> => {
    await window.agent.removeProject(p.id);
    await refreshProjects();
    refreshSessions();
  }, [refreshProjects, refreshSessions]);
  const handleRemoveProject = useCallback(async (p: ProjectRecord): Promise<void> => {
    setProjectRemoveConfirm(p);
  }, []);

  const handleRevealProject = useCallback((p: ProjectRecord): void => {
    void window.agent.revealInFinder(p.path).then((r) => {
      if (!r.ok) toast.error(r.error ?? "无法在 Finder 中显示");
    }, (err: unknown) => { toast.error(err instanceof Error ? err.message : String(err)); });
  }, []);

  /** 新建项目 Dialog 提交：建项 → 刷新 → 切过去 → Toast → 聚焦输入框（brief 第四节）。 */
  const handleCreateFromDialog = useCallback(async (input: { name: string; templateId: string; parentDir?: string }): Promise<void> => {
    // 「空白项目」走 createProject（只建目录 + 登记，不套模板）；其余仍走模板建项。
    // 这条通道此前在渲染层零调用点（第 642 页审计的 P1），空白项目卡是它的可见入口。
    const r = createProjectKind(input.templateId) === "blank"
      ? await window.agent.createProject({ name: input.name, ...(input.parentDir !== undefined ? { parentDir: input.parentDir } : {}) })
      : await window.agent.projectCreateFromTemplate(input);
    if (!r.ok) throw new Error(r.message);
    await refreshProjects();
    refreshSessions();
    setActiveWorkspace(r.path);
    activeWorkspaceRef.current = r.path;
    toast.success(STR.toast.projectCreated.replace("{name}", r.name));
    // 聚焦输入框（brief 第四节）：回新会话空态 + 焦点落回任务输入。
    newSessionRef.current?.();
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="任务输入"]')?.focus();
    });
  }, [refreshProjects, refreshSessions]);


  return { handleAddProject, handleCloneProject, handleUpdateProject, doRemoveProject, handleRemoveProject, handleRevealProject, handleCreateFromDialog };
}
