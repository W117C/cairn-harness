// 闭环评测（loop-eval）：把**生产那条会话装配**接到真模型上，逐维度量「感知 → 规划 → 执行 → 验证 → 修正」。
//
// 为什么另起一个而不是复用 ga-strategy / gate-check 暗卷：那两处各自手写了一段短系统提示
// （`scripts/gate-check.ts` 的 4 行 SYSTEM、`scripts/ga-strategy.ts` 的自带短串），并且都注明
// 「BASE_SYSTEM 住在 src/main/agent-runner.ts，纯 node 脚本 import 它会拉起 electron」——
// **这句前提是错的**（2026-09-20 实测：`src/main/agent-runner.ts` 不 import electron，
// `tests/base-system-discipline.test.ts` 一直在直接 import 它）。⇒ 六条纪律 + 编排段 + 机制边界
// 这套**真正发货给用户的提示词，从来没有在真模型上跑过一次**。本脚本就补这一跳。
//
// 纪律：
//  · 靶子一律 **拷进 mkdtemp** 再跑，绝不就地改 `fixtures/todo-app`（gate-check 就地改靶子是本仓已知污染）；
//  · 判卷合规：跑完比对副本 `tests/**` 与原目录逐字一致——模型越界改判卷面 = 用完成度换合规，单独记账；
//  · 读数一律并列「准确率」与「$/成功任务」，不报单边；n 由 --reps 控制，默认 1（只出单次读数，不宣称趋势）。
//
// 用法（凭据只走 env，不落文件）：
//   CAIRN_API_KEY=… CAIRN_ENDPOINT=https://…/chat/completions CAIRN_MODEL=… CAIRN_GLM_TOOL_STREAM=0 \
//   EVAL_PRICE_IN=<¥每百万输入> EVAL_PRICE_OUT=<¥每百万输出> \
//   node --import tsx scripts/loop-eval.ts [--only I1,I2] [--reps 1] [--max-steps 20] [--system base|short]
//   ↑ 那两个价**必须自己给、且必须是自己所拨档位的价**（端点目录价即可）。不给 ⇒ 钱这一格出「量不出来」，
//     跑器不再替任何人猜价（10-02 那次 36 趟拨的是免费档却按 0.8/2.8 印了「实付」，见 lib/eval-validity 的 priceFace）。
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { HARNESS_VERIFY_CALL_ID, runLoop } from "../src/agent/loop";
import { aggregateFeasibility, deriveVerifierProbe, feasibility, fromSweBenchJsonl, parseTaskSetJson, type EnvProbe, type TaskSpec } from "../src/agent/eval/task-set";
import { ClarifyGate, PlanGate } from "../src/agent/gates";
// 「这趟跑算不算数」——纯函数、可单测。分母口径见那边的模块头：
// **未起步 / 被 provider 打断的趟次不许进分母**（限流打断不能记成"模型没做到"）。
import { autoVerifyBeats, costSplit, moneyText, PRICE_UNKNOWN, priceFace, runValidity, tally, verifyBeatFace, verifyRecovery } from "./lib/eval-validity";
import type { VerifyRecovery } from "./lib/eval-validity";
// 逐名那一格的读者（第 416 页）：`TaskSpec.judge` 由数据层产出、`src/agent/eval/test-results` 负责解析与裁决，
// 这里只把**最后一次 verify 拍**的原文交给它并把裁决带回读数。跑器不认格式、不拼 pytest 命令行。
import { namedSetFailReason, readNamedSets, type NamedSetReading } from "./lib/eval-named-sets";
import type { NamedSetState } from "../src/agent/eval/test-results";
// 离线合成面的 provider（第 422 页）：靶场那套「按轮吐冻结剧本」的加载与切轮口径，一行都不重抄。
import { createRoundScriptedProvider } from "../src/agent/gym/script";
// 判据名 → 判定分支那张表（#35）：跑器只负责喂面，措辞与登记名由那份模块对齐。
import { expectFailReason, type ExpectFace } from "./lib/eval-expects";
// 重拨那一格：判据与分母共用同一个白名单（`providerInterruptOf`），等待有帽、帽外明说不重拨。
import { retryVerdict, withProviderRetry } from "./lib/eval-retry";
import { archiveExistingReadings } from "./lib/readings-archive";
// 失败轨迹留档（#109）：基准每 FAIL 一趟就把那份 `events.jsonl` 收进有帽的 dated 目录，
// 让 `scripts/gym-draft.ts`（能力 10「从失败轨迹中学习」既有的那一支取料口）吃得到它。
import { keepFailedTrace, traceKeepLine, TRACE_COUNT_CAP, TRACE_FILE_BYTES_CAP, TRACE_TOTAL_BYTES_CAP } from "./lib/failed-trace-keep";
import type { TraceKeepOutcome } from "./lib/failed-trace-keep";
// held-out 验收面：可见测试是任务书明写着要复现的那些 ⇒ 「哄绿它们」与「修对根因」同分。
// 隐藏测试在**改动清单算完之后**才装进副本，跑一次，判卷口径在那边（三种"量不出来"各给各的措辞）。
import { installHeldOut, judgeHeldOut, runHeldOut, type HeldOutRun, type HeldOutState } from "./lib/eval-heldout";
// 装配面登记：产品缺省开的每一枚开关，跑器这边必须说一句「装／不装／这格对我无意义」。
// 这张表存在的理由：`autoVerify`（能力 5 的收束闸）产品缺省开、基准不接，
// 于是盘上 49 趟跑批的 `autoVerifyBeat` 全 false——被读成「模型不自己验证」，其实是跑器没装这一环。
import { assemblyOverrides, assemblyRows, renderAssemblyFace, runLoopKnobsFromAssembly, undeclaredKnobs } from "./lib/eval-assembly";
import { DEFAULT_SETTINGS } from "../src/main/settings";

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
import { createVerifyHook, defaultExec, runVerifyOutcome, type ExecFn } from "../src/agent/verify";
// 用量归因走**生产那一份盖章器**（`createUsageAttributor` 的唯一调用点从前只有 agent-runner ⇒
// 基准路径绕过它，整条链上没有一笔 usage 带模型名，钱轴跨模型就无从分面）。
// 模型名取 `glmDefaultModelName()`：本跑器启动时已把 CAIRN_MODEL 归一成真正要拨的那一档，
// 所以这是同一个事实源，不是第三份 glm-5.2 字面量副本（同族出口那一族，规则里点过名）。
import { createUsageAttributor } from "../src/agent/usage-attribution";
import { glmDefaultModelName } from "../src/providers/glm";
import { createGlmSessionProvider, sessionToolSpecs } from "../src/agent/glm-session";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import { BASE_SYSTEM } from "../src/main/agent-runner";
import { stuckActionOf, stuckObservationOf } from "../src/agent/stuck";

const argv = process.argv.slice(2);
/** 取值旗标：**两种写法都收**（`--flag=值` 与 `--flag 值`）——与 `scripts/mutate-shards.ts` 同一条惯例。
 *  为什么补等号形（2026-10-13 第 470 页）：此前只认空格形 ⇒ `--arm=repair` 被**静默忽略**，
 *  那一批读数把对照臂记成了 `arm: base`（身份面因此少了一维、两副臂会被配成同一张脸），
 *  而命令行上没有任何出声。静默降级正是本仓最忌的形状：要么收下它，要么报错，不许装作没看见。 */
const pick = (flag: string, dflt: string): string => {
  const eq = flag + "=";
  const withEq = argv.find((a) => a.startsWith(eq));
  if (withEq !== undefined) return withEq.slice(eq.length);
  const i = argv.indexOf(flag);
  return i < 0 || argv[i + 1] === undefined ? dflt : String(argv[i + 1]);
};
const ROOT = process.cwd();
const APP = join(ROOT, "fixtures", "todo-app");
const BUG = join(ROOT, "fixtures", "mock", "todo-bug.ts");
const OUT = pick("--out", join("outputs", "loop-eval-" + new Date().toISOString().slice(0, 10)));
const MAX_STEPS = Number(pick("--max-steps", "20"));
const REPS = Number(pick("--reps", "1"));
const SYSTEM_MODE = pick("--system", "base");
/* `--keep` = 全量档（每一趟都留）。失败那一侧的留档**不靠它**（#109）：
 * bench 那四支脚本从不传 `--keep`，于是红轨迹跟着 mkdtemp 目录一起没，能力 10 在基准这一侧永远拿不到输入。
 * 现在 FAIL 默认有档、其余没有；`--keep` 在场时那一趟已经在产物目录根留下全量 ⇒ 不写第二份。 */
const KEEP_ALL = argv.includes("--keep");
/* 臂名（A/B 的那一副臂）。缺省落到 `SYSTEM_MODE`——同一份事实源，不另立第二处定义臂：
 * 存量跑法用 `--system` 区分 base/short，那本来就是在换臂；显式 `--arm` 只在其之上再贴一个更响的名字
 * （比如同一 system 下跑两副提示词变体）。它和 `reps`／`maxSteps` 一起进每条读数的身份键（#90），
 * 于是盘上两副不同臂的读数不再能假装同分母。 */
const ARM = pick("--arm", SYSTEM_MODE);
const ONLY = pick("--only", "").split(",").map((s) => s.trim()).filter(Boolean);

/* 装配面：产品缺省开的每一枚开关，这边都要有表态。
 *  `autoVerify`（能力 5 的收束闸）**缺省就装**——业主裁决（2026-10-05 第 403 页「先不花钱，只补装配那一半」）
 *  翻的是**装配**这一半：基准与产品同档，`autoVerifyBeat` 那一列从此不再结构性地恒 false。
 *  对照臂反过来写：`--no-auto-verify` 摘掉这一环。两臂的读数靠 `ASSEMBLY_FACE` 自带身份，不必猜。
 *  「装了闸之后再花一轮钱值不值」仍**没授权**：那一臂要一次带凭据的真跑，归用户裁，不由这把尺替用户翻。
 *  递进 `runLoop` 的键由**这张表投影**（`runLoopKnobsFromAssembly`），不另起一条 if：
 *  表和参数各算一次，表就成了注释——那正是 `autoVerifyBeat` 49 趟全 false 没被看见的原因。
 *  `--auto-verify-repair` 是第二拍（第一拍代码红且模型真改过盘 ⇒ 再验一次）：产品缺省关，
 *  所以它进表时记的是 `on-here`（"这副读数是对照臂"），而**有没有对象只看闸在不在**——
 *  配对规则判一次就够（在 `assemblyOverrides` 里），这边只负责把"带了但被忽略"说出来。
 *  有未表态的缺省开键 ⇒ **拒绝出数**（分母不完整时任何分数都是假的，与 `--tasks` 解析报错同一口径）。 */
