// 真实 renderer + 生产 preload + Electron IPC + 真实 PTY；只在隔离配置里执行自建检查命令。
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { TerminalHost } from '../src/main/terminal-host';
import { INVOKE_CHANNELS, PUSH_CHANNELS } from '../src/main/channels';
import { IPC_PROTOCOL_VERSION } from '../../../src/main/ipc-protocol';

const profile = mkdtempSync(join(tmpdir(),'cairn-terminal-renderer-'));
app.setPath('userData',profile);
nativeTheme.themeSource='light';
app.on('window-all-closed',()=>{});
app.on('quit',()=>rmSync(profile,{recursive:true,force:true}));
const output=resolve(process.argv[2]??'terminal-renderer.json');
let activeHost: TerminalHost | null = null;
const checks:{name:string;ok:boolean;detail?:unknown}[]=[];
const check=(name:string,ok:boolean,detail?:unknown)=>{checks.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name}`);};
const waitFor=async(test:()=>boolean|Promise<boolean>,title:string,ms=15000)=>{
  const start=Date.now();
  while(Date.now()-start<ms){if(await test())return;await new Promise(r=>setTimeout(r,20));}
  throw new Error(`超时：${title}`);
};
async function main(){
  await app.whenReady();
  let reportedVersion=IPC_PROTOCOL_VERSION;
  let startupCwd=profile;
  const starts:string[]=[];
  const sizes:{id:string;cols:number;rows:number;ok:boolean}[]=[];
  const writes:{id:string;bytes:number}[]=[];
  const transcripts=new Map<string,string>();
  const exits=new Set<string>();
  const host=new TerminalHost(event=>{
    if(event.kind==='data') transcripts.set(event.id,(transcripts.get(event.id)??'')+event.data);
    else exits.add(event.id);
    for(const win of BrowserWindow.getAllWindows())win.webContents.send(
      PUSH_CHANNELS[event.kind==='data'?'onTerminalData':'onTerminalExit'],
      event.kind==='data'?{id:event.id,data:event.data}:{id:event.id,code:event.code},
    );
  });
  activeHost=host;
  app.on('will-quit',()=>host.killAll());
  ipcMain.handle(INVOKE_CHANNELS.getSettings,()=>({theme:'light'}));
  ipcMain.handle(INVOKE_CHANNELS.protocolVersion,()=>reportedVersion);
  ipcMain.handle(INVOKE_CHANNELS.terminalStart,async(event)=>{
    const owner=BrowserWindow.fromWebContents(event.sender);
    if(owner===null)return {ok:false,error:'调用窗口已关闭'};
    const result=await host.start(startupCwd,{...process.env,SHELL:'/bin/sh',ENV:'/dev/null'},owner);
    if(result.ok)starts.push(result.id);
    return result;
  });
  ipcMain.handle(INVOKE_CHANNELS.terminalResize,(_event,id:string,cols:number,rows:number)=>{
    const ok=host.resize(id,cols,rows);sizes.push({id,cols,rows,ok});return ok;
  });
  ipcMain.handle(INVOKE_CHANNELS.terminalWrite,(_event,id:string,data:string)=>{
    writes.push({id,bytes:Buffer.byteLength(data)});return host.write(id,data);
  });
  ipcMain.handle(INVOKE_CHANNELS.terminalKill,(_event,id:string)=>host.kill(id));
  const errors:string[]=[];
  const makeWindow=()=>{
    const window=new BrowserWindow({width:820,height:620,show:false,webPreferences:{
      preload:join(__dirname,'../dist-electron/preload.cjs'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,
    }});
    window.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});
    return window;
  };
  const win=makeWindow();
  const js=(code:string)=>win.webContents.executeJavaScript(code);
  await win.loadFile(join(__dirname,'../dist/index.html'),{hash:'pane=terminal'});
  await waitFor(()=>starts.length===1&&sizes.some(s=>s.id===starts[0]&&s.ok),'终端创建和初次尺寸同步');
  const id=starts[0];
  const text=()=>transcripts.get(id)??'';
  const type=async(command:string,target:BrowserWindow=win)=>{
    await target.webContents.executeJavaScript(`document.querySelector('.xterm-helper-textarea').focus()`);
    await target.webContents.insertText(command);
    target.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
    target.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  };
  const query=async(tag:string)=>{
    const prefix=Array.from(`UI_SIZE_${tag}:`).map(c=>'\\'+c.charCodeAt(0).toString(8).padStart(3,'0')).join('');
    await type(`printf '${prefix}'; stty size`);
    const pattern=new RegExp(`UI_SIZE_${tag}:(\\d+) (\\d+)`);
    await waitFor(()=>pattern.test(text()),`真实命令回传 ${tag}`);
    const found=text().match(pattern)!;
    const actual={rows:Number(found[1]),cols:Number(found[2])};
    const expected=sizes.filter(s=>s.id===id&&s.ok).at(-1)!;
    check(`${tag}：xterm 行列与内核 PTY 一致`,actual.rows===expected.rows&&actual.cols===expected.cols,{actual,expected});
    return expected;
  };
  const initial=await query('INITIAL');
  const resizeCount=sizes.length;
  win.setSize(500,400);
  await waitFor(()=>sizes.length>resizeCount&&sizes.at(-1)!.cols<initial.cols,'窄窗同步');
  const narrow=await query('NARROW');
  await type(`python3 -c 'import signal,sys,time; signal.signal(signal.SIGWINCH,lambda *_:(print("WINCH_RECEIVED",flush=True),sys.exit(0))); print("WINCH_READY",flush=True); time.sleep(10)'`);
  await waitFor(()=>/[\r\n]WINCH_READY\r?\n/.test(text()),'前台程序等待 SIGWINCH');
  win.setSize(1060,780);
  await waitFor(()=>sizes.at(-1)!.cols>narrow.cols&&/[\r\n]WINCH_RECEIVED\r?\n/.test(text()),'前台程序收到尺寸信号');
  check('改变面板尺寸时前台程序收到 SIGWINCH',true);
  await query('WIDE');
  await type(`python3 -c 'import time; print("INTERRUPT_READY",flush=True); time.sleep(30)'`);
  await waitFor(()=>/[\r\n]INTERRUPT_READY\r?\n/.test(text()),'前台命令确实已开始');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'C',modifiers:['control']});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'C',modifiers:['control']});
  await query('AFTER_SIGINT');
  check('Ctrl+C 中断前台命令后 shell 仍可用',true);
  // 双向大流量：前台程序边读边回显，能抓住“阻塞写入导致无法排空回显”的死锁。
  const payload='你好🌍'.repeat(16384);
  const bytes=Buffer.byteLength(payload);
  const digest=createHash('sha256').update(payload).digest('hex');
  const program=`import os,termios,tty,hashlib; old=termios.tcgetattr(0); tty.setraw(0); print("BULK_READY",flush=True); data=bytearray(); remaining=${bytes}\nwhile remaining:\n chunk=os.read(0,min(4096,remaining)); data.extend(chunk); remaining-=len(chunk); os.write(1,chunk)\ntermios.tcsetattr(0,termios.TCSANOW,old); print("\\nBULK_RESULT:"+str(len(data))+":"+hashlib.sha256(data).hexdigest(),flush=True)`;
  const encoded=Buffer.from(program).toString('base64');
  await type(`python3 -c 'import base64;exec(base64.b64decode("${encoded}"))'`);
  await waitFor(()=>/[\r\n]BULK_READY\r?\n/.test(text()),'大段输入检查就绪');
  await win.webContents.insertText(payload);
  await waitFor(()=>text().includes(`BULK_RESULT:${bytes}:${digest}`),'大段中文输入完整往返',25000);
  check('160KB 中文与 emoji 双向传输不死锁、不丢字节',text().includes(payload),{bytes,sha256:digest});
  await type('exit 7');
  await waitFor(()=>js(`document.querySelector('.term-pane')?.textContent.includes('code 7')`),'真实退出码上屏');
  check('shell 非零退出码显示正确，退出后可就地重启',await js(`!![...document.querySelectorAll('.term-pane button')].find(b=>b.textContent==='重新启动')`));
  await js(`[...document.querySelectorAll('.term-pane button')].find(b=>b.textContent==='重新启动').click()`);
  await waitFor(()=>starts.length===2&&sizes.some(s=>s.id===starts[1]&&s.ok),'重新启动并补初始尺寸');
  check('重新启动使用新会话并同步当前面板尺寸',starts[1]!==id&&sizes.filter(s=>s.id===starts[1]).at(-1)?.cols===sizes.filter(s=>s.id===id).at(-1)?.cols);
  const banner=Array.from('RESTART_UI_READY\n').map(c=>'\\'+c.charCodeAt(0).toString(8).padStart(3,'0')).join('');
  await type(`printf '${banner}'`);
  await waitFor(()=>js(`document.querySelector('.xterm-screen')?.textContent.includes('RESTART_UI_READY')`),'重启后的终端文字实际渲染');
  check('真实 PTY 输出已经画到终端视图',true);
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(join(dirname(output),'terminal-wide.png'),(await win.webContents.capturePage()).toPNG());
  win.destroy();
  const closed=!host.write(starts[1],'');
  check('关闭弹出窗口后终端立即不可写',closed);
  if(closed)await waitFor(()=>exits.has(starts[1]),'窗口关闭后真实 PTY 退出');
  check('窗口关闭后真实 PTY 进程已退出',exits.has(starts[1]));
  const count=starts.length;
  reportedVersion=IPC_PROTOCOL_VERSION-1;
  const old=makeWindow();
  await old.loadFile(join(__dirname,'../dist/index.html'),{hash:'pane=terminal'});
  await waitFor(()=>old.webContents.executeJavaScript(`document.body.textContent.includes('桌面协议版本不一致')`),'旧协议终端阻断');
  check('主进程协议不匹配时不启动 PTY，提示重启应用',starts.length===count);
  old.destroy();
  reportedVersion=IPC_PROTOCOL_VERSION;
  startupCwd=join(profile,'directory-that-does-not-exist');
  const broken=makeWindow();
  await broken.loadFile(join(__dirname,'../dist/index.html'),{hash:'pane=terminal'});
  let failureVisible=true;
  try { await waitFor(()=>broken.webContents.executeJavaScript(`document.body.textContent.includes('启动失败')`),'启动失败原因可见',3000); }
  catch { failureVisible=false; }
  check('工作目录消失时界面显示真实启动失败原因',failureVisible);
  await broken.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  writeFileSync(join(dirname(output),'terminal-startup-failure.png'),(await broken.webContents.capturePage()).toPNG());
  const canRetry=await broken.webContents.executeJavaScript(`!![...document.querySelectorAll('.term-pane button')].find(b=>b.textContent==='重新启动')`);
  check('启动失败后提供就地重启入口',canRetry);
  if(canRetry){
    startupCwd=profile;
    const beforeRestart=starts.length;
    await broken.webContents.executeJavaScript(`[...document.querySelectorAll('.term-pane button')].find(b=>b.textContent==='重新启动').click()`);
    await waitFor(()=>starts.length===beforeRestart+1&&sizes.some(s=>s.id===starts.at(-1)&&s.ok),'失败后的重新启动');
    const ready=Array.from('RECOVERY_OK\n').map(c=>'\\'+c.charCodeAt(0).toString(8).padStart(3,'0')).join('');
    await type(`printf '${ready}'`,broken);
    await waitFor(()=>broken.webContents.executeJavaScript(`document.querySelector('.xterm-screen')?.textContent.includes('RECOVERY_OK')`),'失败恢复后实际输入输出');
    check('启动失败后重启恢复真实输入输出',true);
  }
  broken.destroy();host.killAll();
  check('渲染过程无控制台错误',errors.length===0,errors);
  writeFileSync(output,JSON.stringify({checks,sizes,writes,protocolVersion:IPC_PROTOCOL_VERSION},null,2));
  app.exit(checks.every(c=>c.ok)?0:1);
}
setTimeout(()=>{console.error('terminal-renderer-smoke 超时');activeHost?.killAll();app.exit(1);},60000).unref();
main().catch(error=>{console.error(error);activeHost?.killAll();app.exit(1);});
