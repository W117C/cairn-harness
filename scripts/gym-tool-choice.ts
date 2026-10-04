// P0-c / P1-b：工具选择靶场的**读数**跑法（P0 已把纯函数尺子造好，见 src/agent/gym/tool-choice.ts）。
//
// 为什么单独一个脚本而不是给 `gym-run.ts` 加 flag：
//  ① **冻结**。`fixtures/gym/cases/**` 与 `fixtures/gym/index.json` 全在 `scripts/frozen-sha256.json`
//     里，改判据＝作弊。工具选择 case 必须**声明 expectTools/forbidTools**，而既有四条 case 全都没声明
//     （它们是 2026-09 的产物，那时没这个字段）⇒ 想让选对率有数，只能另起一个 case 根目录，
//     绝不回头改那四条。`fixtures/gym/tool-choice/` 就是这个另起的根（**不在** index.json 里）。
//  ② `gym-run` 的入口是 index.json 的 case 集，工具选择 case 刻意不进那个集合（进＝要改冻结文件）。
//
// 用法：
//   node --import tsx scripts/gym-tool-choice.ts --case timeout-config --arm full
//   node --import tsx scripts/gym-tool-choice.ts --case timeout-config --arm pruned
//   node --import tsx scripts/gym-tool-choice.ts --case timeout-config --ab      # 两臂各跑一次并出差值
//
// 两个 arm 的**唯一差别是工具面**：full = 生产缺省面；pruned = `omitTools` 摘掉「与本 case 无关」的几族。
// 除此之外逐字同参（同 model、同 system、同 task）——否则差值里混着别的变量，就不可归因了。
//
// 口径提醒（本脚本自己也遵守）：
//  · `scripted` 档的选择是剧本写死的，量出来是「剧本有没有照剧本调」——**构造上同义反复**，不出读数。
//    本脚本缺省 real；无 `CAIRN_API_KEY` 时**显式跳过并退出 0**，不拿缺读数当「没发现问题」。
//  · case 没声明 expectTools ⇒ 选对率是 `null`（分母 0），不是 0 也不是 1。
//  · 免得把「没跑」读成「跑过了没问题」：本脚本**不写任何账本文件**，读数只在终端/JSON。
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadCase } from "../src/agent/gym/case";
import { runCase, cleanupRun } from "../src/agent/gym/runner";
import { caseToolChoice, mergeToolChoice, toolChoiceAblation, type CaseToolChoice } from "../src/agent/gym/tool-choice";
import { replay } from "../src/events";
import { BASE_SYSTEM } from "../src/agent/system-prompt";
import { OPTIONAL_TOOL_NAMES } from "../src/agent/glm-session";

const ROOT = process.cwd();
const CASES_ROOT = join(ROOT, "fixtures", "gym", "tool-choice");

/** `pruned` 臂摘掉的那几族：**每一族都与本 case 无关**（不读代码、不派 worker、不排定时、不记记忆），
 *  所以「摘掉它只该省 token、不该改正确性」是可判的，而不是我凭感觉说「应该没关系」。 */
const PRUNED_GROUPS: readonly (readonly string[])[] = [
  OPTIONAL_TOOL_NAMES.subagentTools,
  OPTIONAL_TOOL_NAMES.goalTools,
  OPTIONAL_TOOL_NAMES.memoryTools,
  OPTIONAL_TOOL_NAMES.lspTools,
];

