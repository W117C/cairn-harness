// 信任键的形状：**(repoDir, verify 面内容) → 那份现成的信任表**，首次经审批卡问人，同指纹之后免问。
//
// 断在哪一环（现读，不是推断）：`src/main/agent-runner.ts` 的三处装配点传的是**常量** `trustedRepo ?? false`，
// 而生产入口没有任何地方能把它置真 ⇒ `src/agent/verify.ts` 的 `surface()` 恒 false ⇒
// 缺省开着的自动验证拍整段跳过（48 份日志里 `verify_result{auto:true}` 0 条）。
//
// 这一组全钉**行为**，一条文案都不钉：
//  · 正证人 = 注入执行器被叫到的那份命令清单 / 靶子文件真被写出来（否则「一律拒绝」也是绿的）；
//  · 反证人 = 执行器零调用、信任表零条目、事件面 `cause:"skipped"`（`#93` 那只第三结局，判据只住
//    `verify.ts` 的 `verifyOutcomeCause` 一处，本文件只消费它，不再判一遍「什么算跳过」）；
//  · 内容指纹的存在理由 = ③（命令面被改 ⇒ 必须重新问）与 ③b（同内容换个写法 ⇒ 不许再问）。
//
// 复用的信任表：`src/agent/plugins/trust.ts` 的 `TrustStore`（`status` / `decide`，条目形状 `abs@指纹`），
// 与插件 hook/MCP 走**同一个类、同一份文件**——本仓不许第二份信任事实源。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoop } from "../src/agent/loop";
import {
  createVerifyHook,
  loadVerifyConfig,
  verifyCommands,
  verifyOutcomeCause,
  type ExecFn,
  type VerifyHook,
} from "../src/agent/verify";
import { verifySurfaceFingerprint, verifyTrustKey, type VerifyTrustResolver } from "../src/agent/verify-trust";
import { TrustStore } from "../src/agent/plugins/trust";
import { workerVerificationEvidence } from "../src/agent/worker-report";
import { isEnvVerifyCause, replay, type AgentEvent, type VerifyResultEvent } from "../src/events";
import { AskGate, type AskRequest } from "../src/main/ask-gate";
import { createVerifyTrustGate, VERIFY_TRUST_CARD } from "../src/main/verify-trust-gate";
import { handleAgentRun, initSessionsDir, initSettingsStore, runAgent } from "../src/main/agent-runner";

type Answer = "approve" | "deny" | "no-answer" | "unattended" | "no-gate";

interface Rig {
  dir: string;
  /** 宿主侧那份信任表：判卷把它放在仓库目录**之外**，免得它自己混进 verify 面。 */
  trustFile: string;
  cards: AskRequest[];
  gates: AskGate[];
  /** 一场 run 一个 resolver（与 agent-runner 的接线同形：门与信任表都由 run 递进来）。 */
  resolverFor(answer: Answer, timeoutMs?: number): VerifyTrustResolver;
  /** 现读那面的内容指纹（与实现同一只纯函数，但由判卷自己算一遍，用作条目的期望键）。 */
  fingerprintOf(repoDir: string): Promise<string>;
  writeSurface(repoDir: string, config: string): Promise<void>;
  /** 读**盘上那份文件**，不读实现的内存。 */
  entries(): Promise<{ trusted: string[]; declined: string[] }>;
}

const TEST_CMD = "printf TEST > test-ran";
const LINT_CMD = "printf LINT > lint-ran";
const CHANGED_CMD = "printf TEST2 > test-ran-2";

let rig: Rig;
let repo = "";
let worktree = "";

/** 注入式执行器：正/反正人就是一个计数与被叫到的命令清单，不真跑进程。 */
function spyExec(): { exec: ExecFn; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    exec: async (command) => {
      seen.push(command);
      return { command, ok: true, output: "", exitCode: 0 };
    },
  };
}

/** 模型自调 verify 的那一拍（手动拍）——真实 loop 出口，不是手搭 outcome。 */
async function runManual(hook: VerifyHook): Promise<AgentEvent[]> {
  const log: AgentEvent[] = [];
  let turn = 0;
  await runLoop({
    workspace: "/tmp",
    events: { async append(e) { log.push(e); } },
    tools: {},
    provider: {
      async *stream() {
        turn += 1;
        yield { type: "tool_call", id: "v" + String(turn), name: "verify", args: {} };
      },
    },
    verify: hook,
  });
  return log;
}

