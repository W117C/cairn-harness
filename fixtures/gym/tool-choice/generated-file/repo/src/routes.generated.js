// 本文件由 scripts/generate.mjs 生成，请勿手改。
// 改 src/routes.template.js 后重跑：node scripts/generate.mjs

export const ROUTES = [
  {
    "path": "/health",
    "handler": "health",
    "timeout": 5
  },
  {
    "path": "/users",
    "handler": "listUsers",
    "timeout": 30
  },
  {
    "path": "/orders",
    "handler": "listOrders",
    "timeout": 30
  },
  {
    "path": "/export",
    "handler": "exportOrders",
    "timeout": 200
  },
  {
    "path": "/login",
    "handler": "login",
    "timeout": 10
  }
];
