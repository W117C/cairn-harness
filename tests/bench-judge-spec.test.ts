/* 逐名判卷规格（`TaskSpec.judge`）这一格**在本仓自己的基准上真的通电**（2026-10-22 登记的那笔债）。
 *
 * 病灶（现读可复现）：`scripts/lib/eval-named-sets.ts`（读者）、`src/agent/eval/test-results.ts`
 * （解析＋裁决）、`src/agent/eval/task-set.ts`（数据层产出 judge）三截都通了，可 `fixtures/bench/`
 * 五份清单 **12/12 条一条 `judge` 都没有** ⇒ `--feasibility` 印的是 `逐名格：0 / 12`。
 * 也就是说「该转绿的没绿」与「该保住的坏了」在这批基准上**仍旧同形于同一枚退出码**——
 * 机制在、生产零流量，本仓最忌的那个形状。
 *
 * 本簇量的三件事（每件都配反向证人，不写「A＝B」型恒真断言）：
 *  ⑴ 五份清单**每一条**都带 judge，且两列非空、不重叠、无重复（形状由 `namedSetProblems` 判）；
 *  ⑵ 两列的**内容**与盘上现读的靶子种子态逐字一致（取料走 `scripts/lib/bench-judge-spec.ts`，
 *     判据与生成器同一个来源 ⇒ 判据自己不许是第二把尺）；
 *  ⑶ 逐名那一格在跑器里**真的被读**：拿 B1 的种子态原文喂 `readNamedSets`，同一枚退出码下
 *     两种逐名结局必须给出不同的 `notGreen`／`broken`——这正是这一格买来的分辨力。
 *
 * 为什么连 `renderManifest` 一起量：它是**纯文本手术**（只换 judge 那一格，其余字节不动），
 * 而文本手术最容易在「下标空间」上翻车——本轮实测连翻三次（`,` 飞到右花括号后面、
 * 右花括号被吃掉、第二处 edit 拿第一处改完后的下标当原文下标）。所以它要一个坏输入 witnesses：
 * 把 judge 换坏、或把别的字段动一个字节，都必须有判据红。
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { judgeSpecFromSeed, type JudgeSeedTask } from "../scripts/lib/bench-judge-spec";
import { namedSetProblems, parseTestResults } from "../src/agent/eval/test-results";
import { parseTaskSetJson } from "../src/agent/eval/task-set";
import { readNamedSets, namedSetFailReason, type NamedSetCommandResult } from "../scripts/lib/eval-named-sets";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** 五份清单（`tests/bench-corpus-parity.test.ts` 的 `manifestFilesFromListing` 同一条口径：
 *  新增一份 `tasks*.json` 自动进本簇，不必改这里）。 */
const MANIFESTS: readonly string[] = readdirSync(join(ROOT, "fixtures/bench"))
  .filter((e) => /^tasks.*\.json$/u.test(e))
  .sort();

interface ManifestTask {
  id: string;
  seed: { kind: string; path: string };
  verifier?: { command: string };
  judge?: { failToPass: string[]; passToPass: string[] };
}

const manifestOf = (rel: string): ManifestTask[] =>
  JSON.parse(readFileSync(join(ROOT, "fixtures/bench", rel), "utf8")) as ManifestTask[];

const seedTaskOf = (t: ManifestTask): JudgeSeedTask | null =>
  t.verifier?.command === undefined || t.verifier.command === ""
    ? null
    : { id: t.id, dir: t.seed.path, command: t.verifier.command };

/* ── ⑴ 五份清单每一条都带 judge，形状合法 ─────────────────────────────────────────────── */

