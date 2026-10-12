// SEMA Phase 1（方案：docs/sema-proposal.md §4 L2）：Permission Broker 的裁决语义层。
// 只回答一个问题：「这个包声明的权限，当前授权面是否覆盖；其中哪些属于必须人工确认的高危档」。
//
// 事实源纪律：
//  - grants 的取料面（从哪份会话/操作者配置读出来）是 Phase 2 的接线，本层只定义裁决语义——
//    授权词与 manifest.permissions 同一口径（`<命名空间>.<能力>`），支持 `<命名空间>.*` 通配；
//    不支持裸 `*` 全通（fail-closed）。
//  - 高危命名空间名单是**安装面**的策略（装的时候要多一道人工确认），与 src/permissions 的
//    执行期自主权分档是两个问题，不互相当事实源；名单可注入（与 GATES 同款纪律），
//    缺省取方案 §4 的 shell / net / fs 三族。
//  - 授权缺口的修法是补授权配置，不是逐次放行——broker 只给裁决，不开后门。

export interface InstallAdjudication {
  /** 授权面完全没覆盖的权限 ⇒ 拒装。 */
  missing: string[];
  /** 高危档：即便已授权，安装也要求 approvedBy 的人工确认。 */
  requiringApproval: string[];
}

export const DEFAULT_HIGH_RISK_NAMESPACES: readonly string[] = ["shell", "net", "fs"];

export function namespaceOf(permission: string): string {
  return permission.split(".")[0] ?? permission;
}

function grantsCover(permission: string, grants: ReadonlySet<string>): boolean {
  return grants.has(permission) || grants.has(namespaceOf(permission) + ".*");
}

/** 纯裁决：不碰盘、不碰子进程，判据可单测（本仓纪律）。 */
export function adjudicateInstall(
  permissions: readonly string[],
  grants: ReadonlySet<string>,
  highRiskNamespaces: readonly string[] = DEFAULT_HIGH_RISK_NAMESPACES,
): InstallAdjudication {
  const highRisk = new Set(highRiskNamespaces);
  const missing: string[] = [];
  const requiringApproval: string[] = [];
  for (const permission of permissions) {
    if (!grantsCover(permission, grants)) missing.push(permission);
    else if (highRisk.has(namespaceOf(permission))) requiringApproval.push(permission);
  }
  return { missing, requiringApproval };
}
