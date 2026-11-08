import type { App, BrowserWindow } from "electron";

/** CAIRN_SMOKE：真窗口 + 真 IPC 回环的机器冒烟探针（从 index.ts 拆出以保持主装配根内聚）。 */
export function attachSmokeProbe(win: BrowserWindow, deps: { app: App; workspace: string }): void {
  const { app, workspace } = deps;
  const t0 = Date.now();
  win.webContents.on("console-message", (event) => {
    if (event.message.includes("[cairn-smoke]")) console.log("[renderer]", event.message);
  });
  win.webContents.on("did-finish-load", () => {
    const watchdog = setTimeout(() => {
      console.error("[cairn-smoke] watchdog：30s 未收束，强制退出");
      app.exit(1);
    }, 30_000);
    void win.webContents
      .executeJavaScript(`(() => {
        const api = window.agent;
        window.__cairn = { events: 0, asks: 0 };
        api.onEvent((e) => { window.__cairn.events++; if (window.__cairn.events <= 12) console.log("[cairn-smoke] event " + window.__cairn.events + ": " + (e && e.type)); });
        api.onAsk((p) => { window.__cairn.asks++; console.log("[cairn-smoke] ask -> approve: " + p.tool); api.decide(p.askId, true); });
        return typeof api;
      })()`)
      .then(async (agentType) => {
        console.log("[cairn-smoke] window.agent type:", agentType);
        const sessionId = await win.webContents.executeJavaScript(
          "window.agent.createSession().then((s) => s.id)",
        );
        console.log("[cairn-smoke] session:", sessionId);
        const queueProbe = (await win.webContents.executeJavaScript(
          `(async () => {
             await window.agent.queueSet(${JSON.stringify(sessionId)}, [{ text: "恢复探针", attachments: [] }]);
             const read = await window.agent.queueGet(${JSON.stringify(sessionId)});
             await window.agent.queueSet(${JSON.stringify(sessionId)}, []);
             const cleared = await window.agent.queueGet(${JSON.stringify(sessionId)});
             return { read, cleared };
           })()`,
        )) as { read?: { items?: { text?: string }[] }; cleared?: { items?: unknown[] } };
        console.log("[cairn-smoke] queue probe:", JSON.stringify(queueProbe));
        const chainFailed: string[] = [];
        const made = (await win.webContents.executeJavaScript(
          `window.agent.projectCreateFromTemplate({ name: "smoke-project", templateId: "static-site", parentDir: ${JSON.stringify(workspace)} })`,
        )) as { ok: boolean; path?: string; message?: string };
        const started = made.ok && typeof made.path === "string"
          ? ((await win.webContents.executeJavaScript(
              `window.agent.previewStart(${JSON.stringify(made.path)})`,
            )) as { status?: string; url?: string; stage?: string; message?: string })
          : undefined;
        let chainPageOk = false;
        let chainPageError = "";
        if (started?.status === "ready" && typeof started.url === "string") {
          try {
            const res = await fetch(started.url);
            const html = await res.text();
            chainPageOk = res.ok && html.length > 0;
          } catch (err) {
            chainPageOk = false;
            chainPageError = err instanceof Error ? err.message : String(err);
          }
        }
        const stopped = made.ok && typeof made.path === "string"
          ? ((await win.webContents.executeJavaScript(
              `window.agent.previewStop(${JSON.stringify(made.path)})`,
            )) as { status?: string })
          : undefined;
        console.log(
          "[cairn-smoke] product chain:",
          JSON.stringify({
            created: made.ok === true,
            preview: started?.status,
            stage: started?.stage,
            pageOk: chainPageOk,
            pageError: chainPageError || undefined,
            stopped: stopped?.status,
          }),
        );
        if (made.ok !== true) chainFailed.push(`模板建项失败：${made.message ?? "未知"}`);
        else if (started?.status !== "ready") chainFailed.push(`预览未就绪：${started?.status ?? "未知"} ${started?.message ?? ""}`);
        else if (!chainPageOk) chainFailed.push(`预览页面抓取失败：${started.url ?? ""}${chainPageError !== "" ? `（${chainPageError}）` : ""}`);
        else if (stopped?.status !== "stopped") chainFailed.push(`预览停止回执异常：${stopped?.status ?? "未知"}`);
        const thinkProbe = (await win.webContents.executeJavaScript(
          `(() => {
             const rows = [...document.querySelectorAll(".row.think")];
             const first = rows[0];
             if (!first) return { rows: 0 };
             const before = first.className;
             first.click();
             const after = first.className;
             return { rows: rows.length, before, after, clickable: before !== after,
                      hasElapsed: !!first.querySelector(".think-elapsed") };
           })()`,
        )) as { rows: number; before?: string; after?: string; clickable?: boolean; hasElapsed?: boolean };
        console.log("[cairn-smoke] think row:", JSON.stringify(thinkProbe));
        const idlePicker = (await win.webContents.executeJavaScript(
          `(async () => {
             const trig = document.querySelector('[aria-label="模型选择"]');
             if (!trig) return { found: false };
             const before = trig.getAttribute("title");
             const disabledBefore = trig.disabled === true;
             trig.click();
             await new Promise((r) => setTimeout(r, 120));
             const menu = document.querySelector('.mp-pop');
             const opts = menu ? [...menu.querySelectorAll('[role="option"]')] : [];
             const enabled = opts.filter((o) => !o.disabled);
             const pickTarget = enabled.find((o) => (o.textContent || "").indexOf("演示") < 0);
             let after = null;
             if (pickTarget) {
               pickTarget.click();
               for (let i = 0; i < 8 && after === null; i++) {
                 await new Promise((r) => setTimeout(r, 150));
                 const now = trig.getAttribute("title");
                 if (now !== before) after = now;
               }
               after = after ?? trig.getAttribute("title");
             }
             return {
               found: true, disabledBefore, opened: !!menu, options: opts.length, enabled: enabled.length,
               before, after, switched: after !== null && after !== before,
               pick: pickTarget ? (pickTarget.textContent || "").slice(0, 30) : null,
               saved: await window.agent.getSettings().then((x) => x.provider + "|" + x.model).catch((e) => "ERR:" + String(e)),
               errStrip: (() => { const d = document.querySelector(".error-strip"); return d ? (d.textContent || "").slice(0, 160) : null; })(),
             };
           })()`,
        )) as { found: boolean; disabledBefore?: boolean; opened?: boolean; options?: number; enabled?: number; before?: string | null; after?: string | null; switched?: boolean; pick?: string | null };
        console.log("[cairn-smoke] idle picker:", JSON.stringify(idlePicker));
        const run = (await win.webContents.executeJavaScript(
          `window.agent.run({ message: "demo", mode: "default", sessionId: ${JSON.stringify(sessionId)} })`,
        )) as { ok: boolean; error?: string };
        console.log("[cairn-smoke] run:", JSON.stringify(run));
        let events = -1;
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 200));
          const n = (await win.webContents.executeJavaScript("window.__cairn.events")) as number;
          if (n === events) break;
          events = n;
        }
        const asks = (await win.webContents.executeJavaScript("window.__cairn.asks")) as number;
        console.log("[cairn-smoke] events:", events, "asks auto-approved:", asks);
        let sidebarRows = 0;
        let sidebarClicked = false;
        let listed = -1;
        let sidebarText = "";
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 200));
          const probe = (await win.webContents.executeJavaScript(
            `(async () => {
               const rows = [...document.querySelectorAll(".side .session")];
               const t = rows.find((r) => r.getAttribute("data-session-id") === ${JSON.stringify(sessionId)});
               if (t) t.click();
               let listed = -1;
               try { listed = (await window.agent.listSessions()).length; } catch { listed = -2; }
               const aside = document.querySelector(".side");
               return { rows: rows.length, clicked: !!t, listed, text: (aside && aside.textContent) || "" };
             })()`,
          )) as { rows: number; clicked: boolean; listed: number; text: string };
          sidebarRows = probe.rows;
          sidebarClicked = probe.clicked;
          listed = probe.listed;
          sidebarText = probe.text;
          if (probe.clicked) break;
        }
        console.log("[cairn-smoke] ui sidebar rows:", sidebarRows, "clicked:", sidebarClicked, "listSessions:", listed, "text:", JSON.stringify(sidebarText));
        let pickerTitle: string | null = null;
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 200));
          const pickerProbe = (await win.webContents.executeJavaScript(
            `(async () => {
               const trig = document.querySelector('[aria-label="模型选择"]');
               if (!trig) return { found: false, title: null, options: -1, expanded: null, picked: null };
               const before = trig.getAttribute("title");
               const rect = trig.getBoundingClientRect();
               const cs = getComputedStyle(trig);
               const diag = {
                 count: document.querySelectorAll('[aria-label="模型选择"]').length,
                 tag: trig.tagName,
                 cls: trig.className,
                 disabledAttr: trig.hasAttribute("disabled"),
                 disabledProp: trig.disabled === true,
                 rect: [Math.round(rect.width), Math.round(rect.height), Math.round(rect.top)],
                 pointerEvents: cs.pointerEvents,
                 visible: cs.visibility + "/" + cs.display,
               };
               trig.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
               trig.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
               trig.click();
               await new Promise((r) => setTimeout(r, 120));
               const menu = document.querySelector('.mp-pop');
               const opts = menu ? [...menu.querySelectorAll('[role="option"]')] : [];
               const enabled = opts.filter((o) => !o.disabled);
               const picked = enabled.find((o) => (o.textContent || "").indexOf("演示") < 0);
               let afterTitle = null;
               if (picked) { picked.click(); await new Promise((r) => setTimeout(r, 120)); afterTitle = trig.getAttribute("title"); }
               return {
                 found: true,
                 diag,
                 title: before,
                 expanded: trig.getAttribute("aria-expanded"),
                 menuVisible: !!menu,
                 options: opts.length,
                 enabledOptions: enabled.length,
                 pickedLabel: picked ? (picked.textContent || "").slice(0, 40) : null,
                 afterTitle,
               };
             })()`,
          )) as Record<string, unknown>;
          console.log("[cairn-smoke] picker probe:", JSON.stringify(pickerProbe));
          pickerTitle = (pickerProbe.title as string | null) ?? null;
          if (pickerTitle) break;
        }
        console.log("[cairn-smoke] ui picker title:", pickerTitle);
        const failed: string[] = [];
        failed.push(...chainFailed);
        if (!run.ok) failed.push(`run ok:false${run.error ? `（${run.error}）` : ""}`);
        if (events < 1) failed.push(`事件计数 ${events} < 1`);
        if (queueProbe.read?.items?.[0]?.text !== "恢复探针" || queueProbe.cleared?.items?.length !== 0) {
          failed.push(`发送队列 IPC 往返失败：${JSON.stringify(queueProbe)}`);
        }
        if (!sidebarClicked) failed.push(`侧栏未定位到会话 ${sessionId} 的条目行（真点击路径没走通）`);
        if (sidebarRows < 1) failed.push(`侧栏条目计数 ${sidebarRows} < 1（新建会话没出现在侧栏）`);
        if (!pickerTitle || !pickerTitle.startsWith("模型：")) {
          failed.push(`ModelPicker 描述缺席或不合规：${JSON.stringify(pickerTitle)}`);
        }
        if (failed.length > 0) {
          console.error("[cairn-smoke] FAIL:", failed.join("；"));
          clearTimeout(watchdog);
          app.exit(1);
          return;
        }
        console.log("[cairn-smoke] PASS in", Date.now() - t0, "ms");
        clearTimeout(watchdog);
        app.quit();
      })
      .catch((err: unknown) => {
        console.error("[cairn-smoke] FAILED:", err instanceof Error ? err.message : String(err));
        clearTimeout(watchdog);
        app.exit(1);
      });
  });
}
