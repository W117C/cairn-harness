/** 第 10 点·模型调用失败/超时：**这一趟是谁叫停的**，决定落不落那条 error（2026-10-23）。
 *
 *  缺陷形状（实测，不是推理）：`loop.ts` 的流边界原来只有一条条件
 *  `if (!isAbortLike(err) && !opts.signal?.aborted)`。而"停滞守卫 abort"与"用户取消"
 *  **共用同一个 `signal.aborted` 为真**——于是对端挂起（`net.ts` 以 Error 作 abort reason：
 *  「停滞超时：Nms 内无任何数据」）这一趟**一条 error 都不落**，事件流里只剩一条 user_message
 *  就戛然而止。而那条 error 正是「为什么停了」的唯一落盘证据——`loop.ts` 末尾那句
 *  「内核异常也要落事件……事后重开/审计完全看不到为什么停了」讲的就是这件事。
 *
 *  两件事必须分开：**用户取消**是正常收束（终态由编排器分类为 cancelled），落红会把
 *  「用户按了停止」读成「出错了」；**对端挂起**是这一趟被打断，必须留证。
 */
import { describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import type { AgentEvent } from "../src/events";
import type { Provider } from "../src/providers";

async function run(opts: { readonly cancel: boolean; readonly message: string }) {
  const log: AgentEvent[] = [];
  const controller = new AbortController();
  const provider: Provider = {
    async *stream() {
      const err = new Error(opts.message);
      err.name = "AbortError"; // net.ts 的停滞守卫用的就是这种形状（以 Error 作 abort reason）
      if (opts.cancel) controller.abort();
      throw err;
    },
  };
  let threw = "";
  try {
    await runLoop({
      provider,
      events: { async append(e: AgentEvent) { log.push(e); } },
      workspace: "/tmp",
      userMessage: "写",
      ...(opts.cancel ? { signal: controller.signal } : {}),
    });
  } catch (err) { threw = (err as Error).message; }
  return { log, threw, errors: log.filter((e) => e.type === "error") };
}

describe("第 10 点：谁叫停的，决定留不留证", () => {
  it("★ 对端停滞（provider 侧 abort）⇒ **必须**落 error：那是「为什么停了」的唯一证据", async () => {
    const r = await run({ cancel: false, message: "GLM 停滞超时：60000ms 内无任何数据（对端挂起或网络黑洞）" });
    expect(r.threw).toContain("停滞超时"); // 错误照旧上抛，语义不变
    const errs = r.errors as Extract<AgentEvent, { type: "error" }>[];
    expect(errs, "旧实现在这里落 0 条 ⇒ 用户与审计都看不到原因").toHaveLength(1);
    expect(errs[0]!.message).toContain("停滞超时");
    // 证据要落在**中断之后**，而不是替它编一条事件在开头
    expect(r.log.map((e) => e.type)).toEqual(["user_message", "error"]);
  });

  it("★ 反向哨兵：用户取消 ⇒ **不落** error（取消是正常收束，不是出错）", async () => {
    const r = await run({ cancel: true, message: "会话已取消" });
    expect(r.errors, "把用户按停止读成『出错了』= 终态分类被污染").toHaveLength(0);
  });

  it("非 abort 类错误（断网/鉴权/解析）照旧落一条（这条既有口径不许被顺手改掉）", async () => {
    const log: AgentEvent[] = [];
    const provider: Provider = {
      async *stream() {
        throw new Error("401 Unauthorized");
      },
    };
    await expect(runLoop({
      provider,
      events: { async append(e: AgentEvent) { log.push(e); } },
      workspace: "/tmp",
      userMessage: "写",
    })).rejects.toThrow("401");
    expect(log.filter((e) => e.type === "error")).toHaveLength(1);
  });
});
