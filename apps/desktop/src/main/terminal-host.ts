// terminal 窗格的主进程宿主：macOS 用 python3 的 pty.spawn 分配 PTY 起登录 shell。
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

export type TerminalPush =
  | { kind: "data"; id: string; data: string }
  | { kind: "exit"; id: string; code: number | null };

interface Session { proc: ChildProcessWithoutNullStreams }

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

/** PTY 桥（python3 单行）：把当前进程 stdin/stdout 转发到子 shell 的 pty 主端。 */
const PTY_BRIDGE = "import pty,os;pty.spawn([os.environ.get('SHELL','/bin/zsh'),'-l'])";

export class TerminalHost {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly push: (event: TerminalPush) => void) {}

  /** 起一个新终端（cwd = 工作区；PTY 尺寸默认——resize 通道留后续）。 */
  start(cwd: string | null, env: NodeJS.ProcessEnv = process.env): { ok: true; id: string } | { ok: false; error: string } {
    if (process.platform !== "darwin") {
      return { ok: false, error: "terminal 窗格当前仅支持 macOS（PTY 经 python3 pty.spawn 分配）" };
    }
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn("python3", ["-c", PTY_BRIDGE], {
        ...(cwd !== null ? { cwd } : {}),
        env: { ...env, TERM: "xterm-256color" },
      });
    } catch (err) {
      return { ok: false, error: `终端启动失败：${err instanceof Error ? err.message : String(err)}` };
    }
    const id = randomUUID();
    let finished = false;
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
      this.push({ kind: "data", id, data: `\r\n[terminal] 启动失败：${err.message}（需要系统装有 python3，且工作目录可进入）\r\n` });
      // ENOENT（python3 不在 / cwd 已删除）只会发 error + close，**不会发 exit**：
      // 旧实现只摘 exit ⇒ 会话永久留在表里、UI 卡在「运行中」、write 静默丢失。
      finish(null);
    });
    proc.on("exit", (code) => finish(code));
    proc.on("close", (code) => finish(code));
    this.sessions.set(id, { proc });
    return { ok: true, id };
  }

  /** 用户输入 → shell 的 stdin。未知 id 返回 false（fail-visible，不静默丢）。 */
  write(id: string, data: string): boolean {
    const s = this.sessions.get(id);
    if (s === undefined) return false;
    s.proc.stdin.write(data);
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
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}
