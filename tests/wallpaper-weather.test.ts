// 天气切换判卷：四档、没配不猜、读不出不换、代码映射。
import { describe, expect, it } from "vitest";
import { decideWeather, isWeatherKind, weatherFromCode, weatherFromPayload, weatherFromText, weatherFromWmoCode, WEATHER_KINDS } from "../src/wallpaper/weather";

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

describe("天气外部源（离线文件）", () => {
  it("kind 直给 / code 数字 / code 字符串 三种都认", () => {
    expect(weatherFromText('{"kind":"snow"}')).toBe("snow");
    expect(weatherFromText('{"code":500}')).toBe("rain");
    expect(weatherFromText('{"code":"800"}')).toBe("clear");
  });

  it("坏 JSON / 未知值 / 非对象 ⇒ null（不猜）", () => {
    expect(weatherFromText("not json")).toBeNull();
    expect(weatherFromText('{"kind":"hail"}')).toBeNull();
    expect(weatherFromText('"rain"')).toBeNull();
    expect(weatherFromText("{}")).toBeNull();
  });
});

describe("联网源载荷（默认关）", () => {
  it("OpenWeather 形状 / 简化形状都认；其它 ⇒ null", () => {
    expect(weatherFromPayload({ weather: [{ id: 800 }] })).toBe("clear");
    expect(weatherFromPayload({ weather: [{ id: "500" }] })).toBe("rain");
    expect(weatherFromPayload({ kind: "snow" })).toBe("snow");
    expect(weatherFromPayload({ weather: [] })).toBeNull();
    expect(weatherFromPayload({ weather: [{ id: "x" }] })).toBeNull();
    expect(weatherFromPayload(null)).toBeNull();
  });
});

describe("Open-Meteo 形状（无 key 源）", () => {
  it("current_weather.weathercode ⇒ 四档；WMO 映射覆盖雨雪云晴", () => {
    expect(weatherFromPayload({ current_weather: { weathercode: 0 } })).toBe("clear");
    expect(weatherFromPayload({ current_weather: { weathercode: 3 } })).toBe("clouds");
    expect(weatherFromPayload({ current_weather: { weathercode: 61 } })).toBe("rain");
    expect(weatherFromPayload({ current_weather: { weathercode: 75 } })).toBe("snow");
    expect(weatherFromPayload({ current_weather: { weathercode: 95 } })).toBe("rain");
    expect(weatherFromPayload({ current_weather: {} })).toBeNull();
    expect(weatherFromWmoCode(2)).toBe("clouds");
  });
});
