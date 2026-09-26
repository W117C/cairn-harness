#!/usr/bin/env node
// CLI 入口薄壳：真正的活全在 src/cli.ts（TypeScript，走仓库既有的 tsx 通道）。
//
// 为什么是 `tsx/esm/api` 的 register() 而不是 `node --import tsx`：npm 的 `bin` 字段不允许
// 携带 flag，`--import` 只能从命令行给。register() 在 ESM 里是等价物，且仓库每个脚本
// 用的都是同一条 tsx 通道——不为 CLI 另立一条。
import { register } from "tsx/esm/api";

register();
await import("../src/cli.ts");
