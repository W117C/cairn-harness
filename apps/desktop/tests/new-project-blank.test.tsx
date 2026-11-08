// 空白项目入口（2026-10-23）：`createProject` 这条 invoke 通道此前渲染层零调用点
// （第 642 页审计的 P1）。本判卷钉两件事：新建项目弹窗里有「空白项目」卡；
// 选择它走 blank 通道，其余仍走模板通道。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NewProjectDialog } from "../src/renderer/components/NewProjectDialog";
import { createProjectKind } from "../src/renderer/state/projects";

describe("新建项目：空白项目入口", () => {
  it("弹窗渲染「空白项目」卡（不是只有模板）", () => {
    const html = renderToStaticMarkup(
      <NewProjectDialog
        templates={[{ id: "blank", name: "空白项目", description: "不套模板，只建一个普通文件夹并登记" }]}
        existingNames={[]}
        onClose={() => undefined}
        onPickDirectory={async () => null}
        onCreate={async () => undefined}
      />,
    );
    expect(html).toContain("空白项目");
    expect(html).toContain("普通文件夹");
  });

  it("通道选择：blank 走 createProject，其余走模板", () => {
    expect(createProjectKind("blank")).toBe("blank");
    expect(createProjectKind("react-vite")).toBe("template");
  });
});
