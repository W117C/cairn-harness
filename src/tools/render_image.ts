import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnTracked } from "./process.js";
import { assertRealContainment, resolveInWorkspace, type Tool, type ToolContext, type ToolResult } from "./base.js";
import { artifactKindOf } from "./write_file.js";

/** 渲染工作区内的 HTML/SVG 成 PNG，作为图片内容块进上下文（识图的另一只眼）。
 *
 *  为什么需要它：`read_image` 只能读**已经在盘上**的图片文件。而 agent 写的可视化产物
 *  （HTML/SVG/动画）恰恰还没有图片形态——要"真的看过"，得先渲染。
 *  实测（2026-10-16，用本仓那份 pelican-bicycle.html）：Chrome headless 1.2s 出图，
 *  `--virtual-time-budget` 取不同值确实得到不同帧（PNG sha 不同）⇒ 动画可分段看。
 *
 *  三道闸，缺一不可：
 *  ① 只渲工作区内的 .html/.htm/.svg（resolveInWorkspace + assertRealContainment，
 *     与 read_file/grep/glob 同一套包含判定——软链穿透那一层也在内）；
 *  ② 墙钟硬上限：Chrome 的退出行为**不可依赖**（实测 `about:blank` 这种空页也能挂住
 *     不退出，而目标文件 1.2s 就退），所以必须走 spawnTracked 的进程组 + 超时强杀，
 *     裸 spawn 等 'close' 会把 agent loop 一起挂死；
 *  ③ PNG 字节帽 + magic number 复核：Chrome 崩了或被强杀时可能留下空文件/半截文件，
 *     那时宁可明确拒绝，也不把一张坏图当"我看过了"塞进上下文。
 */

/** 单帧渲染的墙钟上限。Chrome 冷启 + 页面加载实测约 1.2s；20s 留给重资源与长虚拟时间预算。 */
export const RENDER_TIMEOUT_MS = 20_000;

/** 视口高度上限（px）。高度此前**写死 1200** 而说明书说「高由页面自己定」——
 *  那句是错的：`--window-size` 定的是视口，页面低于它时底部留白、高于它时被裁掉，
 *  于是「截图 = 页面全貌」这个默认预期在两种页面上都不成立。现在它是一个可传参数，
 *  说明书与实现同一个口径（200–4000，与 width 同一道校验）。 */
export const MAX_RENDER_HEIGHT_PX = 4000;

/** 视口高度缺省（px）。取 1200 = 与写死时代逐字一致，行为不变的只有这一格。 */
export const DEFAULT_RENDER_HEIGHT_PX = 1200;

/** 交付进上下文的 PNG 字节帽（与 read_image 同一顶帽，两个入口不许有两个数）。 */
export const MAX_RENDER_PNG_BYTES = 5 * 1024 * 1024;

/** 认得的源扩展名。别的类型不猜——把 .txt 当 HTML 渲，Chrome 给一片空白，
 *  而空白图进上下文比明确的拒绝更难查。 */
const RENDERABLE_EXT: ReadonlySet<string> = new Set([".html", ".htm", ".svg"]);

/** 这个路径能不能渲（纯函数，判卷直接钉——后缀名是唯一判据，与 read_image 同纪律）。 */
export function isRenderable(p: string): boolean {
  const dot = p.lastIndexOf(".");
  return dot > 0 && RENDERABLE_EXT.has(p.slice(dot).toLowerCase());
}

/** PNG magic number 复核（纯函数）。Chrome 崩溃 / 被强杀时可能留下空文件或半截文件。 */
export function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

export const RENDER_IMAGE_DESCRIPTION =
  "把工作区内的 HTML/SVG 渲染成 PNG 并读进上下文（看完可视化产物再收尾）。" +
  "何时用：写完或改完 HTML/SVG/动画/图表，要确认它真的长成你要的样子；" +
  "何时不用：读盘上已有的图片用 read_image；读源码配置用 read_file。" +
  "参数：path 必填；atMs 是虚拟时间预算（动画用它取不同时刻的帧，省略＝加载完那一刻）；" +
  "width 是视口宽、height 是视口高（px，缺省 1200/1200）——两者定的是**视口**，不是页面："
  + "页面比视口矮时底部留白，比视口高时超出的部分被裁掉，要全貌就把 height 调大。" +
  "单帧只覆盖一个时刻：动画要用 atMs 采样一个周期内的多个时刻，检查运动轨迹、相对位置和循环衔接。"
  + "约束：单帧 ≤ " + String(Math.floor(MAX_RENDER_PNG_BYTES / 1024 / 1024)) + "MB。";

