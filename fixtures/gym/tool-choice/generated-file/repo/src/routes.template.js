// 路由表模板（真源）。routes.generated.js 由 scripts/generate.mjs 从这里生成。
export const ROUTES = [
  { path: "/health", handler: "health", timeout: 5 },
  { path: "/users", handler: "listUsers", timeout: 30 },
  { path: "/orders", handler: "listOrders", timeout: 30 },
  // BUG：导出接口的 timeout 单位是**秒**，这里写成了 200（=200ms），比别的短一个数量级。
  { path: "/export", handler: "exportOrders", timeout: 200 },
  { path: "/login", handler: "login", timeout: 10 },
];

/** 从路由表里找一条。找不到返回 undefined。 */
export function findRoute(path) {
  return ROUTES.find((r) => r.path === path);
}