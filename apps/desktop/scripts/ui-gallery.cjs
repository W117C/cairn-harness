// UI 画廊（视觉自查专用，非产品组件）：离屏渲染 + capturePage 截六板块关键面。
// 为什么不用系统截屏：screencapture 走 TCC 录屏权限（会弹系统弹窗，不该由代理点）；
// Electron 自己的 capturePage 不需要任何权限。为什么造假 AgentApi：不跑真模型（不花钱、
// 不依赖 key），事件流用与判卷夹具同形的合成事件，专挑能看出版式的内容（markdown/代码/表格）。
// 用法：node scripts/ui-gallery.cjs  → 产物落 /tmp/cairn-gallery/*.png 后自退。
// 夹具（假 AgentApi 的**唯一事实源**）在 ui-gallery-preload.cjs——那里才是注入点。
// 本文件此前抄了一份同形的假 API 却没有传给 preload：一份永不执行的死副本，且随 AgentApi
// 演进而漂移（缺 projectTemplates 等），读代码的人会以为桩在这儿。已删除。
const { app, BrowserWindow } = require("electron");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OUT = "/tmp/cairn-gallery";
mkdirSync(OUT, { recursive: true });

// 桩的兜底名单从**真接口**推导（src/main/ipc-protocol.ts 的 AgentApi 成员），
// 而不是手抄：手抄的名单会随接口演进而漏，漏掉的那个在渲染层 mount 时抛 TypeError ⇒
// react 根节点空 ⇒ 截图全白，而脚本只报「done」，看不出是哪儿炸了。
// 真接口 → 名单 ⇒ 桩，三处永远同步。
// 协议版本也取自真接口（IPC_PROTOCOL_VERSION）：桩回 1 而渲染层期望 13 时，
// 渲染层会亮「协议版本失配」fatal 面——画廊要的是产品面，不是失配面。
const PROTOCOL = join(__dirname, "..", "..", "..", "src", "main", "ipc-protocol.ts");
function agentApiSurface() {
  const src = readFileSync(PROTOCOL, "utf8");
  const version = Number((src.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/) || [])[1]);
  if (!version) throw new Error("IPC_PROTOCOL_VERSION 未找到：" + PROTOCOL);
  const start = src.indexOf("export interface AgentApi");
  if (start < 0) throw new Error("AgentApi 接口未找到：" + PROTOCOL);
  const body = src.slice(start, src.indexOf("\n}", start));
  // 成员起点：两个空格缩进 + 标识符 + 括号/泛型。
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)].map((m) => ({
    name: m[1],
    at: m.index,
  }));
  const members = starts.map((s, i) => {
    // 该成员的声明文本 = 从它的起点到下一个成员起点。
    const decl = body.slice(s.at, starts[i + 1] ? starts[i + 1].at : body.length);
    // 返回类型是数组 ⇒ 兜底值给 []（渲染层会 .map 它，给 {} 会抛 "v.map is not a function"）。
    const isArray = /Promise<[^>]*\[\]/.test(decl);
    return { name: s.name, isArray };
  });
  return { version, members };
}

