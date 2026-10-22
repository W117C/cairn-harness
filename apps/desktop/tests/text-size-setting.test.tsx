// 界面字号档判卷（2026-10-18 接通）。
//
// 真相：CSS 侧**早就写好并在用**——`html[data-text-size=sm|lg] { --rem-scale: .92|1.08 }`，
// 而 tokens.css 里每一个字号都是 `calc(Xrem * var(--rem-scale))`。缺的只是两件事：
//   ① AppSettings 没有 textSize 字段 ⇒ App 无处存偏好；
//   ② **data-text-size 从来没被任何代码写过** ⇒ 三档是死代码，用户也无处调字号。
// 本批补上字段 + 单键直写 + App 写 html 属性 + 设置页控件。
//
// 判据分三层：① CSS 三档真的能缩放（读 tokens.css 算像素，不靠肉眼看）；
//              ② 字段持久化与回退（后端）；③ 接线（App 写属性 / 设置页有控件）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../../../src/main/settings";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAppShell } from "./helpers/app-surface";

const tokens = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");
const appSrc = readAppShell();
const panelSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/SettingsPanel.tsx", import.meta.url)), "utf8");
const sectionsSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/settings-sections.tsx", import.meta.url)), "utf8");

/** 从 tokens.css 抓 `--fs-<name>: calc(<rem>rem * var(--rem-scale))`。 */
function fontSizeRem(name: string): number {
  const m = tokens.match(new RegExp(`--fs-${name}:\\s*calc\\(([\\d.]+)rem \\* var\\(--rem-scale\\)\\)`));
  if (m === null) throw new Error(`tokens.css 里找不到 --fs-${name} 的 calc 形式`);
  return Number(m[1]);
}
/** 抓 `html[data-text-size="<tag>"] { --rem-scale: <n> }`。 */
function scaleOf(tag: "sm" | "lg"): number {
  const m = tokens.match(new RegExp(`html\\[data-text-size="${tag}"\\]\\s*\\{\\s*--rem-scale:\\s*([\\d.]+)`));
  if (m === null) throw new Error(`tokens.css 里找不到 data-text-size=${tag}`);
  return Number(m[1]);
}

describe("CSS 三档真的在缩放（读文件算像素，不靠肉眼看）", () => {
  it("sm/lg 两档的 --rem-scale 都在，且与 md 三者互不相同", () => {
    const sm = scaleOf("sm");
    const lg = scaleOf("lg");
    expect(sm).toBeGreaterThan(0);
    expect(lg).toBeGreaterThan(0);
    expect(sm).toBeLessThan(1);
    expect(lg).toBeGreaterThan(1);
    expect(new Set([1, sm, lg]).size).toBe(3); // md=1 与另两档都不同 ⇒ 三档都有效果
  });

  it("字号 token 都是 calc(rem × --rem-scale) 形式（否则改档不生效）", () => {
    // 抽样几个有代表性的：正文/标题/微字各一
    for (const name of ["body-md", "body-xl", "caption-xs", "heading-md"]) {
      expect(() => fontSizeRem(name), `--fs-${name} 不是 calc(rem × --rem-scale)`).not.toThrow();
    }
  });

  it("三档下的实际像素：小档更小、大档更大、差异看得见（≥1px）", () => {
    const sm = scaleOf("sm");
    const lg = scaleOf("lg");
    for (const name of ["body-md", "caption-xs"]) {
      const base = fontSizeRem(name) * 16;
      const smallPx = base * sm;
      const largePx = base * lg;
      expect(largePx - smallPx, `${name} 大小档差不足 1px`).toBeGreaterThanOrEqual(1);
      expect(smallPx).toBeLessThan(base);
      expect(largePx).toBeGreaterThan(base);
    }
  });

  it("md 档 = 缺省（不写属性）⇒ 对既有用户逐像素零变化", () => {
    // md 走 removeAttribute，让 --rem-scale 保持 :root 的 1
    expect(tokens).toMatch(/:root\s*\{[^}]*--rem-scale:\s*1\s*;/s);
    expect(appSrc).toContain('if (textSize === "md") document.documentElement.removeAttribute("data-text-size")');
  });
});

describe("textSize 字段（后端）", () => {
  const mkStore = (seed?: unknown): SettingsStore => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-ts-"));
    if (seed !== undefined) writeFileSync(join(dir, "settings.json"), JSON.stringify(seed));
    return new SettingsStore(join(dir, "settings.json"));
  };

  it("缺省 md（= 不缩放 = 与今天一致）", async () => {
    const s = await mkStore().get();
    expect(s.textSize).toBe("md");
  });

  it("三档都能写能读，且跨重启（新 store 实例）保留", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cairn-ts2-"));
    const file = join(dir, "settings.json");
    for (const v of ["sm", "lg", "md"] as const) {
      await new SettingsStore(file).set({ textSize: v });
      const reloaded = await new SettingsStore(file).get();
      expect(reloaded.textSize).toBe(v);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("白名单外的值回退 md（不落畸形档位）", async () => {
    const s = await mkStore({ theme: "dark", textSize: "XXL" }).get();
    expect(s.textSize).toBe("md");
    expect(s.theme).toBe("dark"); // 同格别的字段不受影响
  });

  it("旧档案没有这个键 ⇒ 读回 md（零迁移成本）", async () => {
    const s = await mkStore({ theme: "dark" }).get();
    expect(s.textSize).toBe("md");
  });
});

describe("接线（属性有人写、控件有人点）", () => {
  it("App 把 textSize 写成 html 的 data-text-size", () => {
    expect(appSrc).toContain('document.documentElement.setAttribute("data-text-size", textSize)');
    expect(appSrc).toContain("const [textSize, setTextSize] = useState<TextSizeSetting>(\"md\")");
  });

  it("App 从 settings 回灌（首载 + 设置页保存两条路都回灌）", () => {
    expect((appSrc.match(/setTextSize\(s\.textSize\)/g) ?? []).length).toBe(2);
  });

  it("设置页有控件，且走单键直写（不动 panelPatch 白名单）", () => {
    expect(sectionsSrc).toContain("aria-label=\"文字大小\"");
    expect(panelSrc).toContain('onTextSize={(next) => { setTextSize(next); void saveSettingKey("textSize", next); }}');
    // 反向：白名单仍是六键（那份判卷钉的）
    expect(sectionsSrc).toContain('export const PANEL_PATCH_KEYS = ["provider", "model", "mode", "theme", "planRequiredByDefault", "locale"] as const;');
  });

  it("三档预览各自变字号（点下去之前就看见差别）", () => {
    expect(sectionsSrc).toContain('className="ts-thumb" data-ts={t.id}');
  });
});
