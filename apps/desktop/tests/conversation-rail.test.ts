// 对话轨道判卷（2026-10-28 第 754 页 · 设计打磨第 15 轮）
//
// 这一批把「对话是一堵文字墙」改成「对话是一条能扫读的运行轨迹」，落地四件事：
//   ① 一条左轨：过程带（思考记录 / 工具调用）与助手正文挂在**同一个**左轨上；
//   ② 隐形占位归零：署名条（时间戳 + 操作钮）改为浮层，不再白占 30px 高度；
//   ③ 标与首行齐平：品牌标不再浮在正文上方半空里；
//   ④ 轴线：阅读列左侧一条安静的发丝线，品牌标是线上的节点。
//
// 本判卷钉的是**数值自洽**与**不许回退**，不是样式快照：
//   · 左轨宽 = 标列 + 网格间隙（差一个数，过程带与正文就错位）；
//   · 过程带那一档 = brief §二.1 的 24px（与行上的字面量 24px 必须是同一个数）；
//   · 署名条不许回到流里（回到流里就又白吃 30px，节奏重新散掉）。
// 任何一条都能造红：改一个令牌而不改另一个、把浮层改回流内、把轴线删掉，本判卷立刻红。
//
// 纪律（AGENTS.md）：断言「应用里有没有这段代码」要读**面**，不许读单文件——
// 代码搬走时 `not.toContain` 会空过。本文件因此分两类断言：
//   · 位置敏感的（这条规则必须在某个文件里）→ 单独读那个文件；
//   · 否定断言（渲染层里不许再有裸像素缩进）→ 读整个 CSS 面（renderer 下全部 .css，排除 vendor）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RENDERER_DIR = fileURLToPath(new URL("../src/renderer", import.meta.url));

const read = (rel: string): string => readFileSync(join(RENDERER_DIR, rel), "utf8");

const styles = read("styles.css");
const tokens = read("tokens.css");
const processCss = read("components/stream-process.css");
const railCss = read("components/conversation-rail.css");

/** 取一个选择器规则体（{…}，含嵌套）。选择器不存在返回 ""。 */
function ruleOf(source: string, selector: string): string {
  const at = source.indexOf(selector);
  if (at === -1) return "";
  const open = source.indexOf("{", at);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return "";
}

/** 渲染层 CSS 面：全部 .css（排除 vendor/dist）拼起来——否定断言读面，不读单文件。 */
function readCssFace(): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === "vendor" || name === "node_modules" || name === "dist" || name === "dist-electron") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".css")) continue;
      out.push(`/* ${relative(RENDERER_DIR, full).split(sep).join("/")} */\n${readFileSync(full, "utf8")}`);
    }
  };
  walk(RENDERER_DIR);
  return out.join("\n");
}

/** 令牌定义里的 px/rem 数值（rem 按 16px 折算；--size-scale 缺省 1）。 */
function tokenPx(name: string): number {
  const body = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1] ?? "";
  const rem = body.match(/([\d.]+)rem/);
  if (rem !== null) return Number(rem[1]) * 16;
  const px = body.match(/([\d.]+)px/);
  if (px !== null) return Number(px[1]);
  throw new Error(`令牌没有 px/rem 数值：--${name}（${body.trim()}）`);
}

/** 规则里的一个 px 数值。 */
function pxIn(rule: string, prop: string): number {
  const hit = rule.match(new RegExp(`${prop}:\\s*([\\d.]+)px`));
  if (hit === null) throw new Error(`规则里没有 ${prop}: Npx —— ${rule.slice(0, 80)}`);
  return Number(hit[1]);
}

