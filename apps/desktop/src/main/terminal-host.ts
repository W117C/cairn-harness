// terminal 窗格的主进程宿主：macOS 用 Python 标准库分配 PTY，起登录 shell。
// 为什么不是 node-pty：它需要按 Electron ABI 编译 native 模块（构建链风险高）。
// 为什么不是 script(1)：BSD script 要求自身 stdin 是 tty（`tcgetattr: Operation not supported
// on socket`——实测），我们的 stdin 是管道 ⇒ 它起不来。pty.spawn 从管道 IO 转发亦工作（实测：
// 真 prompt、ANSI 色、回显、命令输出全通）——代价是依赖系统/用户有 python3（缺失时 spawn
// error 走 fail-visible 推送，不冒充可用）。
// 推送注入式（outbox 风格），headless 判卷可收集输出。
// 非 darwin 明确拒绝（fail-visible——pty.spawn 的转发语义按 POSIX 成立，Windows 无此路径）。
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { Writable } from "node:stream";
import { PTY_BRIDGE } from "./pty-bridge";

export type TerminalPush =
  | { kind: "data"; id: string; data: string }
  | { kind: "exit"; id: string; code: number | null };

/** 宿主窗口只提供生命周期；PTY 实现不依赖 Electron，Node 判卷可直接运行。 */
interface TerminalOwner {
  isDestroyed(): boolean;
  once(event: "closed", listener: () => void): unknown;
}
interface Session { proc: ChildProcessWithoutNullStreams; control: Writable | null; owner?: TerminalOwner }

/** UTF-8 跨块解码（终端输出面）。
 *
 *  为什么不能 `chunk.toString("utf8")`：那是一次性解码，**跨块边界的多字节字符会被拆坏**——
 *  一个汉字的三个字节分两次 pipe 读到达时，第一块解成 U+FFFD，第二块剩下两个续字节也解成 U+FFFD
 *  ⇒ 中文与 emoji 在终端窗格里变成乱码（实测："你好，世界 🌍" 被切成 4 块后
 *  `toString` 得 "你好" "世" " 🌍 "，StringDecoder 得 "你好" "，世" "界 🌍"）。
 *  符号只对 ASCII 无害，但中文文件名、git 中文提交信息、代码里的中文注释都会走这条路。
 *
 *  单源：终端宿主与判卷都走这一份（`StringDecoder` 保留未完成的字节序列等下一块补齐）。
 *  stdout 与 stderr 各持一份：它们是**两条独立的字节流**，用同一个解码器会把 A 流的前半个字
 *  与 B 流的后半个字拼成一个假字符。 */
export class Utf8ChunkDecoder {
  private readonly dec = new StringDecoder("utf8");
  write(chunk: Uint8Array): string {
    return this.dec.write(Buffer.from(chunk));
  }
  /** 流结束：把还挂着的残字节收尾（不静默丢——残留至少变成一个替换字符而不是消失）。 */
  end(): string {
    return this.dec.end();
  }
}


export class TerminalHost {
  private readonly sessions = new Map<string, Session>();
  private readonly starting = new Set<ChildProcessWithoutNullStreams>();
  private readonly observedOwners = new WeakSet<TerminalOwner>();
  constructor(private readonly push: (event: TerminalPush) => void) {}

