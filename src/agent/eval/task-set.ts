/** 评测任务集的数据层（能力 10）：把"外部基准的任务定义"读成统一的 `TaskSpec`，
 *  并把"这次到底能不能跑"算成有名字的缺口。
 *
 *  为什么单独一支纯模块（不 IO、不 spawn、不 import electron）：
 *   - `scripts/loop-eval.ts` 的 4 个任务是硬编码在脚本里的 ⇒ 想喂一份真实基准数据集进去就得改脚本；
 *     而"改脚本"和"换数据集"是两件事，混在一起时没人能核对读进来的分母对不对。
 *   - 基准适配最容易犯的错是**静默丢条目**：少解析一条就少一分母，而成功率看起来完全正常。
 *     所以这里的规矩是「要么收进 tasks，要么进 errors 并点名行号/字段」，没有第三种出口。
 *   - 可行性（缺仓库快照 / 缺凭据）与"跑出来是红的"必须是两种不同的读数：
 *     前者是**没有尺**，后者才是失败。混起来就会把"0/529 可跑"读成"模型 0 分"。
 *
 *  2026-10-08 补的那一格：SWE-bench 的判卷从前只有那句把两列拼在一起的 `python -m pytest`，
 *  于是「该转绿的没绿」与「该保住的坏了」在退出码上同形。逐名规格现在跟 `command` **同笔产出**
 *  （`TaskSpec.judge`），读它与判它的是 `./test-results`（它零 IO，取料由跑器喂字符串）。
 *  `command` 那句逐字没动 —— `feasibility`／`deriveVerifierProbe`／`scripts/loop-eval.ts` 三个读者
 *  都按它取料，动它是另一件事（而且会把已经校准过的读数换面）。
 */

import { namedSetProblems } from "./test-results";

export interface TaskSeed {
  /** dir = 一个工作目录快照；file = 单文件靶子（本仓 loop-eval 的既有形态）。 */
  kind: "dir" | "file";
  path: string;
}

/** held-out 验收面（SWE-bench 的 FAIL_TO_PASS 那一格）：模型**看不见**的隐藏测试。
 *  可见测试是任务书里明写着要复现的那些 ⇒ 「哄绿可见测试」与「修对根因」同分；
 *  隐藏测试装进副本后单独跑一次，退出码 0 才算这条任务真过。 */
export interface TaskHeldOut {
  /** 待拷贝的隐藏文件：src 相对仓根（在靶子目录**之外**，模型才看不见），dest 相对副本根。 */
  files: { src: string; dest: string }[];
  /** 隐藏验收命令（在副本根跑，退出码 0 = 过）。 */
  command: string;
}

export interface TaskSpec {
  id: string;
  instruction: string;
  seed: TaskSeed;
  /** 判卷命令（退出码 0 = 通过）。缺 = 这条没有判卷，只许当"演示"不许进分母。 */
  verifier?: { command: string };
  /** 隐藏验收面。给了它、`expects` 里就必须有 `heldOutPass`，否则解析报错（见 parseOne 的配对规则）。 */
  heldOut?: TaskHeldOut;
  /** 逐名判卷规格（SWE-bench 的 FAIL_TO_PASS／PASS_TO_PASS 两列）。
   *  它不是 `verifier.command` 的替代品而是**同一件事的第二半**：command 只回答「退出码是不是 0」，
   *  这一枚回答「哪条该转绿、哪条不许坏」。读它的是 `./test-results` 的 `judgeNamedSets`；
   *  列子为空／重叠这类形状问题在解析期就按 `namedSetProblems` 拒收（与 heldOut 同一个 fail-closed 口径）。 */
  judge?: { failToPass: string[]; passToPass: string[] };
  /** 额外判据名（由跑器解释，如 verifyOk / judgeUntouched / heldOutPass）。 */
  expects: string[];
  /** 出处：本仓任务集写来源标签，外部基准写 `repo@commit`。 */
  source: string;
}