describe("五份 bench 清单每条都带 judge 逐名规格", () => {
  it("清单本身存在（一份都没有 ⇒ 这一格连分母都没有，不是「0 条通过」）", () => {
    expect(MANIFESTS.length, "fixtures/bench/ 下没有 tasks*.json").toBeGreaterThanOrEqual(5);
  });

  it.each(MANIFESTS)("%s：每条任务都有 judge，且两列形状合法", (rel) => {
    const tasks = manifestOf(rel);
    expect(tasks.length, rel + " 是空清单").toBeGreaterThan(0);
    for (const t of tasks) {
      expect(t.judge, `${rel} ${t.id} 没有 judge ⇒ 逐名那一格在这条任务上无面（同一枚退出码继续同形）`).toBeDefined();
      const problems = namedSetProblems(t.judge);
      expect(problems, `${rel} ${t.id} 的 judge 形状不成立：${problems.join("；")}`).toEqual([]);
      // 空 passToPass 是合法的（整颗靶子天生全红，如 B3／B12／L30）——不许为凑形状往里添名字。
      expect(t.judge!.passToPass.length).toBeGreaterThanOrEqual(0);
      expect(t.judge!.failToPass.length).toBeGreaterThan(0);
    }
  });

  it("清单原文能被生产的数据层整份吃下（判据与跑器同一个解析器，不是第二把尺）", () => {
    for (const rel of MANIFESTS) {
      const r = parseTaskSetJson(readFileSync(join(ROOT, "fixtures/bench", rel), "utf8"));
      expect(r.errors, `${rel} 解析有错：${r.errors.join("；")}`).toEqual([]);
      expect(r.tasks.length).toBe(manifestOf(rel).length);
      for (const t of r.tasks) expect(t.judge, `${rel} ${t.id} 进了分母却没有 judge`).toBeDefined();
    }
  });
});

/* ── ⑵ 两列内容 ↔ 盘上现读的种子态逐字一致 ──────────────────────────────────────────── */

