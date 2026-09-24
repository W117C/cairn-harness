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
 */

export interface TaskSeed {
  /** dir = 一个工作目录快照；file = 单文件靶子（本仓 loop-eval 的既有形态）。 */
  kind: "dir" | "file";
  path: string;
}

export interface TaskSpec {
  id: string;
  instruction: string;
  seed: TaskSeed;
  /** 判卷命令（退出码 0 = 通过）。缺 = 这条没有判卷，只许当"演示"不许进分母。 */
  verifier?: { command: string };
  /** 额外判据名（由跑器解释，如 verifyOk / judgeUntouched）。 */
  expects: string[];
  /** 出处：本仓任务集写来源标签，外部基准写 `repo@commit`。 */
  source: string;
}

export interface ParseResult {
  tasks: TaskSpec[];
  errors: string[];
}

/** 认识哪些字段：拼错的字段名必须报错——静默忽略它，等于允许数据集作者"写了但没生效"。 */
const TASK_FIELDS = new Set(["id", "instruction", "seed", "verifier", "expects", "source"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

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
  if (errors.length > 0 || typeof id !== "string" || typeof instruction !== "string" || seed === null) {
    return { errors };
  }
  return { task: { id, instruction, seed, ...(verifier !== undefined ? { verifier } : {}), expects, source: String(source) }, errors };
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
      verifier: { command: ["python", "-m", "pytest", "-rA", ...failToPass, ...passToPass].join(" ") },
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
    blockers.push("缺模型凭据（M0_API_KEY / M0_ENDPOINT）⇒ 跑不了真模型，属未证不是通过");
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
