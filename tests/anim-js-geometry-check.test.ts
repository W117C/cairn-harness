/** JS/CSS 动画运动学自检的判卷（2026-10-17）。
 *
 *  为什么第二把尺：`anim-geometry-check` 只认 SVG 逐帧 `values`，而实测四趟真实模型
 *  **没有一趟**用那种形态（三趟 requestAnimationFrame、一趟纯 CSS）。第一把尺对它们只能报
 *  「无法静态判定」——指出了问题，却没让那类产物**可被判**，于是「用 JS 写」事实上成了
 *  一条绕过运动学判卷的路。这一格补的就是那个缺口。
 *
 *  判据的重心因此在两件反直觉的事上：
 *   ① **它真的会红**——每条判据各造一个坏片段；
 *   ② **它不许假绿**——本格**自己造过两次逃逸通道**，两次都是实测抓出来的：
 *      - 第一次：判「源码里提没提到 knee/thigh/shin」。g3 产物把腿叫 `right-leg-lower`，
 *        名字里一个膝字都没有 ⇒ 判据整条跳过，而它实际是把末端直接钉到踏板坐标
 *        （髋到踏板一条直线，没有膝关节）⇒ 拿到全过。**改判行为，不判命名。**
 *      - 第二次：轮子同期按「整个 rotate 串去重」。两个前後轮的旋转中心必然不同
 *        （`rotate(a,300,300)` 与 `rotate(a,500,300)`）⇒ 正确写法被判成不同步。
 *        **只比角度表达式，不比整串。**
 *      这两条都留了反向用例钉住——判卷器自己造逃逸通道，比没有判卷更坏。
 *
 *  断言一律走子进程（这就是 verify 调用它的方式），不在进程里 import 后调 main。 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts", "anim-js-geometry-check.ts");

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
  dir = join(ROOT, ".tmp", "anim-js-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  rel = ".tmp/" + dir.slice(join(ROOT, ".tmp/").length);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 把一段 JS 包进最小 HTML。 */
const page = (js: string): string =>
  `<!doctype html><html><body><svg id="s" viewBox="0 0 800 500"></svg><script>\n${js}\n</script></body></html>`;

const write = (name: string, js: string): string => {
  writeFileSync(join(dir, name), page(js));
  return join(rel, name);
};

describe("正向：写对了的式子必须退 0", () => {
  it("两轴同半径、一 sin 一 cos、两腿反相、膝真求解 ⇒ 一声不出", () => {
    const f = write("ok.html", `
      let angle = 0; const R = 30;
      function animate(){
        const rightFootX = 350 + R * Math.sin(angle);
        const rightFootY = 250 - R * Math.cos(angle);
        const leftFootX  = 350 - R * Math.sin(angle);
        const leftFootY  = 250 + R * Math.cos(angle);
        const d = Math.sqrt(dx*dx + dy*dy);
        const k = Math.atan2(dy, dx) + Math.acos((L1*L1 + d*d - L2*L2)/(2*L1*d));
        requestAnimationFrame(animate);
      }
      animate();`);
    expect(run([f]).code).toBe(0);
  });

  it("两个轮子共用同一个角度表达式 ⇒ 不报不同步（旋转中心不同不是转速不同）", () => {
    const f = write("wheels.html", `
      let angle = 0;
      function animate(){
        const wheelRotation = angle * 180 / Math.PI;
        rear.setAttribute('transform', \`rotate(\${wheelRotation}, 300, 300)\`);
        front.setAttribute('transform', \`rotate(\${wheelRotation}, 500, 300)\`);
        requestAnimationFrame(animate);
      }
      animate();`);
    // 注意：退 0 时「全过」文案里本身就含「刚体同期」这四个字，
    // 所以这里断言的是**没有报出那条问题文案**（而不含字面），退 0 才是不报的凭据。
    const r = run([f]);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/必须同期旋转/);
  });

  it("结束标签带 parser-error 属性时仍只读 script 正文，不把后面的页面文本当 JS", () => {
    writeFileSync(join(dir, "script-end-tag.html"), `<!doctype html><html><body>
      <script>
        const footX = 350 + R * Math.sin(angle);
        const footY = 250 - R * Math.cos(angle);
        requestAnimationFrame(() => {});
      </script data-test="kept">
      <p>const badX = 350 + R1 * Math.sin(angle);</p>
      <p>const badY = 250 - R2 * Math.cos(angle);</p>
      </script>
    </body></html>`);
    expect(run([join(rel, "script-end-tag.html")]).code).toBe(0);
  });
});

