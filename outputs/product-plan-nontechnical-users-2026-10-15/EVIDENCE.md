# 本轮分析的验证记录

日期：2026-10-15，北京时间。工作目录：`/Users/ze/Downloads/Cairn/deepseek harness`。

基线分支：`fix/spec-summary-double-count`。HEAD：`d7fe85563edeb2064ba2d88a2b03fe3f5ace5766`。

本轮执行了只读代码、文档、版本与远端状态核查，以及下列本地检查。未修改业务代码、已有治理文件、技能或配置；本轮产物保存在本目录。读取时存在其他会话的未提交改动，未将其提交、重置或暂存。

| 命令 | 结果 | 原始日志 |
|---|---|---|
| `node --import tsx scripts/typecheck.ts` | exit 0，0 报错 | [typecheck.log](</Users/ze/Downloads/Cairn/deepseek harness/outputs/product-plan-nontechnical-users-2026-10-15/typecheck.log>) |
| `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` | exit 0；376 文件、5361 测试通过，203.34 秒 | [core-test.log](</Users/ze/Downloads/Cairn/deepseek harness/outputs/product-plan-nontechnical-users-2026-10-15/core-test.log>) |
| `pnpm --filter cairn-desktop test` | exit 0；22 文件、206 测试通过；desktop-boundary-check 绿 | [desktop-test.log](</Users/ze/Downloads/Cairn/deepseek harness/outputs/product-plan-nontechnical-users-2026-10-15/desktop-test.log>) |
| `pnpm --filter cairn-desktop typecheck` | exit 0 | [desktop-typecheck.log](</Users/ze/Downloads/Cairn/deepseek harness/outputs/product-plan-nontechnical-users-2026-10-15/desktop-typecheck.log>) |

核心日志中“拒跑”“取料坏”等文字来自负向测试场景。最终测试汇总与进程退出码均已核对，未把这些预期输出当成测试失败。

GitHub 核对命令：

```sh
gh run list --repo W117C/cairn-harness --limit 6 \
  --json databaseId,headSha,headBranch,status,conclusion,createdAt,url
gh run view 38676897409 --repo W117C/cairn-harness \
  --json headSha,conclusion,workflowName,event,jobs
gh api repos/W117C/cairn-harness/releases --jq '{count:length,tags:[.[].tag_name]}'
```

核对结果：verify run [38676897409](https://github.com/W117C/cairn-harness/actions/runs/38676897409) 为 completed/success，headSha 与上述 HEAD 完全一致；其步骤包括核心与桌面测试、类型检查、25 道认证快门，均成功。Release 接口返回 `{"count":0,"tags":[]}`。该 CI 结果不覆盖未提交工作区的内容。

从[门禁清单](</Users/ze/Downloads/Cairn/deepseek harness/scripts/gate-manifest.ts>)直接导入核对：GATES=34、CERT_GATES=25。本轮没有重新执行全部门或完整变异表。

**设置问题的最小复现**

在项目根目录执行以下命令，仅加载现有模块并调用纯函数：

```sh
node --import tsx --input-type=module -e '
globalThis.React = await import("./apps/desktop/node_modules/react/index.js");
const m = await import("./apps/desktop/src/renderer/components/SettingsPanel.tsx");
console.log("locale_patch=" + JSON.stringify(m.panelPatch({locale:"en-US"})));
console.log("theme_patch=" + JSON.stringify(m.panelPatch({theme:"dark"})));
console.log("deepseek_in_key_options=" + m.PANEL_PROVIDER_KINDS.filter(m.providerNeedsKey).includes("deepseek"));
'
```

结果：

```text
locale_patch={}
theme_patch={"theme":"dark"}
deepseek_in_key_options=false
```

源文件中 `keyProvider` 的初值为 `deepseek`。使用纯内存的假安全存储后端、无真实密钥、无真实写盘，调用 `putProviderKey("deepseek", "analysis-placeholder-not-a-real-key")`：

```json
{"deepseekAccepted":false,"result":{"ok":false,"error":"未知 provider：deepseek（白名单：glm/openai/anthropic/gemini）"},"wrote":false}
```

此结果证明干净注册表下后端会拒绝该初值；本轮没有声称已经在真实 Electron 窗口中点击并复现完整表单流程。

**历史能力数据**

读取的主样本：[readings.json](</Users/ze/Downloads/Cairn/deepseek harness/outputs/bench-12-after-479-2026-10-13/readings.json>)。12 行均为 `providerFace=真会话`、`headSha=80ad8ad1f0695b89a7e34026d944a03311b61310`、`model=cn:hy3`、`maxSteps=20`，每任务一次，`g.ok` 共 12/12。累计运行秒数为 399.806，累计输入加输出 token 为 343257；价格字段不可测部分未被按零成本处理。

早期 B12 两条记录在 HEAD `1547c364`、`maxSteps=40` 下失败；主样本中的 B12 已成功。两批不是同配置对照实验，本轮没有据此计算改善百分比。

没有执行的验证：真实模型新请求、真人试用、完整桌面交互审计、桌面构建/打包、干净机器安装、正式签名/公证、升级迁移、完整变异表。具体产品指标和时间窗口均为建议值。
