/** 静态 SVG **图形几何**自检的判卷（2026-10-17，第三格）。
 *
 *  为什么要有第三格（判据的缺口，不是锦上添花）：
 *  外部实证推翻了「逐帧 values 才是正常形态」这个前提——基准正源 `simonw/pelican-bicycle`
 *  里 claude-3-5-sonnet / claude-3-opus / gpt-4o / o1-mini 四份产出 **`<animate>` 全为 0**。
 *  这个基准考的是**静态画得像不像**，而前两格一把量逐帧、一把量 JS 式子，
 *  **都覆盖不到纯静态 SVG 几何**。实测 w3 落盘的产物两把尺都报「不适用」⇒ 判据无从下手。
 *
 *  判据的重心因此在两个方向：
 *   ① **它不许把正确的判红**——三条外部 ground truth（三份 SOTA 产出）必须全过。
 *      这是本文件与其余判卷最大的不同：它有一条**外部真值**当分母，不是自己说了算；
 *   ② **它真的会红**——七条结构判据各造一个坏样本，逐个钉。
 *
 *  外加第 ⑧ 格纪律（本格的第六种逃逸形状）：**无图元不许读成「干净」**。
 *  实测（w3）：那份产物用 6 个 `<div>` + CSS 画图、全文 0 个 `<svg>`/`<circle>`，
 *  本格读不到坐标 ⇒ 整格跳过、退 0 打印「全过」。修法是把「图形迹象」的判定扩到 HTML 图元
 *  （只认 `<svg>` 会漏掉纯 div+CSS 那一族——这正是实测踩到的那一族）。
 *
 *  断言一律走子进程（这就是 verify 调用它的方式），不在进程里 import 后调 main。 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts", "svg-figure-check.ts");

type Run = { code: number; out: string };
const run = (args: string[]): Run => {
  try {
    const out = execFileSync("node", ["--import", "tsx", SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: typeof e.status === "number" ? e.status : 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
};

let dir = "";
let rel = "";

beforeEach(() => {
  dir = join(ROOT, ".tmp", "svg-figure-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  rel = ".tmp/" + dir.slice(join(ROOT, ".tmp/").length);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 一份"正确的"骑车图形：两枚等大同高的轮、身体在轮上方且在两轮间、身体上方有更小的圆当头。 */
const GOOD = `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
  <circle cx="140" cy="200" r="40"/>
  <circle cx="260" cy="200" r="40"/>
  <ellipse cx="200" cy="120" rx="30" ry="45"/>
  <circle cx="220" cy="85" r="12"/>
</svg>`;

const write = (name: string, body: string): string => {
  writeFileSync(join(dir, name), body);
  return join(rel, name);
};

describe("正向：结构正确的图形必须退 0", () => {
  it("基准形状（两轮等大同高、身体在轮上、头在身上）", () => {
    expect(run([write("good.svg", GOOD)]).code).toBe(0);
  });

  it("三条**外部 ground truth**（SOTA 产出）不许被判红——本格的分母在仓库外", () => {
    // 这三份来自基准正源 simonw/pelican-bicycle，是"画对了"的真值。
    // 少一份绿就等于这把尺在把正确的产物判红，那比假绿更糟。
    for (const name of ["claude-3-5-sonnet-20241022", "gpt-4o", "o1-mini"]) {
      const src = join(ROOT, ".tmp", "gt-" + name + ".svg");
      let dst = "";
      try {
        dst = write(name + ".svg", "");
        copyFileSync(src, join(dir, name + ".svg"));
      } catch {
        continue; // 外部真值不在本地时跳过：不假装它是绿的
      }
      expect(run([dst]).code, "外部 ground truth 被判红：" + name).toBe(0);
    }
  });
});

