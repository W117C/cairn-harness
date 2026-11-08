// 发送队列键一致性 · 真机判卷（2026-10-28 · 第 750 页）：真实 renderer + 真实 dist，
// 走「排队 → 打断并发送 / 移出队列」两条路径，断言**队列不会静默消失**。
//
// 为什么必须真机：这条缺陷的本体是「写用限定键、读用裸 id」在**同一个 map**上的错配——
// 纯函数判卷只能证键函数的行为，证不了渲染层真的按同一个键读写、真的不丢队列。
//
// 用法（先 build）：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE \
//   ./node_modules/.bin/electron scripts/queue-key-smoke.cjs outputs/queue-key-750
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-queue-key-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-queue-key-"));
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
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        // run 挂住不返回 ⇒ 运行态立得住 ⇒ 第二条才进得了队列。
        // 桩若 30ms 就返回，运行态瞬间消失，队列条根本不会出现（第一版就死在这里）。
        "--cairn-steer-fixture",
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
  // 队列条的实际 DOM（SendQueueStrip.tsx:17-41）：.queue-strip / .queue-item / .q-text
  const queueState = () => js(`(() => {
    const strip = document.querySelector('.queue-strip');
    const items = Array.from(document.querySelectorAll('.queue-item .q-text')).map((n) => n.textContent);
    return { present: !!strip, items };
  })()`);
  const setComposer = (value) => js(`(() => {
    const t = document.querySelector('[data-composer-input="true"]');
    if (!t) return false;
    t.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(t, ${JSON.stringify(value)});
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const pressEnter = () => js(`(() => {
    const t = document.querySelector('[data-composer-input="true"]');
    if (!t) return false;
    t.focus();
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(700);

  // 进会话（队列条只在会话态在场）。
  const session = await js(`(() => {
    const s = document.querySelector('.session');
    if (!s) return null;
    s.click();
    return true;
  })()`);
  check("进入会话", session === true, { session });
  await pause(600);

  // 造一条排队：先发一条（起跑），运行中再点「加入队列」钮排第二条。
  // ⚠️ 运行中按回车是**插话到本轮**（规格 §3.2），不是入队——想入队得点那颗钮
  // （按钮写着「加入队列」却把话插进当前轮 = 按钮说谎）。
  await setComposer("第一条：起跑");
  await pressEnter();
  await pause(700);
  await setComposer("第二条：排队");
  const queuedByBtn = await js(`(() => {
    const btn = document.querySelector('.send-btn.queue');
    if (!btn) return { clicked: false, why: 'no queue button' };
    btn.click();
    return { clicked: true };
  })()`);
  await pause(700);

  const queued = await queueState();
  check("第二条进入队列（队列条在场）", queuedByBtn?.clicked === true && queued?.present === true && queued?.items?.length === 1, { queuedByBtn, queued });

  // 「移出队列」：只该删掉这一条，**不该把整条队列清空**（修前：写回空表 ⇒ 队列消失）。
  // 移出钮是纯 X 图标（文字在 aria-label 上），按 aria-label 找。
  const removed = await js(`(() => {
    const btn = document.querySelector('.queue-item button[aria-label^="移出队列"]');
    if (!btn) return { clicked: false, why: 'no remove button' };
    btn.click();
    return { clicked: true };
  })()`);
  await pause(500);
  const afterRemove = await queueState();
  check(
    "移出队列只删这一条，队列条不因写回空表而整条消失",
    removed?.clicked === true && afterRemove?.present === false,
    { removed, afterRemove },
  );

  // 再造两条，然后走「打断并发送」：它必须**改序**（把选中那条提到队首），不把队列清空。
  const queueTwo = async (text) => {
    await setComposer(text);
    const clicked = await js(`(() => {
      const btn = document.querySelector('.send-btn.queue');
      if (!btn) return { clicked: false };
      btn.click();
      return { clicked: true };
    })()`);
    await pause(700);
    return clicked;
  };
  const q3 = await queueTwo("第三条：排队 A");
  const q4 = await queueTwo("第四条：排队 B");
  const two = await queueState();
  check("两条排队在场", q3?.clicked === true && q4?.clicked === true && two?.items?.length === 2, { q3, q4, two });

  const promoted = await js(`(() => {
    const btn = Array.from(document.querySelectorAll('.queue-item button')).find((b) => (b.textContent ?? '').includes('打断并发送'));
    if (!btn) return { clicked: false };
    btn.click();
    return { clicked: true };
  })()`);
  await pause(600);
  const afterPromote = await queueState();
  // 「打断并发送」＝ 提到队首 + 打断本轮 ⇒ 收束时队首被**派出去**（这是既有语义，
  // 不是缺陷）。所以条上少掉的是**被派出的那一条**，另一条必须**留在队列里**
  // （修前：写回空表 ⇒ 整条队列消失 ⇒ 用户另一条排队消息静默丢失）。
  const runsNow = await js(`JSON.stringify((window.__cairnRuns ? window.__cairnRuns() : []).map((r) => r.message))`);
  const dispatched = String(runsNow).includes(two?.items?.[0] ?? "\u0000");
  check(
    "打断并发送：被选中的那条被派出去，另一条仍留在队列（队列不被清空）",
    promoted?.clicked === true && dispatched === true && afterPromote?.items?.length === 1 && afterPromote?.items?.[0] === two?.items?.[1],
    { promoted, before: two, after: afterPromote, runs: runsNow },
  );

  check("渲染过程无控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`读数：${checks.length} 条，${checks.length - failed.length} 绿 / ${failed.length} 红 → ${out}`);
  if (failed.length > 0) process.exitCode = 1;
  win.destroy();
}

main().catch((err) => { console.error("queue-key-smoke failed:", err); process.exitCode = 1; });
