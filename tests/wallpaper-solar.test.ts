// 日出日落判卷：已知城市/日期与常见公开值差在 ±12 分钟内；极昼/极夜如实返回。
import { describe, expect, it } from "vitest";
import { dayOfYear, isDaylight, sunTimes } from "../src/wallpaper/solar";

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const minutesToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

describe("日出日落（近似解）", () => {
  it("dayOfYear：1 月 1 日 = 1，12 月 31 日 = 365（平年）", () => {
    expect(dayOfYear(at("2026-01-01"))).toBe(1);
    expect(dayOfYear(at("2026-12-31"))).toBe(365);
  });

  it("北京 2026-06-21：日出 ≈ 04:46 CST（= 20:46 UTC 前一日口径按 UTC 分钟），差 ≤12 分钟", () => {
    const t = sunTimes(at("2026-06-21"), 39.9042, 116.4074);
    expect(t.polar).toBeNull();
    // 北京日出 04:46 CST = 20:46 UTC（前一日）；我们算的是 UTC 分钟，因此落在 1240 附近
    const actual = t.sunriseUtcMin!;
    const expected = 20 * 60 + 46;
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(12);
    expect(minutesToHHMM(actual)).toMatch(/^\d\d:\d\d$/);
  });

  it("北极圈内：夏至极昼、冬至极夜（不给假时间）", () => {
    expect(sunTimes(at("2026-06-21"), 78.2, 15.6).polar).toBe("day");
    expect(sunTimes(at("2026-12-21"), 78.2, 15.6).polar).toBe("night");
    const summer = sunTimes(at("2026-06-21"), 78.2, 15.6);
    expect(summer.sunriseUtcMin).toBeNull();
  });

  it("isDaylight：北京夏至正午是白天、午夜是夜里", () => {
    expect(isDaylight(new Date("2026-06-21T04:00:00Z"), 39.9042, 116.4074)).toBe(true);
    expect(isDaylight(new Date("2026-06-21T16:00:00Z"), 39.9042, 116.4074)).toBe(false);
    expect(isDaylight(new Date("2026-06-21T12:00:00Z"), 78.2, 15.6)).toBe(true); // 极昼
  });
});
