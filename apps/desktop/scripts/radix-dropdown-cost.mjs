// 量「Radix 下拉菜单依赖树」这笔账：把 6 处下拉的整个 Radix 子树（含触发钮）延迟加载，
// 能从**主路由首屏闭包**里拿走多少字节？换来的是**首次点开**要多取一个多大的 chunk？
// 这是「体积 vs 首次打开延迟」那笔裁定的数字依据（不是拍脑袋）。
//
// 口径（先说清，免得读成两倍）：
//   · 只量**主路由的静态闭包**（首屏 chunk ＋ App chunk ＋ 它们的静态 import 链）——
//     那才是"开应用第一眼要下的东西"；
//   · 同一个模块**只算一次**（按模块 id 去重）——同一份 vendor 不会因落在不同 chunk 里就变成两份。
//
// 用法：node scripts/radix-dropdown-cost.mjs [bundle-audit 的 JSON 路径]
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/cairn-bundle-final2.json", "utf8"));
const byName = new Map(report.chunks.map((c) => [c.file, c]));

/** 渲染层只 import 这一个 Radix 包 ⇒ 下拉专用依赖树 = 它及其传递依赖。 */
const DROPDOWN_ONLY = [
  "@radix-ui/react-dropdown-menu", "@radix-ui/react-menu", "@radix-ui/react-context",
  "@radix-ui/react-popper", "@radix-ui/react-portal", "@radix-ui/react-roving-focus",
  "@radix-ui/react-focus-scope", "@radix-ui/react-focus-guards", "@radix-ui/react-dismissable-layer",
  "@radix-ui/react-presence", "@radix-ui/react-collection", "@radix-ui/react-slot",
  "@radix-ui/react-primitive", "@radix-ui/react-compose-refs", "@radix-ui/react-use-callback-ref",
  "@radix-ui/react-use-controllable-state", "@radix-ui/react-use-size", "@radix-ui/react-direction",
  "@radix-ui/react-use-is-hydrated", "@radix-ui/react-use-effect-event", "@radix-ui/react-id",
  "@radix-ui/react-use-layout-effect", "@radix-ui/primitive",
  "@floating-ui/core", "@floating-ui/dom", "@floating-ui/react-dom", "@floating-ui/utils",
  "react-remove-scroll", "react-remove-scroll-bar", "use-sidecar", "use-callback-ref",
  "react-style-singleton", "get-nonce", "aria-hidden", "tslib",
];
const isDropdownOnly = (id) => DROPDOWN_ONLY.some((pkg) => id.includes(`node_modules/${pkg}/`));

/** 主路由（App.tsx 那个入口）的静态闭包。 */
const appChunk = report.chunks.find((c) => c.modules.some((m) => m.id.endsWith("renderer/App.tsx")));
if (appChunk === undefined) throw new Error("找不到 App 入口 chunk");
const closure = new Set(report.initialChunks);
const stack = [appChunk.file];
while (stack.length > 0) {
  const name = stack.pop();
  if (closure.has(name)) continue;
  const chunk = byName.get(name);
  if (chunk === undefined) continue;
  closure.add(name);
  for (const imp of chunk.imports) stack.push(imp);
}

/** 闭包内的模块（按 id 去重，chunk 字节数按 chunk 记、模块体积按模块记）。 */
const seen = new Map();
for (const name of closure) {
  const chunk = byName.get(name);
  if (chunk === undefined) continue;
  for (const m of chunk.modules) {
    const prev = seen.get(m.id);
    if (prev === undefined || m.bytes > prev) seen.set(m.id, m.bytes);
  }
}
let dropdownBytes = 0;
const dropdownModules = [];
for (const [id, bytes] of seen) {
  if (!isDropdownOnly(id)) continue;
  dropdownBytes += bytes;
  dropdownModules.push({ bytes, id: id.split("node_modules/").pop() });
}
dropdownModules.sort((a, b) => b.bytes - a.bytes);

const initialBytes = report.initialBytes;
const routeBytes = report.routeBytes ?? {};
const mainRoute = routeBytes.main ?? initialBytes;
console.log(`\n下拉专用依赖树（主路由闭包内、模块去重）：${dropdownBytes} B（${dropdownModules.length} 个模块）`);
console.log(`主路由现值 ${mainRoute} B ⇒ 若整体延迟，约 ${mainRoute - dropdownBytes} B（-${((dropdownBytes / mainRoute) * 100).toFixed(1)}%）`);
console.log(`（口径提醒：入口 chunk 只 ${initialBytes} B；首屏实际还要拉 App chunk 与共享 vendor 块 —— 别拿入口 chunk 当首屏）`);
for (const [route, bytes] of Object.entries(routeBytes)) {
  console.log(`路由 ${route}：${bytes} B ⇒ 约 ${bytes - dropdownBytes} B`);
}
console.log(`\n代价（量出来的）：① 6 处下拉的「触发钮」也得改成普通按钮（否则 Radix 的 Root/Trigger 已把 vendor 树拉进首屏）；`);
console.log(`② 首次点开要多取一个 chunk（本地磁盘读，量级在十几毫秒）＋一帧空窗；③ 6 处要改，是独立工程。`);
