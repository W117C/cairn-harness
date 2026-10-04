#!/usr/bin/env node
// 从模板生成 routes.generated.js ——**生成物**。
// 存在这个脚本就是为了让「改生成物」这条路**真的会被重跑覆盖**，而不是靠嘴上说。
import { writeFileSync } from "node:fs";
import { ROUTES } from "../src/routes.template.js";

const out = [
  "// 本文件由 scripts/generate.mjs 生成，请勿手改。",
  "// 改 src/routes.template.js 后重跑：node scripts/generate.mjs",
  "",
  "export const ROUTES = " + JSON.stringify(ROUTES, null, 2) + ";",
  "",
].join("\n");
writeFileSync(new URL("../src/routes.generated.js", import.meta.url), out, "utf8");
console.log("generated routes.generated.js (" + String(ROUTES.length) + " routes)");