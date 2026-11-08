// 设置页/插件窗格共用的 MCP server 行：只做展示，不发事件。
// active 来自 PluginPanelSnapshot.mcpServerSummaries（server / tools / none）；
// hasData=false 表示旧快照或手写夹具没有这几格——显示「未记录」，不把缺席读成「未激活」。
export interface McpServerActivity {
  active: boolean;
  activeMode: "server" | "tools" | "none";
  activeToolCount: number;
}

export function McpServerRow(props: {
  server: string;
  state: string;
  toolCount: number;
  summary?: McpServerActivity;
  activeToolNames: readonly string[];
  error?: string;
  hasData: boolean;
}): React.JSX.Element {
  const active = props.summary?.active === true;
  const mode = props.summary?.activeMode ?? "none";
  const label = !props.hasData
    ? "未记录"
    : mode === "server"
      ? "整台已激活"
      : mode === "tools"
        ? "按工具激活 " + String(props.summary?.activeToolCount ?? 0) + " 把"
        : "未激活";
  const names = props.activeToolNames.slice(0, 6);
  const more = props.activeToolNames.length > names.length ? "…" : "";
  return (
    <div className="ap-li">
      <span className={"kind" + (props.hasData && active ? " ok" : "")}>
        {props.hasData ? (active ? "active" : "idle") : "—"}
      </span>
      <span className="p">
        {props.server} · {props.state} · {String(props.toolCount)} 工具 · {label}
        {names.length > 0 ? "（" + names.join("、") + more + "）" : ""}
        {props.error !== undefined ? " · " + props.error : ""}
      </span>
    </div>
  );
}
