# Cairn macOS 受邀内测安装

本轮不使用 Apple Developer ID 或公证；保留应用运行所需的本地 ad-hoc 封装。仅安装发行方直接提供、且你确认来源的内测包。

## 安装

1. 在「关于本机」确认芯片类型与发行包的 `build-info.json` 中 `arch` 一致：`arm64` 对应 Apple Silicon，`x64` 对应 Intel。本轮实测包为 arm64，不代表 Intel 已验证。
2. 打开 DMG，将 `Cairn.app` 拖入「应用程序」；如果收到 ZIP，先解压，再将其中的 `Cairn.app` 拖入「应用程序」。运行应用无需安装 Node 或 pnpm。
3. 首次打开被 macOS 拦截时，到「系统设置 → 隐私与安全性」找到 Cairn，选择「仍要打开」。[Apple 官方说明](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac)
4. 如果确认包来源后仍遇到隔离拦截，在终端执行下面这一条，再从 Finder 打开 Cairn：

```sh
xattr -dr com.apple.quarantine "/Applications/Cairn.app"
```

此命令仅移除指定 Cairn.app 的下载隔离属性，不关闭系统 Gatekeeper。若安装位置不同，替换为实际的 Cairn.app 路径；不要对整个「应用程序」、Downloads 或系统目录执行。

## 首次任务

打开一个可用于试验的项目，在「设置」配置模型服务并测试连接。API Key 保存在这台 Mac 的系统安全存储中，安装包不附带发行方密钥。跨机器需重新配置；更换 ad-hoc 构建后，系统可能再次询问钥匙串访问权限。

先完成一个小修改，检查改动与验证结果，再决定保留或还原。内测先使用项目副本或 Git 工作树，保留原项目的恢复点。

## 升级与问题反馈

退出 Cairn 后用新版 Cairn.app 替换旧应用；不要同时运行两版。应用数据与项目中的 `.agent` 记录不随替换应用删除；API Key 不通过复制应用迁移。

遇到问题，在「设置 → 关于与更新」记录版本及构建来源，导出诊断包。`sourceDirty: true` 表示构建含未提交修改，`sourceCommit` 只标记基线，不能读作该提交已包含全部修改。将复现步骤与诊断包交给内测维护者，不附带 API Key。

另一台 Mac 的真实启动、钥匙串和模型任务需要在那台机器上验证；本机隔离目录冒烟不能替代跨机器验收。