async function main() {
  await app.whenReady();
  // 看门狗：视觉自查工具卡死时不能把会话一直挂在这儿（此前一次跑到第 5 张就无声挂住）。
  const watchdog = setTimeout(() => {
    console.error("[gallery] 超时 90s：中途某步没返回，自退（EXIT 1）");
    app.exit(1);
  }, 90_000);
  watchdog.unref?.();
  const { version, members } = agentApiSurface();
  // preload 是 sandboxed 的独立进程：拿不到主进程对象，也 require 不到 node:fs
  // ⇒ 名单走 webPreferences.additionalArguments 交接（preload 读 process.argv）。
  const apiArgs = [
    "--cairn-api-members=" + JSON.stringify(members),
    "--cairn-protocol-version=" + version,
  ];
  console.log("[gallery] AgentApi 成员:", members.length, "协议版本:", version);
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: apiArgs,
    },
  });
  // 渲染层报错要看得见：此前脚本只截图不吐控制台，页面崩了也只得到一张全白图，
  // 排查得先猜「是 dist 陈旧还是渲染层抛错」。这里把 console 与未捕获异常都落到终端。
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[gallery:console] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[gallery:gone]", JSON.stringify(details));
  });
  win.webContents.on("preload-error", (_e, preloadPath, error) => {
    console.error("[gallery:preload]", preloadPath, error && error.message);
  });
  // 存储清理（默认开）：应用会「恢复上次会话」（localStorage），于是第二次跑画廊时
  // 01-empty 截到的不是空屏而是会话流——截图对不上场景，视觉自查就废了。
  // 要看「恢复上次会话」这一面时用 GALLERY_KEEP_STORAGE=1。
  if (process.env.GALLERY_KEEP_STORAGE !== "1") {
    await win.webContents.session.clearStorageData();
  }
  await win.loadFile(join(__dirname, "..", "dist", "index.html"));
  // 页面级错误收集：只报 "reading 'kind'" 不知道是谁读的 —— 装一个 error/unhandledrejection
  // 收集器，把栈留下来（渲染层抛错时控制台那行只有打包后的行号，没有可读的名字）。
  await win.webContents.executeJavaScript(`
    window.__galleryErrors = [];
    window.addEventListener("error", (e) => { window.__galleryErrors.push(String((e.error && e.error.stack) || e.message)); });
    window.addEventListener("unhandledrejection", (e) => { window.__galleryErrors.push(String((e.reason && e.reason.stack) || e.reason)); });
    true;
  `);
  // 渲染层抛错 ⇒ react 根节点空 ⇒ 截图全白。加载后立刻问一句「根里有没有东西」，
  // 白图当场有诊断，而不是等看图才发现。
  const rootChars = await win.webContents.executeJavaScript(
    `document.getElementById("root")?.innerHTML.length ?? -1`,
  );
  console.log("[gallery] root chars:", rootChars);
  if (process.env.GALLERY_DARK === "1") {
    // 深色自查：真应用由 main 按 nativeTheme 落 data-theme；画廊里直接注入等价属性。
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = "dark"`);
  }
  if (process.env.GALLERY_LIGHT === "1") {
    // 亮色自查：显式落 light，不吃系统主题（否则截图随机器的深浅色漂）。
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = "light"`);
  }
  const shot = async (name, ms = 500) => {
    await new Promise((r) => setTimeout(r, ms));
    const img = await win.webContents.capturePage();
    require("node:fs").writeFileSync(join(OUT, name), img.toPNG());
    console.log("[gallery]", name);
  };
  const js = (code) => win.webContents.executeJavaScript(code);

  await shot("01-empty.png", 1200);

  // 模型菜单（搜索 + 分组 + 徽标 + 管理入口）
  await js(`document.querySelector(".mp-trigger")?.click()`);
  await shot("02-model-menu.png", 400);

  // 思考分段控件（deepseek-chat 声明支持 ⇒ 可点开）
  await js(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))`);
  await js(`[...document.querySelectorAll(".ctl")].find(b=>b.getAttribute("aria-label")==="思考档位")?.click()`);
  await shot("03-thinking.png", 400);

  // 空态 pill 填入 composer
  await js(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))`);
  await js(`document.querySelector(".pill")?.click()`);
  await shot("04-composer-draft.png", 300);

  // 打开演示会话 → markdown 流 + 变更卡
  await js(`document.querySelector(".session")?.click()`);
  await shot("05-stream.png", 900);

  // 窄窗（产品 minWidth 880）：三窗格按钮收进 ⋮（CSS 收口 @media max-width:920px）。
  // 这一档此前只写在 CSS 里，没被看过。
  await win.setContentSize(880, 900);
  await shot("07-narrow.png", 700);

  // 长会话名：中栏带应收窄并省略，**不许滑到右组按钮底下**。
  // 直接改按钮文本 = 忠实模拟「会话名很长」这一形态（宽度计算与省略全走真 CSS）。
  await win.setContentSize(1440, 900);
  await js(`
    const b = document.querySelector(".tb-title");
    if (b) b.textContent = "把 routingBandit 与 routingCascade 的接线方式彻底理清并跑完全量验证再补一条用例";
    true;
  `);
  await shot("08-long-title.png", 500);

  // 高对比（prefers-contrast: more）：描边与最弱一档文字抬升。
  // Electron 的公开 API 没有 emulateMediaFeatures（只有 nativeTheme 管 prefers-color-scheme），
  // 这一档只能走 CDP 的 Emulation.setEmulatedMedia。
  try {
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-contrast", value: "more" }],
    });
    await shot("09-contrast.png", 400);
    // 自查：媒体查询到底有没有命中 + 描边有没有真的变强（不然这张图只是"看着没变"）。
    const contrastProbe = await win.webContents.executeJavaScript(`(() => {
      const mq = matchMedia("(prefers-contrast: more)").matches;
      const hair = getComputedStyle(document.documentElement).getPropertyValue("--hairline").trim();
      const side = document.querySelector(".side");
      return JSON.stringify({ mq, hair, sideBorder: side ? getComputedStyle(side).borderRightColor : null });
    })()`);
    console.log("[gallery] 高对比自查:", contrastProbe);
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
    win.webContents.debugger.detach();
  } catch (err) {
    console.error("[gallery] 高对比这一档没截成（CDP 不可用）：", err && err.message);
  }

  // 头像菜单（批 130：外观 / 用量统计 / 设置 / 关于）。
  // Radix 的触发器是 **pointerdown** 开菜单，不是 click ⇒ 得手动派发指针事件。
  // 下面两个helper产出的是**页面里求值**的代码字符串（不是 Node 侧函数）。
  const pointerClick = (expr) => `(() => {
    const el = ${expr};
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    return true;
  })()`;
  const byText = (sel, text) =>
    `[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.includes(${JSON.stringify(text)}))`;
  // Radix 的菜单靠**外部 pointerdown** 关 ⇒ 关菜单也得派指针事件，body.click() 不管用。
  const clickOutside = `(() => {
    const opts = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true };
    document.body.dispatchEvent(new PointerEvent("pointerdown", opts));
    document.body.dispatchEvent(new PointerEvent("pointerup", opts));
    return true;
  })()`;

  // ① 打开头像菜单（开着，后两档直接用它的开态 ⇒ 不靠 Esc 复位，避免「Esc 把整菜单关掉
  //    导致下一档点空」的竞态）。
  await js(pointerClick('document.querySelector(".avatar")'));
  await shot("10-avatar-menu.png", 600);

  // ② 用量统计面板（在开着的菜单里点）
  await js(pointerClick(byText(".pop-rd .menu-item", "用量统计")));
  await shot("11-usage-panel.png", 600);

  // 自查：面板有没有被推到窗口左缘外（上一版就是这样：标题行被裁掉）。
  const usageProbe = await win.webContents.executeJavaScript(`(() => {
    const p = document.querySelector(".usage-pop");
    const a = document.querySelector(".usage-anchor");
    const side = document.querySelector(".side-wrap");
    const r = (el) => el ? JSON.stringify(el.getBoundingClientRect()) : null;
    return JSON.stringify({
      panel: r(p), anchor: r(a), side: r(side),
      anchorParent: a ? a.parentElement.className : null,
      anchorPos: a ? getComputedStyle(a).position : null,
    });
  })()`);
  console.log("[gallery] 用量面板几何:", usageProbe);

  // ③ 外观子菜单（主题三选一，当前项打勾）：先关掉面板、重开菜单。
  await js(clickOutside);
  await new Promise((r) => setTimeout(r, 250));
  await js(pointerClick('document.querySelector(".avatar")'));
  await new Promise((r) => setTimeout(r, 350));
  await js(pointerClick(byText(".pop-rd .menu-item", "外观")));
  await shot("12-appearance-submenu.png", 600);
  await js(clickOutside);
  await new Promise((r) => setTimeout(r, 250));

  // 设置页 provider 分区（卡片网格 + 详情）
  // 选择器要跟真 DOM 对齐：设置入口在**头像菜单**里（批 130 起页脚不再有常驻设置钮），
  // 设置分区项是 .sp-nav-item（此前脚本写的是 .sidefooter .foot-btn / .sp-item —— 两个都不存在
  // ⇒ 这一张一直截的是上一张，视觉自查里设置页等于没被看过）。
  await js(pointerClick('document.querySelector(".avatar")'));
  await new Promise((r) => setTimeout(r, 400));
  await js(pointerClick(byText(".pop-rd .menu-item", "设置")));
  await new Promise((r) => setTimeout(r, 700));
  await js(`${byText(".sp-nav-item", "模型与 Provider")}?.click()`);
  await shot("06-settings-provider.png", 600);

  const errs = await win.webContents.executeJavaScript(`window.__galleryErrors ?? []`);
  if (Array.isArray(errs) && errs.length > 0) {
    console.error("[gallery] 页面内错误：");
    for (const e of errs) console.error("   ", String(e).split("\n").slice(0, 4).join("\n    "));
  }

  console.log("[gallery] done");
  app.exit(0);
}

main().catch((err) => { console.error("[gallery] FAIL", err); app.exit(1); });
