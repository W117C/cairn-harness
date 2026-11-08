// Real renderer + synthetic AgentApi verification for the Agent OS shell.
// Build first:
//   pnpm --filter cairn-desktop build
//   ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/app-shell-smoke.cjs [output]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-agent-os-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });

const out = process.argv[2]
  ? resolve(process.argv[2])
  : mkdtempSync(join(tmpdir(), "cairn-agent-os-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((member, index) => ({
    name: member[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(member.index, starts[index + 1]?.index ?? body.length)),
  }));

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-agent-os-fixture",
        "--cairn-plugin-marketplace-fixture",
      ],
    },
  });

  const errors = [];
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") {
      errors.push(details.message);
      console.error("renderer:", details.message);
    }
  });

  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = (ms = 350) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
  const shot = async (name) => {
    await pause();
    writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG());
  };
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: ok === true, detail });
    console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  };
  const isVisible = (selector) => js(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  })()`);
  const click = async (selector) => {
    const clicked = await js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    await pause();
    return clicked;
  };
  const clickByText = async (selector, text) => {
    const clicked = await js(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => candidate.textContent?.trim().includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    await pause();
    return clicked;
  };
  const pressKey = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await pause(120);
  };
  const typeText = async (text) => {
    win.webContents.insertText(text);
    await pause(140);
  };
  const layoutState = () => js(`(() => {
    const page = [...document.querySelectorAll(".destination-page")]
      .find((candidate) => candidate.getAttribute("data-hidden") !== "true" && getComputedStyle(candidate).visibility !== "hidden")
      ?? document.querySelector(".destination-page");
    const rect = (el) => {
      if (!el) return null;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || box.width === 0 || box.height === 0) return null;
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const overlaps = (a, b) => a !== null && b !== null
      && a.left < b.right - 0.5 && a.right > b.left + 0.5
      && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    const rail = rect(document.querySelector(".app-rail"));
    const context = rect(document.querySelector(".workbench-sidebar .page-context-sidebar"));
    const pageBox = rect(page);
    const title = rect(page?.querySelector(".page-frame-title"));
    const actions = rect(page?.querySelector(".page-frame-actions"));
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      rects: { rail, context, page: pageBox, title, actions },
      overlapping: [
        ["rail", "context", overlaps(rail, context)],
        ["rail", "page", overlaps(rail, pageBox)],
        ["context", "page", overlaps(context, pageBox)],
        ["title", "actions", overlaps(title, actions)],
      ].filter((entry) => entry[2]).map((entry) => entry.slice(0, 2)),
    };
  })()`);
  const setFixtureMode = async (mode) => {
    await js(`window.__cairnAgentOs?.setMode(${JSON.stringify(mode)})`);
    await js(`(() => {
      const page = [...document.querySelectorAll(".destination-page")]
        .find((candidate) => candidate.getAttribute("data-hidden") !== "true");
      page?.querySelector('.page-frame button[aria-label="刷新"]')?.click();
    })()`);
    await pause(250);
  };
  const railState = () => js(`(() => ({
    items: [...document.querySelectorAll(".app-rail-item")].map(el => ({
      label: el.getAttribute("aria-label"),
      destination: el.getAttribute("data-destination"),
      current: el.getAttribute("aria-current"),
    })),
    currents: [...document.querySelectorAll('.app-rail-item[aria-current="page"]')].map(el => ({
      label: el.getAttribute("aria-label"),
      destination: el.getAttribute("data-destination"),
      className: el.className,
    })),
  }))()`);

  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, "../dist/index.html"));
  await pause(500);

  check("global rail is visible", await isVisible('[aria-label="全局功能"]'));
  check("exactly one destination is current", await js(`document.querySelectorAll('[aria-current="page"]').length === 1`), await js(`document.querySelectorAll('[aria-current="page"]').length`));
  let rail = await railState();
  check("chat is the startup destination", rail.items.some((item) => item.destination === "chat" && item.current === "page"), rail);

  await js(`document.querySelector('.side-filter-btn').focus()`);
  await pressKey("Down");
  check("sidebar filter opens with ArrowDown and focuses its first item", await js(`document.querySelector('.side-filter-menu.show') !== null && document.activeElement?.getAttribute('role') === 'menuitemradio'`));
  await pressKey("Escape");
  check("sidebar filter Escape returns focus to its trigger", await js(`!document.querySelector('.side-filter-menu.show') && document.activeElement?.classList.contains('side-filter-btn')`));

  check("plugins destination is reachable", await click('[data-destination="plugins"]'));
  check("plugins page is visible", await isVisible('.destination-page[aria-label="插件"]'));
  check("plugin view navigation appears once", await js(`document.querySelectorAll('.plugin-tabs').length === 1 && ![...document.querySelectorAll('.page-context-item')].some((item) => ['发现', '已安装', '可更新'].includes(item.textContent.trim()))`));
  check("chat workspace stays mounted and hidden", await js(`(() => {
    const el = document.querySelector(".chat-workspace");
    return !!el && el.getAttribute("data-hidden") === "true" && getComputedStyle(el).visibility === "hidden";
  })()`));
  rail = await railState();
  check("plugins becomes the only current destination", rail.currents.length === 1 && rail.currents[0]?.destination === "plugins", rail);
  await shot("01-desktop-light-plugins");

  let layout = await layoutState();
  check(
    "1440px rail, context, header, and actions do not overlap",
    layout.scrollWidth <= layout.width && layout.overlapping.length === 0,
    layout,
  );

  await js(`document.querySelector('.destination-page[aria-label="插件"] input[aria-label="搜索插件"]')?.focus()`);
  await typeText("Featured");
  check("plugin search accepts keyboard input", await js(`document.querySelector('.destination-page[aria-label="插件"] input[aria-label="搜索插件"]')?.value === "Featured"`));
  await click('.destination-page[aria-label="插件"] .plugin-store-main');
  check("plugin detail opens before destination switching", await isVisible('.destination-page[aria-label="插件"] .plugin-detail'));

  await click('[data-destination="memory"]');
  await js(`document.querySelector('input[aria-label="搜索记忆"]').focus()`);
  await typeText("长期记忆条目 24");
  check("memory search finds body content", await js(`document.querySelectorAll('.memory-grid .memory-card').length === 1 && document.querySelector('.memory-grid .nm')?.textContent === 'memory-24'`));
  await js(`document.querySelector('input[aria-label="搜索记忆"]').select()`);
  await pressKey("Backspace");
  check("clearing memory search restores every topic", await js(`document.querySelectorAll('.memory-grid .memory-card').length === 24`));
  const contrast = await js(`(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const luminance = (color) => {
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((c) => {
        const value = c / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const background = luminance(getComputedStyle(document.body).backgroundColor);
    const ratio = (color) => {
      const foreground = luminance(color);
      return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
    };
    const meta = getComputedStyle(document.querySelector('.memory-card-foot')).color;
    const placeholder = getComputedStyle(document.querySelector('input[aria-label="搜索记忆"]'), '::placeholder').color;
    return { metadata: ratio(meta), placeholder: ratio(placeholder) };
  })()`);
  check("light memory metadata and search placeholder meet 4.5:1 contrast", contrast.metadata >= 4.5 && contrast.placeholder >= 4.5, contrast);
  await shot("10-memory-list");
  await click('.memory-grid .memory-card');
  check("memory topic opens its own body and metadata", await js(`document.querySelector('.ap-drawer-head .nm')?.textContent === 'memory-01' && document.querySelector('.ap-drawer-body')?.textContent.includes('长期记忆条目 1')`));
  await shot("11-memory-detail");
  await click('.ap-drawer-head button');
  check("visited plugin page stays mounted and inert behind memory", await js(`(() => {
    const page = document.querySelector('.destination-page[data-destination-page="plugins"]');
    return !!page && page.getAttribute("data-hidden") === "true" && page.hasAttribute("inert");
  })()`));
  const memoryScroll = await js(`(() => {
    const page = document.querySelector('.destination-page[aria-label="记忆"]');
    if (!page) return 0;
    page.scrollTop = 240;
    return page.scrollTop;
  })()`);
  check("memory owns its own scroll container", memoryScroll > 0, memoryScroll);

  await click('[data-destination="plugins"]');
  check("plugin search and detail survive a trip to memory", await js(`(() => {
    const page = document.querySelector('.destination-page[aria-label="插件"]');
    return page?.querySelector('input[aria-label="搜索插件"]')?.value === "Featured"
      && page?.querySelector(".plugin-detail")?.textContent?.includes("Featured Plugin");
  })()`));
  await click('[data-destination="memory"]');
  check("memory scroll survives a trip to plugins", await js(`document.querySelector('.destination-page[aria-label="记忆"]')?.scrollTop >= 239`));

  await click('[data-destination="chat"]');
  check("all visited utility pages remain mounted while chat is active", await js(`(() => {
    const pages = [...document.querySelectorAll(".destination-page")];
    return pages.length >= 2 && pages.every((page) => page.getAttribute("data-hidden") === "true" && page.hasAttribute("inert"));
  })()`));
  await click('[data-destination="plugins"]');
  check("plugin search and detail survive a trip through chat", await js(`(() => {
    const page = document.querySelector('.destination-page[aria-label="插件"]');
    return page?.querySelector('input[aria-label="搜索插件"]')?.value === "Featured"
      && page?.querySelector(".plugin-detail")?.textContent?.includes("Featured Plugin");
  })()`));
  await click('[data-destination="memory"]');
  check("memory scroll survives a trip through chat", await js(`document.querySelector('.destination-page[aria-label="记忆"]')?.scrollTop >= 239`));
  await js(`(() => {
    const page = document.querySelector('.destination-page[aria-label="记忆"]');
    if (page) page.scrollTop = 0;
  })()`);

  await win.setContentSize(880, 640);
  check("880px memory destination is reachable", await click('[data-destination="memory"]'));
  check("880px memory page is visible", await isVisible('.destination-page[aria-label="记忆"]'));
  const narrowSwitcher = await js(`(() => {
    const sidebar = document.querySelector(".destination-page .page-context-sidebar") ?? document.querySelector(".workbench-sidebar .page-context-sidebar");
    const inline = document.querySelector(".destination-page .page-frame-filter");
    return {
      sidebar: sidebar ? getComputedStyle(sidebar).display : null,
      inline: inline ? getComputedStyle(inline).display : null,
      sidebarExists: !!sidebar,
      inlineExists: !!inline,
    };
  })()`);
  check(
    "narrow layout swaps rail context for inline filter",
    narrowSwitcher.sidebarExists && narrowSwitcher.sidebar === "none"
      && narrowSwitcher.inlineExists && narrowSwitcher.inline !== "none",
    narrowSwitcher,
  );
  layout = await layoutState();
  check(
    "880px rail, header, and actions do not overlap",
    layout.scrollWidth <= layout.width && layout.overlapping.length === 0,
    layout,
  );
  await shot("02-narrow-880-memory");

  await win.setContentSize(1120, 720);
  await pause();
  check("1120px restores the destination context sidebar", await isVisible(".workbench-sidebar .page-context-sidebar"));
  layout = await layoutState();
  check(
    "1120px rail, context, header, and actions do not overlap",
    layout.scrollWidth <= layout.width && layout.overlapping.length === 0,
    layout,
  );
  await shot("07-1120-memory-overlap");

  await win.setContentSize(1440, 900);
  await pause();
  check("automation destination is reachable", await click('[data-destination="automation"]'));
  check("automation page is visible", await isVisible('.destination-page[aria-label="自动化"] .page-frame-title'));
  await click('[data-destination="memory"]');
  nativeTheme.themeSource = "dark";
  await pause(500);
  check("dark theme reaches the renderer", await js(`document.documentElement.dataset.theme === "dark" || document.body.hasAttribute("data-ds-dark-theme")`), await js(`({ theme: document.documentElement.dataset.theme, bodyDark: document.body.hasAttribute("data-ds-dark-theme") })`));
  await shot("03-desktop-dark-memory");
  nativeTheme.themeSource = "light";
  await pause(400);

  await click('[data-destination="plugins"]');
  app.focus({ steal: true });
  win.show();
  win.focus();
  await pause(150);
  win.webContents.focus();
  await pressKey("K", ["meta"]);
  check("command palette opens from the real Meta+K input path", await isVisible(".cp-panel"));
  check("command palette focuses its search field", await js(`document.activeElement?.classList.contains("cp-input")`), await js(`({ tag: document.activeElement?.tagName, className: document.activeElement?.className })`));
  check("command palette lists the page group", await js(`[...document.querySelectorAll("[cmdk-group-heading]")].some(el => el.textContent === "页面")`));
  check("command palette lists all four destinations", await js(`(() => {
    const text = [...document.querySelectorAll(".cp-item .cp-label")].map(el => el.textContent);
    return ["对话", "插件", "记忆", "自动化"].every(label => text.includes(label));
  })()`));
  await typeText("记忆");
  check("real keyboard text filters the palette to memory", await js(`document.querySelector(".cp-item[aria-selected='true'] .cp-label")?.textContent === "记忆"`), await js(`document.querySelector(".cp-item[aria-selected='true'] .cp-label")?.textContent`));
  await pressKey("Enter");
  await pause(250);
  rail = await railState();
  check("keyboard destination selection opens memory", rail.currents.length === 1 && rail.currents[0]?.destination === "memory", rail);
  const focusedRail = await js(`(() => {
    const style = getComputedStyle(document.activeElement);
    return {
      destination: document.activeElement?.getAttribute("data-destination"),
      label: document.activeElement?.getAttribute("aria-label"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  })()`);
  check(
    "palette selection transfers visible keyboard focus to the active rail item",
    focusedRail.destination === "memory" && focusedRail.outlineStyle !== "none" && focusedRail.boxShadow !== "none",
    focusedRail,
  );
  await shot("04-keyboard-focus-memory");
  win.hide();

  await setFixtureMode("empty");
  check("empty memory snapshot remains distinct from loading", await js(`document.querySelector('.destination-page[aria-label="记忆"] .page-frame-title')?.textContent === "记忆" && document.querySelector('.destination-page[aria-label="记忆"]').innerText.includes("还没有记忆") && !document.querySelector('.destination-page[aria-label="记忆"]').innerText.includes("读取失败")`), await js(`document.querySelector('.destination-page[aria-label="记忆"]')?.innerText`));
  await shot("05-empty-memory");

  await setFixtureMode("error");
  check("snapshot read failure is visible inside the memory page", await js(`(() => {
    const page = document.querySelector('.destination-page[aria-label="记忆"]');
    return !!page
      && page.textContent.includes("读取失败")
      && page.querySelectorAll("h1").length === 1
      && !page.textContent.includes("还没有记忆");
  })()`), await js(`document.querySelector('.destination-page[aria-label="记忆"]')?.innerText`));
  await shot("06-read-error-memory");

  await click('[data-destination="automation"]');
  await setFixtureMode("operation-error");
  await click('.destination-page[aria-label="自动化"] .ap-item');
  check("automation operation target opens", await isVisible('.destination-page[aria-label="自动化"] .ap-drawer'));
  await clickByText('.destination-page[aria-label="自动化"] button', "立即运行");
  check("page operation failure is visible inside its destination", await js(`(() => {
    const page = document.querySelector('.destination-page[aria-label="自动化"]');
    const strip = page?.querySelector(".error-strip");
    return !!strip && getComputedStyle(strip).visibility !== "hidden" && strip.textContent?.includes("触发失败");
  })()`), await js(`document.querySelector('.destination-page[aria-label="自动化"] .error-strip')?.textContent`));
  await shot("08-operation-error-automation");

  await click('[data-destination="chat"]');
  check("page operation failure does not leak into chat", await js(`(() => {
    const chat = document.querySelector(".chat-workspace");
    return !!chat && !chat.querySelector(".error-strip") && ![...document.querySelectorAll(".error-strip")].some((strip) => {
      const box = strip.getBoundingClientRect();
      return getComputedStyle(strip).visibility !== "hidden" && box.width > 0 && box.height > 0;
    });
  })()`));
  await click('[data-destination="automation"]');
  check("destination retains its own operation failure", await isVisible('.destination-page[aria-label="自动化"] .error-strip'));
  await click('.destination-page[aria-label="自动化"] .error-strip button[aria-label="关闭错误提示"]');
  check("destination error can be dismissed", !(await isVisible('.destination-page[aria-label="自动化"] .error-strip')));

  // 2026-11-03 起设置入口并进账户菜单，旧的 .app-rail-settings 节点已不存在；
  // 用应用自己的键盘入口（⌘,）打开设置，避免依赖菜单层级。
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
  // 设置面板是惰性块：新增四个分区后首帧组装更慢，原断言在 nav 还没挂上时读到空串会假红。
  await pause(700);
  check("settings no longer contains durable destinations", await js(`(() => {
    const nav = document.querySelector('[aria-label="设置分区"]')?.textContent ?? "";
    return !nav.includes("插件") && !nav.includes("记忆系统") && !nav.includes("自动化任务")
      && nav.includes("技能中心") && nav.includes("工作树");
  })()`));
  check("settings skills section is reachable", await clickByText(".sp-nav-item", "技能中心"));
  await pause(500);
  const skillsFilter = await js(`(() => {
    const filter = document.querySelector('.sp-body .page-frame-filter');
    return filter ? {
      display: getComputedStyle(filter).display,
      inline: filter.classList.contains("page-frame-filter-inline"),
    } : null;
  })()`);
  check("settings skills keeps its filter visible without page context", skillsFilter?.display !== "none" && skillsFilter?.inline === true, skillsFilter);
  await shot("09-settings-skills-inline");
  await pressKey("Escape");
  check("renderer produced no console errors", errors.length === 0, errors);

  const result = {
    generatedAt: new Date().toISOString(),
    viewport: { desktop: "1440x900", medium: "1120x720", narrow: "880x640" },
    fixture: "synthetic AgentApi",
    themeStates: ["light", "dark"],
    screenshots: [
      "01-desktop-light-plugins.png",
      "02-narrow-880-memory.png",
      "03-desktop-dark-memory.png",
      "04-keyboard-focus-memory.png",
      "05-empty-memory.png",
      "06-read-error-memory.png",
      "07-1120-memory-overlap.png",
      "08-operation-error-automation.png",
      "09-settings-skills-inline.png",
    ],
    checks,
    failed: checks.filter((entry) => !entry.ok).length,
  };
  writeFileSync(join(out, "checks.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(`evidence: ${out}\nisolated profile: ${profile}`);
  app.exit(result.failed === 0 ? 0 : 1);
}

const watchdog = setTimeout(() => {
  console.error("app-shell-smoke: timeout");
  app.exit(1);
}, 45_000);
watchdog.unref();
main().catch((error) => {
  console.error(error);
  app.exit(1);
});
