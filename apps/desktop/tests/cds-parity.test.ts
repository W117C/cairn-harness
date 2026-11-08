// CDS 一比一判卷（2026-10-27）：
// 事实源是 `src/renderer/vendor/cds-official/tokens.css`——Claude Desktop 3.6556.2 里
// 逐字节取出的官方 vanilla 令牌样式薄（来源与 sha256 见同目录 UPSTREAM.json）。
//
// 为什么判卷读**两个文件**而不是只读 adapter：
//   ① 判「我们没改官方那 1021 条声明」= 官方文件 sha256 对得上（染改官方值不行）；
//   ② 判「adapter 真的接到了官方值上」= adapter 里每一条映射的右侧必须**解析得到**官方令牌。
//   只判 ①，adapter 可以完全不接；只判 ②，官方文件被改成我们的旧值也能绿。两条一起才成立。
//
// 纪律：adapter 的映射表是**声明式**的（右值只许是 var(--官方名)），
// 这样「一比一」不是靠人眼比对 hex，而是靠这条判卷在每次改色时挡住漂移。
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const officialPath = fileURLToPath(new URL("../src/renderer/vendor/cds-official/tokens.css", import.meta.url));
const upstreamPath = fileURLToPath(new URL("../src/renderer/vendor/cds-official/UPSTREAM.json", import.meta.url));
const adapterPath = fileURLToPath(new URL("../src/renderer/cds-adapter.css", import.meta.url));
const mainPath = fileURLToPath(new URL("../src/renderer/main.tsx", import.meta.url));
const entry = readFileSync(mainPath, "utf8");

// 真机取料（`electron scripts/cds-values-probe.cjs` 现跑）。缺席时相关断言 skip 并明说不算通过。
// 把 getComputedStyle 的 `rgb(r, g, b)` 归一成 hex，便于和官方取值逐字比对。
function hex(rgb: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (m === null) throw new Error(`不是 rgb() 结果: ${rgb}`);
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}

const measuredPath = fileURLToPath(new URL("../outputs/cds-parity-verify/values.json", import.meta.url));
const hasMeasured = existsSync(measuredPath);
const measured = (hasMeasured ? JSON.parse(readFileSync(measuredPath, "utf8")) : {}) as {
  appRendered?: boolean;
  officialSheetLoaded: boolean;
  light: { tokens: Record<string, string>; paint?: Record<string, string | null> };
  dark: { tokens: Record<string, string>; paint?: Record<string, string | null> };
};

const official = readFileSync(officialPath, "utf8");
const adapter = readFileSync(adapterPath, "utf8");
const upstream = JSON.parse(readFileSync(upstreamPath, "utf8")) as {
  files: readonly { file: string; sha256: string; bytes: number }[];
  tokenDeclarationCount: number;
  uniqueTokenNames: number;
};

