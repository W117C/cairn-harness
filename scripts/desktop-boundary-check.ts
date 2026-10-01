// 桌面端单向依赖纪律（spec §8）：apps/desktop → src 允许；src → apps/desktop 即红。
// src 内 UI/Electron import 本就违反 core-only 纪律，一并扫（AGENTS.md 双向条款的机器面）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// 本 repo 路径含空格，URL pathname 会把空格编码成 %20，必须经 fileURLToPath 还原。
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const violations: string[] = [];

function walk(dir: string, visit: (file: string) => void): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { if (name !== "node_modules" && name !== "dist" && name !== "dist-electron") walk(p, visit); }
    else if (/\.(ts|tsx|mts)$/.test(name)) visit(p);
  }
}

walk(join(ROOT, "src"), (file) => {
  const text = readFileSync(file, "utf8");
  // 说明符「包含」apps/desktop 或 electron 即红（brief 原正则要求 specifier 恰好以其结尾，
  // 抓不住 import 语句里指向 ../../apps/desktop/src/main/channels 的真实路径，经探针实测修正）。
  // 注释里刻意不写「import + 引号 specifier」的逐字形状：head-import-face 的 BARE_IMPORT
  // 会把注释当真 import 提取 ⇒ 悬空假红（M1-7 落库实测踩中：head-import-check 与其自测双红）。
  if (/(from\s+["']|import\s*\(?\s*["'])[^"']*(apps\/desktop|electron)/.test(text)) {
    violations.push(`${relative(ROOT, file)}: src 不得 import apps/desktop 或 electron`);
  }
});

if (violations.length > 0) {
  console.error("desktop-boundary-check 红线：\n" + violations.join("\n"));
  process.exit(1);
}
console.log("desktop-boundary-check: 绿（src 无反向依赖、无 UI import）");
