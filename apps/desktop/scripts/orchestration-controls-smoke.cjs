// 编排控制面的真实渲染器冒烟：真 dist + 合成 AgentApi（阶段机按引擎守卫走）。
// 证的是「按钮只在合法阶段出现」「破坏性动作第一次只确认、第二次才发命令」「命令带齐 plan/version/task」。
// 不证真实 provider / 真实执行后端 / 真实会话数据。
// 用法：pnpm --filter cairn-desktop build && pnpm --filter cairn-desktop exec electron scripts/orchestration-controls-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-orch-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-orch-smoke-"));
mkdirSync(out, { recursive: true });
/** 命令账本由 preload 夹具经 contextBridge 暴露（沙箱 preload 不能写文件）；窗口就绪后接上。 */
let ledger = () => Promise.resolve([]);

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  // preload 依据 --cairn-api-members 给缺省方法补桩；编排三通道由夹具显式提供。
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
        "--cairn-orchestration-fixture",
      ],
    },
  });
  ledger = () => win.webContents.executeJavaScript("window.__cairnOrchestration.commands()");
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") { errors.push(details.message); console.error("renderer:", details.message); } });
  const js = (source) => win.webContents.executeJavaScript(source).catch((err) => { console.error("操作失败:", source); throw err; });
  const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => { await pause(); writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG()); };
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  const pointerClick = async (selector) => {
    const point = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    if (!point) throw new Error("找不到可点元素：" + selector);
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await pause(450);
  };
  const read = (source) => js(`(() => { ${source} })()`);
  const exists = (selector) => read(`return !!document.querySelector(${JSON.stringify(selector)});`);
  const buttonText = (selector) => read(`const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent : null;`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause();
  await js(`document.querySelector('.session').click()`);
  await pause(500);
  // 任务窗格是用户从「＋」菜单开的；此处直接落跨重启布局，省掉 Radix 菜单的指针编排。
  await js(`window.localStorage.setItem('cairn.panes.v1', JSON.stringify(['tasks']))`);
  await win.reload();
  await pause(900);

  const pane = ".orchestration-pane";
  let state = await read(`
    const plan = document.querySelector('.orch-plan');
    return {
      pane: !!document.querySelector('.orchestration-pane'),
      goal: plan ? plan.getAttribute('aria-label') : null,
      phase: document.querySelector('.orch-phase')?.dataset.phase ?? null,
      phaseText: document.querySelector('.orch-phase')?.textContent ?? null,
      taskPhases: [...document.querySelectorAll('.orch-tasks li code')].map(el => el.dataset.phase),
    };`);
  check("任务窗格里出现编排计划且阶段可读", state.pane && state.phase === "proposed" && state.phaseText === "待批准" && state.goal === "计划 核对编排控制面", state);
  check("四个任务按夹具阶段落在面板上", JSON.stringify(state.taskPhases) === JSON.stringify(["running", "failed", "done", "needs_you"]), state.taskPhases);
  check("待批准阶段只有批准/拒绝/取消计划", await exists('[data-control-action="approve_plan"]') && await exists('[data-control-action="reject_plan"]') && await exists('[data-control-action="cancel_plan"]') && !(await exists('[data-control-action="pause_plan"]')) && !(await exists('[data-control-action="resume_plan"]')), null);
  check("未批准时不摆「启用执行」", !(await read(`return [...document.querySelectorAll('button')].some(el => el.textContent === '启用执行');`)), null);
  check("面板不出现引擎必然拒绝的手动交付按钮", !(await read(`return document.body.innerText.includes('合并交付') || document.body.innerText.includes('拒绝交付');`)), null);
  check("运行中任务只能暂停/取消，不给接管或重试", await exists('[data-control-action="pause_task"][data-control-scope="t0"]') && await exists('[data-control-action="cancel_task"][data-control-scope="t0"]') && !(await exists('[data-control-action="takeover_task"][data-control-scope="t0"]')) && !(await exists('[data-control-action="retry_task"][data-control-scope="t0"]')), null);
  check("失败且有次数的任务只给重试", await exists('[data-control-action="retry_task"][data-control-scope="t1"]') && !(await exists('[data-control-action="pause_task"][data-control-scope="t1"]')) && !(await exists('[data-control-action="cancel_task"][data-control-scope="t1"]')), null);
  check("已交付任务在有后端回滚能力时给回滚", await exists('[data-control-action="rollback_task"][data-control-scope="t2"]'), null);
  state = await read(`
    const item = document.querySelector('.orch-tasks li:nth-child(4)');
    return {
      phase: item.querySelector('code')?.dataset.phase,
      phaseText: item.querySelector('code')?.textContent,
      reason: item.querySelector('.orch-error')?.textContent,
      detail: item.querySelector('.orch-detail')?.textContent,
      next: document.querySelector('.orch-next')?.textContent,
    };`);
  check("待接管任务的原因、权限与验收都是产品中文", state.phase === "needs_you" && state.phaseText === "需你处理"
    && state.reason === "已由你接管" && state.detail.includes("权限：只读") && state.detail.includes("外部效果：无")
    && state.detail.includes("证据"), state);
  check("调度建议译成中文、未知原因原样透出", state.next.includes("派发") && state.next.includes("依赖失败、被取消或需要你处理")
    && state.next.includes("升级") && state.next.includes("upstream provider returned 529"), state.next);
  await shot("01-proposed");

  // 破坏性动作：第一次点只摆确认，不发命令；「返回」把按钮复原。
  let history = [];
  try {
  await pointerClick('[data-control-action="cancel_plan"]');
  const armed = await buttonText('[data-control-action="cancel_plan"]');
  history = await ledger();
  check("取消计划第一次点只摆确认、不发命令", armed === "确认取消计划" && history.length === 0, { armed, commands: history.length });
  check("确认态对读屏也改名（aria-label 跟着走）", (await read(`return document.querySelector('[data-control-action="cancel_plan"]').getAttribute('aria-label');`)) === "确认取消计划", null);
  await shot("02-arm-cancel");
  await read(`[...document.querySelectorAll('.orch-actions button')].find(el => el.textContent === '返回').click()`);
  await pause(300);
  history = await ledger();
  check("返回撤回确认且仍未发命令", (await buttonText('[data-control-action="cancel_plan"]')) === "取消计划" && history.length === 0, { commands: history.length });

  await pointerClick('[data-control-action="approve_plan"]');
  state = await read(`return { phase: document.querySelector('.orch-phase')?.dataset.phase, enable: [...document.querySelectorAll('.orch-actions button')].some(el => el.textContent === '启用执行') };`);
  check("批准后阶段前进，且执行仍是一步单独的操作", state.phase === "approved" && state.enable, state);
  history = await ledger();
  check("批准命令落账", history.length === 1 && history[0].command.action === "approve_plan" && history[0].command.plan_id === "plan-fixture" && history[0].command.version === 1 && typeof history[0].command.request_id === "string" && history[0].command.request_id.length > 0, history[0]);

  await pointerClick('[data-control-action="cancel_task"][data-control-scope="t0"]');
  history = await ledger();
  check("取消任务第一次点只摆确认", (await buttonText('[data-control-action="cancel_task"][data-control-scope="t0"]')) === "确认取消任务" && history.length === 1, { commands: history.length });
  await pointerClick('[data-control-action="cancel_task"][data-control-scope="t0"]');
  state = await read(`return { phase: document.querySelector('.orch-tasks li:nth-child(1) code')?.dataset.phase, text: document.querySelector('.orch-tasks li:nth-child(1) code')?.textContent };`);
  history = await ledger();
  check("第二次点才真的取消任务并落账", state.phase === "cancelled" && state.text === "已取消" && history.length === 2 && history[1].command.action === "cancel_task" && history[1].command.task_id === "t0", { state, last: history[1] });

  await pointerClick('[data-control-action="retry_task"][data-control-scope="t1"]');
  state = await read(`return { phase: document.querySelector('.orch-tasks li:nth-child(2) code')?.dataset.phase, meta: document.querySelector('.orch-tasks li:nth-child(2) .orch-meta')?.textContent };`);
  history = await ledger();
  check("重试把任务放回队列并消耗一次尝试", state.phase === "queued" && state.meta.includes("尝试 2/2") && history.length === 3 && history[2].command.action === "retry_task", { state, last: history[2] });

  await pointerClick('[data-control-action="rollback_task"][data-control-scope="t2"]');
  history = await ledger();
  check("回滚第一次点只摆确认", (await buttonText('[data-control-action="rollback_task"][data-control-scope="t2"]')) === "确认回滚改动" && history.length === 3, { commands: history.length });
  await pointerClick('[data-control-action="rollback_task"][data-control-scope="t2"]');
  history = await ledger();
  check("第二次点才发回滚命令", history.length === 4 && history[3].command.action === "rollback_task" && history[3].command.task_id === "t2", history[3]);

  await pointerClick('[data-control-action="pause_plan"]');
  check("暂停计划把计划停在已暂停", (await read(`return document.querySelector('.orch-phase')?.dataset.phase;`)) === "paused", null);
  await pointerClick('[data-control-action="resume_plan"]');
  check("恢复计划回到已批准", (await read(`return document.querySelector('.orch-phase')?.dataset.phase;`)) === "approved", null);
  await pointerClick('[data-control-action="cancel_plan"]');
  await pointerClick('[data-control-action="cancel_plan"]');
  state = await read(`return { phase: document.querySelector('.orch-phase')?.dataset.phase, actions: document.querySelectorAll('.orch-plan > .orch-actions').length };`);
  check("取消计划两次后计划结束且不再摆动作", state.phase === "cancelled" && state.actions === 0, state);
  history = await ledger();
  check("每条命令都带 plan/version/request_id", history.every(item => item.command && item.command.plan_id === "plan-fixture" && item.command.version === 1 && typeof item.command.request_id === "string" && item.command.request_id.length > 36 - 1), history.map(item => item.command.action));
  await shot("03-cancelled");
  check("全程无控制台错误", errors.length === 0, errors);
  } catch (error) {
    // 中途断链也要留下逐条读数：红样本要能指向具体哪一格，而不是只有一句异常。
    check("交互序列按预期走完", false, String(error));
    history = await ledger().catch(() => history);
  }

  const passed = checks.filter((c) => c.ok).length;
  writeFileSync(join(out, "checks.json"), JSON.stringify({ passed, total: checks.length, checks, commands: history }, null, 2));
  console.log(`[orchestration-smoke] ${passed}/${checks.length} PASS · 证据 ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}

main().catch((error) => { console.error("[orchestration-smoke] FAILED:", error); app.exit(1); });
