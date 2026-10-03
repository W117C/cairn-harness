/** 第 318 页 · 四台造红：配对行豁免这把尺每条断言都要咬得住。
 *  规矩（`dsh-scale-landing-with-anchors`）：改前备份、每台针脚必须**恰好命中一处**、
 *  每台红在**不同用例**上、跑完用 cp 复原并 cmp 逐字节校验；解析前先 stripAnsi。
 *  这台机器只动 `scripts/prose-needle-scan.ts`，判卷只跑 `tests/prose-needle-scan.test.ts`。 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stripAnsi, vitestSummary } from "../../scripts/lib/vitest-summary.ts";

const ROOT = join(import.meta.dirname, "../..");
const TARGET = "scripts/prose-needle-scan.ts";
const JUDGE = "tests/prose-needle-scan.test.ts";

interface Machine {
  id: string;
  desc: string;
  from: string;
  to: string;
  /** 期望红在那一条用例（每台必须不同）。 */
  expectCase: string;
}

const MACHINES: Machine[] = [
  {
    id: "M1-exemption-removed",
    desc: "整条豁免摘掉（配对行又回到生产者池）⇒ 登记表自己把唯一的真生产者垫成顶包",
    from: "const producerChunks = chunks.filter((c) => !shadowPaths.has(c.path) && c.pairRow !== true);",
    to: "const producerChunks = chunks.filter((c) => !shadowPaths.has(c.path));",
    expectCase: "整行都挡：匹配键与给人读的说明一起出去，真生产者那一处还在（copies 与 rawCopies 并排）",
  },
  {
    id: "M2-any-face-string-is-a-key",
    desc: "值形状检查放宽（任何 face 字符串都算配对键）⇒ 枚举值那一族被误当登记表",
    from: "    return isFaceRefChunk({ chunk: decodeJs(pa.initializer.getText(source).slice(1, -1)) });",
    to: "    return true;",
    expectCase: "反向 B：face 的值是枚举词（没有那段「file#fn｜」形状）⇒ 那是取值，不是配对键，行不豁免",
  },
  {
    id: "M3-object-valued-face-counts",
    desc: "把「值必须是字符串」与形状检查一起摘掉⇒ 工具规格里 `face: {…}` 那行被豁免，模型可见的 description 被放走",
    from: "    const k = pa.initializer.kind;\n"
      + "    if (k !== ts.SyntaxKind.StringLiteral && k !== ts.SyntaxKind.NoSubstitutionTemplateLiteral) return false;\n"
      + "    return isFaceRefChunk({ chunk: decodeJs(pa.initializer.getText(source).slice(1, -1)) });",
    to: "    return true;",
    expectCase: "反向 A：face 的值是**对象**（工具规格那一族）⇒ 行不豁免——行里的 description 是真给模型看的",
  },
  {
    id: "M4-why-joins-prose-keys",
    desc: "图省事按**键名**放宽（把 why 塞进散文栏名单）⇒ 两处真会发出去的 why 一起失去观测",
    from: 'export const DOC_PROSE_KEYS: readonly string[] = ["desc"];',
    to: 'export const DOC_PROSE_KEYS: readonly string[] = ["desc", "why"];',
    expectCase: "键名不是判据：why 是**会发出去的字段**，不在配对行里的 why 照算生产者（也不许进散文栏名单）",
  },
  {
    id: "M5-file-level-exemption",
    desc: "把豁免从「行」放宽到「文件」（含 face: 的文件整个进影子池）⇒ 同文件里真给受众看的那句被一起放走",
    from: "  const shadowPaths = new Set(kinds.map((s) => s.path));",
    to: "  const shadowPaths = new Set(kinds.map((s) => s.path).concat(sources.filter((s) => s.text.includes(\"face:\")).map((s) => s.path)));",
    expectCase: "豁免只到行、不到文件：含配对行的那份文件不许整份进影子池（同文件里的真文案还在面内）",
  },
];

const scratch = mkdtempSync(join(tmpdir(), "pairrow-red-"));
const orig = join(ROOT, TARGET);
const bak = join(scratch, "prose-needle-scan.ts.bak");
copyFileSync(orig, bak);
const text0 = readFileSync(orig, "utf8");

const failTitles = (out: string): string[] =>
  [...new Set(stripAnsi(out).split("\n")
    .filter((l) => l.includes("FAIL") && l.includes(JUDGE))
    .map((l) => l.slice(l.lastIndexOf("> ") + 2).trim()))];

let bad = 0;
try {
  for (const m of MACHINES) {
    const hits = text0.split(m.from).length - 1;
    if (hits !== 1) {
      console.log(`❌ ${m.id} 针脚命中 ${String(hits)} 处（必须恰好 1 处）⇒ 这台没跑，读数不成立`);
      bad += 1;
      continue;
    }
    writeFileSync(orig, text0.replace(m.from, m.to));
    const t0 = Date.now();
    let out = "";
    let code = 0;
    try {
      out = execFileSync("node", ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", JUDGE], {
        cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; status?: number };
      out = (err.stdout ?? "") + (err.stderr ?? "");
      code = err.status ?? -1;
    }
    const ms = Date.now() - t0;
    const sum = vitestSummary(out);
    const titles = failTitles(out);
    const saw = titles.includes(m.expectCase);
    if (!sum.found) {
      console.log(`❌ ${m.id} 读不到 Tests 摘要行（命令没跑起来）⇒ 退出码 ${String(code)}，不判`);
      bad += 1;
    } else if (!saw) {
      console.log(`❌ ${m.id} 没红在该当的那条用例上：failed=${String(sum.failed)}｜红的是 ${titles.join(" / ") || "（无）"}`);
      bad += 1;
    } else {
      console.log(`✅ ${m.id} 红在「${m.expectCase}」（failed=${String(sum.failed)}，${String(ms)}ms，退 ${String(code)}）`);
      console.log(`   其余红：${titles.filter((t) => t !== m.expectCase).join(" / ") || "（无）"}`);
    }
    copyFileSync(bak, orig);
  }
  const same = readFileSync(orig, "utf8") === text0;
  console.log(same ? "复原校验：与备份逐字节一致 ✅" : "复原校验：❌ 现文件与备份不一致");
  if (!same) bad += 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(bad === 0 ? "RED_MACHINES=OK" : `RED_MACHINES=BAD(${String(bad)})`);
process.exitCode = bad === 0 ? 0 : 1;
