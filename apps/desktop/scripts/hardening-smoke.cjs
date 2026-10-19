// 硬化冒烟的 Electron 入口（与 src/main/entry.cjs 同式：注册 tsx 后直跑 TS）。
const path = require("node:path");
const repoRoot = path.resolve(__dirname, "..", "..", "..");
require(require.resolve("tsx/cjs", { paths: [repoRoot] }));
require(path.join(__dirname, "hardening-smoke.ts"));
