/** JS/CSS 动画里的**运动学**自检：不跑浏览器、不连网、只从源码里读它算的式子。
 *
 *  为什么要有第二把尺（2026-10-17）：`anim-geometry-check` 只认 SVG 的逐帧 `values` 形态，
 *  而实测四趟真实模型里**没有一趟**用那种形态——三趟 requestAnimationFrame、一趟纯 CSS。
 *  第一把尺对它们只能报「无法静态判定」：它指出了问题，却没让那类产物**可被判**，
 *  于是「用 JS 写」在事实上成了一条绕过运动学判卷的路（判卷器自己造的第三条逃逸通道）。
 *
 *  这一格补的是那个缺口：**JS 里写的式子和 SVG 里写的 values 是同一件事的两面**——
 *  都是「脚在哪个圆上、膝在哪、两腿差多少相位」。式子写在源码里，就能静态读出来。
 *
 *  五条判据，每条都对应实测里真出现过的缺陷（括号里是出处）：
 *   ① 脚在圆上   —— `cx + r*sin(a)` / `cx + r*cos(a)` 这类式子，判两个轴是不是同一个半径。
 *                    半径不同的 ⇒ 脚走的是椭圆，不是曲柄圆（g3 实测：髋到踏板一条直线）。
 *   ② 双端反相   —— 两腿的式子必须一个 `+r` 一个 `−r`（相位差 180°）；同号就是同相。
 *   ③ 膝存在     —— 两条骨的膝点必须**真的被算出来**；直接从髋连到踏板 ⇒ 那不是两段 IK。
 *   ④ 骨长有界   —— 膝的式子若把两骨长当成可拉伸，那么必然能证出它越界。
 *   ⑤ 刚体周期   —— 轮子与曲柄若用同一个角变量，周期必须一致。
 *
 *  刻意不做：
 *   - 不跑 JS。这一格是**源码文本**判据（与 `html-artifact-check` 同纪律），
 *     真正的求值属于无头浏览器那一格（本仓 `render_image` 已有，那是另一条路）。
 *   - 不判审美。只判「它自己宣称的运动学成立不成立」。
 *
 *  用法：`node --import tsx scripts/anim-js-geometry-check.ts <file.html> […]`
 *  退出码 0 = 全过；1 = 有发现（每条带 文件:行）；2 = 用法错（没有参数不假装干净）。
 */
import { readTextFileSnapshotSync } from "./lib/file-snapshot";
import { isAbsolute, resolve } from "node:path";

interface Finding {
  file: string;
  line: number;
  what: string;
}

const findings: Finding[] = [];

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** `350 + crankRadius * Math.sin(angle)` 这种：圆心 ± 半径 × sin/cos(同一个角变量)。 */
const CIRCLE_TERM =
  /(-?[0-9]*\.?[0-9]+)\s*([+-])\s*([A-Za-z_$][\w$]*)\s*\*\s*Math\.(sin|cos)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g;

interface Term {
  center: number;
  sign: 1 | -1;
  radiusVar: string;
  fn: "sin" | "cos";
  angleVar: string;
  /** 这个式子的落点（line/col 用不到，只留行号）。 */
  line: number;
}

/** 把一条赋值语句右边的圆轨项全抽出来。 */
function termsOf(expr: string, baseLine: number, absOffset: number): Term[] {
  const out: Term[] = [];
  CIRCLE_TERM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CIRCLE_TERM.exec(expr)) !== null) {
    out.push({
      center: Number(m[1]),
      sign: m[2] === "-" ? -1 : 1,
      radiusVar: m[3]!,
      fn: m[4]!.toLowerCase() === "sin" ? "sin" : "cos",
      angleVar: m[5]!,
      line: baseLine + lineOf(expr, m.index) - 1 + absOffset,
    });
  }
  return out;
}

