// 判卷读面迁移（Phase 2 · 批 2.1）：「应用外壳」= 组成桌面 app shell 的那组渲染层源文件。
//
// 为什么要有这一层：拆分 App.tsx 之后，**只读 App.tsx 的判卷会静默失明**——
// 代码搬走了，断言看不见它了；更糟的是 `not.toContain(...)` 那种否定断言会**空过**
// （"文件里没有这段串" 成立，但那段串已经搬到别的文件里去了）——那叫削弱，纪律上禁止。
// 所以：钉「应用里有没有这段代码」的判卷，一律读**面**（surface），不读单文件。
//
// 面的顺序：**App.tsx 在最前，其余按路径字典序**。App.tsx 优先是刻意的——
// 它是 composition root，大多数接线断言的锚点在那儿；其余按路径排序是为了
// 判卷读数**可复现**（同一份仓、同一份面，顺序恒定；不靠文件系统返回顺序）。
//
// 面的内容：从文件系统**在调用时**枚举（新建文件自动进面，不靠改名单），
// 但顺序稳定。vendor/ 不进面（第三方拷贝，不是本仓代码；面是"我们的代码"）。
//
// 位置敏感断言（`between(...)` / `bodyOf(...)` / "锚点前 N 字符窗口"）**不要**用面：
// 那类断言钉的是"这段代码在哪、周围是什么"，跨文件拼接会让它空过或假绿。
// 那些断言请**单独读它要的那个文件**（仍是读面迁移，不是改断言）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** 渲染层根目录（apps/desktop/src/renderer）。本仓路径含空格，必须经 fileURLToPath 还原。 */
const RENDERER_DIR = fileURLToPath(new URL("../../src/renderer", import.meta.url));

/** 面里不收的目录：第三方拷贝（vendor）不是本仓代码，node_modules 同理。 */
const EXCLUDED_DIRS = new Set(["vendor", "node_modules", "dist", "dist-electron"]);

function isSourceFile(name: string): boolean {
  return /\.tsx?$/.test(name);
}

/** 递归列出 dir 下的 .ts/.tsx（跳过排除目录）；结果按相对路径字典序（POSIX 分隔符）。 */
function listSourceFiles(dir: string, base: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue;
      listSourceFiles(full, base, out);
      continue;
    }
    if (!isSourceFile(name)) continue;
    out.push(relative(base, full).split(sep).join("/"));
  }
}

/** 面的文件清单（相对 renderer 根，POSIX 斜杠）：App.tsx 在最前，其余按路径排序。 */
export function appSurfaceFiles(): string[] {
  const rels: string[] = [];
  listSourceFiles(RENDERER_DIR, RENDERER_DIR, rels);
  rels.sort();
  const out = rels.filter((r) => r !== "App.tsx");
  if (rels.includes("App.tsx")) out.unshift("App.tsx");
  return out;
}

/** 应用外壳面 = 全部渲染层源文件的源码拼接（顺序固定，见 appSurfaceFiles）。 */
export function readAppSurface(): string {
  return appSurfaceFiles()
    .map((rel) => readFileSync(join(RENDERER_DIR, rel), "utf8"))
    .join("\n");
}

/** 读渲染层里的**单个**文件（相对 renderer 根）——位置敏感断言用这个，不用面。 */
export function readRendererFile(rel: string): string {
  return readFileSync(join(RENDERER_DIR, rel), "utf8");
}

/** 编排层自己的目录（组成 root 的那几层）。 */
const SHELL_DIRS = ["state/", "derived/", "panes/"];

/**
 * 应用**编排层**（composition root + 它自己那几层）= App.tsx + state/ + derived/ + panes/。
 *
 * 与 readAppSurface 的差别：面里还含 presentational 组件（components/）与工具模块
 * （send-queue.ts / drafts.ts / projections.ts…）。有些断言钉的正是"**App 自己**不许做 X"
 * （App 不许直写草稿桶 / App 只有两处 scrollIntoView / App 只回灌两次 textSize）——
 * 那些话在组件层是**合法**的（Composer 本来就该写草稿桶），让它们进面就是把
 * "App 不许…"读成"整个渲染层不许…"⇒ 判据变形。
 * 这类断言读编排层，不读面。仍然是读面迁移，不是改断言。
 */
export function readAppShell(): string {
  const files = appSurfaceFiles().filter(
    (rel) => rel === "App.tsx" || SHELL_DIRS.some((d) => rel.startsWith(d)),
  );
  return files.map((rel) => readFileSync(join(RENDERER_DIR, rel), "utf8")).join("\n");
}
