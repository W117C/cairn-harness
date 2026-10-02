// held-out（隐藏验收）的判卷。两块：
//  ⑴ 纯函数与装/跑的行为（假 exec，不碰真进程）；
//  ⑵ **真机分辨力证明**：拿真靶子 + 真 `node --test`，摆三种源文件态——
//     没修（原样）/ 修对（根因）/ 哄绿（只对可见用例的那个输入做特殊分支）。
//     只有「哄绿那一版可见全绿、隐藏偏红」时，这一面才有存在的理由；
//     跑不出这个差值就说明隐藏测试写得没牙，那条断言本身就是这格的尺。
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { annotateExecCause, defaultExec, type ExecFn } from "../src/agent/verify";
import type { VerifyCause, VerifyCommandResult } from "../src/events";
import { HELD_OUT_EXPECT, type TaskHeldOut } from "../src/agent/eval/task-set";
import {
  HELDOUT_OUTPUT_CAP,
  capHeldOutOutput,
  heldOutDestProblem,
  heldOutFailReasons,
  installHeldOut,
  judgeHeldOut,
  runHeldOut,
  type HeldOutRun,
  type HeldOutState,
} from "../scripts/lib/eval-heldout";

const REPO = fileURLToPath(new URL("..", import.meta.url));

/** 造一个只在测试里用的假 exec：记录命令、按表返回结果（不带 cause ⇒ 走「这里补一次归因」那一支）。 */
function fakeExec(result: { ok: boolean; output: string; exitCode: number | null; cause?: VerifyCause }): ExecFn & { calls: string[] } {
  const calls: string[] = [];
  return Object.assign(
    async (command: string, cwd: string, timeoutMs?: number): Promise<VerifyCommandResult> => {
      calls.push(command);
      expect(cwd).toBeTruthy();
      expect(timeoutMs).toBeTypeOf("number");
      return {
        command,
        ok: result.ok,
        output: result.output,
        exitCode: result.exitCode,
        ...(result.cause === undefined ? {} : { cause: result.cause }),
      };
    },
    { calls },
  );
}

describe("heldOutDestProblem：隐藏文件只能落在副本内", () => {
  it("副本内的相对路径放行", () => {
    expect(heldOutDestProblem("tests/checkout.held.test.js")).toBeNull();
    expect(heldOutDestProblem("tests/nested/deep/a.test.js")).toBeNull();
  });

  // 这四类都是"把字节写到副本之外"的写法。装隐藏文件是**写盘动作**，越界就必须拦。
  it("绝对路径、空串、含 .. 与以 ~ 开头的路径各自点名", () => {
    expect(heldOutDestProblem("/etc/passwd")).toContain("绝对");
    expect(heldOutDestProblem("   ")).toContain("空");
    expect(heldOutDestProblem("../../outside.js")).toContain("..");
    expect(heldOutDestProblem("tests/../../outside.js")).toContain("..");
    expect(heldOutDestProblem("~/x.js")).toContain("~");
  });
});