const beatsOf = (log: AgentEvent[]): VerifyResultEvent[] =>
  log.filter((e): e is VerifyResultEvent => e.type === "verify_result");
const autoBeatsOf = (log: AgentEvent[]): VerifyResultEvent[] => beatsOf(log).filter((e) => e.auto === true);

async function setup(): Promise<Rig> {
  const dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "verify-trust-fp-"));
  await mkdir(join(dir, "host"), { recursive: true });
  const trustFile = join(dir, "host", "plugin-trust.json");
  const cards: AskRequest[] = [];
  const gates: AskGate[] = [];
  const rig: Rig = {
    dir,
    trustFile,
    cards,
    gates,
    resolverFor(answer: Answer, timeoutMs = 5) {
      let gate: AskGate | null = null;
      if (answer !== "no-gate") {
        gate =
          answer === "unattended"
            ? new AskGate({ unattended: true, notify: (req) => cards.push(req) })
            : new AskGate({
                timeoutMs,
                // 「无应答」= notify 一到什么都不做 ⇒ 由门的超时收（fail-closed，不悬着）。
                notify: (req) => {
                  cards.push(req);
                  if (answer === "approve") gate!.decide(req.askId, true);
                  if (answer === "deny") gate!.decide(req.askId, false);
                },
              });
        gates.push(gate);
      }
      return createVerifyTrustGate({
        trustStore: new TrustStore(trustFile),
        askGate: gate,
        ...(answer === "unattended" ? { unattended: true } : {}),
      });
    },
    async fingerprintOf(repoDir: string) {
      const { config, source } = await loadVerifyConfig(repoDir);
      return verifySurfaceFingerprint(config, source === "config" ? "repo-config" : "repo-probed");
    },
    async writeSurface(repoDir: string, config: string) {
      await writeFile(join(repoDir, ".agent", "config.json"), config, "utf8");
    },
    async entries() {
      try {
        const raw = JSON.parse(await readFile(trustFile, "utf8")) as { trusted?: string[]; declined?: string[] };
        return { trusted: raw.trusted ?? [], declined: raw.declined ?? [] };
      } catch {
        return { trusted: [], declined: [] };
      }
    },
  };
  return rig;
}

async function makeRepo(name: string, commands: string[]): Promise<string> {
  const dir = join(rig.dir, name);
  await mkdir(join(dir, ".agent"), { recursive: true });
  await rig.writeSurface(dir, JSON.stringify({ verify: { test: commands } }));
  return dir;
}

beforeEach(async () => {
  rig = await setup();
  repo = await makeRepo("repo", [TEST_CMD]);
  // worker 那一侧的 verify 面**内容逐字相同**，只有目录不同 —— ⑥ 的全部前提。
  worktree = await makeRepo("worktree", [TEST_CMD]);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(rig.dir, { recursive: true, force: true }).catch(() => {});
});

describe("①首次 + 批准 ⇒ 执行器真被叫到（正证人）", () => {
  it("批准的那一拍命令真的执行了，卡出在审批通道上，决议登记进了同一份信任表", async () => {
    const { exec, seen } = spyExec();
    const out = await createVerifyHook(repo, { exec, trustResolver: rig.resolverFor("approve") }).run();
    expect(seen, "批准了却没执行 —— 这一格的正证人失效").toEqual([TEST_CMD]);
    expect(out.ok).toBe(true);
    expect(out.skipped, "批准的那一拍不许带拒因").toBeUndefined();
    expect(rig.cards.length, "首次没有出审批卡（问人这一环没接上）").toBe(1);
    expect(rig.cards[0]!.tool).toBe(VERIFY_TRUST_CARD);
    expect(rig.cards[0]!.args.repoDir, "卡上没带是哪个仓 ⇒ 人不知道自己在批什么").toBe(repo);
    expect((rig.cards[0]!.args.commands as readonly string[])).toEqual([TEST_CMD]);
    expect((await rig.entries()).trusted).toEqual([verifyTrustKey(repo) + "@" + (await rig.fingerprintOf(repo))]);
    expect((await rig.entries()).declined).toEqual([]);
  });

  it("surface() 读同一张表：批过之后自动补拍那一段不再被整段跳过", async () => {
    const hook = createVerifyHook(repo, { exec: spyExec().exec, trustResolver: rig.resolverFor("approve") });
    expect(await hook.surface?.(), "批过之后 surface() 仍判 false ⇒ 闭环第三环还是断的").toBe(true);
  });
});

