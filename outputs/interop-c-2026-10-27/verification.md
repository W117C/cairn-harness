# A/B/C 收口验证读数（2026-10-27）

对象：`/Users/ze/Downloads/Cairn/cairn` 当前工作树，基线提交 `8e94d99b`。
A/B 的主体已入库；本批新增 C（互操作）并对 B 的 spawn 配对与 A 的断言水位做了收口修复。
当前工作树同时含其他会话未提交的 Evolve P0–P2 与桌面改动，本页只记录 A/B/C 相关读数。

## 定向判卷

命令（`--maxWorkers=2`）：

```text
npx vitest run --config tests/vitest.config.ts --maxWorkers=2 \
  tests/tool-search.test.ts tests/tool-search-tool.test.ts \
  tests/interop-sdk.test.ts tests/interop-a2a.test.ts tests/interop-benchmarks.test.ts \
  tests/local-agent-runtime.test.ts tests/worker-evidence-parent-context.test.ts \
  tests/prompt-surface-check.test.ts tests/permissions-tool-registry.test.ts \
  tests/skill-tool-policy.test.ts tests/memory-hybrid.test.ts \
  tests/remote-backend.test.ts tests/promise-recall-inventory.test.ts \
  tests/prose-needle-scan.test.ts tests/src-execution-path.test.ts \
  tests/projection-invariant.test.ts
```

结果：**16 文件 / 273 条全绿**。

C 新增套件单独读数：

- `tests/tool-search.test.ts`：7/7；
- `tests/tool-search-tool.test.ts`：2/2；
- `tests/interop-sdk.test.ts`：8/8；
- `tests/interop-a2a.test.ts`：6/6；
- `tests/interop-benchmarks.test.ts`：5/5。

## 全量 core

命令：`pnpm test:capped`（`--maxWorkers=2`），日志 `.tmp/c-full-product-20261027.log`。

结果：`--maxWorkers=2` **551 文件 / 7148 条：549 文件 / 7146 条通过；2 条失败**，
两条分别为 `tests/post-run-readings.test.ts` 与 `tests/scratch-tree-naming.test.ts`，单跑 27/27 通过。
串行 `--maxWorkers=1` 首趟 550/551 文件、7147/7148 条，唯一失败是
`tests/readme-invoke-channel-count.test.ts`：并发桌面批次新增 invoke 通道后 README 仍写 108
（运行时 109）。已把 README 改成现读 109；复跑串行 **551 文件 / 7148 条全绿，exit 0**，
291.18 s，日志 `.tmp/c-full-product-1w2.log`。本批 C 的 11 个测试文件在两次全量中全部通过。

上一趟在 ACP stdio、A2A HTTP、SDK 工具面 fail-closed 修复之后曾得到
**545 文件 / 7129 条全绿，exit 0**（181.28 s，`.tmp/c-full-transport-20261027.log`）；
该读数早于产品宿主/服务四个测试文件，不能替代本趟。

## 其它门

- `node --import tsx scripts/typecheck.ts`：0 条报错；
- `pnpm docs-check`：全绿；
- `pnpm tools-check`：36 条断言通过，三项清单覆盖 15 格（13 断言 + 2 n/a）；
- `pnpm model-surface-check`：6/6；
- `pnpm prompt-surface-check`：全绿（dead 0 / odd 0）；
- `pnpm plugins-check`：42 ✅ / 0 ❌ / 1 未证（联网拉取 anthropics/skills 被截断，未证不等于通过）；
- 桌面套件：223/224 文件、1486/1487 条；`motion-gaps.test.ts` 的 `.pop-rd` 动效断言失败，
  属同时进行的桌面批次；先前 `approval-e2e` / `kernel-host` 的 4 条失败在单跑时 22/22 通过。

## 外部基准 CLI

命令：

```text
node --import tsx scripts/external-bench.ts \
  --adapter harbor \
  --tasks fixtures/bench-external/harbor.tasks.json \
  --dataset-version harbor@2026.10 \
  --evidence fixtures/bench-external/evidence.json \
  --out outputs/interop-c-2026-10-27/external-bench.jsonl
```

