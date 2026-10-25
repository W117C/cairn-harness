# 终端交互与 LSP 校验修复 · 2026-10-21

本轮完成真实 PTY 尺寸同步、退出码传递、窗口关闭回收、启动失败回传与就地重试，定位并修复上一批 LSP 测试的取消时序缺陷。桌面全量通过；最近一次核心全量有一项能力断言清单检查失败，其他会话修改相应源文件后，该文件收尾复核通过，核心全量未再复跑。整体质量目标继续进行。

## 用户可见行为

| 场景 | 修复前证据 | 当前行为与证据 |
|---|---|---|
| 打开终端、缩窄和放大面板 | 真实 `stty size` 初始为 0×0；前端只 fit xterm，未同步内核 | 初始 80×24，随后跟随显示行列。实测窗口内为 107×35、63×19、140×46；每次内核与 xterm 完全一致 |
| 运行交互程序后调整面板 | 缺少 resize 通道 | 前台程序实际收到 SIGWINCH，宽度变化后正常返回 shell |
| 中文与大段输入输出 | 原链路没有尺寸控制，也没有这条双向压力实测 | 163,840 字节中文与 emoji 边读边回显，输入 SHA-256 相同，返回的完整文本也一致；Ctrl+C 中断前台程序后 shell 可继续输入 |
| `exit 7` | 桥脚本丢弃 shell 状态，界面显示 code 0 | 真实 code 7 上屏，重新启动生成新终端并补发当前尺寸 |
| 关闭弹出的终端窗口 | 实测关闭窗口后仍可写，PTY 未退出 | 关闭事件按窗口归属回收终端；实际进程退出，同一宿主的其他窗口终端保留 |
| 项目目录消失 | 严格检查发现：可显示退出并重启，实际启动原因可能丢失 | 等桥进程 spawn 成功后才返回 id；启动失败直接通过请求返回原因，错误区提供重启入口，恢复目录后实测输入输出恢复 |
| 主进程版本不一致 | 新增通道需要明确握手 | 终端启动前检查协议，旧版本不启动 PTY，提示重新打开应用 |

原始失败分别见 `logs/terminal-size-red.log`、`renderer-close-red.json`、`renderer-complete.json`。最终真实 renderer、生产 preload、真实 Electron IPC、生产 TerminalHost 与真实 PTY 检查 **17/17**，见 `renderer-delivery.json`。IPC 宿主为隔离测试注册的最小通道；完整应用另有预录 demo 冒烟，不混称真实模型会话。

## 实现边界

