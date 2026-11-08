# 桌面预览包：构建与核对

本文描述候选分支的本地打包流程，不表示已经提供公开安装包。当前使用范围仍以 [LICENSE](../LICENSE) 为准。

## 构建

在 macOS 上使用仓库约定的 Node 与 pnpm 版本，安装锁定的开发依赖后执行：

```sh
pnpm install --frozen-lockfile
pnpm --filter cairn-desktop package
```

目标为 `apps/desktop/release/`。目录已经存在时构建拒绝覆盖；需要先自行保留旧产物，再选择新的构建环境。
打包会构建界面、安装运行依赖、进行 ad-hoc 签名与严格校验，随后启动实际应用完成模拟 provider 冒烟。
冒烟通过后生成 DMG；系统无法生成 DMG 时使用 ZIP。模拟冒烟不证明真实模型和跨机器安装可用。

## 产物

| 文件 | 用途 |
|---|---|
| `Cairn.app` | 桌面应用 |
| `Cairn.dmg` 或 `Cairn-macOS.zip` | 供传输的归档 |
| `release.json` | 应用版本、构建主机平台/架构、Electron 版本、签名状态、归档哈希与大小、实际运行依赖锁的哈希 |
| `SHA256SUMS` | 归档与 release.json 的 SHA-256 校验值 |

将归档、`release.json` 与 `SHA256SUMS` 放在同一目录，从该目录核对：

```sh
shasum -a 256 -c SHA256SUMS
```

两个文件均显示 `OK` 才表示与这份校验清单一致。校验和用于检查完整性，不替代发行者身份认证；校验清单本身也需要从可信来源取得。
`buildHost` 记录构建主机，不代表所有兼容的平台或架构。

实际安装的依赖锁保存在 `Cairn.app/Contents/Resources/app/package-lock.json`，其摘要写入 `release.json`。
打包使用版本控制中的 `apps/desktop/runtime/package-lock.json`，通过 `npm ci` 安装，禁止打包时自动更新锁。
根包版本、生产依赖或 tsx 声明变化时会拒绝使用旧锁。该运行锁独立于 pnpm 开发依赖锁；不同平台的可选依赖和安装脚本仍须实际验证，不宣称产物逐字节可复现。

更新运行锁时，在仓库外临时目录建立与打包脚本生成的 `runtimePkg` 相同的 package.json，复制旧运行锁，执行 `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`。
审阅版本、来源、完整性字段及 `pnpm-workspace.yaml` 中安全 overrides 所保护的依赖，再将更新的锁复制回 `apps/desktop/runtime/package-lock.json`。
必须重新执行打包安全测试、实际打包和解压后的冒烟，不能只提交自动生成的锁。
当前 Dependabot 未配置此运行锁目录；pnpm 依赖或安全 overrides 更新时，维护者需同步检查运行锁。
`npm ci` 的冻结安装行为见 [npm 官方说明](https://docs.npmjs.com/cli/commands/npm-ci/)。

## 首次打开与支持边界

当前只进行无需签名身份的 ad-hoc 签名，没有 Developer ID 签名和 Apple 公证。
从网络下载后，macOS 可能阻止首次运行。确认来源可信后，按 Apple 的
[官方首次打开说明](https://support.apple.com/en-us/102445)操作；不要求关闭系统全局安全保护。
实际下载、干净用户环境、真实 provider、升级与恢复仍需按[预览版验收清单](superpowers/plans/2026-11-08-productization.md)逐项验证。

反馈请提供版本、系统/架构、失败步骤和脱敏错误信息。不要提交 API key、完整私人会话或浏览器配置。