自报：`2 条记录：failed=1 unknown=1；用量未知 2/2`。
记录保留失败原文 `visible test still failing`；没有证据的第二条为 `unknown`；
缺失的 `dollars` / 全部用量分别写 `null` 与 `unknown` 字段，未折成 0。

## 边界

- 工作树未提交；未跑 `head-cert-check` / `mutate-verify`，因此本页不是 HEAD 认证。
- 同树并发的 Evolve P0–P2 与桌面改动未纳入本批；它们的 2 条 Evolve P2 失败单跑通过，
  桌面 1 条动效失败归该批次。
- ACP/A2A 只实现传输中立适配与 JSON-RPC 分派；真实 ACP stdio、A2A HTTP/SSE、
  Harbor/Terminal-Bench 真实执行、真实远程 worker 部署与真实 provider 收益仍未验证。

## 追加：ACP stdio 与 A2A HTTP 传输（同批后续）

- `src/interop/acp-stdio.ts`：有界 newline-delimited JSON-RPC stdio；请求并发分派，
  `session/prompt` 运行中可收到 `session/cancel`；写侧串行化，超长行回 -32600，
  解析失败回 -32700。
- `src/interop/a2a-http.ts`：loopback JSON-RPC HTTP + `/.well-known/agent-card.json`；
  请求体上限、content-type 检查、404/405/415/413 显式拒绝；无鉴权/TLS/SSE，
  agent card 继续声明 `streaming:false`。
- 定向：`tests/interop-acp-stdio.test.ts` 3/3、`tests/interop-a2a-http.test.ts` 3/3；
  `tests/interop-sdk.test.ts` 12/12；C 十一文件合计 **42/42**。`typecheck` 0。
- 合并 A/B/C 定向面 **18/18 文件、281/281 条通过**；并发 Evolve 模块的测试路径缺口已由该批次补齐。
- 真实 ACP 客户端握手/权限桥、A2A 认证/TLS/SSE 仍未认证。

## 追加：产品宿主与 ACP/A2A 服务

- `src/main/interop-host.ts`：SDK `run` 宿主直通 `handleAgentRun`（固定工作区、默认 unattended）；
  `tests/interop-host.test.ts` 1/1 用 demo provider 端到端跑产品会话。
- `scripts/acp-server.ts`：真实 stdio 服务；`tests/acp-server-cli.test.ts` 1/1 子进程
  initialize → session/new → prompt → assistant chunk → exit 0。
- `src/main/interop-a2a-runtime.ts`：A2A task → 产品会话，只读、消息幂等、follow-up 排队、
  fence；`tests/interop-a2a-product.test.ts` 1/1 跑完真实任务并产出 artifact。
- `scripts/a2a-server.ts`：loopback HTTP 服务；`tests/a2a-server-cli.test.ts` 1/1 子进程
  message/send → tasks/get 完成 → SIGINT 退出 0。
- C 十一文件 **42/42**；根 `typecheck` 0。
- 边界：ACP 无 `session/request_permission` 权限桥；A2A 无认证/TLS/SSE，产品运行时只读；
  两者只以 demo provider 跑通，真实 provider/外部客户端未认证。

## 追加：SDK 工具面安全收口

- `AgentClientHost.tools` 现在由宿主注入；SDK 不再回落到静态 `TOOLS`。缺省空表下，
  `mode:"auto"` 的 `write_file` 调用得到 `unknown tool: write_file`，不会执行。
- 测试：`tests/interop-sdk.test.ts` 的“fails closed by default”和“executes only the tools
  the host injects”两条；后者用宿主注入的 `echo_tool` 证明只有显式表可执行。
- 影响：ACP stdio 传输默认没有工具；生产宿主必须注入 `gatedTool`/`gatedMcpTool` 同源表，
  或改为走 `handleAgentRun` 的产品装配。没有注入就不存在绕过权限门的路径。
