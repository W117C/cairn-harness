// 演示/剧本通道的**数据面**：预录剧本路径、demo worker 模型装配、以及 fixture 靶子仓库的缺省路径。
//
// 抽因（结构债审查报告 #2）：这几处 fixtures 硬编码原先直接住在 1,892 行的装配根
// （`src/main/agent-runner.ts`）里。装配根本该是「谁接谁」的接线表，却同时揣着 demo 数据面——
// 「一个文件装着互不相干的域」的典型。搬出来之后，装配根只 import 结果。
//
// ROOT **就地重算**、不从装配根 import：本文件与装配根同在 `src/main/`，同一个式子得同一个值
// （`..` 到 `src`、再 `..` 到仓根）。反过来 import 会把「谁负责定位仓根」变成一次装配根依赖，
// 而本模块的定位就是「不依赖装配根」（同 `session-handlers` / `scheduler-runtime` 那一族的先例）。
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadWorkerScript,
  scriptedWorkerModel,
  type SpawnArgs,
  type WorkerModel,
} from "../agent/orchestrator";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 缺省工作区：**调用方所在目录**（`process.cwd()`），不是 fixture。
 *
 *  2026-10-19 重构：这里原先恒为 `fixtures/todo-app`——「生产 runner 的缺省工作区是一个 git
 *  判卷 fixture」。后果不是"不好看"，是**真污染**：任何没显式给 workspace 的 run
 *  （IPC 会话模式、调度器触发、`runAgent` 省略）都会在收束时往那个 fixture 里写
 *  `.agent/evolution.json`、覆盖 `src/todo.ts`、往 `.agent/snapshots/` 落快照。
 *  实测抓到过一次：`tests/replay-faces.test.ts` 的「靶子整树逐字节不变」在**全量跑**里变红，
 *  点名 `改动 .agent/evolution.json`——写入方是 `tests/runner-gates.test.ts` 的 m1b run
 *  （它持锁，但 replay-faces 那条不变量只护自己那一段，锁管不了"别人也在写靶子"）。
 *  更深一层：判卷 fixture 的纪律是"只读"，而缺省靶子却让**生产路径**把它当运行工作区——
 *  这两件事不可能同时成立，所以缺省值本身就得换掉，不是给 fixture 加白名单。
 *
 *  为什么取 `process.cwd()`：CLI 的 `--workspace` 缺省早就是这个口径（`src/cli.ts:336`
 *  的 `positional.length === 2 ? positional[0] : process.cwd()`），`src/agent/
 *  session-provider.ts:853` 的 `opts.workspace ?? process.cwd()` 也是。三处同一个概念
 *  三种答案是第十三族（同一谓词两份）的温床，这里收成同一个源。
 *  demo / e2e 脚本仍显式传 `fixtures/todo-app`（`scripts/agent.ts`、`scripts/e2e.ts`、
 *  `scripts/routing-check.ts`）——那是"我要打这个靶子"的显式意图，与缺省值无关。 */
export const DEFAULT_WORKSPACE = process.cwd();
export const MOCK_FIXTURE = join(ROOT, "fixtures", "mock", "todo-fix.jsonl");
// M1b 三门演示通道：M1B_GATE_FLOW=1 时用 fixtures/gate/gate-flow.jsonl 驱动（clarify/plan 卡片真人交互）。
// env 门控缺省关闭，M0 事件流字节不变。
const GATE_FIXTURE = join(ROOT, "fixtures", "gate", "gate-flow.jsonl");
// M2g 任务 6：演示通道剧本外部化（fixtures/demo/**，带冻结 sha 于 scripts/frozen-demo-sha256.json；
// **独立**于判卷区 frozen-sha256.json）。缺省零行为不变；显式给路径的旧用法保留。
const DEMO_DIR = join(ROOT, "fixtures", "demo");
const LSP_DEMO_FIXTURE = join(DEMO_DIR, "lsp-demo.jsonl");
// `sidechat-demo.jsonl` 的路径**不在这里**：它随 sidechat 面搬去了 `./sidechat-handlers.ts`
// （那份自己算 ROOT，见该文件 :42）。装配根里那一份声明从搬走起就再无人读——2026-10-17 顺手删掉。

/** 这一轮主会话走的是**预录剧本**吗？是 ⇒ 返回那份剧本的路径；否 ⇒ null。
 *  这五行 env 判定原先只活在 `createProvider` 里，而"这笔用量是不是真钱"要问的是同一件事
 *  ⇒ 抄第二份迟早漂（第十三族）。现在装配与归因都吃这一个式子。
 *  顺序即语义：越靠前的通道越优先（`M3A_MAIN_SCRIPT` 指的是显式文件路径，故要 resolve）。 */
export function scriptedMainModelPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.M3A_MAIN_SCRIPT) return resolve(env.M3A_MAIN_SCRIPT);
  if (env.M3A_AGENTS_DEMO === "1") return join(ROOT, "fixtures", "agents", "main-demo.jsonl");
  if (env.M1B_GATE_FLOW === "1") return GATE_FIXTURE;
  if (env.M1C_AUTONOMY_SCRIPT) return env.M1C_AUTONOMY_SCRIPT;
  if (env.M2A_LSP_DEMO) return env.M2A_LSP_DEMO === "1" ? LSP_DEMO_FIXTURE : env.M2A_LSP_DEMO;
  return null;
}

/** M3A_AGENTS_DEMO 演示通道：spawn 的 model 字段 → fixtures/agents/<name> 脚本模型。
 *  缓存**剧本**而非模型实例——每次 spawn 造新 scriptedWorkerModel（光标独立，同名多 spawn 各自跑全本）。
 *  slow- 前缀的剧本逐事件延迟（截图节奏：一 worker done、一 worker running）。 */
export async function loadDemoWorkerModels(): Promise<(args: SpawnArgs) => WorkerModel | undefined> {
  const dir = join(ROOT, "fixtures", "agents");
  const scripts = new Map<string, Parameters<typeof scriptedWorkerModel>[0]>();
  const names = (await readdir(dir)).filter((f) => f.endsWith(".jsonl") && !f.startsWith("main-"));
  if (names.length === 0) throw new Error("M3A_AGENTS_DEMO：fixtures/agents 下没有 worker 剧本");
  for (const n of names) {
    scripts.set(n, await loadWorkerScript(join(dir, n)));
  }
  return (args: SpawnArgs) => {
    const name = typeof args.model === "string" ? args.model : "";
    const script = scripts.get(name);
    if (!script) return undefined; // 未知剧本名 → 上层 fail-closed 拒绝 spawn
    if (name.startsWith("slow-")) {
      const base = scriptedWorkerModel(script);
      return async function* (messages, tools) {
        for await (const out of base(messages, tools)) {
          await new Promise((r) => setTimeout(r, 700));
          yield out;
        }
      };
    }
    return scriptedWorkerModel(script);
  };
}
