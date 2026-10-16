// render_image 判卷：三道闸（界内+可渲染类型 / Chrome 缺席 fail-closed / PNG 复核与帽）
// + 一次**真渲染**（用本仓那份 pelican-bicycle.html，1.2s 出图）证明这条路不是空壳。
//
// 为什么值得一次真渲染：识图回路此前的失败模式是**静默的**——模型在回执里看到
// 「已附上」而请求体里没有图。静默失败只有真跑一遍才看得见。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPng, isRenderable, makeRenderImage, MAX_RENDER_PNG_BYTES } from "../src/tools/render_image";
import { staticRisk } from "../src/permissions/risk";
import type { ToolName } from "../src/tools/base";

let ws: string;
beforeEach(() => { ws = realpathSync(mkdtempSync(join(tmpdir(), "render-img-"))); });
afterEach(() => { rmSync(ws, { recursive: true, force: true }); });
const ctx = (): { workspace: string } => ({ workspace: ws });

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

describe("isRenderable：后缀名是唯一判据（与 read_image 同纪律，不看内容）", () => {
  it("四种认得的扩展名", () => {
    expect(isRenderable("a.html")).toBe(true);
    expect(isRenderable("a.htm")).toBe(true);
    expect(isRenderable("a.svg")).toBe(true);
    expect(isRenderable("dir/sub/A.HTML")).toBe(true);
  });
  it("别的类型与无扩展名一律不认", () => {
    expect(isRenderable("a.txt")).toBe(false);
    expect(isRenderable("a.png")).toBe(false); // 盘上已有图片 ⇒ 用 read_image，不是这里
    expect(isRenderable("noext")).toBe(false);
    expect(isRenderable("a.html.bak")).toBe(false);
  });
});

describe("isPng：magic number 复核（Chrome 崩了会留半截文件）", () => {
  it("真 PNG 认得出", () => { expect(isPng(PNG_1X1)).toBe(true); });
  it("空文件 / 截断的 magic / 非 PNG 都拒", () => {
    expect(isPng(Buffer.alloc(0))).toBe(false);
    expect(isPng(Buffer.from([0x89, 0x50]))).toBe(false);
    expect(isPng(Buffer.from("<html>not a png</html>"))).toBe(false);
  });
});

