// 第 1128 页：Sidebar 的 split/filter/group/byPath 按 sessions/搜索/筛选/running 签名记忆。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("Sidebar 会话派生记忆", () => {
  it("running 内容签名 + 四块 useMemo", () => {
    expect(src).toContain("const runningKey = [...props.running].sort().join(\"\\u0000\");");
    expect(src).toContain("const filterCounts = useMemo(() => {");
    expect(src).toContain("const counts = countSessionsByFilter(props.sessions, props.running);");
    expect(src).toContain("for (const g of groups) {");
    expect(src).toContain("positionOf.set(s, flatOrder.length);");
    expect(src).toContain("useMemo(() => splitArchived(props.sessions), [props.sessions])");
    expect(src).toContain("useMemo(() => filterSessions(activeSessions,");
    expect(src).toContain("useMemo(() => filterSessions(archivedSessions,");
    expect(src).toContain("useMemo(() => (searchOpen || filter !== \"all\")");
    expect(src).toContain("useMemo(() => new Map(props.projects.map((p) => [p.path, p])), [props.projects])");
    expect(src).toContain("const sectionsByGroup = useMemo(() => new Map(groups.map((g) => [g.workspace, sectionsFor(g.sessions)])), [groups, now, pinnedOrder.order]);");
  });
});