/** Chrome/Chromium 可执行文件的候选名单（按序找第一个在的）。
 *  只认这几个**已知安装位**，不去 PATH 里翻：PATH 里翻到一个同名二进制就 spawn，
 *  等于让环境里任何一个目录决定我们跑什么。 */
const CHROME_CANDIDATES: readonly string[] = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

export interface RenderImageDeps {
  /** 找 Chrome 可执行文件（测试注入）。返回 null = 本机没有。 */
  findChrome?: () => Promise<string | null>;
  /** 渲染一帧（测试注入：不真起浏览器）。抛错 = 这一帧没拿到。 */
  shoot?: (chrome: string, htmlPath: string, out: string, opts: { width: number; height: number; atMs?: number }) => Promise<void>;
}

async function defaultFindChrome(): Promise<string | null> {
  for (const p of CHROME_CANDIDATES) {
    try {
      // 用 readFile 而不是 access(X_OK)：macOS 的 .app 内部二进制常常没有 +x 位给外部看，
      // 而它确实能执行。读得到就认。
      await readFile(p);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

/** 起一次 Chrome headless 截图。
 *  **必须**经 spawnTracked（进程组 + 超时强杀 + 超时先 settle）：
 *  实测 `about:blank` 也能挂住不退出，裸 spawn 等 'close' 会永久挂死 agent loop。
 *  env 由 spawnTracked 消毒（不继承主进程 ⇒ 解密后的 BYOK key 不会进浏览器进程）。 */
async function defaultShoot(chrome: string, htmlPath: string, out: string, opts: { width: number; height: number; atMs?: number }): Promise<void> {
  const args = [
    "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    // 渲染的是**工作区里的 HTML**（可能刚由模型写、可被提示注入）：页面里的 fetch/img/script
    // 默认能访问内网与云元数据（169.254.169.254），完全绕过 web-fetch-policy 的 SSRF 闸。
    // 这里把 DNS 解析全部掐断（相对路径与内联资源照常渲染），并关掉浏览器的后台网络。
    "--host-resolver-rules=MAP * ~NOTFOUND",
    // `host-resolver-rules` 只管域名：IP 字面量（127.0.0.1 / 169.254.169.254 / 192.168.x.x）
    // 不经 DNS。所有 http(s) 强制走一个必然失败的本地代理，并让回环也不绕过代理。
    "--proxy-server=127.0.0.1:9",
    "--proxy-bypass-list=<-loopback>",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-pings",
    "--screenshot=" + out,
    "--window-size=" + String(opts.width) + "," + String(opts.height),
    ...(opts.atMs !== undefined ? ["--virtual-time-budget=" + String(opts.atMs)] : []),
    pathToFileURL(htmlPath).href,
  ];
  let timedOut = false;
  const handle = spawnTracked(chrome, args, {
    cwd: "/",
    timeoutMs: RENDER_TIMEOUT_MS,
    onTimeout: () => { timedOut = true; },
  });
  await new Promise<void>((resolvePromise) => {
    handle.child.on("close", () => resolvePromise());
    handle.child.on("error", () => resolvePromise());
  });
  handle.dispose();
  if (timedOut) {
    throw new Error("渲染超时（" + String(RENDER_TIMEOUT_MS / 1000) + "s）——页面可能有重资源，或 Chrome 未正常退出（已强杀）");
  }
}

export function makeRenderImage(deps: RenderImageDeps = {}): Tool {
  const findChrome = deps.findChrome ?? defaultFindChrome;
  const shoot = deps.shoot ?? defaultShoot;
  return {
    name: "render_image",
    async run(args, ctx): Promise<ToolResult> {
      const rel = args.path;
      if (typeof rel !== "string" || rel.trim() === "") {
        throw new Error("render_image: path 参数必须是非空字符串");
      }
      if (!isRenderable(rel)) {
        throw new Error("render_image: 只渲染 .html/.htm/.svg，收到: " + rel);
      }
      const width = typeof args.width === "number" && Number.isInteger(args.width) && args.width >= 200 && args.width <= 4000
        ? args.width
        : 1200;
      // height 与 width 同一道校验、同一个缺省形状。写死 1200 的时代这里什么都没有，
      // 于是「页面自己定高」那句说明书从来没有兑现过（见 MAX_RENDER_HEIGHT_PX 注释）。
      const height = typeof args.height === "number" && Number.isInteger(args.height) && args.height >= 200 && args.height <= MAX_RENDER_HEIGHT_PX
        ? args.height
        : DEFAULT_RENDER_HEIGHT_PX;
      const atMs = typeof args.atMs === "number" && Number.isInteger(args.atMs) && args.atMs >= 0 && args.atMs <= 60_000
        ? args.atMs
        : undefined;

      const abs = resolveInWorkspace(ctx.workspace, rel.trim(), "render_image");
      await assertRealContainment(ctx.workspace, abs, "render_image");

      const chrome = await findChrome();
      if (chrome === null) {
        return {
          ok: false,
          output: "render_image: 本机找不到 Chrome/Chromium/Edge/Brave——渲染需要其中一个。" +
            "这条路是 fail-closed 的：没有浏览器就不假装看过，" +
            "请改用「把关键数值读回来核对」的方式自检（read_file 读产物、逐帧比对坐标）。",
        };
      }

      // 截图落 OS 临时目录（mkdtemp 独立一份）：**不落工作区**——判卷数据与工具副产品
      // 都不该污染用户的仓库；用完即删，与 tests/ 那条"测试数据绝不落工作区"同一条纪律。
      const dir = await mkdtemp(join(tmpdir(), "cairn-render-"));
      const out = join(dir, "frame.png");
      try {
        await shoot(chrome, abs, out, { width, height, ...(atMs !== undefined ? { atMs } : {}) });
        const buf = await readFile(out);
        if (buf.length === 0) {
          return { ok: false, output: "render_image: 渲染出来是空文件（Chrome 可能没起来或页面是空的）——不把空图当看过" };
        }
        if (!isPng(buf)) {
          return { ok: false, output: "render_image: 产物不是 PNG（magic number 不符，可能被强杀成半截文件）——不把坏图当看过" };
        }
        if (buf.length > MAX_RENDER_PNG_BYTES) {
          return {
            ok: false,
            output: "render_image: 渲染结果 " + String(Math.ceil(buf.length / 1024 / 1024)) + "MB 超过帽 " +
              String(Math.floor(MAX_RENDER_PNG_BYTES / 1024 / 1024)) + "MB——调小 width 或分区域看",
          };
        }
        const dataUrl = "data:image/png;base64," + buf.toString("base64");
        return {
          ok: true,
          // 回执只声称**这张图本身**的事实：哪个文件、哪个视口、哪个时刻、多少字节。
          // 从前那句「现在你真的看过它了」把「生成了一张 PNG」说成「已经有效检查过」——
          // 而单帧静态图证明得了「元素出现了」，证明不了脚贴没贴踏板、循环交界跳不跳变。
          // 那句话是模型据以宣称「我看过了」的唯一凭据，所以它必须只说自己能兑现的部分，
          // 并把「还差什么检查」写在同一个回执里（否则模型没有任何提示要去补那些帧）。
          output: "[render_image] " + rel
            + "（视口 " + String(width) + "×" + String(height) + "，"
            + (atMs !== undefined ? "虚拟时间 " + String(atMs) + "ms" : "加载态那一帧")
            + "，" + String(buf.length) + " 字节 PNG）已作为图片内容块附上。"
            + "这一帧只证明页面跑起来了、元素在画面里；动画还需要按周期多点采样（atMs），检查运动轨迹、相对位置和循环衔接，"
            + "页面比视口高的部分会被裁掉。",
          images: [{ type: "image", dataUrl }],
          // 产物引用指向**被渲染的那个源文件**，不是这张 PNG（PNG 落在 OS 临时目录、用完即删）。
          // 用户面据此给「打开预览」入口——同一条链路的另一半在桌面端 projections/Stream。
          // kind 走 write_file 那个共用分类器（按后缀名）：写死 "html" 会把 .svg 也报成 html，
          // 而桌面端两个 kind 都进 openPreview ⇒ 观感一样、数据是错的，判卷也就跟着错。
          artifact: { kind: artifactKindOf(rel), path: rel.trim(), note: "刚渲染过的产物" },
        };
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

export const render_image: Tool = makeRenderImage();
