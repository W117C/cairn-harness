# fixtures/lsp — M2a LSP 测试靶子

- stub-server.mjs — 测试专用最小 LSP server（stdio JSON-RPC，零外部依赖）。
  行标记约定：DEF(x)/REF(x)/IMPL(x)/SYM(x)；ERROR_HERE/WARN_HERE 触发诊断。
  开关（argv，判卷用它演"真实服务器会做的事"）：
  | 开关 | 演什么 |
  |---|---|
  | `--slow-init` | initialize 睡 2s（配 `startupTimeout` 用小预算时启动失败进 broken） |
  | `--crash-until=<marker>` | 首次进程退出、marker 出现后正常服务（惰性重启的靶子） |
  | `--caps-to=<file>` | 把**客户端**声明的 capabilities 落盘（协商判卷看的是真发出去的那份） |
  | `--no-hover` | 不声明 `hoverProvider` 且**不注册** hover handler（能力门控的靶子） |
  | `--incremental` | 声明 `change:2`，且只接受**带 range** 的 didChange，缺 range 就沉默丢掉 |
  | `--sync-none` | 声明 `change:0`：不接受 didChange（客户端必须关-开重送内容） |
  | `--symbol-no-location` | workspaceSymbol 只回名字不回 location（LSP 3.17 的合法形状） |
  | `--no-workspace-symbol` | 不声明 `workspaceSymbolProvider` 且**不注册** handler（多服务器路由的靶子：这台不该被问） |
- sample.ts — 单测靶文件（无实际代码语义，标记行即数据）。
