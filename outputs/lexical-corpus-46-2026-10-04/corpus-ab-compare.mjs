/** 第 337 页 · #46 的逐题对照（汇总行不变 ≠ 逐题不变——规则 255 那一族，这次落在 A/B 实验读数上）。
 *  取每份 log 的 1024 那一档，逐题比 A 臂的「词面」与「排名」两通道名次。
 *  跑法：node /tmp/p336-cmp-ze.mjs <基线 log> <对照 log> ... */
import { readFileSync } from "node:fs";

const cell = (row, budget) => {
  const m = row.match(new RegExp(budget + ":A=([^ ]+)", "u"));
  if (!m) return null;
  const lex = row.match(new RegExp(budget + ":A=[^(]*\\(词面=([^,]+),排名=([^)]+)\\)", "u"));
  return { a: m[1], lex: lex ? lex[1] : "n/a", rank: lex ? lex[2] : "n/a" };
};
const parse = (file) => {
  const rows = new Map();
  let avg = "n/a";
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^L/.test(line)) {
      const id = line.split(" ")[0];
      const target = (line.match(/target=(\S+)/u) ?? [])[1] ?? "?";
      rows.set(id, { target, c: cell(line, "1024") });
    }
    if (line.includes("平均列")) avg = (line.match(/平均列=(\S+) 个文件/u) ?? [])[1] ?? avg;
  }
  return { rows, avg };
};

const [baseFile, ...rest] = process.argv.slice(2);
const base = parse(baseFile);
console.log("基线＝" + baseFile.split("/").pop() + "（平均列 " + base.avg + "）");
for (const f of rest) {
  const arm = parse(f);
  const up = [], down = [], same = [];
  for (const [id, b] of base.rows) {
    const a = arm.rows.get(id);
    if (!a || !b.c || !a.c) continue;
    const pos = (s) => (s === "MISS" ? 999 : Number(s.replace("第", "")));
    const dl = pos(a.c.lex) - pos(b.c.lex);
    const dr = pos(a.c.rank) - pos(b.c.rank);
    // MISS 不是名次：不许把 999-6 当成「差 993」印出来（那是我编的量纲，不是读数）。
    const say = (before, after, d, higher) => {
      if (before === after) return "= ";
      if (before === "MISS") return "进" + higher + "（原 MISS）";
      if (after === "MISS") return "掉出" + higher + "（原 " + before + "）";
      return (d < 0 ? "好 " : "差 ") + String(Math.abs(d)) + "（" + before + "→" + after + "）";
    };
    const line = id + " " + b.target + " 词面 " + say(b.c.lex, a.c.lex, dl, "检索行") + " · 排名 " + say(b.c.rank, a.c.rank, dr, "渲染面") + " · A 合 " + b.c.a + "→" + a.c.a;
    if (dl > 0 || dr > 0) down.push(line);
    else if (dl < 0 || dr < 0) up.push(line);
    else same.push(line);
  }
  console.log("== 对照＝" + f.split("/").pop() + "（平均列 " + arm.avg + "）");
  console.log("  变差 " + String(down.length) + " 题｜变好 " + String(up.length) + " 题｜逐字不变 " + String(same.length) + " 题");
  for (const l of down) console.log("  ↓ " + l);
  for (const l of up) console.log("  ↑ " + l);
}