describe("反向：每条判据各有一个会红的片段", () => {
  it("① 两轴半径不同 ⇒ 脚走椭圆不是圆", () => {
    const f = write("m1.html", `
      function animate(){
        const footX = 350 + R1 * Math.sin(angle);
        const footY = 250 - R2 * Math.cos(angle);
        requestAnimationFrame(animate);
      }`);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/椭圆不是圆/);
  });

  it("① 两轴用了同一个三角函数 ⇒ 退化成一条直线", () => {
    const f = write("m1b.html", `
      function animate(){
        const footX = 350 + R * Math.sin(angle);
        const footY = 250 - R * Math.sin(angle);
        requestAnimationFrame(animate);
      }`);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/同一个三角函数/);
  });

  it("② 两腿同相（共圆心共半径同号）⇒ 相位差 0° 不是 180°", () => {
    const f = write("m2.html", `
      function animate(){
        const rightFootX = 350 + R * Math.sin(angle);
        const rightFootY = 250 - R * Math.cos(angle);
        const leftFootX  = 350 + R * Math.sin(angle);
        const leftFootY  = 250 - R * Math.cos(angle);
        requestAnimationFrame(animate);
      }`);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/相位差是 0°/);
  });

  it("③ 腿末端直接钉到踏板、没有膝点求解 ⇒ 那是一条直线不是两段 IK", () => {
    // 这正是实测里假绿那一类（g3 产物：rightLegLower.setAttribute('x2', 踏板坐标)）
    const f = write("m3.html", `
      function animate(){
        rightLegLower.setAttribute('x2', rightPedalX.toString());
        rightLegLower.setAttribute('y2', rightPedalY.toString());
        leftLegLower.setAttribute('x2', leftPedalX.toString());
        leftLegLower.setAttribute('y2', leftPedalY.toString());
        requestAnimationFrame(animate);
      }`);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/不是两段 IK/);
  });

  it("③ 的反面：同样钉末端，但有膝点求解 ⇒ 不报（判的是行为不是命名）", () => {
    const f = write("m3ok.html", `
      function animate(){
        const d = Math.sqrt(dx*dx + dy*dy);
        const k = Math.atan2(dy, dx) + Math.acos((L1*L1 + d*d - L2*L2)/(2*L1*d));
        rightLegLower.setAttribute('x2', rightPedalX.toString());
        requestAnimationFrame(animate);
      }`);
    expect(run([f]).code).toBe(0);
  });

  it("④ 骨长互相覆盖 ⇒ IK 解必然退化", () => {
    const f = write("m4.html", `
      const thighLength = 46;
      const shinLength = thighLength;
      function animate(){
        const d = Math.sqrt(dx*dx+dy*dy);
        requestAnimationFrame(animate);
      }`);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/骨长互相覆盖/);
  });

  it("⑤ 两个轮子用了不同的角度表达式 ⇒ 不同步", () => {
    const f = write("m5.html", `
      let a = 0, b = 0;
      function animate(){
        const r1 = a * 180 / Math.PI;
        const r2 = b * 90 / Math.PI;
        rear.setAttribute('transform', \`rotate(\${r1}, 300, 300)\`);
        front.setAttribute('transform', \`rotate(\${r2}, 500, 300)\`);
        requestAnimationFrame(animate);
      }`);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/同期旋转/);
  });
});

