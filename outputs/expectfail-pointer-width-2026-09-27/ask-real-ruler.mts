// 直接问**真尺**：这 10 根"只靠松模式过关"的指针，各自那份判卷文件是不是仍然"喂什么都能认"。
// 为什么不用我自己那份匹配逻辑：第一版探针自己重实现了取料（少两个 .each 形状），结果 6/10 与真尺结论不一致
// ——度量工具与被度量者各算一遍，正是规则 223/224 禁的形状。这里只调真尺。
// 用法：node --import tsx "outputs/expectfail-pointer-width-2026-09-27/ask-real-ruler.mts"
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expectFailMatchesTitles, vitestTitlePatterns, vitestTitles } from "../../scripts/lib/mutate-gates.ts";

const out = execFileSync(process.execPath, ["--import", "tsx", "scripts/mutate-verify.mjs", "--list"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const anchors = out.split("\n").filter((l) => l.trim() !== "").map((l) => l.split("\t"))
  .map((c) => ({ id: c[0] ?? "", test: c[3] ?? "", pointer: (() => { try { return String(JSON.parse(c[4] ?? '""')); } catch { return ""; } })() }));

const bogus = "这句话在仓库里不可能存在 QZ-7x " + String(Date.now());
const files = [...new Set(anchors.filter((a) => a.test.endsWith(".test.ts")).map((a) => a.test))].sort();
let disarmed = 0;
const looseRows: { file: string; ids: string[] }[] = [];
for (const f of files) {
  let text: string;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const acceptsGarbage = expectFailMatchesTitles(bogus, text);
  const owners = anchors.filter((a) => a.test === f && a.pointer !== "");
  const loose = owners.filter((a) => !text.includes(a.pointer) && expectFailMatchesTitles(a.pointer, text));
  if (acceptsGarbage) {
  disarmed++;
    console.log(`❌ ${f}　仍然缴械：假指针被认下（标题 ${vitestTitles(text).length} 条、模式 ${vitestTitlePatterns(text).length} 条）`);
    for (const t of vitestTitles(text)) {
      const residue = t.replace(/\\(.)/g, "$1").split(/(\$\{[\s\S]*?\}|\$[A-Za-z_]\w*|%[sdijfovc#])/).map((p) => (/(?:^\$\{[\s\S]*?\}$|^%[sdijfovc#]$|^@[a-z_]\w*$)/.test(p) ? "" : p)).join("").trim();
      if (residue === "") console.log(`    ↳ 恒真标题原文 = ${JSON.stringify(t)}`);
    }
  } else if (loose.length > 0) {
    looseRows.push({ file: f, ids: loose.map((a) => a.id) });
  }
}
console.log(`\n扫了 ${files.length} 个判卷文件：仍然缴械的 ${disarmed} 个`);
for (const r of looseRows) console.log(`松模式在用工（假指针拒收，这几根靠它过关）：${r.file} ⇒ ${r.ids.join("、")}`);
