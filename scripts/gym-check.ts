// M5a 靶场验收脚本（pnpm gym-check，第 24 道门；仿 agents-check 体例）。
// 段：
//   A 靶场骨架（步骤 2）：A1 清单加载三件套 / A2 反例控制（negative 必须判失败——尺子有刻度）/
//     A3 冻结 sha256 逐字一致（fixtures/gym/cases/** + index.json）
//   B 回放跑器（步骤 3 追加）：B1 明卷确定性 / B2 分叉重放 / B3 暗卷缺席显式跳过
// 纪律：断言可复跑、逐条配反向验证（§m5-proposal 6.3）；临时目录 mkdtemp 后必须 realpath。
import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { copyRepoAndApply, gymTempDir, loadCase, loadGymIndex } from "../src/agent/gym/case";
import { changedFilesBetween, scoreCase } from "../src/agent/gym/score";
import { cleanupRun, runCase } from "../src/agent/gym/runner";
import { forkSession, replay } from "../src/events";
import { runVerifyOutcome } from "../src/agent/verify";

let pass = 0;
let fail = 0;
function check(cond: boolean, name: string, detail?: string): void {
  if (cond) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name + (detail ? "（" + detail + "）" : ""));
  }
}

const ROOT = process.cwd();
const GYM = join(ROOT, "fixtures", "gym");

// ============================== A 靶场骨架（步骤 2） ==============================
console.log("[gym-check] A 靶场骨架（清单 / 反例控制 / 冻结）");

// A1 清单加载：三件套齐备，缺一 fail-visible
const index = await loadGymIndex(GYM);
check(index.cases.length >= 3, "A1a case 清单 ≥ 3 个", "n=" + String(index.cases.length));
const loaded: Array<Awaited<ReturnType<typeof loadCase>>> = [];
for (const entry of index.cases) {
  const c = await loadCase(GYM, entry); // 三件套读取失败在此直接 throw（fail-loud）
  loaded.push(c);
  check(c.task.trim().length > 0, `A1b ${c.id}: task.md 非空`);
  check(c.negative.changes.length >= 1, `A1c ${c.id}: negative.json 含 ≥1 个变更`);
  check(c.expect.mustChangeFiles.length >= 1, `A1d ${c.id}: expect.mustChangeFiles 非空`);
}

