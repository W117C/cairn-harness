# Agent 产品闭环：第一批修复与后续验收

日期：2026-10-28（Asia/Shanghai）。对象：当前共享工作树。
基线 HEAD：`8e94d99b07351f6334e2551e4b7f8ccd6f28c179`。
本批修改未提交、未部署；测试不构成这个 HEAD 的认证。完整产品目标仍在进行。

## 已落地

- 加密 key 存储串行处理读改写；并发保存/删除不丢更新，损坏文件显式报错并保留原件。
- 应用级存储保留当前工作区暂未装载的自定义 provider 密文；未知 provider 的新写入仍拒绝。
- 保存/替换/删除 key 后即时更新 Cairn 管理的环境注入；外部 env、其他 provider 的归属保持优先。
- provider 改 env 名或卸载注册后，仍能撤销其历史注入；自定义配置提交成功后才激活新凭据。
- 核心 `handleAgentRun` 兑现请求里的 `planRequired`，优先级为 override → request → settings。
- 项目导出拒绝路径逃逸、源内递归、外部/缺失链接；内部链接映射到成品并可离开源目录使用。
  既有隐藏目录与长目录名可以导出；不套用新建项目的命名限制。
- 用户批准后仅修正 AGENTS.md 三处 CDS 引用；没有改变规则要求。

## 验证

| 范围 | 命令与结果 | 原文 |
|---|---|---|
| core 工作树 | `pnpm test:capped`，**maxWorkers=2**；556 文件 / 7187 条通过 | `core-product-final.log` |
| desktop | `pnpm --filter cairn-desktop test`；227 文件 / 1558 条通过，含依赖边界检查 | `desktop-reviewed.log` |
| 类型 | `node --import tsx scripts/typecheck.ts`；0 报错 | `typecheck-product-final.log` |
| 构建 | `pnpm --filter cairn-desktop build`；通过 | `desktop-build.log` |
| Electron | `pnpm --filter cairn-desktop smoke`；真实窗口/生产 preload，PASS | `desktop-smoke.log` |
| 文档 | `pnpm docs-check`；通过；本记录写入后另复查 | `docs-final.log` |

新增 39 条行为回归。先观察失败再修复；没有修改既有断言或冻结夹具。
Electron 冒烟使用预录 demo，不证明模型能力、真实 provider 可用性或任意任务成功率。
独立审查发现的两项 P2（历史 env 撤销、提交前激活）均经失败回归后修复；修复后由完整套件验证。

基线 core 为 7147/7148，唯一失败是 AGENTS.md 引用。中间 desktop 曾因重复刷新返回语义失败，
原断言保持并恢复兼容；导出隐藏/长目录的两个新反例也曾失败。最终原文如上，不用中间红样本冒充绿灯。

## 决策、范围与局限

- 在当前共享工作树中小范围修改，以保留未提交的新能力；没有 reset/stash，没有提交无关差分。
- 将桌面 provider 保存流程移到 core 的 `commitProviderSetup`，使真实文件系统失败可直接验证。
- 当前配置失败回滚恢复注册表/运行态；先前写入的密文尚不具备跨文件事务回滚。
  并发配置保存与崩溃恢复属于接下来必须处理的产品缺口。
- 未验证多进程 key-store 竞争、恶意并发文件系统替换、Windows 链接权限。
- 没有真实模型 key 测试、独立安装包认证或跨机器验证；没有发布、公证或签名分发。
- 未运行 `head-cert-check` / `mutate-verify` / 全量 `pnpm gates`；不能把工作树测试称为提交认证。

## 第二批：独立桌面包与打包态修复（2026-10-28 晚）

### 一、打包态暴露的两个真问题

**1. 打包后所有 IPC 被「来源不可信」拒绝。** 窗口能加载、`window.agent` 是 object，但
`agent:sessions-create` 当场被拒。根因是壳根取错：runtime package 的 main 在
`apps/desktop/src/main/entry.cjs`，打包后 `app.getAppPath()` 返回 `Contents/Resources/app`，
而 `loadFile` 的壳在 `Contents/Resources/app/apps/desktop/dist/index.html`，来源校验因此
永远不匹配。修法：`shell-url.ts` 新增 `shellAppPath(mainDir)`（入口上两级），
`index.ts` 用它计算 `shellUrlOptions`。判卷新增打包布局纯函数用例与接线哨兵
（`main-hardening`）；把接线退回 `app.getAppPath()` 实测红。

**2. ad-hoc 重签后首启卡在钥匙串 ACL。** 每次构建都换 CDHash，macOS 对既有
“Cairn Safe Storage”条目的访问会等 ACL 决定；进程采样主线程停在
`SecItemCopyMatching`，45s/120s 冒烟均超时。打包冒烟改用 Chromium 的
`--use-mock-keychain`（仍走 safeStorage 路径，不碰真实钥匙串）。**边界**：稳定签名下的
真实首启与钥匙串授权未验，mock 不能替代。