export interface ParseResult {
  tasks: TaskSpec[];
  errors: string[];
}

/** 认识哪些字段：拼错的字段名必须报错——静默忽略它，等于允许数据集作者"写了但没生效"。 */
const TASK_FIELDS = new Set(["id", "instruction", "seed", "verifier", "heldOut", "judge", "expects", "source"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** `expects` 里代表「跑隐藏验收」的那一枚（判卷与解析共用这一个名字，别抄第二份字符串）。 */
export const HELD_OUT_EXPECT = "heldOutPass";

/** **已登记的判据名**（任务 #35）。解释它们的那张表在 `scripts/lib/eval-expects.ts`，
 *  登记放在数据层是因为"拒收拼错的名字"必须发生在**解析期**——本文件对字段名早就是 fail-closed 的
 *  （`TASK_FIELDS`，理由写在文件头：静默忽略＝允许数据集作者"写了但没生效"），
 *  而 `expects` 的**名字**从前是自由字符串：拼错的判据安静地不生效，读数照常印。
 *  两支键集相等由判卷核（登记表 ↔ 处理器表），所以这里不写第二份清单。 */
export const EXPECT_NAMES = [
  "clarify",
  "planBeforeWrite",
  "readBeforeWrite",
  "verifyOk",
  "verifyRecovered",
  "judgeUntouched",
  "testNotRewritten",
  "onlySrcChanged",
  "wroteTest",
  HELD_OUT_EXPECT,
] as const;
export type ExpectName = typeof EXPECT_NAMES[number];

const EXPECT_SET: ReadonlySet<string> = new Set<string>(EXPECT_NAMES);

/** 未被登记的判据名（原序、可重复）。空数组＝这一串名字都有人解释。 */
export function unknownExpectNames(expects: readonly string[]): string[] {
  return expects.filter((e) => !EXPECT_SET.has(e));
}

/** heldOut 的形状校验：只认 `{ files: [{src,dest}], command }`，逐条点名缺口。
 *  返回 `errors` 而非抛错——与 verifier/seed 一样，一条坏条目不该带走整份文件的报错清单。
 *  `seedPath` 用来查那条**要命**的不变量：隐藏文件不能住在靶子里（见调用点注释）。 */
function parseHeldOut(v: unknown, at: string, seedPath: string | null): { heldOut?: TaskHeldOut; errors: string[] } {
  // 「没给」与「给坏了」是两件事：绝大多数任务没有隐藏面，把它判成畸形会让整份任务集拒绝出数
  // （10-02 实测第一版就栽在这儿：`isRecord(undefined)` 为 false ⇒ B3…B12 全报「必须是 { files, command }」）。
  if (v === undefined) return { errors: [] };
  if (!isRecord(v)) return { errors: [`${at}：heldOut 必须是 { files, command }`] };
  const errors: string[] = [];
  for (const k of Object.keys(v)) {
    if (k !== "files" && k !== "command") errors.push(`${at}：heldOut 认不出的字段「${k}」`);
  }
  if (!nonEmptyString(v.command)) errors.push(`${at}：heldOut.command 必须是非空字符串（没有验收命令的隐藏测试等于没有验收）`);
  const rawFiles = v.files;
  let files: { src: string; dest: string }[] | undefined;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    errors.push(`${at}：heldOut.files 必须是非空数组（一条隐藏文件都没有 ⇒ 这一格无从验收，不许静默当过）`);
  } else {
    const list: { src: string; dest: string }[] = [];
    rawFiles.forEach((f, i) => {
      const fat = `${at} heldOut.files[${String(i + 1)}]`;
      if (!isRecord(f)) {
        errors.push(`${fat} 必须是 { src, dest }`);
        return;
      }
      for (const k of Object.keys(f)) {
        if (k !== "src" && k !== "dest") errors.push(`${fat} 认不出的字段「${k}」`);
      }
      if (!nonEmptyString(f.src)) errors.push(`${fat}：src 必须是非空字符串（隐藏文件的源路径）`);
      if (!nonEmptyString(f.dest)) errors.push(`${fat}：dest 必须是非空字符串（隐藏文件在副本里的落点）`);
      if (nonEmptyString(f.src) && nonEmptyString(f.dest)) {
        /* 隐藏文件必须住在**这个任务自己的靶子之外**：跑器把 seed 目录整棵拷进副本，
         * 而 src 是从**副本之外**取的。src 若落在 seed 里，它就会被拷进副本 ⇒
         * 模型第一遍 `ls tests/` 直接读到了答案，"held-out" 当场退化成"可见测试"。
         * 这一格不是洁癖：它是这一面**唯一**的成立前提，配一条变异锚点守着。 */
        if (seedPath !== null && (f.src === seedPath || f.src.startsWith(seedPath + "/"))) {
          errors.push(`${fat}：src 落在本任务靶子里（${f.src}）⇒ 隐藏测试会被拷进副本给模型看见，必须放在靶子目录之外`);
        }
        list.push({ src: String(f.src), dest: String(f.dest) });
      }
    });
    files = list;
  }
  if (errors.length > 0 || files === undefined || !nonEmptyString(v.command)) return { errors };
  return { heldOut: { files, command: String(v.command) }, errors };
}

/** 逐名规格的解析：形状在这里管（两列都得是「非空字符串数组」），语义交给共用谓词。
 *  「没给」与「给坏了」照旧分开（heldOut 那一格的教训：把缺省判成畸形会让整批出不了数）；
 *  而空数组／重复／两列重叠这类**写了但自相矛盾**的形状，走 `./test-results` 的 `namedSetProblems`
 *  ——裁决器用的就是那一支，这里再抄一份清单迟早漂。 */
function parseJudge(v: unknown, at: string): { judge?: TaskSpec["judge"]; errors: string[] } {
  // 这行故意不写成与上面 parseHeldOut 那格逐字相同：锚点 heldout-absent-spec-treated-as-broken
  // 按整行字面定位 parseHeldOut，同文件出现两份同字面量 ⇒ replace 只改第一处，那条锚点改到谁不确定。
  if (v === undefined) return { errors: [] as string[] };
  if (!isRecord(v)) return { errors: [`${at}：judge 必须是 { failToPass, passToPass }`] };
  const errors: string[] = [];
  for (const k of Object.keys(v)) {
    if (k !== "failToPass" && k !== "passToPass") errors.push(`${at}：judge 认不出的字段「${k}」`);
  }
  const failToPass = strArray(v.failToPass);
  const passToPass = strArray(v.passToPass);
  if (failToPass === null) errors.push(`${at}：judge.failToPass 必须是非空字符串数组（没有这列就没人知道该转绿什么）`);
  if (passToPass === null) errors.push(`${at}：judge.passToPass 必须是非空字符串数组（缺这一列＝半份判卷；一列都没有请整条不写 judge）`);
  if (failToPass !== null && passToPass !== null) {
    errors.push(...namedSetProblems({ failToPass, passToPass }).map((r) => `${at}：judge ${r}`));
  }
  if (errors.length > 0) return { errors };
  return { judge: { failToPass: failToPass as string[], passToPass: passToPass as string[] }, errors };
}

function parseOne(v: unknown, at: string): { task?: TaskSpec; errors: string[] } {
  if (!isRecord(v)) return { errors: [`${at}：任务必须是对象`] };
  const errors: string[] = [];
  for (const k of Object.keys(v)) {
    if (!TASK_FIELDS.has(k)) errors.push(`${at}：认不出的字段「${k}」（拼错或未支持的写法，不许静默忽略）`);
  }
  const id = v.id;
  const instruction = v.instruction;
  const source = v.source;
  if (!nonEmptyString(id)) errors.push(`${at}：id 必须是非空字符串`);
  if (!nonEmptyString(instruction)) errors.push(`${at}：instruction 必须是非空字符串（空的或纯空白都算没有指令）`);
  if (!nonEmptyString(source)) errors.push(`${at}：source 必须写明出处（本仓标签或 repo@commit）`);
  const seedRaw = v.seed;
  let seed: TaskSeed | null = null;
  if (!isRecord(seedRaw) || (seedRaw.kind !== "dir" && seedRaw.kind !== "file") || !nonEmptyString(seedRaw.path)) {
    errors.push(`${at}：seed 必须是 { kind: "dir"|"file", path: 非空串 }`);
  } else {
    seed = { kind: seedRaw.kind, path: seedRaw.path };
  }
  const verifierRaw = v.verifier;
  let verifier: TaskSpec["verifier"] | undefined;
  if (verifierRaw !== undefined) {
    if (!isRecord(verifierRaw) || !nonEmptyString(verifierRaw.command)) {
      errors.push(`${at}：verifier 给了就必须带非空 command（没有判卷的条目不许进分母）`);
    } else {
      verifier = { command: verifierRaw.command };
    }
  }
  const expectsRaw = v.expects;
  let expects: string[] = [];
  if (expectsRaw !== undefined) {
    if (!Array.isArray(expectsRaw) || expectsRaw.some((x) => !nonEmptyString(x))) {
      errors.push(`${at}：expects 必须是非空字符串数组`);
    } else {
      expects = expectsRaw as string[];
    }
  }
  const ho = parseHeldOut(v.heldOut, at, seed === null ? null : seed.path);
  errors.push(...ho.errors);
  const jd = parseJudge(v.judge, at);
  errors.push(...jd.errors);
  /* 判据名也要 fail-closed：拼错的 name 走不进任何判定分支，而那条任务照样进分母、读数照印
   * ——与"拼错的字段名"是同一种病（本文件头就写着这条纪律，从前只管了字段那一半）。 */
  {
    const unknown = unknownExpectNames(expects);
    if (unknown.length > 0) {
      errors.push(`${at}：expects 里有没登记的判据名 ${unknown.join("、")} ⇒ 没有判定分支，写了也不会生效`
        + `（登记＝EXPECT_NAMES，解释＝scripts/lib/eval-expects.ts）`);
    }
  }
  /* 配对规则只查**一个方向**，因为两个方向的病不一样：
   *  - 给了 heldOut 却不判它 ⇒ 隐藏测试装了、跑了、没人看 ⇒ **静默 no-op**，
   *    与"拼错的字段名"同一种病（数据集作者以为生效了）。解析期就拒，让它根本进不了分母。
   *  - 要 `heldOutPass` 却没给 heldOut ⇒ 这是**判卷缺尺**，不是数据集写错（内建任务、
   *    外部基准条目都可能带着这个 expect 而语料没有隐藏面）。留给跑器印成"不可知"，
   *    而不是在这里把整批拦停——见 `scripts/lib/eval-heldout.ts` 的 `heldOutFailReasons`。 */
  if (ho.heldOut !== undefined && !expects.includes(HELD_OUT_EXPECT)) {
    errors.push(`${at}：给了 heldOut 却不在 expects 里写「${HELD_OUT_EXPECT}」⇒ 隐藏验收装完没人判，属静默不生效，拒收`);
  }
  if (errors.length > 0 || typeof id !== "string" || typeof instruction !== "string" || seed === null) {
    return { errors };
  }
  return {
    task: {
      id, instruction, seed,
      ...(verifier !== undefined ? { verifier } : {}),
      ...(ho.heldOut !== undefined ? { heldOut: ho.heldOut } : {}),
      ...(jd.judge !== undefined ? { judge: jd.judge } : {}),
      expects,
      source: String(source),
    },
    errors,
  };
}

/** 本仓任务集文件（一个 JSON 数组）。 */
export function parseTaskSetJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { tasks: [], errors: ["整份文件不是合法 JSON：" + String((e as Error).message)] };
  }
  if (!Array.isArray(raw)) return { tasks: [], errors: ["任务集顶层必须是数组（收到 " + typeof raw + "）"] };
  const tasks: TaskSpec[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  raw.forEach((entry, i) => {
    const r = parseOne(entry, `第 ${String(i + 1)} 条`);
    errors.push(...r.errors);
    if (r.task === undefined) return;
    const n = (seen.get(r.task.id) ?? 0) + 1;
    seen.set(r.task.id, n);
    if (n > 1) {
      errors.push(`id「${r.task.id}」重复（第 ${String(i + 1)} 条被丢弃——静默去重会让分母骗人）`);
      return;
    }
    tasks.push(r.task);
  });
  return { tasks, errors };
}

