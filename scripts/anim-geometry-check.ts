/** 动画产物的**运动学**自检：不起浏览器、不连网、只看几何。
 *
 *  为什么要有这一格（2026-10-17）：`scripts/html-artifact-check.ts` 只验**字节层**
 *  （存在 / 零外链 / 无占位符 / 本地引用齐），而鹈鹕那次真实失败里那四样**全都过了**——
 *  它坏在几何上：膝被 IK 选肢钉死、脚偏离曲柄圆、两腿同相。字节层一格都看不见。
 *  `pel_verify.py` 倒是算了几何，可它把 NEAR/FAR 两组 `values` **硬编码在脚本里**：
 *  只能验本仓这一份标本，agent 新写的任何一份文件它一个字都看不了——
 *  「有尺」和「这把尺能量新东西」是两件事，此前只有前者。
 *
 *  这一格做的是后者：**从产物里把骨架解析出来，再判它自己宣称的运动学**。
 *  七条判据，每条都对应一类真实缺陷（不是套话，括号里是它在实测里的出处）：
 *   ① 循环闭合      —— `values` 首尾不重合 ⇒ 每圈接缝处跳一下（本仓标本 0.00px，是它该有的样子）
 *   ② 根点固定      —— 髋点跨关键帧漂移 ⇒ 整条腿在身上滑动
 *   ③ 刚肢长度恒定  —— 大腿/小腿长度逐帧变化 ⇒ 腿被拉伸了（两段 IK 里最常见的错）
 *   ④ 脚在圆上      —— 末点拟合圆，偏离即脱离踏板（旧标本记录过 22.9 单位）
 *   ⑤ 双腿反相      —— 两条共圆的腿相位差须≈180°；同相就是「两条腿写成同一组数」
 *   ⑥ spline 配平   —— `calcMode="spline"` 时 keySplines 段数须 = 关键帧数−1，否则按规范整段被弃
 *   ⑦ 同半径轮同期  —— 两个半径相同的轮子转一圈的时长必须一致，否则车在把自己撕开
 *
 *  刻意**不做**的：
 *   - 审美（好不好看）。这一格只判「它自己宣称的运动学成立不成立」，审美交给模型看图。
 *   - 曲柄轮速比。真实自行车有齿比，轮周期 ≠ 曲柄周期是**合法**的，判它就是把正确产物判红。
 *
 *  用法：`node --import tsx scripts/anim-geometry-check.ts <file.html|file.svg> […]`
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

/** 一个动画元素：`values` 的每一段是一个关键帧。
 *  `animateTransform` 的缓动配平与 `<animate>` 同罪（段数不符 ⇒ 整段缓动被丢弃），故一并扫。 */
