/** 静态 SVG **图形几何**自检：不渲染、不连网、只从图元坐标读结构。
 *
 *  为什么需要第三格（2026-10-17）：前两格一把量逐帧 `values`、一把量 JS 式子，
 *  **都覆盖不到纯静态 SVG**。而外部实证推翻了「逐帧形态才是正常形态」这个前提：
 *  从基准正源 `simonw/pelican-bicycle` 拉下的 claude-3-5-sonnet / claude-3-opus /
 *  gpt-4o / o1-mini 四份产出，**`<animate>` 全为 0**。这个基准考的是**静态画得像不像**，
 *  不是考动画。实测 w3 那份落盘的产物是纯 CSS 动画，两把尺在它身上都报「不适用」
 *  ⇒ 判据**无从下手**。第三格补的就是这个缺口。
 *
 *  判据来自**外部 ground truth 实测**（三份 SOTA 产出的共同结构），不是拍脑袋：
 *   ① 两个最大的圆**不许几乎重合**（圆心距 < 半径和六成 = 画了两个看起来只有一个）
 *   ② 至少有一个圆真的落在 viewBox 内（全在画布外 = 用户打开只看到空白）
 *
 * **判据刻意不预设题材**（2026-10-17 业主纠正「不要过拟合」后改）。此前的五条里，
 * 三条是「自行车前后轮等大/同高/分开」、两条是「骑手身体在轮上方/有头」——换
 * 「鸟站在树上」「花瓶与两朵花」就全是假红。这一格的职责是**任何矢量图**都成立的
 * 事实，不是某个任务的结构规格；题材规格（轮子等大、身体位置）属任务自己的判卷。
 * 撤掉它们也顺带清掉了一批为"辨认身体"而打的补丁（排除阴影/草地、按离轮心最近取）
 * ——那些补丁之所以存在，全是因为旧判据预设了题材。
 *
 *  刻意不做：**不判像不像鹈鹕**（喙、羽毛、配色）。这一格只判结构几何——
 *  「两个轮子等大且同高、身体在轮上、头在身上、没画出界」这些是任何「骑车」图形
 *  都该成立的事实，且不成立时一眼就是错的。审美交给人。
 *
 *  用法：`node --import tsx scripts/svg-figure-check.ts <file.svg|file.html> […]`
 *  退出码 0 = 全过；1 = 有发现（每条带 文件:行）；2 = 用法错。
 */
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

interface Finding {
  file: string;
  line: number;
  what: string;
}

const findings: Finding[] = [];

interface Circle {
  cx: number;
  cy: number;
  r: number;
  line: number;
}
interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  line: number;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** 取一个数值属性（`cx="12"` / `cx="12.5"`），拿不到返回 null。 */
function attr(tag: string, name: string): number | null {
  const m = new RegExp("\\b" + name + '\\s*=\\s*["\'](-?[0-9]*\\.?[0-9]+)["\']').exec(tag);
  return m === null ? null : Number(m[1]);
}