describe("②首次 + 拒／无应答 ⇒ 不跑、不记账、证据不落 failed", () => {
  it.each([["拒"], ["无应答（门超时）"], ["非交互无门"]] as const)("%s：执行器零调用、信任表零条目", async (arm) => {
    const answer: Answer = arm === "拒" ? "deny" : arm === "无应答（门超时）" ? "no-answer" : "no-gate";
    const { exec, seen } = spyExec();
    const out = await createVerifyHook(repo, { exec, trustResolver: rig.resolverFor(answer) }).run();
    expect(seen, "未获批准却执行了仓库自带的命令 —— 信任闸被绕过").toEqual([]);
    expect(out.results).toEqual([]);
    expect(out.ok).toBe(false);
    expect(out.skipped, "被拒那一拍必须给出拒因（第三结局的凭据）").toBeTruthy();
    const entries = await rig.entries();
    expect(entries.trusted, "没有人批准却写了信任条目").toEqual([]);
    expect(entries.declined, "无人应答／取消不是人的决议，不许写成永久拒绝（那样以后想批也无处批）").toEqual([]);
  });

  it("被拒那一拍进事件流的是 skipped（环境类），不是「跑了且红」", async () => {
    const hook = createVerifyHook(repo, { exec: spyExec().exec, trustResolver: rig.resolverFor("deny") });
    const out = await hook.run();
    expect(verifyOutcomeCause(out, null)).toBe("skipped");
    expect(isEnvVerifyCause(verifyOutcomeCause(out, null)), "被拒那一拍不许记在模型账上").toBe(true);
    const log = await runManual(hook);
    const beats = beatsOf(log);
    expect(beats.length).toBeGreaterThan(0);
    expect(beats.every((e) => e.cause === "skipped")).toBe(true);
    expect(workerVerificationEvidence(log), "被拒那一拍不许把客观证据判成 failed").toBe("absent");
  });
});

