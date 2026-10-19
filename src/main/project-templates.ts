// 模板初始化：把「新建项目」从「建一个空文件夹」升级成「得到一个能运行的项目」。
//
// 为什么不是把模板塞进 agent 提示词：模板是**可复现**的起始面，模板版本、文件清单、运行形态
// 都要能被「自动预览」直接消费，而且失败要能回滚。提示词做不到这些；一份纯 IO 服务可以，
// 并且能在 vitest 里直接判卷（同 project-create 的纪律）。
//
// 运行形态只允许两个受控值（"static" / "vite"）落进 `.cairn/project.json`：
//   · 清单**不携带任意命令**——项目文件是用户可写的，让清单指挥 App 起进程等于把
//     「点一次预览」变成「跑一段项目里的任意命令」。命令由 project-preview 按 kind 写死。
//   · kind 之外的东西（模板版本、来源）只用于诊断与后续迁移。
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { defaultProjectsRoot, validateProjectName, type CreateProjectFailure } from "./project-create";

export type TemplateRunKind = "static" | "vite";

export interface ProjectTemplate {
  id: string;
  /** 面向用户的模板名（渲染层直接显示，不再翻译一遍）。 */
  name: string;
  description: string;
  runKind: TemplateRunKind;
  /** 相对路径 → 文件内容。目录不显式声明，由写盘时按需创建。 */
  files: Readonly<Record<string, string>>;
}

/** 项目清单文件名（相对项目根）。它是「自动预览认得的项目」的唯一标记。 */
export const PROJECT_MANIFEST_REL = ".cairn/project.json";

export interface ProjectManifest {
  cairnProject: number;
  templateId: string;
  run: { kind: TemplateRunKind };
}

const HTML_HEAD = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
`;

/* ---------- 模板内容 ----------
   三条静态路线全部零依赖（不需要 Node/包管理器就能预览）；react-vite 是唯一需要装依赖的形态，
   版本写死 → 探针与用户拿到的是同一组版本。 */

const STATIC_SITE_INDEX = `${HTML_HEAD}<title>云集工作室 · 品牌展示</title>
<link rel="stylesheet" href="./styles.css">
</head>
<body>
<header class="hero">
  <p class="eyebrow">品牌展示页</p>
  <h1>云集工作室</h1>
  <p class="lede">一句话讲清你是做什么的：这里是关于页、服务和联系方式的起点。</p>
  <a class="cta" href="#contact">联系我们</a>
</header>
<main>
  <section class="cards" aria-label="服务">
    <article>
      <h2>服务一</h2>
      <p>把这项服务能解决的问题、适合谁、交付什么写清楚。</p>
    </article>
    <article>
      <h2>服务二</h2>
      <p>示例文字。直接告诉 Cairn 你想改成什么，它会替你改这一块。</p>
    </article>
    <article>
      <h2>服务三</h2>
      <p>定价、周期、案例都可以放在这一张卡里。</p>
    </article>
  </section>
  <section id="contact" class="contact">
    <h2>联系我们</h2>
    <p>电话：138-0000-0000 · 邮箱：hello@example.com</p>
  </section>
