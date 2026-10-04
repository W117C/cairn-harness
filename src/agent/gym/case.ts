// M5a 靶场 case 加载与校验（§m5-proposal 步骤 2/3）：纯函数 + 只读 IO，可单测。
// 冻结纪律：fixtures/gym/cases/** 与 index.json 登记进 scripts/frozen-sha256.json，
// 改 case = 改判据 = 作弊（gym-check A3 + gate-check H7 漂移守卫双保险）。
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

export interface GymExpect {
  mustPassVerify: boolean;
  /**
   * 必改文件：**最终状态与原始不同**才算「改了」。
   *
   *  ⚠️ **与题面必须逐条对账，否则是自造矛盾**（2026-10-04 同一晚连踩两次，`generated-file` case）：
   *  · 第一版把题目**要求重跑生成**的 `src/routes.generated.js` 写进 `mustNotChangeFiles`
   *    ⇒ 评分（`score.ts:36-37`：`forbidden.filter(f => changedFiles.includes(f))`）必然判「禁改文件动了」
   *    ⇒ **题目构造上无解**，实测 score=0 而模型每一步都做对了。
   *  · `mustNotChangeFiles` 判的是**结果**，不是**手段**；`forbidTools` 判的是**手段**。
   *    一条约束能在两者里选，就不要在两处都写——两处写的版本必然有一处和题面打架。
   *
   *  识别信号：**`score=0` 且逐条看事件流发现模型每一步都合理** ⇒ 错在 expect.json，不在模型。
   */
  mustChangeFiles: string[];
  mustNotChangeFiles: string[];
  maxTurns?: number;
  /** **可选**（2026-10-04 P0-c 新增）：本 case 的「该调哪些工具」——命中其中任一即算选对。
   *  可选而不是必填，是为了**不动任何冻结 case**：`fixtures/gym/cases/**` 全在
   *  `scripts/frozen-sha256.json` 里，加必填字段等于让全部既有 case 立刻变红。
   *  没声明时读数一律 `null`（分母为 0），**不许**退回「默认全对」——那正是
   *  `tool-choice.ts` 开头点名的同款陷阱（代理量被当准确率读）。 */
  expectTools?: string[];
  /** **可选**：本 case 绝不该调的工具。命中任何一件即记一次漏拦。
   *
   *  ⚠️ **硬约束：禁令不得与题目的必需路径相交**（2026-10-04 实测踩到，代价是整条 case 作废）。
   *  真实事故：`generated-file` case 的题面要求「改模板后跑 case fixture 里的生成脚本重跑生成」，
   *  而那一步**只能用 `run_shell`**；第一版却把 `run_shell` 写进了 `forbidTools`
   *  ⇒ **题目在构造上无解**，实测 4/4 `score=0` 且 `漏拦率=1`。逐条读事件流才发现：
   *  读模板、读生成脚本、grep 判卷期望值、改模板、跑生成——**每一步都做对了**，
   *  唯一被禁的那一步正是题目要求的那一步。
   *
   *  ⇒ 写禁令前的自问：**完成本题非用它不可吗？** 是 ⇒ 不能禁。
   *  「别走捷径」这类约束优先用 `mustNotChangeFiles` 承担（它判的是**结果**，
   *  而 `forbidTools` 判的是**手段**，手段禁令最容易和必需路径打架）。
   *  识别信号：**`score=0` 与 `漏拦率=1` 同时出现**，先怀疑禁令本身，而不是先怀疑模型。 */
  forbidTools?: string[];
}

export interface GymChange {
  path: string;
  content: string;
}

/** 已知错误解法：套用到 repo 副本后必须被尺子判失败（A2 反例控制）。 */
export interface GymNegative {
  reason: string;
  changes: GymChange[];
}

export interface GymCase {
  id: string;
  /** case 根目录（fixtures/gym/cases/<id>）。 */
  dir: string;
  /** case repo（pristine 判卷靶子）。 */
  repoDir: string;
  taskPath: string;
  task: string;
  expect: GymExpect;
  negative: GymNegative;
}

