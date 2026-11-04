// 会话级判据声明（spec 2026-11-04 §3.2）：校验与解析。
//
// 这一层只做两件事：把一个人手写的声明校验成形状确定的 `VerifyDeclaration`，
// 并在解析配置时决定"这次用谁的判据"。执行面（超时、沙箱、输出环、归因）一律不在这里。
//
// 优先级：会话声明 > 仓库 `.agent/config.json` > `package.json`/语言探测（后两者由
// `loadVerifyConfig` 自己按这个次序决定）。无声明时本模块把结果原样透传，**逐字回旧行为**——
// 这是给"加了字段但没人用"留的证明：旧调用点不传第二个参数，运行时行为不变。
import { loadVerifyConfig, MAX_VERIFY_TIMEOUT_MS, MIN_VERIFY_TIMEOUT_MS, type VerifyConfig } from "./verify";
import type { VerifyDeclaration } from "../events";

/** 判据来源。`none` = 仓库既没配置也探测不到（沿用 `loadVerifyConfig` 的 fail-closed 语义）。 */
export type VerifySource = "task" | "config" | "probed" | "none";

export type VerifyDeclarationCheck =
  | { ok: true; value: VerifyDeclaration }
  | { ok: false; error: string };

/** 声明校验（纯函数）：形状、空白命令、空表、超时上下限。
 *
 *  **拒绝而不是夹取**：静默把 999ms 改成 1000ms，等于替人改了验收标准；
 *  **拒绝而不是回落**：空声明被当成"没声明"，会让人以为判据生效了、实际跑的是仓库配置。 */
export function validateVerifyDeclaration(raw: unknown): VerifyDeclarationCheck {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "verify 声明必须是对象" };
  }
  const r = raw as { commands?: unknown; timeoutMs?: unknown; note?: unknown };
  if (!Array.isArray(r.commands)) {
    return { ok: false, error: "verify.commands 必须是字符串数组" };
  }
  if (r.commands.length === 0) {
    return { ok: false, error: "verify.commands 为空——没有判据的声明不算声明" };
  }
  const commands: string[] = [];
  for (const c of r.commands) {
    if (typeof c !== "string") return { ok: false, error: "verify.commands 里有非字符串项" };
    if (c.trim().length === 0) return { ok: false, error: "verify.commands 里有空白命令" };
    commands.push(c);
  }
  const out: VerifyDeclaration = { commands };
  if (r.timeoutMs !== undefined) {
    if (
      typeof r.timeoutMs !== "number" ||
      !Number.isInteger(r.timeoutMs) ||
      r.timeoutMs < MIN_VERIFY_TIMEOUT_MS ||
      r.timeoutMs > MAX_VERIFY_TIMEOUT_MS
    ) {
      return {
        ok: false,
        error:
          "verify.timeoutMs 必须是 " + String(MIN_VERIFY_TIMEOUT_MS / 1000) + "–" +
          String(MAX_VERIFY_TIMEOUT_MS / 1000) + " 秒之间的整数毫秒（越界不夹取，直接拒）",
      };
    }
    out.timeoutMs = r.timeoutMs;
  }
  if (r.note !== undefined) {
    if (typeof r.note !== "string") return { ok: false, error: "verify.note 必须是字符串" };
    out.note = r.note;
  }
  return { ok: true, value: out };
}

/** 解析这次 run 该用哪份判据。声明坏 ⇒ 抛错（fail loud），不回落仓库配置。 */
export async function resolveVerifyConfig(
  repoDir: string,
  declared?: VerifyDeclaration,
): Promise<{ config: VerifyConfig; source: VerifySource }> {
  if (declared === undefined) {
    const loaded = await loadVerifyConfig(repoDir);
    return { config: loaded.config, source: loaded.source };
  }
  const checked = validateVerifyDeclaration(declared);
  if (!checked.ok) throw new Error(checked.error);
  const declaredConfig: VerifyConfig = { test: [...checked.value.commands] };
  if (checked.value.timeoutMs !== undefined) declaredConfig.timeoutMs = checked.value.timeoutMs;
  return { config: declaredConfig, source: "task" };
}
