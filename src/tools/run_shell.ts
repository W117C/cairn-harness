import { middleTruncationNotice, type Tool, type ToolResult } from "./base.js";
import { killGroup, sanitizedEnv, spawnTracked } from "./process.js";

// 输出上限 32KB；只在 ctx.workspace 下执行；超时 60s 强杀。
const SHELL_OUTPUT_LIMIT = 32 * 1024;
/** 超限后的预算分配。旧实现只留头部并在源头停止读取 ⇒ 32KB 之后的内容整段丢弃，
 *  而「哪条测试失败 / npm error / stack 末行」这些结论恰恰在尾部——模型只能重跑一次
 *  `... | tail -50` 才看得见，白花一轮。改成头 + 尾环，总预算一字不加。
 *  提示行自己也算输出：不给它留位就会把「输出 ≤ 32KB」这句承诺撑破（既有 UTF-8 字节判据实测红过一次）。 */
const SHELL_NOTICE_RESERVE_BYTES = 256;
const SHELL_KEEP_BYTES = SHELL_OUTPUT_LIMIT - SHELL_NOTICE_RESERVE_BYTES;
const SHELL_HEAD_BYTES = Math.floor(SHELL_KEEP_BYTES * 0.55);
const SHELL_TAIL_BYTES = SHELL_KEEP_BYTES - SHELL_HEAD_BYTES;
const SHELL_TIMEOUT_MS = 60_000;

export const run_shell: Tool = {
  name: "run_shell",
  async run(args, ctx): Promise<ToolResult> {
    const command = args.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new Error("run_shell: command 参数必须是非空字符串");
    }
    return await new Promise<ToolResult>((settle) => {
      let out = "";        // 未溢出（≤上限）时的全文 ⇒ 输出逐字不变
      let head = "";
      let tail = "";
      let overflowing = false;
      let seen = 0;
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      const collect = (chunk: Buffer): void => {
        const s = chunk.toString("utf8");
        seen += s.length;
        if (!overflowing) {
          out += s;
          if (out.length > SHELL_OUTPUT_LIMIT) {
            overflowing = true;
            head = out.slice(0, SHELL_HEAD_BYTES);
            // 溢出发生在**当前这一次** chunk 内部时（子进程一次性吐完 60KB 很常见），
            // 超出头部的 remainder 必须进尾环——直接 return 会把它连同尾部结论一起丢掉，
            // 于是"保留了结尾"变成一句假话（实测：单次大块写入时尾部为空）。
            tail = out.slice(SHELL_HEAD_BYTES);
            if (tail.length > SHELL_TAIL_BYTES) tail = tail.slice(tail.length - SHELL_TAIL_BYTES);
            out = ""; // 中间段不留（内存帽与旧实现同级：≤上限 + 一个尾环）
          }
          return;
        }
        tail += s;
        if (tail.length > SHELL_TAIL_BYTES) tail = tail.slice(tail.length - SHELL_TAIL_BYTES);
      };
      /** 收束（幂等）：超时路径与 'close' 路径都会走到这里，先到先算。
       *  超时必须主动收束——孙进程持有 stdout 时 'close' 永不触发（P1-2）。 */
      const finish = (code: number | null): void => {
        if (settled) return;
        settled = true;
        handle.dispose();
        let output = overflowing
          ? head + "\n" + middleTruncationNotice(seen - SHELL_HEAD_BYTES - tail.length) + "\n" + tail
          : out;
        if (timedOut) output += "\n[error: run_shell 超时（60s），已强制终止]";
        if (cancelled) output += "\n[error: run_shell 随会话取消终止]";
        if (code !== 0 && !timedOut && !cancelled) output += `\n[exit code: ${String(code)}]`;
        settle({ ok: code === 0 && !timedOut && !cancelled, output: output.replace(/\n+$/, "") });
      };
      // env 消毒：spawn 不传 env 会继承 process.env，而主进程把 BYOK key 写进了
      // process.env.M0_API_KEY —— 一条 `env` 就能把明文 key 读进事件流（P1-1）。
      const handle = spawnTracked("bash", ["-c", command], {
        cwd: ctx.workspace,
        env: sanitizedEnv(),
        timeoutMs: SHELL_TIMEOUT_MS,
        onTimeout: () => {
          timedOut = true;
          finish(null);
        },
      });
      // C12（审查 P2）：会话取消 → 立即组杀在途 shell（旧实现只能等 60s 超时才收束）。
      if (ctx.signal) {
        const onAbort = (): void => {
          if (settled) return;
          cancelled = true;
          killGroup(handle.child);
          finish(null);
        };
        if (ctx.signal.aborted) onAbort();
        else {
          ctx.signal.addEventListener("abort", onAbort, { once: true });
          // 审查 D-8：正常完成路径必须摘掉监听——ctx.signal 是整个 run 级别的，一个 run 里
          // 第 11 次 shell 调用起 Node 打 MaxListenersExceededWarning，且每次的 onAbort 闭包
          // （含 child 引用与 ≤32KB 输出缓冲）被 signal 拖到 run 结束才释放。
          // 与 B7 的 onRootAbort「注册必配对摘除」同口径。
          handle.child.once("close", () => ctx.signal?.removeEventListener("abort", onAbort));
        }
      }
      handle.child.stdout?.on("data", collect);
      handle.child.stderr?.on("data", collect);
      handle.child.on("error", (err) => {
        if (settled) return;
        settled = true;
        handle.dispose();
        settle({ ok: false, output: `run_shell: ${err.message}` });
      });
      handle.child.on("close", (code) => finish(code));
    });
  },
};
