// 同名会话 × 两工作区 · 真机判卷（2026-10-28 · 第 753 页）：真实 renderer + 真实 dist，
// 证「两个工作区里 id 相同的会话，队列与运行态**互不串**」。
//
// 为什么这条要有真机：限定键（`runKey(workspace, sid)` = JSON 元组）的**全部价值**就在
// 同名场景——会话 id 是分钟级时间戳，跨项目可撞名；只用裸 id 做键 ⇒ A 项目的队列会写进
// B 项目。纯函数层已钉（tests/queue-key.test.ts 的键函数断言），但**渲染层真的按限定键
// 读写**、真的不串，只能在真机上量。
//
// 用法（先 build）：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE \
//   ./node_modules/.bin/electron scripts/same-id-workspace-smoke.cjs outputs/same-id-753
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-same-id-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-same-id-"));
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
    isArray: /Promise<[^>]*[\]>]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)),
  }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-same-id-workspace-fixture",
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  const js = async (source) => {
    try {
      return await win.webContents.executeJavaScript(source);
    } catch (err) {
      errors.push(`probe-js: ${String(err && err.message ? err.message : err)}`);
      return null;
    }
  };
  const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  };
  // 侧栏里两个同名会话（分属不同项目组）——点其中一个，看主区是**哪一边**的转录。
  const openByTitle = async (title) => js(`(() => {
    const rows = Array.from(document.querySelectorAll('.session'));
    const hit = rows.find((r) => (r.textContent ?? '').includes(${JSON.stringify(title)}));
    if (!hit) return { clicked: false, titles: rows.map((r) => (r.textContent ?? '').slice(0, 24)) };
    hit.click();
    return { clicked: true };
  })()`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(900);

  const listing = await js(`(() => ({
    sessions: Array.from(document.querySelectorAll('.session')).map((r) => (r.textContent ?? '').slice(0, 30)),
    groups: Array.from(document.querySelectorAll('.group-head, .group-title, .group')).map((g) => (g.textContent ?? '').slice(0, 20)),
  }))()`);
  check("侧栏摆着两个同名会话（分属两个项目）", (listing?.sessions?.length ?? 0) >= 2, listing);

  // 打开「同名会话 · 项目甲」
  const openA = await openByTitle("同名会话 · 项目甲");
  await pause(800);
  const bodyA = await js(`document.querySelector('.stream')?.innerText?.slice(0, 120) ?? ''`);
  check("打开甲 ⇒ 主区是甲的转录", openA?.clicked === true && bodyA.includes("甲项目"), { openA, bodyA });
  const queueA = await js(`JSON.stringify([...document.querySelectorAll('.queue-item .q-text')].map((n) => n.textContent))`);
  check("甲侧只看到甲的排队消息", queueA === JSON.stringify(["甲项目排队的那条"]), { queueA });

  // 切到「同名会话 · 项目乙」——同 id、不同工作区
  const openB = await openByTitle("同名会话 · 项目乙");
  await pause(900);
  const bodyB = await js(`document.querySelector('.stream')?.innerText?.slice(0, 120) ?? ''`);
  check("切到乙 ⇒ 主区换成乙的转录（同 id 没串）", openB?.clicked === true && bodyB.includes("乙项目"), { openB, bodyB });
  const queueB = await js(`JSON.stringify([...document.querySelectorAll('.queue-item .q-text')].map((n) => n.textContent))`);
  check("乙侧只看到乙的排队消息（限定键生效，甲的没串过来）", queueB === JSON.stringify(["乙项目排队的那条"]), { queueB });

  // 切回甲 ⇒ 甲的队列还在（没被乙的覆盖）
  const backA = await openByTitle("同名会话 · 项目甲");
  await pause(900);
  const queueBack = await js(`JSON.stringify([...document.querySelectorAll('.queue-item .q-text')].map((n) => n.textContent))`);
  check("切回甲 ⇒ 甲的排队消息还在（没被乙覆盖）", backA?.clicked === true && queueBack === JSON.stringify(["甲项目排队的那条"]), { backA, queueBack });

  // 队列写回时带的 workspace 是**限定**的（不是裸 id）
  // contextBridge 暴露的是**对象** ⇒ 读数走 `__cairnSameId.calls()`（第一版写成
  // `__cairnSameId()` ⇒ "not a function"——contextBridge 的函数在对象里）。
  // 在甲侧移出一条排队消息 ⇒ 触发 queueSet ⇒ 记录里必须带 workspace（限定键）。
  const removed = await js(`(() => {
    const btn = document.querySelector('.queue-item button[aria-label^="移出队列"]');
    if (!btn) return { clicked: false };
    btn.click();
    return { clicked: true };
  })()`);
  await pause(700);
  const setCalls = await js(`JSON.stringify((window.__cairnSameId ? window.__cairnSameId.calls().queueSet : []))`);
  // 侧车里必须留下**按 workspace 区分**的记录：两个同名会话各写一次 ⇒ 两条记录、
  // 两条 workspace 不同。写用裸 id 时，两次写会落到同一条记录里（后写覆盖先写）⇒
  // 这条判据当场红。
  const calls = await js(`JSON.stringify((window.__cairnSameId ? window.__cairnSameId.calls().queueSet : []))`);
  let parsed = [];
  try { parsed = JSON.parse(calls); } catch { parsed = []; }
  const wsOf = (w: string) => parsed.filter((c) => c.workspace === w);
  check(
    "队列写回按 workspace 区分（两个同名会话各写一次 ⇒ 侧车两条、workspace 不同）",
    removed?.clicked === true
      && parsed.length >= 2
      && wsOf("/tmp/demo-ws").length >= 1
      && wsOf("/tmp/demo-ws-other").length >= 1,
    { removed, calls },
  );

  check("渲染过程无控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`读数：${checks.length} 条，${checks.length - failed.length} 绿 / ${failed.length} 红 → ${out}`);
  if (failed.length > 0) process.exitCode = 1;
  win.destroy();
}

main().catch((err) => { console.error("same-id-workspace-smoke failed:", err); process.exitCode = 1; });