describe("③verify 面内容变了 ⇒ 必须重新问一次（内容指纹的存在理由）", () => {
  it("改过 test 命令之后同目录再问一次，且新面没批过就跑不起来", async () => {
    const first = spyExec();
    await createVerifyHook(repo, { exec: first.exec, trustResolver: rig.resolverFor("approve") }).run();
    expect(first.seen).toEqual([TEST_CMD]);
    expect(rig.cards.length).toBe(1);

    await rig.writeSurface(repo, JSON.stringify({ verify: { test: [CHANGED_CMD] } }));
    const second = spyExec();
    const out = await createVerifyHook(repo, { exec: second.exec, trustResolver: rig.resolverFor("deny") }).run();
    expect(rig.cards.length, "内容变了却没有重新问 —— 指纹没把命令面算进键").toBe(2);
    expect(second.seen, "新命令面没批过就执行了").toEqual([]);
    expect(out.skipped).toBeTruthy();

    // 正向半边：新面被批准之后跑得起来 —— 否则上面那条反证是恒真。
    const third = spyExec();
    await createVerifyHook(repo, { exec: third.exec, trustResolver: rig.resolverFor("approve") }).run();
    expect(third.seen, "重新问了也没换来新面的执行通道").toEqual([CHANGED_CMD]);
    expect(rig.cards.length).toBe(3);
    expect((await rig.entries()).trusted.length, "两个内容各一条决议（不是同一条被复用）").toBe(2);
  });

  it("指纹随内容走、不随写法走：换行/换键序不再问，换来源再问", async () => {
    await rig.writeSurface(repo, JSON.stringify({ verify: { lint: [LINT_CMD], test: [TEST_CMD] } }));
    const before = await rig.fingerprintOf(repo);
    // 同一批命令换个 JSON 写法（键序颠倒 + 缩进换行）⇒ 面内容等价 ⇒ 指纹逐字不变 ⇒ 不再问。
    await writeFile(
      join(repo, ".agent", "config.json"),
      '{\n  "verify": {\n    "test": ["' + TEST_CMD + '"],\n    "lint": ["' + LINT_CMD + '"]\n  }\n}\n',
      "utf8",
    );
    expect(verifyCommands((await loadVerifyConfig(repo)).config).sort()).toEqual([LINT_CMD, TEST_CMD].sort());
    expect(await rig.fingerprintOf(repo), "内容等价而指纹变了 ⇒ 问的是写法不是内容").toBe(before);

    const approved = spyExec();
    await createVerifyHook(repo, { exec: approved.exec, trustResolver: rig.resolverFor("approve") }).run();
    expect(approved.seen, "首问批准之后这一面就该跑得起来").toEqual([LINT_CMD, TEST_CMD]);
    expect(rig.cards.length).toBe(1);

    const cardsAfterApproval = rig.cards.length;
    const probe = spyExec();
    // 门给的是 no-gate：免问那条路必须**只靠表**走通，走不通就是白问（或白拒）。
    await createVerifyHook(repo, { exec: probe.exec, trustResolver: rig.resolverFor("no-gate") }).run();
    expect(rig.cards.length, "换个写法就重新问一次（指纹把格式当成了内容）").toBe(cardsAfterApproval);
    expect(probe.seen, "内容等价的改写让免问失效 ⇒ 键吃的是字节不是内容").toEqual([LINT_CMD, TEST_CMD]);

    // 反向：同内容换个**来源**（config.json 撤掉、换成 package.json 探测面）⇒ 面内容不同 ⇒ 重新问。
    await rm(join(repo, ".agent", "config.json"), { force: true });
    await writeFile(join(repo, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }), "utf8");
    expect(await rig.fingerprintOf(repo)).not.toBe(before);
    const cardsBeforeSourceSwitch = rig.cards.length;
    await createVerifyHook(repo, { exec: spyExec().exec, trustResolver: rig.resolverFor("deny") }).run();
    expect(rig.cards.length, "来源换了却没重新问").toBe(cardsBeforeSourceSwitch + 1);
  });
});

describe("④同指纹第二次 ⇒ 不再问（免问的证人）", () => {
  it("批准过一次之后，全新钩子＋全新信任表实例读同一份文件 ⇒ 零新卡且仍然真跑", async () => {
    const first = spyExec();
    await createVerifyHook(repo, { exec: first.exec, trustResolver: rig.resolverFor("approve") }).run();
    expect(rig.cards.length).toBe(1);

    const second = spyExec();
    // 门给的是 no-gate：这一支证的正是「免问读的是表，不是门的内存状态」。
    const hook2 = createVerifyHook(repo, { exec: second.exec, trustResolver: rig.resolverFor("no-gate") });
    expect(await hook2.surface?.()).toBe(true);
    await hook2.run();
    expect(rig.cards.length, "同指纹第二次又出了一张卡 —— 免问没生效").toBe(1);
    expect(second.seen, "免问之后就不跑了 ⇒ 表里那条批准没被兑现").toEqual([TEST_CMD]);
    expect((await rig.entries()).trusted.length).toBe(1);
    expect(rig.gates.every((g) => g.pendingCount === 0)).toBe(true);
  });

  it("条目真的绑住了目录与内容：换目录、换内容都命中不上", async () => {
    await createVerifyHook(repo, { exec: spyExec().exec, trustResolver: rig.resolverFor("approve") }).run();
    const store = new TrustStore(rig.trustFile);
    const fp = await rig.fingerprintOf(repo);
    expect(await store.status(verifyTrustKey(repo), fp)).toBe("trusted");
    expect(await store.status(verifyTrustKey(worktree), fp), "换个目录就免问 ⇒ 键没绑住 repoDir").toBe("pending");
    const altered = fp.slice(0, 8) + "0".repeat(24);
    expect(await store.status(verifyTrustKey(repo), altered), "换个内容就免问 ⇒ 键没绑住面内容").toBe("pending");
  });

  it("旧版插件信任留下的**裸路径**条目顶不掉这一门（键域标签不是装饰）", async () => {
    // `TrustStore.hit` 有一条明文备案的兼容：无 `@指纹` 的裸路径条目仍能命中无界条目。
    // 那条是给插件历史留的。若 verify 的条目也用裸路径，一条「曾经把某个目录当插件批过」的历史
    // 记录就会顺带免掉仓库自带命令的问 —— 所以第一维带域标签。这一格钉的就是它没被顶包。
    const { config } = await loadVerifyConfig(repo);
    const fp = verifySurfaceFingerprint(config, "repo-config");
    await writeFile(rig.trustFile, JSON.stringify({ trusted: [repo], declined: [] }), "utf8");
    const store = new TrustStore(rig.trustFile);
    expect(await store.status(repo, fp), "前提不成立：裸路径条目本身在兼容面里就该命中（否则下面那条是恒真）").toBe("trusted");

    const probe = spyExec();
    await createVerifyHook(repo, { exec: probe.exec, trustResolver: rig.resolverFor("deny") }).run();
    expect(rig.cards.length, "历史裸路径条目免掉了这一问 ⇒ 域标签没生效").toBe(1);
    expect(probe.seen, "被一条不是给这一门写的记录放了行").toEqual([]);
  });
});