describe("适用面", () => {
  it("canvas 画骨架 + 没解膝点 ⇒ 必须红（setAttribute 那一族之外的第二族）", () => {
    // 实测假绿（z5）：91 处 ctx.* 、0 处 setAttribute，腿是 moveTo(肩)→lineTo(脚) 一段直达。
    // 只认 setAttribute("x2"/"y2") 的话，整个 canvas 那一族都会绕过这一格。
    const f = write("canvas.html", `<!doctype html><html><body><canvas id="c"></canvas><script>
      const ctx = document.getElementById('c').getContext('2d');
      let a = 0;
      function draw(){
        a += 0.02;
        const fx = 300 + Math.cos(a) * 20, fy = 200 + Math.sin(a) * 20;
        ctx.beginPath();
        ctx.moveTo(250, 150);   // 肩
        ctx.lineTo(fx, fy);     // 直达脚：一段，不是两段
        ctx.stroke();
        requestAnimationFrame(draw);
      }
      draw();
    </script></body></html>`);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/canvas 画骨架/);
  });

  it("只出现 Math.acos 不算解膝点（acos 常用于给椭圆定旋转角，不是两圆交点）", () => {
    // 实测假绿同源（z5）：`Math.acos(-0.5)` 是给羽毛椭圆定旋转角的常数。
    // 把它当成"解了膝" ⇒ 整条放行。解两连杆 IK 必须算距离（sqrt/hypot）或方向角（atan2）。
    const f = write("acos.html", `<!doctype html><html><body><canvas id="c"></canvas><script>
      const ctx = document.getElementById('c').getContext('2d');
      ctx.ellipse(100, 100, 12, 8, Math.acos(-0.5), 0, Math.PI * 2);
      ctx.beginPath(); ctx.moveTo(250,150); ctx.lineTo(300,200); ctx.stroke();
    </script></body></html>`);
    expect(run([f]).code).toBe(1);
  });

  it("有动画迹象却一段骨架都没解析到 ⇒ 必须置红（不许读成全过）", () => {
    // 实测假绿（z6，2026-10-17）：CSS @keyframes + DOM transform 画，<script> 里只有轮子旋转，
    // 全文 0 处 sqrt/hypot/atan2、0 处 setAttribute、0 处 ctx.* ⇒ 本格一格都没命中，
    // 打印「全过」，而它根本没有腿。这是这一族判据的第八次逃逸形状。
    const f = write("legless.html", `<!doctype html><html><head><style>
      @keyframes spin { to { transform: rotateY(360deg); } }
      .wheel { animation: spin 1.25s linear infinite; }
    </style></head><body>
    <div class="wheel"></div><div></div><div></div>
    <script>
      let a = 0;
      function updateWheels() {
        a += 0.008;
        document.querySelector('.wheel').style.transform = 'rotateY(' + a + 'deg)';
        requestAnimationFrame(updateWheels);
      }
      updateWheels();
    </script></body></html>`);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/无法静态判定/);
  });

  it("纯 CSS 动画（0 个 <script>）不许假绿", () => {
    // 实测假绿（w3，2026-10-17）：产物是纯 CSS @keyframes、全文无 <script>，
    // 本格读不到式子直接退 0 打印「全过」，而它里面连膝和骨长都没有。
    // 这是本格的第四种逃逸形状，与另一把尺的第 ⑧ 格同源。
    writeFileSync(
      join(dir, "css-only.html"),
      `<!doctype html><html><head><style>
         @keyframes spin { to { transform: rotate(360deg); } }
         .wheel { animation: spin 2s linear infinite; }
       </style></head><body><div class="wheel"/></body></html>`,
    );
    const r = run([join(rel, "css-only.html")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/无法静态判定/);
  });

  it("没有 <script> 的静态页 ⇒ 本格不适用，退 0（不是「干净」，是「无可判对象」）", () => {
    writeFileSync(join(dir, "static.html"), "<!doctype html><html><body><h1>hi</h1></body></html>");
    expect(run([join(rel, "static.html")]).code).toBe(0);
  });

  it("没有参数 ⇒ 退 2（不假装干净）", () => {
    expect(run([]).code).toBe(2);
  });

  it("绝对路径 ⇒ 退 2（与其余判卷同口径）", () => {
    expect(run([join(dir, "x.html")]).code).toBe(2);
  });

  it("非 HTML ⇒ 退 2", () => {
    writeFileSync(join(dir, "x.txt"), "hello");
    expect(run([join(rel, "x.txt")]).code).toBe(2);
  });

  it("文件不存在 ⇒ 红，并点名读不到", () => {
    const r = run([join(rel, "nope.html")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/读不到/);
  });
});
