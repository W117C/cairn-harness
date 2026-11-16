// 定时轮换判卷：到点判定、跳过读不到的、当前不在候选里取第一条、候选不足不轮换。
import { describe, expect, it } from "vitest";
import { decideRotation, rotationDue } from "../src/wallpaper/rotation";

const base = { enabled: true, everyMinutes: 60, lastAt: 1_000_000, now: 1_000_000 + 3_600_000, current: "/a.png" };

describe("壁纸定时轮换", () => {
  it("到点：≥ 间隔算到点；lastAt=0 算从未轮换（到点）", () => {
    expect(rotationDue({ lastAt: 0, now: 5, everyMinutes: 60 })).toBe(true);
    expect(rotationDue({ lastAt: 1_000_000, now: 1_000_000 + 3_599_999, everyMinutes: 60 })).toBe(false);
    expect(rotationDue({ lastAt: 1_000_000, now: 1_000_000 + 3_600_000, everyMinutes: 60 })).toBe(true);
  });

  it("按候选顺序换下一张，末尾绕回", () => {
    const paths = ["/a.png", "/b.png", "/c.mp4"];
    expect(decideRotation({ ...base, paths, exists: () => true }).path).toBe("/b.png");
    expect(decideRotation({ ...base, current: "/c.mp4", paths, exists: () => true }).path).toBe("/a.png");
  });

  it("当前不在候选里 ⇒ 取第一条并说明原因", () => {
    const d = decideRotation({ ...base, current: "/zzz.png", paths: ["/a.png", "/b.png"], exists: () => true });
    expect(d).toMatchObject({ rotate: true, path: "/a.png", reason: "当前壁纸不在候选里，取第一条" });
  });

  it("读不到的候选跳过并点名；只剩一张 ⇒ 不轮换（有理由）", () => {
    const nothing = (p: string) => p !== "/b.png";
    const skipped = decideRotation({ ...base, paths: ["/a.png", "/b.png", "/c.png"], exists: nothing });
    expect(skipped).toMatchObject({ rotate: true, path: "/c.png", missing: ["/b.png"] });
    const onlyOne = decideRotation({ ...base, paths: ["/a.png", "/b.png"], exists: (p) => p === "/a.png" });
    expect(onlyOne).toMatchObject({ rotate: false, path: null, reason: "候选少于两张，轮换没有意义", missing: ["/b.png"] });
  });

  it("没开 / 没到点 ⇒ 不换，理由能读", () => {
    expect(decideRotation({ ...base, enabled: false, paths: ["/a.png", "/b.png"] }))
      .toMatchObject({ rotate: false, reason: "轮换没开" });
    expect(decideRotation({ ...base, now: base.lastAt + 1000, paths: ["/a.png", "/b.png"] }))
      .toMatchObject({ rotate: false, reason: "还没到点" });
  });
});
