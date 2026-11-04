// 应用页编排宿主（插件 / 自动化任务 / 技能中心 / 记忆系统 / 工作树）。
// 各子面板按职责独立成件（PluginsPane / AutomationPane / SkillsPane / MemoryPane / WorktreesPane）；
// 本模块只负责快照拉取（getState / scheduleSnapshot）、局部错误隔离与分区派发，并保持原公开导出契约。
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { defaultPageFilter } from "../navigation";
import {
  appPageSnapshotReducer,
  createAppPageSnapshotState,
} from "../state/app-page-snapshot";
import { AutomationPane, buildSchedule, scheduleLabel, scheduleToForm } from "./AutomationPane";
import { ErrorStrip } from "./ErrorStrip";
import { MemoryPane } from "./MemoryPane";
import { PageFrame } from "./PageFrame";
import { PluginsPane } from "./PluginsPane";
import { PluginsDestination } from "./plugins/PluginsWorkspace";
import { PAGE_META, PAGE_ORDER, type PageId, type SectionId } from "./settings-nav";
import { EmptyState } from "./settings-ui";
import { SkillsPane } from "./SkillsPane";
import { WorktreesPane } from "./WorktreesPane";

export {
  AutomationPane,
  MemoryPane,
  PAGE_META,
  PAGE_ORDER,
  PluginsPane,
  SkillsPane,
  buildSchedule,
  scheduleLabel,
  scheduleToForm,
  type PageId,
};

const PAGE_FRAME_TITLE: Record<PageId, string> = {
  plugins: "插件",
  automation: "自动化任务",
  skills: "技能中心",
  memory: "记忆",
  worktrees: "工作树",
};

/** 页体：按 page 自取一份 getState() 快照并渲染对应面板（宿主只管分区切换，不管数据）。 */
export function AppPageBody(props: {
  page: PageId;
  filter?: string;
  onFilter?: (filter: string) => void;
  workspace?: string | null;
  mutationBlocked?: boolean;
  onPluginUpdateCount?: (count: number) => void;
  /** 打开设置并落到某个分区（记忆页的「记忆设置…」用它；不给 = 不显示该入口）。 */
  onOpenSection?: (id: SectionId) => void;
}): React.JSX.Element {
  const [snapshotState, dispatch] = useReducer(
    appPageSnapshotReducer,
    props.page,
    createAppPageSnapshotState,
  );
  const [operationError, setOperationError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const [fallbackFilters, setFallbackFilters] = useState<Partial<Record<PageId, string>>>({});
  const activeFilter = props.filter ?? fallbackFilters[props.page] ?? defaultPageFilter(props.page);
  const setFallbackFilter = useCallback((filter: string): void => {
    setFallbackFilters((current) => ({ ...current, [props.page]: filter }));
  }, [props.page]);
  const setActiveFilter = props.onFilter ?? setFallbackFilter;
  // 目的地内的操作失败只落在本页的 error strip：不能同时写工作台的 lastError，
  // 否则切回对话会看到一条属于自动化/记忆页的错误（第 815 页 app-shell 冒烟发现）。
  const reportError = useCallback((message: string): void => {
    setOperationError(message);
  }, []);

  const refresh = useCallback(() => {
    const page = props.page;
    const generation = ++requestGeneration.current;
    dispatch({ type: "start", page, generation });
    const resolve = (snapshot: Parameters<typeof appPageSnapshotReducer>[0]["snapshot"]): void => {
      if (snapshot !== null) dispatch({ type: "resolve", page, generation, snapshot });
    };
    const reject = (message: string): void => {
      dispatch({ type: "reject", page, generation, message });
    };
    // 自动化页只需要 schedule：走专用的 scheduleSnapshot 通道，不再用整份 getState
    // （那条整份快照还要算插件/记忆/工作树；也为 invoke 消费面留下一处真实调用点）。
    if (page === "automation") {
      void window.agent.scheduleSnapshot().then((schedule) => resolve({ schedule })).catch((err: unknown) => {
        reject(`调度快照读取失败：${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }
    void window.agent.getState().then((snapshot) => resolve(snapshot)).catch((err: unknown) => {
      reject(`快照读取失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [props.page]);
  useEffect(() => {
    if (props.page === "plugins") return;
    refresh();
    return () => { requestGeneration.current += 1; };
  }, [props.page, refresh]);
  useEffect(() => { setOperationError(null); }, [props.page]);

  const snapshot = snapshotState.page === props.page ? snapshotState.snapshot : null;
  const loadError = snapshotState.page === props.page ? snapshotState.loadError : null;

  const stateFrame = (message: string, error = false): React.JSX.Element => (
    <PageFrame title={PAGE_FRAME_TITLE[props.page]} onRefresh={refresh}>
      <div className="ap-empty" role={error ? "alert" : "status"}>{message}</div>
    </PageFrame>
  );

  return (
    <div className="ap-body" aria-label={PAGE_META[props.page].label}>
      {operationError !== null && (
        <div className="ap-error-host">
          <ErrorStrip message={operationError} onDismiss={() => { setOperationError(null); }} />
        </div>
      )}
      {props.page === "plugins" ? (
        <PluginsDestination
          workspace={props.workspace ?? null}
          onError={reportError}
          filter={activeFilter}
          onFilter={setActiveFilter}
          mutationBlocked={props.mutationBlocked === true}
          {...(props.onOpenSection !== undefined ? { onOpenSkills: () => { props.onOpenSection?.("skills"); } } : {})}
          {...(props.onPluginUpdateCount !== undefined ? { onUpdateCount: props.onPluginUpdateCount } : {})}
        />
      ) : (
        <>
          {loadError !== null
            ? stateFrame(loadError, true)
            : snapshot === null && stateFrame("正在读取快照…")}
          {loadError === null && snapshot !== null && props.page === "automation" && (
            snapshot.schedule === undefined
              ? stateFrame("调度器未初始化")
              : <AutomationPane snap={snapshot.schedule} onError={reportError} refresh={refresh} filter={activeFilter} onFilter={setActiveFilter} />
          )}
          {loadError === null && snapshot !== null && props.page === "skills" && (
            snapshot.plugins === undefined
              ? stateFrame("插件运行时未加载")
              : <SkillsPane snap={snapshot.plugins} onError={reportError} refresh={refresh} filter={activeFilter} onFilter={setActiveFilter} />
          )}
          {loadError === null && snapshot !== null && props.page === "memory" && (
            snapshot.memory === undefined
              ? stateFrame("记忆层未初始化")
              : <MemoryPane
                snap={snapshot.memory}
                onError={reportError}
                refresh={refresh}
                filter={activeFilter}
                onFilter={setActiveFilter}
                {...(props.onOpenSection !== undefined ? { onOpenMemorySettings: () => { props.onOpenSection?.("advanced"); } } : {})}
              />
          )}
          {loadError === null && snapshot !== null && props.page === "worktrees" && (
            snapshot.worktree === undefined
              ? (
                <PageFrame title={PAGE_FRAME_TITLE.worktrees} onRefresh={refresh}>
                  {/* 2026-11-02：此前只有一行「工作区未解析（无可用工作区）」，既没说原因也没给出路。 */}
                  <EmptyState
                    title="还没有可分析的工作区"
                    desc="先在侧栏打开一个文件夹；工作树会列出它的隔离分支与需要清理的残留。"
                  />
                </PageFrame>
              )
              : <WorktreesPane snap={snapshot.worktree} onError={reportError} refresh={refresh} />
          )}
        </>
      )}
    </div>
  );
}
