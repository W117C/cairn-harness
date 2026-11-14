# 壁纸层与玻璃表面 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Cairn 桌面端对话界面背后加一层用户自选的本地图片/视频，并让压在它上面的五类界面成为玻璃，文字可读性有硬地板。

**Architecture:** 主进程是壁纸路径的唯一持有者（自定义协议 `cairn-wallpaper://` 只服务当前选中的那一个文件，渲染层不碰文件系统）；设置面持有 `wallpaper` 字段；渲染层由一个纯函数把设置投影成「壁纸视图」，组件按视图画媒体层与 scrim；玻璃表面用 `color-mix` 合成，地板权重由本仓自己的对比度模型**算出来**（不手抄），运行时写成 CSS 变量。

**Tech Stack:** Electron 44（`protocol.handle` / `custom protocol`）、React 18、Vite 8、TypeScript、vitest（桌面测试环境 = node，组件测试用 `renderToStaticMarkup`）。

**规格来源:** `docs/superpowers/specs/2026-11-14-wallpaper-layer-design.md`（提交 `d0376669`）。

## Global Constraints

- 不改插件边界（`src/agent/plugins/manifest.ts` 的 §9.8 零进程内第三方代码），不引入 Cordis。
- 不注册任何 agent 工具，不注入提示文本（零 token 开销）。
- 依赖方向：桌面层可 import `src/`，反向禁止；核心 `src/` 里不出现 Electron import。
- 渲染层分层纪律（`scripts/renderer-layer-check.ts`）：`components/**` 与 `panes/**` 不许 import `App.tsx`；`state/**` 不许 import `components/**`；`derived/**` 必须纯（无 IO、无时钟、无随机、无 await、无模块级可变态）；渲染层文件 ≤1200 行，`App.tsx` ≤900 行。
- `derived/**` 的运行时 import 只许白名单里的两个模块（`src/main/usage-ledger.ts`、`src/agent/subflow.ts`）⇒ **本计划的 derived 模块不 import 任何运行时模块**（只 type-only）。
- 新 CSS 只进我们自己的层：不改 `apps/desktop/src/renderer/vendor/**` 一字节；`cds-adapter.css` 必须仍是最后一个样式 import 之前的最后适配层。
- 色值只在 tokens 里写死；新 CSS 文件**零字面色值**，颜色一律走 CSS 变量（由 JS 从真实计算样式读出后写入）。
- 设置写入走既有 `window.agent.setSettings`；`AgentApi` 加方法必须同步在 `apps/desktop/src/main/channels.ts` 的 `INVOKE_CHANNELS` 加行，否则 typecheck 红。
- 主进程 `wired` 表缺 handler ⇒ 运行时抛错（`apps/desktop/src/main/index.ts`）；新增通道必须接真 handler。
- 验收线：玻璃面文字与背景的对比度 **≥ 4.5:1**，网格最差格达标。
- 无壁纸时渲染与今天逐像素一致（回归硬要求）。

---

## 文件结构

**新增**

| 文件 | 职责 |
|---|---|
| `apps/desktop/src/main/wallpaper.ts` | 协议注册、文件校验、Range 解析、媒体响应 |
| `apps/desktop/src/renderer/state/wallpaper.ts` | 壁纸视图投影 + 主题色读取 + CSS 变量落位 + 生命周期暂停 |
| `apps/desktop/src/renderer/components/WallpaperLayer.tsx` | 画媒体层与 scrim |
| `apps/desktop/src/renderer/derived/wallpaper-contrast.ts` | 纯对比度模型与地板求解 |
| `apps/desktop/src/renderer/wallpaper.css` | 画布让位 + 玻璃面 + 地板合成 |
| `tests/settings-wallpaper.test.ts` | 设置字段判卷（核心套件） |
| `apps/desktop/tests/wallpaper-media.test.ts` | 协议与文件校验判卷 |
| `apps/desktop/tests/wallpaper-view.test.ts` | 视图投影判卷 |
| `apps/desktop/tests/wallpaper-contrast.test.ts` | 地板求解判卷 |
| `apps/desktop/tests/wallpaper-layer.test.tsx` | 组件渲染判卷 |
| `apps/desktop/tests/wallpaper-settings-ui.test.tsx` | 设置行判卷 |

**修改**

| 文件 | 改什么 |
|---|---|
| `src/main/settings.ts` | `AppSettings.wallpaper` + 缺省 + 校验 |
| `src/main/ipc-protocol.ts` | `AgentApi.wallpaperPick` |
| `apps/desktop/src/main/channels.ts` | `INVOKE_CHANNELS.wallpaperPick` |
| `apps/desktop/src/main/index.ts` | 协议注册 + `wallpaperPick` handler + 媒体 handler |
| `apps/desktop/src/renderer/main.tsx` | 挂壁纸层 + import `wallpaper.css` + 启动落位 |
| `apps/desktop/src/renderer/components/settings/GeneralSection.tsx` | 壁纸行 |
| `apps/desktop/src/renderer/components/SettingsPanel.tsx` | 壁纸行接线 |
| `apps/desktop/src/renderer/strings-settings.ts` | 壁纸文案 |

---

### Task 1: 设置面加 `wallpaper` 字段与校验（核心层）

**Files:**
- Modify: `src/main/settings.ts`（`AppSettings` 接口尾部、`DEFAULT_SETTINGS`、`validateSettings` 返回体）
- Test: `tests/settings-wallpaper.test.ts`

**Interfaces:**
- Consumes: 无（起点任务）
- Produces:
  ```ts
  export type WallpaperKind = "none" | "image" | "video";
  export interface WallpaperSettings {
    kind: WallpaperKind;
    path: string | null;
    opacity: number;    // 0..1，壁纸自身不透明度
    scrim: number;      // 0..1，压暗强度
    glassAlpha: number; // 0..0.6，玻璃透明度（只改玻璃那一项，压不动地板）
    revision: number;   // 主进程单调自增，用于破浏览器缓存
  }
  export const WALLPAPER_KINDS: readonly WallpaperKind[];
  ```
  `AppSettings.wallpaper: WallpaperSettings`。

  另外在 `src/main/ipc-protocol.ts` 导出**共享**的媒体地址常量（主进程与渲染层都用它，
  免得两处各写一份字符串漂移）：

  ```ts
  /** 壁纸协议与媒体地址（2026-11-14 · 设计规格 §3.2）：主进程与渲染层共用一份。 */
  export const WALLPAPER_SCHEME = "cairn-wallpaper";
  export const WALLPAPER_MEDIA_URL = `${WALLPAPER_SCHEME}://media/current`;
  ```

- [ ] **Step 1: 写失败测试**

`tests/settings-wallpaper.test.ts`：

```ts
// 壁纸设置字段判卷（2026-11-14 · 设计规格 §3.4）：
// kind 白名单、path 与 kind 的从属、两个 0..1 滑杆、revision 单调整数。
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSettings } from "../src/main/settings";

