/** JSON 对象判定：非 null、非数组的 object。
 *
 *  这条判据此前在 42 个文件里各抄一份（第 965 页）：同一件事的判定不该随文件漂移。
 *  只回答「能不能当 Record 读」，不判断 plain object——Date / 类实例按既有口径仍是 true，
 *  数组、null 与原始值都不是。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