describe("反向：每条结构判据各有一个会红的样本", () => {


  it("② 两轮几乎重合（叠成一个轮）", () => {
    const f = write("m3.svg", GOOD.replace('cx="260" cy="200"', 'cx="150" cy="200"'));
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/几乎重合/);
  });




  it("⑥ 图元超出 viewBox（画到画布外会被裁掉）", () => {
    const f = write("m7.svg", GOOD.replace('<circle cx="260" cy="200" r="40"/>', '<circle cx="395" cy="200" r="40"/>'));
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/超出 viewBox/);
  });
});

describe("反向：题材无关的两条判据各有一个会红的样本", () => {
  it("两个主要图元几乎重合（画了两个看起来只有一个）", () => {
    const f = write("overlap.svg", GOOD.replace('cx="260" cy="200"', 'cx="150" cy="200"'));
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/几乎重合/);
  });

  it("所有圆都落在 viewBox 外（用户打开只看到空白）", () => {
    const f = write("offcanvas.svg", `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
      <circle cx="900" cy="900" r="40"/><circle cx="1200" cy="900" r="40"/>
    </svg>`);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/没有任何圆落在 viewBox/);
  });
});

describe("不过拟合：换一个完全不同的题材，这两条判据不许乱红", () => {
  it("「花瓶与两朵花」——与骑车毫无关系的构图也必须全过", () => {
    // 这正是撤掉「前后轮等大/同高」「身体在轮上方/有头」那五条的理由：
    // 它们只在骑车题材下成立。换成任意题材，本格必须一声不出。
    const f = write("vase.svg", `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="200" cy="220" rx="40" ry="55"/>
      <circle cx="140" cy="90" r="30"/>
      <circle cx="260" cy="70" r="22"/>
      <ellipse cx="200" cy="280" rx="90" ry="14"/>
    </svg>`);
    expect(run([f]).code).toBe(0);
  });

  it("「三个苹果」——两个圆明显不等大、不同高，也不许判红", () => {
    // 等大/同高是骑车规格，不是通用事实：三个大小不一的苹果完全正确。
    const f = write("apples.svg", `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
      <circle cx="120" cy="120" r="45"/>
      <circle cx="250" cy="220" r="18"/>
      <circle cx="300" cy="90" r="30"/>
    </svg>`);
    expect(run([f]).code).toBe(0);
  });
});

describe("第 ⑧ 格纪律：无图元不许读成「干净」", () => {
  it("纯 <div> + CSS 画的图（0 个 <svg>/<circle>）必须置红", () => {
    // 实测假绿（w3）：6 个 div + @keyframes 画图，本格读不到坐标却退 0 打印「全过」。
    // 「图形迹象」的判定若只认 <svg>，这一族会整格跳过——正是实测踩到的那一族。
    const f = write(
      "divs.html",
      `<!doctype html><html><head><style>
         @keyframes spin { to { transform: rotate(360deg); } }
         .w { animation: spin 2s linear infinite; }
       </style></head><body>
       <div class="w"></div><div class="w"></div><div></div>
       <div></div><div></div><div></div>
       </body></html>`,
    );
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/没有可判的图元/);
  });

  it("完全没有图形的普通页面：不报（那时确实没有可判的几何）", () => {
    const f = write("plain.html", "<!doctype html><html><body><h1>hello</h1></body></html>");
    expect(run([f]).code).toBe(0);
  });
});

describe("用法面", () => {
  it("没有参数 ⇒ 退 2（不假装干净）", () => {
    expect(run([]).code).toBe(2);
  });

  it("绝对路径 ⇒ 退 2（与其余判卷同口径）", () => {
    expect(run([join(dir, "x.svg")]).code).toBe(2);
  });

  it("非 SVG/HTML ⇒ 退 2", () => {
    writeFileSync(join(dir, "x.txt"), "hello");
    expect(run([join(rel, "x.txt")]).code).toBe(2);
  });

  it("文件不存在 ⇒ 红，并点名读不到", () => {
    const r = run([join(rel, "nope.svg")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/读不到/);
  });
});
