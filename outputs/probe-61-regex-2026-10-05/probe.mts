// 只读探针：把 DATED_DIR_RE 加上可选的 `-HHMM` 后缀之后，台账里的取证面会怎么变。
const CUR = /outputs\/([A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2})/gu;
const NEW = /outputs\/([A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2}(?:-\d{4})?)/gu;
import { readFileSync } from "node:fs";
const md = readFileSync("PROGRESS.md", "utf8");
const collect = (re: RegExp) => new Set([...md.matchAll(re)].map((m) => m[1] as string));
const a = collect(CUR), b = collect(NEW);
console.log("现行抽到目录名:", a.size, "｜加 -HHMM 后:", b.size);
const added = [...b].filter((x) => !a.has(x));
const lost = [...a].filter((x) => !b.has(x));
console.log("新增:", added.length, "｜丢失:", lost.length);
console.log("新增样本:", added.slice(0, 8));
console.log("丢失样本:", lost.slice(0, 8));
// 盘上真实存在的这类目录
import { readdirSync } from "node:fs";
const dirs = readdirSync("outputs", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const stamped = dirs.filter((d) => /-\d{4}-\d{2}-\d{2}-\d{4}$/.test(d));
console.log("盘上带 -HHMM 后缀的目录:", stamped.length, stamped.slice(0, 6));
console.log("其中台账能用全名引到的（现行）:", stamped.filter((d) => a.has(d)).length, "｜（改后）:", stamped.filter((d) => b.has(d)).length);
