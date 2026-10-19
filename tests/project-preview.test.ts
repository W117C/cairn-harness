// 预览运行时判卷：静态服务的真实 HTTP 行为、失败分类（spec/prepare/start/ready）、停止回收。
// 判卷纪律与 CLAUDE 记录一致：临时目录 mkdtemp 唯一、绝不落工作区；假子进程注入，不依赖真 pnpm。
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_MANIFEST_REL } from "../src/main/project-templates";
import {
  PreviewRuntime,
  previewStatusText,
  serveStaticProject,
  isDirectHtmlFile,
  type PreviewChild,
  type PreviewChildExit,
} from "../src/main/project-preview";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "cairn-prev-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeManifest(root: string, kind: "static" | "vite"): void {
  mkdirSync(join(root, ".cairn"), { recursive: true });
  writeFileSync(join(root, PROJECT_MANIFEST_REL), JSON.stringify({ cairnProject: 1, templateId: "t", run: { kind } }), "utf8");
}

/** 可编程假子进程：退出时机由测试决定。 */
function fakeChild(): PreviewChild & { exit: (info: PreviewChildExit) => void; killed: string[] } {
  const cbs: ((info: PreviewChildExit) => void)[] = [];
  const killed: string[] = [];
  return {
    pid: 4242,
    kill: (signal) => { killed.push(signal ?? "SIGTERM"); },
    onExit: (cb) => { cbs.push(cb); },
    tail: () => "ERR_PNPM_NO_MATCHING_VERSION",
    exit: (info) => { for (const cb of cbs) cb(info); },
    killed,
  };
}

describe("单文件 HTML 直接预览（不需要 .cairn/project.json）", () => {
  // 动因（2026-10-15 桌面端会话读数）：agent 交付了一个仓库根上的单文件 HTML，
  // 点「打开预览」得到 spec 阶段失败 +「去用模板新建一个」——对一个已经写完的单文件交付物，
  // 那句建议是错的方向。静态服务本来就能serve任意文件，缺的只是入口认这条路。
  it("isDirectHtmlFile 只认 .html/.htm 文件（目录与别的文件都不算）", () => {
    const dir = tmp();
    const html = join(dir, "a.html");
    const htm = join(dir, "b.htm");
    const txt = join(dir, "c.txt");
    writeFileSync(html, "<h1>hi</h1>");
    writeFileSync(htm, "<h1>hi</h1>");
    writeFileSync(txt, "not html");
    expect(isDirectHtmlFile(html)).toBe(true);
    expect(isDirectHtmlFile(htm)).toBe(true);
    expect(isDirectHtmlFile(txt)).toBe(false);
    expect(isDirectHtmlFile(dir)).toBe(false);
    expect(isDirectHtmlFile(join(dir, "missing.html"))).toBe(false);
  });

  it("起预览直接 ready，URL 指向那个文件（不是目录根）", async () => {
    const dir = tmp();
    const html = join(dir, "demo.html");
    writeFileSync(html, "<!doctype html><title>t</title><h1>hello</h1>");
    const rt = new PreviewRuntime();
    const snap = await rt.start(html);
    expect(snap.status).toBe("ready");
    expect(snap.kind).toBe("static");
    expect(snap.url).toBeDefined();
    // URL 必须落在**那个文件**上：目录根下没有 index.html 时指根就是给用户看 404。
    expect(snap.url!.endsWith("/demo.html")).toBe(true);
    const res = await fetch(snap.url!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("hello");
    await rt.stop(html, "exit");
  });

  it("文件名带空格/中文也能serve（URL 编码，不让浏览器把它当成两段路径）", async () => {
    const dir = tmp();
    const html = join(dir, "我的 页面.html");
    writeFileSync(html, "<h1>spaced</h1>");
    const rt = new PreviewRuntime();
    const snap = await rt.start(html);
    expect(snap.status).toBe("ready");
    const res = await fetch(snap.url!);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("spaced");
    await rt.stop(html, "exit");
  });

  // 行为变更（2026-10-16，ADR 0004 受控纳管）：从前这一支是「缺清单就拒」；
  // 现在没有清单的目录先过诊断——空目录归 unsupported，失败文案改为点出缺什么（入口页）
  // 与下一步，.cairn/project.json 不再是唯一的认路牌。
  it("空目录：spec 失败，诊断点出缺入口页与下一步", async () => {
    const dir = tmp();
    const rt = new PreviewRuntime();
    const snap = await rt.start(dir);
    expect(snap.status).toBe("failed");
    expect(snap.stage).toBe("spec");
    expect(snap.message).toContain("index.html");
    expect(snap.hint).toBeTruthy();
  });
});

describe("serveStaticProject：静态预览的真实 HTTP 行为", () => {
  it("根路径回 index.html（text/html、no-store），嵌套文件按扩展名给 MIME", async () => {
    const root = tmp();
    writeFileSync(join(root, "index.html"), "<h1>hi</h1>", "utf8");
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "app.js"), "console.log(1)", "utf8");
    const server = await serveStaticProject(root);
    try {
      const index = await fetch(server.url);
      expect(index.status).toBe(200);
      expect(index.headers.get("content-type")).toContain("text/html");
      expect(index.headers.get("cache-control")).toBe("no-store");
      expect(await index.text()).toContain("hi");
      const js = await fetch(new URL("/assets/app.js", server.url));
      expect(js.headers.get("content-type")).toContain("text/javascript");
    } finally {
      await server.close();
    }
  });

  it("目录请求回落 index.html；缺失 404；穿越根目录 403", async () => {
    const root = tmp();
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "index.html"), "sub-index", "utf8");
    writeFileSync(join(root, "..", "__outside_probe.html"), "outside", "utf8");
    const server = await serveStaticProject(root);
    try {
      expect(await (await fetch(new URL("/sub/", server.url))).text()).toContain("sub-index");
      expect((await fetch(new URL("/nope.html", server.url))).status).toBe(404);
      const evil = await fetch(new URL("/..%2f..%2f__outside_probe.html", server.url));
      expect(evil.status).toBeGreaterThanOrEqual(400);
    } finally {
      await server.close();
      rmSync(join(root, "..", "__outside_probe.html"), { force: true });
    }
  });
});

