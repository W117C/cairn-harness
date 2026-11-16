// 单文件否定断言的棘轮（2026-11-16 · 第 1306 页）。
//
// AGENTS.md 的规则：对 renderer **源文本**做否定断言必须读整个应用面，否则代码一搬走，
// 断言就空过——空过不是通过。第 1305 页把这类断言逐条分类迁移后，余下 5 处各有
// 「位置敏感」的理由（同一串在别处合法，读面会误红）。本判卷把那 5 处冻结成上限：
//   · 新出现的单文件否定断言 ⇒ 红（要么改用 readAppSurface()，要么在本表登记理由）；
//   · 已登记文件条数变多 ⇒ 红（上限只许降）；
//   · 条数变少 ⇒ 也要来改这张表（把上限收紧，别让豁免变成永久漏洞）。
//
// 判据只看「接收者绑定自单个 renderer .ts/.tsx 文件」的 expect(...).not.toContain/Match，
// 不碰 CSS / HTML / 主进程 / 日志：那些不是应用面，规则不适用。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TESTS_DIR = fileURLToPath(new URL("./", import.meta.url));

/** 已登记的单文件否定断言：文件 ⇒ 条数上限。每一条都必须写明「为什么不能读面」。 */
const SINGLE_FILE_NEGATIVES: Readonly<Record<string, { max: number; why: string }>> = {
  "command-palette.test.tsx": {
    max: 1,
    why: "该串在命令面板自身合法，断言的是「这条提示语不在面板字符串里」",
  },
  "composer-phase.test.ts": {
    max: 1,
    why: "CairnLoader 在 Stream/ThinkingLive 合法，断言的是「输入区不再有它」",
  },
  "overlay-mutex.test.ts": {
    max: 1,
    why: "setOpen((v) => !v) 在 WorkStatusPanel 合法，断言的是「互斥浮层不各自翻状态」",
  },
  "settings-sections.test.tsx": {
    max: 1,
    why: "SHORTCUTS.map 在快捷键弹层合法，断言的是「设置页不再复读键位表」",
  },
  "terminal-clipboard.test.ts": {
    max: 1,
    why: "() => undefined 全应用常见，断言限定「PaneDock 内仅此两处被修掉」",
  },
};

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 数一个测试源里「对单文件 renderer 源做否定断言」的条数。导出供自检使用。 */
export function countSingleFileNegatives(source: string): number {
  const singleFileIds = new Set<string>();
  const readRenderer = /const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string)?\s*=\s*readRendererFile\(\s*"([^"]+)"\s*\)/g;
  const readFs = /const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string)?\s*=\s*readFileSync\(\s*fileURLToPath\(\s*new URL\(\s*"([^"]+)",\s*import\.meta\.url\s*\)\s*\)\s*,\s*"utf8"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = readRenderer.exec(source)) !== null) {
    const path = m[2]!;
    // 只算 renderer 的 .ts/.tsx；CSS / HTML / 官方 vendor 薄不是应用面。
    if (/\.(ts|tsx)$/.test(path) && !path.includes("vendor/")) singleFileIds.add(m[1]!);
  }
  while ((m = readFs.exec(source)) !== null) {
    const path = m[2]!;
    if (path.includes("/src/renderer/") && /\.(ts|tsx)$/.test(path) && !path.includes("vendor/")) {
      singleFileIds.add(m[1]!);
    }
  }
  let count = 0;
  for (const id of singleFileIds) {
    const escaped = id.replace(/\$/g, "\\$");
    count += (source.match(new RegExp(`expect\\(${escaped}\\)\\.not\\.to(?:Contain|Match)\\(`, "g")) ?? []).length;
  }
  return count;
}

describe("单文件否定断言棘轮：全应用禁令必须读面，位置敏感必须登记", () => {
  it("扫描器自检：两种读法都认得出，应用面读不算（否则下表恒真）", () => {
    const sample = [
      'import { readRendererFile } from "./helpers/app-surface";',
      'const src = readRendererFile("components/Foo.tsx");',
      "expect(src).not.toContain(\"x\");",
      // 第二种读法：直接 readFileSync + fileURLToPath(new URL("../src/renderer/..."))
      'const raw = readFileSync(fileURLToPath(new URL("../src/renderer/strings.ts", import.meta.url)), "utf8");',
      "expect(raw).not.toMatch(/z/);",
      // CSS / 主进程不是应用面
      'const css = readRendererFile("styles.css");',
      "expect(css).not.toContain(\"q\");",
      'const main = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");',
      "expect(main).not.toContain(\"w\");",
      'const appSrc = readAppSurface();',
      "expect(appSrc).not.toContain(\"y\");",
    ].join("\n");
    expect(countSingleFileNegatives(sample)).toBe(2);
  });

  it("每条登记都写了理由（空理由 = 没登记）", () => {
    for (const [file, { why }] of Object.entries(SINGLE_FILE_NEGATIVES)) {
      expect(why.trim().length, `${file} 的理由是空的`).toBeGreaterThan(8);
    }
  });

  const measured = new Map<string, number>();
  const self = fileURLToPath(import.meta.url);
  for (const file of testFiles(TESTS_DIR)) {
    // 判卷自己带着合成样本（字符串里就有 readRendererFile 的写法），不把自己算进被检面。
    if (file === self) continue;
    const count = countSingleFileNegatives(readFileSync(file, "utf8"));
    if (count > 0) measured.set(relative(TESTS_DIR, file), count);
  }

  it("没有未登记的单文件否定断言（新位点要么读面，要么在本表写明理由）", () => {
    const unregistered = [...measured.keys()].filter((file) => SINGLE_FILE_NEGATIVES[file] === undefined);
    expect(
      unregistered,
      "这些测试对单个 renderer 文件做否定断言：改成 readAppSurface()/readAppPageSurface()，" +
        "或在本文件 SINGLE_FILE_NEGATIVES 登记文件、条数与「为什么不能读面」",
    ).toEqual([]);
  });

  it("已登记文件不许超过上限（棘轮只降不升）", () => {
    const growth = Object.entries(SINGLE_FILE_NEGATIVES)
      .map(([file, { max }]) => ({ file, max, actual: measured.get(file) ?? 0 }))
      .filter(({ max, actual }) => actual > max);
    expect(growth, "条数变多说明又新增了单文件否定断言；请改读应用面，不要抬高上限").toEqual([]);
  });

  it("已登记文件变少也要收紧上限（豁免不许变成永久漏洞）", () => {
    for (const [file, { max }] of Object.entries(SINGLE_FILE_NEGATIVES)) {
      const actual = measured.get(file) ?? 0;
      expect(
        actual,
        `${file} 现在只有 ${actual} 条（上限 ${max}）；收紧 SINGLE_FILE_NEGATIVES，或整条删掉`,
      ).toBe(max);
    }
  });
});