const argv = process.argv.slice(2);
const opt = (n: string): string | undefined => {
  const i = argv.indexOf("--" + n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (n: string): boolean => argv.includes("--" + n);
// ⚠️ 2026-10-04 修：这张白名单**漏了 "ab"**，而下面第 64 行确实用 `has("--ab")` 读它。
// 后果不是「A/B 读不出来」，是 `--ab` 被当成拼错的 flag ⇒ **exit 2、一行读数都不产出**。
// 也就是说这条 A/B 路从写下来起就没被自己的 CLI 跑通过一次。
//
// 为什么这个 bug 能活到现在：它**不响**。拼错 flag 有 exit 2 + 一行中文报错，
// 所以「跑失败」这件事是可见的；真正让它活下来的是——A/B 那批读数**另有来源**
// （手动一条条跑单臂），从没有人把 `--ab` 的失败和那批数对上。
// 这正是「不把代理量当读数」的同款：一个没跑过的开关，看上去和有读数的开关长得一样。
const FLAGS = ["case", "arm", "ab", "model", "events"] as const;
const unknown = argv.filter((a, i) => a.startsWith("--") && !(FLAGS as readonly string[]).includes(a.slice(2)));
if (unknown.length > 0) {
  console.error("[gym-tool-choice] 未知参数：" + unknown.join(" ") + "（不把拼错的 flag 静默当成缺省）");
  process.exit(2);
}

const caseIdRaw = opt("case");
if (!caseIdRaw) {
  console.error("用法：--case <id> [--arm full|pruned] [--ab] [--model real|probe]");
  process.exit(2);
}
/** 显式标注成 `string`：跨函数用时 TS 不会把外层的窄化带进来（`process.exit` 返回 never 只在同层生效），
 *  而这里必须是不带 undefined 的——把 `path` 写成 `string | undefined` 会让 loadCase 的拼接口悄悄退化。 */
const caseId: string = caseIdRaw;
const doAb = has("ab");
const armArg = opt("arm") ?? (doAb ? "full" : "full");
if (!doAb && armArg !== "full" && armArg !== "pruned") {
  console.error("--arm 只认 full|pruned（收到：" + armArg + "）");
  process.exit(2);
}
const modelKind = (opt("model") ?? "real") as "real" | "probe";

if (modelKind === "real" && !process.env.CAIRN_API_KEY) {
  console.log("[gym-tool-choice] 暗卷缺席（无 CAIRN_API_KEY）——显式跳过，不出读数（未证 ≠ 通过）");
  process.exit(0);
}

async function runArm(arm: "full" | "pruned"): Promise<{ row: CaseToolChoice; score: number; turns: number; tokens: number }> {
  const c = await loadCase(CASES_ROOT, { id: caseId, path: caseId });
  // 只换工具面这一个变量：omitTools 走 `RunCaseOptions`（gym/runner.ts 已接），
  // 其余（model / system / task / verify）两臂逐字同参。
  const omitTools = arm === "pruned" ? PRUNED_GROUPS.flat() : undefined;
  const res = await runCase(c, {
    model: modelKind,
    system: BASE_SYSTEM,
    ...(omitTools ? { omitTools } : {}),
  });
  const events = await replay(res.eventsPath);
  const row = caseToolChoice(c.id, events, c.expect);
  const keep = opt("events");
  if (keep) {
    await (await import("node:fs/promises")).writeFile(join(resolve(keep), arm + "-" + caseId + ".jsonl"),
      (await readFile(res.eventsPath, "utf8")), "utf8");
  }
  await cleanupRun(res);
  return { row, score: res.score, turns: res.turns, tokens: res.inputTokens + res.outputTokens };
}

try {
  if (!doAb) {
    const r = await runArm(armArg as "full" | "pruned");
    const m = mergeToolChoice([r.row]);
    console.log("== 工具选择读数（单臂 " + armArg + "｜case " + caseId + "）==");
    console.log("  正确性 score=" + String(r.score) + "｜轮数 " + String(r.turns) + "｜tokens " + String(r.tokens));
    console.log("  实际调用的工具：" + (r.row.toolsCalled.join("、") || "（无）"));
    console.log("  期望工具（expectTools）：" + (r.row.expectDeclared ? r.row.hits.join("、") || "**没命中**" : "（本 case 未声明 ⇒ 不计）"));
    console.log("  漏拦（forbidTools）：" + (r.row.forbidDeclared ? (r.row.violations.join("、") || "无") : "（本 case 未声明 ⇒ 不计）"));
    console.log("  选对率 = " + (m.hitRate === null ? "null（分母 0，未证）" : String(m.hitRate))
      + "　（命中/声明该调的 case 数）");
    console.log("  漏拦率 = " + (m.violationRate === null ? "null（分母 0，未证）" : String(m.violationRate))
      + "　（**case 级**：这次跑违没违规）");
    console.log("  调用级 = " + (m.callLevelViolationRate === null ? "null（分母 0，未证）" : String(m.callLevelViolationRate))
      + "　（被禁工具件数/总调用数——**这一格会随轮数变，别当成违规率读**）");
  } else {
    console.log("== A/B：同一 case、同一模型，只换工具面 ==");
    console.log("  跑 full 臂…");
    const a = await runArm("full");
    console.log("  跑 pruned 臂…");
    const b = await runArm("pruned");
    const ab = toolChoiceAblation([a.row], [b.row]);
    console.log("");
    console.log("  臂            score  轮数  tokens  选对        漏拦        实际工具");
    for (const [name, r] of [["full", a], ["pruned", b]] as const) {
      const m = mergeToolChoice([r.row]);
      console.log("  " + name.padEnd(13) + String(r.score).padStart(4) + String(r.turns).padStart(6)
        + String(r.tokens).padStart(8)
        + "  " + (m.hitRate === null ? "null" : String(m.hitRate)).padEnd(11)
        + "  " + (m.violationRate === null ? "null" : String(m.violationRate)).padEnd(11)
        + "  " + r.row.toolsCalled.join("、"));
    }
    console.log("");
    if (!ab.ok) { console.error("  A/B 不可归因：" + ab.why); process.exit(1); }
    console.log("  选对率差 = " + (ab.hitRateDelta === null ? "null（有一侧分母 0）" : String(ab.hitRateDelta)));
    console.log("  漏拦率差 = " + (ab.violationRateDelta === null ? "null（有一侧分母 0）" : String(ab.violationRateDelta)));
    const dTok = b.tokens - a.tokens;
    console.log("  token 差 = " + String(dTok) + "（pruned − full；负数＝pruned 更省）");
    console.log("");
    console.log("  ⚠️ n=1/臂 时的读法限制（别读过头）：");
    console.log("    · 正确率在实测里会 0↔1 跳（同模型同 case 同臂），所以 score 差不携带信息；");
    console.log("    · 选对率在多数 case 上饱和为 1（模型清一色 edit_file），也不携带信息；");
    console.log("    · **只有 token 差与轮数差是连续量**，「更便宜」这类结论只能建立在它们上面；");
    console.log("    · 要谈正确性，得先让基准稳定（同 case 重复跑多次看方差），再把 n 提上去。");
  }
} catch (e) {
  console.error("[gym-tool-choice] 跑失败：" + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}