describe("壁纸设置", () => {
  it("缺省是关的：kind=none、path=null", () => {
    expect(DEFAULT_SETTINGS.wallpaper.kind).toBe("none");
    expect(DEFAULT_SETTINGS.wallpaper.path).toBeNull();
    expect(validateSettings({}).wallpaper.kind).toBe("none");
    expect(validateSettings({}).wallpaper.path).toBeNull();
  });

  it("kind 白名单外回 none", () => {
    expect(validateSettings({ wallpaper: { kind: "scene" } }).wallpaper.kind).toBe("none");
    expect(validateSettings({ wallpaper: { kind: 7 } }).wallpaper.kind).toBe("none");
  });

  it("opacity / scrim 越界或非数回默认", () => {
    const bad = validateSettings({ wallpaper: { opacity: 1.5, scrim: -1 } }).wallpaper;
    expect(bad.opacity).toBe(DEFAULT_SETTINGS.wallpaper.opacity);
    expect(bad.scrim).toBe(DEFAULT_SETTINGS.wallpaper.scrim);
    const nan = validateSettings({ wallpaper: { opacity: Number.NaN } }).wallpaper;
    expect(nan.opacity).toBe(DEFAULT_SETTINGS.wallpaper.opacity);
  });

  it("kind=none 时路径归零（单一事实：有路径才有壁纸）", () => {
    expect(validateSettings({ wallpaper: { kind: "none", path: "/tmp/x.png" } }).wallpaper.path).toBeNull();
  });

  it("合法的图/视频原样保留", () => {
    const v = validateSettings({
      wallpaper: { kind: "video", path: "/tmp/a.mp4", opacity: 0.5, scrim: 0.2, revision: 3 },
    }).wallpaper;
    expect(v).toEqual({ kind: "video", path: "/tmp/a.mp4", opacity: 0.5, scrim: 0.2, revision: 3 });
  });

  it("revision 只认非负整数", () => {
    expect(validateSettings({ wallpaper: { revision: 1.5 } }).wallpaper.revision).toBe(0);
    expect(validateSettings({ wallpaper: { revision: -1 } }).wallpaper.revision).toBe(0);
    expect(validateSettings({ wallpaper: { revision: 7 } }).wallpaper.revision).toBe(7);
  });

  it("glassAlpha 上限 0.6（玻璃透明度不许超过这个档）", () => {
    expect(validateSettings({ wallpaper: { glassAlpha: 0.9 } }).wallpaper.glassAlpha).toBe(0.6);
    expect(validateSettings({ wallpaper: { glassAlpha: 0.3 } }).wallpaper.glassAlpha).toBe(0.3);
    expect(validateSettings({ wallpaper: { glassAlpha: -1 } }).wallpaper.glassAlpha).toBe(DEFAULT_SETTINGS.wallpaper.glassAlpha);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/settings-wallpaper.test.ts`
Expected: FAIL（`wallpaper` 不在 AppSettings 上，TS 编译错或断言失败）。

- [ ] **Step 3: 实现**

在 `src/main/settings.ts` 的 `AppSettings` 接口**末尾**（现有 `uiSize` 之后）加：

```ts
  /** 桌面端壁纸层（2026-11-14 · 设计规格 §3.4）：kind=none 即无壁纸。
   *  path 只在主进程与 settings.json 里；渲染层经 cairn-wallpaper:// 协议取媒体，不碰文件系统。 */
  wallpaper: WallpaperSettings;
```

在接口**之前**加类型：

```ts
/** 壁纸类型：none = 无壁纸；image / video = 用户自选的本地文件。 */
export type WallpaperKind = "none" | "image" | "video";

export interface WallpaperSettings {
  kind: WallpaperKind;
  path: string | null;
  opacity: number;
  scrim: number;
  revision: number;
}

export const WALLPAPER_KINDS: readonly WallpaperKind[] = ["none", "image", "video"];
```

`DEFAULT_SETTINGS` 末尾加：

```ts
  // 壁纸层默认关：功耗敏感项，不主动开（设计规格 §6）。
  wallpaper: { kind: "none", path: null, opacity: 1, scrim: 0.35, glassAlpha: 0.25, revision: 0 },
```

`validateSettings` 返回体末尾加一行，并加两个模块级 helper：

```ts
/** 0..1 的滑杆值：越界/非数回默认（与既有偏好校验同形：坏值不落库）。 */
function unitInterval(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

/** 玻璃透明度：0..1 再收到 0.6（玻璃再厚就压过可读性地板的余量）。 */
function glassAlphaOf(v: unknown, fallback: number): number {
  return Math.min(0.6, unitInterval(v, fallback));
}

/** 壁纸字段：kind 白名单、path 与 kind 从属、revision 非负整数。 */
function validateWallpaper(raw: unknown): WallpaperSettings {
  const d = DEFAULT_SETTINGS.wallpaper;
  if (typeof raw === "object" && raw !== null) {
    const r = raw as Record<string, unknown>;
    const kind = WALLPAPER_KINDS.includes(r.kind as WallpaperKind) ? (r.kind as WallpaperKind) : d.kind;
    const path =
      typeof r.path === "string" && r.path.trim() !== "" && r.path.length <= 4096 ? r.path : null;
    const revision =
      typeof r.revision === "number" && Number.isInteger(r.revision) && r.revision >= 0 ? r.revision : d.revision;
    return {
      kind,
      path: kind === "none" ? null : path,
      opacity: unitInterval(r.opacity, d.opacity),
      scrim: unitInterval(r.scrim, d.scrim),
      glassAlpha: glassAlphaOf(r.glassAlpha, d.glassAlpha),
      revision,
    };
  }
  return { ...d };
}
```

返回体加：

```ts
    wallpaper: validateWallpaper(r.wallpaper),
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm vitest run --config tests/vitest.config.ts tests/settings-wallpaper.test.ts`
Expected: PASS（6 条）。

- [ ] **Step 5: 跑核心类型检查**

Run: `node --import tsx scripts/typecheck.ts`
Expected: exit 0。

- [ ] **Step 6: 提交**

```bash
git add src/main/settings.ts tests/settings-wallpaper.test.ts
git commit -m "feat(desktop): 设置面加 wallpaper 字段与校验

kind 白名单 + path 与 kind 从属（kind=none ⇒ path 归零）+ 两个 0..1 滑杆 +
revision 非负整数。坏值一律回默认，不落库（与既有偏好校验同形）。"
```

---

### Task 2: 主进程壁纸服务（协议 + 文件校验 + IPC 通道）

**Files:**
- Create: `apps/desktop/src/main/wallpaper.ts`
- Modify: `src/main/ipc-protocol.ts`（`AgentApi` 加方法）、`apps/desktop/src/main/channels.ts`（`INVOKE_CHANNELS` 加行）、`apps/desktop/src/main/index.ts`（协议注册 + 两个 handler）
- Test: `apps/desktop/tests/wallpaper-media.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `WallpaperKind`
- Produces:
  ```ts
  // apps/desktop/src/main/wallpaper.ts
  export const WALLPAPER_SCHEME: "cairn-wallpaper";
  export function wallpaperKindOf(path: string): "image" | "video" | null;
  export interface WallpaperPickResult { ok: boolean; kind?: "image" | "video"; path?: string; error?: string; }
  export async function validateWallpaperFile(path: string): Promise<WallpaperPickResult>;
  export interface ByteRange { start: number; end: number; }  // end 闭区间
  export function parseByteRange(header: string | null, size: number): ByteRange | null;
  export async function handleWallpaperMedia(opts: {
    currentPath: string | null;
    range: string | null;
    open: (path: string, start: number, end: number) => ReadableStream<Uint8Array>;
  }): Promise<Response>;
  export function registerWallpaperScheme(register: (s: { scheme: string; privileges: Record<string, boolean> }) => void): void;
  ```
  ```ts
  // src/main/ipc-protocol.ts（AgentApi 内）
  wallpaperPick(): Promise<{ ok: boolean; kind?: "image" | "video"; path?: string; error?: string }>;
  ```

- [ ] **Step 1: 写失败测试**

`apps/desktop/tests/wallpaper-media.test.ts`：

```ts
// 壁纸媒体服务判卷（2026-11-14 · 设计规格 §3.2）：
// 扩展名分类、文件校验、Range 解析、协议只服务当前文件。
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  handleWallpaperMedia,
  parseByteRange,
  validateWallpaperFile,
  wallpaperKindOf,
} from "../src/main/wallpaper";

async function tempFile(name: string, bytes: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cairn-wallpaper-"));
  const p = join(dir, name);
  await writeFile(p, Buffer.alloc(bytes, 7));
  return p;
}

describe("壁纸媒体", () => {
  it("扩展名分类：图片/视频/其它", () => {
    expect(wallpaperKindOf("/a/b.png")).toBe("image");
    expect(wallpaperKindOf("/a/b.JPEG")).toBe("image");
    expect(wallpaperKindOf("/a/b.mp4")).toBe("video");
    expect(wallpaperKindOf("/a/b.webm")).toBe("video");
    expect(wallpaperKindOf("/a/b.txt")).toBeNull();
    expect(wallpaperKindOf("/a/b")).toBeNull();
  });

  it("校验：存在的图片通过，缺文件与错扩展名被拒", async () => {
    const p = await tempFile("a.png", 16);
    const ok = await validateWallpaperFile(p);
    expect(ok.ok).toBe(true);
    expect(ok.kind).toBe("image");
    expect(ok.path).toBe(p);
    const gone = await validateWallpaperFile(join(tmpdir(), "cairn-nope-xyz.png"));
    expect(gone.ok).toBe(false);
    expect(gone.error).toBeTruthy();
    const bad = await tempFile("a.txt", 4);
    const rejected = await validateWallpaperFile(bad);
    expect(rejected.ok).toBe(false);
  });

  it("Range 解析：闭区间、开放尾、越界与畸形", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=100-", 1000)).toEqual({ start: 100, end: 999 });
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange("bytes=abc", 1000)).toBeNull();
    expect(parseByteRange("bytes=2000-3000", 1000)).toBeNull();
    expect(parseByteRange("bytes=50-10", 1000)).toBeNull();
  });

  it("协议只服务当前选中的那一个文件", async () => {
    const p = await tempFile("a.mp4", 32);
    const open = (path: string, start: number, end: number): ReadableStream<Uint8Array> =>
      Readable.toWeb(Readable.from([Buffer.alloc(end - start + 1, 3)])) as ReadableStream<Uint8Array>;
    const none = await handleWallpaperMedia({ currentPath: null, range: null, open });
    expect(none.status).toBe(404);
    const ok = await handleWallpaperMedia({ currentPath: p, range: null, open });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-length")).toBe("32");
    const partial = await handleWallpaperMedia({ currentPath: p, range: "bytes=0-9", open });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 0-9/32");
    const bad = await handleWallpaperMedia({ currentPath: p, range: "bytes=999-", open });
    expect(bad.status).toBe(416);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/wallpaper-media.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `apps/desktop/src/main/wallpaper.ts`**

```ts
// 壁纸媒体服务（2026-11-14 · 设计规格 §3.2）：
//
// 主进程是壁纸路径的**唯一持有者**。渲染层永远拿不到文件系统：媒体经
// `cairn-wallpaper://media/current` 取，白名单 = 设置里当前那一个绝对路径，
// 其余请求 403/404。这条边界让「壁纸」不变成一条任意读文件的通道。
//
// Range：`<video>` 会发 Range 请求；不支持就会缓冲异常 ⇒ 解析 Range 并回 206。
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { WALLPAPER_SCHEME } from "../../../../src/main/ipc-protocol";

export { WALLPAPER_SCHEME };

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov"]);
export const WALLPAPER_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const WALLPAPER_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export type WallpaperMediaKind = "image" | "video";

export function wallpaperKindOf(path: string): WallpaperMediaKind | null {
  const ext = extname(path).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

export interface WallpaperPickResult {
  ok: boolean;
  kind?: WallpaperMediaKind;
  path?: string;
  error?: string;
}

export async function validateWallpaperFile(path: string): Promise<WallpaperPickResult> {
  const kind = wallpaperKindOf(path);
  if (kind === null) return { ok: false, error: "只支持图片或视频文件" };
  let size: number;
  try {
    const st = await stat(path);
    if (!st.isFile()) return { ok: false, error: "不是文件" };
    size = st.size;
  } catch {
    return { ok: false, error: "读不到文件" };
  }
  const cap = kind === "image" ? WALLPAPER_IMAGE_MAX_BYTES : WALLPAPER_VIDEO_MAX_BYTES;
  if (size > cap) {
    return { ok: false, error: kind === "image" ? "图片过大（上限 25MB）" : "视频过大（上限 2GB）" };
  }
  return { ok: true, kind, path };
}

export interface ByteRange {
  /** 闭区间起点。 */
  start: number;
  /** 闭区间终点。 */
  end: number;
}

/** 解析 `Range: bytes=a-b`；不支持的写法返回 null（调用方按 416 回）。 */
export function parseByteRange(header: string | null, size: number): ByteRange | null {
  if (header === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null) return null;
  const rawStart = m[1] ?? "";
  const rawEnd = m[2] ?? "";
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isInteger(start) || start < 0 || start >= size) return null;
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isInteger(end) || end < start) return null;
  return { start, end };
}

function contentTypeOf(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

/** 协议 handler：只服务 currentPath 那一个文件；其余一律 404。 */
export async function handleWallpaperMedia(opts: {
  currentPath: string | null;
  range: string | null;
  open: (path: string, start: number, end: number) => ReadableStream<Uint8Array>;
}): Promise<Response> {
  const path = opts.currentPath;
  if (path === null) return new Response("no wallpaper", { status: 404 });
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return new Response("wallpaper gone", { status: 404 });
  }
  const range = parseByteRange(opts.range, size);
  if (opts.range !== null && range === null) return new Response("bad range", { status: 416 });
  const type = contentTypeOf(path);
  if (range === null) {
    return new Response(opts.open(path, 0, size - 1), {
      status: 200,
      headers: {
        "content-type": type,
        "content-length": String(size),
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      },
    });
  }
  return new Response(opts.open(path, range.start, range.end), {
    status: 206,
    headers: {
      "content-type": type,
      "content-length": String(range.end - range.start + 1),
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    },
  });
}

/** 生产用的流工厂（测试注入假流，不碰真文件）。 */
export function openWallpaperStream(path: string, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
}

/** 必须在 app ready **之前**调用：让这个 scheme 拿到标准/安全 origin 语义。 */
export function registerWallpaperScheme(
  register: (entry: { scheme: string; privileges: { standard: boolean; secure: boolean; supportFetchAPI: boolean; stream: boolean; bypassCSP: boolean } }) => void,
): void {
  register({
    scheme: WALLPAPER_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  });
}
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/wallpaper-media.test.ts`
Expected: PASS（4 条）。

- [ ] **Step 5: 接 IPC 通道**

`src/main/ipc-protocol.ts` 的 `AgentApi` 里（`attachmentThumb` 那条附近）加：

```ts
  /** 桌面端壁纸：选一个本地图片/视频（设计规格 §3.3）。单选、带扩展名过滤；
   *  返回 kind 与绝对路径，**路径只留在主进程与 settings.json**，渲染层经协议取媒体。 */
  wallpaperPick(): Promise<{ ok: boolean; kind?: "image" | "video"; path?: string; error?: string }>;
```

`apps/desktop/src/main/channels.ts` 的 `INVOKE_CHANNELS` 里加一行：

```ts
  wallpaperPick: "agent:wallpaper-pick",
```

`apps/desktop/src/main/index.ts`：

1. **模块顶层**（`app.whenReady()` 之前，紧挨 import 区之后）注册 scheme：

```ts
// 壁纸协议必须在 app ready 之前登记（否则拿不到标准/安全 origin 语义）。
registerWallpaperScheme((entry) => { protocol.registerSchemesAsPrivileged([entry]); });
```

2. `app.whenReady().then(() => { ... })` 里注册 handler（`index.ts` 顶部 import
   `WALLPAPER_SCHEME`、`handleWallpaperMedia`、`openWallpaperStream`、`validateWallpaperFile`、
   `registerWallpaperScheme`）：

```ts
  // 壁纸媒体：只服务设置里当前那一个文件（白名单 = 当前路径）。
  protocol.handle(WALLPAPER_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "media" || url.pathname !== "/current") return new Response("not found", { status: 404 });
    const s = await getSettings();
    return handleWallpaperMedia({
      currentPath: s.wallpaper.kind === "none" ? null : s.wallpaper.path,
      range: request.headers.get("range"),
      open: openWallpaperStream,
    });
  });
```

3. `wired` 表里加 `wallpaperPick` handler（`dialog.showOpenDialog` 有「带窗口 / 不带窗口」两个重载，
   按窗口有没有分支，不要把 `undefined` 当窗口传）：

```ts
  wallpaperPick: async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const options = {
      title: "选择壁纸",
      properties: ["openFile" as const],
      filters: [
        { name: "图片与视频", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "webm", "mov"] },
      ],
    };
    const picked = win === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options);
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, error: "未选择文件" };
    return validateWallpaperFile(picked.filePaths[0]!);
  },
