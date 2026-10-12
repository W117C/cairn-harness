// SEMA Phase 1（方案：docs/sema-proposal.md §3.2 Enforce）：Gate Runner —— 纯编排层。
// 职责：对已注册的 staged 包，按注册时 manifest 声明的门清单**逐道跑闸**，把每道结论经
// registry.recordGate 落账（同门多录以最后一条为准 ⇒ 重跑是全量重验，不是续跑）。
//
// 事实源与安全面：
//  - 本文件**不做任何子进程调用**：真实执行面（runGate）由调用方注入。生产接线在 scripts/ 侧
//    （TCB：命令来自 scripts/gate-manifest.ts 的 `gateCommand()` / package.json scripts），
//    src 只编排「跑哪几道、按什么顺序、结论怎么落账」——模型只能声明门名（parse 契约已对照
//    GATES 校验），「门怎么跑」永远在 TCB 侧，runGate 拿到的就是注入方给死的规格。
//  - 门清单从**账本**读（注册时定格的事实源），不回读 staging——staging 是不可信面的写入口，
//    注册之后被改过也不影响这一轮跑的是哪几道门。
//  - 注入的 runGate 对某道门交不出结论（如命令面缺门）时，由注入方决定成败语义；编排层只认
//    返回的 code——「缺席当通过比跳过更坏」那条规矩在注入面执行。
//  - 缺省首红即停（省墙钟；后续门等下一轮重跑）；detail 只留失败尾巴并剥控制字符
//    （recordGate 的账面纪律：一行一事、可 grep）。
import { RegistryStateError, type ModuleRegistry } from "./registry";

export interface GateCommandSpec {
  cmd: string;
  args: string[];
}

export interface GateRunOutcome {
  code: number;
  output?: string;
}

export interface GateRunResult {
  gate: string;
  passed: boolean;
  detail?: string;
}

export interface GateRunnerOptions {
  registry: ModuleRegistry;
  /** 逐道门的执行面（TCB 注入；产线 = scripts 侧包 gateCommand() 的真实 spawn，测试 = 注桩）。 */
  runGate: (gate: string, opts: { cwd: string; timeoutMs: number }) => Promise<GateRunOutcome>;
  /** 仓库根；门是仓库级判据。 */
  cwd: string;
  /** 每道门的墙钟上限；缺省 10 分钟（交给 runGate 落实）。 */
  timeoutMs?: number;
  /** 缺省 true：首红即停。 */
  stopOnFirstFailure?: boolean;
}

const DEFAULT_TIMEOUT_MS = 600_000;
const DETAIL_TAIL = 400;

function sanitizeDetail(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(-DETAIL_TAIL);
}

export class GateRunner {
  constructor(private readonly opts: GateRunnerOptions) {}

  /** 落账 actor 恒为 gate-runner 本人（谁跑的闸就是谁）。 */
  async runDeclaredGates(id: string, version: string): Promise<GateRunResult[]> {
    const entry = (await this.opts.registry.readIndex()).bundles[id];
    const v = entry?.versions[version];
    if (entry === undefined || v === undefined) {
      throw new RegistryStateError(`${id}@${version} 未注册——先 registerStaged 再跑闸`);
    }
    const results: GateRunResult[] = [];
    for (const gate of v.declaredGates) {
      const run = await this.opts.runGate(gate, { cwd: this.opts.cwd, timeoutMs: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });
      const passed = run.code === 0;
      let detail: string | undefined;
      if (!passed && run.output !== undefined && run.output.trim() !== "") detail = sanitizeDetail(run.output);
      await this.opts.registry.recordGate(id, version, gate, passed, "gate-runner", detail);
      results.push({ gate, passed, ...(detail !== undefined ? { detail } : {}) });
      if (!passed && (this.opts.stopOnFirstFailure ?? true)) break;
    }
    return results;
  }
}
