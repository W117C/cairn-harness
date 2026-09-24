// §11.2「降级链（fail-visible）」三条子句今天各由谁守——逐分句核验，不逐条。
// 承诺原文：Seatbelt 启动失败/平台不支持 → 会话硬降级「**L2 审批制全开 + 档位锁为只读** +
//   **对话中心常驻警示条**」，**绝不静默无沙箱运行**。
// 复跑：TERM=dumb node --import tsx outputs/sandbox-degrade-face-2026-09-24/measure-degrade.mts
import { readFileSync } from "node:fs";
import { evaluate, newAutonomySession } from "../../src/permissions/autonomy";
import { sandboxRisk } from "../../src/permissions/risk";
import type { PermissionMode, ToolName } from "../../src/permissions";

const MODES: PermissionMode[] = ["auto", "guided", "default", "read-only"];
const CASES: { label: string; tool: ToolName; args: Record<string, unknown> }[] = [
  { label: "run_shell rm", tool: "run_shell", args: { command: "rm -rf /tmp/degrade-probe" } },
  { label: "write_file", tool: "write_file", args: { path: "a.ts", content: "1" } },
  { label: "spawn_agent", tool: "spawn_agent", args: { mode: "read", task: "t" } },
  { label: "read_file", tool: "read_file", args: { path: "a.ts" } },
];

const sess = (mode: PermissionMode) =>
  newAutonomySession(mode, { rules: [], sandboxAvailable: false, sessionScopes: new Set<string>(), frozenJudgePaths: new Set<string>() });

// ---- 正控：先证"降级"这个前提真的进了判定（不传 false 时结论必须不同）----
const withDown = evaluate("write_file", { path: "a.ts", content: "1" }, sess("auto"));
const withUp = evaluate("write_file", { path: "a.ts", content: "1" },
  newAutonomySession("auto", { rules: [], sandboxAvailable: true, sessionScopes: new Set<string>(), frozenJudgePaths: new Set<string>() }));
console.log("正控：同一支写调用，沙箱可用=%s/沙箱降级=%s ⇒ 降级确实改判果", withUp.verdict, withDown.verdict);
if (withDown.verdict === withUp.verdict) {
  console.log("!! 正控失败 ⇒ 降级通道没接进判定，下面的表全是假读数");
  process.exit(1);
}

console.log("\n=== 子句① 「L2 审批制全开」：evaluate 逐档逐工具（sandboxAvailable=false）===");
for (const c of CASES) {
  const row = MODES.map((m) => {
    const d = evaluate(c.tool, c.args, sess(m));
    return `${m}=${d.verdict}/${(d as { layer: string }).layer}`;
  });
  console.log(`  ${c.label.padEnd(14)} ${row.join("  ")}`);
}
const sr = sandboxRisk(false, "write_file", true);
console.log("  sandboxRisk(false, 写向) =", sr.level, "｜sandboxRisk(false, 只读) =", sandboxRisk(false, "read_file", false).level);
console.log("  未接线（null）不触发本通道 =", sandboxRisk(null, "write_file", true).level);

