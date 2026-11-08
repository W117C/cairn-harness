// Deterministic Electron smoke for the plugin marketplace workspace.
// It drives the built renderer through the real window.agent contract. Backend data is
// supplied by the explicit --cairn-plugin-marketplace-fixture preload flag.
// Build first: pnpm --filter cairn-desktop build
const { app, BrowserWindow, nativeTheme } = require("electron");
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const out = resolve(__dirname, "..", "outputs", "plugin-marketplace-2026-10-29");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "cairn-plugin-marketplace-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";

const checks = [];
const errors = [];
const pause = (ms = 220) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
const check = (name, ok, detail) => {
  checks.push({ name, ok: ok === true, detail });
  console.log(`${ok === true ? "PASS" : "FAIL"} ${name}${ok === true ? "" : " " + JSON.stringify(detail)}`);
};

async function main() {
  await app.whenReady();
  const watchdog = setTimeout(() => {
    console.error("[plugin-marketplace-smoke] watchdog timeout");
    cleanup();
    app.exit(1);
  }, 120_000);
  watchdog.unref?.();

  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const members = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)].map((member, index, all) => ({
    name: member[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(member.index, all[index + 1]?.index ?? body.length)),
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
        "--cairn-plugin-marketplace-fixture",
      ],
    },
  });
  win.webContents.on("console-message", (details) => {
    if (details.level !== "error") return;
    errors.push(details.message);
    console.error("[plugin-marketplace-smoke:renderer]", details.message);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    errors.push("render-process-gone:" + JSON.stringify(details));
  });

  const js = (source) => win.webContents.executeJavaScript(source, true);
  const waitFor = async (source, label, timeout = 8_000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await js(source)) return true;
      await pause(80);
    }
    throw new Error(`等待超时：${label}`);
  };
  const shot = async (name) => {
    await pause(280);
    writeFileSync(join(out, name), (await win.webContents.capturePage()).toPNG());
  };
  const click = async (selector) => {
    const clicked = await js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`找不到点击目标：${selector}`);
    await pause();
  };
  const clickText = async (selector, text) => {
    const clicked = await js(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => (candidate.textContent || "").includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`找不到文本目标：${selector} / ${text}`);
    await pause();
  };
  const focusAndClick = async (selector) => {
    const point = await js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("missing " + ${JSON.stringify(selector)});
      el.focus();
      const rect = el.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    await pause();
  };
  const press = async (keyCode) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
    await pause(160);
  };
  const setInput = async (selector, value) => {
    await js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("missing input " + ${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await pause(80);
  };
  const setSelect = async (selector, value) => {
    await js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("missing select " + ${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await pause(80);
  };
  const setTheme = async (theme) => {
    await js(`(() => {
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      document.documentElement.dataset.mode = ${JSON.stringify(theme)};
      document.body.dataset.dsDarkTheme = ${theme === "dark" ? '""' : "undefined"};
      if (${theme === "dark"}) document.body.dataset.dswDarkTheme = "";
      else { delete document.body.dataset.dswDarkTheme; }
    })()`);
    await pause(150);
  };
  const openPlugins = async () => {
    await click('[data-destination="plugins"]');
    await waitFor(`!!document.querySelector('.destination-page[data-destination-page="plugins"] .plugins-workspace')`, "plugins workspace");
    await pause(260);
  };
  const fixture = (method, ...args) => js(
    `window.__cairnPluginMarketplaceFixture[${JSON.stringify(method)}](${args.map((arg) => JSON.stringify(arg)).join(",")})`,
  );
  const refreshPlugins = async () => {
    await click('.destination-page[data-destination-page="plugins"] .page-frame button[aria-label="刷新"]');
    await pause(280);
  };

  await win.loadFile(join(__dirname, "..", "dist", "index.html"));
  await waitFor("!!document.querySelector('.app-rail')", "app rail");
  await openPlugins();

  check("protocol handshake matches source", await js(`window.agent?.protocolVersion()`) === version, version);
  check("discover is the default plugin view", await js(
    `document.querySelector('.plugins-workspace')?.getAttribute('data-marketplace-view') === 'discover'`,
  ));
  check("marketplace contains no fabricated social proof", !/(下载量|评分|热门)/u.test(
    await js(`document.querySelector('.plugins-workspace')?.innerText || ""`),
  ));
  check("live catalog renders real shelves and rows", await js(
    `document.querySelectorAll('.plugin-shelf').length >= 2 && document.querySelectorAll('[data-plugin-row="discover"]').length >= 2`,
  ));
  await shot("01-discover-1440-light.png");

  await setTheme("dark");
  await shot("02-discover-1440-dark.png");
  await setTheme("light");

  const featured = await js(`(() => {
    const row = document.querySelector('[data-plugin-row="discover"][data-plugin-id="featured-plugin"]');
    return !!row;
  })()`);
  check("featured plugin is discoverable", featured);

  await clickText(".plugin-tabs button", "已安装");
  await waitFor(`document.querySelector('.plugins-workspace')?.getAttribute('data-marketplace-view') === 'installed'`, "installed view");
  check("three source-bound installed rows are visible", await js(
    `document.querySelectorAll('[data-plugin-row="installed"]').length === 3`,
  ));
  win.setContentSize(1120, 760);
  await pause(300);
  const installedLayout = await js(`(() => {
    const rows = [...document.querySelectorAll('[data-plugin-row="installed"]')];
    const overlaps = rows.filter((row) => {
      const actions = row.querySelector('.plugin-row-actions')?.getBoundingClientRect();
      const main = row.querySelector('.plugin-operational-main')?.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      return !!actions && !!main && !!rowBox
        && (actions.left < main.right - 0.5 || actions.right > rowBox.right + 0.5 || actions.bottom > rowBox.bottom + 0.5);
    }).length;
    return { overlaps, scrollWidth: document.documentElement.scrollWidth, width: innerWidth };
  })()`);
  check("1120px installed rows keep actions inside their row", installedLayout.overlaps === 0 && installedLayout.scrollWidth <= installedLayout.width, installedLayout);
  await shot("03-installed-1120-light.png");

  const enabledLabel = await js(`!!document.querySelector('[aria-label="停用 catalog-installed"]')`);
  check("enabled plugin exposes an explicit disable action", enabledLabel);
  await click('[aria-label="停用 catalog-installed"]');
  await waitFor(`!!document.querySelector('[aria-label="启用 catalog-installed"]')`, "enable action after disable");
  check("disable round-trips through window.agent and refreshes the row", true);

  await clickText(".plugin-tabs button", "更新");
  await waitFor(`document.querySelector('.plugins-workspace')?.getAttribute('data-marketplace-view') === 'updates'`, "updates view");
  await clickText(".plugin-updates-toolbar button", "检查更新");
  await waitFor(`document.querySelectorAll('[data-plugin-row="update"]').length >= 2`, "update rows");
  const updateCount = await js(`document.querySelectorAll('[data-plugin-row="update"]').length`);
  const railBadge = await js(`document.querySelector('.app-rail-item[data-destination="plugins"] .app-rail-badge')?.textContent || ""`);
  check("real update count reaches the global rail", String(updateCount) === railBadge, { updateCount, railBadge });
  await setTheme("dark");
  await shot("04-updates-1120-dark.png");
  await setTheme("light");
  await click(
    '[data-plugin-row="update"][data-plugin-id="catalog-installed"] [aria-label^="更新 "]',
  );
  await waitFor(`!!document.querySelector('[data-plugin-state="review"]')`, "update review sheet");
  check("update action enters review as an update", (
    await js(`document.querySelector('[data-plugin-state="review"]')?.innerText || ""`)
  ).includes("更新审查"));
  await clickText(".plugin-review footer button", "取消");
  await waitFor(`!document.querySelector('[data-plugin-state="review"]')`, "update review cancelled");

  win.setContentSize(880, 720);
  await pause(300);
  await clickText(".plugin-tabs button", "发现");
  await click(".plugin-import-menu > .plugin-command");
  await clickText(".plugin-import-choices button", "Git 仓库");
  await setInput('.plugin-import-form input[type="url"]', "https://github.com/example/git-import");
  await setInput('.plugin-import-form input:not([type])', "main");
  await setSelect(".plugin-import-form select", "user");
  await clickText(".plugin-import-form button", "导入");
  await waitFor(`!!document.querySelector('[data-plugin-state="review"]')`, "review sheet");
  const reviewText = await js(`document.querySelector('[data-plugin-state="review"]')?.innerText || ""`);
  check("Git review shows provenance, digest, permissions, config, and risk", [
    "Git", "SHA-256", "未提供签名权限清单", "配置", "风险",
  ].every((text) => reviewText.includes(text)), reviewText.slice(0, 600));
  const reviewPrimaryBackground = await js(
    `getComputedStyle(document.querySelector('.plugin-review .plugin-primary')).backgroundColor`,
  );
  check(
    "review primary action has an opaque background",
    reviewPrimaryBackground !== "transparent" && reviewPrimaryBackground !== "rgba(0, 0, 0, 0)",
    reviewPrimaryBackground,
  );
  const sheetAt880 = await js(`(() => {
    const rect = document.querySelector('[data-plugin-state="review"]').getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: innerWidth, top: rect.top, scrollWidth: document.documentElement.scrollWidth };
  })()`);
  check("880px review uses the full-height sheet without horizontal overflow", sheetAt880.left <= 0.5 && sheetAt880.right >= sheetAt880.width - 0.5 && sheetAt880.scrollWidth <= sheetAt880.width, sheetAt880);
  await shot("05-review-880-light.png");
  const callsBeforeReviewEscape = await fixture("getCalls");
  const cancelsBeforeReviewEscape = callsBeforeReviewEscape
    .filter((call) => call.method === "marketplacePluginInstallCancel").length;
  await press("Escape");
  await waitFor(`!document.querySelector('[data-plugin-state="review"]')`, "review closed");
  const callsAfterReviewEscape = await fixture("getCalls");
  check("Escape closes review without cancelling the staged job", (
    callsAfterReviewEscape.filter((call) => call.method === "marketplacePluginInstallCancel").length
      === cancelsBeforeReviewEscape
  ));
  await waitFor(
    `(document.querySelector('[data-plugin-job-state="review"]')?.innerText || "").includes("继续审查")`,
    "closed review remains recoverable",
  );
  await clickText(".plugin-job button", "继续审查");
  await waitFor(`!!document.querySelector('[data-plugin-state="review"]')`, "review reopened");
  check("a closed review can be reopened without resolving the source again", true);
  await clickText(".plugin-review footer button", "取消");
  await waitFor(`!document.querySelector('[data-plugin-state="review"]')`, "review explicitly cancelled");
  check("explicit review cancellation still cancels the staged job", (
    (await fixture("getCalls")).filter((call) => call.method === "marketplacePluginInstallCancel").length
      === cancelsBeforeReviewEscape + 1
  ));

  await click(".plugin-import-menu > .plugin-command");
  await clickText(".plugin-import-choices button", "本地目录");
  await waitFor(`(document.querySelector('.plugin-import-path')?.textContent || "").includes("local-import")`, "local source picked");
  await setSelect(".plugin-import-form select", "user");
  await clickText(".plugin-import-form button", "导入");
  await waitFor(`!!document.querySelector('[data-plugin-state="review"]')`, "local review sheet");
  check("local import enters the same review sheet", (
    await js(`document.querySelector('[data-plugin-state="review"]')?.innerText || ""`)
  ).includes("本地目录"));
  await press("Escape");
  await waitFor(`!document.querySelector('[data-plugin-state="review"]')`, "local review closed");

  await waitFor(`!!document.querySelector('[data-plugin-id="featured-plugin"] [aria-label^="安装 "]')`, "catalog install action");
  await click('[data-plugin-id="featured-plugin"] [aria-label^="安装 "]');
  await waitFor(`!!document.querySelector('[data-plugin-state="review"]')`, "catalog review sheet");
  check("catalog install enters the same review sheet", (
    await js(`document.querySelector('[data-plugin-state="review"]')?.innerText || ""`)
  ).includes("官方目录"));
  await press("Escape");
  await waitFor(`!document.querySelector('[data-plugin-state="review"]')`, "catalog review closed");

  win.setContentSize(1440, 900);
  await refreshPlugins();
  await fixture("setCatalogMode", "cache");
  await refreshPlugins();
  await waitFor(`document.querySelector('[data-catalog-state="stale"]') !== null`, "offline cache");
  check("stale cache is labeled as offline cache", (
    await js(`document.querySelector('[data-catalog-state="stale"]')?.innerText || ""`)
  ).includes("离线缓存"));
  await shot("06-offline-1440-light.png");

  win.setContentSize(1120, 760);
  await fixture("setCatalogMode", "corrupt");
  await refreshPlugins();
  await waitFor(`document.querySelector('[data-catalog-state="unavailable"]') !== null`, "corrupt catalog");
  check("corrupt cache remains distinct from an empty catalog", (
    await js(`document.querySelector('[data-catalog-state="unavailable"]')?.innerText || ""`)
  ).includes("缓存损坏"));
  await setTheme("dark");
  await shot("07-corrupt-1120-dark.png");

  await fixture("setCatalogMode", "empty");
  await refreshPlugins();
  check("valid empty catalog is distinct from unavailable", (
    await js(`document.querySelector('.plugin-discover')?.innerText || ""`)
  ).includes("目录为空"));

  await fixture("setCatalogMode", "live");
  await refreshPlugins();
  win.setContentSize(880, 720);
  await setTheme("dark");
  const detailOrigin = await js(`(() => {
    const row = document.querySelector('[data-plugin-row="discover"][data-plugin-id="featured-plugin"]');
    const main = row?.querySelector('.plugin-discover-main');
    if (!main) return false;
    main.focus();
    main.click();
    return true;
  })()`);
  await waitFor(`!!document.querySelector('[data-plugin-state="detail"]')`, "detail sheet");
  check("detail opens from a discover row", detailOrigin);
  await shot("08-detail-880-dark.png");
  await press("Escape");
  const focusReturned = await js(`(() => {
    const active = document.activeElement;
    return active?.classList.contains('plugin-discover-main')
      && active.closest('[data-plugin-row="discover"]')?.getAttribute("data-plugin-id") === "featured-plugin";
  })()`);
  check("Esc returns focus to the originating plugin row", focusReturned);

  await setTheme("light");
  win.setContentSize(1440, 900);
  await js(`document.querySelector('.plugin-favorite')?.click()`);
  await waitFor(`document.querySelector('.plugin-favorite')?.getAttribute('aria-pressed') === 'true'`, "favorite set");
  const preReloadCalls = await fixture("getCalls");
  win.webContents.reload();
  await waitFor("!!document.querySelector('.app-rail')", "reload app");
  await openPlugins();
  check("favorite survives a renderer reload", await js(
    `[...document.querySelectorAll('.plugin-favorite')].some((button) => button.getAttribute('aria-pressed') === 'true')`,
  ));

  await clickText(".plugin-tabs button", "已安装");
  await waitFor(`document.querySelectorAll('[data-plugin-row="installed"]').length === 3`, "installed after reload");
  await click('[aria-label="卸载 local-installed"]');
  await waitFor(`!!document.querySelector('.confirm-card')`, "uninstall confirmation");
  await click('.confirm-card .cc-actions button.danger');
  await waitFor(
    `document.querySelectorAll('[data-plugin-row="installed"]:not([data-plugin-state="unmanaged"])').length === 2`,
    "managed installed after uninstall",
  );
  check("uninstall removes only the confirmed registry row", await fixture("installedCount") === 2);

  const accessibleActions = await js(`(() => {
    const controls = [...document.querySelectorAll('.plugins-workspace button, .plugin-sheet button')];
    return controls.filter((button) => {
      const name = (button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim();
      return name === '';
    }).length;
  })()`);
  check("all plugin actions have accessible names", accessibleActions === 0, accessibleActions);
  check("renderer console has no errors", errors.length === 0, errors);

  const postReloadCalls = await fixture("getCalls");
  const finalCalls = [...preReloadCalls, ...postReloadCalls];
  check("smoke exercised import, status, cancel, enable, update review, and uninstall through window.agent", [
    "marketplacePluginInstall",
    "marketplacePluginImport",
    "marketplacePluginInstallStatus",
    "marketplacePluginInstallCancel",
    "pluginSetEnabled",
    "marketplacePluginCheckUpdate",
    "marketplacePluginUpdate",
    "pluginUninstall",
  ].every((method) => finalCalls.some((call) => call.method === method)), finalCalls.map((call) => call.method));

  writeFileSync(join(out, "checks.json"), JSON.stringify({
    protocolVersion: version,
    fixtureData: true,
    checks,
    errors,
    calls: finalCalls,
    screenshots: [
      "01-discover-1440-light.png",
      "02-discover-1440-dark.png",
      "03-installed-1120-light.png",
      "04-updates-1120-dark.png",
      "05-review-880-light.png",
      "06-offline-1440-light.png",
      "07-corrupt-1120-dark.png",
      "08-detail-880-dark.png",
    ],
  }, null, 2));

  clearTimeout(watchdog);
  const ok = checks.every((entry) => entry.ok) && errors.length === 0;
  console.log(`[plugin-marketplace-smoke] ${ok ? "PASS" : "FAIL"} evidence=${out}`);
  win.destroy();
  cleanup();
  app.exit(ok ? 0 : 1);
}

function cleanup() {
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best-effort */ }
}

main().catch((error) => {
  console.error(error);
  writeFileSync(join(out, "failure.txt"), String(error?.stack || error));
  writeFileSync(join(out, "checks.json"), JSON.stringify({ checks, errors }, null, 2));
  cleanup();
  app.exit(1);
});
