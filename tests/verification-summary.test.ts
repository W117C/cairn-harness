// 总判判卷：fail 压过 missing 压过 pass；没跑 ≠ 通过。
import { describe, expect, it } from "vitest";
import { summarise, verdictOfExit } from "../src/verification/summary";

describe("总判", () => {
  it("全 pass ⇒ pass", () => {
    expect(summarise([{ gate: "a", verdict: "pass" }, { gate: "b", verdict: "pass" }]).verdict).toBe("pass");
  });

  it("有 missing ⇒ incomplete，并点名", () => {
    const s = summarise([{ gate: "a", verdict: "pass" }, { gate: "smoke", verdict: "missing" }]);
    expect(s.verdict).toBe("incomplete");
    expect(s.missing).toEqual(["smoke"]);
  });

  it("有 fail ⇒ fail（比 missing 更狠）", () => {
    const s = summarise([{ gate: "a", verdict: "missing" }, { gate: "b", verdict: "fail" }]);
    expect(s.verdict).toBe("fail");
    expect(s.failed).toEqual(["b"]);
  });

  it("退出码折算：0 pass、非 0 fail、null missing", () => {
    expect(verdictOfExit(0)).toBe("pass");
    expect(verdictOfExit(1)).toBe("fail");
    expect(verdictOfExit(null)).toBe("missing");
  });
});