const AUTO_VERIFY = argv.includes("--auto-verify");
const AUTO_VERIFY_REPAIR = argv.includes("--auto-verify-repair");
const NO_AUTO_VERIFY = argv.includes("--no-auto-verify");
// 同时带「装」与「摘」两枚 ⇒ 拒跑，而不是让后一枚赢：那会把两副装配混进同一趟读数，
// 而这张表唯一在防的就是"读数不知道自己跑在哪副装配上"。
if (AUTO_VERIFY && NO_AUTO_VERIFY) {
  console.error("[loop-eval] --auto-verify 与 --no-auto-verify 互相矛盾 ⇒ 不出数（要缺省那副就两枚都别带）");
  process.exit(2);
}
const ASSEMBLY = assemblyRows(DEFAULT_SETTINGS, undefined, assemblyOverrides(AUTO_VERIFY, AUTO_VERIFY_REPAIR, NO_AUTO_VERIFY));
const ASSEMBLY_UNDECLARED = undeclaredKnobs(ASSEMBLY);
const ASSEMBLY_FACE = renderAssemblyFace(ASSEMBLY);
const BENCH_RUNLOOP_KNOBS = runLoopKnobsFromAssembly(ASSEMBLY);
// 配对规则的**出声**：带了返修旗标而这张表里却没有它 ⇒ 这一趟没装闸，它没有对象。
// 判据取表而不是在这里重算一遍布尔（重算＝第二份配对逻辑，宽度迟早不同）。
// 排在旗标解析这一段旁边，是为了 `--feasibility` 那条路也听得到。
if (AUTO_VERIFY_REPAIR && !ASSEMBLY.some((r) => r.key === "autoVerifyRepair")) {
  console.warn("[loop-eval] --auto-verify-repair 被忽略：返修那一拍接在收束闸之后，这一趟没装闸（--no-auto-verify）就没有对象");
}
/** 对照臂的短提示 = gate-check 暗卷当年那句（用来证明"提示词差异"不是读数的解释变量）。 */
const SHORT_SYSTEM = [
  "你是桌面编程 agent，workspace 根是当前工作区（所有路径相对它）。",
  "纪律：1) 有歧义先 clarify；2) 写文件前先 propose_plan；3) 只改 src/；4) 改完 verify。",
].join("\n");

/** CNY/百万 token——取自端点自己 /v1/models 的 catalog（中转价，不等于厂商官方价）。 */
/* 凭据解析（2026-09-30）：CAIRN_* 三个优先；缺了回退到**主 CLI 用的那一套**
 *  （OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL）。
 *  为什么要这条回退：度量台的价值在于**随手能跑**。要求用户为评测再配一套凭据，
 *  结果就是它变成"需要准备才敢跑"的东西，而不会被跑——CLI 已经在用的那份没有理由重配。
 *  OPENAI_BASE_URL 给的是 base（`…/v1`），这里补 `/chat/completions`：
 *  与 `providers/openai.ts` 的归一规则同一口径（给全了也认）。 */