  /** 起一个新终端（cwd = 工作区；初始 80×24，随后跟随 xterm 实际行列）。 */
  async start(cwd: string | null, env: NodeJS.ProcessEnv = process.env, owner?: TerminalOwner): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    if (owner?.isDestroyed()) return { ok: false, error: "调用窗口已关闭" };
    if (process.platform !== "darwin") {
      return { ok: false, error: "终端窗格当前仅支持 macOS" };
    }
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn("python3", ["-c", PTY_BRIDGE], {
        ...(cwd !== null ? { cwd } : {}),
        env: { ...env, TERM: "xterm-256color" },
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      });
    } catch (err) {
      return { ok: false, error: `终端启动失败：${err instanceof Error ? err.message : String(err)}` };
    }
    this.starting.add(proc);
    try {
      // spawn 先于所有输出事件；启动失败直接回到调用方，不发送一个尚未被 UI 接管的 id。
      await new Promise<void>((resolve, reject) => {
        const spawned = (): void => { proc.off("error", failed); resolve(); };
        const failed = (err: Error): void => { proc.off("spawn", spawned); reject(err); };
        proc.once("spawn", spawned);
        proc.once("error", failed);
      });
    } catch (err) {
      return { ok: false, error: `终端启动失败：${err instanceof Error ? err.message : String(err)}` };
    } finally {
      this.starting.delete(proc);
    }
    if (owner?.isDestroyed() || proc.killed) {
      proc.kill("SIGTERM");
      return { ok: false, error: "终端启动已取消（调用窗口已关闭或应用正在退出）" };
    }
    const id = randomUUID();
    let finished = false;
    const control = proc.stdio?.[3] instanceof Writable ? proc.stdio[3] : null;
    // stdout / stderr 各持一份解码器（两条独立字节流，见 Utf8ChunkDecoder 的注释）。
    const outDec = new Utf8ChunkDecoder();
    const errDec = new Utf8ChunkDecoder();
    const finish = (code: number | null): void => {
      if (finished) return;
      finished = true;
      this.sessions.delete(id);
      // 收尾：解码器里挂着的残字节（截断的多字节字符）不静默丢。
      const tail = outDec.end() + errDec.end();
      if (tail !== "") this.push({ kind: "data", id, data: tail });
      this.push({ kind: "exit", id, code });
    };
    proc.stdout.on("data", (chunk: Buffer) => { this.push({ kind: "data", id, data: outDec.write(chunk) }); });
    proc.stderr.on("data", (chunk: Buffer) => { this.push({ kind: "data", id, data: errDec.write(chunk) }); });
    proc.on("error", (err) => {
      this.push({ kind: "data", id, data: `\r\n[terminal] 进程错误：${err.message}\r\n` });
      // 启动错误已由上方握手返回；运行期 error 也须结束会话，不仅依赖 exit。
      finish(null);
    });
    // exit 只代表进程结束，stdout/stderr 仍可能在排空；此时 end() 会拆坏跨块中文。
    // 立即拒绝后续输入，等 close（所有管道关闭）再收解码器并通知 UI。
    proc.on("exit", () => { this.sessions.delete(id); });
    proc.on("close", (code) => finish(code));
    const transportFailed = (err: Error): void => {
      if (!this.sessions.has(id)) return;
      this.push({ kind: "data", id, data: `\r\n[terminal] 连接已关闭：${err.message}\r\n` });
      this.kill(id);
    };
    proc.stdin.on("error", transportFailed);
    control?.on("error", transportFailed);
    this.sessions.set(id, { proc, control, ...(owner !== undefined ? { owner } : {}) });
    if (owner !== undefined && !this.observedOwners.has(owner)) {
      this.observedOwners.add(owner);
      owner.once("closed", () => {
        for (const [terminalId, session] of this.sessions) if (session.owner === owner) this.kill(terminalId);
      });
    }
    return { ok: true, id };
  }

  /** 用户输入 → shell 的 stdin。未知 id 返回 false（fail-visible，不静默丢）。 */
  write(id: string, data: string): boolean {
    const s = this.sessions.get(id);
    if (s === undefined || s.proc.stdin.destroyed || s.proc.stdin.writableEnded) return false;
    s.proc.stdin.write(data);
    return true;
  }

  /** 控制流只接受内核 winsize 可表示的正整数；隐藏面板的零尺寸不覆盖最后可用行列。 */
  resize(id: string, cols: number, rows: number): boolean {
    if (![cols, rows].every(n => Number.isInteger(n) && n > 0 && n <= 65535)) return false;
    const control = this.sessions.get(id)?.control;
    if (control === undefined || control === null || control.destroyed || control.writableEnded) return false;
    control.write(JSON.stringify({ cols, rows }) + "\n");
    return true;
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (s === undefined) return;
    this.sessions.delete(id);
    s.proc.kill("SIGTERM");
  }

  /** 应用退出对账：不留孤儿 shell。 */
  killAll(): void {
    for (const proc of this.starting) proc.kill("SIGTERM");
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}