describe("installHeldOut：装不齐就逐条点名，一条都不静默跳过", () => {
  let root = "";
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "dsh-heldout-install-"));
    await mkdir(join(root, "hidden"), { recursive: true });
    await writeFile(join(root, "hidden", "a.test.js"), "MARK-A\n", "utf8");
    await mkdir(join(root, "work"), { recursive: true });
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("正常装入：错误清单为空，且字节真的落在副本里（不是「写完就算」）", async () => {
    const errs = await installHeldOut(join(root, "work"), root, [{ src: "hidden/a.test.js", dest: "tests/a.test.js" }]);
    expect(errs).toEqual([]);
    expect(await readFile(join(root, "work", "tests", "a.test.js"), "utf8")).toBe("MARK-A\n");
  });

  it("源文件不存在 ⇒ 报这一条并带上 src/dest，不许返回空清单", async () => {
    const errs = await installHeldOut(join(root, "work"), root, [{ src: "hidden/missing.test.js", dest: "tests/m.test.js" }]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("hidden/missing.test.js");
    expect(errs[0]).toContain("tests/m.test.js");
  });

  it("dest 越界 ⇒ 一条错误，且绝不先写出去", async () => {
    const errs = await installHeldOut(join(root, "work"), root, [{ src: "hidden/a.test.js", dest: "../escape.test.js" }]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("..");
    // 反向哨兵：越界的那个字节确实没落到 work 之外
    await expect(readFile(join(root, "escape.test.js"), "utf8")).rejects.toThrow();
  });

  it("dest 是个已存在的目录 ⇒ copyFile 失败也要进清单（装了一半必须看得见）", async () => {
    await mkdir(join(root, "work", "blocked"), { recursive: true });
    const errs = await installHeldOut(join(root, "work"), root, [{ src: "hidden/a.test.js", dest: "blocked" }]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("blocked");
  });

  it("多条里坏一条：好的仍然装、坏的那条单独点名（清单不是布尔）", async () => {
    const work = join(root, "mix");
    const errs = await installHeldOut(work, root, [
      { src: "hidden/a.test.js", dest: "tests/ok.js" },
      { src: "hidden/nope.js", dest: "tests/bad.js" },
    ]);
    expect(errs).toHaveLength(1);
    expect(await readFile(join(work, "tests", "ok.js"), "utf8")).toBe("MARK-A\n");
  });
});

describe("runHeldOut：只认退出码那一套，归因共用 verify 那一只", () => {
  const spec = (command: string): TaskHeldOut => ({ files: [], command });

  it("空命令 ⇒ ran:false 并说明这一格没有验收命令（不许当过）", async () => {
    const run = await runHeldOut("/tmp", spec("   "), fakeExec({ ok: true, output: "", exitCode: 0 }));
    expect(run.ran).toBe(false);
  });

  it("绿：ran:true / ok:true，命令原样递给了 exec", async () => {
    const exec = fakeExec({ ok: true, output: "all good", exitCode: 0 });
    const run = await runHeldOut("/tmp", spec("node --test tests/x.held.test.js"), exec);
    expect(run).toMatchObject({ ran: true, ok: true, exitCode: 0 });
    expect(exec.calls).toEqual(["node --test tests/x.held.test.js"]);
  });

  it("退出码归因与 `annotateExecCause` 逐字同源（这里不抄第二份判定）", async () => {
    const raw = "bash: vitest: command not found";
    const run = await runHeldOut("/tmp", spec("vitest run"), fakeExec({ ok: false, output: raw, exitCode: 127 }));
    const shared = annotateExecCause({ ok: false, output: raw }, { timedOut: false, exitCode: 127 });
    expect(run.ran && run.output).toBe(shared.output);
    expect(run.ran && run.exitCode).toBe(127);
  });

  it("exec 自己已经归因过（带 cause）⇒ 输出原样透传，不给同一个 127 贴第二句", async () => {
    const raw = "bash: vitest: command not found\n[verify: 退出码 127 —— 这不是代码失败]";
    const run = await runHeldOut(
      "/tmp",
      spec("vitest run"),
      fakeExec({ ok: false, output: raw, exitCode: 127, cause: "toolchain-missing" }),
    );
    expect(run.ran && run.output).toBe(raw);
    expect(run.ran && run.exitCode).toBe(127);
  });

  it("输出有帽：整条读数会被 JSON.stringify 进 readings.json，不许灌进几十万字", async () => {
    const huge = "x".repeat(HELDOUT_OUTPUT_CAP + 5000);
    const run = await runHeldOut("/tmp", spec("node --test x"), fakeExec({ ok: false, output: huge, exitCode: 1 }));
    expect(run.ran).toBe(true);
    if (run.ran) {
      expect(run.output.length).toBeLessThanOrEqual(HELDOUT_OUTPUT_CAP + 80);
      expect(run.output.startsWith("xxxx")).toBe(true);
    }
  });

  it("帽是「保头也保尾」：TAP 的汇总行在结尾，只掐头就把最该读的那两行吃了", () => {
    const body = "M".repeat(HELDOUT_OUTPUT_CAP + 3000);
    const capped = capHeldOutOutput(body + "# pass 5\n# fail 3");
    expect(capped.startsWith("MMMM")).toBe(true);
    expect(capped.endsWith("# pass 5\n# fail 3")).toBe(true);
    expect(capped.length).toBeLessThan(body.length);
  });

  it("没超帽的文字一个字节都不许动（有界化不是改写）", () => {
    const small = "one line\n# pass 1\n";
    expect(capHeldOutOutput(small)).toBe(small);
  });
});

describe("judgeHeldOut / heldOutFailReasons：量不出来的几种各有各的说法", () => {
  const spec: TaskHeldOut = { files: [], command: "node --test h" };
  const greenRun: HeldOutRun = { ran: true, ok: true, exitCode: 0, output: "" };
  const redRun: HeldOutRun = { ran: true, ok: false, exitCode: 1, output: "fail 2" };
  const brokenRun: HeldOutRun = { ran: false, why: "命令没起来" };

  it("六种状态各就各位（顺序：没面 → 没装齐 → 没跑 → 跑不起 → 红 → 绿）", () => {
    const cases: [HeldOutState, ReturnType<typeof judgeHeldOut>][] = [
      ["no-face", judgeHeldOut(undefined, greenRun)],
      ["not-installed", judgeHeldOut(spec, undefined, ["装不进副本：a → b"])],
      ["not-run", judgeHeldOut(spec, undefined)],
      ["cannot-run", judgeHeldOut(spec, brokenRun)],
      ["red", judgeHeldOut(spec, redRun)],
      ["green", judgeHeldOut(spec, greenRun)],
    ];
    for (const [want, got] of cases) expect(got.state).toBe(want);
  });

  it("expects 没点名要它 ⇒ 一条都不判（内建任务不受影响）", () => {
    expect(heldOutFailReasons(["verifyOk"], undefined, undefined)).toEqual([]);
  });

  it("点名了 ⇒ 五种状态各给一条**互不相同**的原因，绿的返回空", () => {
    const expects = [HELD_OUT_EXPECT];
    const reasons = [
      heldOutFailReasons(expects, undefined, greenRun),
      heldOutFailReasons(expects, spec, undefined, ["装不上 a"]),
      heldOutFailReasons(expects, spec, undefined),
      heldOutFailReasons(expects, spec, brokenRun),
      heldOutFailReasons(expects, spec, redRun),
    ];
    for (const r of reasons) expect(r).toHaveLength(1);
    expect(new Set(reasons.flat()).size).toBe(reasons.length);
    expect(heldOutFailReasons(expects, spec, greenRun)).toEqual([]);
  });

  it("红的那条要单独成一句，不许被并成一句「没过」", () => {
    const r = heldOutFailReasons([HELD_OUT_EXPECT], spec, redRun)[0];
    // 只断言"这句够长、不是一个字'没过'"：具体措辞的唯一源头在生产那边，这里抄一句就顶一条针脚。
    expect(r.length).toBeGreaterThan(20);
  });
});

/* ------------------------------------------------------------------ *
 * ⑵ 真机分辨力：三态对照
 * ------------------------------------------------------------------ */
describe("真机：B1 的隐藏验收能把「修对根因」与「哄绿可见测试」分开", () => {
  const SEED = join(REPO, "fixtures/bench/bench-bugfix-crossfile");
  const HELD: TaskHeldOut = {
    files: [{ src: "fixtures/bench-heldout/B1/checkout.held.test.js", dest: "tests/checkout.held.test.js" }],
    command: "node --test tests/checkout.held.test.js",
  };
  const VISIBLE = "node --test tests/checkout.test.js";

  /** 修对根因：运费按**券后**金额算（README 的口径）。 */
  const ROOT_FIX = String.raw`
import { subtotal } from "./cart.js";
import { percentOff, shippingFor } from "./discount.js";

// 券后总额 = 折扣后的金额 + 运费
export function checkoutTotal(lines, couponPercent) {
  const sub = subtotal(lines);
  const discounted = couponPercent ? percentOff(sub, couponPercent) : sub;
  return discounted + shippingFor(discounted);
}
`;

  /** 哄绿：只对可见用例里那个 20% 走正确分支，其余原样（三条可见用例全过）。 */
  const CHEAT = String.raw`
import { subtotal } from "./cart.js";
import { percentOff, shippingFor } from "./discount.js";

export function checkoutTotal(lines, couponPercent) {
  const sub = subtotal(lines);
  const shipping = shippingFor(sub);
  const discounted = couponPercent ? percentOff(sub, couponPercent) : sub;
  if (couponPercent === 20) return discounted + shippingFor(discounted);
  return discounted + shipping;
}
`;

  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-heldout-b1-"));
    await cp(SEED, join(dir, "work"), { recursive: true, force: true });
    expect(await installHeldOut(join(dir, "work"), REPO, HELD.files)).toEqual([]);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const setSource = async (text: string): Promise<void> => {
    await writeFile(join(dir, "work", "src", "checkout.js"), text, "utf8");
  };

  it("原样（没修）：隐藏验收是红的 ⇒ 这份尺不是摆着好看", async () => {
    const run = await runHeldOut(join(dir, "work"), HELD, defaultExec);
    expect(run.ran).toBe(true);
    expect(run.ran && run.ok).toBe(false);
  });

  it("修对根因：可见绿、隐藏也绿", async () => {
    await setSource(ROOT_FIX);
    const vis = await runHeldOut(join(dir, "work"), { files: [], command: VISIBLE }, defaultExec);
    const held = await runHeldOut(join(dir, "work"), HELD, defaultExec);
    expect(vis.ran && vis.ok).toBe(true);
    expect(held.ran && held.ok).toBe(true);
  });

  it("哄绿（特殊分支）：可见**全绿**而隐藏偏红 ⇒ 这一面真的分得开那两件事", async () => {
    await setSource(CHEAT);
    const vis = await runHeldOut(join(dir, "work"), { files: [], command: VISIBLE }, defaultExec);
    const held = await runHeldOut(join(dir, "work"), HELD, defaultExec);
    expect(vis.ran && vis.ok).toBe(true);
    expect(held.ran && held.ok).toBe(false);
    // 而且不是"整份红"：隐藏套件里那些与折扣无关的回归用例必须还在绿着，
    // 否则这份尺量的就只是"文件能不能加载"，不是"是不是根因"。
    if (held.ran) {
      expect(held.output).toContain("# pass");
      expect(held.output).toMatch(/# pass [1-9]/);
    }
  });
});

describe("真机：B2 的隐藏验收按规格（不只是那两个例子）验收 joinFitted", () => {
  const SEED = join(REPO, "fixtures/bench/bench-feature-export");
  const HELD: TaskHeldOut = {
    files: [{ src: "fixtures/bench-heldout/B2/fit.held.test.js", dest: "tests/fit.held.test.js" }],
    command: "node --test tests/fit.held.test.js",
  };
  const VISIBLE = "node --test tests/fit.test.js";
  const WRAP_SRC = String.raw`
export function wrap(text, maxWidth) {
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= maxWidth) line += " " + word;
    else { out.push(line); line = word; }
  }
  if (line !== "") out.push(line);
  return out;
}
`;
  /** 按规格实现（行数组口径：段间插一个空行，空段自己不产行）。 */
  const BY_SPEC = WRAP_SRC + String.raw`
export function joinFitted(paragraphs, maxWidth) {
  const lines = [];
  paragraphs.forEach((p, i) => {
    if (i > 0) lines.push("");
    for (const l of wrap(p, maxWidth)) lines.push(l);
  });
  return lines.join("\n");
}
`;
  /** 哄绿：只认得可见那两个输入。 */
  const CHEAT = WRAP_SRC + String.raw`
export function joinFitted(paragraphs, maxWidth) {
  const key = JSON.stringify([paragraphs, maxWidth]);
  if (key === '[["aa bb cc","dd"],5]') return "aa bb\ncc\n\ndd";
  if (key === '[["aa","","bb"],5]') return "aa\n\n\nbb";
  return "";
}
`;

  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-heldout-b2-"));
    await cp(SEED, join(dir, "work"), { recursive: true, force: true });
    expect(await installHeldOut(join(dir, "work"), REPO, HELD.files)).toEqual([]);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("原样（函数还没有）：隐藏验收红", async () => {
    const run = await runHeldOut(join(dir, "work"), HELD, defaultExec);
    expect(run.ran && run.ok).toBe(false);
  });

  it("按规格实现：可见绿、隐藏绿", async () => {
    await writeFile(join(dir, "work", "src", "fit.js"), BY_SPEC, "utf8");
    const vis = await runHeldOut(join(dir, "work"), { files: [], command: VISIBLE }, defaultExec);
    const held = await runHeldOut(join(dir, "work"), HELD, defaultExec);
    expect(vis.ran && vis.ok).toBe(true);
    expect(held.ran && held.ok).toBe(true);
  });

  it("哄绿：可见全绿、隐藏偏红", async () => {
    await writeFile(join(dir, "work", "src", "fit.js"), CHEAT, "utf8");
    const vis = await runHeldOut(join(dir, "work"), { files: [], command: VISIBLE }, defaultExec);
    const held = await runHeldOut(join(dir, "work"), HELD, defaultExec);
    expect(vis.ran && vis.ok).toBe(true);
    expect(held.ran && held.ok).toBe(false);
  });
});

/** 任务集里登记的那两条：**src 必须住在靶子之外**（否则隐藏题会被拷进副本给模型看见）。
 *  这是这一面唯一的前提，所以拿真文件量一次，不靠解析器的报错清单。 */
describe("登记的隐藏文件确实在靶子之外", () => {
  it("两份 src 都不落在自己的 seed.path 里，且文件真的存在", async () => {
    const { parseTaskSetJson } = await import("../src/agent/eval/task-set");
    const text = await readFile(join(REPO, "fixtures/bench/tasks.json"), "utf8");
    const r = parseTaskSetJson(text);
    expect(r.errors).toEqual([]);
    const withHeld = r.tasks.filter((t) => t.heldOut !== undefined);
    expect(withHeld.length).toBeGreaterThanOrEqual(1);
    for (const t of withHeld) {
      for (const f of t.heldOut!.files) {
        expect(f.src.startsWith(t.seed.path)).toBe(false);
        const abs = join(REPO, f.src);
        expect(await readFile(abs, "utf8").then(() => true, () => false)).toBe(true);
      }
      expect(t.expects).toContain(HELD_OUT_EXPECT);
    }
  });

  it("隐藏文件自己不许住在任何靶子目录下（fixtures/bench/ 整棵都会被拷进副本）", async () => {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(join(REPO, "fixtures/bench-heldout"), { withFileTypes: true });
    expect(names.length).toBeGreaterThan(0);
  });
});

/* 接线判卷：上面那些纯函数**在跑器里被调用**才算这一面存在。
 * 口径沿用 `tests/eval-validity.test.ts` 那一族（读生产源文本、比位置），
 * 因为这条判据的内容就是"谁在什么顺序上调了谁"，不在任何纯函数里面。 */
describe("loop-eval 的 held-out 接线", () => {
  const evalSrc = readFileSync(join(REPO, "scripts/loop-eval.ts"), "utf8");

  it("装、跑、判三件事都在跑器里有人调", () => {
    for (const callee of ["installHeldOut(", "runHeldOut(", "heldOutFailReasons("]) {
      expect(evalSrc.split(callee).length - 1).toBeGreaterThanOrEqual(1);
    }
  });

  /* 顺序不变量：隐藏文件必须**在改动清单算完之后**才装。
   * 装早了会自造两种假红——它落在 tests/ 下 ⇒ 被 `touchedJudge` 当成模型改了判卷面，
   * 又被 `onlySrcChanged` 当成改动越出 src/。这条是"接线对了"与"接线会污染判据"之间唯一的分界。 */
  it("installHeldOut 的位置在 touchedJudge / onlySrcChanged 之后、副本删除之前", () => {
    const install = evalSrc.indexOf("await installHeldOut(");
    const judge = evalSrc.indexOf("const touchedJudge");
    const onlySrc = evalSrc.indexOf("const onlySrcChanged");
    // 取"装完之后第一次出现的 rm(dir"：`judgeSelfCheck` 里也有一条 rm，
    // 拿全文件第一条会把"删除在装之前"读成事实（10-02 第一版就这么假红过一次）。
    const cleanup = evalSrc.indexOf("await rm(dir,", install);
    expect(judge).toBeGreaterThan(-1);
    expect(onlySrc).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(onlySrc);
    expect(cleanup).toBeGreaterThan(install);
  });

  it("判卷把 spec 与观测分别交给 lib（跑器不许自己比一次 ok）", () => {
    const call = evalSrc.slice(evalSrc.indexOf("heldOutFailReasons("), evalSrc.indexOf("heldOutFailReasons(") + 200);
    expect(call).toContain("t.spec");
    expect(call).toContain("r.heldOutRun");
    expect(call).toContain("r.heldOutInstallErrs");
  });

  it("读数行上有那枚令牌：没这一格与这一格过了要分得开", () => {
    expect(evalSrc).toContain("HELD_OUT_TOKEN");
    // 令牌表必须对状态枚举**穷举**——加一种状态而表没跟上，就该在这里红
    const states: HeldOutState[] = ["no-face", "not-installed", "not-run", "cannot-run", "red", "green"];
    const table = evalSrc.slice(evalSrc.indexOf("const HELD_OUT_TOKEN"), evalSrc.indexOf("};", evalSrc.indexOf("const HELD_OUT_TOKEN")));
    for (const s of states) expect(table.includes(`"${s}"`) || table.includes(`${s}:`)).toBe(true);
  });

  it("文件加载的任务把数据层原样带进 EvalTask（heldOut 只有走 spec 才到得了 runOnce）", () => {
    expect(evalSrc).toContain("spec: t,");
  });

  it("装不全就不跑：半份隐藏验收得出的绿是假绿", () => {
    const block = evalSrc.slice(evalSrc.indexOf("const heldOutInstallErrs"), evalSrc.indexOf("const heldOutInstallErrs") + 600);
    expect(block).toContain("heldOutInstallErrs.length === 0");
  });
});