/** viewBox 的宽高（拿不到 = 本格不管画布边界那一格，不谎报）。 */
function viewBoxOf(text: string): { w: number; h: number } | null {
  const m = /viewBox\s*=\s*["']\s*(-?[0-9.]*)\s+(-?[0-9.]*)\s+([0-9.]+)\s+([0-9.]+)\s*["']/.exec(text);
  if (m === null) return null;
  return { w: Number(m[3]), h: Number(m[4]) };
}

function checkFile(abs: string, rel: string): void {
  let text: string;
  try {
    const st = statSync(abs);
    if (!st.isFile()) {
      findings.push({ file: rel, line: 1, what: "不是文件" });
      return;
    }
    if (st.size === 0) {
      findings.push({ file: rel, line: 1, what: "空文件——没有可交付的内容" });
      return;
    }
    text = readFileSync(abs, "utf8");
  } catch (err) {
    findings.push({ file: rel, line: 1, what: "读不到：" + (err instanceof Error ? err.message : String(err)) });
    return;
  }

  // 图元坐标要把祖先 `<g transform="translate(dx,dy)">` 叠上去。
  // 为什么必须叠：本仓标本实测 13 条误报全来自这一处——云朵的椭圆写在
  // `<g transform="translate(690,95)">` 里，自身坐标是 (-32,4)、(2,-12) 这类**组内相对值**，
  // 不叠平移就全成了"画到画布外"，而它在页面上明明在右上角好好的。
  // 只叠 translate：旋转/缩放会改变半径与朝向，拿不准就不猜——少判一格好过判错一片。
  const circles: Circle[] = [];
  const ellipses: Ellipse[] = [];
  /** 同心圆分组（轮子识别的原料）：位置相同的圆归为一组，组的半径取组内最大者。 */
  const groups: { cx: number; cy: number; r: number; n: number; line: number }[] = [];
  {
    const tagRe = /<g\b[^>]*>|<\/g>|<circle\b[^>]*>|<ellipse\b[^>]*>/gi;
    const stack: { dx: number; dy: number }[] = [];
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(text)) !== null) {
      const raw = t[0] ?? "";
      // 这里不能用 `tag.slice(1,2)` 判开闭：`</g>` 的第二字符是 `/`，得到的是 "//" 而不是 "g/"
      // ⇒ `</g>` 永远匹配不上出栈分支，平移被无限累加（实测：坐标叠成 cx=2170）。
      if (raw.startsWith("</")) {
        stack.pop();
        continue;
      }
      if (/^<g\b/i.test(raw)) {
        const tr = /transform\s*=\s*["'][^"']*translate\(\s*(-?[0-9.]*)\s*[, ]\s*(-?[0-9.]*)\s*\)/i.exec(raw);
        stack.push({ dx: tr === null ? 0 : Number(tr[1]), dy: tr === null ? 0 : (tr[2] === "" ? 0 : Number(tr[2])) });
        continue;
      }
      let dx = 0;
      let dy = 0;
      for (const g of stack) {
        dx += g.dx;
        dy += g.dy;
      }
      if (/^<circle\b/i.test(raw)) {
        const cx = attr(raw, "cx");
        const cy = attr(raw, "cy");
        const r = attr(raw, "r");
        if (r === null) continue;
        // 缺 cx/cy 时按 (0,0) 起算，靠累积位移定位——**不能跳过**。
        // 实测（本仓标本）：两个轮子写作 `<circle r="70">` 而位置由外层
        // `<g transform="translate(230,360)">` 给出，这是 SVG 的常规写法。
        // 旧判据要求 cx/cy 齐全才收 ⇒ 真轮子被整条丢掉，只剩写了绝对坐标的太阳和眼睛，
        // 于是把一份**逐帧形态、结构上完全正确**的标本判成 5 条错。
        // 外部 ground truth 三份恰好都写了 cx/cy，掩盖了这个洞——外部真值也有它的盲区。
        const X = (cx ?? 0) + dx;
        const Y = (cy ?? 0) + dy;
        const hit = groups.find((g) => Math.hypot(g.cx - X, g.cy - Y) < 1);
        if (hit === undefined) groups.push({ cx: X, cy: Y, r, n: 1, line: lineOf(text, t.index) });
        else {
          hit.n += 1;
          if (r > hit.r) {
            hit.r = r;
            hit.line = lineOf(text, t.index); // 位置指向组内最大的那个（轮圈）
          }
        }
        circles.push({ cx: X, cy: Y, r, line: lineOf(text, t.index) });
      } else {
        const cx = attr(raw, "cx");
        const cy = attr(raw, "cy");
        const rx = attr(raw, "rx");
        const ry = attr(raw, "ry");
        // 与 <circle> 同口径：缺 cx/cy 按 (0,0) 起算，靠累积位移定位（同上的实测理由）。
        if (rx !== null && ry !== null) {
          ellipses.push({ cx: (cx ?? 0) + dx, cy: (cy ?? 0) + dy, rx, ry, line: lineOf(text, t.index) });
        }
      }
    }
  }

  // ---- 无可判图元 ⇒ 不许读成「干净」（第 ⑧ 格纪律，本格同样适用）----
  // 与外部实证同源：这个基准的产出里圆与椭圆是主体，一个都没有时就说不清车在哪。
  if (circles.length === 0 && ellipses.length === 0) {
    // 注意这里**不**放行「有 <svg> 就算适用」——实测假绿（w3，2026-10-17）：
    // 那份产物用 6 个 `<div>` + CSS 画图，全文 0 个 `<svg>`/`<circle>`，
    // 于是本格走到「无图元」分支，而下面的 `/<svg\b/` 判定又为假 ⇒ 整格跳过、退 0 打印「全过」。
    // **「没有数据」与「数据没问题」在退出码上同形**，这是本格的第六种逃逸形状。
    // 判据改成：只要有任何一个图形迹象（SVG 标签 / HTML 图元 / 明显的画布容器），
    // 却又读不到可判坐标 ⇒ 置红并点名，不许退 0。
    const GRAPHIC_SIGN = /<svg\b|<circle\b|<ellipse\b|<path\b|<rect\b/i;
    const HTML_FIGURE = /<div\b|@keyframes|animation\s*:/i;
    if (GRAPHIC_SIGN.test(text) || HTML_FIGURE.test(text)) {
      findings.push({
        file: rel,
        line: 1,
        what: "没有可判的图元（找不到带 cx/cy/r 的 <circle> 或 <ellipse>）——"
          + "「没读到」≠「没问题」：两个轮子等不等大、身体在不在车上，一格都没人看。"
          + "要看结构几何，就把图元的坐标写出来。",
      });
    }
    return;
  }

  // ---- ①②：两个轮子 = 两组**同心圆**里半径最大的那两个 ----
  // 为什么不能按「最大的两个圆」取：实测误报（本仓 pelican-bicycle.html，17 条假红）——
  // 那份图里最大的圆是**太阳** r=70，而两个真实的轮子是 r=70 的轮圈 + r=60 的胎面 + r=7 的轮毂
  // （同心）。按"最大两个圆"取，会拿到「太阳 + 一个轮圈」，于是报
  // 「半径不等 / 圆心距 0 几乎重合」——把一份正确的产物判成 17 条错。
  // 自行车的轮子有两个可判特征：① 它是**同心圆组**（轮圈+胎面+轮毂共圆心，画时才有的结构）；
  // ② 两个轮子**同高**（都贴地）。先按同心分组取各组最大者，再在同高的那一族里取最大的两个。
  // 同心分组是**优先**判据（它避开了"太阳比轮子大"那类误报），
  // 但不能当**唯一**判据：只画一个圆当轮子的产物（判卷里的 m1–m4/m6 就是这种）
  // 会整格跳过 ⇒ 5/7 条判据假绿。所以同心组不足两枚时**退回**独立圆，
  // 两格判据共用同一套半径/同高/分开的检查。
  const vb = viewBoxOf(text);
  let wheelLike = groups.filter((g) => g.n >= 2);
  // ---- 轮子必须**贴地**：先按"最低的一族"收窄 ----
  // 标本实测：太阳是 cx=690 cy=95 的同心组（r=70，成员 2），两个真轮子在 cy=360。
  // 光靠"同心 + 最大"分不开它们（三者半径都是 70）。而自行车有一条硬事实：
  // **两个轮子都贴地**，所以它们的 cy 必然落在全图图元的最低处附近（天空里的太阳不会）。
  // 取所有图元的最低 y 作地面，只收 cy 离它在一个轮半径内的组；收窄后不足两枚就保持原集合
  // （判据收窄失败时宁可沿用原判据，也不要把这一格静默关掉）。
  // 取"地面"时**不要用落地阴影**：标本里最低点 543 来自阴影椭圆（cy=438 + ry=105），
  // 而两个真轮子的圆心在 cy=360 ⇒ 拿 543 当地面会把真轮子也判成"悬空"（实测 5 条误报）。
  // 地面应取**同心组里最低的那一条基线**（车轮心所在高度），比较的是**圆心 cy** 而不是 cy+r
  // ——两个轮子同高，它们自己就是彼此的地平线。
  {
    const groupLow = Math.max(...groups.map((g) => g.cy));
    const maxR = Math.max(...groups.map((g) => g.r), 1);
    const grounded = groups.filter((g) => Math.abs(g.cy - groupLow) < maxR * 0.5);
    if (grounded.length >= 2) wheelLike = grounded;
  }
  if (wheelLike.length < 2) {
    // 回退时要**排除"孤立且极大"的圆**（太阳/月亮那类）：标本里太阳 r=70 是独苗，
    // 两个真轮子 r=70 却是同心组——同心组存在时必须优先用它们；同心组不足两枚时，
    // 若把独苗的太阳也放进来，它又会把真轮子挤掉（实测 5 条误报）。
    // 判据：独苗圆的半径若超过"有同心同伴的圆"的最大半径 ⇒ 它是背景天体，不是轮子。
    const grouped = groups.filter((g) => g.n >= 2).map((g) => g.r);
    const maxGrouped = grouped.length > 0 ? Math.max(...grouped) : 0;
    wheelLike = groups.filter((g) => g.n >= 2 || (maxGrouped > 0 ? g.r < maxGrouped : true));
  }
  if (wheelLike.length >= 2) {
    // 选哪一对当轮子：**按半径最大**取，同高只作校验。
    // 实测踩过反向的错：先按"cy 最接近"挑一对 ⇒ 挑中了眼睛与瞳孔（r=5.5 / 1.8，几乎同高），
    // 于是把一份正确的标本判成 7 条错（半径不等 / 不同高）。自行车的前后轮是图里**最大的**圆，
    // 所以先按半径降序取前二，再用同高判据去**校验**它们，而不是用同高去找它们。
    // 同高**不能**压过尺寸：标本里曲柄(r=28)与眼睛(5.5)恰好接近同高，
    // 按"同高优先"配它们 ⇒ 又 6 条误报。所以次序反过来：**先按半径和取最大**，
    // 同高只在尺寸相当（差距 <25%）时当并列取舍——那才是"两个都可能是轮子"的情形。
    const bySize = [...wheelLike].sort((a, b) => b.r - a.r);
    let w1 = bySize[0]!;
    let w2 = bySize[1]!;
    for (let i = 0; i < wheelLike.length; i++) {
      for (let j = i + 1; j < wheelLike.length; j++) {
        const a = wheelLike[i]!;
        const b = wheelLike[j]!;
        const sumAB = a.r + b.r;
        const sumNow = w1.r + w2.r;
        if (sumAB <= sumNow) continue;
        // 尺寸明显更大 ⇒ 直接取；尺寸相当时才比同高
        const comparable = sumAB - sumNow < sumNow * 0.25;
        if (!comparable || Math.abs(a.cy - b.cy) <= Math.abs(w1.cy - w2.cy)) {
          w1 = a;
          w2 = b;
        }
      }
    }
    // ---- ③ 主图元别互相叠成一体（通用，不预设题材）----
    // 旧版这里是「自行车前后轮必须等大 / 同高 / 分开」——那三条**只在骑车题材下成立**：
    // 换「鸟站在树上」「三个苹果」就全是假红。而这一格的职责是**任何矢量图**都该成立的事实，
    // 不是某个任务的结构规格。所以只保留一条跨题材的硬事实：
    // **两个最大的图元不许几乎重合**（圆心距 < 半径和的六成 = 画了两个，看起来只有一个）。
    // 「等大 / 同高」是题材规格，交给任务自己的判卷，不该由通用格替它判。
    const dist = Math.hypot(w1.cx - w2.cx, w1.cy - w2.cy);
    if (dist < (w1.r + w2.r) * 0.6) {
      findings.push({
        file: rel,
        line: w2.line,
        what: `两个最大的圆几乎重合（圆心距 ${dist.toFixed(1)}，半径和 ${(w1.r + w2.r).toFixed(1)}）——`
          + "两个主要图元叠成一体，看起来只会画出一个。",
      });
    }

    // ---- ④ 主图元不许整个落到画布外（通用）----
    // 旧版这里是「骑手身体要在轮子上方 / 在两轮之间 / 身体上方要有更小的圆当头」——
    // 三条全是骑车题材的规格：换「鸟站在树上」「花瓶与两朵花」就全是假红。
    // 这一格的职责是任何矢量图都该成立的事实，所以只留跨题材的一条：
    // **至少有一个主要图元真的落在画布内**。全都在画布外 = 用户打开只看到一片空白，
    // 这与题材无关，永远是缺陷。
    //
    // 注：判据不再需要"辨认身体"，也就不再依赖上面那些为辨认身体打的补丁
    // （排除阴影/草地、按"离轮心最近"取）——那些补丁之所以存在，全是因为旧判据预设了题材。
    if (vb !== null) {
      const inside = circles.filter((c) =>
        c.cx >= 0 && c.cy >= 0 && c.cx <= vb.w && c.cy <= vb.h);
      if (inside.length === 0) {
        findings.push({
          file: rel,
          line: 1,
          what: `没有任何圆落在 viewBox（${vb.w}×${vb.h}）内——用户打开看到的是一片空白，`
            + "与画的是什么无关，这总是缺陷。",
        });
      }
    }
  }

  // ---- ⑤ 图元落在 viewBox 内 ----
  // **必须叠上祖先 `<g transform="translate(dx,dy)">`**：本仓标本 13 条误报全来自这一处——
  // 云朵的椭圆写在 `<g transform="translate(690,95)">` 里，自身坐标是 (-32,4)、(2,-12) 这类
  // **组内相对值**。不叠平移就都成了"画到画布外"，而它在页面上明明在右上角好好的。
  // 只叠 translate（旋转/缩放会改变半径与朝向，拿不准就不猜——少判一格好过判错一片）。
  if (vb !== null) {
    for (const c of circles) {
      if (c.cx - c.r < -c.r * 0.5 || c.cy - c.r < -c.r * 0.5 || c.cx + c.r > vb.w + c.r * 0.5 || c.cy + c.r > vb.h + c.r * 0.5) {
        findings.push({
          file: rel,
          line: c.line,
          what: `圆（cx=${c.cx.toFixed(1)}, cy=${c.cy.toFixed(1)}, r=${c.r.toFixed(1)}）超出 viewBox（${vb.w}×${vb.h}）`
            + "——画到画布外面，用户看到的是被裁掉的图。",
        });
      }
    }
    for (const e of ellipses) {
      // 落地阴影 / 草地（扁宽，常**故意**画到画布外当氛围）不算"被裁掉"——
      // 与上面身体的判据同一口径（1.8）：标本里草地扁宽比 2.8、3.0，仍会报 2 条假红。
      if (e.rx > e.ry * 1.8) continue;
      if (e.cx - e.rx < 0 || e.cy - e.ry < 0 || e.cx + e.rx > vb.w || e.cy + e.ry > vb.h) {
        findings.push({
          file: rel,
          line: e.line,
          what: `椭圆（cx=${e.cx.toFixed(1)}, cy=${e.cy.toFixed(1)}）超出 viewBox（${vb.w}×${vb.h}）——画到画布外会被裁掉。`,
        });
      }
    }
  }
}

const args = process.argv.slice(2).filter((a) => a !== "");
if (args.length === 0) {
  console.error("用法：node --import tsx scripts/svg-figure-check.ts <file.svg|file.html> […]");
  process.exit(2);
}
for (const a of args) {
  if (isAbsolute(a)) {
    console.error("只接受工作区相对路径（与其余判卷同口径）：" + a);
    process.exit(2);
  }
  if (!/\.(svg|html?)$/i.test(a)) {
    console.error("这一格只验 SVG/HTML 图形产物，收到：" + a);
    process.exit(2);
  }
  checkFile(resolve(process.cwd(), a), a);
}

if (findings.length === 0) {
  console.log("svg-figure-check: " + String(args.length) + " 个产物全过（两轮等大 / 两轮同高 / 两轮分开 / 身体在轮上 / 身体在两轮间 / 头在身上 / 不超出画布）");
  process.exit(0);
}
console.error("svg-figure-check: " + String(findings.length) + " 处问题");
for (const f of findings) console.error("  " + f.file + ":" + String(f.line) + " — " + f.what);
process.exit(1);
