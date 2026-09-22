// 四道面**合起来**的落点（2026-09-22）。
//
// 09-21 的复现报告四段全绿之后，留位第一条写着：「四道面（规则层 + 风险层 + 档位 + worker 静态闸）
// 合起来的端到端判定——离线锚点各钉一支，没有一条钉住组合」。当时的唯一观测者是
// `scripts/probe-shell-bypass.ts`，而它既不是门禁、也不是变异锚点的消费者（`mutate-verify` 只吃 vitest）；
// 更糟的是四段里最裸的一支（worker 的 git 静态闸）在权限锚点里**零覆盖**。
//
// 所以：清单收在 `scripts/lib/shell-bypass-cases.ts`（探针与本测共用，不各起一份），
// 本测把四段的期望变成能进 `pnpm test`、能被锚点钉住的判据。两边都直调真实函数，不复制实现。
import { describe, expect, it } from "vitest";
import { interceptDestructiveGit, isReadOnlyShellCommand } from "../src/agent/worker-shell-tools";
import { commandForms, invocations } from "../src/permissions/command-shape";
import { evaluate, newAutonomySession } from "../src/permissions/autonomy";
import { judgeChain, parsePermissionsFile } from "../src/permissions/rules";
import type { ToolName } from "../src/tools/base";
// worker 工具名按设计不在主会话键域 ToolName 内（与 tests/permissions.test.ts 的 asTool 同惯例）。
const asTool = (s: string): ToolName => s as ToolName;
import {
  ALLOW_CASES,
  BOUNDARY_MUST_STAY_DENY,
  DENY_VARIANTS,
  FLAG_BOUNDARY_OVERHIT,
  FLAG_UNDERHIT,
  GLOBAL_OPT_MUST_STAY_CLEAN,
  GLOBAL_OPT_VARIANTS,
  INSERTED_ARG_UNDERHIT,
  PIPE_INTO_SHELL,
  PREFIX_WORD_MUST_STAY_CLEAN,
  PREFIX_WORD_VARIANTS,
  PROBE_RULES_JSON,
  REDIRECT_CASES,
  STRUCTURE_ALREADY_COVERS,
  UNBOUNDED_PREFIX_WORDS,
  WORKER_CASES,
} from "../scripts/lib/shell-bypass-cases";

const RULES = parsePermissionsFile(PROBE_RULES_JSON, "test");
const session = (rules = RULES) =>
  newAutonomySession("auto", { rules, sandboxAvailable: true, planBlocked: () => false });

/** `verdict@layer`：组合判据要看的正是「由哪一层决定」，只看 verdict 会把「风险层抢在规则层前面」读成绿。 */
const at = (r: { verdict: string; layer?: string }) => `${r.verdict}@${r.layer ?? "?"}`;

