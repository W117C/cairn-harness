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
    // 上面那条**拦不住**「去掉换行归一化」这个突变（09-22 全表跑实测存活）：`git push` 里的
    // `push` 在破坏动词表内，⑩ 的按序面（扫本段独立 `git` 词）不改归一化也照样拦。
    // 真正只由「先归一化再切段」这一支撑住的是**表外但非只读**的动词：切出 `git fsck` 段后
    // `inv.bin === "git"` 成立、`fsck` 不在只读白名单 ⇒ 拒。少这一条，那条锚点就是假覆盖。
    expect(interceptDestructiveGit("echo hi\ngit fsck").ok).toBe(false);
    // 成对的放行侧（同一段落里的表外动词，未知首词 + 无换行 ⇒ ⑩ 与切段都不认它）：
    // 这条突变前后都是 true，它钉的是「别用全拦来把上面那条做绿」。
    expect(interceptDestructiveGit("echo hi git fsck").ok).toBe(true);
  });

  it("拦下来要说得出为什么、放行什么（worker 无合并权，reason 是用户唯一的解释面）", () => {
    const cmd = "git reset --hard";
    const blocked = interceptDestructiveGit(cmd);
    expect(blocked.ok).toBe(false);
    // 卡面必须点名被拦的那一支 ⇒ 收**从输入派生**的值，不收字面量：生产侧那句是
    // `` `git ${sub} 被拦截（…）` `` 的插值，写字面量 "git reset" 等于让任何含 git/reset 的句子替它作证
    // （第 96 页实测：这把尺给它算出 60 处副本）。真正在生产文案里的话由下一条钉。
    const named = cmd.slice(0, cmd.indexOf(" --"));
    expect(blocked.why).toContain(named);
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

/* ---------------- ⑦ 的历史块已并入 ⑩（09-22 裁决后翻成期望） ---------------- */

/* ---------------- ⑩ ⑦/⑧ 落地（09-22 已裁：按序子序列 + 未知首词降 ask） ----------------
   裁决取的是「B（pattern 的词按序出现即可命中）+ 后果分级」：
   ⑴ 命中处**开头就是那条命令自己**（`git push origin --force` 一族的 ⑧）⇒ 规则照原样生效，deny 仍绝对；
   ⑵ 命中的词**躲在一个不认识的头部 token 后面**（setsid / ionice / pkexec / script …）⇒ 不静默拒绝、
      也不静默放行，而是**出卡**。理由：区分「这些词是命令」与「这些词是被 echo 出去的文本」的唯一事实
      是首词会不会被执行，而那仍需一张表（结构性判据只是把表从「包装器名」挪到「可执行名」）——
      既然判不准，就把决定权交回用户，代价写进卡面。
   allow 侧一条字未动：只吃原形，按序形态一律不吃（不对称的是形态面）。 */
describe("⑩ 未知前缀词降为必问、中间插参数照原样 deny", () => {
  it("⑦ 那 15 支：不再静默放行，改由 L2 出卡（deny 命中但首词不认识）", () => {
    expect(UNBOUNDED_PREFIX_WORDS.length).toBe(15);
    for (const cmd of UNBOUNDED_PREFIX_WORDS) {
      expect(at(evaluate("run_shell", { command: cmd }, session())), cmd).toBe("ask@L2-ask-rule");
    }
  });

  it("卡面说得出为什么不是 deny：首词不在已知包装器表里", () => {
    const d = evaluate("run_shell", { command: "setsid git push --force" }, session());
    const reason = d.verdict === "ask" ? d.reason : "没出卡（" + d.verdict + "）";
    expect(reason).toContain("setsid");
    expect(reason, "降级的根据必须写在卡上，否则用户以为自己写了 deny 就被禁了").toContain("首词");
  });

  it("⑧ 那三支真强推：首词就是 git ⇒ 按序命中也照原样 deny，不降级", () => {
    for (const cmd of INSERTED_ARG_UNDERHIT) {
      expect(at(evaluate("run_shell", { command: cmd }, session())), cmd).toBe("deny@L1-deny");
    }
  });

  it("代价要看得见：`echo xargs git push --force` 这类文本参数被牵连，但牵连成 ask 不是 deny", () => {
    for (const cmd of ["echo xargs git push --force", "echo git push --force"]) {
      expect(at(evaluate("run_shell", { command: cmd }, session())), cmd).toBe("ask@L2-ask-rule");
    }
    // 带引号的载荷是一个 token，按序匹配吃不到它（牵连面到此为止）
    for (const cmd of ["echo 'git push --force'", "git commit -m 'git push --force 已禁用'"]) {
      expect(judgeChain(RULES, "run_shell", cmd).verdict, cmd).toBe("miss");
    }
  });

  it("allow 侧不吃按序形态：「allow git push origin」不放行 `git push --force origin`", () => {
    const rules = parsePermissionsFile(
      JSON.stringify({ rules: [{ behavior: "allow", tool: "run_shell", pattern: "git push origin", scope: "always" }] }),
      "test",
    );
    expect(judgeChain(rules, "run_shell", "git push origin").verdict).toBe("allow");
    expect(judgeChain(rules, "run_shell", "git push --force origin").verdict).toBe("miss");
  });

  it("worker 那一支不受降级影响：push 非只读 ⇒ fail-closed 一直拦得住", () => {
    for (const cmd of [...INSERTED_ARG_UNDERHIT, ...UNBOUNDED_PREFIX_WORDS]) {
      expect(interceptDestructiveGit(cmd).ok, cmd).toBe(false);
    }
  });

  it("worker 侧那条界要钉住：只按破坏动词表拦藏在未知首词后面的调用，「git 只是个词」的写法留得住", () => {
    // 第一版按「非只读即拦」把下面三支惯用写法一起打死了（`grep -rn git src` 是最常见的那种），
    // 报代价时报小了；收窄成破坏动词表后：表外维持与修前相同的放行，表内的从静默放行变拦得住。
    for (const cmd of ["echo no git here", "grep -rn git src", "git status; echo -m git", "echo 'git push --force'"]) {
      expect(interceptDestructiveGit(cmd).ok, cmd).toBe(true);
    }
    for (const cmd of ["setsid git push --force", "unshare -n git push --force", "flock /tmp/l git reset --hard"]) {
      expect(interceptDestructiveGit(cmd).ok, cmd).toBe(false);
    }
  });

  it("既有绝对面不退让：已知包装器 / 结构性面（载荷递归、链式段）仍由 L1-deny 决定", () => {
    for (const cmd of [...DENY_VARIANTS, ...GLOBAL_OPT_VARIANTS, ...STRUCTURE_ALREADY_COVERS]) {
      expect(at(evaluate("run_shell", { command: cmd }, session())), cmd).toBe("deny@L1-deny");
    }
  });
});