describe("PreviewRuntime：状态机与失败分类", () => {
  it("static：起服务即 ready，停止后端口回收", async () => {
    const root = tmp();
    writeFileSync(join(root, "index.html"), "<p>ok</p>", "utf8");
    writeManifest(root, "static");
    const changes: string[] = [];
    const runtime = new PreviewRuntime({}, (s) => changes.push(s.status));
    const ready = await runtime.start(root);
    expect(ready.status).toBe("ready");
    expect(ready.url).toBeTruthy();
    expect(await (await fetch(ready.url ?? "")).text()).toContain("ok");
    const stopped = await runtime.stop(root);
    expect(stopped).toMatchObject({ status: "stopped", reason: "user" });
    await expect(fetch(ready.url ?? "")).rejects.toBeTruthy();
    expect(changes).toEqual(["starting", "ready", "stopped"]);
  });

  it("缺清单：spec 失败，带原因与下一步", async () => {
    const root = tmp();
    const runtime = new PreviewRuntime();
    const failed = await runtime.start(root);
    expect(failed).toMatchObject({ status: "failed", stage: "spec" });
    expect(failed.hint).toBeTruthy();
    expect(previewStatusText(failed)).toContain("spec");
  });

  it("vite：装依赖失败 ⇒ prepare 失败（带 stderr 尾巴），不会去起 dev server", async () => {
    const root = tmp();
    writeManifest(root, "vite");
    const calls: string[][] = [];
    const runtime = new PreviewRuntime({
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        const child = fakeChild();
        setTimeout(() => { child.exit({ code: 1, signal: null }); }, 0);
        return child;
      },
      sleep: async () => undefined,
      probe: async () => false,
      pickPort: async () => 45999,
      readyTimeoutMs: 5,
      probeIntervalMs: 1,
    });
    const failed = await runtime.start(root);
    expect(failed).toMatchObject({ status: "failed", stage: "prepare" });
    expect(failed.message).toContain("ERR_PNPM_NO_MATCHING_VERSION");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("pnpm");
    expect(calls[0]?.[1]).toBe("install");
    expect(calls[0]).toContain("--ignore-scripts");
  });

  it("vite：装依赖成功但起不来 ⇒ start 失败（早退原因不被就绪超时盖掉）", async () => {
    const root = tmp();
    writeManifest(root, "vite");
    let call = 0;
    const runtime = new PreviewRuntime({
      run: () => {
        call += 1;
        const child = fakeChild();
        if (call === 1) setTimeout(() => { child.exit({ code: 0, signal: null }); }, 0);
        else setTimeout(() => { child.exit({ code: 1, signal: null }); }, 0);
        return child;
      },
      sleep: async () => { await new Promise((r) => { setTimeout(r, 1); }); },
      probe: async () => false,
      pickPort: async () => 45998,
      readyTimeoutMs: 50,
      probeIntervalMs: 1,
    });
    const failed = await runtime.start(root);
    expect(failed).toMatchObject({ status: "failed", stage: "start" });
    expect(failed.message).toContain("退出码 1");
  });

  it("vite：pnpm 缺席（ENOENT）⇒ start 失败并点名安装 Node", async () => {
    const root = tmp();
    mkdirSync(join(root, "node_modules")); // 跳过 prepare，直接起 dev server
    writeManifest(root, "vite");
    const runtime = new PreviewRuntime({
      run: () => {
        const child = fakeChild();
        setTimeout(() => { child.exit({ code: null, signal: null, error: "spawn pnpm ENOENT" }); }, 0);
        return child;
      },
      // 真实 sleep 会给出宏任务间隙；假 sleep 若只回微任务，子进程退出事件永远排不上队。
      sleep: () => new Promise((r) => { setTimeout(r, 0); }),
      probe: async () => false,
      pickPort: async () => 45997,
      readyTimeoutMs: 5,
      probeIntervalMs: 1,
    });
    const failed = await runtime.start(root);
    expect(failed).toMatchObject({ status: "failed", stage: "start" });
    expect(failed.message).toContain("pnpm");
    expect(failed.hint).toContain("Node");
  });

  it("vite：装依赖成功 → 探活成功 ⇒ ready；停止时对子进程发 SIGTERM", async () => {
    const root = tmp();
    writeManifest(root, "vite");
    const children: ReturnType<typeof fakeChild>[] = [];
    let probes = 0;
    const runtime = new PreviewRuntime({
      run: () => {
        const child = fakeChild();
        children.push(child);
        if (children.length === 1) setTimeout(() => { child.exit({ code: 0, signal: null }); }, 0);
        return child;
      },
      sleep: async () => undefined,
      probe: async () => { probes += 1; return probes >= 2; },
      pickPort: async () => 45996,
      readyTimeoutMs: 10,
      probeIntervalMs: 1,
    });
    const ready = await runtime.start(root);
    expect(ready).toMatchObject({ status: "ready", port: 45996, kind: "vite" });
    expect(ready.url).toBe("http://127.0.0.1:45996/");
    await runtime.stop(root);
    expect(children[1]?.killed).toContain("SIGTERM");
  });

  it("stopAll：应用退出时把在跑的预览全部收掉", async () => {
    const root = tmp();
    writeFileSync(join(root, "index.html"), "x", "utf8");
    writeManifest(root, "static");
    const runtime = new PreviewRuntime();
    await runtime.start(root);
    await runtime.stopAll();
    expect(runtime.status(root)).toMatchObject({ status: "stopped", reason: "exit" });
  });
});