const ANIMATE_D =
  /<animate\b[^>]*attributeName\s*=\s*["']d["'][^>]*?values\s*=\s*["']([^"']+)["'][\s\S]*?>/gi;
/** animateTransform rotate：取它的周期，用来判「同半径轮同期」。 */
const ROTATE_RE = /<animateTransform\b[^>]*\btype\s*=\s*["']rotate["'][^>]*>/i;
const DUR_OF = /\bdur\s*=\s*["']([^"']+)["']/i;
const KEYSPLINES_OF = /\bkeySplines\s*=\s*["']([^"']+)["']/i;
const CALCMODE_OF = /\bcalcMode\s*=\s*["']([^"']+)["']/i;
const CIRCLE_R = /<circle\b[^>]*\br\s*=\s*["']([0-9.]+)["']/gi;

/** "1.2s" / "1200ms" → 秒。取不到返回 null（不猜：周期是判据本身）。 */
function durSeconds(raw: string): number | null {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(ms|s)\s*$/i.exec(raw);
  if (m === null) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  return (m[2] ?? "").toLowerCase() === "ms" ? v / 1000 : v;
}

/** 关键帧里的坐标点：只认绝对 M/L（生成产物里的绝对形态）。含别的命令 ⇒ 返回 null，由调用方跳过。 */
function pointsOf(frame: string): [number, number][] | null {
  const pts: [number, number][] = [];
  const re = /([ML])\s*(-?[0-9]*\.?[0-9]+)[\s,]+(-?[0-9]*\.?[0-9]+)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(frame)) !== null) {
    pts.push([Number(m[2]), Number(m[3])]);
    consumed += m[0].length;
  }
  // 命令字之外的可见字符（Q/C/A…）说明这不是一条折线骨架，不硬解。
  const stripped = frame.replace(/[ML0-9.\s,;-]/g, "");
  if (stripped !== "" || pts.length < 2 || consumed === 0) return null;
  return pts;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** 三点以上的代数圆拟合（Kåsa）：解 2a·x + 2b·y + c = x²+y²，中心 (a,b)，R=√(c+a²+b²)。 */
function fitCircle(pts: readonly [number, number][]):
  | { cx: number; cy: number; r: number; maxDev: number }
  | null {
  const n = pts.length;
  if (n < 4) return null;
  // A·[a,b,c] = rhs，正规方程 3×3
  const A: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rhs = [0, 0, 0];
  const basis = (p: readonly [number, number]): number[] => [2 * p[0], 2 * p[1], 1];
  for (const p of pts) {
    const b = basis(p);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i]![j]! += b[i]! * b[j]!;
      rhs[i]! += b[i]! * (p[0] * p[0] + p[1] * p[1]);
    }
  }
  // 高斯消元（带部分选主元）
  const M = [0, 1, 2].map((i) => [A[i]![0]!, A[i]![1]!, A[i]![2]!, rhs[i]!]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-9) return null; // 退化（点共线）⇒ 不判，不硬说它是圆
    const tmp = M[col]!;
    M[col]! = M[piv]!;
    M[piv]! = tmp;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / M[col]![col]!;
      for (let c = col; c < 4; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const a = M[0]![3]! / M[0]![0]!;
  const b = M[1]![3]! / M[1]![1]!;
  const c = M[2]![3]! / M[2]![2]!;
  const r2 = c + a * a + b * b;
  if (!(r2 > 0) || !Number.isFinite(r2)) return null;
  const r = Math.sqrt(r2);
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, Math.abs(Math.hypot(p[0] - a, p[1] - b) - r));
  return { cx: a, cy: b, r, maxDev };
}

interface Chain {
  /** 每个关键帧的骨架点。 */
  frames: [number, number][][];
  line: number;
  raw: string;
  circle: ReturnType<typeof fitCircle>;
}

/** 包含 index 的**最内层** `<g …>…</g>` 区间（含端点）。
 *
 *  为什么必须是最内层：轮子有两种常见写法——`<g id="rig"><g>…</g><g>…</g></g>`（各自成组）
 *  与 `<g><animateTransform rotate/><circle r=70/></g>`（兄弟）。取**最外层**时两种写法里
 *  总有一种把两枚轮子落进同一个组 ⇒ 它们读到同一个 rotate，「同半径同期」恒真，这一格白装。
 *  取法：扫 `<g>`/`</g>` 流，记录「当前最深且起点在 index 之前、尚未闭合」的那个 `<g>`，
 *  再从它起配到它自己的闭合标签。 */
function innermostG(text: string, index: number): [number, number] | null {
  let open = -1;
  let depth = 0;
  const re = /<g\b|<\/g>/gi;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > index) break;
    if (m[0].toLowerCase() === "<g") {
      // 更深的一层总是取代较浅的那一层 ⇒ 停在最内层
      if (m.index >= open || depth === 0) open = m.index;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) open = -1;
    }
  }
  if (open < 0) return null;
  let d = 0;
  re.lastIndex = open;
  while ((m = re.exec(text)) !== null) {
    if (m[0].toLowerCase() === "<g") d++;
    else {
      d--;
      if (d === 0) return [open, m.index + m[0].length];
    }
  }
  return null;
}

/** 轮子归属：circle 所在**最内层 `<g>`** 里的那一支旋转动画。
 *
 *  为什么不按「字符距离最近」：rotate 常常写在 `<circle>` **之前**（兄弟写法），
 *  于是「最近」会把隔壁那个组的 rotate 判成自己的——实测两枚轮子都归到了 2.4s 那一支
 *  （首枚距离 88、次枚 26 却选了后者，因为比较的是绝对值而平局取了先遍历到的）。
 *  按文档结构归属，两种写法都对。 */
