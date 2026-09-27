/** 能力 20 L0（投影出口合法性闸）判据的分辨力实测：四条突变。
 *  跑法：TERM=dumb node --import tsx outputs/projection-invariant-2026-09-23/mutation-check.mts
 *  备份到系统临时目录 → 突变 → 跑 tests/projection-invariant.test.ts → 逐字还原
 *  （还原失败即红着退出，绝不把突变留在工作树里）。
 *
 *  每条 mustKill 只列**该当红**的那几条：「降级消息留在原位」在"整道闸拿掉"下本就该活着
 *  （消息仍在原位、只是没被降级）——把它列进 N1 的期望就是给自己写一条错账（31 页 R4 同一条教训）。 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src/agent/context.ts");
const TEST = "tests/projection-invariant.test.ts";
const PUSH = '      out.push({ role: "user", content: orphanResultNote(id, String(m.content ?? "")) });';

const MUTS: { id: string; what: string; from: string; to: string; mustKill: string[] }[] = [
  {
    id: "N1-gate-off",
    what: "针 B：把出口那道闸整个拿掉（等价于「闸只长在 orchestrator 里」——测试用的是非生产者造的形状，必红）",
    from: "closeDanglingToolCalls(demoteOrphanToolResults(mergeToolResultsById(msgs)))",
    to: "closeDanglingToolCalls(mergeToolResultsById(msgs))",
    mustKill: ["supervise 派生 id 的现场形状", "破纪的压缩输入"],
    // 「降级正文同样过中和」刻意不在这一格：闸拿掉后正文仍以 tool 形态带着**已中和**的标签，
    // 那条量的是出口性质而不是"有没有降级"，它本就该活着。
  },
  {
    id: "N2-drop",
    what: "针 A：把「降级成 user」改成「直接丢孤儿消息」（§五 明令不采纳的那条捷径）",
    from: PUSH + "\n      continue;",
    to: "      continue;",
    mustKill: ["supervise 派生 id 的现场形状", "降级消息留在原位", "降级正文同样过中和"],
  },
  {
    id: "N3-reorder",
    what: "降级消息不留在原位而是挪到序列末尾（时序即信息那一半；unshift 那种改法量不到这条，因为它仍在原文之前）",
    from: "  return out;\n}\n\n/** 组装投影",
    to: "  return [...out.filter((x) => !String(x.content ?? \"\").startsWith(\"[harness] 以下回执\")),\n    ...out.filter((x) => String(x.content ?? \"\").startsWith(\"[harness] 以下回执\"))];\n}\n\n/** 组装投影",
    mustKill: ["降级消息留在原位"],
  },
  {
    id: "N4-no-escape",
    what: "摘掉工具正文那一处的中和（证明「降级正文同样过中和」这条真的在量出口性质，不是量一个死调用）",
    from: "content: escapeControlTags(pruned ?? e.output)",
    to: "content: pruned ?? e.output",
    mustKill: ["降级正文同样过中和"],
  },
];

function runTests(): { exit: number; failed: string[]; raw: string } {
  try {
    const out = execFileSync(process.execPath,
      ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", TEST],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TERM: "dumb" } });
    return { exit: 0, failed: [], raw: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const text = (err.stdout ?? "") + (err.stderr ?? "");
    return {
      exit: err.status ?? 1,
      failed: [...text.matchAll(/^ FAIL\s+\S+\s+>\s+(.+)$/gm)].map((m) => (m[1] ?? "").trim()),
      raw: text,
    };
  }
}

const backup = mkdtempSync(join(tmpdir(), "proj-invariant-bak-"));
const orig = readFileSync(SRC, "utf8");
writeFileSync(join(backup, "context.ts"), orig, "utf8");
let code = 0;
try {
  for (const m of MUTS) {
    if (!orig.includes(m.from)) throw new Error(`${m.id}: 靶文本没找到 → ${m.from.slice(0, 50)}`);
    writeFileSync(SRC, orig.replace(m.from, m.to), "utf8");
    const r = runTests();
    console.log(`\n## ${m.id} ${m.what}`);
    console.log(`   exit=${String(r.exit)}  红 ${String(r.failed.length)} 条`);
    if (r.exit !== 0 && r.failed.length === 0) {
      console.log("   ⚠️ 非零退出却一条 FAIL 都没有 = 收集期崩了，这条读数不可信：" +
        (r.raw.split("\n").find((l) => /Error|Expected|Unexpected/.test(l)) ?? "?").slice(0, 150));
      code = 1;
    }
    for (const k of m.mustKill) {
      const hit = r.failed.some((t) => t.includes(k));
      if (!hit) code = 1;
      console.log(`   ${hit ? "杀掉 " : "存活!"} ${k}`);
    }
    for (const f of r.failed) if (!m.mustKill.some((k) => f.includes(k))) console.log(`   （附带红：${f}）`);
    writeFileSync(SRC, orig, "utf8");
  }
} finally {
  if (readFileSync(SRC, "utf8") !== orig) {
    console.log("❌ 还原失败：src/agent/context.ts 与备份不同——立刻 git diff 检查！");
    code = 1;
  } else console.log("\n还原核对：源文件逐字相同。");
  rmSync(backup, { recursive: true, force: true });
}
console.log(code === 0 ? "⇒ 四条突变各自抓到该抓的那一半：出口闸、不丢内容、位置、中和。" : "⇒ 有突变存活或读数不可信。");
process.exit(code);