/** 从一整张样式薄里取某个选择器块内的声明（同名多次出现时全部返回，按出现顺序）。 */
function declarationsIn(css: string, selector: string, name: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(selector, from);
    if (at < 0) return out;
    const open = css.indexOf("{", at);
    if (open < 0) return out;
    let depth = 0;
    let i = open;
    for (; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const block = css.slice(open, i + 1);
    const re = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`, "m");
    const match = block.match(re);
    if (match !== null) out.push(match[1].trim());
    from = i + 1;
  }
  return out;
}

describe("官方 CDS 令牌薄未被改写", () => {
  it("sha256 与 UPSTREAM.json 记录一致（改了官方值这条先红）", () => {
    const actual = createHash("sha256").update(official).digest("hex");
    const declared = upstream.files.find((file) => file.file === "tokens.css");
    expect(declared).toBeDefined();
    expect(actual).toBe(declared?.sha256);
    expect(Buffer.byteLength(official)).toBe(declared?.bytes);
  });

  it("声明条数与唯一令牌名数与抽取记录一致（只准随重新抽取变化，不准手改）", () => {
    const all = [...official.matchAll(/^\s*(--[A-Za-z][\w-]*)\s*:/gm)].map((m) => m[1] as string);
    expect(all.length).toBe(upstream.tokenDeclarationCount);
    expect(new Set(all).size).toBe(upstream.uniqueTokenNames);
  });
});

describe("adapter 的每条映射都解析到官方令牌（不是我们的旧字面量）", () => {
  /** adapter 声明块里的 `--cairn-x: var(--官方名);` 形式映射。 */
  const mappings = [...adapter.matchAll(/^\s*(--[A-Za-z][\w-]*)\s*:\s*([^;]+);/gm)]
    .map((match) => ({ target: match[1], value: match[2].trim() }))
    // 两种合法形状：`var(--官方名)` 直接转发；`from var(--官方名) h s l` 把整色拆成三元组。
    // 后者是 Cairn 颜色接口（hsl(var(--x))）与 CDS 整色值之间的桥，同样必须指向官方名。
    .filter((mapping) => mapping.value.startsWith("var(--") || mapping.value.startsWith("from var(--"));

  it("映射非空（空表会让下面每条恒真）", () => {
    expect(mappings.length).toBeGreaterThanOrEqual(24);
  });

  it("每条 var(--x) 的 x 在官方薄里真有定义", () => {
    const defined = new Set(
      [...official.matchAll(/^\s*(--[A-Za-z][\w-]*)\s*:/gm)].map((match) => match[1]),
    );
    const dangling = mappings
      .map((mapping) => mapping.value.replace(/^from\s+/, "").replace(/^var\(\s*/, "").replace(/[\s,)].*$/, ""))
      .filter((name) => !defined.has(name));
    expect(dangling).toEqual([]);
  });

  it("没有自引用（`--x: var(--x)` 在 CSS 里是循环 ⇒ 声明作废 ⇒ 组件拿到空值）", () => {
    const circular = mappings.filter((mapping) =>
      new RegExp(`var\\(\\s*${mapping.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`).test(mapping.value),
    );
    expect(circular).toEqual([]);
  });

  it("没有一条映射把官方值抄成字面量（抄成字面量会让官方升级时静默脱钩）", () => {
    const literal = mappings.filter((mapping) => /#[0-9a-f]{3,8}\b|^\d+(\.\d+)?%?\s/i.test(mapping.value));
    expect(literal).toEqual([]);
  });
});

describe("adapter 真的接线到应用（不是躺在仓库里的孤儿文件）", () => {
  it("adapter 必须是令牌层最后一个 import；组件层紧随其后（它也读官方变量并压过缺省）", () => {
    const at = (needle: string): number => entry.indexOf(needle);
    const adapter = at('"./cds-adapter.css"');
    expect(adapter).toBeGreaterThan(-1);
    for (const earlier of ['"./tokens.css"', '"./styles.css"', '"./dsh-claude-style.css"']) {
      expect(at(earlier)).toBeGreaterThan(-1);
      expect(at(earlier)).toBeLessThan(adapter);
    }
    // 2026-10-28 第 734 页：adapter 之后只允许组件层（cds-components.css）——
    // 它消费官方契约变量，必须晚于 adapter 才能压过缺省；任何第三个样式 import 都算接线漂移。
    const after = entry.slice(adapter + '"./cds-adapter.css"'.length);
    const laterImports = [...after.matchAll(/^import "\.\/([^"]+\.css)";/gm)].map((match) => match[1]);
    expect(laterImports).toEqual(["cds-components.css"]);
  });

  it("adapter 把官方薄 import 进来（官方令牌因此真的进入产物）", () => {
    expect(adapter).toContain('@import "./vendor/cds-official/tokens.css"');
  });
});

describe("官方 CDS 的暗色靠 data-mode 划作用域，Cairn 的主题键必须两处都写", () => {
  it("官方薄里暗色块的选择器是 [data-mode=\"dark\"]（不是 data-theme）", () => {
    expect(official).toMatch(/\[data-mode="dark"\]\s*,\s*\n\[data-mode="system"\]\s*\{/);
    expect(official).not.toContain('data-theme="dark"');
  });

  it("themeKeysOf 同时产出 data-theme 与 data-mode（漏一个 ⇒ 暗色静默退回亮色）", async () => {
    const { themeKeysOf } = await import("../src/renderer/theme");
    expect(themeKeysOf("dark").attributes).toEqual({ "data-theme": "dark", "data-mode": "dark" });
    expect(themeKeysOf("light").attributes).toEqual({ "data-theme": "light", "data-mode": "light" });
    expect(themeKeysOf("dark").bodyDark).toBe(true);
    expect(themeKeysOf("light").bodyDark).toBe(false);
  });
});

describe("外壳画布按官方 surface 档位取（Claude 的页面/侧栏/接缝不在令牌里，由宿主定）", () => {
  it("surface-0..3 官方值是 gray-20/10/0/0 与暗色 900/850/830/800", () => {
    expect(declarationsIn(official, ":root", "--surface-0")[0]).toBe("var(--gray-20)");
    expect(declarationsIn(official, ":root", "--surface-1")[0]).toBe("var(--gray-10)");
    expect(declarationsIn(official, ":root", "--surface-2")[0]).toBe("var(--gray-0)");
    expect(declarationsIn(official, ":root", "--surface-3")[0]).toBe("var(--gray-0)");
  });

  it("页画布 --page-bg 缺省就等于 surface-0（官方 elevation 规则）", () => {
    expect(declarationsIn(official, ":root", "--page-bg")[0]).toBe("var(--surface-0)");
  });
});

describe("实测值对得上官方（证据来自真实 renderer 的 getComputedStyle，不是读 CSS 文本）", () => {
  it.skipIf(!hasMeasured)("官方调色板真的进了产物（gray-20 / gray-900 解析得出）", () => {
    expect(measured.officialSheetLoaded).toBe(true);
  });

  it("证据存在时才算数（缺席不等于通过，见本组注释）", () => {
    expect(typeof hasMeasured).toBe("boolean");
  });

  it.skipIf(!hasMeasured)("surface 四档亮色 = gray-20 / gray-10 / gray-0 / gray-0", () => {
    expect(hex(measured.light.tokens["--surface-0"])).toBe("#f9f9f7");
    expect(hex(measured.light.tokens["--surface-1"])).toBe("#fcfcfb");
    expect(hex(measured.light.tokens["--surface-2"])).toBe("#ffffff");
    expect(hex(measured.light.tokens["--surface-3"])).toBe("#ffffff");
  });

  it.skipIf(!hasMeasured)("surface 四档暗色 = gray-900 / gray-850 / gray-830 / gray-800", () => {
    expect(hex(measured.dark.tokens["--surface-0"])).toBe("#0b0b0b");
    expect(hex(measured.dark.tokens["--surface-1"])).toBe("#151515");
    expect(hex(measured.dark.tokens["--surface-2"])).toBe("#1a1a19");
    expect(hex(measured.dark.tokens["--surface-3"])).toBe("#20201f");
  });

  it.skipIf(!hasMeasured)("clay 亮暗同值（模式稳定色阶），accent 的 bg 双主题相反", () => {
    expect(hex(measured.light.tokens["--clay"])).toBe("#d97757");
    expect(hex(measured.dark.tokens["--clay"])).toBe("#d97757");
    expect(hex(measured.light.tokens["--bg-accent"])).toBe("#cde2fb");
    expect(hex(measured.dark.tokens["--bg-accent"])).toBe("#032042");
  });

  it.skipIf(!hasMeasured)("刻度：--radius 8px(0.5rem) / --h-control 32px(2rem)", () => {
    expect(measured.light.tokens["--radius"]).toBe("8px");
    expect(measured.light.tokens["--h-control"]).toBe("32px");
  });
});

describe("画出来的颜色 = 官方档位（2026-10-28 补：令牌对但元素被皮肤盖住的假通过）", () => {
  // 教训：先前只量 `--surface-*` 令牌，全绿；实际截图暗色整屏却是皮肤近似色 #141413。
  // 这组断言量 `.side` / body / `[data-composer-card]` 的**实际背景色**，且要求 appRendered。
  const m = measured as unknown as {
    appRendered?: boolean;
    light: { paint?: Record<string, string | null> };
    dark: { paint?: Record<string, string | null> };
  };

  it.skipIf(!hasMeasured)("探针必须真的把界面渲染出来（渲染失败时下面每条都会是 null）", () => {
    expect(m.appRendered).toBe(true);
  });

  it.skipIf(!hasMeasured)("亮色：页面 gray-10 / 侧栏 gray-20 / 卡片 gray-0", () => {
    expect(hex(m.light.paint?.body as string)).toBe("#fcfcfb");
    expect(hex(m.light.paint?.sidebar as string)).toBe("#f9f9f7");
    expect(hex(m.light.paint?.composerCard as string)).toBe("#ffffff");
  });

  it.skipIf(!hasMeasured)("暗色：页面 gray-850 / 侧栏 gray-870 / 卡片 gray-830（页面与侧栏对真机实测）", () => {
    expect(hex(m.dark.paint?.body as string)).toBe("#151515");
    expect(hex(m.dark.paint?.sidebar as string)).toBe("#111111");
    expect(hex(m.dark.paint?.composerCard as string)).toBe("#1a1a19");
  });
});
