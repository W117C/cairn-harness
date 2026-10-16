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

/** 缺省靶子：装配根把它作为「没指定工作区时用哪个」的答案（原 `WORKSPACE`，2026-10-17 随本面搬出）。
 *  它就是 `fixtures/todo-app`——**生产 runner 里的缺省靶子是一个 fixture**，这正是审查点名的
 *  「fixtures 硬编码驻留生产 runner」。名字改成 `DEFAULT_WORKSPACE` 是为了让读者一眼看见它是
 *  「缺省」而不是「唯一」；取值一字未动。 */
export const DEFAULT_WORKSPACE = join(ROOT, "fixtures", "todo-app");
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