const strArray = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => nonEmptyString(x)) ? (v as string[]) : null;

/** SWE-bench 形态（JSONL，一行一个 instance）→ TaskSpec。
 *  只认字段，不猜字段：缺判卷的条目一律作废并说明，而不是给一条"什么都能过"的命令。 */
export function fromSweBenchJsonl(text: string): ParseResult {
  const tasks: TaskSpec[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim().length === 0) return; // 尾换行/空行是文件常态，不算条目也不算错
    const at = `第 ${String(i + 1)} 行`;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      errors.push(`${at}：不是合法 JSON（只作废这一行）：` + String((e as Error).message));
      return;
    }
    if (!isRecord(obj)) {
      errors.push(`${at}：instance 必须是对象`);
      return;
    }
    const id = obj.instance_id;
    const repo = obj.repo;
    const commit = obj.base_commit;
    const statement = obj.problem_statement;
    if (!nonEmptyString(id) || !nonEmptyString(repo) || !nonEmptyString(commit)) {
      errors.push(`${at}：缺 instance_id / repo / base_commit（快照定位不了）`);
      return;
    }
    if (!nonEmptyString(statement)) {
      errors.push(`${at} ${id}：problem_statement 为空 ⇒ 这条没有指令`);
      return;
    }
    const failToPass = strArray(obj.FAIL_TO_PASS);
    if (failToPass === null || failToPass.length === 0) {
      errors.push(`${at} ${id}：缺 FAIL_TO_PASS ⇒ 没有判卷的条目不许进分母（否则"0 条判卷通过"会被读成分数）`);
      return;
    }
    const passToPass = obj.PASS_TO_PASS === undefined ? null : strArray(obj.PASS_TO_PASS);
    if (passToPass === null) {
      errors.push(`${at} ${id}：缺/坏 PASS_TO_PASS ⇒ 只查"坏的要过"、不查"好的不许坏"，是半份判卷`);
      return;
    }
    tasks.push({
      id,
      instruction: statement,
      seed: { kind: "dir", path: `eval-snapshots/${id}` },
      // 这里**不**把 FAIL_TO_PASS 拆成 heldOut：外部条目在 loop-eval 里 `external: true`，
      // 跑器一条都不执行 ⇒ 拆出来的隐藏面没有消费者（"生产者有、观察者无"是本仓反复踩的那一族）。
      // 等真接进外部靶子执行时再拆，届时 dest/command 的形状要跟那边的测试框架对齐，不是现在猜。
      verifier: { command: ["python", "-m", "pytest", "-rA", ...failToPass, ...passToPass].join(" ") },
      // 同一份取料（上面那两列，fail-closed 之后才走到这儿）**同时**登记成逐名规格：
      // 那句 command 只能回答「退出码是不是 0」，而基准问的是「哪条该转绿、哪条不许坏」。
      // 逐名面由 `./test-results` 的 `judgeNamedSets` 判 —— 两列在这里必须是**同一个来源**，
      // 所以在别处再拼一份清单就是给自己埋第二份会漂的账。
      judge: { failToPass, passToPass },
      expects: ["verifyOk", "judgeUntouched"],
      source: `${repo}@${commit}`,
    });
  });
  return { tasks, errors };
}