describe("⑤无人值守那条路 ⇒ 不悬挂、按既有 fail-closed 收", () => {
  it("unattended：一张卡都不发、pending 为零、不跑、不记账，surface() 判无面", async () => {
    const resolver = rig.resolverFor("unattended");
    const hook = createVerifyHook(repo, { exec: spyExec().exec, trustResolver: resolver });
    const out = await hook.run();
    expect(rig.cards, "无人值守还发了一张没人能接的卡").toEqual([]);
    expect(rig.gates.every((g) => g.pendingCount === 0), "审批悬在 pending 里没人收").toBe(true);
    expect(out.skipped).toBeTruthy();
    expect((await rig.entries()).trusted).toEqual([]);
    expect(await hook.surface?.(), "无人值守时 surface() 不许判成有面").toBe(false);
  });

  it("同一次 run 里同一面只问一次：自动拍的 surface() + run() 不出两张同样的卡", async () => {
    const hook = createVerifyHook(repo, { exec: spyExec().exec, trustResolver: rig.resolverFor("no-answer") });
    expect(await hook.surface?.()).toBe(false);
    await hook.run();
    expect(rig.cards.length, "同一拍问了两次（两张同样的卡 / 两次悬等）").toBe(1);
    expect(rig.gates.every((g) => g.pendingCount === 0)).toBe(true);
  });

  it("同一次 run 里批准过一次也不再问第二遍（正半边：上面那条不是只给拒绝写的）", async () => {
    const hook = createVerifyHook(repo, { exec: spyExec().exec, trustResolver: rig.resolverFor("approve") });
    expect(await hook.surface?.()).toBe(true);
    await hook.run();
    expect(rig.cards.length).toBe(1);
  });

  it("无人值守那道闸住在这一门里：门被配成可答的交互门也不发卡、不悬等、不记账", async () => {
    // 生产的缺省配对是 unattended ⇔ unattendedAskGate（agent-runner.ts 那条 askGate 三元）。
    // 这一格钉的是**第二道闸**：配对出错（或被绕过）时也不许在没人接的通道上悬一张卡，
    // 否则「沿用现有 fail-closed 收法」就只是隔壁那行构造的副产品。
    const gate = new AskGate({ timeoutMs: 5, notify: (req) => rig.cards.push(req) });
    const { exec, seen } = spyExec();
    const out = await createVerifyHook(repo, {
      exec,
      trustResolver: createVerifyTrustGate({ trustStore: new TrustStore(rig.trustFile), askGate: gate, unattended: true }),
    }).run();
    expect(rig.cards, "配到一张能答的门就发卡 ⇒ 无人值守那条路悬等人").toEqual([]);
    expect(gate.pendingCount, "审批悬在 pending 里没人收").toBe(0);
    expect(seen).toEqual([]);
    expect(out.skipped).toBeTruthy();
    expect((await rig.entries()).trusted).toEqual([]);
  });
});