</main>
<footer>© 2026 云集工作室</footer>
</body>
</html>
`;

const SHARED_BASE_CSS = `* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; color: #1c1c1e; background: #f6f6f4; line-height: 1.6; }
main { max-width: 960px; margin: 0 auto; padding: 32px 20px 56px; }
h1, h2 { line-height: 1.25; }
a { color: inherit; }
`;

const STATIC_SITE_CSS = `${SHARED_BASE_CSS}.hero { padding: 72px 20px 56px; text-align: center; background: #ffffff; border-bottom: 1px solid #e6e6e2; }
.eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 12px; color: #8a8577; margin: 0 0 12px; }
.hero h1 { font-size: 40px; margin: 0 0 12px; }
.lede { max-width: 560px; margin: 0 auto 24px; color: #55524a; }
.cta { display: inline-block; padding: 10px 22px; border-radius: 8px; background: #1c1c1e; color: #fff; text-decoration: none; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.cards article { background: #fff; border: 1px solid #e6e6e2; border-radius: 8px; padding: 20px; }
.cards h2 { font-size: 17px; margin: 0 0 8px; }
.cards p { margin: 0; color: #55524a; font-size: 14px; }
.contact { margin-top: 40px; padding: 24px; background: #fff; border: 1px solid #e6e6e2; border-radius: 8px; }
.contact h2 { margin: 0 0 8px; font-size: 18px; }
footer { text-align: center; color: #8a8577; font-size: 12px; padding: 24px; }
@media (max-width: 640px) { .hero h1 { font-size: 30px; } .hero { padding: 48px 16px 40px; } }
`;

const FORM_WIDGET_INDEX = `${HTML_HEAD}<title>报价小工具</title>
<link rel="stylesheet" href="./styles.css">
</head>
<body>
<main class="widget">
  <h1>报价小工具</h1>
  <p class="hint">输入数量与单价，价格自动计算（含 6% 税）。改字段即可修改规则。</p>
  <form id="quote" novalidate>
    <label>品名 <input name="item" type="text" value="设计服务" required></label>
    <label>数量 <input name="qty" type="number" min="1" step="1" value="2" required></label>
    <label>单价（元） <input name="unit" type="number" min="0" step="0.01" value="800" required></label>
    <button type="submit">计算报价</button>
  </form>
  <div id="result" class="result" role="status" aria-live="polite"></div>
</main>
<script src="./app.js"></script>
</body>
</html>
`;

const FORM_WIDGET_CSS = `${SHARED_BASE_CSS}.widget { max-width: 520px; padding-top: 56px; }
.widget h1 { margin: 0 0 4px; font-size: 24px; }
.hint { color: #8a8577; font-size: 13px; margin: 0 0 24px; }
form { background: #fff; border: 1px solid #e6e6e2; border-radius: 8px; padding: 20px; display: grid; gap: 14px; }
label { display: grid; gap: 6px; font-size: 13px; color: #55524a; }
input { padding: 8px 10px; border: 1px solid #d8d8d2; border-radius: 6px; font-size: 14px; }
input:focus-visible { outline: 2px solid #1c1c1e; outline-offset: 1px; }
button { padding: 10px 16px; border: 0; border-radius: 8px; background: #1c1c1e; color: #fff; font-size: 14px; cursor: pointer; }
.result { margin-top: 16px; font-size: 15px; min-height: 24px; }
.result.ok { color: #0a7a3d; }
.result.err { color: #b3261e; }
`;

const FORM_WIDGET_JS = `// 报价规则：数量 x 单价，含 6% 税。改数字即改规则（也可以直接让 Cairn 改）。
const TAX_RATE = 0.06;
const form = document.getElementById("quote");
const result = document.getElementById("result");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const item = String(data.get("item") || "").trim();
  const qty = Number(data.get("qty"));
  const unit = Number(data.get("unit"));
  if (item === "") return show("请填写品名", false);
  if (!Number.isFinite(qty) || qty < 1) return show("数量要是不小于 1 的数字", false);
  if (!Number.isFinite(unit) || unit < 0) return show("单价要是不小于 0 的数字", false);
  const total = qty * unit * (1 + TAX_RATE);
  show(item + "：" + qty + " x " + unit.toFixed(2) + " 元，含税合计 " + total.toFixed(2) + " 元", true);
});

function show(text, ok) {
  result.textContent = text;
  result.className = "result " + (ok ? "ok" : "err");
}
`;

const DATA_PANEL_INDEX = `${HTML_HEAD}<title>本周开销一览</title>
<link rel="stylesheet" href="./styles.css">
</head>
<body>
<main class="panel">
  <h1>本周开销一览</h1>
  <p class="hint">示例数据在 app.js 顶部的 DATA 里，改成你的数据即可。</p>
  <canvas id="chart" width="640" height="240" aria-label="按天开销柱状图"></canvas>
  <table>
    <thead><tr><th>日期</th><th>项目</th><th class="num">金额（元）</th></tr></thead>
    <tbody id="rows"></tbody>
    <tfoot><tr><td colspan="2">合计</td><td class="num" id="total"></td></tr></tfoot>
  </table>
</main>
<script src="./app.js"></script>
</body>
</html>
`;

const DATA_PANEL_CSS = `${SHARED_BASE_CSS}.panel { max-width: 720px; }
.panel h1 { font-size: 24px; margin: 0 0 4px; }
.hint { color: #8a8577; font-size: 13px; margin: 0 0 20px; }
canvas { width: 100%; height: auto; background: #fff; border: 1px solid #e6e6e2; border-radius: 8px; }
table { width: 100%; border-collapse: collapse; margin-top: 20px; background: #fff; border: 1px solid #e6e6e2; border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: 10px 14px; font-size: 14px; border-bottom: 1px solid #efefec; }
tfoot td { font-weight: 600; border-bottom: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
`;

const DATA_PANEL_JS = `const DATA = [
  { day: "周一", item: "午餐", amount: 42 },
  { day: "周二", item: "打车", amount: 36 },
  { day: "周三", item: "文具", amount: 18 },
  { day: "周四", item: "聚餐", amount: 126 },
  { day: "周五", item: "咖啡", amount: 32 },
];

const rows = document.getElementById("rows");
let total = 0;
for (const row of DATA) {
  total += row.amount;
  const tr = document.createElement("tr");
  for (const text of [row.day, row.item]) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  const amount = document.createElement("td");
  amount.className = "num";
  amount.textContent = row.amount.toFixed(2);
  tr.appendChild(amount);
  rows.appendChild(tr);
}
document.getElementById("total").textContent = total.toFixed(2);

const canvas = document.getElementById("chart");
const ctx = canvas.getContext("2d");
const max = Math.max(...DATA.map((d) => d.amount));
const barW = canvas.width / DATA.length;
DATA.forEach((d, i) => {
  const h = (d.amount / max) * (canvas.height - 48);
  ctx.fillStyle = "#1c1c1e";
  ctx.fillRect(i * barW + barW * 0.25, canvas.height - 24 - h, barW * 0.5, h);
  ctx.fillStyle = "#55524a";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(d.day, i * barW + barW / 2, canvas.height - 8);
});
`;

const REACT_PACKAGE_JSON = `{
  "name": "cairn-react-widget",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "5.0.4",
    "vite": "7.0.6"
  }
}
`;

const REACT_VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1" },
});
`;

const REACT_INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>待办小工具</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.jsx"></script>
</body>
</html>
`;

const REACT_MAIN = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

const REACT_APP = `import { useState } from "react";

const SEED = [
  { id: 1, text: "把示例文字改成你的", done: false },
  { id: 2, text: "让 Cairn 加一个截止日期", done: false },
];

export default function App() {
  const [items, setItems] = useState(SEED);
  const [draft, setDraft] = useState("");

  const add = () => {
    const text = draft.trim();
    if (text === "") return;
    setItems((prev) => [...prev, { id: Date.now(), text, done: false }]);
    setDraft("");
  };
  const toggle = (id) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
  const remove = (id) => setItems((prev) => prev.filter((it) => it.id !== id));
  const left = items.filter((it) => !it.done).length;

  return (
    <main className="todo">
      <h1>待办小工具</h1>
      <p className="hint">还剩 {left} 件事没做完。数据只存在浏览器里。</p>
      <div className="add-row">
        <input value={draft} placeholder="加一件事，回车确认" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button onClick={add}>添加</button>
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.id} data-done={it.done}>
            <label>
              <input type="checkbox" checked={it.done} onChange={() => toggle(it.id)} />
              <span>{it.text}</span>
            </label>
            <button className="x" aria-label={"删除 " + it.text} onClick={() => remove(it.id)}>×</button>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p className="empty">还没有待办。</p>}
    </main>
  );
}
`;

const REACT_STYLES = `* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; background: #f6f6f4; color: #1c1c1e; }
.todo { max-width: 520px; margin: 0 auto; padding: 56px 20px; }
h1 { font-size: 24px; margin: 0 0 4px; }
.hint { color: #8a8577; font-size: 13px; margin: 0 0 20px; }
.add-row { display: flex; gap: 8px; }
input[type="text"], .add-row input { flex: 1; padding: 9px 10px; border: 1px solid #d8d8d2; border-radius: 6px; font-size: 14px; }
.add-row button { padding: 9px 16px; border: 0; border-radius: 8px; background: #1c1c1e; color: #fff; cursor: pointer; }
ul { list-style: none; margin: 20px 0 0; padding: 0; display: grid; gap: 8px; }
li { display: flex; align-items: center; justify-content: space-between; background: #fff; border: 1px solid #e6e6e2; border-radius: 8px; padding: 10px 14px; }
li label { display: flex; align-items: center; gap: 10px; cursor: pointer; }
li[data-done="true"] span { text-decoration: line-through; color: #8a8577; }
.x { border: 0; background: none; color: #8a8577; font-size: 16px; cursor: pointer; }
.empty { color: #8a8577; font-size: 14px; }
`;

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: "static-site",
    name: "展示网页",
    description: "介绍页 / 作品集 / 活动页：零依赖，打开即可预览。",
    runKind: "static",
    files: { "index.html": STATIC_SITE_INDEX, "styles.css": STATIC_SITE_CSS },
  },
  {
    id: "form-widget",
    name: "表单小工具",
    description: "报价 / 预约等带校验的小工具：零依赖，输入即算。",
    runKind: "static",
    files: { "index.html": FORM_WIDGET_INDEX, "styles.css": FORM_WIDGET_CSS, "app.js": FORM_WIDGET_JS },
  },
  {
    id: "data-panel",
    name: "数据展示页",
    description: "表格 + 图表的本地数据页：零依赖，改数据即改图。",
    runKind: "static",
    files: { "index.html": DATA_PANEL_INDEX, "styles.css": DATA_PANEL_CSS, "app.js": DATA_PANEL_JS },
  },
  {
    id: "react-vite",
    name: "React 小工具（需联网装依赖）",
    description: "待办 / 交互应用：首次预览会先安装依赖，需要本机有 Node 与 pnpm。",
    runKind: "vite",
    files: {
      "package.json": REACT_PACKAGE_JSON,
      "vite.config.js": REACT_VITE_CONFIG,
      "index.html": REACT_INDEX_HTML,
      "src/main.jsx": REACT_MAIN,
      "src/App.jsx": REACT_APP,
      "src/styles.css": REACT_STYLES,
    },
  },
];

export function findTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}

/** 面向选择界面的轻量清单（不带文件内容——渲染层不需要把模板源码过桥）。 */
export function templateCatalog(): { id: string; name: string; description: string; runKind: TemplateRunKind }[] {
  return PROJECT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, runKind: t.runKind }));
}

function manifestFor(template: ProjectTemplate): ProjectManifest {
  return { cairnProject: 1, templateId: template.id, run: { kind: template.runKind } };
}

export interface CreateFromTemplateInput {
  name: string;
  templateId: string;
  /** 父目录；缺省 defaultProjectsRoot()。 */
  parentDir?: string;
  /** 测试注入用；缺省 homedir()。 */
  home?: string;
}

export type CreateFromTemplateResult =
  | { ok: true; name: string; path: string; parentDir: string; templateId: string }
  | { ok: false; reason: CreateProjectFailure | "unknown-template" | "write-failed"; message: string };

/**
 * 按模板建一个**能运行**的项目目录。
 *
 * 纪律与 createProjectFolder 同源（名字判据、不静默复用已有目录），外加一条：
 * 写盘中途失败 ⇒ 删掉这次自己建的目录再报错，不把半个项目留在用户的父目录里。
 */
export function createProjectFromTemplate(input: CreateFromTemplateInput): CreateFromTemplateResult {
  const checked = validateProjectName(input.name);
  if (!checked.ok) return checked;
  const template = findTemplate(input.templateId);
  if (template === undefined) {
    return {
      ok: false,
      reason: "unknown-template",
      message: `未知模板：${input.templateId}（可用：${PROJECT_TEMPLATES.map((t) => t.id).join(", ")}）`,
    };
  }
  const parentDir = resolve(input.parentDir ?? defaultProjectsRoot(input.home ?? homedir()));
  if (!isAbsolute(parentDir)) {
    return { ok: false, reason: "bad-parent", message: `父目录必须是绝对路径：${parentDir}` };
  }
  if (existsSync(parentDir) && !statSync(parentDir).isDirectory()) {
    return { ok: false, reason: "bad-parent", message: `父目录不是一个目录：${parentDir}` };
  }
  const path = join(parentDir, checked.name);
  if (existsSync(path)) {
    return { ok: false, reason: "exists", message: `文件夹已存在：${path}——换个名字，或用「添加已有文件夹」把它加进来` };
  }
  try {
    mkdirSync(parentDir, { recursive: true });
    mkdirSync(path);
    for (const [rel, content] of Object.entries(template.files)) {
      const abs = join(path, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    const manifestPath = join(path, PROJECT_MANIFEST_REL);
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifestFor(template), null, 2) + "\n", "utf8");
  } catch (err) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // 回滚失败只在消息里提示：目录可能残留，用户至少知道路径与原因
      return {
        ok: false,
        reason: "write-failed",
        message: `写模板失败且清理未成功，可能残留：${path}（${err instanceof Error ? err.message : String(err)}）`,
      };
    }
    return { ok: false, reason: "write-failed", message: `写模板失败：${err instanceof Error ? err.message : String(err)}（已回滚，目录未保留）` };
  }
  return { ok: true, name: checked.name, path, parentDir, templateId: template.id };
}

/** 读项目清单。缺失/损坏/形状不认识 ⇒ null（调用方据此给「这不是可预览的项目」的明确失败）。 */
export function readProjectManifest(root: string): ProjectManifest | null {
  const file = join(root, PROJECT_MANIFEST_REL);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    const rec = raw as Record<string, unknown>;
    const run = rec.run as Record<string, unknown> | undefined;
    const kind = run?.kind;
    if (kind !== "static" && kind !== "vite") return null;
    return {
      cairnProject: typeof rec.cairnProject === "number" ? rec.cairnProject : 1,
      templateId: typeof rec.templateId === "string" ? rec.templateId : "unknown",
      run: { kind },
    };
  } catch {
    return null;
  }
}

/* ---------- 已有项目导入诊断（ADR 0004：先诊断，再纳管） ----------
   「添加已有文件夹」进来的目录什么形态都可能有：零依赖静态网页、受控的 React/Vite、
   带服务端或自带别的构建链的复杂工程。诊断只做一件事——把目录归到三态之一，并把「凭什么」逐条列出来：

     · supported   能按受控形态直接预览（命令仍由 project-preview 按 kind 写死）；
     · needs-info  只差一两样关键信息（入口页名字、锁文件、坏掉的 JSON），补齐就能支持；
     · unsupported 当前暂不可纳入，原因必须点到具体文件。

   两条纪律：
    · **诊断只读**：不写用户目录（不落 .cairn/project.json、不装依赖、不动任何文件）。
      纳管 = 预览直接接管运行，不是把用户的目录改造成 Cairn 项目——用户文件的所有权不因导入而转移。
    · **拒绝面必须点名**：unsupported 指到具体命中物（Dockerfile / postinstall / vite.config 里的
      child_process 等），不做「这种项目一律不行」的黑箱判决，附一条可执行的下一步。

   判定序（先硬性排除，再分形态；只取第一条命中的原因）：
     ① 目录不存在 / 不是目录 → unsupported
     ② 有合法清单 → supported(template)（形态由清单决定，不再往下猜）
     ③ 清单存在但读不出来 → needs-info
     ④ package.json 存在但读不出来 → needs-info
     ⑤ 后端 / 非受控构建链标记（Dockerfile、composer.json、manage.py、go.mod、pom.xml、*.php、
        以及依赖里的 next/electron/webpack 等）→ unsupported
     ⑥ 有 vite：生命周期脚本 / vite 配置里的系统命令或动态执行 → unsupported；
        npm/yarn 锁文件 / 缺 index.html → needs-info；否则 supported(react-vite / vite)
     ⑦ 根目录有 index.html|index.htm → supported(static-html)
     ⑧ 只有别的 .html → needs-info（缺入口命名）
     ⑨ 其余 → unsupported
*/
export type ProjectDiagnosisVerdict = "supported" | "needs-info" | "unsupported";

/** 受支持的形态：template（清单项目）/ static-html（零依赖静态页）/ react-vite / vite。 */
export type ProjectForm = "template" | "static-html" | "react-vite" | "vite";

export interface ProjectDiagnosis {
  verdict: ProjectDiagnosisVerdict;
  /** supported 时的受控运行形态；其余为 null。 */
  runKind: TemplateRunKind | null;
  /** 识别到的形态；supported 时必有。 */
  form: ProjectForm | null;
  /** 一句话结论（渲染层直接显示）。 */
  summary: string;
  /** 判定依据（点名具体文件 / 字段，逐条可对）。 */
  reasons: string[];
  /** needs-info / unsupported 时的下一步；supported 时缺席。 */
  hint?: string;
}

/** 认作「网页入口」的扩展名。project-preview 的单文件直开与本模块共用这一份，不抄第二份。 */
export const HTML_FILE_EXTENSIONS: ReadonlySet<string> = new Set([".html", ".htm"]);

const BACKEND_MARKERS: readonly { file: string; label: string }[] = [
  { file: "Dockerfile", label: "容器环境" },
  { file: "docker-compose.yml", label: "容器编排" },
  { file: "docker-compose.yaml", label: "容器编排" },
  { file: "manage.py", label: "Python/Django 服务端" },
  { file: "requirements.txt", label: "Python 依赖清单" },
  { file: "pyproject.toml", label: "Python 工程" },
  { file: "Gemfile", label: "Ruby 服务端" },
  { file: "composer.json", label: "PHP 服务端" },
  { file: "go.mod", label: "Go 服务端" },
  { file: "pom.xml", label: "Java 服务端" },
  { file: "build.gradle", label: "Java/Kotlin 服务端" },
  { file: "Cargo.toml", label: "Rust 服务端" },
];

/** 依赖里出现即拒的框架/运行容器（和 vite 同时出现也不放行——预览写死的命令跑不了它们）。 */
const BLOCKING_DEPS: readonly string[] = [
  "next", "nuxt", "astro", "@sveltejs/kit", "remix", "@remix-run/dev", "gatsby", "electron", "tauri",
];

/** 只在**没有 vite** 时才拒的构建链（撞上就是「这类项目没在我们的运行路径上」）。 */
const NON_VITE_DEPS: readonly string[] = [
  "webpack", "parcel", "rollup", "esbuild", "express", "koa", "fastify", "hono", "@nestjs/core",
];

const VITE_CONFIG_FILES: readonly string[] = [
  "vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts", "vite.config.cjs", "vite.config.cts",
];

/** vite 配置里的系统命令 / 动态执行调用：命中即拒（纳管后预览会执行这份配置）。 */
const VITE_CONFIG_RISKS: readonly { re: RegExp; label: string }[] = [
  { re: /child_process/, label: "child_process" },
  { re: /\bexecSync\s*\(/, label: "execSync" },
  { re: /\bexec\s*\(/, label: "exec" },
  { re: /\bspawn\s*\(/, label: "spawn" },
  { re: /\bfork\s*\(/, label: "fork" },
  { re: /\beval\s*\(/, label: "eval" },
  { re: /new\s+Function\s*\(/, label: "new Function" },
];

/** 安装依赖时会自动执行的生命周期脚本：命中即拒。
 *  （预览这一趟本来就走 --ignore-scripts；但纳管意味着以后依存装删都由 Cairn 发起，
 *   与其背着一段看不见的自动执行，不如在入口就把它说清楚。） */
const LIFECYCLE_SCRIPTS: readonly string[] = ["preinstall", "install", "postinstall", "prepare"];

/** 与受控安装（命令写死 pnpm）不配套的锁文件。 */
const NON_PNPM_LOCKFILES: readonly string[] = ["package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"];

function isFileAt(root: string, rel: string): boolean {
  try {
    return statSync(join(root, rel)).isFile();
  } catch {
    return false;
  }
}

/** 根目录下**常规文件**里名字命中 matcher 的那些（按名字排序）。
 *  只在顶层判：子目录里的页面由入口页自己引用；排序是为了让点名不随盘上顺序漂。 */
function rootFileNames(root: string, matcher: (name: string) => boolean): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isFile() && matcher(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** 根目录下的网页文件（按名字排序）。 */
function rootHtmlFiles(root: string): string[] {
  return rootFileNames(root, (name) => HTML_FILE_EXTENSIONS.has(extname(name).toLowerCase()));
}

/** 根目录下的 PHP 文件（按名字排序取第一个——同一次诊断读两次给同一个名字）。 */
function rootPhpFile(root: string): string | null {
  return rootFileNames(root, (name) => name.toLowerCase().endsWith(".php"))[0] ?? null;
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** package.json 声明的依赖名（dependencies + devDependencies；坏形状按没有算——上游已先判过 JSON）。 */
function declaredDeps(pkg: Record<string, unknown> | null): string[] {
  if (pkg === null) return [];
  const out: string[] = [];
  for (const key of ["dependencies", "devDependencies"]) {
    const v = pkg[key];
    if (typeof v === "object" && v !== null && !Array.isArray(v)) out.push(...Object.keys(v as Record<string, unknown>));
  }
  return out;
}

function unsupported(summary: string, reasons: string[], hint: string): ProjectDiagnosis {
  return { verdict: "unsupported", runKind: null, form: null, summary, reasons, hint };
}

function needsInfo(summary: string, reasons: string[], hint: string): ProjectDiagnosis {
  return { verdict: "needs-info", runKind: null, form: null, summary, reasons, hint };
}

/** vite 形态的细判（生命周期脚本 → 配置里的危险调用 → 锁文件 → 入口页 → 通过）。 */
function diagnoseViteForm(
  root: string,
  pkg: Record<string, unknown>,
  deps: readonly string[],
  entry: string | null,
  htmls: readonly string[],
): ProjectDiagnosis {
  const scriptsRaw = pkg.scripts;
  const scripts =
    typeof scriptsRaw === "object" && scriptsRaw !== null && !Array.isArray(scriptsRaw)
      ? (scriptsRaw as Record<string, unknown>)
      : {};
  const lifecycle = LIFECYCLE_SCRIPTS.filter((s) => typeof scripts[s] === "string" && (scripts[s] as string).trim() !== "");
  if (lifecycle.length > 0) {
    return unsupported(
      "package.json 里有安装依赖时自动执行的脚本（" + lifecycle.join("、") + "）",
      ["命中生命周期脚本：" + lifecycle.join("、")],
      "先确认这些脚本做了什么；受控纳管意味着以后装删依赖由 Cairn 发起，请把这段自动执行挪出安装链再导入。",
    );
  }
  for (const cfg of VITE_CONFIG_FILES) {
    if (!isFileAt(root, cfg)) continue;
    let text = "";
    try {
      text = readFileSync(join(root, cfg), "utf8");
    } catch {
      text = "";
    }
    const hits = VITE_CONFIG_RISKS.filter((r) => r.re.test(text)).map((r) => r.label);
    if (hits.length > 0) {
      return unsupported(
        "vite 配置里有系统命令或动态执行调用（" + hits.join("、") + "）",
        [cfg + " 命中：" + hits.join("、")],
        "运行面只受控地启动 vite；把这部分自定义挪到构建脚本之外，或先在自己的终端里跑起来。",
      );
    }
  }
  const lock = NON_PNPM_LOCKFILES.find((f) => isFileAt(root, f));
  if (lock !== undefined) {
    return needsInfo(
      "这个项目的锁文件是 " + lock + "，与受控安装（pnpm）不配套",
      ["根目录存在 " + lock],
      "用 pnpm 装一次依赖（会生成 pnpm-lock.yaml，之后预览走缓存），或先在自己的终端里跑起来。",
    );
  }
  if (entry === null) {
    return needsInfo(
      "是 Vite 项目，但根目录没有入口页 index.html",
      ["package.json 依赖里有 vite", "根目录的网页：" + (htmls.length > 0 ? htmls.join("、") + "（没有 index.html）" : "一个都没有")],
      "把 Vite 的入口页放到根目录并命名 index.html，再导入一次。",
    );
  }
  const react = deps.includes("react");
  return {
    verdict: "supported",
    runKind: "vite",
    form: react ? "react-vite" : "vite",
    summary: react ? "React + Vite 项目（受控预览：pnpm 装依赖 + vite 启动）" : "Vite 项目（受控预览：pnpm 装依赖 + vite 启动）",
    reasons: ["package.json 依赖里有 vite" + (react ? " 与 react" : ""), "根目录入口页 " + entry],
  };
}

/** 诊断一个已有目录能否被受控纳管。纯读；结论三态 + 逐条依据 + 下一步。 */
export function diagnoseProjectDirectory(rootInput: string): ProjectDiagnosis {
  const root = resolve(rootInput);
  if (!existsSync(root)) {
    return unsupported("找不到这个目录：" + root, ["路径在这个位置上不存在"], "确认文件夹还在、名字没变，再从侧栏添加一次。");
  }
  if (!statSync(root).isDirectory()) {
    return unsupported(
      "这不是一个文件夹：" + root,
      ["指向的是一个文件，不是目录"],
      "单个 .html 文件直接点预览就行；要纳管的是一整个文件夹。",
    );
  }

  // ②/③ 清单：有效即认（形态由清单决定）；存在但读不出来 ⇒ 差一条能修的信息。
  const manifestPath = join(root, PROJECT_MANIFEST_REL);
  const manifest = readProjectManifest(root);
  if (manifest !== null) {
    return {
      verdict: "supported",
      runKind: manifest.run.kind,
      form: "template",
      summary: "Cairn 项目（模板 " + manifest.templateId + "）",
      reasons: ["清单 " + PROJECT_MANIFEST_REL + " 指明的运行形态是 " + manifest.run.kind],
    };
  }
  if (existsSync(manifestPath)) {
    return needsInfo(
      "有 Cairn 清单但读不出来",
      ["找到了 " + PROJECT_MANIFEST_REL + "，但它不是合法 JSON，或 run.kind 不是 static / vite"],
      "补好 " + PROJECT_MANIFEST_REL + " 的 run.kind 再导入；修不动就把它删掉，按已有项目重新诊断。",
    );
  }

  // ④ package.json：坏 JSON 是「差信息」，不是「不支持」——用户改一个逗号就能进来。
  const pkgPath = join(root, "package.json");
  const pkgExisted = existsSync(pkgPath);
  const pkg = pkgExisted ? readJsonObject(pkgPath) : null;
  if (pkgExisted && pkg === null) {
    return needsInfo(
      "package.json 读不出来（不是合法的 JSON 对象）",
      ["package.json 存在，但 JSON.parse 没过，或顶层不是对象"],
      "先修好 package.json 的 JSON 语法，再重新诊断一次。",
    );
  }

  // ⑤ 服务端 / 非受控构建链：点到具体文件。
  for (const m of BACKEND_MARKERS) {
    if (isFileAt(root, m.file)) {
      return unsupported(
        "这个项目带" + m.label + "（" + m.file + "），不在受控运行的范围内",
        ["根目录存在 " + m.file],
        "受控纳管只覆盖零依赖静态页与 Vite 前端；带服务端的项目请在自己的终端里跑起来，再把地址粘进浏览器窗格。",
      );
    }
  }
  const phpFile = rootPhpFile(root);
  if (phpFile !== null) {
    return unsupported(
      "这个项目里有 PHP 文件（" + phpFile + "），不在受控运行的范围内",
      ["根目录存在 " + phpFile],
      "受控纳管只覆盖零依赖静态页与 Vite 前端；PHP 项目请在自己的终端里跑起来，再把地址粘进浏览器窗格。",
    );
  }
  const deps = declaredDeps(pkg);
  const blocking = BLOCKING_DEPS.find((d) => deps.includes(d));
  if (blocking !== undefined) {
    return unsupported(
      "这个项目用的是 " + blocking + "，不在受控运行的范围内",
      ["package.json 的依赖里有 " + blocking],
      "受控预览写死只跑静态服务与 vite 两条命令；请用自己的工具链跑起来，再把地址粘进浏览器窗格。",
    );
  }

  const htmls = rootHtmlFiles(root);
  const entry = htmls.includes("index.html") ? "index.html" : htmls.includes("index.htm") ? "index.htm" : null;

  if (deps.includes("vite") && pkg !== null) {
    return diagnoseViteForm(root, pkg, deps, entry, htmls);
  }

  const nonVite = NON_VITE_DEPS.find((d) => deps.includes(d));
  if (nonVite !== undefined) {
    return unsupported(
      "这个项目用 " + nonVite + " 构建，不在受控运行的范围内",
      ["package.json 的依赖里有 " + nonVite + "，且没有 vite"],
      "受控预览只认 vite 这一条构建链；请用自己的工具链跑起来，再把地址粘进浏览器窗格。",
    );
  }

  if (entry !== null) {
    return {
      verdict: "supported",
      runKind: "static",
      form: "static-html",
      summary: "零依赖静态网页（入口 " + entry + "）",
      reasons: [
        "根目录有网页入口 " + entry,
        ...(htmls.length > 1 ? ["另有 " + String(htmls.length - 1) + " 个同级网页，按相对路径互相引用"] : []),
      ],
    };
  }
  if (htmls.length > 0) {
    return needsInfo(
      "这个文件夹里有网页，但没有入口页 index.html",
      ["根目录的网页：" + htmls.join("、")],
      "把主页改名成 index.html（或新增一个）再导入一次，静态预览按这个名字找首页。",
    );
  }
  if (pkg !== null) {
    return unsupported(
      "package.json 里没有 vite，也没找到网页入口",
      ["package.json 存在，但依赖里缺少 vite；根目录也没有 index.html"],
      "受控预览只认零依赖静态页与 vite 前端；请用自己的工具链跑起来，再把地址粘进浏览器窗格。",
    );
  }
  return unsupported(
    "这个文件夹里没有可预览的网页入口",
    ["根目录既没有 index.html / index.htm，也没有 package.json"],
    "把做好的网页放进这个文件夹（入口叫 index.html），或从模板新建一个项目。",
  );
}
