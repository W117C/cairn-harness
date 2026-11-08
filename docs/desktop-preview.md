# 桌面预览包：构建与核对

本文描述本仓库的本地打包流程。当前只提供开发者预览包，不表示已有面向大众的签名发行版。授权见 [LICENSING.md](../LICENSING.md)。

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

实际运行依赖由 `pnpm deploy --prod` 按版本控制中的 `pnpm-lock.yaml` 装出，打包过程不重新解析版本；
`pnpm-lock.yaml` 会随包放入 `Cairn.app/Contents/Resources/app/`，其 SHA-256 写入 `release.json` 的
`runtimeLockSha256`。根包版本、生产依赖或 tsx 声明变化时，必须先更新并审阅 `pnpm-lock.yaml` 再打包。
不同平台的可选依赖与安装脚本仍须实际验证，不宣称产物逐字节可复现。

`pnpm-lock.yaml` 的更新走仓库常规依赖流程（`pnpm install` / `pnpm update`），并遵守
`pnpm-workspace.yaml` 的安全 overrides；必须重新执行打包、签名校验与解压后的冒烟，不能只提交锁文件。

## 首次打开与支持边界

当前只进行无需签名身份的 ad-hoc 签名，没有 Developer ID 签名和 Apple 公证。
从网络下载后，macOS 可能阻止首次运行。确认来源可信后，按 Apple 的
[官方首次打开说明](https://support.apple.com/en-us/102445)操作；不要求关闭系统全局安全保护。
实际下载、干净用户环境、真实 provider、升级与恢复仍需按发布前验收清单逐项验证。

反馈请提供版本、系统/架构、失败步骤和脱敏错误信息。不要提交 API key、完整私人会话或浏览器配置。