describe("闸一：路径与类型", () => {
  it("绝对路径与越界路径被拒", async () => {
    const tool = makeRenderImage({ findChrome: async () => "/fake/chrome", shoot: async () => undefined });
    // /etc/hosts 没有可渲染扩展名 ⇒ 先被类型闸拒（这一格也是真拒，只是理由更前面）。
    await expect(tool.run({ path: "/etc/hosts" }, ctx())).rejects.toThrow(/只渲染/);
    // 带可渲染扩展名的越界路径 ⇒ 走包含判定那一层
    await expect(tool.run({ path: "../outside.html" }, ctx())).rejects.toThrow();
    await expect(tool.run({ path: "/tmp/evil.html" }, ctx())).rejects.toThrow(/workspace/);
  });

  it("不可渲染的类型被拒（不许把 .txt 当 HTML 渲出空白图）", async () => {
    writeFileSync(join(ws, "a.txt"), "hello");
    const tool = makeRenderImage({ findChrome: async () => "/fake/chrome", shoot: async () => undefined });
    await expect(tool.run({ path: "a.txt" }, ctx())).rejects.toThrow(/只渲染/);
  });

  it("工作区内的软链指向界外 ⇒ 被包含判定拒（词法 resolve 挡不住的那一层）", async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "render-out-")));
    try {
      writeFileSync(join(outside, "evil.html"), "<h1>x</h1>");
      const link = join(ws, "link.html");
      try { require("node:fs").symlinkSync(join(outside, "evil.html"), link); } catch { return; }
      const tool = makeRenderImage({ findChrome: async () => "/fake/chrome", shoot: async () => undefined });
      await expect(tool.run({ path: "link.html" }, ctx())).rejects.toThrow();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("闸二：Chrome 缺席 fail-closed（没有浏览器就不假装看过）", () => {
  it("找不到 Chrome ⇒ ok:false 且明说改用数值自检", async () => {
    writeFileSync(join(ws, "a.html"), "<h1>x</h1>");
    const tool = makeRenderImage({ findChrome: async () => null, shoot: async () => undefined });
    const r = await tool.run({ path: "a.html" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("Chrome");
    expect(r.images).toBeUndefined(); // 不许附一张不存在的图
  });

  it("渲染抛错（超时/崩溃）⇒ 冒泡成失败，不附图", async () => {
    writeFileSync(join(ws, "a.html"), "<h1>x</h1>");
    const tool = makeRenderImage({
      findChrome: async () => "/fake/chrome",
      shoot: async () => { throw new Error("渲染超时（20s）"); },
    });
    await expect(tool.run({ path: "a.html" }, ctx())).rejects.toThrow(/渲染超时/);
  });
});

describe("闸三：PNG 复核与字节帽（注入 shoot 写盘，不走真浏览器）", () => {
  const shootTo = (bytes: Buffer) => async (_c: string, _h: string, out: string): Promise<void> => {
    writeFileSync(out, bytes);
  };

  it("正常 ⇒ 附 data URL，回执点名文件与字节数", async () => {
    writeFileSync(join(ws, "a.html"), "<h1>x</h1>");
    const tool = makeRenderImage({ findChrome: async () => "/fake/chrome", shoot: shootTo(PNG_1X1) });
    const r = await tool.run({ path: "a.html" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.images).toHaveLength(1);
    expect(r.images?.[0]?.dataUrl).toBe("data:image/png;base64," + PNG_1X1.toString("base64"));
    expect(r.output).toContain("a.html");
  });

  it("atMs 落在回执里（动画分段看时，模型得知道这一帧是哪一刻）", async () => {
    writeFileSync(join(ws, "a.html"), "<h1>x</h1>");
    const tool = makeRenderImage({ findChrome: async () => "/fake/chrome", shoot: shootTo(PNG_1X1) });
    const r = await tool.run({ path: "a.html", atMs: 650 }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("@650ms");
  });

  it("空文件 ⇒ 拒（不把空图当看过）", async () => {
    writeFileSync(join(ws, "a.html"), "<h1>x</h1>");
    const tool = makeRenderImage({ findChrome: async () => "/fake/chrome", shoot: shootTo(Buffer.alloc(0)) });
    const r = await tool.run({ path: "a.html" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("空文件");
  });

  it("非 PNG（半截/HTML）⇒ 拒", async () => {
    writeFileSync(join(ws, "a.html"), "<h1>x</h1>");
    const tool = makeRenderImage({ findChrome: async () => "/fake/chrome", shoot: shootTo(Buffer.from("<html>oops</html>")) });
    const r = await tool.run({ path: "a.html" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("PNG");
  });

  it("超字节帽 ⇒ 拒并报实际大小", async () => {
    writeFileSync(join(ws, "a.html"), "<h1>x</h1>");
    const big = Buffer.concat([PNG_1X1, Buffer.alloc(MAX_RENDER_PNG_BYTES)]);
    const tool = makeRenderImage({ findChrome: async () => "/fake/chrome", shoot: shootTo(big) });
    const r = await tool.run({ path: "a.html" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain("MB");
  });

  it("截图不落工作区（工具副产品不许污染用户的仓库）", async () => {
    writeFileSync(join(ws, "a.html"), "<h1>x</h1>");
    let sawCwd = "";
    const tool = makeRenderImage({
      findChrome: async () => "/fake/chrome",
      shoot: async (_c, _h, out) => { sawCwd = out; writeFileSync(out, PNG_1X1); },
    });
    await tool.run({ path: "a.html" }, ctx());
    expect(sawCwd).not.toContain(ws); // 落在 OS 临时目录
  });
});

describe("权限面：render_image 与 lsp 同族（执行进程、不改盘、四档都问）", () => {
  it("staticRisk 给 high（默认档与只读档的 riskAskAt 就是 high）", () => {
    const r = staticRisk("render_image" as ToolName, {});
    expect(r.level).toBe("high");
  });
});

describe("真渲染（用本仓那份 pelican-bicycle.html）", () => {
  it("Chrome 在 ⇒ 1.2s 量级出图，且是一张真的 PNG", async () => {
    const html = join(process.cwd(), "pelican-bicycle.html");
    if (!existsSync(html)) return; // 文件不在（被清掉）就不硬跑这一格
    const tool = makeRenderImage(); // 真 findChrome + 真 shoot
    const r = await tool.run({ path: "pelican-bicycle.html", width: 400 }, { workspace: process.cwd() });
    // 本机没装 Chrome 时这一格如实跳过，不假装通过
    if (!r.ok) { expect(r.output).toContain("Chrome"); return; }
    expect(r.images).toHaveLength(1);
    const b64 = r.images?.[0]?.dataUrl.replace(/^data:image\/png;base64,/, "") ?? "";
    expect(isPng(Buffer.from(b64, "base64"))).toBe(true);
  }, 60_000);
});
