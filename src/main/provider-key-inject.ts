// BYOK key 启动注入（M4b §2.1）：从 agent-runner 抽出为独立轻模块——
// 原实现放在 agent-runner.ts（静态依赖链含 MCP SDK/LSP，测试环境动态导入约 20s），
// provider-keys 单测为测本函数被迫导入整条重链而确定性超时（5s）。
// 本模块只依赖 provider-keys：启动注入与测试两侧都不必为重依赖付导入成本。
import { getProviderKey } from "./provider-keys";

/** 启动时把已存 provider key 解密注入 provider 配置（env 优先：M0_API_KEY 已在 = 零行为）。
 *  注入只发生在进程内 env——不落日志、不进事件流（明文零落盘三处纪律）。 */
export async function injectStoredProviderKey(): Promise<boolean> {
  if (process.env.M0_API_KEY) return false; // env 路径（M0_API_KEY）优先，两者并存
  const stored = await getProviderKey("glm");
  if (!stored) return false; // 未存 key / 解密失败（换机器）→ 不注入，UI 显式提示
  process.env.M0_API_KEY = stored;
  return true;
}