export interface GymIndexEntry {
  id: string;
  path: string;
  description?: string;
}

export interface GymIndex {
  version: number;
  cases: GymIndexEntry[];
}

/** 索引条目必须落在 cases 根目录之内（且非绝对路径）。
 *  为什么这条要紧：`gym-check` A3 的 sha256 冻结只 walk `fixtures/gym/cases`，而 `loadCase` 是
 *  `join(root, entry.path)` ⇒ 一条指向 cases 之外（例如刚生成的 `../drafts/<id>`）的条目
 *  会以「判据」身份被跑起来，却不在任何哈希守卫的覆盖面里——改它没人发现。
 *  靶场草稿（`src/agent/gym/draft.ts`）因此必须留在索引之外，promote 才是一次有人的动作。 */
export function casePathProblem(root: string, path: string): string | null {
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) return "绝对路径";
  const rel = relative(root, join(root, path));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return "逃出 cases 根目录";
  return null;
}

export async function loadGymIndex(root: string): Promise<GymIndex> {
  const raw = JSON.parse(await readFile(join(root, "index.json"), "utf8")) as GymIndex;
  if (raw.version !== 1) throw new Error("gym index version 不识别: " + String(raw.version));
  if (!Array.isArray(raw.cases) || raw.cases.some((c) => typeof c.id !== "string" || typeof c.path !== "string")) {
    throw new Error("gym index cases 条目必须含 id/path 字符串");
  }
  for (const c of raw.cases) {
    const bad = casePathProblem(root, c.path);
    if (bad !== null) throw new Error(`gym case ${c.id} 的 path 不合法（${bad}）：判据必须在冻结面之内`);
  }
  return raw;
}

export function validateExpect(e: GymExpect): void {
  if (typeof e.mustPassVerify !== "boolean") throw new Error("expect.mustPassVerify 必须为布尔");
  if (!Array.isArray(e.mustChangeFiles) || !e.mustChangeFiles.every((f) => typeof f === "string")) {
    throw new Error("expect.mustChangeFiles 必须为 string[]");
  }
  if (!Array.isArray(e.mustNotChangeFiles) || !e.mustNotChangeFiles.every((f) => typeof f === "string")) {
    throw new Error("expect.mustNotChangeFiles 必须为 string[]");
  }
  if (e.maxTurns !== undefined && (!Number.isInteger(e.maxTurns) || e.maxTurns < 1)) {
    throw new Error("expect.maxTurns 必须为正整数");
  }
}

/** 加载单个 case：task.md / expect.json / negative.json 三件套缺一即 fail-loud。 */
export async function loadCase(root: string, entry: GymIndexEntry): Promise<GymCase> {
  const dir = join(root, entry.path);
  const taskPath = join(dir, "task.md");
  const expect = JSON.parse(await readFile(join(dir, "expect.json"), "utf8")) as GymExpect;
  const negative = JSON.parse(await readFile(join(dir, "negative.json"), "utf8")) as GymNegative;
  const task = await readFile(taskPath, "utf8");
  validateExpect(expect);
  if (typeof negative.reason !== "string" || !Array.isArray(negative.changes)) {
    throw new Error("negative.json 必须含 reason + changes[]");
  }
  return { id: entry.id, dir, repoDir: join(dir, "repo"), taskPath, task, expect, negative };
}

/** 靶场临时目录：mkdtemp 后必须 realpath——macOS /tmp 实为 /private/tmp，
 *  沙箱规则与路径比对都会静默失效（AGENTS.md 已记此坑）。 */
export async function gymTempDir(prefix = "gym-"): Promise<string> {
  return await realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/** 拷贝 case repo 到目标目录并套用 changes（反例控制 A2 与 runner 共用）。 */
export async function copyRepoAndApply(srcRepo: string, dest: string, changes: GymChange[]): Promise<void> {
  await cp(srcRepo, dest, { recursive: true, force: true });
  for (const c of changes) {
    const p = join(dest, c.path);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, c.content, "utf8");
  }
}