- 新增 `terminalResize` 并同步协议 **v16 → v17**、通道表、main 与期望版本测试；preload 按通道表生成，无重复手写接口。
- Python 标准库 PTY 转发代码独立到 `pty-bridge.ts`，作为字符串随主进程构建，不新增独立 Python 资源文件或原生依赖。fd 0/1 保留用户字节，fd 3 传尺寸；输入、输出各有 64KiB 有界缓冲，避免粘贴和回显互相阻塞。
- 初始尺寸设置与控制流之间有就绪信号，防止初始默认值覆盖已经发来的尺寸。通过 waitpid 状态保留真实退出结果。接口选择参考 [Python PTY 文档](https://docs.python.org/3.12/library/pty.html)。
- `TerminalHost.start` 现在等待桥进程 spawn，错误直接返回，不创建失联 id；窗口在等待中关闭或应用退出也会取消启动。按 [Node spawn 事件契约](https://nodejs.org/api/child_process.html#event-spawn) 接管输入输出生命周期。原先“异步失败仍给 id”的宿主测试相应改为验证失败结果及无虚假推送。
- xterm 在初次创建和 onResize 时同步真实行列，退出后停止写入；ResizeObserver 与监听器在卸载时清理。错误通知带可重试属性，启动失败可重试，协议失配指引重启应用。
- 终端仍限定 macOS，当前实测 Python 3.12；保留既有平台边界。未验证发布安装包或新增其他平台支持。

## LSP 首次失败的定位

诊断程序 `lsp-cancel-probe.ts` 使用真实官方 JSON-RPC 服务与当前 LspClient。12 次中观察到一次：handler 进入时 token 已取消，测试服务只订阅后续事件，取消回调未执行；另一条并发请求仍正常完成。记录在 `lsp-order.json`。这证明客户端已发出取消，缺陷位于测试服务处理已取消 token 的方式。

修复服务先检查当前取消状态，再订阅后续取消；**没有修改生产 LspClient**，文件指纹见 `source-manifest.json`。原有 23 个用例的行为断言和 20ms 超时保留。

新增可控 MessageReader 交付闸，把请求、取消等消息在同一批交给 SDK，明确断言 handler 进入前 token 已取消，以及只释放该请求。最终用例不靠两个定时器竞争，不通过延长等待或重试来代替断言。新增场景先红后绿，整文件 **24 项**通过；该文件也在后续完整核心检查中通过。

## 验证与未解决项

| 检查 | 结果 |
|---|---|
| 桌面全量 | **169 文件 / 1,227 测试通过**，含边界检查（`logs/desktop-final-pass.log`） |
| 最后运行期错误措辞调整后的终端回归 | **3 文件 / 11 项通过**，`logs/terminal-delivery-tests.log` |
| 真实终端完整交互 | **17/17 通过**：尺寸、信号、双向中文、退出、重启、窗口回收、协议与启动失败恢复 |
| 桌面构建、桌面 typecheck、根 typecheck | 通过 |
| 两份原生测试脚本独立类型检查 | 通过 |
| 产品完整 IPC + 预录 demo provider | 通过，未调用真实模型 |
| 核心首次全量 | 6,234 通过 / 2 失败：mutate-shards 用例超时、replay-faces 发现靶子生成文件漂移 |
| 上述失败范围连同 LSP 复核 | 3 文件 / **82 项通过**，原检查未放宽 |
| 核心后一次全量 | **6,235 通过 / 1 失败**：`promise-recall-inventory.test.ts` 的能力断言可测性上限检查 |
| 清单第一次单项复核 | 34 通过 / 1 失败；未放宽上限或移除断言 |
| 清单收尾单项复核 | **35 项通过**，`logs/inventory-delivery.log`；其间其他会话改了 `candidate-record.ts` 的 schema 错误文案，该修改不归属本轮；核心全量未再复跑 |

首次并发桌面检查还出现三个真实进程用例 5 秒超时及 kernel-host 会话漂移，分开复跑后桌面全量通过。期间另一个会话的 gates 进程在同一检出运行，HEAD 也发生变化。保留全部失败记录；不能据此断言所有红项均由并发导致。冻结登记文件及其他会话的工作未被重置或改写。

**最近一次核心全量未全绿，当前清单单项通过。** 首次失败点名的符号见 `logs/inventory-current.log`。实际取料表明超出清单上限的一项来自 `parseCandidateRecord` 的 schema 错误文案；其他会话随后修改该句，收尾复核通过。本轮未改该文件、上限或清单判据，也未把单项绿色替代全量结果。

## 证据与取料说明

- 本轮差异为 `task.diff`，相对修改前保存的文件字节，保留此前混合改动。`source-manifest.json` 记录输入 HEAD、收尾 HEAD、实际文件指纹和 LspClient 未改动证明。整文件指纹包含既有内容，不是所有代码的归属声明。
- 所有结论针对工作树；本轮完整变更未提交或发布，未把其他会话的 gates 当成本轮通过证明，未作本轮 HEAD / mutation 认证。
- OCR delegate 用于选文件和解析规则，审查由当前 agent 执行。CodeGraph 本轮可用，核心导航优先使用它。LSP 测试文件不在冻结文件登记表中；冻结的判卷和 fixture 未作放宽。
- 最早“启动失败”检查把“看到退出”也算通过，断言过宽；收紧后明确复现原因丢失，随后才修复并验证原因文本、重试入口和真实恢复。早期工件保留，最终采用 `renderer-delivery.json`。
- 隐藏测试窗口关闭后台节流以模拟可见页面，并等待真实输出上屏后截图。`terminal-wide.png` 与 `terminal-startup-failure.png` 为实际渲染结果；不把只收到管道输出当成界面已显示。

## 复跑

从仓库根运行，终端原生检查需要 macOS 和 Python 3：

```sh
pnpm --filter cairn-desktop build
pnpm --filter cairn-desktop test
node --import tsx scripts/typecheck.ts
pnpm --filter cairn-desktop exec electron scripts/terminal-renderer-smoke.cjs /tmp/cairn-terminal-checks.json
pnpm exec vitest run --config tests/vitest.config.ts tests/lsp-request-lifecycle.test.ts
pnpm test
pnpm docs-check
```

下一批继续核对测试靶子写入归属与核心全量状态，再完善文件面板、键盘流程和面板模块边界。整体目标保持进行中。
