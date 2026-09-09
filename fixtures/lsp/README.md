# fixtures/lsp — M2a LSP 测试靶子

- stub-server.mjs — 测试专用最小 LSP server（stdio JSON-RPC，零外部依赖）。
  行标记约定：DEF(x)/REF(x)/IMPL(x)/SYM(x)；ERROR_HERE/WARN_HERE 触发诊断。
- sample.ts — 单测靶文件（无实际代码语义，标记行即数据）。
