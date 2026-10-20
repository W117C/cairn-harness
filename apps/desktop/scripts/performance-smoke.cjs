// Electron 实测首屏、长会话打开与逐帧流式延迟。AgentApi 为合成夹具，非真实模型吞吐。
const { app, BrowserWindow, nativeTheme } = require('electron');
const { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const profile = mkdtempSync(join(tmpdir(), 'cairn-perf-profile-'));
app.setPath('userData', profile);
nativeTheme.themeSource = 'light';
app.on('quit', () => rmSync(profile, { recursive: true, force: true }));
// 预算面（帽 = 现状上取整；实测基线 p50 25–47ms / p95 37–91ms / max 39–108ms / 启动 266–553ms，
// 取料 outputs/desktop-performance-2026-10-20/runtime-*.json）。可用环境变量调
// （CI 机慢时把帽抬上去，而不是把闸删掉）。
const budgets={
  p95Ms:Number(process.env.CAIRN_PERF_P95_BUDGET_MS??200),
  maxMs:Number(process.env.CAIRN_PERF_MAX_BUDGET_MS??500),
  startupMs:Number(process.env.CAIRN_PERF_STARTUP_BUDGET_MS??1500),
};
const out = resolve(process.argv[2] ?? 'performance.json');
const turns = Number(process.argv[3] ?? 400);
const samples = Number(process.argv[4] ?? 40);
const pause = (ms) => new Promise(r => setTimeout(r, ms));
async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, '../../../src/main/ipc-protocol.ts'), 'utf8');
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf('export interface AgentApi');
  const body = protocol.slice(start, protocol.indexOf('\n}', start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s,i) => ({ name:s[1], isArray:/Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i+1]?.index??body.length)) }));
  const win = new BrowserWindow({ width:1440,height:900,show:false,webPreferences:{
    preload:join(__dirname,'ui-gallery-preload.cjs'),
    additionalArguments:['--cairn-api-members='+JSON.stringify(members),'--cairn-protocol-version='+version,'--cairn-performance-fixture','--cairn-performance-turns='+turns],
  }});
  const errors=[];
  win.webContents.on('console-message', d=>{if(d.level==='error')errors.push(d.message);});
  const js = source=>win.webContents.executeJavaScript(source);
  const waitFor = async (expression, timeout=20000) => {
    const started=performance.now();
    while(performance.now()-started < timeout) { if(await js(expression))return; await pause(5); }
    throw new Error('等待超时: '+expression);
  };
  const t0=performance.now();
  await win.loadFile(join(__dirname,'../dist/index.html'));
  await waitFor(`!!document.querySelector('.session') && !!document.querySelector('.composer-card textarea')`);
  const startupMs=performance.now()-t0;
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Performance.enable');
  const metrics = async () => Object.fromEntries((await win.webContents.debugger.sendCommand('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const startupMetrics=await metrics();
  const t1=performance.now();
  await js(`document.querySelector('.session').click()`);
  await waitFor(`document.querySelectorAll('.row.assistant').length === ${turns}`);
  await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const openMs=performance.now()-t1;
  const openMetrics=await metrics();
  await js(`(()=>{
    const el=document.querySelector('.composer-card textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'逐帧流式性能检查');
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await pause(50);
  // 同一发送链进入 running；后续增量每次等到 DOM 提交并绘制，禁止 React 合批伪造高吞吐。
  await js(`document.querySelector('.composer-card textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}))`);
  await waitFor(`document.querySelector('.row.assistant:last-of-type')?.textContent.includes('PERF-LIVE-0') || [...document.querySelectorAll('.row.assistant')].at(-1)?.textContent.includes('PERF-LIVE-0')`);
  const streamMetrics=await metrics();
  const runningStarted=await js(`document.querySelector('.gen-bar')?.dataset.running === 'true'`);
  const frames=[];
  for(let i=1;i<=samples;i++){
    const started=performance.now();
    await js(`window.__cairnPerf.step(${i})`);
    await waitFor(`[...document.querySelectorAll('.row.assistant')].at(-1)?.textContent.includes('PERF-LIVE-${i}')`);
    await js(`new Promise(r=>requestAnimationFrame(r))`);
    frames.push(performance.now()-started);
  }
  await js(`window.__cairnPerf.finish()`);
  const dom=await js(`({ nodes:document.querySelectorAll('*').length, users:document.querySelectorAll('.row.user').length, assistants:document.querySelectorAll('.row.assistant').length, tools:document.querySelectorAll('.tool-head').length, historyPresent:document.querySelector('[data-event-id="4"]')?.textContent.includes('模块 0'), lastPresent:document.querySelector('.reading').textContent.includes('PERF-LIVE-${samples}') })`);
  const sorted=[...frames].sort((a,b)=>a-b);
  const finalMetrics=await metrics();
  const metricDelta=(before,after)=>Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(key=>[key,(after[key]??0)-(before[key]??0)]));
  const report={turns,samples,startupMs,openMs,runningStarted,metrics:{open:metricDelta(startupMetrics,openMetrics),stream:metricDelta(streamMetrics,finalMetrics)},frameMs:{p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1),all:frames},dom,errors,budgets};
  mkdirSync(require('node:path').dirname(out),{recursive:true});
  writeFileSync(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  // 预算面（2026-10-20 独立评审追出，LOW-MEDIUM）：旧形状把 p50/p95/max 量出来就完事，
  // **退出码不看它们** ⇒ 一次 3× 的回归照样 exit 0（"量过了"读成"没变"）。
  const overBudget=[
    ...(report.frameMs.p95>budgets.p95Ms?[`帧时间 p95 ${report.frameMs.p95.toFixed(1)}ms > 帽 ${budgets.p95Ms}ms`]:[]),
    ...(report.frameMs.max>budgets.maxMs?[`帧时间 max ${report.frameMs.max.toFixed(1)}ms > 帽 ${budgets.maxMs}ms`]:[]),
    ...(report.startupMs>budgets.startupMs?[`启动 ${report.startupMs.toFixed(1)}ms > 帽 ${budgets.startupMs}ms`]:[]),
  ];
  if(overBudget.length>0) console.error('[performance-smoke] 超预算：'+overBudget.join('；'));
  app.exit(runningStarted && errors.length===0 && dom.historyPresent && dom.lastPresent && overBudget.length===0 ? 0:1);
}
setTimeout(()=>{console.error('performance-smoke 超时');app.exit(1);},90000).unref();
main().catch(e=>{console.error(e);app.exit(1);});
