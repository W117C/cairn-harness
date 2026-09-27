/** 31 页 §五 那条留空的读数：read_file 的大文件前缀路径有没有同样的「字符当字节」单位错。
 *  只往 mkdtemp 写，不碰工作树与判卷文件。
 *  跑法：TERM=dumb node --import tsx outputs/truncation-account-2026-09-23/check-readfile-units.mts */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { read_file } from "../../src/tools/read_file";
import { readFileSync } from "node:fs";

const src = readFileSync(join(process.cwd(), "src/tools/read_file.ts"), "utf8");
const capLine = /LARGE_FILE_PREFIX_BYTES\s*=\s*([^;]+);/.exec(src)?.[1] ?? "?";
console.log(`## 读码：LARGE_FILE_PREFIX_BYTES = ${capLine}`);
console.log(`   该文件里按**字节**量的地方：${(src.match(/Buffer\.byteLength/g) ?? []).length} 处 Buffer.byteLength、` +
  `${(src.match(/\.length\s*[<>]=?/g) ?? []).length} 处 .length 与 </>/<=/>= 比较`);
const cap = eval(capLine as string) as number;
if (typeof cap !== "number" || !Number.isFinite(cap)) { console.log("   常量不可求值，本问判为 unmeasurable"); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), "dsh31-"));
try {
  for (const [label, unit] of [["ASCII", "a"], ["中文", "错"]] as Array<[string, string]>) {
    // 造一个「字符数刚好 = 上限」的文件：字符口径不截，字节口径（中文 3×）该截。
    const text = unit.repeat(cap) + "\n";
    const p = join(dir, `${label}.txt`);
    writeFileSync(p, text, "utf8");
    const r = await read_file.run({ path: `${label}.txt` }, { workspace: dir } as never);
    const out = r.output;
    console.log(`\n## ${label}：文件字符数 ${String(text.length)} / 字节 ${String(Buffer.byteLength(text, "utf8"))}，帽 ${String(cap)}`);
    console.log(`   返回 output：字符 ${String(out.length)} / 字节 ${String(Buffer.byteLength(out, "utf8"))}` +
      `  → ${Buffer.byteLength(out, "utf8") > cap ? "**字节口径破帽**" : "字节口径守住"}${out.length > cap ? " / 字符口径也超" : ""}`);
    console.log(`   提示行：${/\[truncated|仅读|行截断/.test(out) ? out.split("\n").filter((l) => /truncated|仅读/.test(l)).join(" ⏎ ").slice(0, 120) : "（无截断提示）"}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("\n⚠️ 只读物、不含墙钟，两次跑应逐字一致（临时目录名不打印）。");