describe("对话轨道（第 754 页）", () => {
  it("① 过程带与助手正文挂在同一条左轨（左轨宽 = 标列 + 间隙）", () => {
    const assistant = ruleOf(styles, ".row.assistant {");
    expect(assistant).not.toBe("");
    // 标列与间隙是**字面量**（stream-nav 判卷逐字钉着 20px），左轨走令牌。
    const mark = pxIn(assistant, "grid-template-columns");
    const gap = pxIn(assistant, "gap");
    expect(tokenPx("rail-gutter")).toBe(mark + gap);
    // 过程带与思考带：左边距用同一条轨的令牌。
    expect(ruleOf(processCss, ".toolcluster[data-tool-group] {")).toContain("var(--rail-gutter)");
    expect(ruleOf(processCss, ".row.think[data-running] {")).toContain("var(--rail-gutter)");
    // 底座那条 .toolcluster 也得在轨上：它带着 22px 的旧缩进时，
    // 任何不带 data-tool-group 的工具簇一渲染出来就会掉出轨道。
    expect(ruleOf(styles, ".toolcluster {")).toContain("var(--rail-gutter)");
  });

  it("② 每一档都是 24px：过程带的档 = brief §二.1 的 24px（与行上的字面量同值）", () => {
    // 行上的字面量 24px 由 tool-rows 判卷钉着（brief §二.1），这里钉住令牌与它同值。
    expect(tokenPx("turn-gap")).toBe(24);
    // 过程带/思考带：顶距走令牌，底距 0 ⇒ 段与段之间恒为 24。
    // 第 862 页把右缘那一档从 0 改成 fluid stop（见 ⑧），顶/左两档原样不动。
    expect(ruleOf(processCss, ".toolcluster[data-tool-group] {")).toContain("margin: var(--turn-gap) var(--cds-assistant-message-text-stop) 0 var(--rail-gutter)");
    expect(ruleOf(processCss, ".row.think[data-running] {")).toContain("margin: var(--turn-gap) var(--cds-assistant-message-text-stop) 0 var(--rail-gutter)");
    expect(ruleOf(styles, ".toolcluster {")).toContain("margin: var(--turn-gap) var(--cds-assistant-message-text-stop) 0 var(--rail-gutter)");
    // 三种行的顶距仍是 24px（判卷正文，这里复核同一事实）。
    expect(ruleOf(styles, ".row.user {")).toContain("margin: 24px 0 0");
    expect(ruleOf(styles, ".row.assistant {")).toContain("margin: 24px var(--cds-assistant-message-text-stop) 0 0");
  });

  it("③ 署名条是浮层：不占流内高度（回到流里就白吃 30px，节奏重新散掉）", () => {
    expect(ruleOf(styles, ".row.user > .meta {")).toContain("position: absolute");
    expect(ruleOf(processCss, ".row.assistant > .assistant-footer {")).toContain("position: absolute");
    // 两条都不许再带 padding-bottom 那一档：档归行去，浮层只是挂上去。
    expect(ruleOf(styles, ".row.user {")).not.toContain("padding-bottom");
    expect(ruleOf(styles, ".row.assistant {")).not.toContain("padding-bottom");
  });

  it("④ 隐藏态不吃指针：看不见的操作条不许吃掉下一段的点击", () => {
    // opacity:0 但仍可点 ⇒ 用户点「过程带」其实点在一条隐形按钮上（幽灵点击）。
    // 指针规则另起一条写（原规则正文被别的判卷逐字钉着），所以这里按整条文本断言。
    expect(styles).toContain(".row-actions { pointer-events: none; }");
    expect(styles).toContain(".row:hover .row-actions, .row:focus-within .row-actions { pointer-events: auto; }");
    // 署名条同理（它现在是浮层，会盖在下一段上面）。
    expect(styles).toContain(".row.assistant > .meta, .row.user > .meta { pointer-events: none; }");
    expect(styles).toContain(".row.user:hover > .meta, .row.user:focus-within > .meta { pointer-events: auto; }");
  });

  it("⑤ 不许有装饰性竖线：轴线已整条撤掉（业主在真机上一眼否掉）", () => {
    // 轴线曾是一根 1px 发丝线，品牌标挂在它上面当「节点」。真机上看它不成立：
    // 线上只有品牌标一个点，其余全是空跑 ⇒ 那是一根多余的竖线，不是有内容的轴。
    // Codex / Claude 都没有它（模型标就是标，不挂在线上）。
    // ⇒ 现在把「不许再画回来」钉住：谁往阅读列上画一根装饰性竖线，本判卷立刻红。
    // 注释里记着「撤掉了轴线」这段历史，不算声明 ⇒ 先去注释再查声明面。
    const decls = railCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(decls).not.toContain("--rail-line");
    expect(decls).not.toContain("--rail-node");
    expect(decls).not.toContain(".reading:has(");
    expect(tokens).not.toContain("--rail-line:");
    expect(tokens).not.toContain("--rail-node:");
    // 面上也不许有「在阅读列上画一条 1px 竖线」的实现（任何文件名都算）。
    expect(readCssFace()).not.toMatch(/\.reading[^{]*::(before|after)[^{]*\{[^}]*width:\s*1px/);
  });

  it("⑥ 标与首行齐平：正文首块的顶距归零（品牌标不再浮在半空）", () => {
    expect(railCss).toContain(".row.assistant .md-body > :first-child { margin-top: 0; }");
    // 末块的下边距同样归零：档已经负责间距，不许再叠一段 markdown 下边距。
    expect(railCss).toContain(".row.assistant .md-body > :last-child { margin-bottom: 0; }");
    // 轨道不加动效：全局 reduced-motion 降级已经兜住，这里不许自己开一条。
    // 注释里提到 animation 不算声明 ⇒ 先去注释再查（判据不因注释里的字眼而空过/假红）。
    const decls = railCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(decls).not.toMatch(/animation:/);
    expect(decls).not.toMatch(/transition:/);
  });

  it("⑦ 渲染层 CSS 里不再有对话缩进的裸像素（旧写的 22px 那类）", () => {
    const face = readCssFace();
    // 过程带/思考带一律走令牌：面里不许再出现「左边距 22px」这种一次性写死的缩进。
    expect(face).not.toMatch(/\.toolcluster[^{]*\{[^}]*margin:\s*[^;]*\b22px/);
    expect(face).not.toMatch(/\.row\.think[^{]*\{[^}]*margin:\s*[^;]*\b22px/);
  });

  it("⑧ 一轮 = 一条列（右缘，第 862 页）：四段共用同一条 fluid stop，且只有一处公式", () => {
    // ① 把左轨对齐了，右缘漏了：真机 1440 读数（第 862 页取证）
    //   正文 .md-body 519..1185、交付卡 519..1185，而思考带 / 工具簇 519..1241
    //   ⇒ 同一轮里两种右缘，56px 的锯齿。现在四段（助手行 / 思考带 / 工具簇 / 交付卡）
    //   作为 .reading 的直接子元素共用 `.reading` 上声明的那一条变量。
    expect(ruleOf(styles, ".reading {")).toContain("--cds-assistant-message-text-stop: clamp(0px, (100% - 384px) * 0.175, 56px)");
    for (const [src, sel] of [
      [styles, ".row.assistant {"],
      [styles, ".row.think {"],
      [styles, ".row.error-row {"],
      [styles, ".toolcluster {"],
      [styles, ".changes-card {"],
      [processCss, ".toolcluster[data-tool-group] {"],
      [processCss, ".row.think[data-running] {"],
    ] as const) {
      const rule = ruleOf(src, sel);
      expect(rule, sel).not.toBe("");
      expect(rule, `${sel} 的右缘要读那一条 stop 变量`).toMatch(/(?:margin(?:-right)?:[^;]*var\(--cds-assistant-message-text-stop\)|margin-right:\s*var\(--cds-assistant-message-text-stop\))/);
    }
    // ② 单源：公式只许出现在 `.reading` 的声明里（抄第二份就会漂）。
    //    先去注释再查声明面——注释里复述官方公式是文档，不是第二处实现。
    const face = readCssFace().replace(/\/\*[\s\S]*?\*\//g, "");
    const formulas = face.match(/clamp\(0px,\s*\(100% - 384px\)/g) ?? [];
    expect(formulas.length, `fluid stop 公式只许一处，实际 ${formulas.length} 处`).toBe(1);
    // ③ 反向自证：正文自己不再吃 padding-right（否则行 + 正文两份留白，列会再窄 56px）。
    expect(ruleOf(styles, ".row.assistant .t {")).not.toContain("padding-right");
  });
});
