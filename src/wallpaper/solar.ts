// 日出/日落的**近似计算**（够用来切壁纸，不追求天文台精度）。
//
// 用的是常见的「赤纬 + 时角」闭式解（NOAA 简化版）：
//   δ = -23.44° · cos(360/365 · (N + 10))            —— 太阳赤纬（N = 一年中的第几天）
//   cos(H) = -tan(φ)·tan(δ)                          —— 时角（φ = 纬度）
//   日出/日落（地方真太阳时）= 12 ∓ H/15
// 再换成为 UTC 分钟：`utc = 12 ∓ H/15 - lon/15`（lon 东经为正），最后加经度时差里的均时差省略项。
//
// 口径（可判的三条）：
//  ① **极昼/极夜**：`|cos H| > 1` ⇒ 返回 `polar`（`day` 或 `night`），不给假时间；
//  ② 返回的是 **UTC 分钟**（0..1440），调用方按本地时区显示；
//  ③ 精度写清：误差数量级 ±5 分钟（受均时差省略与地形影响），切壁纸够用，不当天文台。
export type PolarState = "day" | "night" | null;

export interface SunTimes {
  /** 日出（UTC 分钟，0..1440）；极昼/极夜为 null。 */
  sunriseUtcMin: number | null;
  /** 日落（UTC 分钟，0..1440）；极昼/极夜为 null。 */
  sunsetUtcMin: number | null;
  polar: PolarState;
}

const DEG = Math.PI / 180;

export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86_400_000) + 1;
}

export function sunTimes(date: Date, latitudeDeg: number, longitudeDeg: number): SunTimes {
  const n = dayOfYear(date);
  const declination = -23.44 * DEG * Math.cos((2 * Math.PI * (n + 10)) / 365);
  const lat = Math.max(-89.9, Math.min(89.9, latitudeDeg)) * DEG;
  const cosH = -Math.tan(lat) * Math.tan(declination);
  if (cosH > 1) return { sunriseUtcMin: null, sunsetUtcMin: null, polar: "night" };
  if (cosH < -1) return { sunriseUtcMin: null, sunsetUtcMin: null, polar: "day" };
  const H = Math.acos(cosH) / DEG; // 度
  const solarNoonHorizon = 12 - longitudeDeg / 15; // 当地太阳正午对应的 UTC 小时
  const sunrise = (solarNoonHorizon - H / 15) * 60;
  const sunset = (solarNoonHorizon + H / 15) * 60;
  return {
    sunriseUtcMin: ((sunrise % 1440) + 1440) % 1440,
    sunsetUtcMin: ((sunset % 1440) + 1440) % 1440,
    polar: null,
  };
}

/** 现在是白天吗（按 UTC 分钟比较；跨日的极昼/极夜由 polar 直接给）。 */
export function isDaylight(date: Date, latitudeDeg: number, longitudeDeg: number): boolean {
  const t = sunTimes(date, latitudeDeg, longitudeDeg);
  if (t.polar !== null) return t.polar === "day";
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const { sunriseUtcMin: rise, sunsetUtcMin: set } = t;
  // 跨 UTC 日的时段（日出 > 日落）要按「两段」判：t ≥ 日出 或 t < 日落。
  return rise! <= set!
    ? minutes >= rise! && minutes < set!
    : minutes >= rise! || minutes < set!;
}
