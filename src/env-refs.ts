// 环境变量间接引用（roadmap「$VAR 间接引用」，2026-11-10）。
//
// 既有模式是 apiKeyEnv（provider 配置只写**环境变量名**、不写值）——本模块把同一纪律
// 推广到「值里想引用一个环境变量」的字段：`${VAR_NAME}` 按段展开。
//
// 两条边界（都有真实失效面，写死在这里）：
//   1. **只认全大写名**（`[A-Z_][A-Z0-9_]*`，与 apiKeyEnv 的 ENV_NAME_RE 同一家族）——
//      小写 `${path}` 之类不展开（那多半是别的模板语法，替它展开等于抢别人的语义）。
//   2. **缺变量不编值**：原样保留 `${NAME}` 并把它报进 missing——调用方决定 fail-loud
//      还是出声继续；静默展开成空串会把「没配」伪装成「配了个空值」。
//
// 接线面刻意收窄：只接**用户私有、模型不可写**的配置（providers.json 是 apiKeyEnv 的同一
// 作者面；主 settings 在 userData、模型面够不着）。工作区随仓分发的 `.agent/config.json`
// **刻意不接**——克隆来的配置文件能读环境变量并把值拼进出网地址，是一条现成的渗漏通道。
const ENV_REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export interface EnvRefExpansion {
  value: string;
  /** 引用了但环境里没有的名字（去重、按出现序）。空数组 = 全部展开成功或本来就没有引用。 */
  missing: string[];
}

/** 展开 `${VAR_NAME}` 段。纯函数（env 由调用方注入，判卷不必改 process.env）。 */
export function expandEnvRefs(input: string, env: Readonly<Record<string, string | undefined>> = process.env): EnvRefExpansion {
  const missing: string[] = [];
  const value = input.replace(ENV_REF, (whole, name: string) => {
    const v = env[name];
    if (v === undefined || v === "") {
      if (!missing.includes(name)) missing.push(name);
      return whole; // 缺变量原样保留，不编值
    }
    return v;
  });
  return { value, missing };
}

/** 字符串里**有没有**引用（接线面用它决定走不走展开通道；空变量算「有引用但缺」）。 */
export function hasEnvRef(input: string): boolean {
  return ENV_REF.test(input);
}