describe("① 用户手写的 deny：11 种包装写法", () => {
  it("自主档逐条由 L1-deny 决定（不是风险层『顺便问一句』）", () => {
    for (const cmd of DENY_VARIANTS) {
      expect(at(evaluate("run_shell", { command: cmd }, session())), cmd).toBe("deny@L1-deny");
    }
  });

  it("同一批命令在纯规则层也判 deny（档位与风险层摘掉后不改变结论）", () => {
    for (const cmd of DENY_VARIANTS) {
      expect(judgeChain(RULES, "run_shell", cmd).verdict, cmd).toBe("deny");
    }
  });

  it("清单不收窄：九类包装写法各至少一条（把清单改窄就是把自己判绿）", () => {
    const FAMILIES: Array<[string, RegExp]> = [
      ["多空格归一", /^git {2,}push/],
      ["sudo", /^sudo\b/],
      ["env 赋值前缀", /^env /],
      ["前导赋值（不是包装器）", /^\w+=\S+ /],
      ["nohup", /^nohup\b/],
      ["timeout 带时长", /^timeout\s+\d/],
      ["command", /^command\b/],
      ["绝对路径取基名", /^\//],
      ["shell -c 载荷递归", /^bash -c /],
    ];
    for (const [name, re] of FAMILIES) {
      expect(DENY_VARIANTS.some((c) => re.test(c)), name).toBe(true);
    }
    expect(DENY_VARIANTS).toContain("git push --force"); // 原形必须在，否则整批都在测包装器
  });
});

describe("② 「总是允许」的同意范围", () => {
  it("裸命令按用户同意放行（L3-rule）", () => {
    const bare = ALLOW_CASES.filter(([, isBare]) => isBare).map(([c]) => c);
    expect(bare).toEqual(["echo hi"]);
    for (const cmd of bare) expect(at(evaluate("run_shell", { command: cmd }, session())), cmd).toBe("approve@L3-rule");
  });

  /** 实测（09-22）：5 条带载荷的一律不被静默放行；其中 4 条由「同意缺口」自己成卡（L2 点名载荷），
   *  `echo hi | sh` 因为风险层判它 high 而由 L4 抢先出卡——**两层的相对序正是组合判据要钉的东西**，
   *  单面测试只会看到「反正都 ask」。 */
  it("带载荷一律不是 approve；缺口通道仍在产出原因，风险更高的由风险层抢先出卡", () => {
    const loaded = ALLOW_CASES.filter(([, isBare]) => !isBare).map(([c]) => c);
    expect(loaded).toHaveLength(5);
    let gapNamed = 0;
    for (const cmd of loaded) {
      const d = evaluate("run_shell", { command: cmd }, session());
      expect(d.verdict, cmd).toBe("ask"); // 静默放行 = 09-21 那个缺陷复活
      if (d.verdict !== "ask") continue;
      if (d.reason.includes("载荷")) {
        gapNamed += 1;
        expect(d.layer, cmd).toBe("L2-ask-rule");
      } else {
        expect(d.layer, cmd).toBe("L4-risk"); // 被更高层抢先也要问，且说不出「载荷」就别谎称说了
        expect(d.riskReasons.length, cmd).toBeGreaterThan(0);
      }
    }
    expect(gapNamed).toBeGreaterThan(0); // 同意缺口通道整个哑掉时，本条必须红
  });
});

describe("③ worker 的 git 静态闸（此前全仓零锚点的一支）", () => {
  it("非只读一律拦：包装、链段、值选项、`shell -c` 载荷、`command -p` 都不给缝", () => {
    for (const [cmd, readOnly] of WORKER_CASES) {
      expect(interceptDestructiveGit(cmd).ok, cmd).toBe(readOnly);
    }
  });

  it("换行是命令分隔符：`echo hi\\ngit push --force` 不得因为整段首词是 echo 而漏判", () => {
    expect(interceptDestructiveGit("echo hi\ngit push --force").ok).toBe(false);
    expect(interceptDestructiveGit("echo hi").ok).toBe(true); // 无 git 段照常放行
  });

  it("拦下来要说得出为什么、放行什么（worker 无合并权，reason 是用户唯一的解释面）", () => {
    const blocked = interceptDestructiveGit("git reset --hard");
    expect(blocked.ok).toBe(false);
    expect(blocked.why).toContain("git reset");
    expect(blocked.why).toContain("合并唯一出口");
  });
});

describe("④ 空规则库下的重定向写向", () => {
  it("四支写向全由静态威胁表出卡（不靠用户手写规则）", () => {
    for (const cmd of REDIRECT_CASES) {
      const d = evaluate("run_shell", { command: cmd }, session([]));
      expect(d.verdict, cmd).toBe("ask");
      if (d.verdict === "ask") expect(d.riskReasons.length, cmd).toBeGreaterThan(0);
    }
  });

  it("管道进 shell 同样出卡（把上游当脚本执行）", () => {
    const d = evaluate("run_shell", { command: PIPE_INTO_SHELL }, session([]));
    expect(d.verdict).toBe("ask");
  });

  it("`/dev/null` 这类丢弃不算写向（收紧不得把正常命令全拦成 ask）", () => {
    expect(evaluate("run_shell", { command: "git status > /dev/null" }, session([])).verdict).not.toBe("ask");
  });
});

describe("组合不变量（本测独有：单面锚点钉不住）", () => {
  it("规则层判 deny 的，自主档必须由 L1-deny 决定——风险层与档位都不得抢先或降级", () => {
    for (const cmd of DENY_VARIANTS) {
      const chain = judgeChain(RULES, "run_shell", cmd).verdict;
      expect(chain, cmd).toBe("deny");
      expect(at(evaluate("run_shell", { command: cmd }, session())), cmd).toBe("deny@L1-deny");
    }
  });

  it("只读 git 在四道面上都是放行侧（防「为绿而全拦」把安全面板一起锁死）", () => {
    const cmd = "git status";
    expect(interceptDestructiveGit(cmd).ok).toBe(true);
    expect(evaluate("run_shell", { command: cmd }, session([])).verdict).toBe("approve");
    expect(judgeChain(RULES, "run_shell", cmd).verdict).toBe("miss");
  });

  /** 实测（09-22）逐条相同 ⇒ 互通成立；本条钉的是"哪天只硬化一支"（第六族同根形状）。 */
  it("worker 的 shell_rw 与主会话 run_shell 在四道面上逐条同判（SHELL_FAMILY 互通）", () => {
    for (const cmd of [...DENY_VARIANTS, ...REDIRECT_CASES, PIPE_INTO_SHELL]) {
      expect(at(evaluate(asTool("shell_rw"), { command: cmd }, session())), cmd)
        .toBe(at(evaluate("run_shell", { command: cmd }, session())));
    }
  });
});

/* ---------------- 两道防的合取（09-22 加，shell_ro 的安全前提是量出来的） ----------------
   `shell_ro` 刻意不进静态威胁表（`risk.ts` 的 `isWriteCapableTool` 排除它），而且它的 run()
   「直连 run_shell 原始实现（不过主会话工具门）」——即**唯一**那道防是 `isReadOnlyShellCommand`。
   这个取舍只有在该函数真能挡住一切写面时才成立；两侧各自单测都看不到"中间漏过去"的那种命令，
   所以这里判合取：列出的每一条，静态闸必须拒，**否则**权限层得为 shell_ro 出卡。 */
const RO_MUST_STOP = [
  ...REDIRECT_CASES,
  PIPE_INTO_SHELL,
  "rm -rf /",
  "sudo git push --force",
  "cat x\ngit push --force",
  ...ALLOW_CASES.filter(([, bare]) => !bare).map(([c]) => c),
];

/* ---------------- ⑤ 下游选项族（探针 ⑤ 段的离线观测者，09-22） ----------------
   根因与 ① 不同：① 的包装器在二进制上游，`invocations` 会剥；这一族的全局选项插在
   二进制与子命令**之间**，前缀匹配看不见子命令。修前实测五支全漏（approve@L4-pass）。 */
describe("⑤ 下游选项：git -C /tmp push --force 一类", () => {
  it("五支写法在自主档全由 L1-deny 拦下", () => {
    for (const cmd of GLOBAL_OPT_VARIANTS) {
      expect(at(evaluate("run_shell", { command: cmd }, session())), cmd).toBe("deny@L1-deny");
    }
  });

  it("负控：只读命令带选项不得被 deny 命中（过覆盖也要有界）", () => {
    for (const cmd of GLOBAL_OPT_MUST_STAY_CLEAN) {
      expect(evaluate("run_shell", { command: cmd }, session()).verdict, cmd).not.toBe("deny");
    }
  });

  it("不对称仍成立：allow 只认原形，`git -C /tmp status` 不被「allow git status」静默放行", () => {
    // 用户点「总是允许」时看见的是那条字面命令；顺着下游选项放宽 = 替他扩大同意面。
    const rules = parsePermissionsFile(
      JSON.stringify({ rules: [{ behavior: "allow", tool: "run_shell", pattern: "git status", scope: "always" }] }),
      "test",
    );
    const s = newAutonomySession("auto", { rules, sandboxAvailable: true, planBlocked: () => false });
    expect(at(evaluate("run_shell", { command: "git status" }, s))).toBe("approve@L3-rule");
    expect(judgeChain(rules, "run_shell", "git -C /tmp status").verdict).toBe("miss");
  });

  it("worker 侧不受本族影响：fail-closed 让它一直拦得住（但 reason 会说不出子命令名）", () => {
    for (const cmd of GLOBAL_OPT_VARIANTS) expect(interceptDestructiveGit(cmd).ok, cmd).toBe(false);
  });
});

describe("shell_ro：静态只读闸与权限层的合取", () => {
  it("每一条都必须被某一道防住（两道各自以为对方在管 = 谁都没管）", () => {
    for (const cmd of RO_MUST_STOP) {
      const gate = isReadOnlyShellCommand(cmd);
      const d = evaluate(asTool("shell_ro"), { command: cmd }, session([]));
      expect(gate.ok === false || d.verdict !== "approve", cmd).toBe(true);
    }
  });

  it("写面元字符一票否决仍在（对 shell_ro 而言它是 `> /etc/hosts` 唯一那道防）", () => {
    expect(isReadOnlyShellCommand("echo x > /etc/hosts").ok).toBe(false);
    expect(isReadOnlyShellCommand("rm -rf /").ok).toBe(false); // 白名单外
    expect(isReadOnlyShellCommand("sudo git push --force").ok).toBe(false); // 包装器也不给进
    expect(isReadOnlyShellCommand("cat x\ngit push --force").ok).toBe(false); // 换行分隔
    expect(isReadOnlyShellCommand("cat x | wc -l").ok).toBe(true); // 正常只读管道不受牵连
  });
});

/* ---------------- ⑨ 选项的 token 边界（09-22 已裁：修过覆盖那一侧） ----------------
   根因同 ⑤：规则匹配是**整串前缀**（`form.startsWith(pattern)`），于是一头宽一头窄——
   `-f` / `--f`（同一件被禁的事）漏判，而 `--force-with-lease`（**更安全**的那个）被过覆盖。
   裁决取「先修过覆盖 + 卡面点名规则」：命中处右邻必须是行尾或空白，纯机械、不建按二进制的别名表；
   `-f` 那一侧继续留作已知边界（要它得建别名表，另账）。worker 侧不受影响（push 本就非只读）。 */
describe("⑨ deny 的 token 边界：过覆盖那一侧已修，漏判那一侧另账", () => {
  it("过覆盖侧已修：`git push --force-with-lease` 不再被这条 deny 命中", () => {
    for (const cmd of FLAG_BOUNDARY_OVERHIT) {
      expect(judgeChain(RULES, "run_shell", cmd).verdict, cmd).not.toBe("deny");
    }
  });

  it("边界收紧不许顺手放宽：命中处右邻是行尾或空白都算命中", () => {
    for (const cmd of BOUNDARY_MUST_STAY_DENY) {
      expect(judgeChain(RULES, "run_shell", cmd).verdict, cmd).toBe("deny");
      expect(at(evaluate("run_shell", { command: cmd }, session())), cmd).toBe("deny@L1-deny");
    }
  });

  it("卡面说得出是哪条规则、按什么匹配（用户据此才改得动自己的规则）", () => {
    const d = evaluate("run_shell", { command: "sudo git push --force" }, session());
    const reason = d.verdict === "deny" ? d.reason : "根本没被 deny（" + d.verdict + "）";
    expect(reason).toContain("deny:run_shell:git push --force");
    expect(reason, "只给 ruleId 时没人看得懂为什么被拦").toContain("匹配按完整 token 为界");
  });

  it("allow 侧同样讲边界（不对称的是形态面，不是边界）：「allow git status」不覆盖 `git status-bar`", () => {
    const rules = parsePermissionsFile(
      JSON.stringify({ rules: [{ behavior: "allow", tool: "run_shell", pattern: "git status", scope: "always" }] }),
      "test",
    );
    expect(judgeChain(rules, "run_shell", "git status").verdict).toBe("allow");
    expect(judgeChain(rules, "run_shell", "git status-bar").verdict).toBe("miss");
  });

  it("漏判侧仍留账：`git push -f` / `--f` 今天不进 L1-deny（要收它得建别名表，另裁）", () => {
    for (const cmd of FLAG_UNDERHIT) expect(judgeChain(RULES, "run_shell", cmd).verdict, cmd).toBe("miss");
  });

  it("worker 侧不受本裁影响：push 根本不是只读子命令，两侧都拦", () => {
    for (const cmd of [...FLAG_UNDERHIT, ...FLAG_BOUNDARY_OVERHIT, ...BOUNDARY_MUST_STAY_DENY]) {
      expect(interceptDestructiveGit(cmd).ok, cmd).toBe(false);
    }
  });
});

/* ---------------- ⑥ 前缀词族（09-22 按位置扫写法扫出来） ----------------
   `eval` / `xargs` / `time` 自己不动执行，但**余下的 token 才是真命令**。修前两支面全漏
   （规则层 approve@L4-pass、worker 闸也放行）——同一份解析的两个消费者一起漏，
   正是把解析收成一份之后才看得见的形状。 */
describe("⑥ 前缀词：eval / xargs / time 后面才是真命令", () => {
  it("九支写法两支面都拦（含叠套 `sudo time xargs git …` 与引号载荷）", () => {
    for (const cmd of PREFIX_WORD_VARIANTS) {
      expect(at(evaluate("run_shell", { command: cmd }, session())), cmd).toBe("deny@L1-deny");
      expect(interceptDestructiveGit(cmd).ok, cmd).toBe(false);
    }
  });

  it("负控：这些词当**参数**、或命令本身跑不成时，不许被 deny 牵连", () => {
    for (const cmd of PREFIX_WORD_MUST_STAY_CLEAN) {
      expect(judgeChain(RULES, "run_shell", cmd).verdict, cmd).not.toBe("deny");
    }
  });

  it("`time -p` 的 `-p` 是布尔开关：登记成带值就会把 git 当值吞掉（实测两支一起放行）", () => {
    expect(commandForms("time -p git push --force")).toContain("git push --force");
    expect(invocations("time -p git push --force").map((i) => i.bin)).toContain("git");
  });
});

/* ---------------- 已知边界：未知前缀词（未裁） ----------------
   第二轮按位置扫写法扫出 15 个仍漏的前缀词（setsid / ionice / stdbuf / chrt / pkexec / doas /
   unshare / flock / taskset / prlimit / strace / watch / script / busybox / sudoedit）。
   **按名字往白名单里加词不是收口**：这族是无穷的（每层容器与调度器再加几个）。
   下面钉的是现状——谁改成结构性判据（⑦ 文档里量过的候选 A「任意位置起后缀」/
   候选 B「词按序出现即可」），这两条必须一起翻，改动就会逼出那次裁决而不是悄悄发生。 */
describe("已知边界：未知前缀词仍漏（枚举不完，未裁）", () => {
  it("15 支今天全 miss（逐个加进 EXEC_WRAPPERS 不算收口）", () => {
    expect(UNBOUNDED_PREFIX_WORDS.length).toBe(15);
    for (const cmd of UNBOUNDED_PREFIX_WORDS) {
      expect(judgeChain(RULES, "run_shell", cmd).verdict, cmd).toBe("miss");
    }
  });

  it("对照：结构性面（载荷递归 / 链式段）不按词登记也能命中——这才是要往哪走的方向", () => {
    for (const cmd of STRUCTURE_ALREADY_COVERS) {
      expect(judgeChain(RULES, "run_shell", cmd).verdict, cmd).toBe("deny");
    }
  });
});

/* ---------------- 已知边界 ⑧：中间插参数（量 ⑦ 候选时顺出的新账，未裁） ----------------
   ⑤ 的 `suffixForms` 只把**全局选项**从前缀位置挪走，命中仍是整条 pattern 前缀匹配，
   所以「子命令与危险选项中间插了参数」照样漏——而 `git push origin --force` 是货真价实的强推。
   修它 = 把匹配从「前缀」换成「按序子序列」（候选 B），与 ⑦ 是同一次语义裁决，所以不单向改实现。
   worker 那一支按 args[0] 取子命令、push 非只读 ⇒ fail-closed 一直拦得住（同 ⑤ 的格局）。 */
describe("已知边界：中间插参数（git push origin --force）仍漏（未裁）", () => {
  it("三支真强推今天不进 L1-deny", () => {
    for (const cmd of INSERTED_ARG_UNDERHIT) {
      expect(judgeChain(RULES, "run_shell", cmd).verdict, cmd).toBe("miss");
    }
  });

  it("worker 侧照旧拦得住（fail-closed，不是因为它更聪明）", () => {
    for (const cmd of INSERTED_ARG_UNDERHIT) expect(interceptDestructiveGit(cmd).ok, cmd).toBe(false);
  });
});