function rotateFor(text: string, index: number): [string | undefined, number] | null {
  const g = innermostG(text, index);
  if (g === null) return null;
  const rm = ROTATE_RE.exec(text.slice(g[0], g[1]));
  if (rm === null) return null;
  const raw = rm[0] ?? "";
  if (!/\bdur\s*=/i.test(raw)) return null; // 摆头那种只有 values、没有整圈周期的，不是轮子
  return [DUR_OF.exec(raw)?.[1], lineOf(text, g[0] + (text.slice(g[0], g[1]).indexOf(raw) >= 0 ? 0 : 0))];
}

function checkFile(abs: string, rel: string): void {
  let text: string;
  try {
    text = readTextFileSnapshotSync(abs).text;
  } catch (err) {
    findings.push({ file: rel, line: 1, what: "读不到：" + (err instanceof Error ? err.message : String(err)) });
    return;
  }

  const chains: Chain[] = [];

  // ---- ⑥ spline 配平：先把「所有带缓动的动画元素」扫一遍，再判几何骨架 ----
  // 判的是「这段动画会不会被整段丢弃」，与它动的是 d 还是 transform 无关：
  // 规范里 keySplines 段数必须 = 关键帧数−1，不符时整段缓动被丢弃（退回线性、或整段不生效）。
  /** 带 `calcMode="spline"` 的动画元素（`<animate>` 与 `<animateTransform>` 同族）。 */
  const SPLINE_ANIMS = /<animate(?:Transform)?\b[^>]*>/gi;
  SPLINE_ANIMS.lastIndex = 0;
  let sm: RegExpExecArray | null;
  while ((sm = SPLINE_ANIMS.exec(text)) !== null) {
    const tag = sm[0] ?? "";
    const calcMode = CALCMODE_OF.exec(tag)?.[1] ?? "";
    if (calcMode.toLowerCase() !== "spline") continue;
    const rawValues = /values\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    const frameCount = rawValues.split(";").filter((s) => s.trim() !== "").length;
    const ks = (KEYSPLINES_OF.exec(tag)?.[1] ?? "").trim();
    const segs = ks === "" ? 0 : ks.split(";").filter((s) => s.trim() !== "").length;
    const need = frameCount > 0 ? frameCount - 1 : (/from\s*=.*to\s*=/is.test(tag) ? 1 : 0);
    if (need > 0 && segs !== need) {
      findings.push({
        file: rel,
        line: lineOf(text, sm.index ?? 0),
        what: `calcMode="spline" 但 keySplines 有 ${String(segs)} 段，需要 ${String(need)} 段（关键帧数−1）——数量不符时整段缓动会被丢弃`,
      });
    }
  }

  // ---- ①②③④：逐条动画骨架 ----
  ANIMATE_D.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANIMATE_D.exec(text)) !== null) {
    const line = lineOf(text, m.index ?? 0);
    const rawValues = m[1] ?? "";
    const framesRaw = rawValues
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (framesRaw.length < 2) continue;

    const frames: [number, number][][] = [];
    let bad = false;
    for (const f of framesRaw) {
      const p = pointsOf(f);
      if (p === null) {
        bad = true;
        break;
      }
      frames.push(p);
    }
    if (bad || frames.length < 4) continue; // 非折线骨架 / 帧太少：不硬解，也不谎报干净
    const widths = new Set(frames.map((f) => f.length));
    if (widths.size !== 1) {
      findings.push({
        file: rel,
        line,
        what: `各关键帧的点数不一致（${[...widths].map(String).join(" / ")}）——跨帧插值会错位`,
      });
      continue;
    }

    const n = frames.length;
    const pts = frames[0]!.length;

    // ① 循环闭合
    const first = frames[0]!;
    const last = frames[n - 1]!;
    let gap = 0;
    for (let i = 0; i < pts; i++) gap = Math.max(gap, Math.hypot(last[i]![0] - first[i]![0], last[i]![1] - first[i]![1]));
    if (gap > 0.5) {
      findings.push({
        file: rel,
        line,
        what: `循环不闭合：首尾关键帧最大间距 ${gap.toFixed(2)}px，每圈接缝会跳一下（把最后一帧写成=第一帧）`,
      });
    }

    // ② 根点固定
    let rootDrift = 0;
    for (let k = 0; k < n; k++) {
      rootDrift = Math.max(rootDrift, Math.hypot(frames[k]![0]![0] - first[0]![0], frames[k]![0]![1] - first[0]![1]));
    }
    if (rootDrift > 0.5) {
      findings.push({
        file: rel,
        line,
        what: `根点（第一点）跨关键帧漂移 ${rootDrift.toFixed(2)}px——骨架根部应当钉死在身上`,
      });
    }

    // ③ 刚肢长度恒定
    let lenSwing = 0;
    let whichSeg = 0;
    for (let s = 0; s < pts - 1; s++) {
      const base = Math.hypot(first[s + 1]![0] - first[s]![0], first[s + 1]![1] - first[s]![1]);
      if (base < 1e-6) continue;
      for (let k = 1; k < n; k++) {
        const L = Math.hypot(frames[k]![s + 1]![0] - frames[k]![s]![0], frames[k]![s + 1]![1] - frames[k]![s]![1]);
        if (Math.abs(L - base) > lenSwing) {
          lenSwing = Math.abs(L - base);
          whichSeg = s;
        }
      }
    }
    if (lenSwing > 0.5) {
      findings.push({
        file: rel,
        line,
        what: `第 ${String(whichSeg + 1)} 段骨长跨关键帧变化 ${lenSwing.toFixed(2)}px——刚性肢体不该被拉伸`,
      });
    }

    // ④ 末点在圆上（脚踩踏板 / 末端沿圆轨）
    const tail = frames.map((f) => f[pts - 1]!);
    const circle = fitCircle(tail);
    if (circle !== null && circle.maxDev > 1.0) {
      findings.push({
        file: rel,
        line,
        what: `末点不在同一圆上：拟合偏离最大 ${circle.maxDev.toFixed(2)}px（圆心 ${circle.cx.toFixed(1)},${circle.cy.toFixed(1)} r=${circle.r.toFixed(1)}）——末端脱离了它该沿的轨道`,
      });
    }
    chains.push({ frames, line, raw: rawValues, circle });
  }

  // ---- ⑧ 没有可静态判定的骨架 ⇒ 不许读成「干净」 ----
  //
  // 这一条是**本格最重要的一格**，动机是一次真实的假绿（2026-10-17）：一次基线跑里模型用
  // requestAnimationFrame + CSS transform 写鹈鹕（全文 0 个 `<animate>`），本格于是「一条骨架
  // 都没解析到」，照原样打印「全过」。而那份产物**是坏的**——它把小腿也按大腿同一个角度
  // 旋转再固定偏移 40px，没有膝关节，脚也从来没落到踏板上。
  // 「没有数据」与「数据没问题」在退出码上同形，等于给了一条绕过整把尺的免费通道：
  // 只要不写成可静态解析的形态，就自动绿。判卷器自己造出一条逃逸通道，比没有判卷更坏。
  // 所以：文件里有动画迹象、却一条骨架都没解析到 ⇒ 报「无法静态判定」并置红，
  // 顺带点名该写成什么形态（可验形态就是阻力最小的路，这正是 harness 该有的引导）。
  if (chains.length === 0) {
    const JS_ANIM = /\brequestAnimationFrame\s*\(|@keyframes|\banimation\s*:\s*[^;]*\d/;
    const MARKUP_ANIM = /<animate\b|<animateTransform\b|<set\b/;
    if (JS_ANIM.test(text) || MARKUP_ANIM.test(text)) {
      findings.push({
        file: rel,
        line: 1,
        what: "无法静态判定：文件里有动画迹象（"
          + (JS_ANIM.test(text) ? "JS/CSS 动画" : "SVG 动画标签")
          + "），但本格没有解析到任何可判的骨架关键帧（`<animate attributeName=\"d\" values=\"…\">` 这种逐帧形态）。"
          + "「没解析到」≠「没问题」——要看运动学，请把骨架写成逐帧 values 的形态，"
          + "否则腿贴不贴踏板、循环跳不跳变、两腿反不反相，任何一格都没人看。",
      });
    }
  }

  // ---- ⑤ 双腿反相：两条**共圆**的骨架，相位差须≈180° ----
  for (let i = 0; i < chains.length; i++) {
    for (let j = i + 1; j < chains.length; j++) {
      const A = chains[i]!;
      const B = chains[j]!;
      if (A.circle === null || B.circle === null) continue;
      const centerGap = Math.hypot(A.circle.cx - B.circle.cx, A.circle.cy - B.circle.cy);
      if (centerGap > Math.max(2, A.circle.r * 0.25)) continue; // 不是同一个圆（两条腿 vs 别的部件）
      if (Math.abs(A.circle.r - B.circle.r) > A.circle.r * 0.25) continue;
      if (A.frames.length !== B.frames.length) continue;
      const n = A.frames.length;
      const ang = (c: Chain, k: number): number => {
        const p = c.frames[k]![c.frames[k]!.length - 1]!;
        return Math.atan2(p[1] - c.circle!.cy, p[0] - c.circle!.cx);
      };
      let worst = 0;
      let sum = 0;
      for (let k = 0; k < n; k++) {
        let d = ((ang(B, k) - ang(A, k)) * 180) / Math.PI;
        d = ((d % 360) + 360) % 360;
        const off = Math.abs(d - 180);
        sum += d;
        worst = Math.max(worst, off);
      }
      const mean = sum / n;
      if (worst > 15) {
        findings.push({
          file: rel,
          line: B.line,
          what: `两条共圆的骨架相位差不是 180°（实测均值 ${mean.toFixed(1)}°，最大偏离 ${worst.toFixed(1)}°）——` +
            (mean < 30 || mean > 330 ? "两条腿在同步摆动（多半是同一组数抄了两遍）" : "相位不对，两条腿会踩到一起"),
        });
      }
    }
  }

  // ---- ⑦ 同半径轮同期 ----
  interface Wheel {
    r: number;
    dur: number | null;
    line: number;
  }
  const wheels: Wheel[] = [];
  CIRCLE_R.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = CIRCLE_R.exec(text)) !== null) {
    // 归属按「离这个 circle 最近的旋转动画」，**不按包它的 `<g>`**：
    // 轮子骨架常见写法是 `<g id="rig"><g><animateTransform rotate/><circle r=70/></g><g>…</g></g>`，
    // 但也常见 `<circle>` 与 `<animateTransform>` 是同一组的**直接兄弟**——按组归属时
    // 两组写法里总有一组落到外层，两枚轮子于是读到同一个 rotate，「同期」恒真。
    // 取最近的前后各一支 rotate、挑距离小的那一支，两种写法都对。
    const at = cm.index ?? 0;
    const rot = rotateFor(text, at);
    if (rot === null) continue;
    const [durRaw, line] = rot;
    wheels.push({
      r: Number(cm[1]),
      dur: durRaw === undefined ? null : durSeconds(durRaw),
      line,
    });
  }
  for (let i = 0; i < wheels.length; i++) {
    for (let j = i + 1; j < wheels.length; j++) {
      const A = wheels[i]!;
      const B = wheels[j]!;
      if (Math.abs(A.r - B.r) > 0.5) continue;
      if (A.dur === null || B.dur === null) continue;
      if (Math.abs(A.dur - B.dur) > 0.02) {
        findings.push({
          file: rel,
          line: B.line,
          what: `两个半径同为 ${A.r} 的旋转体周期不一致（${A.dur}s vs ${B.dur}s）——同半径的旋转体必须同期，否则画面会自相矛盾`,
        });
      }
    }
  }
}

const args = process.argv.slice(2).filter((a) => a !== "");
if (args.length === 0) {
  console.error("用法：node --import tsx scripts/anim-geometry-check.ts <file.html|file.svg> […]");
  process.exit(2);
}
for (const a of args) {
  if (isAbsolute(a)) {
    console.error("只接受工作区相对路径（与其余判卷同口径）：" + a);
    process.exit(2);
  }
  if (!/\.(html?|svg)$/i.test(a)) {
    console.error("这一格只验 HTML/SVG 动画产物，收到：" + a);
    process.exit(2);
  }
  checkFile(resolve(process.cwd(), a), a);
}

if (findings.length === 0) {
  console.log(
    "anim-geometry-check: " + String(args.length) + " 个产物全过（循环闭合 / 根点固定 / 骨长恒定 / 末点在圆 / 双腿反相 / spline 配平 / 同轮同期）",
  );
  process.exit(0);
}
console.error("anim-geometry-check: " + String(findings.length) + " 处问题");
for (const f of findings) console.error("  " + f.file + ":" + String(f.line) + " — " + f.what);
process.exit(1);
