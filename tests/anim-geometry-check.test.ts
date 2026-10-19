/** 动画产物**运动学**自检的判卷（2026-10-17）。
 *
 *  为什么值得单独立一个判卷文件：它补的是 `html-artifact-check` 的**盲区**。那一格只验字节层
 *  （存在/零外链/无占位符/本地引用齐），而鹈鹕那次真实失败里那四样**全过了**——它坏在几何上：
 *  膝盖被 IK 选肢钉死、脚偏离曲柄圆、两腿同相。字节层一格都看不见。
 *
 *  判据的重心因此不在脚本内部逻辑多精巧，而在三件事：
 *   ① **它真的会红**——每条判据各造一个坏产物，逐个钉（少一格就等于那条判据是装饰）；
 *   ② **它不假绿**——最要紧的那一格：文件里有动画迹象却解析不到骨架时**必须置红**。
 *      实测踩过：一份用 requestAnimationFrame 写的产物（全文 0 个 `<animate>`）拿到了全绿，
 *      而那份产物的「IK」是把小腿按大腿同一个角度旋转再固定偏移，根本没有膝关节。
 *      「没解析到」与「数据没问题」在退出码上同形，等于给了一条绕过整把尺的免费通道；
 *   ③ **好标本仍绿**——本仓那份 pelican-bicycle.html 是已知正确的（脚贴踏板偏差 0.001px），
 *      它必须退 0，否则这把尺在把正确产物判红。
 *
 *  断言一律走子进程（这就是 verify 调用它的方式），不在进程里 import 后调 main——那样测不到退出码。 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts", "anim-geometry-check.ts");

type Run = { code: number; out: string };
/** cwd 留在仓库根：脚本用 `--import tsx`，而 tsx 只在仓库的 node_modules 里。
 *  判卷数据落在 `.tmp/<uuid>` 下（脚本只吃工作区相对路径），跑完删。 */
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
  dir = join(ROOT, ".tmp", "anim-geometry-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  rel = ".tmp/" + dir.slice(join(ROOT, ".tmp/").length);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 九帧骨架：`f(i)` 返回第 i 帧的 [根x,根y, 中x,中y, 末x,末y]。 */
function skeleton(f: (i: number) => number[], n = 9): string {
  const frames: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = f(i);
    frames.push(`M${p[0]} ${p[1]} L${p[2]} ${p[3]} L${p[4]} ${p[5]}`);
  }
  return frames.join(";");
}

/** 包一份最小 SVG：脚沿半径 r 的圆走，两腿反相。这就是本仓那份标本的形状。 */
function svg(legs: string[], extra = ""): string {
  return `<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">
  <g id="rig">
    <g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1.2s" repeatCount="indefinite"/><circle r="70"/></g>
    <g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1.2s" repeatCount="indefinite"/><circle r="70"/></g>
  </g>
  ${legs.map((v) => `<path><animate attributeName="d" dur="1.2s" repeatCount="indefinite" values="${v}"/></path>`).join("\n")}
  ${extra}
</svg>`;
}

/** 一条正确的腿：根固定、骨长恒定（两段恒 46）、末点沿半径 28 的圆（圆心 398,360）走。
 *  膝的位置**真的解两连杆 IK**（与 `gen_legs.py` 同形），不能手写一个近似中点——
 *  那样大腿/小腿长度会随脚的位置变化，第 ③ 格（骨长恒定）当场就把好标本判红。 */
const L1 = 46;
const L2 = 46;
function solveKnee(hip: [number, number], foot: [number, number]): [number, number] {
  const dx = foot[0] - hip[0];
  const dy = foot[1] - hip[1];
  const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(L1 - L2) + 0.01), L1 + L2 - 0.01);
  const a = Math.atan2(dy, dx);
  const cosF = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
  const phi = Math.acos(cosF);
  return [hip[0] + L1 * Math.cos(a + phi), hip[1] + L1 * Math.sin(a + phi)];
}
const goodLeg = (phaseDeg: number): string =>
  skeleton((i) => {
    const t = (((45 * i + phaseDeg) * Math.PI) / 180);
    const hip: [number, number] = [358, 312];
    const foot: [number, number] = [398 + 28 * Math.cos(t), 360 + 28 * Math.sin(t)];
    const knee = solveKnee(hip, foot);
    return [hip[0], hip[1], knee[0], knee[1], foot[0], foot[1]];
  });

describe("正向：好标本必须退 0", () => {
  it("本仓那份 pelican-bicycle.html（已知正确：脚贴踏板偏差 0.001px）", () => {
    const r = run(["pelican-bicycle.html"]);
    expect(r.code).toBe(0);
  });

  it("两条反相的腿：一声不出", () => {
    writeFileSync(join(dir, "ok.svg"), svg([goodLeg(0), goodLeg(180)]));
    const r = run([join(rel, "ok.svg")]);
    expect(r.code).toBe(0);
  });
});