```

- [ ] **Step 6: 跑类型检查与桌面边界**

Run: `node --import tsx scripts/typecheck.ts`
Expected: exit 0（`INVOKE_CHANNELS` 缺行会在这里红）。

Run: `pnpm --filter cairn-desktop test`
Expected: 全绿（含既有 385 文件）。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/main/wallpaper.ts src/main/ipc-protocol.ts apps/desktop/src/main/channels.ts apps/desktop/src/main/index.ts apps/desktop/tests/wallpaper-media.test.ts
git commit -m "feat(desktop): 壁纸媒体服务与 wallpaperPick 通道

主进程是路径的唯一持有者：cairn-wallpaper:// 只服务当前选中的那一个文件，
其余 404；Range 请求回 206（<video> 会发 Range）。渲染层拿不到任意读文件能力。"
```

---

### Task 3: 渲染层壁纸视图与组件（含生命周期暂停）

**Files:**
- Create: `apps/desktop/src/renderer/state/wallpaper.ts`、`apps/desktop/src/renderer/components/WallpaperLayer.tsx`
- Modify: `apps/desktop/src/renderer/main.tsx`
- Test: `apps/desktop/tests/wallpaper-view.test.ts`、`apps/desktop/tests/wallpaper-layer.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `AppSettings.wallpaper`；Task 2 的协议 URL 形态
- Produces:
  ```ts
  // state/wallpaper.ts
  export const WALLPAPER_ATTR: "data-we-wallpaper";
  export interface WallpaperView { kind: "none" | "image" | "video"; url: string | null; }
  export function wallpaperUrl(revision: number): string;
  export function wallpaperViewOf(settings: AppSettings): WallpaperView;
  export function shouldPauseMedia(focused: boolean, visible: boolean): boolean;
  export function applyWallpaperAttr(active: boolean): void;
  export function useWallpaperView(): WallpaperView;
  export function setWallpaperView(view: WallpaperView): void;
  export function refreshWallpaper(): Promise<void>;
  export function bootWallpaper(): void;
  export function dropWallpaper(): void;
  ```
  ```tsx
  // components/WallpaperLayer.tsx
  export function WallpaperLayer(props: { view: WallpaperView }): React.JSX.Element | null;
  ```

- [ ] **Step 1: 写失败测试（纯投影）**

`apps/desktop/tests/wallpaper-view.test.ts`：

```ts
// 壁纸视图投影判卷（2026-11-14 · 设计规格 §3.5）：
// 设置 → 视图的投影是纯函数；kind=none ⇒ 无 URL；revision 进 URL 破缓存。
import { describe, expect, it } from "vitest";
import { shouldPauseMedia, wallpaperUrl, wallpaperViewOf } from "../src/renderer/state/wallpaper";
import { DEFAULT_SETTINGS, type AppSettings } from "../../src/main/settings";

