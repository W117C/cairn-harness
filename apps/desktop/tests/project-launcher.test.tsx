import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "../../../src/main/ipc-protocol";
import { ProjectLauncher } from "../src/renderer/components/ProjectLauncher";

const project = (id: string, name: string, path: string): ProjectRecord => ({
  id,
  name,
  path,
  defaultLocation: path,
  createdAt: "2026-11-24T00:00:00.000Z",
  updatedAt: "2026-11-24T00:00:00.000Z",
});

const projects = [
  project("p1", "Cairn", "/workspace/cairn"),
  project("p2", "deepseek harness", "/workspace/deepseek-harness"),
  project("p3", "设计稿", "/workspace/design"),
  project("p4", "第四个项目", "/workspace/fourth"),
];

const noop = (): void => undefined;

type LauncherOverrides = Partial<Parameters<typeof ProjectLauncher>[0]> & {
  pickerOpen?: boolean;
  pickerDialogId?: string;
  onPickerTrigger?: (trigger: HTMLButtonElement) => void;
};

const elements = (node: ReactNode): ReactElement[] => {
  if (!isValidElement(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
};

const render = (overrides: LauncherOverrides = {}): string =>
  renderToStaticMarkup(
    <ProjectLauncher
      projects={projects}
      activeWorkspace="/workspace/cairn"
      branch="bot、UI、chat"
      autoMode={false}
      onPickProject={noop}
      onAddProject={noop}
      onToggleAuto={noop}
      onOpenProjectPicker={noop}
      {...overrides}
    />,
  );

describe("ProjectLauncher：官方首屏项目卡组", () => {
  it("项目与动作使用 Card/CardLink 契约，项目最多三行", () => {
    const html = render();
    expect((html.match(/data-cds="Card"/g) ?? []).length).toBe(3);
    expect((html.match(/class="launch-row project-row"/g) ?? []).length).toBe(3);
    expect((html.match(/data-cds="CardLink"/g) ?? []).length).toBe(6);
    expect(html).toContain("Cairn");
    expect(html).toContain("deepseek harness");
    expect(html).toContain("设计稿");
    expect(html).not.toContain("第四个项目");
  });

  it("当前项目有 aria-current，环境行显示本地工作区与真实分支", () => {
    const html = render();
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("本地工作区");
    expect(html).toContain("bot、UI、chat");
    expect(html).toContain("environment-row");
  });

  it("自动模式动作暴露可切换状态", () => {
    expect(render()).toContain('aria-pressed="false"');
    expect(render()).toContain("开启自动模式");
    const enabled = render({ autoMode: true });
    expect(enabled).toContain('aria-pressed="true"');
    expect(enabled).toContain("自动模式已开启");
  });

  it("没有项目时给出真实选择入口，不渲染空项目行", () => {
    const html = render({ projects: [], activeWorkspace: null, branch: null });
    expect(html).toContain("选择项目");
    expect(html).toContain("选择环境");
    expect(html).not.toContain("project-row");
  });

  it("每个项目选择触发都声明 dialog 关系与真实展开状态", () => {
    const closed = render();
    expect((closed.match(/aria-haspopup="dialog"/g) ?? []).length).toBe(1);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('aria-controls="project-picker"');

    const open = render({ pickerOpen: true, pickerDialogId: "workspace-picker" });
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-controls="workspace-picker"');

    const empty = render({ projects: [], activeWorkspace: null, branch: null });
    expect((empty.match(/aria-haspopup="dialog"/g) ?? []).length).toBe(2);
  });

  it("空态选择项目打开弹层时记住实际触发按钮，供关闭后回焦", () => {
    const onPickerTrigger = vi.fn();
    const trigger = {} as HTMLButtonElement;
    const tree = ProjectLauncher({
      projects: [],
      activeWorkspace: null,
      branch: null,
      autoMode: false,
      onPickProject: noop,
      onAddProject: noop,
      onToggleAuto: noop,
      onOpenProjectPicker: noop,
      onPickerTrigger,
    });
    const button = elements(tree).find((el) => el.props.className === "launch-row project-picker-row");
    if (button === undefined) throw new Error("缺少空态项目选择入口");
    (button.props.onClick as (event: { currentTarget: HTMLButtonElement }) => void)({ currentTarget: trigger });
    expect(onPickerTrigger).toHaveBeenCalledWith(trigger);
  });

  it("项目、添加与自动模式动作调用真实回调，不是静态摆设", () => {
    const onPickProject = vi.fn();
    const onAddProject = vi.fn();
    const onToggleAuto = vi.fn();
    const onOpenProjectPicker = vi.fn();
    const tree = ProjectLauncher({
      projects,
      activeWorkspace: "/workspace/cairn",
      branch: "bot、UI、chat",
      autoMode: false,
      onPickProject,
      onAddProject,
      onToggleAuto,
      onOpenProjectPicker,
    });
    const buttons = elements(tree).filter((el) => el.type === "button");
    const byClass = (name: string): ReactElement => {
      const found = buttons.find((el) => String(el.props.className).includes(name));
      if (found === undefined) throw new Error(`缺少 ${name}`);
      return found;
    };
    (byClass("project-row").props.onClick as () => void)();
    (byClass("environment-row").props.onClick as () => void)();
    (byClass("action-row").props.onClick as () => void)();
    const auto = buttons.find((el) => el.props["aria-pressed"] !== undefined);
    if (auto === undefined) throw new Error("缺少自动模式动作");
    (auto.props.onClick as () => void)();
    expect(onPickProject).toHaveBeenCalledWith(projects[0]);
    expect(onOpenProjectPicker).toHaveBeenCalledTimes(1);
    expect(onAddProject).toHaveBeenCalledTimes(1);
    expect(onToggleAuto).toHaveBeenCalledTimes(1);
  });
});