export interface EnvProbe {
  /** 快照是否已在本地（本模块不联网、不 clone——那是外部的钱与时间）。 */
  hasRepoSnapshot(task: TaskSpec): boolean;
  hasCredentials(): boolean;
  /** 判卷命令在这台机器上跑得起吗（调用方去 spawn；本模块不 IO、不 spawn）。 */
  canRunVerifier(task: TaskSpec): boolean;
}

export interface Feasibility {
  runnable: boolean;
  /** 不可跑的原因，逐条指名（缺哪个快照/哪份凭据）。 */
  blockers: string[];
}

/** 从判卷命令推一条**自检命令**：只回答"工具链在不在"，不去跑真判卷。
 *  为什么不是"看首个词在不在 PATH"：SWE-bench 形态判卷是 `python -m pytest`，
 *  本机实测 `python3` 在而 **pytest 没装** ⇒ 只看可执行文件会假绿，把"没有尺"送进分母当 0 分。
 *  认不出的形状（相对路径脚本、复合命令、`-m` 后没有模块名）**一律 null**，由调用方按未证处理——
 *  宁缺不编：编一条跑不通的自检等于再造一种假绿。 */
export function deriveVerifierProbe(command: string): string | null {
  const raw = command.trim();
  if (raw === "" || /[|&;]/u.test(raw) || raw.includes("$(")) return null;
  const toks = raw.split(/\s+/u);
  const bin = toks[0] ?? "";
  if (!/^[A-Za-z0-9._-]+$/u.test(bin)) return null; // 带路径或带怪字符：不是 PATH 上的裸命令名
  const mIdx = toks.indexOf("-m");
  if (mIdx >= 0) {
    const mod = toks[mIdx + 1];
    if (mod === undefined || !/^[A-Za-z_][A-Za-z0-9_.]*$/u.test(mod)) return null;
    return `${bin} -c "import ${mod}"`; // `-m` 缺的是模块，不是解释器：两个不同的缺口
  }
  return `${bin} --version`;
}