console.log("\n=== 子句② 「档位锁为只读」：有没有真的把 mode 换成 read-only ===");
let modeLock = false;
for (const f of ["src/main/agent-runner.ts", "src/agent/orchestrator.ts", "src/permissions/autonomy.ts", "src/permissions/risk.ts"]) {
  const txt = readFileSync(f, "utf8");
  if (/sandbox[A-Za-z]*\s*===?\s*false[\s\S]{0,200}["']read-only["']/.test(txt)) { console.log("  命中", f); modeLock = true; }
}
console.log("  按『沙箱不可用 ⇒ 切档 read-only』的形状扫四处装配点：", modeLock ? "有" : "**无**");
console.log("  但今天实际拦得住的机理（上面那行正控 + 本表的 verdict 列）：");
console.log("    · auto/guided 的写向与副作用命令 → ask/L4-risk（沙箱通道），非交互 ask → deny（fail-closed）且不落盘；");
console.log("    · default 逐次审批、read-only 由 L0-hard 摘除写向工具；只读类工具本来就不需要沙箱。");
console.log("  ⇒ 字面那半句没实现，但它要保护的后果已由『强制送审 + 非交互必拒』守住。");
console.log("  ⚠️ 结论：**不要再补一个 mode 锁**——那正是本仓点名的『两道闸做同一件事、中间那条漏过去』的成因；");
console.log("     真要加，先构造出『现有机理放行而 mode 锁会拦』的那一格输入，构造不出就不该有第二道。");

console.log("\n=== 子句③ 「对话中心常驻警示条」：警示到底长在哪一面（按结构读，不按正则猜） ===");
const appJs = readFileSync("src/renderer/app.js", "utf8");
const html = readFileSync("src/renderer/index.html", "utf8");
const nodeAt = html.indexOf('id="sandboxState"');
const before = html.slice(0, nodeAt);
// 一律用**绝对位置**比较（上一版拿 before 内的相对下标去和 nodeAt 比，恒真 ⇒ 判据自证）
const overlayAt = html.lastIndexOf('<div class="settings-overlay"', nodeAt);
const setRowAt = before.lastIndexOf('class="set-row"');
const insideOf = (id: string): boolean => {
  const at = html.indexOf(`id="${id}"`);
  const ov = html.lastIndexOf('<div class="settings-overlay"', at);
  return at >= 0 && ov >= 0;
};
// 反向对照（同一条判据必须对一个已知在壳里的节点说"不在设置页"，否则它恒真、读数无意义）
const controlOutside = insideOf("titlebar");
if (controlOutside) {
  console.log("!! 反向对照失败：`titlebar` 被判成在设置页内 ⇒ 这条结构判据恒真，读数作废");
  process.exit(1);
}
console.log("反向对照：`titlebar` 判为『不在设置页』= 通过（判据不是恒真）");
console.log("  `id=\"sandboxState\"` 在 index.html 第", html.slice(0, nodeAt).split("\n").length, "行");
console.log("  它之前最近的 settings-overlay 开标记：", overlayAt >= 0 ? "有" : "无",
  "｜最近一个 set-row：", setRowAt >= 0 ? "有（= 设置页卡片里的一行）" : "无");
// 结构判据：节点在 settings-overlay 之内 ⇒ 它只在设置面板打开时可见（该面板未弹时 inert + aria-hidden）
const insideSettings = overlayAt >= 0 && nodeAt > overlayAt;
const bannerMarkup = /class="[^"]*(banner|alert)[^"]*"[^>]*>[^<]*沙箱/.test(html);
console.log("  ⇒ 警示条在设置面板内 =", insideSettings, "｜存在独立 banner 节点 =", bannerMarkup);
console.log("     （设置面板初始 `inert` + `aria-hidden`，未弹时对整个页面不可达也不可交互——同一份 index.html 的注释自陈）");
// 那句"常驻底栏"还成立吗：注释之后紧跟的是不是标记本体
const barCommentAt = html.indexOf("常驻底栏");
const afterComment = html.slice(barCommentAt, barCommentAt + 240).replace(/^[\s\S]*?-->/, "").trim().slice(0, 40);
console.log("  index.html 里「常驻底栏（VIS-02）：沙箱态 / 事件数 / token」这句注释：",
  barCommentAt >= 0 ? `在第 ${html.slice(0, barCommentAt).split("\n").length} 行，其后 40 字符 = ${JSON.stringify(afterComment)}` : "不存在");
console.log("     ⇒ 注释承诺的底栏段有没有对应标记，读上面那串就知道（全是 </div> = 标记不在这里）");
console.log("  app.js 侧唯一写点：", JSON.stringify((appJs.slice(appJs.indexOf("initSandboxState"), appJs.indexOf("initSandboxState") + 150)).replace(/\s+/g, " ")));
console.log("  ⚠️ 本判据读的是**结构**（谁包住那个节点），不是实际 paint；结论只到『常驻可见那一面缺』，");
console.log("     不到『屏幕上完全看不到』——后者要在真窗口里测（app.js / index.html 现处他人在飞改动集）。");
console.log("  对照承诺：§11.2 要『对话中心常驻警示条』，且 src/main/index.ts 头部注释写着『renderer 以常驻警示条提示』");
console.log("     ⇒ 两处文字都把它说成常驻，今天它只在设置页读得到 = 『绝不静默无沙箱运行』的用户可见那一半未接。");
