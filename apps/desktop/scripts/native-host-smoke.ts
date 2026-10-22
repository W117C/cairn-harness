// 真实 Electron 浏览器与 PTY；仅访问自建回环 HTTP，不调用模型或用户 profile。
import { app, BrowserWindow, WebContentsView } from "electron";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BrowserHost, type BrowserState } from "../src/main/browser-host";
import { TerminalHost, type TerminalPush } from "../src/main/terminal-host";
const profile = mkdtempSync(join(tmpdir(), "cairn-native-host-"));
app.setPath("userData", profile);
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
const output = resolve(process.argv[2] ?? "native-host-smoke.json");
const waitFor = async (condition: () => boolean | Promise<boolean>, title: string): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < 10000) { if (await condition()) return; await new Promise(r=>setTimeout(r,20)); }
  throw new Error(`超时：${title}`);
};
async function main(): Promise<void> {
  console.log("native: waiting for Electron");
  await app.whenReady();
  console.log("native: Electron ready");
  const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
  let foreignHits = 0;
  const foreign = createServer((_req,res)=>{foreignHits++;res.end("foreign");});
  // 用另一个主机名访问自己控制的回环服务：不需要 macOS lo0 alias，也不触碰外网。
  // IPv4 映射 IPv6 地址可连到此服务，但不属于产品默认允许的 localhost/127.0.0.1/::1。
  await new Promise<void>((done,reject)=>{foreign.once("error",reject);foreign.listen(0,"127.0.0.1",done);});
  console.log("native: foreign loopback ready");
  const addr = foreign.address();
  if (addr === null || typeof addr === "string") throw new Error("本地地址未就绪");
  const foreignUrl = new URL(`http://[::ffff:127.0.0.1]:${addr.port}/blocked`).href;
  const server = createServer((req,res)=>{
    if(req.url === "/redirect") {res.writeHead(302,{location:foreignUrl});res.end();return;}
    res.setHeader("content-type","text/html; charset=utf-8");
    res.end('<!doctype html><title>Cairn Native</title><button id="target">真实浏览器测试</button>');
  });
  await new Promise<void>((done,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",done);});
  console.log("native: local loopback ready");
  const own = server.address();
  if (own === null || typeof own === "string") throw new Error("本地服务未就绪");
  const base = `http://127.0.0.1:${own.port}`;
  const mainWindow = new BrowserWindow({show:false,width:1000,height:700});
  const popup = new BrowserWindow({show:false,width:500,height:500});
  let owner = mainWindow;
  const states: BrowserState[] = [];
  const host = new BrowserHost(()=>owner,s=>states.push(s));
  const opened=host.open("real",base);
  check("真实浏览器视图可以打开",opened.ok);
  const wc=host.webContentsForAudit("real");
  if(wc===null)throw new Error("缺少真实 webContents");
  await waitFor(()=>!wc.isLoading()&&wc.getTitle()==="Cairn Native","浏览器加载");
  check("页面在隔离视图中实际执行",await wc.executeJavaScript(`document.querySelector('#target').textContent === '真实浏览器测试'`));
  check("远端页面权限默认拒绝",await wc.executeJavaScript("Notification.requestPermission()") === "denied");
  const view=mainWindow.contentView.children[0];
  if(view===undefined)throw new Error("视图未挂载");
  host.setBounds("real",{x:10,y:20,width:400,height:300});
  check("浏览器尺寸随面板同步",view.getBounds().width===400&&view.getVisible());
  host.setBounds("real",{x:0,y:0,width:0,height:0});
  check("收起面板隐藏原生视图",!view.getVisible());
  host.setBounds("real",{x:10,y:20,width:400,height:300});
  const pick=host.pickElement("real");
  await waitFor(()=>wc.executeJavaScript("window.__cairnPickActive === true"),"元素选择器启动");
  await wc.executeJavaScript(`document.querySelector('#target').click()`);
  const result=await pick;
  check("实际元素选择回传选择器与片段",result.ok&&result.selector==="#target"&&result.snippet?.includes("真实浏览器测试")===true,result);
  host.open("real",base+"/redirect");
  await waitFor(()=>states.some(s=>s.pending?.url===foreignUrl),"未授权跳转被拦截");
  check("未授权重定向没有发到目标服务",foreignHits===0&&wc.getURL()!==foreignUrl,{foreignHits});
  // 焦点换到另一窗口后关闭原视图，必须从实际宿主摘除并关闭 webContents。
  owner=popup;
  host.close("real");
  await new Promise(r=>setTimeout(r,100));
  check("窗口焦点变化后仍从原宿主释放视图",mainWindow.contentView.children.length===0&&wc.isDestroyed(),{children:mainWindow.contentView.children.length,destroyed:wc.isDestroyed()});
  // 后台弹窗恢复页面时，聚焦窗口仍可能是主窗；归属必须来自发起调用的窗口。
  owner=mainWindow;
  host.open("background-popup",base,popup);
  const background=host.webContentsForAudit("background-popup");
  check("后台弹窗页面挂到调用窗口而非聚焦窗口",popup.contentView.children.some(v=>v instanceof WebContentsView&&v.webContents===background)&&mainWindow.contentView.children.length===0);
  const foreignOwner=host.open("background-popup",base,mainWindow);
  check("另一个窗口不能复用已有视图 ID",!foreignOwner.ok);
  popup.destroy();
  await new Promise(r=>setTimeout(r,100));
  check("宿主窗口销毁时释放视图及登记",background?.isDestroyed()===true&&host.webContentsForAudit("background-popup")===null);
  const terminalEvents: TerminalPush[]=[];
  const terminal=new TerminalHost(e=>terminalEvents.push(e));
  const started=await terminal.start(profile,{...process.env,SHELL:"/bin/sh",ENV:"/dev/null"});
  check("真实 PTY 启动成功",started.ok);
  if(started.ok){
    terminal.write(started.id,"printf '\\344\\275\\240\\345\\245\\275 PTY-OUTPUT-ONLY\\n'\n");
    await waitFor(()=>terminalEvents.some(e=>e.kind==="data"&&e.data.includes("你好 PTY-OUTPUT-ONLY")),"PTY 中文输出");
    check("PTY 中文输出经过真实管道返回",terminalEvents.some(e=>e.kind==="data"&&e.data.includes("你好 PTY-OUTPUT-ONLY")));
    terminal.kill(started.id);
    await waitFor(()=>terminalEvents.some(e=>e.kind==="exit"&&e.id===started.id),"PTY 关闭");
    check("关闭终端后不可继续写入",!terminal.write(started.id,"echo after-close\n"));
  }
  terminal.killAll();host.closeAll();mainWindow.destroy();server.close();foreign.close();
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(checks,null,2));
  app.exit(checks.every(c=>c.ok)?0:1);
}
setTimeout(()=>{console.error("native-host-smoke 超时");app.exit(1);},45000).unref();
main().catch(error=>{console.error(error);app.exit(1);});
