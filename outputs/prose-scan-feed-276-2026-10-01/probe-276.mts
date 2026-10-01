/** 第 276 页探针：两件事各自要能被证伪。
 *  ① 判卷第四格（`extractLiterals("x.ts", t)`）走不走被改的那条路？⇒ 同一份夹具分别喂原文与涂白结果，
 *     两边输出**相同**就证明把 `blankComments` 改成原样返回时那一格照样绿（锚点会存活）。
 *  ② 补上的那两侧经过真正的消费者吗？⇒ 直接打 `collectNeedles`，并留一条已知不可能为 0 的哨兵（规则 242）。 */
import { blankComments, collectNeedles, extractLiterals } from "../../scripts/prose-needle-scan.ts";

const t = 'const a = 1; // 注释里的 "测试调用" 不是文案\n/* 块注释 "测试调用" */\nconst b = "真文案 测试调用";';

const rawChunks = extractLiterals("x.ts", t).map((c) => c.chunk);
const blankChunks = extractLiterals("x.ts", blankComments(t)).map((c) => c.chunk);
console.log(`extractLiterals(原文)=[${rawChunks.join(" ｜ ")}]`);
console.log(`extractLiterals(涂白)=[${blankChunks.join(" ｜ ")}]`);
const noPower = JSON.stringify(rawChunks) === JSON.stringify(blankChunks);
console.log(`第四格分辨力＝${noPower ? "无（两态同输出⇒那一格钉不住这条改法）" : "有"}`);
console.log(`涂白确实抹掉了注释：${String(!blankComments(t).includes("// 注释里的"))}｜等长：${String(blankComments(t).length === t.length)}`);

const both = [
  `expect(String(g.reason)).toContain("涂白前后都该收到的料");`,
  `// expect(String(g.why)).toContain("注释里划掉的那条料");`,
].join("\n");
const got = collectNeedles("z.test.ts", both).needles.map((v) => [v.field, v.needle]);
console.log(`collectNeedles 两侧夹具收到 ${String(got.length)} 条：${JSON.stringify(got)}`);

const sentinel = collectNeedles("z.test.ts", `expect(String(g.note)).toContain("哨兵那条料");`).needles;
console.log(`哨兵（没注释的那一行该收到 1 条）＝${String(sentinel.length)}`);

const ok = noPower && got.length === 1 && got[0]![0] === "reason" && sentinel.length === 1;
console.log(ok ? "✅ 探针两问都答出来：那一格无分辨力（所以锚点原本会存活）＋ 补上的判据走的是消费者" : "❌ 探针没答上来，本笔结论按未证处理");
process.exit(ok ? 0 : 1);
