// 项目名的**唯一**规矩（2026-11-18 审计）。
//
// 为什么单独成模块：这条规矩此前有两份实现，而且已经漂了——
//   · 核心 `project-create.ts:validateProjectName` 管文件夹名的全套（空 / 长度 / `/\:*?"<>|` / 控制字符 /
//     前导点 / 尾随点）；
//   · 渲染层 `NewProjectDialog.tsx:validateProjectName` 只管 `\ /` 与控制字符。
// 后果是对话框里输入 `a:b` 一路绿、点了「创建」才被核心拒：「实时校验」这件事在四个字符上是**假的**。
// 规矩是业务事实，只该有一处；文案是各面的事（核心给中文句、渲染层给 STR 键），所以这里只返回**档位**。
//
// 依赖纪律：本模块零 import、零 node 内建——渲染层（浏览器上下文）直接引它，跟
// `src/wallpaper/contrast`、`src/agent/subflow` 一样属于「可共用的纯核心」。
// 别把 write/fs 的活儿挪进来：那会让渲染层这一跳带上 node。
export const PROJECT_NAME_MAX = 64;

/** 文件夹名在 POSIX 与 Windows 上都别碰的字符 + 控制字符（`a:b` 在 macOS 上其实能建，
 *  但换到 Windows 就炸；一次拒掉比「这台能建那台不行」便宜）。 */
export const PROJECT_NAME_BAD_CHARS = /[/\\:*?"<>|\u0000-\u001f]/;

/** 名字的毛病分档（文案由各面自己给）。null = 没问题；`name` 是 trim 后的落盘名。 */
export type ProjectNameProblem =
  | { reason: "empty" }
  | { reason: "too-long"; length: number; max: number }
  | { reason: "bad-char" }
  | { reason: "leading-dot" }
  | { reason: "trailing-dot" };

/** 判项目名（= 文件夹名）的规矩。**不猜、不自动改写**：返回毛病，由调用方决定怎么说话。 */
export function projectNameProblem(raw: string): ProjectNameProblem | null {
  const name = raw.trim();
  if (name === "") return { reason: "empty" };
  if (name.length > PROJECT_NAME_MAX) return { reason: "too-long", length: name.length, max: PROJECT_NAME_MAX };
  if (PROJECT_NAME_BAD_CHARS.test(name)) return { reason: "bad-char" };
  if (name === "." || name === ".." || name.startsWith(".")) return { reason: "leading-dot" };
  // 只查尾随点：尾随空格在上面 trim 时已经没了（粘贴带空格的"项目名 "是常事，该被接受）；
  // 尾随点在部分平台会被系统悄悄去掉，那才是真事故。
  if (name.endsWith(".")) return { reason: "trailing-dot" };
  return null;
}
