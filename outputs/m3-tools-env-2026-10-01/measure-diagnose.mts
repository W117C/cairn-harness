// M3 读数：结构化诊断到底省多少上下文——拿**真实失败输出**当料（M2 留档的 vitest 六失败块全文，
// 即 run_shell 会整块丢回模型的那种 stdout），比「原文」与「diagnose 结构化清单」两侧的字节量。
// 确定性：只读仓内已提交的日志文件；不打印墙钟 / 随机 id；两次跑应逐字一致。
// 口径：结构化侧是**下界**——真实回执另有每命令一行与汇总一行（固定几行），未计入。
import { readFileSync } from "node:fs";
import { parseDiagnostics } from "../../src/tools/diagnose-parse";
import { entryLine } from "../../src/tools/diagnose";

const SRC = "outputs/m2-apply-patch-2026-10-01/reverse-verify-guard-off.log";
const raw = readFileSync(SRC, "utf8");
const d = parseDiagnostics(raw);
const structured = d.entries.map((e) => entryLine(e)).join("\n");

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");
const ratio = (bytes(structured) / bytes(raw)).toFixed(3);
console.log(`料：${SRC}（真实 vitest 失败输出全文 ${String(bytes(raw))} 字节 = run_shell 会整块丢回的量）`);
console.log(`结构化：命中 ${String(d.total)} 条（列 ${String(d.entries.length)} 条）→ 渲染 ${String(bytes(structured))} 字节`);
console.log(`两侧比：${ratio}×（结构化 / 原文；<1 = 省）`);
console.log("—— 逐条内核（证明条目不是编的）——");
for (const e of d.entries) console.log("  " + entryLine(e));