describe("judge 两列与盘上现读的种子态逐字一致", () => {
  /* 逐条跑靶子判卷命令（零 key、零网络、每条 <2s；16 条合计约 20s）。
   * 判据与生成器共用 `judgeSpecFromSeed` —— 判据自己不许是第二把尺（同族纪律：
   * 「读不到」≠「没问题」，反过来「尺与实现同源」也不等于尺没用：这里钉的是
   * **清单里那两个数组与现读结果逐字相等**，换任何一列都会红）。 */
  it.each(MANIFESTS.flatMap((rel) => manifestOf(rel).map((t) => ({ rel, t }))))(
    "$rel $t.id：failToPass＝种子态非绿、passToPass＝种子态绿",
    ({ rel, t }) => {
      const seed = seedTaskOf(t);
      expect(seed, `${rel} ${t.id} 没有 verifier.command ⇒ 这一格无尺`).not.toBeNull();
      const r = judgeSpecFromSeed(seed!, ROOT);
      expect(r.ok, `${rel} ${t.id} 取不到种子态：${r.ok ? "" : r.reasons.join("；")}`).toBe(true);
      if (!r.ok) return;
      expect(t.judge!.failToPass, `${rel} ${t.id} 的 failToPass 与现读不一致（靶子改了标题/加了测试？）`)
        .toEqual(r.spec.failToPass);
      expect(t.judge!.passToPass, `${rel} ${t.id} 的 passToPass 与现读不一致`).toEqual(r.spec.passToPass);
    },
    60_000,
  );

  /* 这条是**字面量标题**的观测者，专供变异锚点指认：两列判据反过来（把本来就绿的列进
   * failToPass）时，它必须红。为什么不能用上面那条 `it.each` 的判据当锚点观测者：
   * 两把尺比的面不同——`mutate-anchor-titles` 比判卷**源文本**（那里只有 `$rel $t.id` 模板），
   * 而 `killerAttributionOk` 比 vitest **输出里红掉的标题**（已是渲染后的具体串）。
   * 同一枚 expectFail 喂不进两张面，所以另配一个不插值的。 */
  it("两列判据反过来 ⇒ 恒真（该转绿的那一列里全是本来就绿的）", () => {
    const b1 = manifestOf("tasks.json").find((t) => t.id === "B1-bugfix-crossfile")!;
    const seed = judgeSpecFromSeed(seedTaskOf(b1)!, ROOT);
    expect(seed.ok, "取不到种子态 ⇒ 这一格没尺").toBe(true);
    if (!seed.ok) return;
    // 突变体把两列对调；这里手工复现对调后的形状，断言它**过不了**判据
    const inverted = { failToPass: [...seed.spec.passToPass], passToPass: [...seed.spec.failToPass] };
    const problems = namedSetProblems(inverted);
    expect(problems, "对调后形状居然合法 ⇒ 更需要下面那条逐字比对").toEqual([]);
    expect(inverted.failToPass, "对调后的 failToPass 与现读相同 ⇒ 这条判据是恒真的").not.toEqual(seed.spec.failToPass);
    expect(inverted.passToPass, "对调后的 passToPass 与现读相同 ⇒ 这条判据是恒真的").not.toEqual(seed.spec.passToPass);
    // 对调后 failToPass 里的每一条在种子里都是绿的 ⇒ 那一格恒真（不用改也「转绿成功」）
    const greenNames = seed.parsed.tests.filter((t) => t.outcome === "passed").map((t) => t.name);
    for (const name of inverted.failToPass) {
      expect(greenNames, `「${name}」在种子里不是绿的 ⇒ 对调没有制造恒真，这条判据选错了靶`).toContain(name);
    }
  });

  it("反向证人：把一条本来就绿的名字塞进 failToPass ⇒ 这一格恒真（它本来就绿，永远「转绿成功」）", () => {
    /* 这不是假设：`B1` 的 `无券：商品金额 + 运费` 在种子里就是绿的。把它写进 failToPass，
     * 模型什么都不做这一格也报 pass ⇒ 逐名尺子买了等于没买。判据必须能指出这种自造绿。 */
    const b1 = manifestOf("tasks.json").find((t) => t.id === "B1-bugfix-crossfile")!;
    const green = b1.judge!.passToPass[0]!;
    const fake = { failToPass: [green, ...b1.judge!.failToPass], passToPass: b1.judge!.passToPass.filter((x) => x !== green) };
    // 形状谓词看不出来（两列不重叠、非空）⇒ 它自己会放行；看得见的是「与现读不符」这一条。
    expect(namedSetProblems(fake), "这种自造绿在形状上居然不违法 ⇒ 更需要上面那条逐字比对").toEqual([]);
    const real = judgeSpecFromSeed(seedTaskOf(b1)!, ROOT);
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    expect(fake.failToPass, "自造绿与现读相同 ⇒ 上面那条逐字比对是恒真的").not.toEqual(real.spec.failToPass);
  });
});

/* ── ⑶ 逐名那一格在跑器里真的被读：同一枚退出码、两种逐名结局 ───────────────────────── */

