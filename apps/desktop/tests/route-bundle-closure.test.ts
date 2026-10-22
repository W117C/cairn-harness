// 路由 JS 闭包的两条硬不变量（2026-10-22 体积面）：
//   ① 弹出窗（只渲染**一个**窗格的小窗口）的静态 import 闭包里不得有整页工作台 AppPage；
//   ② 主窗口 App 的静态闭包里同样不得有 AppPage——插件面板按需加载。
// 背景：这轮之前 PaneDock 静态 import PluginSurface ⇒ PluginSurface 静态 import AppPage ⇒
//   弹出窗静态拖进 react-resizable-panels + radix-menu + floating-ui 一族 + 整页 AppPage，
//   路由 JS 顶破 bundle 闸门（popout 423,130B > 400,000B 帽）。
// 判据读**源文件的静态 import 图**（不是产物体积）：产物侧的真闸门在 scripts/bundle-audit.mjs
//   （帽 + 退出码）；这里守的是**依赖图的形状**——回归时先变的是图，体积是它的后果。
// 反空转设计：同时钉住「解析器确实能走到 PaneDock」等正例，
//   免得解析器坏掉时闭包恒空、断言恒绿（那是本仓最忌的假绿形状）。
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DESKTOP = fileURLToPath(new URL("..", import.meta.url));
const RENDERER = join(DESKTOP, "src", "renderer");

/** 剥注释（行注释 + 块注释）：注释里出现的 import 不能算依赖边。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** 相对说明符 → 仓内绝对路径；非相对（node_modules / 裸包）不跟。 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const cand of candidates) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/** 该 import 语句是否**只**引入类型（编译后不产生运行时依赖边）。 */
function isTypeOnly(clause: string): boolean {
  const c = clause.trim();
  if (/^type\s/.test(c)) return true;
  const braced = /^\{([\s\S]*)\}$/.exec(c);
  if (braced === null) return false; // 默认导入是运行时依赖
  const parts = braced[1].split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return false;
  return parts.every((p) => /^type\s/.test(p));
}

/** 某文件的**静态**（运行时）依赖边。动态 import() 不产生静态边——它正是懒加载的形状。 */
function staticEdges(file: string): string[] {
  const src = stripComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  const push = (clause: string, spec: string): void => {
    if (isTypeOnly(clause)) return;
    const resolved = resolveSpecifier(file, spec);
    if (resolved !== null) out.push(resolved);
  };
  for (const m of src.matchAll(/\bimport\s+([^;]*?)\s+from\s*["']([^"']+)["']/g)) push(m[1] ?? "", m[2] ?? "");
  for (const m of src.matchAll(/\bexport\s+([^;]*?)\s+from\s*["']([^"']+)["']/g)) push(m[1] ?? "", m[2] ?? "");
  for (const m of src.matchAll(/\bimport\s*["']([^"']+)["']/g)) push("", m[1] ?? "");
  return out;
}

/** 从入口出发的静态闭包（只看仓内相对依赖；node_modules 不跟）。 */
function staticClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of staticEdges(file)) stack.push(next);
  }
  return seen;
}

const rel = (file: string): string => relative(DESKTOP, file);
const popoutEntry = join(RENDERER, "components", "PopoutApp.tsx");
const mainEntry = join(RENDERER, "App.tsx");
const appPage = join(RENDERER, "components", "AppPage.tsx");
const pluginSurface = join(RENDERER, "components", "PluginSurface.tsx");

describe("路由 JS 闭包：整页工作台不进弹出窗/主窗的静态依赖", () => {
  it("反空转：解析器确实走得到弹出窗的静态依赖（否则下面的「不在」是恒真）", () => {
    const closure = staticClosure(popoutEntry);
    expect(closure.has(join(RENDERER, "components", "PaneDock.tsx"))).toBe(true);
    expect(closure.has(join(RENDERER, "components", "PluginSurface.tsx"))).toBe(true);
    expect(closure.size).toBeGreaterThan(3);
  });

  it("弹出窗的静态闭包不含整页工作台 AppPage", () => {
    const closure = staticClosure(popoutEntry);
    expect(closure.has(appPage)).toBe(false);
  });

  it("主窗口的静态闭包也不含 AppPage（插件面板按需加载）", () => {
    const closure = staticClosure(mainEntry);
    expect(closure.has(appPage)).toBe(false);
  });

  it("PluginSurface 用**动态** import 取 AppPage 的面板体（懒加载边界在它内部）", () => {
    const src = stripComments(readFileSync(pluginSurface, "utf8"));
    expect(src).toMatch(/import\(\s*["']\.\/AppPage["']\s*\)/);
    expect(staticClosure(pluginSurface).has(appPage)).toBe(false);
  });

  it("AppPage 仍可达：设置页静态引用它（动态 chunk，不是消失）", () => {
    const closure = staticClosure(join(RENDERER, "components", "SettingsPanel.tsx"));
    expect(closure.has(appPage)).toBe(true);
    expect(rel(appPage)).toBe(join("src", "renderer", "components", "AppPage.tsx"));
  });
});
