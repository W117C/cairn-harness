// 语言服务器状态行（2026-11-02）：协议 v52 的 `lspStatus` 通道**在渲染层的第一个消费者**。
//
// 为什么要有这一行：那条通道主进程接了、渲染层零调用点 ⇒ 判卷 invoke-consumer-census
// 一直红——它红的正是这件事：功能齐全但 UI 上不可达。状态进「高级」段后通道有了真消费者。
//
// 口径边界（与 src/tools/lsp.ts 的 formatLspStatus 同源，别在这里另造一套）：
//   · 只读：不起进程、不改授权；
//   · 「在跑 / 已标记不可用」是**当前进程**的事实（起没起、崩没崩不住在盘上）
//     ⇒ 挂载时读一次就够，不轮询；盘上那份配置变了要重开这一页才重读。
// 三种「没有可看的读数」分开说，不许糊成一个「无」：还没读到 ≠ 读失败 ≠ 没配置——
// 第三种是用户自己能去配的，前两种不是他的话。
import { useEffect, useState } from "react";
import type { LspStatus } from "../../../../../../src/tools/lsp";
import { Badge, SettingsRow } from "../settings-ui";
import { STR } from "../../strings";

/** 状态一句话（纯函数，判卷直接钉它）。 */
export function lspSummary(st: LspStatus | null | "unreadable"): string {
  if (st === null) return "读取中…";
  if (st === "unreadable") return "读数失败";
  if (st.configError !== "") return "配置读不出";
  if (!st.enabled) return "未配置";
  const trust = st.trust === "trusted"
    ? "已授权"
    : st.trust === "declined" ? "已拒绝授权" : st.trust === "pending" ? "待授权" : "不适用";
  return `${String(st.servers.length)} 台 · ${trust}`;
}

export function LspStatusRow(): React.JSX.Element {
  const [lsp, setLsp] = useState<LspStatus | null | "unreadable">(null);
  useEffect(() => {
    let alive = true;
    void window.agent.lspStatus()
      .then((st) => { if (alive) setLsp(st); })
      .catch(() => { if (alive) setLsp("unreadable"); });
    return () => { alive = false; };
  }, []);
  return (
    <SettingsRow label={STR.advanced.lspServers} desc={STR.advanced.lspServersDesc}>
      <Badge>{lspSummary(lsp)}</Badge>
    </SettingsRow>
  );
}
