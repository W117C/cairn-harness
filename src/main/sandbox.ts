// macOS Seatbelt 沙箱：写收敛到工作区 + 敏感目录拒读 + 默认断网（拍板：读先全开）。
// 坑一：SBPL 路径必须是 realpath（/tmp 实为 /private/tmp），否则规则静默失效；
//       路径不存在时按原样写入 profile（规则对不上 = 拒绝，fail-closed）。
// 坑二：必须 (allow process*) 与 (allow signal)，否则子进程 Abort / EPERM（vitest worker 要 signal）。
// 坑四：sandbox-exec 不清环境变量 —— env 消毒是本模块的活（白名单 + 秘密名剥除）。
import { realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type ToolResult } from "../tools/base";
import { createOutputRing } from "../tools/output-ring";
import { killGroup, sanitizedEnv, spawnTracked } from "../tools/process";

const OUTPUT_LIMIT = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

/** 敏感目录（相对 HOME）：读取一律拒绝。 */
const SENSITIVE = [".ssh", ".aws", ".config/gcloud", "Library/Keychains"];

export interface SandboxStatus {
  available: boolean;
  reason?: string;
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** 网络面（§11.4 的「Restricted → Enabled」那一行在 OS 侧的落点）。
 *  - `deny`（缺省）：profile 里一条 network 规则都不写，`(deny default)` 闭箱即全断网。
 *  - `allow`：**只供人工批准过的网络命令一次性使用**——§11.4 红线「任何档位下网络全开都不是
 *    免批条件」，所以调用方必须只在 `verdict === "ask"` 且已 approved 的分支上取这一支。
 *  SBPL 没有 host 级匹配（要做逐域名放行得起一个代理，而 §11.9 定稿不做 MITM/代理），
 *  故粒度 = 单次命令；这也是本仓与方案书表述的唯一偏差，已在 outputs/architecture-uplift 记档。 */
export interface SandboxProfileOptions {
  network?: "deny" | "allow";
}

/** 生成 SBPL profile：写收敛到 writableRoot（realpath），敏感目录拒读，network 按 opts 决定。 */
export function buildSandboxProfile(writableRoot: string, opts: SandboxProfileOptions = {}): string {
  const root = real(writableRoot);
  const home = real(homedir());
  const lines = [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal)",
    "(allow sysctl-read)",
    "(allow file-read*)",
  ];
  if (opts.network === "allow") {
    lines.push("(allow network-outbound)", "(allow network-inbound)");
  }
  for (const rel of SENSITIVE) {
    lines.push('(deny file-read* (subpath "' + join(home, rel) + '"))');
  }
  lines.push('(allow file-write* (subpath "' + root + '"))');
  lines.push('(allow file-write* (subpath "/dev/null"))');
  return lines.join("\n");
}

/** Seatbelt 断网在命令侧的真实形状（三种实测串见 tests/sandbox.test.ts 的锚点）。
 *  两条刻意排除：
 *  - 「Failed to connect / Couldn't connect」——目标端口本来没人监听时它也出现，那是真失败不是被拦；
 *  - 裸「operation not permitted」/「EPERM」——工作区外**写**被拒时打印的就是它，会把写拒绝说成断网。
 *    所以只认 `connect EPERM` 这一条带连接语义的形状。 */
const NETWORK_DENIAL_RE = /connect EPERM|could not resolve host|name or service not known|temporary failure in name resolution|network is unreachable|ENETUNREACH|EADDRNOTAVAIL/i;

/** 输出是否像「被默认 profile 断网拦下」（供 run_shell 与 verify 两条出口共用，不各抄一份）。 */
export function looksLikeNetworkDenial(output: string): boolean {
  return NETWORK_DENIAL_RE.test(output);
}

/** 断网时贴给模型的一行说明：裸 OS 串只会让它原样重试（白烧一轮），这里直接给下一步。 */
export const NETWORK_DENIED_NOTE =
  "[sandbox] 上述失败形如「被默认沙箱断网」而非命令写错：默认 profile 不放行任何网络。" +
  "确需出网就重发同一条命令——权限层认网络类命令并只给一次性批准（网络放行永不免批）。";

/** 网络放行的**唯一**取用判据（§11.4 红线「任何档位下网络全开都不是免批条件」的实现点）。
 *  三条同时成立才给 allow：命令被认成网络类、这一条确实问过人工、人点了批准。
 *  抽成纯函数的理由：auto 档的 L4-pass 与无人值守 fail-closed 都必须落在这张真值表里，
 *  而不是散在调用方的 if 里——散着写就会出现「分类器命中即放行」那种旁路。
 *
 *  覆盖面提醒（改这张表时必须一起看）：这里的 `wantsNetwork` 只管**子进程**那条路
 *  （沙箱 profile 拦的是 shell 的网络）。非 shell 工具在主进程里发包，profile 拦不到，
 *  所以 `web_fetch`（抓网页）走的是另一条同口径的路——权限层 `staticRisk` 给 `high`，
 *  四档都在 `L4-risk` 出口被问，且 `isNetworkCommandCall` 把它钉成一次性 scope
 *  （不落「总是允许」规则）。两处是同一句红线，**各自都要在**；这里这一处只说明它管不到工具面。 */
export function networkProfileFor(input: { wantsNetwork: boolean; asked: boolean; approved: boolean }): "allow" | "deny" {
  return input.wantsNetwork && input.asked && input.approved ? "allow" : "deny";
}