describe("⑥worker 那一侧：不继承父会话的「批过一次」（谁的执行体谁被问）", () => {
  it("父目录批准 ⇒ worker 目录（面内容逐字相同、目录不同）仍然不免问，也不许替父的批准跑起来", async () => {
    const parent = spyExec();
    await createVerifyHook(repo, { exec: parent.exec, trustResolver: rig.resolverFor("approve") }).run();
    expect(parent.seen).toEqual([TEST_CMD]);
    const cardsFromParent = rig.cards.length;

    const worker = spyExec();
    const out = await createVerifyHook(worktree, { exec: worker.exec, trustResolver: rig.resolverFor("deny") }).run();
    expect(rig.cards.length, "worker 那一侧被父会话的批准顶掉了（没有独立一问）").toBe(cardsFromParent + 1);
    expect(worker.seen, "worker 的执行体没被问过就跑了命令").toEqual([]);
    expect(out.skipped).toBeTruthy();

    // 正向半边：worker 自己那一问被批准之后就跑得起来 —— 证明上面那条不是恒真。
    const worker2 = spyExec();
    await createVerifyHook(worktree, { exec: worker2.exec, trustResolver: rig.resolverFor("approve") }).run();
    expect(worker2.seen).toEqual([TEST_CMD]);
    expect((await rig.entries()).trusted.length, "两个执行体各一条决议，不是父那条被复用").toBe(2);
  });

  it("刻意不做的口径写死：本笔不给 worker 加任何继承通道 ⇒ 父批过的指纹对 worker 一律不命中", async () => {
    await createVerifyHook(repo, { exec: spyExec().exec, trustResolver: rig.resolverFor("approve") }).run();
    const store = new TrustStore(rig.trustFile);
    const fp = await rig.fingerprintOf(worktree);
    expect(await rig.fingerprintOf(repo), "两面的内容必须逐字相同，否则这一格测的是别的东西").toBe(fp);
    expect(await store.status(verifyTrustKey(worktree), fp)).toBe("pending");
    expect(await store.status(verifyTrustKey(repo), fp)).toBe("trusted");
  });
});

