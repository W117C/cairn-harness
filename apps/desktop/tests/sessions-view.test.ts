// P1 主界面重做：会话侧栏视图纯函数判卷（时间桶 / 状态合成 / 段结构 / 拖拽分流）。
// groupByWorkspace 的判据在 sidebar-groups.test.ts（迁移后 import 改到本模块，判据一字未动）。
import { describe, expect, it } from "vitest";
import {
  classifyDrop,
  groupByTime,
  projectSections,
  sessionStatus,
  sessionTime,
  timeBucket,
  type WorkspaceSession,
} from "../src/renderer/sessions-view";

const at = (iso: string): number => Date.parse(iso);
const now = at("2026-10-16T12:00:00");
const sess = (id: string, iso: string, extra: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id,
  workspace: "/repo/a",
  mtimeMs: at(iso),
  lines: 1,
  updatedAt: iso,
  ...extra,
});

describe("timeBucket（今天/昨天/过去7天/更早）", () => {
  it("日历日边界：当天=今天；前一天=昨天；7 天内=过去7天；更早=更早", () => {
    expect(timeBucket(at("2026-10-16T00:00:00"), now)).toBe("today");
    expect(timeBucket(at("2026-10-16T11:59:00"), now)).toBe("today");
    expect(timeBucket(at("2026-10-15T23:59:00"), now)).toBe("yesterday");
    expect(timeBucket(at("2026-10-09T00:00:00"), now)).toBe("past7"); // 恰第 7 天整日仍算过去 7 天
    expect(timeBucket(at("2026-10-10T10:00:00"), now)).toBe("past7");
    expect(timeBucket(at("2026-10-08T23:59:00"), now)).toBe("earlier");
  });

  it("sessionTime：文件 mtime 是活动锚；metadata.updatedAt（置顶/改名会写）不参与", () => {
    expect(sessionTime(sess("a", "2026-10-16T09:00:00"))).toBe(at("2026-10-16T09:00:00"));
    expect(sessionTime({ id: "b", workspace: "", mtimeMs: 12345, lines: 1 })).toBe(12345);
    // 置顶/改名把 updatedAt 刷成“现在”，但文件没动 ⇒ 仍按文件时间显示（不再跳「刚刚」）
    expect(
      sessionTime({
        id: "c",
        workspace: "",
        mtimeMs: 777,
        lines: 1,
        updatedAt: "2026-10-16T11:59:00",
      }),
    ).toBe(777);
  });

  it("groupByTime：空桶不列；桶序固定；桶内保持输入序", () => {
    const groups = groupByTime(
      [sess("a", "2026-10-16T09:00:00"), sess("c", "2026-10-10T09:00:00"), sess("b", "2026-10-15T09:00:00")],
      now,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["today", "yesterday", "past7"]);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(["a"]);
    expect(groups[1]!.sessions.map((s) => s.id)).toEqual(["b"]);
  });
});

describe("sessionStatus（诚实状态合成）", () => {
  it("优先级：running > waiting > failed > done > none", () => {
    expect(sessionStatus({ running: true, waiting: true, lastOutcome: "failed" })).toBe("running");
    expect(sessionStatus({ running: false, waiting: true, lastOutcome: "ok" })).toBe("waiting");
    expect(sessionStatus({ running: false, waiting: false, lastOutcome: "failed" })).toBe("failed");
    expect(sessionStatus({ running: false, waiting: false, lastOutcome: "ok" })).toBe("done");
    expect(sessionStatus({ running: false, waiting: false, lastOutcome: undefined })).toBe("none");
  });
});

describe("projectSections（置顶段恒前 + 其余时间桶）", () => {
  it("置顶不与时间桶混排；非置顶进时间桶；全置顶时无时间桶", () => {
    const secs = projectSections(
      [sess("p1", "2026-09-01T00:00:00", { pinned: true }), sess("n1", "2026-10-16T01:00:00")],
      now,
    );
    expect(secs[0]).toMatchObject({ kind: "pinned" });
    if (secs[0]!.kind === "pinned") expect(secs[0]!.sessions.map((s) => s.id)).toEqual(["p1"]);
    expect(secs[1]).toMatchObject({ kind: "time", bucket: "today" });

    const allPinned = projectSections([sess("p", "2026-10-16T01:00:00", { pinned: true })], now);
    expect(allPinned).toHaveLength(1);
    expect(allPinned[0]!.kind).toBe("pinned");
  });
});

describe("classifyDrop（拖拽分流）", () => {
  it("目录恒进 projects；文件按项目内外分流；前缀判定防吞（/repo/a 不吞 /repo/ab）", () => {
    const r = classifyDrop(
      [
        { path: "/Users/ze/new-proj", isDirectory: true },
        { path: "/repo/a/src/x.ts", isDirectory: false },
        { path: "/repo/ab/y.ts", isDirectory: false },
        { path: "/elsewhere/z.ts", isDirectory: false },
      ],
      ["/repo/a"],
    );
    expect(r.projects).toEqual(["/Users/ze/new-proj"]);
    expect(r.inProject).toEqual(["/repo/a/src/x.ts"]);
    expect(r.outside).toEqual(["/repo/ab/y.ts", "/elsewhere/z.ts"]);
  });

  it("项目根上的文件（恰为注册路径的直接子）算项目内；空输入 = 全空", () => {
    const r = classifyDrop([{ path: "/repo/a", isDirectory: false }], ["/repo/a"]);
    expect(r.inProject).toEqual(["/repo/a"]);
    expect(classifyDrop([], [])).toEqual({ projects: [], inProject: [], outside: [] });
  });
});
