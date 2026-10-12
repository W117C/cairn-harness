// 读工作区的 `.agent/providers.json`：没配就是零行为，配坏了就**大声坏**。
//
// 三种结果的区分是刻意的（同 loadSearchConfig 的三态）：
//   absent —— 文件不存在 ⇒ 调用方零行为，不报错（绝大多数用户不会配这个文件）；
//   ok     —— 解析通过 ⇒ 连派生结果一起给出去，调用方不必自己再跑一遍 derive；
//   broken —— 文件在但读不了/JSON 坏/校验不过 ⇒ 把**全部问题**交回去。
// 为什么 broken 不在这里抛：报什么、怎么显示（CLI 打到 stderr、桌面弹在表单上）由调用方决定；
// 但**绝不许吞掉**——配了个不生效的 provider 却静默跑 demo，是本仓点名过的「入口不通」形态。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CUSTOM_PROVIDERS_RELATIVE_PATH,
  deriveCustomProviders,
  parseCustomProviders,
  type CustomProviderProblem,
  type CustomProvidersFile,
  type DerivedCustomProvider,
} from "../providers/provider-config";

export type LoadedCustomProviders =
  | { kind: "absent"; path: string }
  | {
      kind: "ok";
      path: string;
      file: CustomProvidersFile;
      derived: readonly DerivedCustomProvider[];
      /** 派生期的提醒（缺窗口用了保守值、缺价导致美元闸不生效…）。必须显示给用户。 */
      warnings: readonly string[];
    }
  | { kind: "broken"; path: string; problems: readonly CustomProviderProblem[]; message: string };

export function customProvidersPath(workspace: string): string {
  return join(workspace, ...CUSTOM_PROVIDERS_RELATIVE_PATH);
}

export function loadCustomProviders(workspace: string): LoadedCustomProviders {
  const path = customProvidersPath(workspace);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent", path };
    return { kind: "broken", path, problems: [], message: `读取失败：${err instanceof Error ? err.message : String(err)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (err) {
    return { kind: "broken", path, problems: [], message: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}` };
  }
  const parsed = parseCustomProviders(raw);
  if (!parsed.ok) return { kind: "broken", path, problems: parsed.problems, message: `${parsed.problems.length} 处配置问题` };
  const derived = deriveCustomProviders(parsed.file);
  const warnings = derived.flatMap((d) => d.warnings.map((w) => `${d.label}：${w}`));
  return { kind: "ok", path, file: parsed.file, derived, warnings };
}