const BENCH_ENDPOINT = process.env.CAIRN_ENDPOINT
  ?? (() => {
    const base = (process.env.OPENAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
    if (base === "") return undefined;
    return base.endsWith("/chat/completions") ? base : base + "/chat/completions";
  })();
const BENCH_API_KEY = process.env.CAIRN_API_KEY ?? process.env.OPENAI_API_KEY;
const BENCH_MODEL = process.env.CAIRN_MODEL ?? process.env.OPENAI_MODEL;
/* 回填到装配真正读的那组变量（`streamGlm` 直接读 `CAIRN_API_KEY`，不走参数）：
 *  不这么做的话，上面那条"回退到 CLI 那套凭据"就只是**看起来**通了——
 *  实测：用 OPENAI_* 跑，三条任务全部 FAIL，报「CAIRN_API_KEY 未设置」，
 *  而报错来自 provider 内部、与评测逻辑无关。凭据靠 env 是既有设计（key 不落文件），
 *  这里只是把同一个值放到装配读得到的那个名字上，不新增存储、不新增路径。
 *  只在原本为空时回填：显式给了 CAIRN_* 的调用方语义不变。 */
if (!process.env.CAIRN_API_KEY && BENCH_API_KEY) process.env.CAIRN_API_KEY = BENCH_API_KEY;
if (!process.env.CAIRN_ENDPOINT && BENCH_ENDPOINT) process.env.CAIRN_ENDPOINT = BENCH_ENDPOINT;
if (!process.env.CAIRN_MODEL && BENCH_MODEL) process.env.CAIRN_MODEL = BENCH_MODEL;
/* 钱的尺要有出处（2026-10-02）：从前这里写的是「env 没给就吃 0.8 / 2.8」，
 * 而那两位是某个中转端点对**它自己那一档**的目录价（本文件头注释同源）。同一趟跑的若是别的档位
 * （实测那 36 拨的是 OpenRouter 免费档），印出来的「实付≈¥0.2774」就是拿别人的价给自己定价。
 * 现在：EVAL_PRICE_IN 与 EVAL_PRICE_OUT **两个都给**才算得出钱；缺任何一个 ⇒ cny=NaN ⇒
 * 汇总那一格印的是「量不出来」（PRICE_UNKNOWN 那个名字），而不是 ¥0.000（token/耗时/内存照出，那一半不依赖价目）。 */
const PRICE = priceFace(process.env.EVAL_PRICE_IN, process.env.EVAL_PRICE_OUT);
const cnyOf = (tokensIn: number, tokensOut: number): number =>
  PRICE.known ? (tokensIn * PRICE.inPerM + tokensOut * PRICE.outPerM) / 1e6 : Number.NaN;

interface EvalTask {
  id: string;
  name: string;
  /** 期望模型做的核心动作（判"完成度"用）。 */
  task: string;
  /** 起点：带 bug 的靶子（复现型任务）或干净靶子（增改型任务）。 */
  seed: "bug" | "clean";
  /** 该任务上「闭环正确转」的额外判据名。 */
  expects: string[];
  /** 靶子目录（runOnce 拷它，不就地改）。文件加载的任务由 seed.path 决定，缺省 = fixtures/todo-app。 */
  dir?: string;
  /** 起点覆盖文件（拷进 work/src/todo.ts）；null = 不覆盖（干净起点）。 */
  bugFile?: string | null;
  /** 出处（外部基准 = repo@commit）；只进读数，不参与判定。 */
  source?: string;
  /** 外部基准条目：本跑器跑不了（判卷是 pytest 命令 + 靶子是别的语言仓库），只能量可行性。 */
  external?: boolean;
  /** 数据层原样（文件加载的条目带着它，可行性读数直接用；内建条目由 specOf 现造）。 */
  spec?: TaskSpec;
}

const BUILTIN: EvalTask[] = [
  { id: "I1", name: "歧义·加开关", task: "给待办应用加个开关，并确保测试全绿", seed: "clean", expects: ["clarify", "planBeforeWrite", "verifyOk", "judgeUntouched"] },
  { id: "I2", name: "修 bug·复现先行", task: "待办应用有测试没过，修好它", seed: "bug", expects: ["readBeforeWrite", "verifyOk", "verifyRecovered", "testNotRewritten", "judgeUntouched"] },
  { id: "I3", name: "优化·不改行为", task: "把 src/todo.ts 里重复的逻辑收敛掉，行为不变、测试保持全绿", seed: "clean", expects: ["readBeforeWrite", "verifyOk", "onlySrcChanged", "judgeUntouched"] },
  { id: "I4", name: "造功能·自验收", task: "新增 priority 字段（high|low），新建的默认 high，并补一条测试", seed: "clean", expects: ["planBeforeWrite", "wroteTest", "verifyOk"] },
];

/** 任务集从文件进来时的映射（数据层在 `src/agent/eval/task-set`，它不 IO 所以在这里落盘读）。
 *  规矩：解析报任何一条错就**不出数**——带着一个被静默缩小的分母跑评测，比不跑更坏。 */
function loadTaskFile(path: string, kind: "tasks" | "swebench"): { tasks: EvalTask[]; errors: string[] } {
  if (!existsSync(path)) return { tasks: [], errors: [`文件不存在：${path}`] };
  const text = readFileSync(path, "utf8");
  const r = kind === "tasks" ? parseTaskSetJson(text) : fromSweBenchJsonl(text);
  const tasks: EvalTask[] = r.tasks.map((t) => ({
    id: t.id,
    name: t.id,
    task: t.instruction,
    seed: "clean" as const,
    expects: t.expects,
    dir: t.seed.kind === "dir" ? resolve(ROOT, t.seed.path) : APP,
    bugFile: t.seed.kind === "file" ? resolve(ROOT, t.seed.path) : null,
    source: t.source,
    external: kind === "swebench",
    spec: t,
  }));
  return { tasks, errors: r.errors };
}

/** 重复给同一个旗标时**出声并作废**（#63c）。
 *  原行为是 `argv.indexOf(flag)` 取**首个**，第二个静默丢掉——于是"我传了两份清单"
 *  这句话在读数上没有任何痕迹，跑出来的是第一份。这类"悄悄只听一个"正是本仓反复登记的形状。
 *  只对 `--tasks` 出声：别的旗标重复的语义（后者胜）历史上没被用过，不去改它们。 */
const repeatedTasks = argv.filter((a) => a === "--tasks").length > 1;
if (repeatedTasks) {
  console.error("[loop-eval] ❌ `--tasks` 给了不止一次：本跑器一次只吃一份清单（同一趟里多次给会静默只用第一份）。"
    + "要跑多份就分几次跑，或把它们合成一份清单文件——本次拒绝出数，见 #63c。");
  process.exit(2);
}
const TASKS_FILE = pick("--tasks", "");
const SWEBENCH_FILE = pick("--swebench", "");
/* 离线合成面（第 422 页）：`--scripted=<剧本>` 把 provider 换成靶场那套**按轮吐冻结剧本**的
 * `createRoundScriptedProvider`（`src/agent/gym/script.ts`），于是一条 SWE-bench 形状的链
 * （数据层产出 `judge` → 解析器读 TAP → 逐名裁决 → 读数行）可以零 key、零网络跑通。
 * 刻意只换 provider：装配（工具面／三门／verify／换路提示）与判卷口径一字不动，
 * 否则「离线跑通」证的就不是生产那一副装配。读数里 `提供者=` 单独一格声明它不是真会话。 */
/* `--scripted` 的值交给 `pick` 解析，而 `pick` **两种写法都认**（`--scripted 空格 值` 与 `--scripted=值`，
 * 就是上面那个函数的头两行）。这里刻意不再自己 find 一遍 `--scripted=`：那一支与 `pick` 的结果恒等，
 * 是死代码，还会把「等号写法被丢掉」这条不变量变成**永远测不出来**——变异表里
 * `scripted-flag-equals-form-dropped` 正是因此存活（磨掉它行为一字不变，判卷当然全绿）。
 * 真正要守的是拿到值之后那两道闸：空值出声退、缺文件出声退，都不许静默改去打真会话。 */
const SCRIPTED = pick("--scripted", "");
if (SCRIPTED === "") {
  console.error('[loop-eval] --scripted= 后面是空的 ⇒ 拒绝出数（要么给剧本路径，要么别带这枚旗标）');
  process.exit(1);
}
const FEASIBILITY = argv.includes("--feasibility");

function selectedTasks(): EvalTask[] {
  if (TASKS_FILE === "" && SWEBENCH_FILE === "") return BUILTIN;
  const src = TASKS_FILE !== "" ? TASKS_FILE : SWEBENCH_FILE;
  const kind = TASKS_FILE !== "" ? "tasks" : "swebench";
  const { tasks, errors } = loadTaskFile(resolve(ROOT, src), kind);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[loop-eval] ${src} ${e}`);
    console.error(`[loop-eval] 解析报错 ${String(errors.length)} 条 ⇒ 拒绝出数（分母不完整时任何分数都是假的）`);
    process.exit(1);
  }
  return tasks;
}

const WRITERS = new Set(["write_file", "edit_file", "run_shell"]);
const READERS = new Set(["read_file", "grep", "glob", "map_query", "impact_query", "obs_recall", "remember"]);

/** 判卷器的本地化适配 + 一条自校。第一版直接 `createVerifyHook(work)` ⇒ verify 跑 `pnpm run test`，
 *  而副本里的 `node_modules` 是指向仓外的软链，pnpm 回
 *  `[ERR_PNPM_UNSAFE_MODULES_DIR] Refusing to remove the modules directory …` ⇒
 *  **8 个格子全记「verify 未通过」，而同一份转录里模型自己 `npx vitest run` 跑的是 `Test Files 1 pass`**
 *  （实测：outputs/loop-eval-2026-09-20-{base,short}/readings.json）。那是判卷器红，不是产品红。
 *  ⇒ 命令换成同一件事的无 pnpm 前置校验写法；再配 `judgeSelfCheck`。
 *  ⚠️ 自校只校**判卷器自己**（临时造一个必绿 + 一个必红的仓库），不拿 `fixtures/todo-app` 的当前内容
 *    当正向基线——那文件是生成物、gitignore、会被任何一次 e2e/agent/gate 就地重置（实测：本轮它就以
 *    带 bug 态在场，拿它当"必须绿"会把评测整体拦停）。靶子的真实起始态另印一行，只声明不拦路。
 *  ⚠️ 第二版踩的坑更值得记：最初写成 `command.replace(/^pnpm run test\b/, "npx vitest run")`——
 *    **改写命令文本**会把"任何仓库的 test"都强行按 vitest 跑，于是判卷器自校那个不含 vitest 的
 *    最小仓库当场必红（实测：自校拦住整轮不出数）。正解是只关掉 pnpm 那一道前置校验
 *    （`pnpm_config_verify_deps_before_run=false`，实测该 env 名取自转录里 grep 到的 pnpm 源码行），
 *    命令本体一字不动 ⇒ 对任何靶子同形。 */
const EVAL_EXEC: ExecFn = (command, cwd, timeoutMs) =>
  defaultExec(`pnpm_config_verify_deps_before_run=false ${command}`, cwd, timeoutMs);

/** 临时造一个只认 exit code 的最小可验仓库（不依赖 vitest / node_modules）。 */
async function miniRepo(dir: string, pass: boolean): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({
    name: pass ? "judge-pos" : "judge-neg", version: "0.0.0", private: true,
    scripts: { test: pass ? "node -e \"process.exit(0)\"" : "node -e \"process.exit(1)\"" },
  }, null, 2) + "\n", "utf8");
  return dir;
}

async function judgeSelfCheck(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "loop-eval-selfcheck-"));
  const pos = await runVerifyOutcome(await miniRepo(join(dir, "pos"), true), EVAL_EXEC);
  const neg = await runVerifyOutcome(await miniRepo(join(dir, "neg"), false), EVAL_EXEC);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  if (!pos.ok || neg.ok) {
    console.error("[loop-eval] 判卷器自校未过 ⇒ 一律不出数（必绿仓 ok=" + String(pos.ok) + " 必红仓 ok=" + String(neg.ok) + "）");
    process.exit(1);
  }
  // 靶子起始态只声明不拦路：它决定"任务本身有多难"，但它是共享可变面，不能当 gate。
  const seedState = await runVerifyOutcome(APP, EVAL_EXEC);
  console.log("[loop-eval] 判卷器自校：必绿仓→ok ✅ 必红仓→不 ok ✅");
  console.log("[loop-eval] 靶子 fixtures/todo-app 当前起始态：" + (seedState.ok ? "绿" : "红")
    + "（该文件是生成物，任何一次 e2e/agent/gate 都会就地重置它 ⇒ 读数横比须看这一行）");
}

function isWriter(name: string): boolean {
  if (name === "run_shell") return true; // 保守：主会话 auto 档能落盘的 shell 算写
  return WRITERS.has(name);
}

/* 资源采样（2026-09-30 P4 补的那一格）：objective 里写着「CPU/内存占用低（单人 + 多 agent 开发机）」，
 *  但在这之前**没有任何读数落盘**——只有我聊天里报过一次 185MB。
 *  没有读数的目标等于没有目标，所以补成读数的一部分：
 *    · rssPeakMb —— 本次会话（含它 spawn 的子进程）的**峰值**常驻内存；
 *    · procPeak   —— 同刻的 node 进程数峰值；
 *    · cpuMs      —— 会话自身的 CPU 时间（user+system，us 转 ms）。
 *  为什么用 `ps` 而不是别的手段：零依赖（本仓依赖面刻意小），且它能一并数到子进程——
 *  而 agent 的内存压力**主要来自子进程**（沙箱里跑的测试、LSP、worker），只量自己会严重低估。
 *  口径说清楚：这是**一台机器上的相对读数**，不是厂商级剖析；
 *  它的用途是「这次改动有没有把占用搞上去」，不是给绝对性能下结论。 */
interface ResourceSample { rssPeakMb: number; procPeak: number; cpuMs: number; samples: number }

function startResourceSampler(): () => ResourceSample {
  const pid = process.pid;
  let rssPeakKb = 0;
  let procPeak = 0;
  let samples = 0;
  const tick = (): void => {
    try {
      // 自身 + 后代：ps 的 %cpu/rss 是瞬时的，这里只取 rss 与进程数
      const r = spawnSync("ps", ["-eo", "pid,ppid,rss,comm"], { encoding: "utf8", timeout: 2_000 });
      const out = r.stdout ?? "";
      const lines = out.trim().split("\n").slice(1);
      const rows = lines.map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 4);
      const kids = new Set<number>([pid]);
      // 一轮传播即可覆盖「本进程 → 直接子进程」；沙箱/子 shell 再深一层靠 comm 含 node 兜住
      let grew = true;
      while (grew) {
        grew = false;
        for (const c of rows) {
          const p0 = Number(c[0]);
          const pp = Number(c[1]);
          if (kids.has(pp) && !kids.has(p0)) { kids.add(p0); grew = true; }
        }
      }
      let rss = 0;
      for (const c of rows) {
        if (!kids.has(Number(c[0]))) continue;
        const kb = Number(c[2]);
        if (Number.isFinite(kb)) rss += kb;
      }
      if (rss > rssPeakKb) rssPeakKb = rss;
      if (kids.size > procPeak) procPeak = kids.size;
      samples += 1;
    } catch { /* 采样失败不影响评测：它只是读数，不是判据 */ }
  };
  tick();
  const timer = setInterval(tick, 500);
  return () => {
    clearInterval(timer);
    tick();
    const cpu = process.cpuUsage();
    return { rssPeakMb: Math.round(rssPeakKb / 1024), procPeak, cpuMs: Math.round((cpu.user + cpu.system) / 1000), samples };
  };
}

interface Reading {
  id: string; name: string; rep: number; system: string;
  /** 这一趟真拨的模型名 = 归因键（`scripts/eval/report.ts` 的 `modelFace` 用它挡跨模型 A/B）。
   *  与 usage 事件上的 `model` 同源：都取 `glmDefaultModelName()`，不在这里再算一份缺省。 */
  model: string;
  /** 这一格实际拨了几趟（1 = 首趟就过去了）。重试次数不印出来的话，「退避有效」就永远是说法。 */
  attempts: number; retryWaitMs: number; retryWhy: string;
  seedVerifyOk: boolean;
  seconds: number; requests: number; tokensIn: number; tokensOut: number; cny: number;
  toolCalls: number; toolFailures: number; repeatedSameAction: number;
  firstWriterIndex: number; readsBeforeFirstWrite: number;
  clarified: number; planned: number; plannedBeforeWrite: boolean;
  verified: number; verifyOkLast: boolean | null;
  /** 收束闸补了几拍（口径在 `lib/eval-validity.ts` 的 `autoVerifyBeats`，布尔位从它派生）。
   *  为什么要数出来：布尔把「1 拍」与「2 拍（红了一拍、模型真改过盘之后重验）」压成同一个 true，
   *  而返修那一环正是能力 5 要量的那一格——没有计数，`--auto-verify-repair` 跑出来的对照臂与不带它长得一样。 */
  autoVerifyBeats: number; autoVerifyBeat: boolean;
  /** 红→绿那一格走到哪一步（六态；口径在 `lib/eval-validity.ts` 的 `verifyRecovery`）。
   *  与上面那两枚的区别：布尔只说"有没有第二拍"，这里说的是**那一拍算谁的账**。 */
  verifyRecovery: VerifyRecovery;
  /** 逐名判卷那一格（第 415 页产出规格、这一页才有读者）。
   *  `undefined` = 这条任务**没有** `judge` 规格（内建 I1…I4 全走这里 ⇒ 既有读数一列不动）；
   *  有值 = 规格在、裁决三态之一。含义与上面三枚**互不替换**：`verifyOkLast` 答「最后一次拍子是不是
   *  退出码 0」，这一格答「哪条该转绿的没绿、哪条该保住的坏了、哪些名字对不上」——
   *  同一枚 1 在这两格里是两种说法，那正是 SWE-bench 要分的东西。
   *  判据不在这儿：口径全在 `lib/eval-named-sets` ＋生产的 `parseTestResults`／`judgeNamedSets`。 */
  namedSets?: NamedSetReading;
  /** 这一趟的「模型那一侧」从哪来：`真会话` = GLM 装配（花钱、要 key），`剧本` = 合成面（零花费）。
   *  单独成一格而不是靠"读数里有没有钱"来猜：一条烧了 0 元的趟次在两副装配下长得一模一样，
   *  而把合成读数引用成产品分数是本仓最贵的那一族错。 */
  providerFace: "真会话" | "剧本";
  wroteTests: boolean; touchedJudge: boolean; onlySrcChanged: boolean;
  /** held-out（隐藏验收）观测：装不上的错误清单 + 跑出来的结果。
   *  `heldOutRun` 为 undefined = 这一格没跑（任务集没给隐藏面，或文件没装齐）。
   *  判卷口径全在 `lib/eval-heldout`：这里只存观测，不自己再算一遍「过没过」。 */
  heldOutInstallErrs: string[]; heldOutRun: HeldOutRun | undefined;
  /** 这一格是哪副装配跑出来的（`autoVerify:off-here …` 这样的短串，事实源 `lib/eval-assembly`）。
   *  为什么进读数而不是只看日志那一行：读数会被事后拿去做 A/B，日志那行不在同一个文件里；
   *  `autoVerifyBeat:false` 脱离装配面就没有解释——它既可能是「模型不验」，也可能是「跑器没装」。 */
  assembly: string;
  changedFiles: string[]; exitError: string | null;
  /** 本次会话的资源占用（见 startResourceSampler 的口径说明）。 */
  resources: ResourceSample;
}

async function listFiles(dir: string, base: string = dir, acc: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await listFiles(p, base, acc);
    else acc.push(p.slice(base.length + 1));
  }
  return acc.sort();
}

/* 临时目录**不在 runOnce 里删**（#109）。
 * 为什么这一跳必须挪到调用方：「这趟算不算失败」的那份裁决是 `grade()` + `runValidity()` 汇成的
 * `verdict`，而它长在**主循环**里（重拨后的那份读数才是被印出来的那一趟）。runOnce 里先删目录，
 * 就等于在裁决之前把证据烧掉——盘上留下的只有 readings.json 那行结论，转录没了 ⇒
 * `scripts/gym-draft.ts`（能力 10 既有的取料口）吃不到输入，bench 每跑一片红都学不到东西。
 * 现在 runOnce 把位置交出来，主循环按它自己已经印出来的那个 verdict 决定留哪一份，**留完立刻删**：
 * 临时目录的寿命只比原来长几行，不因为"没人收"而在 /tmp 里堆一辈子。 */
interface StagedRun {
  /** `I2-rep1-base`：与 `--keep` 的文件名同一份写法，留档与归档两头认得同一个靶。 */
  key: string;
  eventsPath: string;
  dir: string;
}
const STAGED: StagedRun[] = [];

/** 收掉这一行（一个靶子 × 一个 rep）留下的临时目录。
 *  只有**印出来是 FAIL** 的那一趟留一份转录；被重拨替掉的那几趟直接删——它们的账已经在那行
 *  「重拨账」里说清了，再留档就是给同一个靶堆两份互相矛盾的输入。
 *  `keepFailedTrace` 自己不吃异常（每一格 IO 都带回话），所以这里不需要 try/finally。 */
async function retainStagedRuns(staged: readonly StagedRun[], verdict: string, keeps: TraceKeepOutcome[]): Promise<void> {
  const last = staged[staged.length - 1];
  for (const s of staged) {
    if (s === last) continue;
    await rm(s.dir, { recursive: true, force: true }).catch(() => {});
  }
  if (last === undefined) return;
  /* 每一行都递一次（含 PASS 与「无效」）：留不留的闸在 `keepFailedTrace` 里，吃的就是这里传过去的
   *  verdict——「绿的那趟不留」因此在那行读数里有自己的格子，而不是靠"目录里恰好没文件"被人读成没接上。 */
  keeps.push(await keepFailedTrace({
    verdict, root: ROOT, out: OUT, day: ranAt.slice(0, 10),
    sourcePath: last.eventsPath, caseId: last.key, keepAll: KEEP_ALL,
  }));
  await rm(last.dir, { recursive: true, force: true }).catch(() => {});
}

/** 一次 run：装配 = 生产同款（BASE_SYSTEM + 会话工具面 + 三门 + verify + 换路提示）。 */
async function runOnce(t: EvalTask, rep: number): Promise<Reading> {
  if (t.external) {
    // 明确拒绝，而不是"跑起来看看"：外部基准的判卷是 pytest 命令、靶子是别的语言仓库，
    // 本跑器只接 GLM 会话装配 + node 靶子 ⇒ 硬跑出来的分数与基准无关。
    throw new Error(`条目 ${t.id} 来自外部基准（source=${String(t.source)}）⇒ 本跑器跑不了，请用 --feasibility 先看缺口`);
  }
  const appDir = t.dir ?? APP;
  const dir = await mkdtemp(join(tmpdir(), "loop-eval-"));
  const work = join(dir, "work");
  await cp(appDir, work, { recursive: true, force: true });
  // pnpm 的 node_modules 是「目录内相对符号链接」，`cp -R` 会把它搬成断链 ⇒ 副本里 `vitest run`
  // 直接 command not found ⇒ verify 恒红，量出来全是装配噪声不是模型行为（实测踩过）。
  // 改成软链回原靶子的 node_modules：依赖可用，且绝不写回原目录。
  await rm(join(work, "node_modules"), { recursive: true, force: true });
  await symlink(join(appDir, "node_modules"), join(work, "node_modules"), "dir");
  const bug = t.bugFile !== undefined ? t.bugFile : (t.seed === "bug" ? BUG : null);
  if (bug !== null) await cp(bug, join(work, "src", "todo.ts"));
  const eventsPath = join(dir, "events.jsonl");
  const log = createEventLog(eventsPath);
  // 落盘前盖章（生产同一条纪律：盖在**事件本身上**，live 与盘是同一个对象）。
  const usageAttribution = createUsageAttributor(glmDefaultModelName);
  const clarify = new ClarifyGate();
  const plan = new PlanGate();
  /* 澄清答案**只能给内建 I1 那一道题**（它的题面就是"给待办应用加个开关"）。
   *
   * 为什么必须按题目限定：`ClarifyGate.submit` 是**原样透传**的
   * （`src/agent/gates.ts:70`：`resolve(answers)`，不按问题文本过滤）⇒
   * 别的任务一提问，拿到的就是这张"开关"表。
   * 2026-10-01 实测：B4（分页 off-by-one）的模型收到「addTodo 增加默认完成参数」后，
   * 直接在下一轮反问「**上一轮你答的是「addTodo / done 开关」，但本仓库里没有任何 todo**」——
   * 一次无关答案烧掉一整轮，而且把它带向错误方向（那一轮它去改了判卷面）。
   * 这是"尺子喂假信号"，会让所有任务的分数不可信。
   *
   * 外部任务集没有这份表 ⇒ 交**空答案**，与 CLI 无人值守档同一语义
   * （`src/cli.ts`：'提交空答案，模型须自行拿主意'）。真要给答案，应当写进任务书，
   * 而不是在这里替所有任务猜。 */
  const answers: Record<string, string> = t.id === "I1"
    ? { "开关加在哪里？": "addTodo 增加默认完成参数", "开关的默认行为？": "默认未完成（done=false）" }
    : {};
  const driven = {
    append: async (e: AgentEvent) => {
      usageAttribution.stamp(e);
      await log.append(e);
      if (e.type === "clarify_requested") {
        queueMicrotask(() => clarify.submit(e.callId, answers as never));
      }
      if (e.type === "plan_proposed") {
        queueMicrotask(() => {
          plan.approve(e.callId);
          void log.append({ type: "plan_approved", callId: e.callId, approved: true } as AgentEvent);
        });
      }
    },
  };
  const face = sessionToolSpecs({ mode: "auto" });
  const system = SYSTEM_MODE === "short" ? SHORT_SYSTEM : BASE_SYSTEM;
  const started = Date.now();
  // 起点自述：这一格开跑前靶子本身是绿是红。`fixtures/todo-app/src/todo.ts` 是生成物、会被任何
  // 一次 e2e/agent/gate 就地重置 ⇒ 不能拿它当全局 gate，但必须逐格记进读数：
  // 「模型把红修到绿」与「模型从绿开始又弄红了」是两个完全不同的结论。
  const seedVerifyOk = (await runVerifyOutcome(work, EVAL_EXEC)).ok;
  const stopSampler = startResourceSampler();
  let exitError: string | null = null;
  try {
    await runLoop({
      ...BENCH_RUNLOOP_KNOBS,
      provider: SCRIPTED === ""
        ? createGlmSessionProvider(eventsPath, {
          system,
          workspace: work,
          requestFace: () => ({ tools: face.specs, note: face.note }),
          // 显式递模型名：provider 不传的话走 `process.env.CAIRN_MODEL ?? "glm-5.2"`，
          // 而用 OPENAI_MODEL 配的路由（如 OpenRouter 的自由档）在这里就会被静默换成 glm-5.2 ⇒
          // 请求打到不是你要测的那个模型上。压缩摘要器也吃这个值，两处同源。
          ...(BENCH_MODEL !== undefined && BENCH_MODEL !== "" ? { model: BENCH_MODEL } : {}),
        })
        // 合成面：装配不变，只换「模型那一侧从哪来」——剧本按轮吐，零 key 零网络（见上面 SCRIPTED 那段）。
        : createRoundScriptedProvider(resolve(ROOT, SCRIPTED)),
      events: driven,
      workspace: work,
      mode: "auto",
      maxSteps: MAX_STEPS,
      stuckNudge: true,
      clarify,
      plan,
      verify: createVerifyHook(work, { exec: EVAL_EXEC, trustedRepo: true }),
      userMessage: t.task,
    });
  } catch (err) {
    exitError = err instanceof Error ? err.message : String(err);
  }
  const seconds = (Date.now() - started) / 1000;
  const resources = stopSampler();

  const ev = await replay(eventsPath);
  const calls = ev.filter((e) => e.type === "tool_call") as Extract<AgentEvent, { type: "tool_call" }>[];
  const results = new Map(ev.filter((e) => e.type === "tool_result").map((e) => [e.callId, e as Extract<AgentEvent, { type: "tool_result" }>]));
  const usage = ev.filter((e) => e.type === "usage") as Extract<AgentEvent, { type: "usage" }>[];
  const verifies = ev.filter((e) => e.type === "verify_result") as Extract<AgentEvent, { type: "verify_result" }>[];
  // 闸补的拍数：口径只在这里算一次，下面布尔位与读数行都吃这个值（同一谓词抄两份是本仓反复点名的那一族）。
  const harnessBeats = autoVerifyBeats(verifies);
  /* 返修那一格的**归属**：生产端写明「auto 拍没有配对的 tool_call」（`src/agent/loop.ts` 里 `verifyBeat` 上面那段），
   * 所以模型自调的那一拍一定能 join 回一次 `verify` 调用；闸补的那枚用哨兵 callId（＋事件里那枚 `auto` 键）。
   * 两条通道都读不出时交 `unknown`——它是一等公民，不许并进「模型自己返修」：
   * 那正是能力 5 的分子最容易长歪的地方（闸替模型补一拍，账却记在模型头上）。 */
  const verifyCallIds = new Set(calls.filter((c) => c.name === "verify").map((c) => c.id));
  const beatFaces = verifies.map((v) => verifyBeatFace(v, verifyCallIds, HARNESS_VERIFY_CALL_ID));
  const recovery = verifyRecovery(beatFaces);
  /* 逐名那一格的取料：**最后一次 verify 拍**的每条命令原文（与 `verifyOkLast` 同一拍——两枚读数若来自
   *  不同拍子，就是在拿两趟不同的事互相对账）。规格只从 `t.spec?.judge` 来：数据层第 415 页已经把它
   *  与那句 `python -m pytest` 同笔产出，这里再拼一遍命令行就是第二份会漂的账。
   *  没有规格 ⇒ `undefined`（无面），与「有规格但读不出」（unreadable）分列，见 `lib/eval-named-sets` ⑶。 */
  const namedSets = readNamedSets(verifies.length > 0 ? verifies[verifies.length - 1]!.results : [], t.spec?.judge);
  const writers = ev.map((e, i) => ({ e, i })).filter(({ e }) => e.type === "tool_call" && isWriter((e as Extract<AgentEvent, { type: "tool_call" }>).name));
  const firstWriterIndex = writers.length > 0 ? writers[0]!.i : -1;
  const readsBeforeFirstWrite = firstWriterIndex < 0 ? 0
    : calls.filter((c) => READERS.has(c.name) && ev.indexOf(c as AgentEvent) < firstWriterIndex).length;
  const firstPlanIdx = ev.findIndex((e) => e.type === "tool_call" && (e as Extract<AgentEvent, { type: "tool_call" }>).name === "propose_plan");
  const actions = calls.map((c) =>
    stuckActionOf(c.name, c.args as Record<string, unknown>) + "|" + stuckObservationOf(results.get(c.id)?.output ?? ""));
  const seen = new Map<string, number>();
  for (const a of actions) seen.set(a, (seen.get(a) ?? 0) + 1);
  let repeatedSameAction = 0;
  for (const n of seen.values()) if (n > 1) repeatedSameAction += n - 1;
  const tokensIn = usage.reduce((s, u) => s + u.inputTokens, 0);
  const tokensOut = usage.reduce((s, u) => s + u.outputTokens, 0);

  // 改动清单 = 副本 vs 原靶子（逐文件比字节）。两类噪声必须先摘：
  //  · `pnpm-lock.yaml`：`pnpm test` 在无 lock 的目录里会自己补一份（实测），不是模型写的；
  //  · `.tmp/` / `.agents/`：运行产物。
  // 「判卷面被动过」**不看目录差异**——那只说明有字节变了；要看的是**模型自己发起的写**
  // （write_file / edit_file 的路径参数），否则 pnpm 的副作用会冒充成模型的越界。
  /* harness **自己写**的工作区状态不算"模型改的盘"，否则读数会误导。
   *
   * 为什么必须排除：`changed` 是「靶子目录 vs 跑完的工作目录」逐字节比，
   * 而 harness 自己会往工作区写两支——`.agent/sessions/`（事件流）与
   * `.agent/snapshots/`（写前快照）。它们一进来，`onlySrcChanged` 就**恒 false**、
   * `changedFiles` 的头几项永远是快照路径，读的人会以为模型到处乱改。
   * 2026-10-01 实测（12 条任务的真模型基线）：**12 条 onlySrcChanged 全 false**，
   * 而逐条看 changedFiles，模型其实只动了 `src/` 与 `tests/`。
   *
   * 只排除这两支、**不排除整个 `.agent/`**：模型若真去改 `.agent/config.json`
   * 这类配置面，那属于越界，必须看得见。
   * （原先只写了 `.agents/`——复数。harness 用的是单数 `.agent/`，等于没排除。） */
  const NOISE = (f: string): boolean =>
    f === "pnpm-lock.yaml" || f.startsWith(".tmp/") || f.startsWith(".agents/") ||
    f.startsWith(".agent/sessions/") || f.startsWith(".agent/snapshots/") || f === ".DS_Store";
  const orig = (await listFiles(appDir)).filter((f) => !NOISE(f));
  const now = (await listFiles(work)).filter((f) => !NOISE(f));
  const changed: string[] = [];
  for (const f of now) {
    const a = await readFile(join(appDir, f)).catch(() => null);
    const b = await readFile(join(work, f)).catch(() => null);
    if (!a || !b || !a.equals(b)) changed.push(f);
  }
  for (const f of orig) if (!now.includes(f)) changed.push(f + "（被删）");
  const modelWrites = calls
    .filter((c) => c.name === "write_file" || c.name === "edit_file")
    .map((c) => String((c.args as Record<string, unknown>).path ?? ""))
    .filter((p) => p !== "");
  const isJudge = (p: string): boolean => p.startsWith("tests/") || p.endsWith(".test.ts") || p.endsWith(".test.js");
  /* 「改了判卷面」= **既有**判卷文件被改写或删除，**不认新增**。
   *
   * 为什么必须分开（2026-10-02 实测，48 级链那趟）：模型只**新增**了 `tests/stages.mjs`
   * （它自己的逐级隔离用例，正文里明写"判卷面 tests/run.mjs 不动"），48 级全绿、官方 verify 通过，
   * 却被旧判据判成 FAIL〔改了判卷面〕——**那是假红**：
   *   旧判据 `modelWrites.some(isJudge)` 只看到"写过 tests/ 下的路径"，
   *   而"新建一个辅助用例"与"改写既有判卷"是两件完全不同的事，它分不出。
   * 新增为什么**不是**作弊路：验证器跑的是 `node --test tests/*.test.js`，
   * 新增的通过用例**遮不住**任何一个既有红用例（有一条红就整条命令红）⇒ 加文件改不了结论。
   * 改写/删掉既有判卷才是真作弊，也正是 M0 那轮实测抓到的形状（12 条里 5 条改过 `tests/*.test.js`）。
   * 判据的口径：**`changed` 里属于 tests/ 的文件，若在靶子里本来就有 ⇒ 被改过；没有 ⇒ 是新增。 */
  const existedInSeed = (f: string): boolean => orig.includes(f.replace("（被删）", ""));
  const touchedJudge = changed.some((f) => isJudge(f.replace("（被删）", "")) && existedInSeed(f));
  /** 有没有在 tests/ 下**动过东西**（含新增）——`wroteTest` 这一支要的正是这个口径。 */
  const wroteTests = modelWrites.some((p) => p.startsWith("tests/"));
  const onlySrcChanged = changed.length > 0 && changed.every((f) => f.startsWith("src/"));

  /* held-out 验收：**必须在上面那段改动清单算完之后**才装文件。
   * 顺序错了就会自造两种假红——隐藏文件落在 `tests/` 下，
   * 既会被 `touchedJudge` 当成"模型改了判卷面"（它没改，是我装的），
   * 又会被 `onlySrcChanged` 当成"改动越出 src/"。模型全程看不见它：
   * 它的工作区是这个副本，而 src 从仓根的 `fixtures/bench-heldout/` 取，副本之外。
   * 装不全就不跑：跑半份隐藏验收得出的"绿"是假绿，比红更坏（同 `installHeldOut` 那条纪律）。 */
  const heldOutInstallErrs: string[] = [];
  let heldOutRun: HeldOutRun | undefined;
  if (t.spec?.heldOut !== undefined) {
    heldOutInstallErrs.push(...await installHeldOut(work, ROOT, t.spec.heldOut.files));
    if (heldOutInstallErrs.length === 0) heldOutRun = await runHeldOut(work, t.spec.heldOut, EVAL_EXEC);
  }

  // 先显式摘掉软链再删临时目录：不给"递归删到原靶子 node_modules"留任何可能性
  // （Node 的 rm 对符号链接是 unlink 不跟随，但这条是破坏性事故，值得多一行显式）。
  // --keep：把事件流留档。第一版没留，结果「红着收束」到底是模型选择还是装配假象，
  // 只能靠再跑一遍才知道——读数不可复查是评测器的缺陷，不是小事。
  if (KEEP_ALL) {
    await mkdir(join(ROOT, OUT), { recursive: true });
    await cp(eventsPath, join(ROOT, OUT, t.id + "-rep" + String(rep) + "-" + SYSTEM_MODE + ".events.jsonl")).catch(() => {});
  }
  await unlink(join(work, "node_modules")).catch(() => {});
  /* 目录本身**不在这里删**（#109，见 `StagedRun` 上面那段）：删在这儿就是在「这趟算不算 FAIL」
   * 之前烧掉证据。把位置交给主循环，由它按自己印出来的那个 verdict 决定留不留，留完立刻收。 */
  STAGED.push({ key: t.id + "-rep" + String(rep) + "-" + SYSTEM_MODE, eventsPath, dir });
  return {
    id: t.id, name: t.name, rep, system: SYSTEM_MODE, seedVerifyOk,
    model: glmDefaultModelName(),
    attempts: 1, retryWaitMs: 0, retryWhy: "首趟未重拨",
    seconds, requests: usage.length, tokensIn, tokensOut,
    cny: cnyOf(tokensIn, tokensOut),
    toolCalls: calls.length,
    toolFailures: calls.filter((c) => results.get(c.id)?.ok === false).length,
    repeatedSameAction,
    firstWriterIndex, readsBeforeFirstWrite,
    clarified: calls.filter((c) => c.name === "clarify").length,
    planned: calls.filter((c) => c.name === "propose_plan").length,
    plannedBeforeWrite: firstPlanIdx >= 0 && (firstWriterIndex < 0 || firstPlanIdx < firstWriterIndex),
    verified: calls.filter((c) => c.name === "verify").length,
    verifyOkLast: verifies.length > 0 ? verifies[verifies.length - 1]!.ok : null,
    autoVerifyBeat: harnessBeats > 0, autoVerifyBeats: harnessBeats,
    verifyRecovery: recovery,
    namedSets,
    providerFace: SCRIPTED === "" ? "真会话" : "剧本",
    wroteTests, touchedJudge, onlySrcChanged, changedFiles: changed, exitError, resources,
    heldOutInstallErrs, heldOutRun,
    assembly: ASSEMBLY_FACE,
  };
}

/* 判据本体搬去 `lib/eval-expects`（第 327 页 #35）：那里能对着数据层的 `EXPECT_NAMES` 逐枚核键集，
 *  而这一层顶层就会跑起来，判卷 import 不进来。这里只负责把读数拼成那张表要的面。 */
function grade(r: Reading, t: EvalTask): { ok: boolean; fails: string[] } {
  const face: ExpectFace = {
    ...r,
    expects: t.expects,
    heldOutSpec: t.spec?.heldOut,
    heldOutRun: r.heldOutRun,
    heldOutInstallErrs: r.heldOutInstallErrs,
  };
  const fails: string[] = [];
  for (const e of t.expects) {
    const why = expectFailReason(e, face);
    if (why) fails.push(why);
  }
  /* 逐名那一格**不走 `expects` 通道**：它的开口条件是「这条任务带不带 `judge` 规格」，
   *  所以不必新增判据名（`EXPECT_NAMES` ↔ `EXPECT_HANDLERS` 那张键集表因此一格没动）。
   *  `fail` 与 `unreadable` 都算没成立——后者是「没有尺」，把它读成过是这一格最贵的假绿；
   *  `undefined`（无规格）一条都不加 ⇒ 内建四格的 fails 逐字不变。 */
  const namedWhy = namedSetFailReason(r.namedSets);
  if (namedWhy !== null) fails.push(namedWhy);
  if (r.exitError) fails.push("runLoop 抛错:" + r.exitError.slice(0, 60));
  return { ok: fails.length === 0, fails };
}

/** 返修那一格的读数令牌：六态各一枚，**逐态印出来**（合成一句话就会把"没有尺"和"没问题"混成一格）。 */
const RECOVERY_TOKEN: Record<VerifyRecovery, string> = {
  noVerify: "没验", greenFirst: "一次绿", notRecovered: "红没回",
  harnessOnly: "闸补的绿", modelRecovery: "模型自己回", attributionUnknown: "归属不可知",
};

/** 读数行那一枚 held-out 令牌：**按状态枚举穷举投影**，不自己再比一次 `ok`。
 *  为什么读数要单独有一枚令牌而不是只看〔括号里的失败原因〕：那括号只在**有失败**时才出现，
 *  扫一眼 12 行分不清"这条任务没配隐藏面"与"隐藏面过了"——前者是没有尺，后者是证据。 */
const HELD_OUT_TOKEN: Record<HeldOutState, string> = {
  "no-face": "无面",
  "not-installed": "装不上",
  "not-run": "未跑",
  "cannot-run": "跑不起",
  red: "红",
  green: "绿",
};

/** 逐名那一格的读数令牌：**按 `NamedSetState` 三态穷举投影**（加一态而表没跟上就该在判卷里红，
 *  与上面那枚 held-out 令牌同一纪律）。第三态单独一枚是必须的：`unreadable` 与 `pass` 共用
 *  「没报错」这张脸，就是本仓点名的「没有尺」被读成「没问题」。
 *  第四种情况（这条任务根本没有规格）不在枚举里——它交下面那枚常量，别塞进状态枚举去改生产的语义。 */
const NAMED_SET_TOKEN: Record<NamedSetState, string> = {
  pass: "逐名全绿",
  fail: "逐名有红",
  unreadable: "逐名读不出",
};
const NO_NAMED_SET_TOKEN = "无逐名格";

/** 内建条目的数据层视图（文件加载的条目自带 spec）。verifier 与 runVerifyOutcome 的缺省同形。 */
const specOf = (t: EvalTask): TaskSpec => t.spec ?? {
  id: t.id,
  instruction: t.task,
  seed: { kind: "dir", path: t.dir ?? APP },
  verifier: { command: "pnpm test" },
  expects: t.expects,
  source: t.source ?? "本仓",
};

/** 只回答"这批任务我们现在量得了吗"，一个模型请求都不发——花钱之前先把缺口摆出来。 */
function reportFeasibility(tasks: readonly EvalTask[]): void {
  // 工具链自检：同一条命令只跑一次（一批任务常共用 `python -m pytest`）。
  // 认不出自检形状的判卷命令按**不可跑**处理——宁可少跑一批，也不能让"没尺"混进分母当 0 分。
  const checked = new Map<string, boolean>();
  const canRunVerifier = (command: string): boolean => {
    const probeCmd = deriveVerifierProbe(command);
    if (probeCmd === null) return false;
    const hit = checked.get(probeCmd);
    if (hit !== undefined) return hit;
    const r = spawnSync(probeCmd, { shell: true, encoding: "utf8", timeout: 15_000 });
    const ok = r.error === undefined && r.status === 0;
    checked.set(probeCmd, ok);
    return ok;
  };
  const probe: EnvProbe = {
    hasRepoSnapshot: (t) => existsSync(resolve(ROOT, t.seed.path)),
    hasCredentials: () => Boolean(BENCH_API_KEY && BENCH_ENDPOINT),
    canRunVerifier: (t) => t.verifier === undefined || canRunVerifier(t.verifier.command),
  };
  const rows = tasks.map((t) => ({ id: t.id, r: feasibility(specOf(t), probe) }));
  for (const x of rows) {
    console.log(`[feasibility] ${x.id.padEnd(26)} ${x.r.runnable ? "可跑" : "不可跑"}` +
      (x.r.blockers.length > 0 ? " ← " + x.r.blockers.join("；") : ""));
  }
  /* 逐名那一格在零花费这条路上也要出声：它回答的是「这批任务除了退出码，有没有第二半尺」。
   * 规格一律取数据层的 `specOf(t).judge`（同一个来源，两列语义仍归 `namedSetProblems` 管，这里只数条数）；
   * 而「带规格」与「这一趟能读到逐名料」是两件事——外部条目本跑器不执行，那一句必须说在前面。 */
  const judged = tasks.filter((t) => specOf(t).judge !== undefined);
  const judgedExternal = judged.filter((t) => t.external).length;
  const sumOf = (pick2: "failToPass" | "passToPass"): number =>
    judged.reduce((s, t) => s + (specOf(t).judge?.[pick2].length ?? 0), 0);
  console.log(`[feasibility] 逐名格：${String(judged.length)} / ${String(tasks.length)} 条带 judge 规格`
    + `（FAIL_TO_PASS 合计 ${String(sumOf("failToPass"))} 条／PASS_TO_PASS 合计 ${String(sumOf("passToPass"))} 条）`
    + (judged.length === 0
      ? "⇒ 这一批**没有一条**有第二半尺 ⇒ 「该转绿的没绿」与「该保住的坏了」仍只在同一枚退出码上同形"
      : judgedExternal === judged.length
        ? `⇒ 跑器会在最后一次 verify 拍上按逐名裁决；但这 ${String(judgedExternal)} 条是外部基准条目 ⇒ 本跑器不执行它们，逐名面此刻只活在规格里、还没有料`
        : "⇒ 跑器会在最后一次 verify 拍上按逐名裁决，两件事从此分列"));
  for (const [cmd, ok] of checked) {
    console.log(`[feasibility] 工具链自检 ${ok ? "✅" : "❌"} ${cmd}`);
  }
  if (checked.size === 0) {
    console.log("[feasibility] 工具链自检：这批任务没有一条判卷命令可推出自检形状 ⇒ 全部按未证处理");
  }
  const agg = aggregateFeasibility(rows.map((x) => x.r));
  console.log(`[feasibility] 可跑 ${String(agg.runnable)} / 分母 ${String(agg.total)}（未发任何模型请求 ⇒ 零花费）`);
  // 装配面在这条零花费路上也要出声：这行回答的是「就算可跑，跑出来的读数能不能当产品行为引用」。
  // 上面那行只说「有没有得量」，不说「量的是哪副装配」——`autoVerify:off-here` 那一格正是这样漏掉的。
  console.log("[feasibility] 装配面（产品缺省开的键 ↔ 本跑器）：" + ASSEMBLY_FACE);
  console.log(agg.measurable
    ? "⇒ 有得量：去掉 --feasibility 就按这批任务出数（要真钱）。"
    : "⇒ " + agg.reason);
  process.exit(0);
}

const selected = selectedTasks();
const tasks = ONLY.length > 0 ? selected.filter((t) => ONLY.includes(t.id)) : selected;
// 空集先拦：`--only` 打错字时"没有尺"必须是红，不能顺着 --feasibility 报成 exit 0 的"合理缺席"。
if (tasks.length === 0) {
  console.error("[loop-eval] --only 筛完一条不剩（这是指令写错了，不是「零通过率」）");
  process.exit(1);
}
if (FEASIBILITY) reportFeasibility(tasks);
if (tasks.some((t) => t.external)) {
  console.error("[loop-eval] 任务集含外部基准条目 ⇒ 本跑器（GLM 会话装配 + node 靶子）跑不了它；先加 --feasibility 看缺口");
  process.exit(1);
}
if (SCRIPTED !== "") {
  /* 合成面在第一趟之前把话说完两件事：① 剧本文件必须真的在（缺就出声退，不许静默退回真会话——
   *    那等于「以为在跑离线，实际在烧钱」，方向与本仓「读不到 ≠ 安全」同一条）；
   * ② 这一趟的读数**不是任何基准分数**，它证的只有「这条链端到端跑得起来、逐名那两件事分得开」。 */
  const scriptPath = resolve(ROOT, SCRIPTED);
  if (!existsSync(scriptPath)) {
    console.error(`[loop-eval] --scripted=${SCRIPTED} 指向的剧本不存在 ⇒ 拒绝出数（不许静默改用真会话跑）`);
    process.exit(1);
  }
  console.log(`[loop-eval] 合成面：provider=剧本（${SCRIPTED}）⇒ 零 API key、零网络；这一趟读数标「合成」，不进任何基准分母`);
}
if (SCRIPTED === "" && (!BENCH_API_KEY || !BENCH_ENDPOINT)) {
  console.log("[loop-eval] 暗卷缺席（无 CAIRN_API_KEY/CAIRN_ENDPOINT，也没有 OPENAI_API_KEY/OPENAI_BASE_URL）——显式跳过，不出数（未证 ≠ 通过）");
  console.log("[loop-eval] 想知道「现在能不能量、缺什么」：加 --feasibility（零花费，不发模型请求）");
  console.log("[loop-eval] 想零花费跑通一条完整链：加 --scripted=<剧本>（合成面，见 fixtures/bench/scripts/）");
  process.exit(0);
}
await judgeSelfCheck(); // 判卷器不落定就不出数
/* 装配面在**花钱之前**出声：这行说的是"这一批读数是哪副装配跑出来的"。
 * 有未表态的缺省开键 ⇒ 拒绝出数（不是警告）：那意味着产品默认在线的一环被基准静默少装，
 * 而跑出来的分数会被引用成产品行为——`autoVerifyBeat` 49 趟全 false 那次就是这么错的。 */
console.log("[loop-eval] 装配面（产品缺省开的键 ↔ 本跑器）：" + ASSEMBLY_FACE);
if (ASSEMBLY_UNDECLARED.length > 0) {
  for (const u of ASSEMBLY_UNDECLARED) console.error(`[loop-eval] 缺省开但没表态：${u.key} ⇒ ${u.why}`);
  console.error(`[loop-eval] ${String(ASSEMBLY_UNDECLARED.length)} 枚键没表态 ⇒ 拒绝出数（在 scripts/lib/eval-assembly.ts 的 BENCH_KNOBS 里写明装／不装／无意义）`);
  process.exit(1);
}
console.log(`[loop-eval] 任务=${tasks.map((t) => t.id).join(",")} reps=${REPS} system=${SYSTEM_MODE} maxSteps=${MAX_STEPS} 模型=${glmDefaultModelName()} 价=${PRICE.known ? `¥${PRICE.inPerM}/¥${PRICE.outPerM}每M（手给）` : `${PRICE_UNKNOWN}〔${PRICE.why}〕`}`);
await mkdir(ROOT + "/" + OUT, { recursive: true });
// 一趟只读一次钟：run.json 的时刻、盖进每条读数的 ranAt 身份键（#90）、以及失败轨迹留档那个
// dated 目录的名字，三者取**同一个**值——省得多处各 `new Date()` 漂出两个时刻、事后对账对不上。
const ranAt = new Date().toISOString();
const rows: { r: Reading; g: { ok: boolean; fails: string[] } }[] = [];
const traceKeeps: TraceKeepOutcome[] = [];
for (let rep = 1; rep <= REPS; rep++) {
  for (const t of tasks) {
    // 本趟新造的临时目录从这一格往后都归主循环收（见 `STAGED` 上面那段：判断 FAIL 要等 grade()）。
    const stagedMark = STAGED.length;
    // 被 provider 打断 ⇒ 再拨一次（判据与分母共用同一个白名单，见 lib/eval-retry）。
    // 帽内的等待（分钟级抖动）才等；日配额那种要等到明天的 ⇒ 明确不重拨并印出原因——
    // 那一趟仍会被 `runValidity` 判成「无效、不进分母」，不会污染分数。
    const retried = await withProviderRetry(
      () => runOnce(t, rep),
      (res, n) => retryVerdict([...grade(res, t).fails, res.exitError ?? ""], n, { nowMs: Date.now() }),
      (ms) => sleep(ms),
    );
    const r = { ...retried.value, attempts: retried.attempts, retryWaitMs: retried.waitedMs, retryWhy: retried.stoppedWhy };
    const g = grade(r, t);
    rows.push({ r, g });
    // 未起步 / 被 provider 打断的趟次**不叫 FAIL**：那会把"跑不成"记成"模型没做到"。
    // 判据在 `lib/eval-validity.ts`（纯函数、可单测）；分母口径同见那边。
    const v = runValidity(r, g.fails);
    const verdict = v.valid ? (g.ok ? "PASS" : "FAIL") : "无效";
    console.log(
      `[loop-eval] ${t.id} rep${String(rep)} ${verdict} 起点=${r.seedVerifyOk ? "绿" : "红"} `
      + `读先于写=${r.readsBeforeFirstWrite} clarify=${String(r.clarified)} 先批后写=${r.plannedBeforeWrite ? "Y" : "N"} `
      + `verify=${String(r.verified)}→${String(r.verifyOkLast)} 闸拍=${String(r.autoVerifyBeats)} 返修=${RECOVERY_TOKEN[r.verifyRecovery]} 隐藏=${HELD_OUT_TOKEN[judgeHeldOut(t.spec?.heldOut, r.heldOutRun, r.heldOutInstallErrs).state]} `
      + `逐名=${r.namedSets === undefined ? NO_NAMED_SET_TOKEN : NAMED_SET_TOKEN[r.namedSets.state]} 提供者=${r.providerFace} `
      + `工具=${String(r.toolCalls)}/${String(r.toolFailures)}败 `
      + `重复=${String(r.repeatedSameAction)} 请求=${String(r.requests)} 拨数=${String(r.attempts)} tok=${String(r.tokensIn)}/${String(r.tokensOut)} `
      + `${moneyText(r.cny)} ${String(Math.round(r.seconds))}s 内存峰=${String(r.resources.rssPeakMb)}MB/${String(r.resources.procPeak)}进程 cpu=${String(r.resources.cpuMs)}ms`
      + (g.fails.length > 0 ? " 〔" + g.fails.join("；") + "〕" : "")
      + (r.attempts > 1 || !v.valid ? " 〔重拨账：拨 " + String(r.attempts) + " 趟／共等 " + String(r.retryWaitMs) + "ms／" + r.retryWhy + "〕" : "")
      + (v.valid ? "" : " 《" + v.why + "》"),
    );
    /* 失败轨迹留档那一跳（#109）：**选择面只有这一处**，递给留档器的就是上面刚印出来的那个 verdict——
     * 跑器自己算的 per-target 成败（`grade()` 那张判据表 + `runValidity()` 的分母口径）。
     * 这里不另写一份"什么算失败"，`keepFailedTrace` 那边也不重算：它只认 `FAILED_VERDICT` 这一枚令牌。
     * 「无效」那几趟（未起步/被 provider 打断）因此不会留档——那几趟没跑到模型做事，
     * 固化出来的尺子量的是限流器而不是 agent。 */
    await retainStagedRuns(STAGED.splice(stagedMark), verdict, traceKeeps);
  }
}
/* 兜底：跑到这里 STAGED 应当已经空了（每一行都自己收）。还有剩 ⇒ 是上面某条路没收到，
 * 出声并收掉，不让临时目录在 /tmp 里长驻——「取不到 ≠ 没问题」，「没剩」也要有人证。 */
if (STAGED.length > 0) {
  console.error(`[loop-eval] 有 ${String(STAGED.length)} 个临时目录没被逐行收掉 ⇒ 当场清掉（这一格的形状说明留档那一步漏了分支）`);
  for (const s of STAGED.splice(0)) await rm(s.dir, { recursive: true, force: true }).catch(() => {});
}
const t0 = tally(rows);
// 钱与分母同面：被剔掉的趟次花的钱**单列**（那是真钱），但不许混进"每达标任务"的分子。
const money = costSplit(rows);
const cny = money.paidAll;
if (t0.refuse) {
  // 与"任务集解析报错"同一条纪律：**分母不完整时任何分数都是假的** ⇒ 拒绝出数，只留证据。
  console.error(`[loop-eval] 一趟都不算数（${String(t0.invalid)} 趟全部未起步/被打断）⇒ **拒绝出数**：`
    + `分母为空时印出来的成功率只会误导（原文："分母不完整时任何分数都是假的"）`);
} else if (!PRICE.known) {
  // 量不出来 ⇒ 钱这一格**空着出声**，不许印 ¥0.000（那是最容易被读成"没花钱"的形状）。
  console.log(`[loop-eval] 合计 ${String(t0.pass)}/${String(t0.total)} 达标`
    + (t0.invalid > 0 ? ` · **${String(t0.invalid)} 趟无效未计入分母**（未起步/被 provider 打断）` : "")
    + ` · 实付=${PRICE_UNKNOWN} · 每达标任务=${PRICE_UNKNOWN} 〔${PRICE.why}；token/耗时/内存不受影响〕`);
} else {
  console.log(`[loop-eval] 合计 ${String(t0.pass)}/${String(t0.total)} 达标`
    + (t0.invalid > 0 ? ` · **${String(t0.invalid)} 趟无效未计入分母**（未起步/被 provider 打断）` : "")
    // 分子只用**算数趟次**花的钱（与分母 t0.total 同面）；没算数的趟次花的钱单列——那是真钱，不许藏。
    + ` · 实付≈¥${cny.toFixed(3)}（其中没算数的趟次花 ¥${money.wastedSpend.toFixed(4)}）`
    + ` · 每达标任务 ¥${t0.pass > 0 ? (money.validSpend / t0.pass).toFixed(4) : "∞"}`
    + `〔按算数趟次 ¥${money.validSpend.toFixed(4)} ÷ 达标 ${String(t0.pass)} 算〕`);
}
/* ---- 调用面落盘（#63／#68，2026-10-05 第 379 页）----
 * 为什么非有不可：读数行只记结果，**不记"这一趟是怎么跑的"** ⇒ 同样的 `readings.json`，
 * `--max-steps 30` 与 `--max-steps 50` 长得一模一样，`--reps 1` 与 `--reps 3` 也分不出。
 * 而 #69 那批"撞帽 run"正是靠调用面才认得出来（第 362 页就是拿 30/50 两档才量出暴露面的）；
 * 老留档连"跑了几步"都回查不到，等于那份产物不可复现。
 * `dirty` 一并记：同一棵树脏着跑与干净着跑是两种读数（本仓为这一条栽过多次）。 */
const headSha = ((): string => {
  try {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : "unknown";
  } catch { return "unknown"; }
})();
const dirtyCount = ((): number => {
  try {
    const r = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
    return r.status === 0 ? r.stdout.split("\n").filter((l) => l.trim() !== "").length : -1;
  } catch { return -1; }
})();
// `ranAt` 在跑批开始那一格就已读过钟（见上面 `const ranAt`），这里复用同一个值：
// run.json 的时刻、逐条读数的身份键、留档目录的日期名是**同一趟**的那一张脸。
await writeFile(join(ROOT, OUT, "run.json"), JSON.stringify({
  headSha,
  // -1 = 取不到（不是"干净"）：取不到时印 -1，绝不用 0 冒充干净树。
  dirty: dirtyCount,
  ranAt,
  maxSteps: MAX_STEPS, reps: REPS, system: SYSTEM_MODE, arm: ARM,
  // 模型名**总是记**（#63）：原先只在 BENCH_MODEL 非空时进读数行，于是"用缺省模型跑的"
  // 那一趟回查不到自己拨的是哪一档——而缺省恰恰是最常见的那一档。
  model: (BENCH_MODEL !== undefined && BENCH_MODEL !== "") ? BENCH_MODEL : glmDefaultModelName(),
  tasks: tasks.map((t) => t.id),
}, null, 1), "utf8");
const readingsPath = join(ROOT, OUT, "readings.json");
// 基线不覆盖（#63）：原先每次直写同一份，跑一次就把上一份顶掉——10-01 那份三行冒烟基线
// 就是这样没的。归档判据抽在 `./lib/readings-archive`（带注入 IO ⇒ 判卷喂真行为，
// 而不是扫源码里有没有那句话；第一版就是栽在后者上）。
const archived = archiveExistingReadings({
  dir: join(ROOT, OUT), readingsPath, headSha, nowIso: new Date().toISOString(),
  ops: { exists: existsSync, rename: renameSync },
});
if (archived !== null) {
  console.log("[loop-eval] 上一份 readings.json 已归档（不顶掉别人的基线）：" + archived.replace(ROOT + "/", ""));
}
/* 身份键落进**每条**读数（#90）：`run.json` 只有一份、而 `scripts/eval/report.ts` 的对账面是逐条读读数；
 * 两副不同臂／不同帽／不同 reps 的读数混进同一堆时，配对要先认得各自的脸，否则「同分母」是猜出来的。
 * 全部取**同一趟已算好**的 headSha／ranAt／MAX_STEPS／REPS／ARM——不另取第二处事实源；`r.rep` 本来就在每条读数里。
 *
 * 第 455 页：`providerFace` 也在这里**显式**盖一层。它本来已经由 `buildReading`（上面 `providerFace:` 那一格）
 * 逐条写进 `r`，但那是"每条读数自己算出来的那一枚"，而这一行是"身份章"的落点——
 * 两处的差别是：前者跟着 `x.r` 展开（真写进去了），后者是显式出现在身份章这一行里，
 * 于是「身份键有哪些」这件事在写侧只有**这一行**可查（与 `headSha`／`arm` 同形），
 * 而 `scripts/eval/report.ts` 的 `RUN_IDENTITY_KEYS` 在读侧也只有一处 ⇒ 两侧各自一处、不再有第三份。
 * 取值复用同一趟的 `SCRIPTED` 判定（与 `buildReading` 同一份事实源，不另判一次）。 */
await writeFile(readingsPath, JSON.stringify(rows.map((x) => ({
  ...x,
  r: { ...x.r, headSha, ranAt, maxSteps: MAX_STEPS, reps: REPS, arm: ARM, providerFace: SCRIPTED === "" ? "真会话" : "剧本" },
})), null, 1), "utf8");
/* 返修那一环的可读出口：`≥2 拍` 才是「第一拍代码红 ⇒ 模型真改过盘 ⇒ 再验一次」那条链路走通的样子。
 *  全 0 时先看装配面那一行——是闸没装（off-here），还是装了而没触发（模型自己验过了）。 */
const beatCounts = rows.map((x) => x.r.autoVerifyBeats);
console.log(`[loop-eval] 闸补拍：合计 ${String(beatCounts.reduce((a, b) => a + b, 0))}`
  + `／单趟最多 ${String(beatCounts.length > 0 ? Math.max(...beatCounts) : 0)}`
  + `／≥2 拍的趟次 ${String(beatCounts.filter((n) => n >= 2).length)}（共 ${String(beatCounts.length)} 趟）`);
/* 返修这一格的**分子**：六态逐个数，不做"其它都算没返修"那种合并——
 * 「红没回」「闸补的绿」「归属不可知」「没验」四者的修法完全不同（前两个是模型行为，第三个是取料面，最后一个是装配面）。 */
{
  const states = rows.map((x) => x.r.verifyRecovery);
  const n = (s: VerifyRecovery) => states.filter((x) => x === s).length;
  console.log(`[loop-eval] 返修那一格：模型自己红→绿 ${String(n("modelRecovery"))}`
    + `／闸补的绿 ${String(n("harnessOnly"))}／红没回 ${String(n("notRecovered"))}`
    + `／一次绿 ${String(n("greenFirst"))}／归属不可知 ${String(n("attributionUnknown"))}／没验 ${String(n("noVerify"))}`
    + `（共 ${String(states.length)} 趟）`);
}
/* 逐名那一格的分子：三态各数一次，**没规格的趟次单列**。
 * 为什么要有这行而不只有逐格令牌：「这批一条都没判逐名」与「判了但全读不出」是两种修法
 * （前者改任务集、后者改取料面），把它们并成一个 0 就没人知道该动哪一边。 */
{
  const faces = rows.map((x) => x.r.namedSets);
  const withSpec = faces.filter((f): f is NamedSetReading => f !== undefined);
  const n = (s: NamedSetState) => withSpec.filter((f) => f.state === s).length;
  console.log(`[loop-eval] 逐名那一格：全绿 ${String(n("pass"))}`
    + `／有红 ${String(n("fail"))}／读不出 ${String(n("unreadable"))}`
    + `（有规格 ${String(withSpec.length)} 趟／无规格 ${String(faces.length - withSpec.length)} 趟）`);
}
console.log("[loop-eval] 读数写出 " + OUT + "/readings.json");
/* 失败轨迹留档那一行**永远印**（一条都没留也印）：
 * 「本次没有 FAIL 趟次」与「留档这一跳没接」在盘上长得一模一样，而后者正是 #109 沉默了四百页的形状。
 * 帽的三个数（条数／单条字节／目录总字节）与丢弃计数一起出——被帽挡掉的那几趟必须有名字。 */
console.log(traceKeepLine({
  root: ROOT, out: OUT, day: ranAt.slice(0, 10), outcomes: traceKeeps,
  countCap: TRACE_COUNT_CAP, fileBytesCap: TRACE_FILE_BYTES_CAP, totalBytesCap: TRACE_TOTAL_BYTES_CAP,
}));
