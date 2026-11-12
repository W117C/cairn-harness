// 判卷侧的 STR 形解析（第 1075 页）：文案收编进 STR 之后，源码里只剩 `{STR.x.y}`。
// 判据若继续只认字面量，就会从「扫了 N 条」静默变成「扫到 0 条」——那是把门槛放低，不是完成迁移。
// 本模块把「字面量 or STR 键」统一解析回值；设置面成对样本 / 分区标题 / 行标签三处共用一份（不许各抄一遍）。
import { STR } from "../../src/renderer/strings";

/** 按点路径取 STR 里的字符串值；取不到返回 undefined（缺键要能被判据看见，不许兜底成空串）。 */
export function strValue(path: string): string | undefined {
  let cur: unknown = STR;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** 一个属性值的两种形状：`"字面量"` 或 `{STR.a.b}`。两个捕获组二选一（字面量组 / 键组）。 */
export const SRC_VALUE = String.raw`(?:"([^"]{2,})"|\{STR\.([A-Za-z0-9_.]+)\})`;

/** 把一次 match 的两个捕获组解析回值：字面量优先，其次 STR 键。 */
export function resolveValue(literal: string | undefined, key: string | undefined): string | undefined {
  if (literal !== undefined) return literal;
  if (key === undefined) return undefined;
  return strValue(key);
}
