// M5a 靶场 case 加载与校验（§m5-proposal 步骤 2/3）：纯函数 + 只读 IO，可单测。
// 冻结纪律：fixtures/gym/cases/** 与 index.json 登记进 scripts/frozen-sha256.json，
// 改 case = 改判据 = 作弊（gym-check A3 + gate-check H7 漂移守卫双保险）。
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

export interface GymExpect {
  mustPassVerify: boolean;
  mustChangeFiles: string[];
  mustNotChangeFiles: string[];
  maxTurns?: number;
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