describe("逐名裁决在 B1 的种子态上分得开「没修好」与「修坏了别的」", () => {
  /* 取料走生产解析器（不在这里认第二次格式）；spec 从盘上清单真读，不手抄。 */
  const b1 = manifestOf("tasks.json").find((t) => t.id === "B1-bugfix-crossfile")!;
  const spec = b1.judge!;

  /** 造一份 node --test 的 **spec** 原文（与真跑器同一种 reporter；解析交给生产解析器）。
   *  注意 `ℹ pass/fail` 两个汇总要按**逐名数**算——它们若与逐名不符，解析器自己会报
   *  「结尾计数与逐名读到的 N 不符」⇒ `complete:false` ⇒ 整份判成 unreadable，
   *  那是合成料自己造的红，不是被度量面的（本仓判据纪律：不许让尺自己抖）。 */
  const resultsOf = (outcome: (name: string) => "passed" | "failed"): NamedSetCommandResult[] => {
    const names = [...spec.failToPass, ...spec.passToPass];
    const pass = names.filter((n) => outcome(n) === "passed").length;
    return [{
      command: "node --test tests/*.test.js",
      output: [
        ...names.map((n, i) => `${outcome(n) === "passed" ? "✔" : "✖"} ${n} (0.${String(i)}ms)`),
        `ℹ tests ${String(names.length)}`,
        `ℹ pass ${String(pass)}`,
        `ℹ fail ${String(names.length - pass)}`,
      ].join("\n"),
    }];
  };

  it("全绿 ⇒ pass；FAIL_TO_PASS 里有一条没绿 ⇒ fail 且点名那一条（不是同一枚 1）", () => {
    const green = readNamedSets(resultsOf(() => "passed"), spec);
    expect(green!.state, "全绿却不过 ⇒ 这一格在拦无辜").toBe("pass");
    expect(namedSetFailReason(green)).toBeNull();

    const notGreen = readNamedSets(resultsOf((n) => (spec.passToPass.includes(n) ? "passed" : "failed")), spec);
    expect(notGreen!.state).toBe("fail");
    expect(notGreen!.notGreen).toEqual(spec.failToPass);
    expect(notGreen!.broken).toEqual([]);
    expect(namedSetFailReason(notGreen)).toContain("该转绿的没绿");
  });

  it("PASS_TO_PASS 里有一条坏了 ⇒ 同一枚退出码，但这一格说的是另一件事", () => {
    /* 两种结局的退出码都是 1（node --test 红）⇒ 旧读数同形；逐名这一格必须不同。 */
    const broken = readNamedSets(resultsOf((n) => (spec.failToPass.includes(n) ? "passed" : "failed")), spec);
    expect(broken!.state).toBe("fail");
    expect(broken!.broken).toEqual(spec.passToPass);
    expect(broken!.notGreen).toEqual([]);
    expect(namedSetFailReason(broken)).toContain("该保住的坏了");
  });

  it("反向证人：退出码那一格在这两种输入下同值（证明新增的是第二格，不是把旧格子换面）", () => {
    const exitCode = (r: NamedSetCommandResult[]): number => {
      const parsed = parseTestResults(r[0]!.output);
      return parsed.counts.failed > 0 ? 1 : 0;
    };
    const notGreen = resultsOf((n) => (spec.passToPass.includes(n) ? "passed" : "failed"));
    const broken = resultsOf((n) => (spec.failToPass.includes(n) ? "passed" : "failed"));
    expect(exitCode(notGreen), "退出码这一格本来分不出这两件事——它必须同值，否则上面两条等式是恒真的").toBe(1);
    expect(exitCode(broken)).toBe(1);
  });

  it("判据自己也要被审：spec 缺席 ⇒ 无面（undefined），不是「读不出」也不是「过了」", () => {
    expect(readNamedSets(resultsOf(() => "passed"), undefined), "没有规格却给了读数 ⇒ 把无面读成了有面").toBeUndefined();
    expect(namedSetFailReason(undefined), "无面不许拦（否则每条没有 judge 的任务都红）").toBeNull();
  });
});

/* ── ⑷ 取料器自己的 fail-closed 分支：没有尺 ≠ 全绿 ───────────────────────────────────
 *
 * 这一组是**专破它**的坏输入（判据纪律：加一条分支就要同笔造一个能走到它的输入，
 * 否则那条分支永远绿着——本轮实测：把「一条逐名都没读到 ⇒ 拒」整条改成 `if (false)`，
 * 盘上 16 条靶子**一条都走不到那个分支**（全都能解析）⇒ 29 条判据全绿，突变存活）。
 * 所以这里不 spawn，直接喂纯输入。 */
