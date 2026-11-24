import { ArrowUpRight, Check, ChevronDown, Folder, FolderPlus, Monitor, Zap } from "lucide-react";
import type { ProjectRecord } from "../../../../../src/main/ipc-protocol";
import { STR } from "../strings";
import "./project-launcher.css";

export interface ProjectLauncherProps {
  projects: readonly ProjectRecord[];
  activeWorkspace: string | null;
  branch: string | null;
  autoMode: boolean;
  onPickProject: (project: ProjectRecord) => void;
  onAddProject: () => void;
  onToggleAuto: () => void;
  onOpenProjectPicker: () => void;
  onPickerTrigger?: (trigger: HTMLButtonElement) => void;
  pickerTriggerRef?: React.Ref<HTMLButtonElement>;
  pickerOpen?: boolean;
  pickerDialogId?: string;
}

function projectName(project: ProjectRecord): string {
  return project.name || project.path.slice(project.path.lastIndexOf("/") + 1);
}

export function ProjectLauncher(props: ProjectLauncherProps): React.JSX.Element {
  const visibleProjects = props.projects.slice(0, 3);
  const pickerAttributes = {
    "aria-haspopup": "dialog" as const,
    "aria-expanded": props.pickerOpen ?? false,
    "aria-controls": props.pickerDialogId ?? "project-picker",
  };
  return (
    <section className="project-launcher" aria-label={STR.empty.projectsLabel}>
      <div className="launch-card project-card" data-cds="Card">
        <div className="cds-card-fill" aria-hidden="true" />
        <div className="cds-card-body">
          {visibleProjects.map((project) => {
            const active = project.path === props.activeWorkspace;
            return (
              <button
                key={project.id}
                type="button"
                className="launch-row project-row"
                data-cds="CardLink"
                aria-current={active ? true : undefined}
                title={project.path}
                onClick={() => { props.onPickProject(project); }}
              >
                <Folder size={16} strokeWidth={1.7} aria-hidden="true" />
                <span className="launch-label">{projectName(project)}</span>
                {active ? <Check size={15} strokeWidth={1.8} className="launch-check" aria-hidden="true" /> : <span />}
              </button>
            );
          })}
          {visibleProjects.length === 0 && (
            <button
              type="button"
              className="launch-row project-picker-row"
              data-cds="CardLink"
              {...pickerAttributes}
              onClick={(event) => { props.onPickerTrigger?.(event.currentTarget); props.onOpenProjectPicker(); }}
            >
              <Folder size={16} strokeWidth={1.7} aria-hidden="true" />
              <span className="launch-label">{STR.empty.pickProject}</span>
              <ChevronDown size={14} strokeWidth={1.7} aria-hidden="true" />
            </button>
          )}
          <button
            ref={props.pickerTriggerRef}
            type="button"
            className={"launch-row environment-row" + (props.branch !== null && props.branch !== "" ? " has-branch" : "")}
            data-cds="CardLink"
            {...pickerAttributes}
            onClick={(event) => { props.onPickerTrigger?.(event.currentTarget); props.onOpenProjectPicker(); }}
          >
            <Monitor size={16} strokeWidth={1.7} aria-hidden="true" />
            <span className="launch-label">
              {props.activeWorkspace === null ? STR.empty.chooseEnvironment : STR.empty.localEnvironment}
            </span>
            {props.branch !== null && props.branch !== "" && <span className="launch-branch">{props.branch}</span>}
            <ChevronDown size={14} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="launch-actions">
        <div className="launch-card action-card" data-cds="Card">
          <div className="cds-card-fill" aria-hidden="true" />
          <div className="cds-card-body">
            <button type="button" className="launch-row action-row" data-cds="CardLink" onClick={props.onAddProject}>
              <FolderPlus size={16} strokeWidth={1.7} aria-hidden="true" />
              <span className="launch-label">{STR.empty.addProject}</span>
              <ArrowUpRight size={14} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="launch-card action-card" data-cds="Card">
          <div className="cds-card-fill" aria-hidden="true" />
          <div className="cds-card-body">
            <button
              type="button"
              className="launch-row action-row"
              data-cds="CardLink"
              aria-pressed={props.autoMode}
              onClick={props.onToggleAuto}
            >
              <Zap size={16} strokeWidth={1.7} aria-hidden="true" />
              <span className="launch-label">{props.autoMode ? STR.empty.autoEnabled : STR.empty.enableAuto}</span>
              <span className="launch-auto-dot" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
