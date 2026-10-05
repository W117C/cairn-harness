// #63／#68 的判卷：评测跑器必须把**调用面**写进产物，且不许顶掉别人的基线（2026-10-05 第 379 页）。
//
// 为什么判源码形状而不是跑一遍：`loop-eval` 要打真模型（要 key、要花钱），判卷面跑不动它。
// 本仓对这类"脚本级产物契约"的既有做法就是钉脚本自己的形状（同族：`tests/agents-command-face.test.ts`
// 钉 AGENTS.md 的命令面、`tests/cert-gate-face.test.ts` 钉门面名单），所以这里照那个先例走。
//
// 判四件事，每条都有反向守卫——**只钉"有这句话"会退化成永远绿的形状断言**：
//   ① `run.json` 落盘，且八格齐全（headSha/dirty/ranAt/maxSteps/reps/system/model/tasks）；
//   ② 模型名**无条件**记（原先只在 BENCH_MODEL 非空时记 ⇒ 用缺省模型跑的那趟回查不到自己拨了哪档）；
//   ③ 覆盖 readings.json 前先归档（原先是直写 ⇒ 跑一次顶掉上一版基线）；
//   ④ 取不到 git 状态时用 -1 而不是 0（不许拿"取不到"冒充"干净树"）。
import { it, expect, describe } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { archiveExistingReadings } from "../scripts/lib/readings-archive";

const src = readFileSync(join(process.cwd(), "scripts", "loop-eval.ts"), "utf8");

describe("run.json 的调用面（#68）", () => {
  it("八格齐全：这一趟是怎么跑的，回查得到", () => {
    const i = src.indexOf('"run.json"');
    expect(i, "没有落盘 run.json ⇒ 读数仍不可复现（#68 复发）").toBeGreaterThan(-1);
    // 键在 `"run.json"` 之后（对象字面量是 writeFile 的第二个实参）⇒ 向后切，不是向前。
    const block = src.slice(i, i + 1400);
    for (const key of ["headSha", "dirty", "ranAt", "maxSteps", "reps", "system", "arm", "model", "tasks"]) {
      // 键可能是**简写属性**（`headSha,`）或 `key:` 形态，两种都算记了——
      // 初版只认 `key:`，于是把 `headSha,` 判成"少了这一格"（判据比事实严，是假红）。
      expect(block, "run.json 少了 " + key + " 这一格").toMatch(new RegExp("(^|[\\s{])" + key + "\\s*[,:]", "u"));
    }
  });

  it("取不到 git 状态时是 -1，不是 0（不许把「取不到」印成「干净树」）", () => {
    // 用两条**子串**钉，不用跨转义层级的正则：源码里是 `split("\\n")`，
    // 在判卷这一侧再套一层正则转义只会让尺自己先坏（本条初版就是这么坏的，已记）。
    expect(src, "脏文件数取不到时必须落到 -1").toContain(": -1;");
    expect(src, "「取不到」与「干净」必须用不同的值表示").toContain("// -1 = 取不到");
    expect(src).toContain('"--porcelain"');
  });
});

describe("模型名无条件记（#63）", () => {
  it("缺省模型那一档也要记下来（原先只在 BENCH_MODEL 非空时记 ⇒ 最常见那一档回查不到）", () => {
    expect(src).toMatch(/model:\s*\(BENCH_MODEL !== undefined && BENCH_MODEL !== ""\)\s*\?\s*BENCH_MODEL\s*:\s*glmDefaultModelName\(\)/u);
  });
});