/** 给已定形的结果补断网提示：`run_shell` 直连路径（融合分支）用；
 *  `runInSandbox` 内部走同一只判据与同一句文案，两处不各抄一份。 */
export function annotateNetworkDenial(result: ToolResult, network: "deny" | "allow" = "deny"): ToolResult {
  if (network === "allow" || !looksLikeNetworkDenial(result.output)) return result;
  return { ...result, output: result.output + "\n" + NETWORK_DENIED_NOTE };
}

/** 沙箱子进程环境：白名单 + 秘密剥除 + TMPDIR 指向工作区内 .tmp（写收敛）。
 *  实现在 src/tools/process（与 run_shell / verify / LSP 共用同一套消毒——见 P1-1）。 */
export function sandboxEnv(tmpDir: string): NodeJS.ProcessEnv {
  return sanitizedEnv(tmpDir);
}

export interface SandboxRunOptions {
  cwd: string;
  /** 默认 = cwd（工具语义：沙箱根与工具工作区一致）。 */
  writableRoot?: string;
  timeoutMs?: number;
  /** 网络面，缺省 deny。allow 的取用条件见 `SandboxProfileOptions.network`（永不免批）。 */
  network?: "deny" | "allow";
  /** 取消信号：与 run_shell/verify 同一条收束语义——abort 即整组 kill，不等超时。 */
  signal?: AbortSignal;
}

/** 在 sandbox-exec 内执行 bash -c；结果形态与 src/tools/run_shell 对齐（截断/超时/退出码）。
 *  「对齐」靠的是同一只 `createOutputRing`：这条路径是**沙箱开着时** verify 与 run_shell 的实际出口
 *  （`verifyExec` / agent-runner 的无融合分支都走这里），它若只留头部，验证门的尾部结论就到不了模型。 */
export async function runInSandbox(command: string, opts: SandboxRunOptions): Promise<ToolResult> {
  if (opts.signal?.aborted) {
    return { ok: false, output: "[cancelled] 会话已取消，沙箱命令未执行", exitCode: null, timedOut: false };
  }
  const profile = buildSandboxProfile(opts.writableRoot ?? opts.cwd, { network: opts.network });
  const tmp = join(real(opts.cwd), ".tmp");
  await mkdir(tmp, { recursive: true });
  // 取消可以落在 await mkdir 期间：入口那次检查已经过去了，不能因为「监听还没挂」就继续 spawn。
  if (opts.signal?.aborted) {
    return { ok: false, output: "[cancelled] 会话已取消，沙箱命令未执行", exitCode: null, timedOut: false };
  }
  return await new Promise<ToolResult>((settle) => {
    const ring = createOutputRing(OUTPUT_LIMIT);
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const collect = (chunk: Buffer): void => ring.push(chunk);
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const detach = (): void => { opts.signal?.removeEventListener("abort", onAbort); };
    /** 幂等收束：超时/取消主动 settle，不等孙进程放掉 stdout（P1-2）。 */
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      handle.dispose();
      detach();
      let output = ring.read();
      if (timedOut) output += "\n[error: 沙箱命令超时（" + String(Math.round(timeout / 1000)) + "s），已强制终止]";
      else if (aborted) output += "\n[cancelled] 会话已取消，沙箱命令已中止";
      else if (code !== 0) output += "\n[exit code: " + String(code) + "]";
      // 断网提示只在本轮走默认（deny）支时贴：allow 支下网络已放行，再贴就是假信号。
      // 与退出码无关——`curl …; echo rc=$?` 这类写法让退出码归 0，而模型看到的是解析失败。
      if (opts.network !== "allow" && looksLikeNetworkDenial(output)) output += "\n" + NETWORK_DENIED_NOTE;
      settle({ ok: !aborted && code === 0 && !timedOut, output: output.replace(/\n+$/, ""), exitCode: code, timedOut });
    };
    const handle = spawnTracked("sandbox-exec", ["-p", profile, "bash", "-c", command], {
      cwd: opts.cwd,
      env: sandboxEnv(tmp),
      timeoutMs: timeout,
      onTimeout: () => {
        timedOut = true;
        finish(null);
      },
    });
    const onAbort = (): void => {
      if (settled) return;
      aborted = true;
      killGroup(handle.child);
      finish(null);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    // spawn 与 addEventListener 之间也可能已经 abort：对已 abort 的 signal 挂监听不会再触发，
    // 必须主动补一次，否则这一次已经启动的进程会跑到超时。
    if (opts.signal?.aborted) onAbort();
    handle.child.stdout?.on("data", collect);
    handle.child.stderr?.on("data", collect);
    handle.child.on("error", (err) => {
      if (settled) return;
      settled = true;
      handle.dispose();
      detach();
      // 起不来 = 没有退出码、也没超时：与 finish() 那条出口同一套字段口径（别让读者去猜缺席含义）。
      settle({ ok: false, output: "sandbox-exec: " + err.message, exitCode: null, timedOut: false });
    });
    handle.child.on("close", (code) => finish(code));
  });
}

/** 可用性自检：sandbox-exec 存在且 profile 能编译执行（跑一条 no-op）。不可用 → 应用降级。 */
export async function checkSandbox(): Promise<SandboxStatus> {
  try {
    const res = await runInSandbox("true", { cwd: tmpdir(), timeoutMs: 10_000 });
    if (!res.ok) return { available: false, reason: "自检失败: " + res.output.slice(0, 160) };
    return { available: true };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