describe("judgeSpecFromSeed 的 fail-closed 分支", () => {
  /** 用一个「判卷命令产出噪音」的靶子走到「认不出格式」那一支。
   *  `dir` 指向仓根、命令是 `echo` ⇒ 不跑任何测试、零网络、零 key。 */
  const noise = (): JudgeSeedTask => ({ id: "X-noise", dir: ".", command: "echo 这不是测试报告" });

  it("认不出格式 ⇒ 拒出规格，且成因点名「没有尺」", () => {
    const r = judgeSpecFromSeed(noise(), ROOT);
    expect(r.ok, "认不出格式却给了规格 ⇒ 这一格把『没有尺』读成了『有尺』").toBe(false);
    if (r.ok) return;
    expect(r.reasons.join("；")).toContain("认不出格式");
    expect(r.reasons.join("；")).toContain("不出规格");
  });

  it("三个 fail-closed 分支各有一个**只走它自己**的坏输入（否则改坏任一条，另一条会替它红 ⇒ 突变存活）", () => {
    /* 这一条是判据的判据：三条拒出理由若总是同时出现，把它们逐条改成 `if (false)`
     * 时剩下的那条照样红 ⇒ 分不出是哪一条在守。三种输入必须**分别**只触发一条：
     *   ① `认不出格式` —— 输出是噪音（格式 unknown，逐名 0 条，也「不完整」）；
     *   ② `一条逐名都没读到` —— TAP 头＋`1..0` 计划线（格式认得出来、派生完整、就是没料）；
     *   ③ `派生不完整` —— TAP 计划 3 条只印 1 条（格式认得出来、有料、但计划线对不上）。
     * 实测（2026-10-22）：只有 ① 时，把 ② 和 ③ 改成 `if (false)` 都照样全绿 —— ① 一条喂饱了三条。 */
    const run = (cmd: string): string => {
      const r = judgeSpecFromSeed({ id: "X", dir: ".", command: cmd }, ROOT);
      return r.ok ? "" : r.reasons.join("；");
    };
    const noiseR = run("echo 这不是测试报告");
    const emptyR = run("node -e \"process.stdout.write('TAP version 13\\n1..0\\n')\"");
    const halfR = run("node -e \"process.stdout.write('TAP version 13\\n1..3\\nok 1 - 甲\\n# tests 1\\n# pass 1\\n')\"");

    // ① 三条理由齐着来（它是「什么都没有」的那种输入）
    //    「认不出格式」这一支单钉：它是三支里唯一**消息文本独有**的（另两支的话在
    //    「半份料」「空计划线」的成因里也会出现）⇒ 若把它改成恒假，只有这一条断言红。
    expect(noiseR, "『认不出格式』那一支没了 ⇒ 没有尺会被读成有尺").toContain("这一格没有尺，不出规格");
    expect(noiseR).toContain("认不出格式");
    expect(noiseR).toContain("一条逐名都没读到");
    expect(noiseR).toContain("不完整");
    // ② 只有「没读到」这一条：格式认得出来（node-test-tap）、派生完整（计划 0＝读到 0）
    expect(emptyR, "空计划线本该只触发『没读到』").toContain("一条逐名都没读到");
    expect(emptyR, "空计划线却报了别的理由 ⇒ 三支没有分开（改坏任一支都会被另一支替红）").not.toContain("认不出格式");
    expect(emptyR).not.toContain("不完整");
    // ③ 只有「不完整」这一条：有料（1 条），但计划线说 3 条
    expect(halfR, "半份料本该只触发『不完整』").toContain("不完整");
    expect(halfR, "半份料却报了别的理由 ⇒ 三支没有分开").not.toContain("认不出格式");
    expect(halfR).not.toContain("一条逐名都没读到");
  });

  it("拒出规格时**不交**一份空两列（空尺会被读成「全绿」）", () => {
    const r = judgeSpecFromSeed(noise(), ROOT);
    if (r.ok) throw new Error("这一支本该被拒");
    // 关键是这里没有 spec：调用方若拿到 {failToPass:[],passToPass:[]}，下游会当成
    // 「两列都空 ⇒ 这一格无面」或更糟的「没有该转绿的 ⇒ 恒过」。
    expect("spec" in r).toBe(false);
  });

  it("一条逐名都没读到 ⇒ 拒（哪怕格式认得出来：计划线是 0 也算没料）", () => {
    /* 造一份「格式认得出、逐名 0 条」的原文：只有 TAP 头与计划线，没有任何结果行。
     * 走 `dir:"."` + 一条会印出这段的 node -e 命令，仍然零 key 零网络。 */
    const r = judgeSpecFromSeed(
      { id: "X-empty", dir: ".", command: "node -e \"process.stdout.write('TAP version 13\\n1..0\\n')\"" },
      ROOT,
    );
    expect(r.ok, "零条逐名却给了规格 ⇒ 空尺").toBe(false);
    if (r.ok) return;
    expect(r.reasons.join("；")).toContain("一条逐名都没读到");
  });

  it("派生不完整 ⇒ 也拒（半份料分列 = 把读不到的那些按缺席算成该保住）", () => {
    /* 计划线说 3 条、只印 1 条结果行 ⇒ 解析器自己报「计划 3 条、逐名只读到 1 条」。
     * 这一支守的是：拿半份料去分列，PASS_TO_PASS 会缺人而没人喊。 */
    const r = judgeSpecFromSeed(
      { id: "X-half", dir: ".", command: "node -e \"process.stdout.write('TAP version 13\\n1..3\\nok 1 - 甲\\n# tests 1\\n# pass 1\\n')\"" },
      ROOT,
    );
    expect(r.ok, "派生不完整却出了规格 ⇒ 半份尺").toBe(false);
    if (r.ok) return;
    expect(r.reasons.join("；")).toContain("不完整");
  });

  it("种子态全绿 ⇒ 拒（failToPass 会是空列 ⇒ 这一格退化成只查不许坏，恒真）", () => {
    /* 一条全绿的 TAP：认得出来、也完整，但 failToPass 会是空。
     * 空 failToPass 的形状谓词会放行（`namedSetProblems` 只说「退化成只查不许坏」）⇒
     * 必须在取料器这一侧就拒，否则它会带着一份恒真的判卷进分母。 */
    const r = judgeSpecFromSeed(
      { id: "X-allgreen", dir: ".", command: "node -e \"process.stdout.write('TAP version 13\\n1..1\\nok 1 - 甲\\n# tests 1\\n# pass 1\\n')\"" },
      ROOT,
    );
    expect(r.ok, "种子态全绿却给了规格 ⇒ failToPass 空列").toBe(false);
    if (r.ok) return;
    expect(r.reasons.join("；")).toContain("全绿");
  });
});