function settingsWith(wallpaper: Partial<AppSettings["wallpaper"]>): AppSettings {
  return { ...DEFAULT_SETTINGS, wallpaper: { ...DEFAULT_SETTINGS.wallpaper, ...wallpaper } };
}

describe("壁纸视图投影", () => {
  it("无壁纸 ⇒ kind=none、无 URL", () => {
    const v = wallpaperViewOf(settingsWith({ kind: "none" }));
    expect(v.kind).toBe("none");
    expect(v.url).toBeNull();
  });

  it("图/视频 ⇒ URL 带 revision", () => {
    const v = wallpaperViewOf(settingsWith({ kind: "image", path: "/tmp/a.png", revision: 4 }));
    expect(v.kind).toBe("image");
    expect(v.url).toBe("cairn-wallpaper://media/current?v=4");
    expect(wallpaperUrl(0)).toBe("cairn-wallpaper://media/current?v=0");
  });

  it("kind 非 none 但没有 path ⇒ 视作无壁纸", () => {
    const v = wallpaperViewOf(settingsWith({ kind: "video", path: null }));
    expect(v.kind).toBe("none");
    expect(v.url).toBeNull();
  });

  it("暂停判据：失焦或不可见即停", () => {
    expect(shouldPauseMedia(true, true)).toBe(false);
    expect(shouldPauseMedia(false, true)).toBe(true);
    expect(shouldPauseMedia(true, false)).toBe(true);
    expect(shouldPauseMedia(false, false)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/wallpaper-view.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `state/wallpaper.ts`**

```ts
// 壁纸视图（2026-11-14 · 设计规格 §3.5）：
//
// 设置 → 视图的投影是**纯函数**（判卷面）；副作用只有两处：写 body 属性、写 CSS 变量。
// `data-we-wallpaper` 是 vendored 主题预留的接缝属性名（tokens.css 用
// `:not([data-we-wallpaper])` 让出 body/#root/对话列的画布）——唯一写者在本模块，
// 幂等，不留残值（参照仓踩过「行停用后 bundle 不再求值 ⇒ 残留没人清」的坑）。
//
// 注意依赖方向：渲染层**不 import 主进程模块**（apps/desktop/src/main/*）；协议地址
// 从共享的 src/main/ipc-protocol.ts 取常量。
import { useSyncExternalStore } from "react";
import { WALLPAPER_MEDIA_URL, type AppSettings } from "../../../../src/main/ipc-protocol";
import { floorFor, type Rgb, type ThemeContrastSpec } from "../derived/wallpaper-contrast";

/** vendored 主题的接缝属性名（不是我们发明的名字）。 */
export const WALLPAPER_ATTR = "data-we-wallpaper";

export interface WallpaperView {
  kind: "none" | "image" | "video";
  url: string | null;
}

export function wallpaperUrl(revision: number): string {
  return `${WALLPAPER_MEDIA_URL}?v=${String(revision)}`;
}

export function wallpaperViewOf(settings: AppSettings): WallpaperView {
  const w = settings.wallpaper;
  if (w.kind === "none" || w.path === null) return { kind: "none", url: null };
  return { kind: w.kind, url: wallpaperUrl(w.revision) };
}

/** 失焦或不可见 ⇒ 暂停视频（省电）。系统休眠时机器本就不跑，不另设通道。 */
export function shouldPauseMedia(focused: boolean, visible: boolean): boolean {
  return !focused || !visible;
}

export function applyWallpaperAttr(active: boolean): void {
  if (active) document.body.setAttribute(WALLPAPER_ATTR, "");
  else document.body.removeAttribute(WALLPAPER_ATTR);
}

/* ── 视图存储：面板改完设置后回灌这里（components → state 的允许方向）──────── */

let current: WallpaperView = { kind: "none", url: null };
const listeners = new Set<() => void>();

export function setWallpaperView(view: WallpaperView): void {
  current = view;
  applyWallpaperAttr(view.kind !== "none");
  for (const l of listeners) l();
}

export function subscribeWallpaper(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useWallpaperView(): WallpaperView {
  return useSyncExternalStore(subscribeWallpaper, () => current, () => current);
}

/** 改完设置后重读一次（唯一写者在主进程，渲染层只读）。 */
export async function refreshWallpaper(): Promise<void> {
  const s = await window.agent.getSettings();
  setWallpaperView(wallpaperViewOf(s));
  applyThemeVars(s);
}

/* ── 主题色 → CSS 变量：颜色从**真实计算样式**读出，零手抄 ────────────────── */

/** 解析 getComputedStyle 的 "rgb(r, g, b)" / "rgba(r, g, b, a)"。 */
export function parseRgb(value: string): Rgb | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (m === null) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

/**
 * 主题色真值：从 DOM 的**计算样式**读，而不是从 tokens 抄。
 *  · 画布 = documentElement 的计算 background-color（vendored 主题始终画 html 画布）；
 *  · 文字 = body 的计算 color（= --text-000）。
 * 读不到就返回 null（判卷环境无 DOM 时不该崩）。
 */
export function readThemeColors(): { canvas: Rgb; text: Rgb } | null {
  try {
    const canvas = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
    const text = parseRgb(getComputedStyle(document.body).color);
    if (canvas === null || text === null) return null;
    return { canvas, text };
  } catch {
    return null;
  }
}

/**
 * 把玻璃面要用的变量写到根元素：
 *  · --cw-canvas / --cw-text / --cw-glass / --cw-floor（地板百分比）/ --cw-glass-alpha
 * 地板权重由 derived 的对比度模型**算出来**（不手抄），所以换主题不用改常量。
 */
export function applyThemeVars(settings: AppSettings): void {
  const colors = readThemeColors();
  if (colors === null) return;
  const spec: ThemeContrastSpec = {
    text: colors.text,
    canvas: colors.canvas,
    glass: { r: 255, g: 255, b: 255 },
    worstWallpaper: colors.text.r > 128 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 },
  };
  const floor = floorFor(spec);
  const root = document.documentElement.style;
  root.setProperty("--cw-canvas", `rgb(${String(spec.canvas.r)} ${String(spec.canvas.g)} ${String(spec.canvas.b)})`);
  root.setProperty("--cw-text", `rgb(${String(spec.text.r)} ${String(spec.text.g)} ${String(spec.text.b)})`);
  root.setProperty("--cw-glass", "rgb(255 255 255 / var(--cw-glass-alpha))");
  root.setProperty("--cw-floor", `${String(Math.round(floor * 1000) / 10)}%`);
  root.setProperty("--cw-glass-alpha", String(settings.wallpaper.glassAlpha));
  root.setProperty("--cw-wallpaper-opacity", String(settings.wallpaper.opacity));
  root.setProperty("--cw-scrim", String(settings.wallpaper.scrim));
}

/** 媒体失效（404 / 解码失败）⇒ 撤层：只撤媒体，玻璃面留着（没有壁纸时它们是实体色）。 */
export function dropWallpaper(): void {
  setWallpaperView({ kind: "none", url: null });
}

/** 启动：读一次设置、落位属性与变量，并订阅主题变化重算地板。 */
export function bootWallpaper(): void {
  void refreshWallpaper().catch(() => undefined);
  try {
    const observer = new MutationObserver(() => {
      void window.agent.getSettings().then((s) => { applyThemeVars(s); }).catch(() => undefined);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-mode"] });
  } catch { /* 无 MutationObserver 的环境不重算 */ }
}
```

- [ ] **Step 4: 实现 `components/WallpaperLayer.tsx`**

```tsx
// 壁纸层（2026-11-14 · 设计规格 §3.5）：画媒体层与 scrim。
// 层在 #root 内、position: fixed、z-index: 0 ⇒ 压在 html 画布之上、应用壳之下
// （vendored 主题注释写明的层级）。不吃交互（pointer-events: none）。
import { useEffect, useRef, useState } from "react";
import { dropWallpaper, shouldPauseMedia, type WallpaperView } from "../state/wallpaper";

export function WallpaperLayer(props: { view: WallpaperView }): React.JSX.Element | null {
  const { view } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(false);

  // 生命周期：失焦 / 不可见即暂停（省电）；系统休眠时机器本就不跑，不另设通道。
  useEffect(() => {
    if (view.kind !== "video") return;
    const sync = (): void => { setPaused(shouldPauseMedia(document.hasFocus(), !document.hidden)); };
    window.addEventListener("blur", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      window.removeEventListener("blur", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [view.kind]);

  useEffect(() => {
    const el = videoRef.current;
    if (el === null) return;
    if (paused) el.pause();
    else void el.play().catch(() => undefined);
  }, [paused, view.url]);

  if (view.kind === "none" || view.url === null) return null;
  return (
    <div className="cw-layer" data-kind={view.kind} aria-hidden="true">
      {view.kind === "video"
        ? (
          <video
            ref={videoRef}
            className="cw-media"
            src={view.url}
            muted
            loop
            playsInline
            autoPlay
            onError={dropWallpaper}
          />
        )
        : <img className="cw-media" src={view.url} alt="" onError={dropWallpaper} />}
      <div className="cw-scrim" />
    </div>
  );
}
```

- [ ] **Step 5: 挂到 `main.tsx`**

在 `apps/desktop/src/renderer/main.tsx`：

1. import 段加：

```ts
import "./wallpaper.css";
import { bootWallpaper } from "./state/wallpaper";
import { WallpaperLayer } from "./components/WallpaperLayer";
```

`wallpaper.css` 必须排在 `cds-adapter.css` **之前**（适配层必须最后；`cds-parity` 钉着这条）。

2. `bootMotionPref();` 旁边加 `bootWallpaper();`。

3. 渲染树改成「根组件里取 hook」（hook 不能在条件分支里调）：

```tsx
/** 根组件：壁纸视图是 hook ⇒ 必须在组件里取，不能在 render 里按条件调。
 *  弹出窗格窗口（#pane=…）不挂壁纸层，也不设 data-we-wallpaper——
 *  否则 vendored 主题会在弹窗里也让掉画布，弹窗变成透明壳。 */
function Root(): React.JSX.Element {
  const view = useWallpaperView();
  const popout = parsePaneHash(window.location.hash);
  if (popout !== null) {
    return <PopoutApp kind={popout.kind} sessionId={popout.sessionId} workspace={popout.workspace} />;
  }
  return (
    <>
      <WallpaperLayer view={view} />
      <App />
      <ToastHost />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <RenderErrorBoundary variant="page">
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </RenderErrorBoundary>,
);
```

（原来的 `const popout = parsePaneHash(window.location.hash);` 与 `createRoot(...)` 那段整体替换。）

- [ ] **Step 6: 写组件渲染测试**

`apps/desktop/tests/wallpaper-layer.test.tsx`：

```tsx
// 壁纸层组件判卷（2026-11-14）：无壁纸不渲染；有视频时出 muted/loop 的 video。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WallpaperLayer } from "../src/renderer/components/WallpaperLayer";

describe("壁纸层", () => {
  it("无壁纸不渲染任何东西", () => {
    const html = renderToStaticMarkup(<WallpaperLayer view={{ kind: "none", url: null }} />);
    expect(html).toBe("");
  });

  it("图片壁纸出 img，src 走协议", () => {
    const html = renderToStaticMarkup(<WallpaperLayer view={{ kind: "image", url: "cairn-wallpaper://media/current?v=1" }} />);
    expect(html).toContain("cairn-wallpaper://media/current?v=1");
    expect(html).toContain("<img");
  });

  it("视频壁纸出 muted loop 的 video", () => {
    const html = renderToStaticMarkup(<WallpaperLayer view={{ kind: "video", url: "cairn-wallpaper://media/current?v=2" }} />);
    expect(html).toContain("<video");
    expect(html).toContain("muted");
    expect(html).toContain("loop");
  });
});
```

- [ ] **Step 7: 跑测试确认绿**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/wallpaper-view.test.ts tests/wallpaper-layer.test.tsx`
Expected: PASS（7 条）。

- [ ] **Step 8: 跑分层与类型检查**

Run: `pnpm renderer-layer-check`
Expected: 绿（`state/**` 不 import `components/**`；`derived/**` 无运行时 import）。

Run: `node --import tsx scripts/typecheck.ts`
Expected: exit 0。

- [ ] **Step 9: 提交**

```bash
git add apps/desktop/src/renderer/state/wallpaper.ts apps/desktop/src/renderer/components/WallpaperLayer.tsx apps/desktop/src/renderer/main.tsx apps/desktop/tests/wallpaper-view.test.ts apps/desktop/tests/wallpaper-layer.test.tsx src/main/settings.ts tests/settings-wallpaper.test.ts
git commit -m "feat(desktop): 壁纸层组件与视图投影

挂点在 #root 内的第一个子节点（压在 html 画布之上、壳之下）；弹出窗格窗口不挂。
失焦/不可见即暂停视频。主题色从真实计算样式读出⇒CSS 变量零手抄。"
```

---

### Task 4: 玻璃表面与可读性地板（模型 + 样式）

**Files:**
- Create: `apps/desktop/src/renderer/derived/wallpaper-contrast.ts`、`apps/desktop/src/renderer/wallpaper.css`
- Test: `apps/desktop/tests/wallpaper-contrast.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `applyThemeVars`（要 `--cw-floor` 等变量）
- Produces:
  ```ts
  // derived/wallpaper-contrast.ts
  export interface Rgb { r: number; g: number; b: number; }
  export function mix(a: Rgb, b: Rgb, t: number): Rgb;
  export function relativeLuminance(c: Rgb): number;
  export function contrastRatio(a: Rgb, b: Rgb): number;
  export function glassSurface(prev: Rgb, glass: Rgb, glassAlpha: number, canvas: Rgb, floor: number): Rgb;
  export interface ThemeContrastSpec { text: Rgb; canvas: Rgb; glass: Rgb; worstWallpaper: Rgb; }
  export const LIGHT_SPEC: ThemeContrastSpec;
  export const DARK_SPEC: ThemeContrastSpec;
  export const CONTRAST_TARGET: number;      // 4.5
  export function worstContrast(spec: ThemeContrastSpec, floor: number): number;
  export function floorFor(spec: ThemeContrastSpec): number;
  ```

- [ ] **Step 1: 写失败测试**

`apps/desktop/tests/wallpaper-contrast.test.ts`：

```ts
// 可读性地板判卷（2026-11-14 · 设计规格 §5.3）：
// 地板 = 固定权重的主题底色压在玻璃色之上；滑杆只能改玻璃那一项 ⇒ 压不下去。
// 数值**算出来**，不手抄参照仓的权重。
import { describe, expect, it } from "vitest";
import {
  CONTRAST_TARGET,
  DARK_SPEC,
  LIGHT_SPEC,
  contrastRatio,
  floorFor,
  glassSurface,
  mix,
  worstContrast,
} from "../src/renderer/derived/wallpaper-contrast";

describe("可读性地板", () => {
  it("地板权重算得出来，且网格最差格 ≥ 4.5:1", () => {
    for (const spec of [LIGHT_SPEC, DARK_SPEC]) {
      const floor = floorFor(spec);
      expect(floor).toBeGreaterThan(0);
      expect(worstContrast(spec, floor)).toBeGreaterThanOrEqual(CONTRAST_TARGET);
      // 再降一格就破线 ⇒ 说明这是最小地板（滑杆压不动它）
      if (floor > 0.01) expect(worstContrast(spec, floor - 0.01)).toBeLessThan(CONTRAST_TARGET);
    }
  });

  it("地板越大约束越紧：floor=1 时表面就是画布色", () => {
    const s = glassSurface({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 }, 0.6, DARK_SPEC.canvas, 1);
    expect(s.r).toBeCloseTo(DARK_SPEC.canvas.r, 6);
    expect(s.g).toBeCloseTo(DARK_SPEC.canvas.g, 6);
    expect(s.b).toBeCloseTo(DARK_SPEC.canvas.b, 6);
  });

  it("玻璃透明度 0 时地板独立起作用", () => {
    const prev = mix(LIGHT_SPEC.canvas, LIGHT_SPEC.worstWallpaper, 0.9);
    const s = glassSurface(prev, LIGHT_SPEC.glass, 0, LIGHT_SPEC.canvas, 0.5);
    expect(s.r).toBeGreaterThan(prev.r);
  });

  it("对比度口径：黑对白 = 21", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/wallpaper-contrast.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `derived/wallpaper-contrast.ts`**

```ts
// 可读性地板的纯模型（2026-11-14 · 设计规格 §5.3）。
//
// 机制抄参照仓（dsh-wallpaper-engine）：承载文字的面 =
//   color-mix(in srgb, 画布色 floor%, 玻璃色 (1-floor)%)
// 地板是**固定权重**，滑杆只改玻璃那一项 ⇒ 地板压不下去 ⇒ 对比度有下界。
// 数值**不抄**：参照仓的权重是按它自己的主题底色算的；这里按本仓的颜色**算出来**。
//
// 合成口径与 CSS color-mix 对齐（预乘空间）：
//   alpha_f = floor + (1-floor) × glassAlpha
//   surface = prev×(1-alpha_f) + floor×canvas + (1-floor)×glassAlpha×glass
//
// 本模块是 derived 层：**纯**（无 DOM、无时钟、无随机、无 IO、无 await、无模块级可变态）。
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 玻璃 + 地板合成后的表面色（与 CSS color-mix 逐字对应）。 */
export function glassSurface(prev: Rgb, glass: Rgb, glassAlpha: number, canvas: Rgb, floor: number): Rgb {
  const alphaF = floor + (1 - floor) * glassAlpha;
  return {
    r: prev.r * (1 - alphaF) + floor * canvas.r + (1 - floor) * glassAlpha * glass.r,
    g: prev.g * (1 - alphaF) + floor * canvas.g + (1 - floor) * glassAlpha * glass.g,
    b: prev.b * (1 - alphaF) + floor * canvas.b + (1 - floor) * glassAlpha * glass.b,
  };
}

export interface ThemeContrastSpec {
  /** 主题文字色。 */
  text: Rgb;
  /** 主题画布色（地板色）。 */
  canvas: Rgb;
  /** 玻璃叠色（白色釉光）。 */
  glass: Rgb;
  /** 该主题下最不利的壁纸像素：暗色主题怕白，亮色主题怕黑。 */
  worstWallpaper: Rgb;
}

/** 亮色主题（画布 #fcfcfb、文字 #141413 —— vendored palette.css / tokens.css 的真值）。 */
export const LIGHT_SPEC: ThemeContrastSpec = {
  text: { r: 0x14, g: 0x14, b: 0x13 },
  canvas: { r: 0xfc, g: 0xfc, b: 0xfb },
  glass: { r: 255, g: 255, b: 255 },
  worstWallpaper: { r: 0, g: 0, b: 0 },
};

/** 暗色主题（画布 #141413、文字 #FAF9F5）。 */
export const DARK_SPEC: ThemeContrastSpec = {
  text: { r: 0xfa, g: 0xf9, b: 0xf5 },
  canvas: { r: 0x14, g: 0x14, b: 0x13 },
  glass: { r: 255, g: 255, b: 255 },
  worstWallpaper: { r: 255, g: 255, b: 255 },
};

/** 验收线：WCAG AA 正文 4.5:1。 */
export const CONTRAST_TARGET = 4.5;

/** 网格 = 三个滑杆能到的全部档。 */
export const GLASS_ALPHAS: readonly number[] = [0, 0.15, 0.3, 0.45, 0.6];
export const WALLPAPER_ALPHAS: readonly number[] = [0, 0.5, 0.9];
export const SCRIMS: readonly number[] = [0, 0.35, 1];

export function worstSurface(
  spec: ThemeContrastSpec,
  glassAlpha: number,
  wallpaperAlpha: number,
  scrim: number,
  floor: number,
): Rgb {
  const withWallpaper = mix(spec.canvas, spec.worstWallpaper, wallpaperAlpha);
  const withScrim = mix(withWallpaper, spec.canvas, scrim);
  return glassSurface(withScrim, spec.glass, glassAlpha, spec.canvas, floor);
}

export function worstContrast(spec: ThemeContrastSpec, floor: number): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const ga of GLASS_ALPHAS) {
    for (const wa of WALLPAPER_ALPHAS) {
      for (const sc of SCRIMS) {
        const c = contrastRatio(spec.text, worstSurface(spec, ga, wa, sc, floor));
        if (c < worst) worst = c;
      }
    }
  }
  return worst;
}

/** 最小地板：网格最差格刚够 CONTRAST_TARGET 的权重（步进 0.01）。 */
export function floorFor(spec: ThemeContrastSpec): number {
  for (let f = 0; f <= 1.0001; f += 0.01) {
    if (worstContrast(spec, f) >= CONTRAST_TARGET) return Math.round(f * 100) / 100;
  }
  return 1;
}
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/wallpaper-contrast.test.ts`
Expected: PASS（4 条）。

- [ ] **Step 5: 实现 `wallpaper.css`**

`apps/desktop/src/renderer/wallpaper.css`：

```css
/* 壁纸层与玻璃表面（2026-11-14 · 设计规格 §4/§5）。
 *
 * 色值纪律：本文件**零字面色值**——画布色、文字色、玻璃色、地板权重全部由
 * state/wallpaper.ts 从真实计算样式读出后写成 CSS 变量（--cw-*）。
 *
 * 地板公式（与 derived/wallpaper-contrast.ts 的 glassSurface 逐字对应）：
 *   color-mix(in srgb, 画布 floor%, 玻璃 (1-floor)%)
 *   ⇒ 合成后 alpha = floor + (1-floor)×glassAlpha，滑杆压不动地板。
 */

/* ① 画布让位：vendored 主题只让出了它自己画的三处，**我们自己的 body 画布仍在**
   （styles.css 的 body { background: hsl(var(--bg-100)) }）——不接管就会
   「选了壁纸但什么也没变」。 */
body[data-we-wallpaper] {
  background: transparent;
}

body[data-we-wallpaper] .cw-layer {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: var(--cw-wallpaper-opacity, 1);
}

body[data-we-wallpaper] .cw-media {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* scrim = 画布色的一层veil：把壁纸拉回主题方向（亮色主题提亮、暗色主题压暗）。 */
body[data-we-wallpaper] .cw-scrim {
  position: absolute;
  inset: 0;
  background: var(--cw-canvas);
  opacity: var(--cw-scrim, 0.35);
}

/* ② 玻璃面（五类，业主裁决含左栏）：对话列 / composer / 检查器与右窗 / 浮层 / 左栏。
   不做嵌套玻璃（Chromium 的 backdrop-filter 嵌套采样会错乱）。 */
body[data-we-wallpaper] :is(
  .main,
  .composer-card,
  .inspector-col,
  .modal-card,
  .side-wrap
) {
  background: color-mix(in srgb, var(--cw-canvas) var(--cw-floor), var(--cw-glass) calc(100% - var(--cw-floor)));
  backdrop-filter: blur(var(--cw-glass-blur, 14px));
  -webkit-backdrop-filter: blur(var(--cw-glass-blur, 14px));
}

/* ③ 左栏在玻璃之上还要一条内描边（承载边界，不是装饰）。 */
body[data-we-wallpaper] .side-wrap {
  border-right: 1px solid color-mix(in srgb, var(--cw-text) 12%, transparent);
}

/* ④ 对话列本来由 vendored 主题在无壁纸时画底色；开壁纸时它让位给我们，
   这里补回玻璃。 */
body[data-we-wallpaper] .main {
  background: color-mix(in srgb, var(--cw-canvas) var(--cw-floor), var(--cw-glass) calc(100% - var(--cw-floor)));
}
```

- [ ] **Step 6: 跑分层与类型检查**

Run: `pnpm renderer-layer-check` && `node --import tsx scripts/typecheck.ts`
Expected: 全绿。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/renderer/derived/wallpaper-contrast.ts apps/desktop/src/renderer/wallpaper.css apps/desktop/tests/wallpaper-contrast.test.ts
git commit -m "feat(desktop): 玻璃表面与可读性地板模型

地板权重由本仓的颜色算出来（不抄参照仓的 0.45/0.59）：滑杆只改玻璃那一项，
最差格对比度 ≥4.5:1。新 CSS 零字面色值，颜色全走 --cw-* 变量。"
```

---

### Task 5: 外观分段的壁纸设置行

**Files:**
- Modify: `apps/desktop/src/renderer/strings-settings.ts`（`general` 段）、`apps/desktop/src/renderer/components/settings/GeneralSection.tsx`、`apps/desktop/src/renderer/components/SettingsPanel.tsx`
- Test: `apps/desktop/tests/wallpaper-settings-ui.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `AppSettings.wallpaper`；Task 2 的 `window.agent.wallpaperPick()`
- Produces: 无新导出（只接线）

- [ ] **Step 1: 写失败测试**

`apps/desktop/tests/wallpaper-settings-ui.test.tsx`：

```tsx
// 壁纸设置行判卷（2026-11-14）：外观分段里出现壁纸行与三个滑杆。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneralSection } from "../src/renderer/components/settings/GeneralSection";
import { DEFAULT_SETTINGS } from "../../src/main/settings";

describe("壁纸设置行", () => {
  it("外观分段里有壁纸行与三个滑杆", () => {
    const html = renderToStaticMarkup(
      <GeneralSection
        settings={DEFAULT_SETTINGS}
        textSize="md"
        onSave={() => undefined}
        onCtrlTab={() => undefined}
        onTextSize={() => undefined}
        uiSize="2"
        onUiSize={() => undefined}
        onWindowVibrancy={() => undefined}
        onNotify={() => undefined}
        onWallpaperPick={() => undefined}
        onWallpaperOpacity={() => undefined}
        onWallpaperScrim={() => undefined}
        onWallpaperGlass={() => undefined}
        onWallpaperClear={() => undefined}
      />,
    );
    expect(html).toContain("壁纸");
    expect((html.match(/type="range"/g) ?? []).length).toBe(3);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/wallpaper-settings-ui.test.tsx`
Expected: FAIL（props 不存在）。

- [ ] **Step 3: 加文案**

`apps/desktop/src/renderer/strings-settings.ts` 的 `general` 段加：

```ts
    wallpaper: "壁纸",
    wallpaperPick: "选择图片或视频",
    wallpaperClear: "清除",
    wallpaperNone: "未设置",
    wallpaperOpacity: "壁纸不透明度",
    wallpaperScrim: "压暗",
    wallpaperGlass: "玻璃透明度",
```

（组件里不许出现裸中文——`GeneralSection` 在 `strings.test` 的 `REWORKED_FILES` 里。）

- [ ] **Step 4: 加设置行**

`GeneralSection.tsx`：props 加五个回调，在「外观」分段里（主题行之后、窗口材质行之前）加：

```tsx
        <SettingsRow label={STR.general.wallpaper}>
          <div className="cw-settings">
            <button type="button" className="mini-btn" onClick={props.onWallpaperPick}>
              {props.settings.wallpaper.kind === "none" ? STR.general.wallpaperPick : STR.general.wallpaperNone}
            </button>
            {props.settings.wallpaper.kind !== "none" && (
              <button type="button" className="mini-btn" onClick={props.onWallpaperClear}>
                {STR.general.wallpaperClear}
              </button>
            )}
            <label className="cw-slider">
              <span>{STR.general.wallpaperOpacity}</span>
              <input type="range" min={0} max={1} step={0.05} value={props.settings.wallpaper.opacity}
                onChange={(e) => { props.onWallpaperOpacity(Number(e.target.value)); }} />
            </label>
            <label className="cw-slider">
              <span>{STR.general.wallpaperScrim}</span>
              <input type="range" min={0} max={1} step={0.05} value={props.settings.wallpaper.scrim}
                onChange={(e) => { props.onWallpaperScrim(Number(e.target.value)); }} />
            </label>
            <label className="cw-slider">
              <span>{STR.general.wallpaperGlass}</span>
              <input type="range" min={0} max={0.6} step={0.05} value={props.settings.wallpaper.glassAlpha}
                onChange={(e) => { props.onWallpaperGlass(Number(e.target.value)); }} />
            </label>
          </div>
        </SettingsRow>
```

- [ ] **Step 5: 在 `SettingsPanel.tsx` 接线**

`GeneralSection` 的调用处加五个回调：

```tsx
                onWallpaperPick={() => { void pickWallpaper(); }}
                onWallpaperOpacity={(next) => { void saveWallpaper({ opacity: next }); }}
                onWallpaperScrim={(next) => { void saveWallpaper({ scrim: next }); }}
                onWallpaperGlass={(next) => { void saveWallpaper({ glassAlpha: next }); }}
                onWallpaperClear={() => { void saveWallpaper({ kind: "none", path: null }); }}
```

并在 `SettingsPanel.tsx` 里加两个函数：

```tsx
  /** 选壁纸：主进程弹窗选文件，返回 kind + 绝对路径；path 只落 settings.json。 */
  const pickWallpaper = async (): Promise<void> => {
    setError(null);
    try {
      const r = await window.agent.wallpaperPick();
      if (!r.ok) {
        if (r.error !== undefined && r.error !== "未选择文件") setError(r.error);
        return;
      }
      if (r.path === undefined || r.kind === undefined) return;
      const next = await window.agent.setSettings({
        wallpaper: { ...s.wallpaper, kind: r.kind, path: r.path, revision: s.wallpaper.revision + 1 },
      });
      setS(next);
      await refreshWallpaper();
      pulse(STR.settingsPanel.savedCheck);
    } catch (err) {
      setError(STR.settingsPanel.saveFailedPrefix + (err instanceof Error ? err.message : String(err)));
    }
  };

  /** 改壁纸的一个字段（滑杆）：走单键直调，不进 panelPatch 白名单。
   *  revision **只在 path 变了时自增**——滑杆每动一下都自增会让 URL 变、媒体重载、视频闪断。
   *  壁纸与系统 vibrancy 同开时 vibrancy 被完全遮住 ⇒ 一起关掉（规格 §5.5）。 */
  const saveWallpaper = async (patch: Partial<AppSettings["wallpaper"]>): Promise<void> => {
    setError(null);
    try {
      const turningOn = (patch.kind ?? s.wallpaper.kind) !== "none";
      const next = await window.agent.setSettings({
        wallpaper: {
          ...s.wallpaper,
          ...patch,
          revision: patch.path !== undefined ? s.wallpaper.revision + 1 : s.wallpaper.revision,
        },
        ...(turningOn && s.windowVibrancy === true ? { windowVibrancy: false } : {}),
      });
      setS(next);
      await refreshWallpaper();
    } catch (err) {
      setError(STR.settingsPanel.saveFailedPrefix + (err instanceof Error ? err.message : String(err)));
    }
  };
```

`SettingsPanel.tsx` 需要 `import { refreshWallpaper } from "../state/wallpaper";` 与 `import type { AppSettings } from ...`（该文件已 import `AppSettings`）。

- [ ] **Step 6: 跑测试确认绿**

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/wallpaper-settings-ui.test.tsx`
Expected: PASS。

Run: `pnpm --filter cairn-desktop exec vitest run --config vitest.config.ts tests/strings.test.ts`
Expected: PASS（裸中文判卷）。

- [ ] **Step 7: 跑类型检查**

Run: `node --import tsx scripts/typecheck.ts`
Expected: exit 0。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/renderer/strings-settings.ts apps/desktop/src/renderer/components/settings/GeneralSection.tsx apps/desktop/src/renderer/components/SettingsPanel.tsx apps/desktop/tests/wallpaper-settings-ui.test.tsx
git commit -m "feat(desktop): 外观分段的壁纸设置行

选文件走主进程弹窗（单选 + 扩展名过滤）；三个滑杆走单键直调、不进 panelPatch 白名单。
path 只落 settings.json；改完回灌渲染层。"
```

---

### Task 6: 真渲染层验收证据

**Files:**
- Create: `outputs/wallpaper-layer-2026-11-14/REPORT.md`（证据；`outputs/` 里的 .ts 会被 tsconfig.evidence.json 编译⇒**只放 .md / .json / 图片**）
- Create: `outputs/wallpaper-layer-2026-11-14/screenshots/*.png`

**Interfaces:**
- Consumes: Task 1-5 的全部产物
- Produces: 验收证据（README 里的链接 + 数字）

- [ ] **Step 1: 起静态服务看真渲染层**

本机 Electron 起不来（沙箱挡 MachPortRendezvousServer）⇒ 用仓库既有的静态预览办法：真 dist + 假 AgentApi + `python3 -m http.server`（见仓内 `apps/desktop/preview/`）。

- [ ] **Step 2: 实测五项判据**

逐项记录读数到 `REPORT.md`：

1. 开壁纸时 `getComputedStyle(document.body).backgroundColor` 的 alpha 为 0；
2. `--cw-floor` 的值与 `worstContrast` 的最差格（≥4.5）；
3. 失焦后 `document.querySelector("video")?.paused === true`；
4. `cairn-wallpaper://media/current?v=0` 对**非当前文件**返回 404/403；
5. 无壁纸时与改动前同尺寸截图逐像素一致（回归）。

- [ ] **Step 3: 截图**

1440×900，亮色与暗色各一张「有壁纸」与一张「无壁纸」。

- [ ] **Step 4: 写 `REPORT.md`**

写清：实测读数、命令与退出码、跳过的项（遮挡判定不可靠——Electron 无 occluded 事件）、风险。

- [ ] **Step 5: 跑全量门禁**

```bash
pnpm test:capped
pnpm --filter cairn-desktop test
node --import tsx scripts/typecheck.ts
pnpm renderer-layer-check
pnpm desktop-boundary-check
pnpm docs-check
```

Expected: 全绿（核心计数必须带 `--maxWorkers=2` 的并发级别）。

- [ ] **Step 6: 提交**

```bash
git add outputs/wallpaper-layer-2026-11-14
git commit -m "docs(desktop): 壁纸层与玻璃表面的验收证据"
```

---

## 自检（对照规格）

| 规格节 | 落在哪个任务 |
|---|---|
| §3.1 五处新增 | Task 1/2/3/4 |
| §3.2 协议 + Range | Task 2 |
| §3.3 IPC 通道 | Task 2 |
| §3.4 设置字段 | Task 1 |
| §3.5 挂点 + 属性唯一写者 | Task 3 |
| §4 画布让位（body 由我们画） | Task 4（CSS ①） |
| §5.1 五类玻璃面 | Task 4（CSS ②） |
| §5.2 玻璃参数 | Task 3（`--cw-*`）+ Task 4 |
| §5.3 可读性地板 | Task 4 |
| §5.4 三个滑杆 | Task 1（字段）+ Task 5（UI） |
| §5.5 与 windowVibrancy 互斥 | **未覆盖 ⇒ Task 7 见下** |
| §6 生命周期暂停 | Task 3 |
| §7 降级链 | Task 3（404/416 ⇒ 撤层）**部分 ⇒ 见下** |
| §8 明确不做 | 不实现（范围声明） |
| §9 七条判卷 | Task 1-6 的测试 + Task 6 的实测 |

**两处规格缺口已并进上面的任务（不再单列）：**

- **§5.5 vibrancy 互斥** → 落在 Task 5 的 `saveWallpaper`：壁纸一开，同批 patch 里带
  `windowVibrancy: false`（同开时 vibrancy 被壁纸完全遮住，等于白开一场）。
- **§7 降级链** → 落在 Task 3 的 `WallpaperLayer`：`onError` 调 `dropWallpaper()`，
  **只撤媒体、不撤玻璃**（没有壁纸时玻璃面回落实体色，不破面）。`dropWallpaper` 只改视图，
  不改设置（文件可能只是暂时读不到，下次启动还能试）。

---

## 执行顺序

Task 1 → 2 → 3 → 4 → 5 → 6（严格串行：后面的任务引用前面的导出）。
