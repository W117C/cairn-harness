// 侧栏会话清单失败行（＋可选的项目注册表提示臂）：真实 renderer + 合成 AgentApi。
// 证的是「失败原因上屏」——路径与出路都在，重试按钮也在；不是只有一句空话。
// 用法：pnpm --filter cairn-desktop build && ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/sidebar-load-error-smoke.cjs [输出目录]
const { app, BrowserWindow } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-list-error-profile-"));
app.setPath("userData", profile);
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-list-error-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({
    name: s[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)),
  }));
  const win = new BrowserWindow({
    width: 1280, height: 860, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-list-error-fixture",
        ...(process.argv.includes("--with-project-error") ? ["--cairn-project-error-fixture"] : []),
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") { errors.push(details.message); console.error("renderer:", details.message); } });
  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${ok ? "" : JSON.stringify(detail)}`); };

  await win.loadFile(join(process.env.CAIRN_RENDERER_DIST || join(__dirname, "../dist"), "index.html"));
  await pause(600);
  // 详情按需展开；展开后仍验证完整原句、文件路径与修复出路。
  await js(`document.querySelector('.side-load-error summary')?.click(); true;`);
  const row = await js(`(() => { const el = document.querySelector('.side-load-error'); return el ? { text: el.innerText, title: el.querySelector('.side-load-detail')?.getAttribute('title') ?? null, retry: !!el.querySelector('.side-retry') } : null; })()`);
  check("会话清单失败行在", row !== null, row);
  check("失败原因上屏：损坏文件路径 + 出路", row !== null && row.text.includes("会话元数据损坏") && row.text.includes("session-metadata.json") && row.text.includes("修好或删除该文件后重试"), row?.text);
  check("原句完整保留在 title（长路径不被截断成信息损失）", row?.title !== null && row.title.includes("session-metadata.json"), row?.title);
  check("重试按钮仍在", row?.retry === true, row?.retry);
  if (process.argv.includes("--with-project-error")) {
    const notice = await js(`document.querySelector('.side-notice')?.innerText ?? null`);
    check("项目注册表坏档：侧栏提示原样上屏（路径与出路都在）",
      typeof notice === "string" && notice.includes("项目注册表不可用") && notice.includes("projects.json") && notice.includes("修好或删除该文件后重试"), notice);
  }
  check("全程无渲染层控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "01-sidebar-load-error.png"), (await win.webContents.capturePage()).toPNG());

  const passed = checks.filter((c) => c.ok).length;
  writeFileSync(join(out, "checks.json"), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
  console.log(`[sidebar-load-error-smoke] ${passed}/${checks.length} PASS · 证据 ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}

main().catch((error) => { console.error("[sidebar-load-error-smoke] FAILED:", error); app.exit(2); });
