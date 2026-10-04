// 只读探针（修正版）：agent-runner.ts 里"切走哪一段会碰坏几条针脚"。
// 针脚形状（实读 scripts/mutate-verify.mjs）：{ id, src, test, desc, apply: (s) => s.replace("<needle>", …), expectFail }
// ⇒ 被锚定的源码片段 = apply 里那次 replace 的**第一个实参**。
// 初版把字段名猜成 file/needle，解析出 0 条 ⇒ 那个 0 是**坏探针的读数**，不是事实（本条已记进台账）。
import { readFileSync } from "node:fs";
const ar = readFileSync("src/main/agent-runner.ts", "utf8").split("\n");
const mv = readFileSync("scripts/mutate-verify.mjs", "utf8");

const pins = [...mv.matchAll(/\{\s*id:\s*"([^"]+)"[\s\S]*?src:\s*"([^"]+)"[\s\S]*?apply:\s*\(s\)\s*=>\s*s\.replace\(\s*"((?:[^"\\]|\\.)*)"/g)]
  .map((m) => ({ id: m[1]!, src: m[2]!, needle: JSON.parse('"' + m[3]! + '"') as string }));
const mine = pins.filter((p) => p.src === "src/main/agent-runner.ts");
console.log("解析出针脚总数:", pins.length, "｜指向 agent-runner.ts:", mine.length);
if (mine.length === 0) { console.log("❗解析仍为 0 ⇒ 探针坏了，不许据此下结论"); process.exit(1); }

const ranges: Array<[string, number, number]> = [
  ["M1d /compact", 783, 855],
  ["M1d+M2f 两段", 783, 1097],
  ["M2f security report", 855, 1097],
  ["M4a 调度器", 1097, 2312],
  ["M3a card_action", 2312, 2612],
  ["M2f sidechat", 2612, 2802],
];
for (const [name, a, b] of ranges) {
  const seg = ar.slice(a - 1, b).join("\n");
  const hit = mine.filter((p) => p.needle !== "" && seg.includes(p.needle));
  console.log(`  ${name}（${b - a} 行）⇒ 被切走的针脚 ${hit.length}/${mine.length} 条`);
  for (const h of hit.slice(0, 8)) console.log("      ·", h.id);
}