### 二、独立包与核验

| 项 | 读数 |
|---|---|
| 产物 | `apps/desktop/release/Cairn.app`、`Cairn-macOS.zip`、`build-info.json`（均在 `.gitignore` 内） |
| 体量 | app 402M / zip 160M；5012 个文件 / 286 个软链 |
| 软链 | 286 条全部相对路径，0 条绝对路径，0 条逃出 bundle |
| 签名 | `codesign --verify --deep --strict` 通过；ad-hoc（非 Developer ID） |
| 身份 | `com.cairn.desktop` / 0.1.0 / Cairn；runtime package 只含生产依赖 |
| zip sha256 | `3dbdd5d1444d7d894c1a0ce40dbedf956d1ae233064175aa40408d134e5b6bb2` |
| 可执行 sha256 | `60bc1434cc3c3dde4124d649e288e4ec0db5dca8a3a51dc80dc7baa5f5d492fd` |
| 源锁 sha256 | `44a348d89db2a7e4923da636691d1d11372ad787cd5435f264a953d0f8d38ca5` |
| 打包态冒烟 | 构建树内 **PASS 1847 ms**；解压到源码树外再跑 **PASS 1853 ms** |
| 包内首启修复 | 解压产物内以隔离 profile + CDP 真鼠标点击「完成，不再显示」：清单消失、`onboarded:true`；同 profile 重启不重现 |
| 运行期工具 | `tsx/cjs` loader 与 `@vscode/ripgrep` 在解压产物内实测可用 |
| 源路径 | `apps/` 与 `src/` 内无对源码树绝对路径的引用 |

### 三、本轮读数（本轮现跑）

- 打包判卷：`tests/desktop-package.test.ts` **14/14 绿**（新增 mock-keychain 隔离判据）。
- 主进程硬化：`main-hardening` **11/11 绿**；退回旧接线实测红。
- dev 冒烟：`pnpm --filter cairn-desktop smoke` **PASS 1831 ms**。
- core：`pnpm test:capped`（maxWorkers=2）**557 文件 / 7201 条全绿，exit 0**。
- desktop：**231 文件 / 1590 条，1586 绿 / 4 红**；4 条全是他笔在飞的设计/CSS 判卷
  （`cds-parity`、`row-actions-reveal`、`stream-nav`、`tool-rows`），与本笔改动的
  `shell-url.ts` / `index.ts` / `package.mjs` / 两个判卷文件无关；`desktop-boundary-check` 绿。
- `typecheck` 0 报错。
- 红样本保留：`package-final-red.log`（首跑超时）、`package-final-red-2.log`
  （修复 IPC 后仍被钥匙串卡住）、`package-hang-red.log`（主线程栈）。

### 四、边界

- ad-hoc 签名，没有 Developer ID / 公证；换机器首次打开会被 Gatekeeper 拦。
- 只做 macOS arm64；Windows/Linux 打包入口未做。
- 真实钥匙串首启（稳定签名）未验；打包冒烟用的是 mock keychain。
- 真实 provider 未验；冒烟与产品链使用 demo provider。
- 包相关代码已提交（`9ee125b0`）；本报告首批（Task 1–4）仍留在工作树，未提交。
- 产物未入库（`apps/desktop/release/` 被忽略）；可复现命令与读数在
  `package-release-2.log` / `outside-verify-2.log` / `link-audit-2.json`，包内首启修复在
  `package-onboarding/`（`before/after/restart.png`、`click.json`、`restart.json`）。
- 本包于 **2026-10-28 21:04** 重建，包含首启检查「完成，不再显示」修复；20:29 的旧包已移出。
  首个 20:29 包的读数是历史点，不随本次重建改写。

## 完整产品的后续验收

| 主路径 | 尚需证明的用户结果 |
|---|---|
| 独立安装 | **macOS ad-hoc 包已核验**：离开源码树可启动、跑 demo 任务、版本/依赖可查；Developer ID/公证、稳定签名下的真实钥匙串首启与 Windows/Linux 仍未验 |
| 配置恢复 | 并发保存不丢 provider；配置与密钥提交失败或进程中断后不会静默错配 |
| 首次使用 | 未配置、错误 key、错误地址与不可用安全存储都有可操作的界面反馈 |
| 任务交付 | 真实任务经过执行、验证、失败修复、取消续跑和交付；终态与事件/实际文件一致 |
| 长期使用 | 重启恢复、长会话、插件/权限/多 agent 交互在同一用户路径上可用 |
| 真实模型 | 用明确版本与预算测任务成功率/成本/恢复行为；确定性 demo 不能替代 |

`changes.patch` 只包含本批修改，针对开工工作树生成；不是一份已经认证的独立发布包。
`source-manifest.json` 记录被测源码摘要。其他会话已跟踪差分与开工快照一致。