/* ── ⑸ `--check` 那道门：漂了就红，且退出码是 1（不是印一句话然后退 0） ─────────────── */

describe("judge-spec 的 --check 门形状", () => {
  it("门脚本在场，且在配平的盘上退 0（这一格同时证明门跑得动，不是死代码）", () => {
    const src = readFileSync(join(ROOT, "scripts/bench-judge-spec.ts"), "utf8");
    expect(src, "没有 --check 分支 ⇒ 漂移只能靠人眼看").toContain('"--check"');
    expect(src).toContain("process.exit(1)");
    expect(src).toContain("process.exit(0)");
    const r = spawnSync(process.execPath,
      ["--import", "tsx", "scripts/bench-judge-spec.ts", "--check"],
      { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
    expect(r.status, `--check 在配平的盘上没退 0：${String(r.stdout)}${String(r.stderr)}`).toBe(0);
    expect(String(r.stdout)).toContain("逐字一致");
  });

  /* 门的**分辨力**：把一份漂过的副本摆在临时目录里，门必须红。
   * 这一条是专破 `sameSpec(...) → t.judge !== undefined` 那条突变的：那种改法让门只比
   * 「有没有 judge」不比内容 ⇒ 配平的盘上照样退 0（上面那条全绿），而漂掉的那一列
   * （加了条幻影测试名 / 两列互换 / 清空 passToPass）一道都拦不住。
   * 判据必须是**行为格**：真起进程、真漂一份、看退出码——读源码比字符串分不出
   * 「比了内容」与「只比了存在」。 */
  it("漂一份副本 ⇒ 门退 1 并点名（比的是内容，不是「有没有 judge」）", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-judge-spec-drift-"));
    try {
      /* 靶子与判卷命令都要能跑到 ⇒ 副本里放**五份清单的真拷贝**，`bench-*` 靶子目录走软链
       * （它们只读、不会被改）。**不能把整个 `fixtures/bench` 软链过去**：那样
       * `writeFileSync(dir/fixtures/bench/tasks.json)` 会顺着软链写进**真仓的清单**——
       * 实测：判据一跑，工作树里的 `tasks.json` 就被写成漂过的版本，而它本该只度量副本。
       * 这就是「判据自己弄脏了自己要守的东西」那个形状（第 621 页那条判据恒真的近亲）。
       * 这一格同时由下面那条「真仓清单一个字节都没动」守着。 */
      const benchDir = join(ROOT, "fixtures", "bench");
      mkdirSync(join(dir, "fixtures", "bench"), { recursive: true });
      for (const entry of readdirSync(benchDir)) {
        if (/^tasks.*\.json$/u.test(entry)) continue; // 清单：下面逐份写真拷贝
        symlinkSync(join(benchDir, entry), join(dir, "fixtures", "bench", entry), "dir");
      }
      for (const rel of MANIFESTS) {
        writeFileSync(join(dir, "fixtures", "bench", rel), readFileSync(join(benchDir, rel), "utf8"), "utf8");
      }
      // 判据自己不许弄脏被度量面：把真仓五份清单的原文记住，跑完逐字节比对
      const pristine = new Map(MANIFESTS.map((rel) => [rel, readFileSync(join(benchDir, rel), "utf8")] as const));
      // 三种漂法各来一份，每一种都必须被红
      const drifts: { label: string; mutate: (j: { failToPass: string[]; passToPass: string[] }) => void }[] = [
        { label: "幻影测试名（手抄会漂的形状）", mutate: (j) => { j.failToPass = [...j.failToPass, "盘上不存在的用例标题"]; } },
        { label: "两列互换（把本来就绿的写进该转绿 ⇒ 恒真）", mutate: (j) => { const f = j.failToPass; j.failToPass = j.passToPass.length > 0 ? j.passToPass : f; j.passToPass = f; } },
        { label: "清空 passToPass（半份判卷：只查该转绿，不查该保住）", mutate: (j) => { j.passToPass = []; } },
      ];
      for (const d of drifts) {
        const tasks = manifestOf("tasks.json").map((t) => (
          t.id === "B1-bugfix-crossfile"
            ? { ...t, judge: (() => { const j = { failToPass: [...t.judge!.failToPass], passToPass: [...t.judge!.passToPass] }; d.mutate(j); return j; })() }
            : t
        ));
        writeFileSync(join(dir, "fixtures", "bench", "tasks.json"), JSON.stringify(tasks, null, 2), "utf8");
        const r = spawnSync(process.execPath,
          ["--import", "tsx", join(ROOT, "scripts/bench-judge-spec.ts"), "--check", "--root", dir],
          { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
        expect(r.status, `${d.label} 却没被门红 ⇒ 这道门只比「有没有 judge」，不比内容`).toBe(1);
        expect(String(r.stderr) + String(r.stdout), `${d.label}：红了但没点名是哪一条`).toContain("B1-bugfix-crossfile");
      }
      for (const [rel, before] of pristine) {
        expect(readFileSync(join(benchDir, rel), "utf8"), `${rel} 被这条判据改动了 ⇒ 它弄脏了自己要守的面`).toBe(before);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});


