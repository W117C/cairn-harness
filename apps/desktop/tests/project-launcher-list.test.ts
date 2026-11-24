import { describe, expect, it } from "vitest";
import type { ProjectRecord } from "../../../src/main/ipc-protocol";
import { launcherProjects } from "../src/renderer/derived/project-launcher";

const project = (id: string): ProjectRecord => ({
  id,
  name: id,
  path: `/workspace/${id}`,
  defaultLocation: `/workspace/${id}`,
  createdAt: "2026-11-24T00:00:00.000Z",
  updatedAt: "2026-11-24T00:00:00.000Z",
});

const projects = ["p1", "p2", "p3", "p4", "p5"].map(project);

describe("首页项目卡组清单", () => {
  it("最近打开非空时按最近顺序取前三，不退回注册顺序", () => {
    const recent = [projects[3], projects[1], projects[4], projects[0]];
    expect(launcherProjects(projects, recent, null).map((p) => p.id)).toEqual(["p4", "p2", "p5"]);
  });

  it.each([null, []])("最近读取失败或空表时回落注册清单：%j", (recent) => {
    expect(launcherProjects(projects, recent, null).map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("最近行名称以注册表现值为准，改名后不保留旧标签", () => {
    const stale = [{ ...projects[1], name: "旧名字" }, projects[0]];
    expect(launcherProjects(projects, stale, null)[0]?.name).toBe("p2");
  });

  it("当前项目不在最近前三时补到首位，不静默换掉用户选择", () => {
    const recent = [projects[0], projects[1], projects[2]];
    expect(launcherProjects(projects, recent, "/workspace/p5").map((p) => p.id)).toEqual(["p5", "p1", "p2"]);
  });

  it("当前项目 older 于最近八条也仍可见，且不会重复", () => {
    const recent = projects.slice(0, 4);
    expect(launcherProjects(projects, recent, "/workspace/p5").map((p) => p.id)).toEqual(["p5", "p1", "p2"]);
    expect(launcherProjects(projects, recent, "/workspace/p2").map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("没有项目时保持空表，由启动区给出真实选择入口", () => {
    expect(launcherProjects([], [], null)).toEqual([]);
  });
});