describe("基线不覆盖（#63）：判**行为**，不判「源码里有没有那句话」", () => {
  // 第一版这条判的是源码字符串。造红时把 `if (existsSync(...))` 改成 `if (false) { … }`——
  // **两种写法含同一批字符串，判卷照绿**。那就是我自己在文件头上警告过的"形状断言"。
  // 现在逻辑抽到 `scripts/lib/readings-archive.ts`（带注入 IO），这里喂真行为。
  const calls: Array<[string, string]> = [];
  const ops = {
    exists: (p: string) => p === "/out/readings.json",
    rename: (from: string, to: string) => { calls.push([from, to]); },
  };

  it("有旧读数 ⇒ 真调一次 rename，且目标名带树号与时刻戳（冒号点号已换成横线）", () => {
    calls.length = 0;
    const out = archiveExistingReadings({
      dir: "/out", readingsPath: "/out/readings.json",
      headSha: "8a82df15deadbeef", nowIso: "2026-10-05T01:44:26.123Z", ops,
    });
    expect(calls).toEqual([["/out/readings.json", "/out/readings-8a82df1-2026-10-05T01-44-26-123Z.json"]]);
    expect(out).toBe("/out/readings-8a82df1-2026-10-05T01-44-26-123Z.json");
  });

  it("没有旧读数 ⇒ 一次都不许调 rename（否则会把刚写的自己改名走）", () => {
    calls.length = 0;
    const out = archiveExistingReadings({
      dir: "/out", readingsPath: "/out/readings.json",
      headSha: "8a82df15", nowIso: "2026-10-05T01:44:26.123Z",
      ops: { exists: () => false, rename: (f, t) => { calls.push([f, t]); } },
    });
    expect(calls).toHaveLength(0);
    expect(out).toBeNull();
  });

  it("用 rename 而不是 copy——复制会留下两份同名读数，正是本条要防的", () => {
    const seen: string[] = [];
    archiveExistingReadings({
      dir: "/out", readingsPath: "/out/readings.json",
      headSha: "abc", nowIso: "2026-10-05T00:00:00.000Z",
      ops: { exists: () => true, rename: () => { seen.push("rename"); } },
    });
    expect(seen).toEqual(["rename"]);
    // 判据面只有 exists 与 rename 两个口 ⇒ "有没有第三种做法（复制/直写）"在类型上就不可能。
  });

  it("接线面：脚本必须真的调用这只函数（否则抽出来的纯函数没人用，缺陷照旧）", () => {
    expect(src).toContain("archiveExistingReadings({");
    expect(src).not.toContain('join(ROOT, OUT, "readings-" + headSha.slice(0, 7)');
  });
});

// #90：身份**进每条读数**，而不只是 run.json 那一份旁证。
// 缺陷的原始形状：读数行只记结果、不记"这一趟是怎么跑的" ⇒ 两副不同臂／不同帽／不同 reps 的读数
// 混进同一堆，`scripts/eval/report.ts` 的对账面就只能猜"是不是同分母"。配对要先认得各自的脸。
describe("身份键落进每条读数（#90）", () => {
  it("写 readings.json 时逐条盖 headSha／ranAt／maxSteps／reps／arm（不是只盖 run.json 那一份旁证）", () => {
    // 钉的是**写 readings 那一行**里对每条 `r` 的盖章，不是 run.json 的对象字面量（后者只有一份）。
    const i = src.indexOf('writeFile(readingsPath');
    expect(i, "找不到写 readings.json 的那一步").toBeGreaterThan(-1);
    const block = src.slice(i, i + 700);
    expect(block, "读数没逐条 map ⇒ 身份只落在旁证、配对仍看不见每条的脸").toContain("rows.map(");
    for (const key of ["headSha", "ranAt", "maxSteps", "reps", "arm"]) {
      expect(block, "readings 每条没盖 " + key).toContain(key);
    }
    // 值全部复用同一趟已算好的量，不另起第二处事实源：帽/次数取 MAX_STEPS/REPS，臂取 ARM。
    expect(block).toMatch(/maxSteps:\s*MAX_STEPS/u);
    expect(block).toMatch(/reps:\s*REPS/u);
    expect(block).toMatch(/arm:\s*ARM\b/u);
  });

  it("arm 缺省落到 SYSTEM_MODE（同一份事实源，不另立第二处定义臂）", () => {
    expect(src).toMatch(/const ARM = pick\("--arm",\s*SYSTEM_MODE\)/u);
    // run.json 也记 arm（旁证与逐条读数是同一趟的那张脸）
    const j = src.indexOf('"run.json"');
    expect(src.slice(j, j + 700)).toMatch(/arm:\s*ARM\b/u);
  });

  it("一趟只读一次钟：run.json 的 ranAt 与逐条读数的 ranAt 取同一个常量（不留两处各 new Date 漂出两值）", () => {
    expect(src, "ranAt 必须是一个 hoist 出来的常量").toMatch(/const ranAt = new Date\(\)\.toISOString\(\)/u);
    const j = src.indexOf('"run.json"');
    // run.json 里用的是简写属性 `ranAt,` 而不是又调一次 new Date
    expect(src.slice(j, j + 700)).toMatch(/(^|[\s{])ranAt\s*,/u);
    expect(src.slice(j, j + 700), "run.json 里二次读钟 ⇒ 与逐条读数的 ranAt 对不上").not.toMatch(/ranAt:\s*new Date\(\)/u);
  });
});