describe("⑦生产装配：runAgent 不再吃常量 false（缺省开着的自动验证拍真能跑起来）", () => {
  let seq = 0;

  const WRITE = { type: "tool_call", id: "w1", name: "write_file", args: { path: "target.txt", content: "changed\n" } };
  const TEXT = { type: "assistant_message", content: "改完了。" };

  async function script(lines: unknown[]): Promise<string> {
    const path = join(rig.dir, `script-${String(seq++)}.jsonl`);
    await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
    return path;
  }

  /** 剧本 / provider / 插件数据面全部指进本用例的临时目录（判卷数据不落工作区，也不落隔壁那把表）。 */
  beforeEach(async () => {
    vi.stubEnv("M3A_MAIN_SCRIPT", await script([WRITE, TEXT]));
    vi.stubEnv("M0A_PROVIDER", "mock");
    vi.stubEnv("M1E_SAFE_MODE", "off");
    vi.stubEnv("DSH_APPDATA", rig.dir);
    vi.stubEnv("M2E_USER_PLUGINS", join(rig.dir, "plugins"));
    vi.stubEnv("M2E_LOOSE_SKILLS", join(rig.dir, "skills"));
    vi.stubEnv("M2E_PLUGIN_DATA", join(rig.dir, "plugin-data"));
    vi.stubEnv("M2E_TRUST_FILE", rig.trustFile);
    initSettingsStore(join(rig.dir, "settings.json"));
    initSessionsDir(join(rig.dir, "sessions"));
  });

  it("首次那张卡被批准 ⇒ 那一拍真发生且仓库自带的命令真跑（常量 false 时代永远到不了这里）", async () => {
    const gate = new AskGate({ timeoutMs: 1_000, notify: (req) => { rig.cards.push(req); gate.decide(req.askId, true); } });
    const events = await runAgent({
      workspace: repo,
      logPath: join(rig.dir, `events-${String(seq++)}.jsonl`),
      message: "改一下 target",
      mode: "auto",
      autoVerify: true,
      askGate: gate,
      sandbox: null,
    });
    expect(rig.cards.length, "生产装配没把审批卡接上（首次没问人）").toBe(1);
    expect(rig.cards[0]!.tool).toBe(VERIFY_TRUST_CARD);
    const beats = autoBeatsOf(events);
    expect(beats.length, "批过之后自动验证拍仍然没发生 ⇒ 接线还在常量 false").toBe(1);
    expect(beats[0]!.ok).toBe(true);
    expect(await readFile(join(repo, "test-ran"), "utf8")).toBe("TEST");
    expect((await rig.entries()).trusted.length).toBe(1);
  });

  it("那张批准落在**插件信任那一份文件**里（一把表两个门；没有 M2E_TRUST_FILE 时走 pluginDataRoot）", async () => {
    vi.stubEnv("M2E_TRUST_FILE", ""); // 空串 = pluginRuntimeOpts 不收这个键 ⇒ 回到缺省派生
    const gate = new AskGate({ timeoutMs: 1_000, notify: (req) => { rig.cards.push(req); gate.decide(req.askId, true); } });
    await runAgent({
      workspace: repo,
      logPath: join(rig.dir, `events-${String(seq++)}.jsonl`),
      message: "改一下 target",
      mode: "auto",
      autoVerify: true,
      askGate: gate,
      sandbox: null,
    });
    const sameFile = join(rig.dir, "plugin-data", "plugin-trust.json");
    const raw = JSON.parse(await readFile(sameFile, "utf8")) as { trusted?: string[] };
    expect(raw.trusted, "verify 的决议写进了另一个文件 ⇒ 场上有两份信任事实源").toEqual([
      verifyTrustKey(repo) + "@" + (await rig.fingerprintOf(repo)),
    ]);
  });

  it("首次那张卡被拒 ⇒ 那一拍不发生（不假绿也不假红）、命令没跑、条目没写", async () => {
    const gate = new AskGate({ timeoutMs: 1_000, notify: (req) => { rig.cards.push(req); gate.decide(req.askId, false); } });
    const events = await runAgent({
      workspace: repo,
      logPath: join(rig.dir, `events-${String(seq++)}.jsonl`),
      message: "改一下 target",
      mode: "auto",
      autoVerify: true,
      askGate: gate,
      sandbox: null,
    });
    expect(rig.cards.length).toBe(1);
    expect(autoBeatsOf(events).length, "被拒那一拍不该产出一条 verify 证据（第三结局住在 run()，自动拍这一侧是整段跳过）").toBe(0);
    expect(beatsOf(events).length).toBe(0);
    expect(await readFile(join(repo, "test-ran"), "utf8").catch(() => null), "没批却执行了仓库命令").toBeNull();
    expect((await rig.entries()).trusted).toEqual([]);
    expect(await readFile(join(repo, "target.txt"), "utf8")).toBe("changed\n"); // 写本身照样成功：拒的是 verify，不是任务
  });

  it("生产入口 handleAgentRun + 无人值守 ⇒ 不发卡、不悬等、那一拍不跑仓库命令（写照样成功）", async () => {
    await writeFile(
      join(repo, ".agent", "permissions.json"),
      JSON.stringify({ rules: [{ behavior: "allow", tool: "write_file", scope: "always" }] }),
      "utf8",
    );
    const logPath = join(rig.dir, `events-${String(seq++)}.jsonl`);
    const res = await handleAgentRun({ message: "改一下 target", mode: "auto" }, { workspace: repo, logPath, unattended: true });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const events = await replay(logPath);
    expect(rig.cards, "无人值守那条路不许发卡").toEqual([]);
    expect(await readFile(join(repo, "target.txt"), "utf8"), "写面不许被这波改动带坏").toBe("changed\n");
    expect(autoBeatsOf(events).length, "无人值守没批条 ⇒ 那一拍整段跳过").toBe(0);
    expect(await readFile(join(repo, "test-ran"), "utf8").catch(() => null)).toBeNull();
    expect((await rig.entries()).trusted).toEqual([]);
  });
});
