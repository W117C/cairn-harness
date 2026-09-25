// 维护探针（跑完即恢复）：针脚字面量失效 ≠ 那一格没人守。
// 对每条**因我这几轮改动而失效**的锚点，把它原本要造成的突变照样施加一遍，看它 `expectFail` 那格用例还红不红：
//   红 ⇒ 观测者还在，只是 `apply` 的字面量要跟着改指（#50 的活）；
//   不红 ⇒ 那一格真的没人守了，这是产品级缺口，得补判卷。
// 用法：node --import tsx outputs/dead-needles-observers-2026-09-26/01-probe.mts <锚点 id>
// 读数与结论见同目录 `02-门表漏了9道而针脚6条是我欠的.md`（第 77 页）：6 条全部"红在期望那一格"⇒ 观测者还在。
// CASES 里这 6 条＝本轮实测过的 6 处真漂移（`--check-needles` 阻断 11 里剩下的 5 条属他人写作窗，不在此列）。
// 安全：只写"盘上确实存在的整段字面量"（找不到就拒绝运行）；恢复走 finally + 落盘前原文；跑完外层还要 `git status` 复核。
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

interface Case { id: string; src: string; test: string; title: string; from: string; to: string }

const CASES: readonly Case[] = [
  {
    id: "prune-stub-hides-attachment-path",
    src: "src/agent/prune.ts",
    test: "tests/prune.test.ts",
    title: "①传 attachmentsDir ⇒ 打桩自带路径",
    from: '    : PRUNED_PLACEHOLDER + "\\n[原文已存附件 " + rel + "，需要时 read_file 取回]";',
    to: '    : PRUNED_PLACEHOLDER;',
  },
  {
    id: "shell-tail-assembly-drops-tail",
    src: "src/tools/output-ring.ts",
    test: "tests/shell-tail.test.ts",
    title: "超上限时头部与**结尾**都在",
    from: '    ? head + "\\n" + middleTruncationNotice(seen - bytesOf(head) - bytesOf(tail)) + "\\n" + MIDDLE_TRUNCATION_HINT + "\\n" + tail',
    to: '    ? head + "\\n" + middleTruncationNotice(seen - bytesOf(head) - bytesOf(tail)) + "\\n" + MIDDLE_TRUNCATION_HINT',
  },
  {
    id: "shell-tail-notice-reserve-removed",
    src: "src/tools/output-ring.ts",
    test: "tests/output-ring.test.ts",
    title: "总输出含提示行也不超上限",
    from: "const NOTICE_RESERVE_BYTES = 512;",
    to: "const NOTICE_RESERVE_BYTES = 0;",
  },
  {
    // 9620e91 把「全文见」那句改成做得到的动作 ⇒ 原针脚 `"\n[全文见 " + entry.path + "]"),` 整段换成了一次调用。
    id: "skill-primary-hint-lost",
    src: "src/agent/plugins/index.ts",
    test: "tests/skill-body-cap.test.ts",
    title: "200KB 正文收到单 skill 预算内，头部留住并给出全文路径",
    from: "        skillRecallSuffix(entry.path, this.opts.workspace)),",
    to: "        \"\"),",
  },
  {
    // 这条锚点**两处**都漂了：apply 字面量（同上）+ expectFail 用例标题（#47 我改的题面）。
    id: "user-skill-face-budget-abolished",
    src: "src/agent/plugins/skills.ts",
    test: "tests/skill-user-invocation.test.ts",
    title: "超预算的正文按模型侧同一顶帽裁掉；取回那句按落位给，没登记工作区就不递地址（#47）",
    from: '    text: clampSkillBody(\n      renderPromptCommand(hit, args, ctxFor?.(hit) ?? {}),\n      SKILL_REMOUNT_TOKENS_PER_SKILL,\n      skillRecallSuffix(hit.path, workspace)),',
    to: "    text: renderPromptCommand(hit, args, ctxFor?.(hit) ?? {}),",
  },
  {
    // dfcc4bc 给 `notInGraphNote` 加了第 4 个实参（帽）⇒ 原三参字面量整行不再逐字相等。
    id: "impact-query-deps-ghost-file-silent",
    src: "src/tools/impact-query.ts",
    test: "tests/impact-query.test.ts",
    title: "deps 模式下不在图内的文件仍然 fail-visible（与 up 同一套分诊文案）",
    from: "          if (!graph.files.includes(rel)) return { ok: false, output: await notInGraphNote(ctx.workspace, rel, abs, maxFiles) };\n",
    to: "",
  },
];

const wanted = process.argv[2] ?? "";
const c = CASES.find((x) => x.id === wanted);
if (c === undefined) {
  console.log("可用 id：" + CASES.map((x) => "  " + x.id + "  →  " + x.test + " 「" + x.title + "」").join("\n"));
  process.exit(2);
}
const abs = resolve(ROOT, c.src);
const original = readFileSync(abs, "utf8");
if (!original.includes(c.from)) {
  console.error("拒绝运行：盘上找不到那段字面量（说明源码又动了，先重取事实源）");
  process.exit(2);
}
if (!original.includes(c.to) && c.to.includes(c.from)) {
  console.error("拒绝运行：突变串与原串同形（no-op 突变＝假存活，规则 172）");
  process.exit(2);
}
try {
  writeFileSync(abs, original.replace(c.from, c.to), "utf8");
  const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts", c.test],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  // 汇总行带 ANSI 色码时 `Tests  N failed` 匹配不到 ⇒ 关掉颜色再去解析。
  // 第一版就栽在这里：读不出汇总数、却仍然打了一行"读数不可信"——那行提示才是对的（规则 128 第三形态）。
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  // 读数口径要说得出（规则 128：非零退出 + "全绿" 这种自相矛盾的读数比没读数更坏）：
  //   红几格 = vitest 汇总行里的 `N failed`；红在哪一格 = FAIL 行的用例名；两者都要与退出码对得上。
  const failedN = Number(/Tests\s+(\d+) failed/.exec(out)?.[1] ?? "NaN");
  const failLines = out.split("\n").filter((l) => l.includes("FAIL"));
  const killed = failLines.some((l) => l.includes(c.title));
  console.log(`[${c.id}]`);
  console.log("  门跑：红 " + String(Number.isFinite(failedN) ? failedN : "?") + " 格（vitest exit=" + String(r.status) +
    "，FAIL 行 " + String(failLines.length) + " 条）");
  if (!Number.isFinite(failedN) || (failedN === 0) !== (r.status === 0)) {
    console.log("  **读数不可信**：汇总行与退出码不一致 ⇒ 这一轮的结论不算数，先看输出（可能收集期就崩了）");
  }
  console.log("  " + (killed
    ? "红在期望那一格「" + c.title + "」上 ⇒ 观测者还在，#50 只需把 apply 字面量改指新写法"
    : (failedN > 0
      ? "红了但不是期望那一格（可能误伤无关用例）：" + (failLines[0] ?? "").slice(0, 150)
      : "**没红 ⇒ 这一格真的没人守了**，得补判卷")));
  if (!killed) for (const l of failLines.slice(0, 4)) console.log("      " + l.slice(0, 150));
} finally {
  writeFileSync(abs, original, "utf8");
  const back = readFileSync(abs, "utf8");
  console.log("  还原：" + (back === original ? "逐字一致 ✅" : "**不一致——立刻人工检查** ❌"));
}