/** 一条任务现在能不能真跑。 */
export function feasibility(task: TaskSpec, probe: EnvProbe): Feasibility {
  const blockers: string[] = [];
  if (!probe.hasRepoSnapshot(task)) {
    blockers.push(`缺仓库快照 ${task.source}（定位 ${task.seed.path}）——本模块不联网 clone，需预先 fetch`);
  }
  if (task.verifier === undefined) {
    blockers.push(`没有判卷命令 ⇒ 只能当演示，不许进分母`);
  } else if (!probe.canRunVerifier(task)) {
    // 与"跑出来是红的"分开：缺工具链是**没有尺**，计成 0 分就是把环境问题写成模型能力。
    blockers.push(`判卷命令在本机跑不起来（工具链缺失：${task.verifier.command}）⇒ 属未证，不许计成 0 分`);
  }
  if (!probe.hasCredentials()) {
    blockers.push("缺模型凭据（CAIRN_API_KEY / CAIRN_ENDPOINT）⇒ 跑不了真模型，属未证不是通过");
  }
  return { runnable: blockers.length === 0, blockers };
}

export interface FeasibilityAggregate {
  total: number;
  runnable: number;
  /** false = 一条都跑不了 ⇒ 这是"没有尺"，不许被读成成功率 0。 */
  measurable: boolean;
  reason: string;
}

/** 聚合读数：比值永远带着它的分母一起出现。 */
export function aggregateFeasibility(rows: readonly Feasibility[]): FeasibilityAggregate {
  const runnable = rows.filter((r) => r.runnable).length;
  const measurable = rows.length > 0 && runnable > 0;
  return {
    total: rows.length,
    runnable,
    measurable,
    reason: measurable
      ? ""
      : rows.length === 0
        ? "任务集为空 ⇒ 没有尺（不是 0 分）"
        : `${String(rows.length)} 条任务全部不可跑 ⇒ 基准读数无从谈起，先看 blockers 里缺什么`,
  };
}
