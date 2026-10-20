// 敏感落点片段表（**全仓唯一一份**）。
//
//  为什么独立成模块（2026-10-20「给 harness 做薄、做标准」）：这张表此前**抄了两份**——
//  · `src/permissions/risk.ts` 的 `SENSITIVE_PATH_SEGMENTS`（权限层：路径命中 ⇒ 抬到 high ⇒ 送审）；
//  · `src/tools/base.ts` 的 `SENSITIVE_REAL_SEGMENTS`（工具层：软链落点复查 ⇒ 硬拒）。
//  两份**已经漂了**：工具层那份少了 `.agent/lsp.json` 与 `.agent/config.json` 两项
//  （宿主配置面：模型能改这两个文件 = 能让宿主执行任意命令）。
//
//  两层抄一份的后果不是"多写了几行"，而是**同一个落点在两层各有一份真相**——
//  权限层认的工具层不认（或反过来），于是"这一格到底算不算敏感"要看调用到哪一层。
//  本轮追出的那条 HIGH 就是这个形状的活例子：权限层在**未归一**的原始串上匹配、
//  工具层在**归一后**的真实路径上匹配 ⇒ 同一个 `.git/hooks/pre-commit` 两层各说各话
//  ⇒ 路径别名（`.git//hooks/…`）在权限层认不出来 ⇒ auto 档免批写钩子。
//
//  口径（两层共用同一份，语义各归各的）：
//  · 片段表 = **工作区内**真正可达、且会被自动执行或事后外送的落点；
//  · 权限层用它在**词法**路径上判风险（命中 ⇒ high ⇒ 审批卡）；
//  · 工具层用它在**软链解析后的真实路径**上复查（命中且词法没命中 ⇒ 硬拒）。
//
//  **与 `src/main/sandbox.ts` 的 SENSITIVE 刻意不合并**：那边是「相对 HOME 的目录 ⇒ 读取一律拒绝」
//  的沙箱口径，这里是「路径片段 ⇒ 抬风险等级 / 硬拒落点」的执行面口径，语义不同、
//  强制合并会改掉任一边的行为。两处注释互指，将来要收敛时按本仓口径先记锚点再动。
export const SENSITIVE_PATH_SEGMENTS: readonly string[] = [
  // 持久化代码执行面：git commit 时自动运行；.git/config 还能重定向 core.hooksPath
  ".git/hooks/", ".git/config",
  // 宿主配置面：内容是待 spawn 的命令（lsp.json）或待执行的 verify 命令（config.json）。
  // 模型能改这两个文件 = 能让宿主执行任意命令，且执行不经 shell 威胁表与网络审批通道。
  ".agent/lsp.json", ".agent/config.json",
  // 凭证面（仓库内那份同样是凭证：常被误提交）
  ".npmrc", ".netrc", ".env", ".git-credentials", "id_rsa", "id_ed25519", "authorized_keys",
];

/** **递归扫描面**的敏感根（从上面那张表**推**出来，不另抄一份）。
 *  目录参数落在这些根下 ⇒ 整棵子树都要过闸（子树里就有 `.git/config` 这样的凭证面
 *  与 `.git/hooks/` 这样的执行面）。多段条目的第一段就是根；裸文件名条目不是根。 */
export const SENSITIVE_SCAN_ROOTS: readonly string[] = [
  ...new Set(SENSITIVE_PATH_SEGMENTS.filter((s) => s.includes("/")).map((s) => s.split("/")[0]!)),
];