describe("反向：每条判据各有一个会红的产物", () => {
  it("① 循环不闭合：首尾关键帧不重合", () => {
    const frames = goodLeg(0).split(";");
    frames.pop(); // 去掉收尾那一帧（=第一帧那份）
    writeFileSync(join(dir, "m.svg"), svg([frames.join(";")]));
    const r = run([join(rel, "m.svg")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/循环不闭合/);
  });

  it("② 根点漂移：骨架根部跨关键帧滑动", () => {
    writeFileSync(join(dir, "m.svg"), svg([skeleton((i) => {
      const t = ((45 * i) * Math.PI) / 180;
      return [358 + 2 * i, 312, 400, 330, 398 + 28 * Math.cos(t), 360 + 28 * Math.sin(t)];
    })]));
    const r = run([join(rel, "m.svg")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/根点/);
  });

  it("③ 骨长拉伸：刚性肢体被拉长", () => {
    writeFileSync(join(dir, "m.svg"), svg([skeleton((i) => {
      const t = ((45 * i) * Math.PI) / 180;
      return [358, 312, 400 - 2 * i, 330, 398 + 28 * Math.cos(t), 360 + 28 * Math.sin(t)];
    })]));
    const r = run([join(rel, "m.svg")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/骨长/);
  });

  it("④ 末点不在圆上：脚脱离了踏板轨道", () => {
    writeFileSync(join(dir, "m.svg"), svg([skeleton((i) => {
      const t = ((45 * i) * Math.PI) / 180;
      return [358, 312, 400, 330, 398 + 28 * Math.cos(t) + 7 * (i % 3), 360 + 28 * Math.sin(t)];
    })]));
    const r = run([join(rel, "m.svg")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/末点不在同一圆上/);
  });

  it("⑤ 双腿同相：两条腿写成同一组数", () => {
    writeFileSync(join(dir, "m.svg"), svg([goodLeg(0), goodLeg(0)]));
    const r = run([join(rel, "m.svg")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/相位差不是 180°/);
  });

  it("⑥ spline 配平：keySplines 段数与关键帧数不符", () => {
    writeFileSync(
      join(dir, "m.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg">
         <path><animate attributeName="d" dur="1s" calcMode="spline" keySplines="0.4 0 0.6 1"
           values="M0 0 L1 1;M0 0 L2 2;M0 0 L3 3"/></path>
       </svg>`,
    );
    const r = run([join(rel, "m.svg")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/keySplines 有 1 段，需要 2 段/);
  });

  it("⑦ 同半径旋转体不同期：两个旋转体周期不一致", () => {
    // 必须**带一条骨架**：只放轮子的话，第 ⑧ 格（无骨架不许假绿）会先把它截住——
    // 那是对的行为，但这条要钉的是轮子那一格，所以夹具里给一条正确的腿。
    writeFileSync(
      join(dir, "m.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg">
        <g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1.2s"/><circle r="70"/></g>
        <g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2.4s"/><circle r="70"/></g>
        <path><animate attributeName="d" dur="1.2s" repeatCount="indefinite" values="${goodLeg(0)}"/></path>
      </svg>`,
    );
    const r = run([join(rel, "m.svg")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/周期不一致/);
  });
});

describe("⑧ 不许假绿：有动画迹象却解析不到骨架 ⇒ 红", () => {
  it("用 JS/requestAnimationFrame 写的动画（0 个 <animate>）不得算「全过」", () => {
    // 这正是实测里拿到假绿的那一类：全文无 <animate>，本格一条骨架都解析不到。
    writeFileSync(
      join(dir, "raf.html"),
      `<!doctype html><html><body><div id="d"></div><script>
         function animate(){ d.style.transform="rotate(1rad)"; requestAnimationFrame(animate); }
         animate();
       </script></body></html>`,
    );
    const r = run([join(rel, "raf.html")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/无法静态判定/);
  });

  it("CSS @keyframes 动画同样不许假绿", () => {
    writeFileSync(
      join(dir, "css.html"),
      `<!doctype html><html><head><style>@keyframes spin{to{transform:rotate(360deg)}}
         div{animation:spin 2s linear infinite}</style></head><body><div/></body></html>`,
    );
    const r = run([join(rel, "css.html")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/无法静态判定/);
  });

  it("完全没有动画的静态页面：不报（那时确实没有可判的运动学）", () => {
    writeFileSync(join(dir, "static.html"), "<!doctype html><html><body><h1>hello</h1></body></html>");
    const r = run([join(rel, "static.html")]);
    expect(r.code).toBe(0);
  });
});

describe("用法面", () => {
  it("没有参数 ⇒ 退 2（不假装干净）", () => {
    expect(run([]).code).toBe(2);
  });

  it("绝对路径 ⇒ 退 2（与其余判卷同口径）", () => {
    expect(run([join(dir, "x.svg")]).code).toBe(2);
  });

  it("非 HTML/SVG ⇒ 退 2（不拿 .txt 当动画猜）", () => {
    writeFileSync(join(dir, "x.txt"), "hello");
    expect(run([join(rel, "x.txt")]).code).toBe(2);
  });

  it("文件不存在 ⇒ 红，并点名读不到", () => {
    const r = run([join(rel, "nope.svg")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/读不到/);
  });
});
