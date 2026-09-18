// ipc-reachability-check —— 门 0（可达性）：能力已发货 ≠ 用户点得到。
//
// 立论来自实测：主进程注册了 31 个 handler、preload 暴露 34 条通道，而渲染层只引用其中 14 个方法
// （compact / 记忆删除 / 插件信任决议 / sidechat 四件 / card_action / 定时任务四件 / BYOK 三件 /
// 更新检查两件 —— 全部**有真实 handler、有测试、无 UI 入口**）。
// ipc:check 自己不碰渲染层（它直调 handleAgentRun），所以「桥断在 UI 上」这件事今天无人守。
//
// 三条判据：
//   A1 桥两端对齐：preload 每条 invoke/send 通道都要有 main handler（反之若有 handler 却无人暴露 =
//      死 handler）；main 侧 `.send("ch")` 的推送通道必须被 preload 的订阅面包住。硬门。
//   A2 渲染层可达（**棘轮**）：渲染层没引用的通道记在 scripts/ipc-reachability-check-baseline.json。
//      新增孤儿 ⇒ 红；孤儿被接上而基线没删 ⇒ 也红（逼基线只减不增，不是一次性豁免清单）。
// 不做的一条（想过但判据站不住）：「渲染层调用的 api.X 必须是 preload 方法」的拼写防线——
// app.js 里 `api` 只是 window.agent 的局部别名，同名的还有别的对象；靠名字形状猜会淹在误报里，
// 真要做得上 AST 作用域解析，不在这道门的最小面上。
//
// 判据一律写在 JS 侧（AGENTS.md：shell grep 的 \b \s \| 在 BSD grep 上静默返空）。
// 解析与棘轮内核在 ipc-reachability-check-core.ts（可单测），本文件只做装配 + 判定 + 退出码。
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePreload, parseRendererChannels, parseRendererRefs, ratchetDiff, type BridgeRow } from "./ipc-reachability-check-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = join("scripts", "ipc-reachability-check-baseline.json");

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && /\.(ts|js|html)$/.test(ent)) out.push(p);
  }
  return out;
}

function read(p: string): string {
  return readFileSync(p, "utf8");
}

let failures = 0;
function assert(cond: boolean, label: string, detail = ""): void {
  if (cond) { console.log(`  ✅ ${label}`); return; }
  failures++;
  console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
}

const emit = process.argv.includes("--emit-baseline");
const preload = parsePreload(read(join(ROOT, "src", "preload", "index.ts")));
const mainFiles = walk(join(ROOT, "src", "main"));
const rendererFiles = walk(join(ROOT, "src", "renderer"));
const mainSrc = mainFiles.map(read).join("\n");
const rendererSrc = rendererFiles.map(read);

const handlers = new Set([...mainSrc.matchAll(/ipcMain\.(?:handle|on)\(\s*"([^"]+)"/g)].map((m) => m[1]));
const pushes = new Set([...mainSrc.matchAll(/\.send\(\s*"([^"]+)"/g)].map((m) => m[1]));
const exposed = new Set(preload.map((r) => r.channel));
const refs = parseRendererRefs(rendererSrc);
const refChannels = parseRendererChannels(rendererSrc);

console.log(
  `== ipc-reachability ==\n  preload 桥 ${preload.length} 条（invoke/send ${preload.filter((r) => r.kind !== "push").length} + push ${preload.filter((r) => r.kind === "push").length}）` +
  ` / main handler ${handlers.size} 个 / 渲染层引用方法 ${refs.size} 个`,
);

// ---- A1 桥两端对齐 ----
const noHandler = preload.filter((r) => r.kind !== "push" && !handlers.has(r.channel)).map((r) => r.api + ":" + r.channel);
assert(noHandler.length === 0, "A1a preload 每条 invoke/send 都有 main handler", noHandler.join("、"));
const deadHandlers = [...handlers].filter((c) => !exposed.has(c) && !c.startsWith("devtools:")).sort();
assert(deadHandlers.length === 0, "A1b main 注册的通道都被 preload 暴露（无死 handler）", deadHandlers.join("、"));
const noPushBridge = [...pushes].filter((c) => !exposed.has(c)).sort();
assert(noPushBridge.length === 0, "A1c 主进程 .send() 的推送通道都有 preload 订阅面", noPushBridge.join("、"));

// ---- A2 可达性棘轮 ----
const orphans = preload.filter((r) => !refs.has(r.api) && !refChannels.has(r.channel)).map((r) => r.channel);
const uniqueOrphans = [...new Set(orphans)].sort();
const baselinePath = join(ROOT, BASELINE_FILE);
if (emit) {
  const body = {
    note: "渲染层未引用的 IPC 通道（门 0 可达性欠账）。只能减不能增：接上 UI 就把条目删掉，新增桥必须同时接 UI。",
    orphans: uniqueOrphans,
  };
  writeFileSync(baselinePath, JSON.stringify(body, null, 2) + "\n", "utf8");
  console.log(`  📝 基线已写出：${BASELINE_FILE}（${uniqueOrphans.length} 条）`);
  process.exit(0);
}
if (!existsSync(baselinePath)) {
  console.log(`  ❌ A2 缺基线文件 ${BASELINE_FILE}（用 pnpm run ipc-reachability -- --emit-baseline 生成）`);
  failures++;
} else {
  const base = JSON.parse(read(baselinePath)) as { orphans: string[] };
  const { added, fixed } = ratchetDiff(uniqueOrphans, base.orphans ?? []);
  assert(added.length === 0, `A2a 无新增孤儿桥（渲染层没引用的通道；基线 ${base.orphans.length} 条）`, added.join("、"));
  assert(fixed.length === 0, "A2b 基线不陈旧：已接上 UI 的通道要从基线删掉（棘轮只减不增）", fixed.join("、"));
  console.log(
    `  ℹ️  门 0 欠账 ${uniqueOrphans.length} 条 / 已可达 ${preload.length - uniqueOrphans.length} 条：\n` +
    uniqueOrphans.map((c) => "      · " + c).join("\n"),
  );
}

console.log(failures === 0 ? "\n[ipc-reachability-check] 全部断言通过 ✅" : `\n[ipc-reachability-check] ${String(failures)} 条断言失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
