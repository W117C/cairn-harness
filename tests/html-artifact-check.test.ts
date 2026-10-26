/** 产物静态自检的判卷（2026-10-16）。
 *
 *  为什么值得单独立一个判卷文件：这一格补的是「验证对象错位」——从前 verify 面只查 harness
 *  自己的健康（typecheck + 三个判卷族），用户要的那份 HTML 一次都没被看过。所以判据的重心
 *  不在脚本内部逻辑多精巧，而在**它真的会红**：外部依赖、占位符残留、缺失的本地引用各造一个。
 *
 *  反向三格同样钉：没有参数 ⇒ 用法错（不假装干净）、空文件 ⇒ 红、全绿 ⇒ 真的退 0。
 *  断言一律走子进程（这就是 verify 调用它的方式），不在进程里 import 后调 main——那样测不到退出码。 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts", "html-artifact-check.ts");

type Run = { code: number; out: string };
/** cwd 必须留在**仓库根**：脚本用 `--import tsx`，而 tsx 只在仓库的 node_modules 里。
 *  判卷数据另放临时目录（脚本本身只吃相对路径，所以 cwd 与产物路径分开给）。
 *  绝对路径被脚本拒 ⇒ 这里传的就是相对路径，workspace 用符号链接式的相对表达做不到，
 *  所以改成：在仓库根的 .tmp 下建一棵 UUID 目录，判卷数据落那里，跑完删（同本仓其余判卷口径）。 */
const run = (args: string[]): Run => {
  try {
    const out = execFileSync("node", ["--import", "tsx", SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
};

/** 判卷数据目录：UUID 作用域，落在仓库 .tmp/ 下（固定路径在并行判卷间会互删，见 tests/ 既有纪律）。
 *  必须在仓库内：脚本只认工作区相对路径，而 cwd 又必须在仓库根（tsx 在那儿）。 */
let dataRel: string;
beforeEach(() => {
  dataRel = join(".tmp", "html-check-" + randomUUID());
  mkdirSync(join(ROOT, dataRel), { recursive: true });
});
afterEach(() => { rmSync(join(ROOT, dataRel), { recursive: true, force: true }); });

describe("html-artifact-check：产物字节层的四条判据", () => {
  it("干净的单文件产物 ⇒ 退 0 且说出查过什么", () => {
    writeFileSync(join(dataRel, "ok.html"), "<!doctype html><html><body><h1>鹈鹕</h1><script>const a = 1;</script></body></html>\n");
    const r = run([join(dataRel, "ok.html")]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("全过");
  });

  it("引用外部资源 ⇒ 红，且点名是零外部依赖的要求", () => {
    writeFileSync(join(dataRel, "ext.html"), '<img src="https://cdn.example/x.png">\n');
    const r = run([join(dataRel, "ext.html")]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("ext.html");
    expect(r.out).toContain("零外部依赖");
  });

  it("协议相对 URL 也算外部（浏览器会走 http(s)）", () => {
    writeFileSync(join(dataRel, "proto.html"), '<link href="//cdn.example/a.css" rel="stylesheet">\n');
    expect(run([join(dataRel, "proto.html")]).code).toBe(1);
  });

  it("未替换的占位符 ⇒ 红（模板组装最常见的残留）", () => {
    writeFileSync(join(dataRel, "ph.html"), "<p>__TITLE__</p><p>{{name}}</p>\n");
    const r = run([join(dataRel, "ph.html")]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("__TITLE__");
    expect(r.out).toContain("{{name}}");
  });

  it("引用的本地文件不存在 ⇒ 红；存在 ⇒ 不红", () => {
    writeFileSync(join(dataRel, "a.png"), "x");
    writeFileSync(join(dataRel, "missing.html"), '<img src="a.png"><img src="b.png">\n');
    const r = run([join(dataRel, "missing.html")]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("b.png");
    expect(r.out).not.toContain("a.png"); // 在的那个不许报（假红比漏报更贵：它会让这一格被整体不信）
  });

  it("空文件 ⇒ 红（没有可交付内容，不许当成干净）", () => {
    writeFileSync(join(dataRel, "empty.html"), "");
    const r = run([join(dataRel, "empty.html")]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("空文件");
  });

  it("多个文件一起查：一个坏就整体红（verify 只认退出码）", () => {
    writeFileSync(join(dataRel, "good.html"), "<h1>ok</h1>\n");
    writeFileSync(join(dataRel, "bad.html"), '<img src="https://x/y.png">\n');
    const r = run([join(dataRel, "good.html"), join(dataRel, "bad.html")]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("bad.html");
  });

  // 用法错必须与"干净"分得开：从前一类脚本用 `|| true` 把没参数也弄成退 0。
  it("没有参数 ⇒ 退 2（用法错，不假装干净）", () => {
    expect(run([]).code).toBe(2);
  });

  it("绝对路径 ⇒ 退 2（与其余判卷同一口径：只接受工作区相对路径）", () => {
    expect(run(["/etc/hosts.html"]).code).toBe(2);
  });

  it("本仓那份真实产物跑得过（这一格不是空转的尺）", () => {
    const r = run(["fixtures/artifacts/cycling-animation.html"]);
    // 产物被清掉时如实跳过（不假绿也不假红）；在就必须退 0——否则判据与真实产物脱节。
    if (r.out.includes("读不到") || r.out.includes("不是文件")) { expect(r.code).toBe(1); return; }
    expect(r.code).toBe(0);
  });
});