// A2 反例控制：套用 negative 后必须判失败（唯一证明"尺子本身有刻度"，缺了它就是恒真判据）
for (const c of loaded) {
  const dir = await gymTempDir("gym-neg-");
  try {
    await copyRepoAndApply(c.repoDir, dir, c.negative.changes);
    const outcome = await runVerifyOutcome(dir);
    const changed = await changedFilesBetween(c.repoDir, dir);
    const score = scoreCase(c.expect, { verifyOk: outcome.ok, changedFiles: changed });
    check(score === 0, `A2 ${c.id}: negative 必须判失败（verify ok=${String(outcome.ok)} score=${String(score)}）`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// A3 冻结 sha256 逐字一致：判卷面全部文件必须命中冻结表且哈希一致（改 case = 作弊）
{
  const gymFiles: string[] = ["fixtures/gym/index.json"];
  const walk = async (rel: string): Promise<void> => {
    const abs = join(ROOT, rel);
    const entries = await readdir(abs, { withFileTypes: true });
    for (const ent of entries) {
      const childRel = rel + "/" + ent.name;
      if (ent.isDirectory()) await walk(childRel);
      else gymFiles.push(childRel);
    }
  };
  await walk("fixtures/gym/cases");
  const frozen = JSON.parse(await readFile(join(ROOT, "scripts", "frozen-sha256.json"), "utf8")) as Record<string, string>;
  let frozenMiss = 0;
  for (const rel of gymFiles) {
    const actual = createHash("sha256").update(await readFile(join(ROOT, rel))).digest("hex");
    if (frozen[rel] !== actual) {
      frozenMiss++;
      console.log("  ❌ A3 冻结漂移: " + rel);
    }
  }
  check(frozenMiss === 0, "A3 gym 判卷面（" + String(gymFiles.length) + " 文件）sha256 与冻结表逐字一致");
}

// ============================== B 回放跑器（步骤 3） ==============================
console.log("[gym-check] B 回放跑器（明卷确定性 / 分叉重放 / 暗卷缺席）");

// B1 明卷确定性：同一 case 跑两次，score / usage / turns / changedFiles 逐字段一致
const turnCounts: number[] = [];
for (const c of loaded) {
  const r1 = await runCase(c, { model: "scripted" });
  const r2 = await runCase(c, { model: "scripted" });
  try {
    turnCounts.push(r1.turns);
    // 六个字段各自比，并把**不等的那几个连同两边的值**打出来。旧写法只打一个布尔
    // ⇒「明卷两次跑逐字段一致」报红时读不出是哪一维不稳（score？usage？changedFiles？），
    // 而这三种红的归因面完全不同（判卷器 / 用量折算 / 落盘集合）。
    const fields: [string, (r: typeof r1) => unknown][] = [
      ["score", (r) => r.score],
      ["verifyOk", (r) => r.verifyOk],
      ["inputTokens", (r) => r.inputTokens],
      ["outputTokens", (r) => r.outputTokens],
      ["turns", (r) => r.turns],
      ["changedFiles", (r) => JSON.stringify(r.changedFiles)],
    ];
    const diffs = fields
      .map(([name, get]) => [name, String(get(r1)), String(get(r2))] as const)
      .filter(([, a, b]) => a !== b);
    const same = diffs.length === 0;
    // 审查 S3-6（任务 3.6）：上面只比「两次跑是否一致」，不断言「跑对」。判卷面整体静默失灵时
    // （靶子路径挪了 / npm 跑不起来 => verify 恒 false），三次 score 全 0 也照样逐字段一致地绿，
    // 而 A 组反向用例（期望失败）同样不会红 = 整套尺子读不出正确解却报通过。明卷是照着解写的
    // scripted 剧本，必须真通过（实测三条 case score=1）。
    check(
      r1.verifyOk === true && r1.score === 1,
      `B1b ${c.id}: 明卷正向通过（verifyOk && score=1，防判卷器静默失灵）`,
    );
    check(
      same,
      `B1 ${c.id}: 明卷两次跑逐字段一致（score=${String(r1.score)} in=${String(r1.inputTokens)} out=${String(r1.outputTokens)} turns=${String(r1.turns)}）` +
        (same ? "" : " —— 不等：" + diffs.map(([n, a, b]) => `${n}: ${a} ≠ ${b}`).join("；")),
    );
    // B1c：expect.maxTurns 此前**零消费者**（只在 loadCase 里校验类型）——一条写着却没人 enforce
    // 的预算就是假刻度。现在它真的会被强制。（四 case 的冻结数据都显式给了该字段，故这里
    // 用合取而不是 `undefined ||` 的析取：缺字段就当红，逼后来人显式表态，而不是静默放过。）
    const budget = c.expect.maxTurns;
    check(
      typeof budget === "number" && r1.turns <= budget,
      `B1c ${c.id}: 轮数在 expect.maxTurns 预算内（turns=${String(r1.turns)}，预算=${String(budget)}）`,
    );
  } finally {
    await cleanupRun(r1);
    await cleanupRun(r2);
  }
}

// B1d 长时程覆盖：靶场必须至少有一条 ≥8 轮的 case。逐轮机制（缓存命中、压缩触发、跨轮保持
// 目标、逐轮证据）在 3 轮的题上根本没有样本——切轮之后这条才判得动。
const longest = turnCounts.length > 0 ? Math.max(...turnCounts) : 0;
check(longest >= 8, `B1d 靶场含长时程 case（最长 ${String(longest)} 轮，门槛 ≥8）`);

// B2 分叉重放：从 eventId=N 分叉后，新会话前 N 条事件与原会话逐字节一致，且原文件未被修改
{
  const c = loaded[0];
  const r = await runCase(c, { model: "scripted" });
  try {
    const events = await replay(r.eventsPath);
    const writeIdx = events.findIndex((e) => e.type === "tool_call" && e.name === "write_file");
    const eventId = String(writeIdx >= 0 ? writeIdx + 1 : 3);
    const origRaw = await readFile(r.eventsPath, "utf8");
    const shaBefore = createHash("sha256").update(origRaw).digest("hex");
    const fork = await forkSession(r.eventsPath, eventId, join(r.sessionDir, "b2-fork"));
    const forkRaw = await readFile(fork.eventsPath, "utf8");
    const origLines = origRaw.split("\n").filter((l) => l.trim().length > 0);
    const forkLines = forkRaw.split("\n").filter((l) => l.trim().length > 0);
    const n = Number(eventId);
    check(
      JSON.stringify(forkLines.slice(0, n)) === JSON.stringify(origLines.slice(0, n)),
      `B2a ${c.id}: 分叉@${eventId} 前 ${String(n)} 条事件与原会话逐字节一致`,
    );
    const shaAfter = createHash("sha256").update(await readFile(r.eventsPath, "utf8")).digest("hex");
    check(shaBefore === shaAfter, "B2b 原会话文件未被修改（sha256 不变）");
  } finally {
    await cleanupRun(r);
  }
}

// B3 暗卷缺席：无 M0_API_KEY 显式打印跳过并计数，不计入 pass（未证 ≠ 通过）
console.log("[gym-check] B3 暗卷（真实 GLM，有 M0_API_KEY 才跑）");
if (!process.env.M0_API_KEY) {
  console.log("  暗卷跳过（无 M0_API_KEY）——缺席显式打印，不计入 pass");
  console.log("UNVERIFIED=1"); // 跳过 ≠ 通过，上浮到门禁汇总
} else {
  const c = loaded[0];
  const r = await runCase(c, { model: "real" });
  try {
    check(typeof r.verifyOk === "boolean", "B3 暗卷 case 跑通（score=" + String(r.score) + "）");
  } finally {
    await cleanupRun(r);
  }
}

console.log("[gym-check] " + (fail === 0 ? "全部断言通过 ✅" : String(fail) + " 项失败 ❌") + "（" + String(pass) + " ✅ / " + String(fail) + " ❌）");
process.exit(fail === 0 ? 0 : 1);
