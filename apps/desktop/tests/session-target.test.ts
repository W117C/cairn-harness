// 打开会话必须能按 id + workspace 定位。会话 id 是分钟级时间戳，跨项目可撞名；
// 只按 id find 会把 A 的会话当 B 打开，后续 run 也落进 A。
import { describe, expect, it } from "vitest";
import { findSessionByRef } from "../src/renderer/sessions-view";

const sessions = [
  { id: "same", workspace: "/a", title: "A" },
  { id: "same", workspace: "/b", title: "B" },
  { id: "only", workspace: "/b", title: "B-only" },
];

describe("按 id + workspace 定位会话", () => {
  it("同名 id 时按 workspace 选中正确的一条", () => {
    expect(findSessionByRef(sessions, "same", "/b")?.title).toBe("B");
    expect(findSessionByRef(sessions, "same", "/a")?.title).toBe("A");
  });

  it("未给 workspace ⇒ 保持旧行为（第一条）", () => {
    expect(findSessionByRef(sessions, "same")?.title).toBe("A");
  });

  it("id 与 workspace 不匹配 ⇒ undefined（不退回同名 id）", () => {
    expect(findSessionByRef(sessions, "same", "/gone")).toBeUndefined();
    expect(findSessionByRef(sessions, "missing", "/a")).toBeUndefined();
  });
});
