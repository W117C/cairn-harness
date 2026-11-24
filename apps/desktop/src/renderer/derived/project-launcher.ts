import type { ProjectRecord } from "../../../../../src/main/ipc-protocol";

export function launcherProjects(
  projects: readonly ProjectRecord[],
  recent: readonly ProjectRecord[] | null,
  activeWorkspace: string | null,
): ProjectRecord[] {
  const source = (recent !== null && recent.length > 0 ? recent : projects)
    .map((project) => projects.find((registered) => registered.path === project.path) ?? project);
  const visible = source.slice(0, 3);
  if (activeWorkspace === null || visible.some((project) => project.path === activeWorkspace)) return [...visible];
  const active = source.find((project) => project.path === activeWorkspace)
    ?? projects.find((project) => project.path === activeWorkspace);
  return active === undefined ? [...visible] : [active, ...visible.slice(0, 2)];
}
