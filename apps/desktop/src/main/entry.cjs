// Electron main 入口：注册 tsx 后直跑 TS 源（src/main/index.ts）——
// core 链不打包：ROOT/import.meta 语义逐文件保真，tsx 是本仓原生通道。
// （esbuild 打包 core 链会把 agent-runner 的 ROOT 漂到 <repo>/apps，fixtures 运行时静默落空；
//   且本包 "type":"module" 下 Electron 以 import() 装载 CJS main 即崩——.cjs shim 避开。）
const path = require("node:path");
// __dirname = <repo>/apps/desktop/src/main，上溯 4 层才是 repo 根（apps/desktop/src/main 各一层）
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
require(require.resolve("tsx/cjs", { paths: [repoRoot] }));
require(path.join(__dirname, "index.ts"));
