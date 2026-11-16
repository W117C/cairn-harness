// 天气切换判卷：四档、没配不猜、读不出不换、代码映射。
import { describe, expect, it } from "vitest";
import { decideWeather, isWeatherKind, weatherFromCode, WEATHER_KINDS } from "../src/wallpaper/weather";

describe("按天气切换", () => {
  it("四档固定；未知值不是 WeatherKind", () => {
    expect(WEATHER_KINDS).toEqual(["clear", "clouds", "rain", "snow"]);
    expect(isWeatherKind("rain")).toBe(true);
    expect(isWeatherKind("hail")).toBe(false);
    expect(isWeatherKind(1)).toBe(false);
  });

  it("命中那档就换；没配那档 ⇒ 不猜、不回落", () => {
    const paths = { clear: "/sun.png", rain: "/rain.png" };
    expect(decideWeather({ kind: "rain", paths })).toEqual({ path: "/rain.png", reason: "现在是 rain" });
    expect(decideWeather({ kind: "snow", paths })).toEqual({ path: null, reason: "没配「snow」那张" });
  });

  it("配了但读不出来 ⇒ 不换并说明", () => {
    expect(decideWeather({ kind: "clear", paths: { clear: "/gone.png" }, exists: () => false }))
      .toEqual({ path: null, reason: "配的那张读不出来" });
  });

  it("天气代码映射（接真源时用）：2xx-5xx 雨、6xx 雪、800 晴、>800 云", () => {
    expect(weatherFromCode(500)).toBe("rain");
    expect(weatherFromCode(601)).toBe("snow");
    expect(weatherFromCode(800)).toBe("clear");
    expect(weatherFromCode(803)).toBe("clouds");
    expect(weatherFromCode(741)).toBe("clouds");
  });
});
