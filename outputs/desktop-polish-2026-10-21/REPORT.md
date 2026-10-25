# 桌面性能与原生交互修复 · 2026-10-21

本轮落地弹出面板按需加载、浏览器窗口归属与销毁清理、IPv6 本地预览、终端退出时的 UTF-8 排空、概览未知用量显示；对上一轮的消息缓存做了因果对照与最新动作回归。总体质量目标继续进行，尚未作“顶级水平已达成”的结论。

## 实现与复现

- `main.tsx` 按主工作台 / 弹出面板分别加载。实际 Electron Network 记录显示：方案弹窗所需 JS 文件从 **567,787 B 降到 356,596 B（-37.2%）**；主工作台为 **531,730 B → 530,594 B**，总量基本不变。入口 chunk 变小不能代表整个工作台的收益。见 `routes-before.json` / `routes-final.json`。
- 浏览器原生检查先出现三个失败：后台弹窗挂到聚焦窗口、其他窗口可复用已有视图 ID、销毁弹窗后仍留登记。现在 IPC 从可信 sender 解析 BrowserWindow，宿主保存 owner 并在窗口关闭时清理。原生 **14/14** 通过（`native-owner-red.json` / `native-owner-green.json`）。先前怀疑的“仅切换焦点再关闭会泄漏”没有复现，没有把它列成已修缺陷。
- IPv6 URL 标准 hostname 是 `[::1]`，原来主进程比较 `::1`，与地址栏判定不一致；新测试先红后绿，映射 IPv4 地址及非网页协议仍拒绝。
- PTY 的 `exit` 可能早于 stdout/stderr 排空。原来在 exit 时结束 StringDecoder 并发送退出；改为立即拒绝新输入、在 close 时结束解码。新测试保留完整中文与退出事件顺序，且启动错误只退出一次。
- 概览无 usage 事件时输入、输出显示“未返回”；明确返回的零用量保留 0。SSR 两个对照用例与最终截图均验证。

## 长会话实测

`build-control.mjs` 只在实验构建里移除 Stream 的三个 memo 包装，不改产品源码；三个替换必须全部命中。两组各 3 次，每次 400 轮、40 次独立流式增量，每次等待 DOM 提交和下一次绘制。两组均保留 41,944 个 DOM 节点、完整首尾历史，未使用列表窗口化。

| 三次运行读数的中位数 | 普通组件对照 | 缓存组件 | 降幅 |
|---|---:|---:|---:|
| 单次增量 p50 | 38.01ms | 16.70ms | 56.1% |
| 单次增量 p95 | 52.44ms | 25.87ms | 50.7% |
| 40 次增量脚本耗时 | 1,249.60ms | 306.98ms | 75.4% |

原始数据在 `control-{1,2,3}.json`、`runtime-{1,2,3}.json`，汇总在 `performance-comparison.json`。对照第二次的最大延迟 602ms 超过默认 500ms 上限并退出 1，保留该失败；缓存组第一次也有 381ms 极值。未据此宣称恒定帧率或真实模型吞吐。

最终构建另跑 `runtime-final.json`：400 轮 / 40 增量，p50 22.41ms、p95 38.93ms；首尾历史、401 条用户消息、401 条回复、400 个工具头仍在。计时结束后，点击刚生成的第 401 轮“回放”“重跑”，实际桥接请求的轮数和输入均正确，验证缓存未冻结旧事件闭包。此时 DOM 为 41,948 节点，与早先对照不是同一构建，未混入对照统计。

性能脚本校验非空样本、完整历史、有限正预算；包审计分别约束入口、完整主工作台与弹窗依赖闭包。将 p95 / 弹窗 JS 预算设成 1 的两次负向试验均 exit 1；无效参数试验也 exit 1（见 `logs/*-red.log`）。

## 验证范围

- 桌面全量：168 文件、1,221 测试通过，包含实际 Electron 原生宿主检查；依赖边界通过。
- 核心首次全量：6,222 通过、1 失败（LSP 并发请求超时后的取消状态观察）。该文件单独 23 项通过，并连续 6 次通过；第二次完整核心：453 文件、6,223 项通过。**LSP 首次失败根因仍未确认，未改它的实现或测试，也不宣称已修复。**
- 构建（含桌面源码与测试类型检查）、根 typecheck、原生脚本独立类型检查、docs-check、diff 空白检查通过。
- 真实 renderer + 合成 AgentApi：交互 23/23、异步标记 11/11、主窗口/弹窗路由 2/2；另外验证新生成消息动作 2/2。
- 产品真实 IPC + 预录 demo provider 冒烟通过，23 个事件；不消耗真实模型调用。
- 亮色分屏、暗色窄窗、标记保存态已查看；“未返回”修复后再查看确认（`state-final/01-feedback-pending.png`）。
- OCR delegate 只用于选文件、解析规则，代码审查由当前 agent 执行；未调用 OCR 模型审查。索引当前不存在，CodeGraph 明确返回无索引后改用定向检索。

## 证据归属与边界

全部结论针对工作树。取料 HEAD 为 `6af24734ba957838e5584e01228499e5e77b61e9`，本轮差异未提交、未发布，未运行本轮提交的 mutate-verify / head-cert 或完整 gates。原有大量混合改动保留；`task.diff` 只列本轮相对取料快照的改动，index.ts 只提取本轮三个窗口归属 hunk。`source-manifest.json` 保存本轮涉及文件的指纹，整文件指纹会包含此前已在工作树中的内容。

调试过程也保留：旧回环测试在 macOS 需要系统 alias，改成自建 IPv4 服务与映射 IPv6 主机名，无需系统配置；URL 使用标准化后的 href。路由采集曾在 Chromium 目标未就绪时超时，改为 about:blank 就绪后启用 Network，并要求记录到非空 JS 文件列表。额外一次手工 tsc 未带 renderer 全局声明，产生两条诊断；项目 tsconfig 的正式构建通过，原生脚本另行独立检查通过。

## 复跑

从仓库根运行（路径含空格时加引号）：

```sh
pnpm --filter cairn-desktop build
pnpm --filter cairn-desktop test
node --import tsx scripts/typecheck.ts
pnpm --filter cairn-desktop exec electron scripts/native-host-smoke.cjs /tmp/cairn-native-checks.json
pnpm --filter cairn-desktop exec electron scripts/route-smoke.cjs /tmp/cairn-routes.json
CAIRN_PERF_CHECK_ACTIONS=1 pnpm --filter cairn-desktop exec electron scripts/performance-smoke.cjs /tmp/cairn-perf.json 400 40
pnpm --filter cairn-desktop exec node scripts/bundle-audit.mjs /tmp/cairn-bundle.json
pnpm test
pnpm docs-check
```
