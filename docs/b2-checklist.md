# B2 留门清单（触发条件在头，别提前动工）

> **触发条件：出现第一个真实外部用户。** 未触发前本清单只记账、不施工。
> 对应 ADR 0002 的推翻条件（`docs/adr/0002-v1-audience-b1-internal-beta.md`）。

| # | 事项 | 验收判据 |
|---|---|---|
| 1 | npm 源码包（ADR 0001 推翻条件 #2 的对应方案） | `private:true` 摘除＋`files` 白名单实测 `npm pack` 体积合规；`tsx` 从 devDependencies 挪进 dependencies；干净环境克隆装完可跑 |
| 2 | LICENSE 选型重开 | 专有内测授权换成明确 OSS/商业条款；法务口径过一遍 |
| 3 | 桌面交付面 | 重开 ADR 0001 D1；桌面层过自己的门禁（root gates 现不扫 apps/） |
| 4 | 文档双语 | README 英文面与中文面同源对账（docs-check 扩展） |
| 5 | Windows 安装路径 | install.sh 的 PowerShell 对应物＋CI 矩阵实证 |
| 6 | 官网/遥测 | 立项另议；遥测必须先过脱敏判卷 |