describe("已有目录的受控纳管（没有 .cairn/project.json 也能进）", () => {
  it("零依赖静态目录：诊断放行 ⇒ 直接 ready，URL 服务入口页；不写用户目录", async () => {
    const root = tmp();
    writeFileSync(join(root, "index.html"), "<p>imported</p>", "utf8");
    const runtime = new PreviewRuntime();
    const ready = await runtime.start(root);
    expect(ready).toMatchObject({ status: "ready", kind: "static" });
    expect(await (await fetch(ready.url ?? "")).text()).toContain("imported");
    expect(existsSync(join(root, ".cairn"))).toBe(false);
    await runtime.stop(root);
  });

  it("受控 Vite 目录：没有清单也走同一条 pnpm（--ignore-scripts）+ vite 受控启动", async () => {
    const root = tmp();
    writeFileSync(join(root, "index.html"), "<div id=root></div>", "utf8");
    writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { vite: "^7.0.0" } }), "utf8");
    const calls: string[][] = [];
    const children: ReturnType<typeof fakeChild>[] = [];
    let probes = 0;
    const runtime = new PreviewRuntime({
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        const child = fakeChild();
        children.push(child);
        if (children.length === 1) setTimeout(() => { child.exit({ code: 0, signal: null }); }, 0);
        return child;
      },
      sleep: async () => undefined,
      probe: async () => { probes += 1; return probes >= 2; },
      pickPort: async () => 45995,
      readyTimeoutMs: 10,
      probeIntervalMs: 1,
    });
    const ready = await runtime.start(root);
    expect(ready).toMatchObject({ status: "ready", kind: "vite" });
    expect(calls[0]?.[0]).toBe("pnpm");
    expect(calls[0]).toContain("--ignore-scripts");
    await runtime.stop(root);
    expect(children[1]?.killed).toContain("SIGTERM");
  });

  it("危险形态：vite 项目带 postinstall ⇒ spec 失败，点名脚本与下一步", async () => {
    const root = tmp();
    writeFileSync(join(root, "index.html"), "<div id=root></div>", "utf8");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { postinstall: "node x.mjs" }, devDependencies: { vite: "^7.0.0" } }),
      "utf8",
    );
    const runtime = new PreviewRuntime();
    const failed = await runtime.start(root);
    expect(failed).toMatchObject({ status: "failed", stage: "spec" });
    expect(failed.message).toContain("postinstall");
    expect(failed.hint).toBeTruthy();
  });

  it("差信息形态：只有 home.html ⇒ spec 失败，补法指向 index.html", async () => {
    const root = tmp();
    writeFileSync(join(root, "home.html"), "<h1>home</h1>", "utf8");
    const runtime = new PreviewRuntime();
    const failed = await runtime.start(root);
    expect(failed).toMatchObject({ status: "failed", stage: "spec" });
    expect(failed.message).toContain("home.html");
    expect(failed.hint).toContain("index.html");
  });
});