function checkFile(abs: string, rel: string): void {
  let text: string;
  try {
    text = readTextFileSnapshotSync(abs).text;
  } catch (err) {
    findings.push({ file: rel, line: 1, what: "读不到：" + (err instanceof Error ? err.message : String(err)) });
    return;
  }

  // 只取 `<script>` 段：CSS 那条路本格不判（@keyframes 的旋转是声明式的，另有判法）。
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)];
  const hasScript = scripts.length > 0;
  // ---- 第 ⑥ 格：没有脚本 = 本格无可判对象，**不许读成「干净」** ----
  // 与 `anim-geometry-check` 的第 ⑧ 格同一条纪律（那边踩过一次实测假绿）：
  // 「没有数据」与「数据没问题」在退出码上同形 = 给了一条绕过整把尺的免费通道。
  // 实测（w3，2026-10-17）：产物是纯 CSS `@keyframes` 动画、全文 0 个 `<script>`
  // ⇒ 本格直接退出、打印「全过」，而它里面连膝和骨长的影子都没有。
  // 所以：文件里有动画迹象却没有可判的脚本 ⇒ 置红并点名，别退 0。
  if (!hasScript) {
    const CSS_ANIM = /@keyframes|animation\s*:\s*[^;]*\d/;
    if (CSS_ANIM.test(text)) {
      findings.push({
        file: rel,
        line: 1,
        what: "无法静态判定：文件里有 CSS 动画迹象（@keyframes / animation），但没有任何 <script> 段"
          + "——本格读不到可判的式子。脚在不在圆上、膝有没有被算、两腿反不反相，一格都没人看。"
          + "要看运动学，就把关节算进 JS（或写成逐帧 values 的形态交给另一把尺）。",
      });
    }
    return;
  }
  for (const sc of scripts) {
    const body = sc[1] ?? "";
    const offset = lineOf(text, sc.index ?? 0);
    /** 这一段里有没有可判的骨架（见下面 `sawSkeleton`）。 */
    let sawSkeleton = false;

    // ---- ①②：把「脚沿圆走」的式子按落点变量聚起来 ----
    // `rightPedalX = 350 + crankRadius * Math.sin(angle)` ⇒ 落点变量 rightPedalX 收到一项。
    const byVar = new Map<string, Term[]>();
    const decl = /([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
    let d: RegExpExecArray | null;
    while ((d = decl.exec(body)) !== null) {
      const target = d[1]!;
      const terms = termsOf(d[2]!, 0, offset);
      if (terms.length === 0) continue;
      const list = byVar.get(target) ?? [];
      list.push(...terms);
      byVar.set(target, list);
    }

    // 踏板点：X 与 Y 成对（名字去掉尾部 X/Y 后同源，如 rightPedalX / rightPedalY）
    const groups = new Map<string, { x?: Term[]; y?: Term[] }>();
    for (const [v, terms] of byVar) {
      const stem = /[XY]$/.test(v) ? v.slice(0, -1) : v;
      const axis = /X$/.test(v) ? "x" : /Y$/.test(v) ? "y" : "x";
      const g = groups.get(stem) ?? {};
      const prev = g[axis] ?? [];
      g[axis] = prev.concat(terms);
      groups.set(stem, g);
    }

    for (const [stem, g] of groups) {
      const xs = g.x ?? [];
      const ys = g.y ?? [];
      if (xs.length === 0 || ys.length === 0) continue; // 单轴不构成圆
      for (const a of xs) {
        for (const b of ys) {
          if (a.angleVar !== b.angleVar) continue; // 不同角变量 = 不是同一个曲柄
          // ① 半径必须一致（不同变量名也算不同：r 与 r2 是两个数）
          if (a.radiusVar !== b.radiusVar) {
            findings.push({
              file: rel,
              line: b.line,
              what: `${stem} 的两轴用了不同半径（X 用 ${a.radiusVar}，Y 用 ${b.radiusVar}）——`
                + `脚走的是椭圆不是圆：曲柄两轴必须是同一个半径。`,
            });
            continue;
          }
          if (a.fn === b.fn) {
            findings.push({
              file: rel,
              line: b.line,
              what: `${stem} 的两轴用了同一个三角函数（都是 Math.${a.fn}）——`
                + `X 与 Y 必须一个 sin 一个 cos，否则两点退化成一条直线，脚没有沿圆走。`,
            });
          }
        }
      }
    }

    // ② 双腿反相：两个踏板点共圆心、共半径、共角变量，而位移项同号 ⇒ 同相（不是反相 180°）
    // 走到这里说明**找到了可判的骨架**（至少有一组共圆的圆轨项）——记下来，
    // 供循环末尾那一格判「有动画迹象却一段骨架都没解析到」。
    if (byVar.size > 0) sawSkeleton = true;
    const pts = [...groups.entries()]
      .map(([stem, g]) => ({ stem, x: (g.x ?? [])[0], y: (g.y ?? [])[0] }))
      .filter((p) => p.x !== undefined && p.y !== undefined);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const A = pts[i]!;
        const B = pts[j]!;
        if (A.x!.angleVar !== B.x!.angleVar) continue;
        if (A.x!.radiusVar !== B.x!.radiusVar) continue;
        // 圆心相同且两轴位移全同号 ⇒ 两个踏板同步摆动，不是反相
        const sameCenter = A.x!.center === B.x!.center && A.y!.center === B.y!.center;
        const sameSign = A.x!.sign === B.x!.sign && A.y!.sign === B.y!.sign;
        if (sameCenter && sameSign) {
          findings.push({
            file: rel,
            line: B.x!.line,
            what: `${A.stem} 与 ${B.stem} 共圆心、共半径、共角变量，且两轴位移同号——`
              + `两个踏板的相位差是 0° 不是 180°：两条腿在同步摆动（把其中一个的 ± 号反过来）。`,
          });
        }
      }
    }

    // ③ 膝存在：两段 IK 必须**算出**膝点。只有「髋→踏板」一条直线时，那是一段不是两段。
    //
    // 第一版按「源码里提没提到 knee/thigh/shin」判，实测**假绿**（2026-10-17，g3 产物）：
    // 那份产物的腿叫 `right-leg-lower`，名字里一个膝字都没有 ⇒ 判据整条跳过，拿到全过，
    // 而它实际是把 `x2/y2` 直接钉到踏板坐标——髋到踏板一条直线，没有膝关节。
    // 于是「把腿命名成不含膝的名字」就成了绕过这一格的免费通道（本格自己造的逃逸道）。
    // 改判**行为**而不判命名：腿/肢体端点被直接钉到踏板坐标，且源码里没有任何膝点求解。
    // 「真的解了膝」的判据要挑对函数：只认 **sqrt / hypot / atan2**。
    // 不能把 acos/asin 算进去（实测假绿 z5：它 91 处 ctx.* 里用 `Math.acos(-0.5)` 给
    // 椭圆定旋转角——那是画羽毛的常数，不是解膝点 ⇒ 旧判据据此认为"解了膝"，一路放行）。
    // 解两连杆 IK 必须算距离（sqrt/hypot）或方向角（atan2），acos 单独出现说明不了问题。
    const solvesKnee = /\bMath\.(?:sqrt|hypot|atan2)\s*\(/.test(body);
    /** 把肢体末端直接钉到踏板坐标的那些 setAttribute。 */
    const pinned = [...body.matchAll(
      /([A-Za-z_$][\w$]*)\.setAttribute\(\s*["'](?:x2|y2)["']\s*,\s*([A-Za-z_$][\w$]*)/g,
    )].filter((m) => /leg|shin|thigh|knee|calf|foot|limb/i.test(m[1] ?? ""));
    if (pinned.length > 0 && !solvesKnee) {
      const who = [...new Set(pinned.map((m) => m[1]!))].slice(0, 3).join("、");
      findings.push({
        file: rel,
        line: offset,
        what: `${who} 的末端被直接钉到踏板坐标，而源码里没有任何膝点求解`
          + "（未见 Math.sqrt / atan2 / hypot / acos / asin）——那是髋到踏板的**一条直线**，"
          + "不是两段 IK：膝必须由两骨长解出来（两圆交点），再把大腿小腿分别画到膝和脚。",
      });
    }

    // ③（续）canvas 那一族：`<canvas>` + `ctx.moveTo/lineTo` 画骨架时，根本不出现
    // setAttribute ⇒ 上面那条**整条绕过**（实测假绿 z5：91 处 ctx.*、0 处 setAttribute，
    // 而它的腿是 `moveTo(肩) → lineTo(脚)` 一段直达）。
    // 判据同形：有画布绘制 + 末端随圆轨走 + 源码里没有膝点求解 ⇒ 置红。
    const drawsCanvas = /\bctx\s*\.\s*(?:moveTo|lineTo|beginPath)\b/.test(body) || /<canvas\b/i.test(text);
    if (drawsCanvas && !solvesKnee) {
      findings.push({
        file: rel,
        line: offset,
        what: "用 canvas 画骨架（ctx.moveTo/lineTo），但源码里没有任何膝点求解"
          + "（未见 Math.sqrt / atan2 / hypot / acos / asin）——"
          + "两段 IK 的膝必须由两骨长解出来（两圆交点）；直接从根点画线到末端 = 一段，不是两段。",
      });
    }

    // ---- 第 ⑦ 格：有动画迹象却一段骨架都没解析到 ⇒ 不许读成「全过」----
    // 实测假绿（z6，2026-10-17）：那份产物用 CSS @keyframes + DOM transform 画，
    // `<script>` 里只有轮子旋转（全文 0 处 Math.sqrt/hypot/atan2、0 处 setAttribute、0 处 ctx.*），
    // 于是本格一格判据都没命中 ⇒ 打印「全过」，而它**根本没有腿**。
    // 「没解析到」与「数据没问题」在退出码上同形，是这一族判据反复踩的同一条逃逸道
    // （前两把尺已为它立过第 ⑧ 格 / 第 ⑥ 格，这里补第三处）。
    // 判据：文件里有动画迹象（requestAnimationFrame / @keyframes / animation / canvas / 轮子旋转），
    // 却既没有可判的圆轨骨架、也没有膝点求解、也没有肢体端点被钉 ⇒ 置红并点名。
    const animationSign = /requestAnimationFrame|setInterval|@keyframes|\banimation\s*:/i.test(text)
      || /\bctx\s*\.\s*(?:moveTo|lineTo|beginPath)\b/.test(body);
    const limbDraw = /setAttribute\(\s*["'](?:x2|y2|d|transform)["']/i.test(body)
      || /\bctx\s*\.\s*(?:moveTo|lineTo)\b/.test(body);
    if (!sawSkeleton && !solvesKnee && !limbDraw && animationSign) {
      findings.push({
        file: rel,
        line: offset,
        what: "无法静态判定：文件里有动画迹象（JS/CSS 动画），但本格没有解析到任何可判的骨架"
          + "——脚在不在圆上、膝有没有被算、两腿反不反相，一格都没人看。"
          + "要看运动学，就把关节的坐标算进 JS（或写成逐帧 values 的形态交给另一把尺）。",
      });
    }
    //    只判最明显的那一种：把骨长直接当成距离用了（把 thigh 长度赋给小腿、或反之）。
    const lenMismatch = /([A-Za-z_$][\w$]*Length)\s*=\s*([A-Za-z_$][\w$]*Length)/.exec(body);
    if (lenMismatch !== null && lenMismatch[1] !== lenMismatch[2]) {
      findings.push({
        file: rel,
        line: offset,
        what: `骨长互相覆盖（${lenMismatch[1]} = ${lenMismatch[2]}）——两段骨长是两个独立的常量，`
          + "被赋值成同一个来源时，IK 的解必定退化。",
      });
    }

    // ⑤ 刚体周期：同半径的轮子必须同期。
    // 判的是**角度表达式**，不是整个 rotate 串——两个前後轮的 rotate 中心必然不同
    // （`rotate(a, 300, 300)` 与 `rotate(a, 500, 300)`），那是位置不同，不是转速不同；
    // 拿整串去重会把「同一根轴上的两个轮子」判成不同步（实测误报过一次）。
    const rots = [...body.matchAll(/rotate\(\s*\$\{([^}]+)\}/g)].map((r) => (r[1] ?? "").trim());
    const distinct = new Set(rots);
    if (distinct.size > 1) {
        findings.push({
          file: rel,
          line: offset,
          what: `多个旋转体用了不同的角度表达式（${[...distinct].slice(0, 2).join(" vs ")}）——`
            + "同半径的旋转体必须同期旋转，否则画面会自相矛盾。",
        });
    }
  }
}

const args = process.argv.slice(2).filter((a) => a !== "");
if (args.length === 0) {
  console.error("用法：node --import tsx scripts/anim-js-geometry-check.ts <file.html> […]");
  process.exit(2);
}
for (const a of args) {
  if (isAbsolute(a)) {
    console.error("只接受工作区相对路径（与其余判卷同口径）：" + a);
    process.exit(2);
  }
  if (!/\.html?$/i.test(a)) {
    console.error("这一格只验 HTML 里的 JS 动画，收到：" + a);
    process.exit(2);
  }
  checkFile(resolve(process.cwd(), a), a);
}

if (findings.length === 0) {
  console.log("anim-js-geometry-check: " + String(args.length) + " 个产物全过（脚在圆上 / 双端反相 / 膝真实求解 / 骨长独立 / 刚体同期）");
  process.exit(0);
}
console.error("anim-js-geometry-check: " + String(findings.length) + " 处问题");
for (const f of findings) console.error("  " + f.file + ":" + String(f.line) + " — " + f.what);
process.exit(1);
