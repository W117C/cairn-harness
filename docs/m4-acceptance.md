# M4 验收总对表（三态：已证 / 未证 / 计划完成）

> 出具：M4b 收口轮（2026-09-12）。对表对象：`agent-plan.md` §14 M4 行 + §12.2（M4a 交付）+ §13（设置七组与新手引导）。
> 每行带**证据指针**（脚本名 + 断言编号:行号 / 文件:行），审查方可按指针复跑。
> 三态口径：**已证** = 有可复跑的断言；**未证** = 断言没跑到（环境/凭据限制），**不等于通过**。
> 复跑口径：`pnpm gates`（22 道门逐道退出码 + 恒真式体检）；M4 断言面 = 第 21/22 道门 `schedule-check`（67 断言）+ `commercial-check`（45 断言）+ `tests/schedule.test.ts`（27 项）+ `tests/{license,updater,provider-keys,onboarding}.test.ts`（29 项）。
> M4 分两轮交付：M4a（定时任务全链路，HEAD `2f1a657`）→ M4b（可安装包 + BYOK + license/更新/引导，本轮收口）。

## 一、§14 M4 行验收标准（2 条）

| # | 标准 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | **可安装包分发外部用户走通 BYOK 全流程**（平台范围 = macOS，P16） | **已证**（本机口径）/ **未证**（真连拨号需凭据） | 打包：`pnpm dist` → `dist/M0 Agent-0.0.1-arm64.dmg` + `.zip`（electron-builder.yml，**unsigned V1 边界**——无 Apple 开发者账号，首次打开需右键→打开）；打包产物冒烟：`docs/m4b-onboard.png`（打包 .app 主界面 + 首启向导 1/4 BYOK key 步 + safeStorage 可用徽标）与 `docs/m4b-about.png`（设置模态：Provider 管理 key 存钥匙串/删除 + 单价表 + 权限档位/沙箱/安全模式 + 关于/更新组）；BYOK 存储链路：`scripts/commercial-check.ts` C1–C4（存取往返还原明文 / **明文零落盘** store 文件只有密文 / storedProviders 零值 / safeStorage 不可用 → 拒装配 fail-closed 不退回明文）+ `src/main/agent-runner.ts:injectStoredProviderKey`（重启解密注入，env 优先）；**未证**：真实 GLM 拨号（无 M0_API_KEY；key 在场重跑 `pnpm provider:check` 即闭合，沿 M1a-1 先例） |
| 2 | **定时任务全链路**：表单 + agent 工具（审批卡）创建 → 1min tick 触发全新会话 → 重启补跑最近一次 → skip/并发/过期原因可查 | **已证**（M4a） | `scripts/schedule-check.ts` A–K 67 断言（A 校验矩阵 / B 双轨存储 / C occurrenceKey 去重双触发免疫 / D 三闸+独立计数 / E catchUp 两档+7 天边界 / F fail-closed 无人值守真实路径 / G 超时双闸 / H 工具五件审批卡红字 / I 六态历史 / J 三事件重放无损 / K 旧日志零破坏）；截图 `docs/m4a-schedule.png`（skip 原因 hover 可见 + 补跑 + 完成卡） |

## 二、§13 设置七组与新手引导

| # | 项 | 状态 | 证据指针 |
|---|---|---|---|
| 1 | Provider 管理（BYOK key · 单价表） | **已证** | `commercial-check` C 段 + `src/main/provider-keys.ts`（safeStorage 后端）+ 设置页（docs/m4b-about.png） |
| 2 | 权限档位（沙箱状态 + 产出代码安全模式） | **已证** | M1c/M2f 交付；设置页可见（docs/m4b-about.png） |
| 3 | UI（主题/布局） | **已证** | M1e 交付 |
| 4 | 定时任务 | **已证** | M4a（schedule-check 67 断言） |
| 5 | 记忆管理 | **已证** | M2d（memory-check） |
| 6 | 遥测开关（默认关） | **已证** | `commercial-check` D2（缺省 false）+ **V1 无上报实现 = 零数据出门**（最强保证，关于页注明） |
| 7 | 关于/更新 | **已证** | `commercial-check` B1–B6（semver 比对矩阵 / 未配置显式态 / 错误显式态 / 未知字段拒绝 / 下载页 http(s) 白名单）+ `src/main/updater.ts` |
| 8 | **新手引导走通全部设置项** | **已证** | `commercial-check` D1–D1c（引导组 = §13 七组不多不少、四步无空步、label/entry 非空）+ `tests/onboarding.test.ts`（状态机：缺省 false 首启必弹 → 完成 true 不再弹 → 非法值回退）+ 打包产物截图（docs/m4b-onboard.png 向导中态 / onboarded=true 不再弹冒烟实录） |

## 三、license V1（任务书 §2.2 拍板边界）

- 离线 Ed25519（node:crypto，零新依赖）；`<appData>/license.json` {licensee, expires_at?, signature}；**验签失败/缺失不阻断功能**——只在设置/关于页显状态 + 引导横幅。证据：`commercial-check` A1–A8（有效/篡改/错公钥/坏 base64/过期/结构坏/无文件 inactive/坏 JSON）+ `tests/license.test.ts` 七项矩阵。
- 内置公钥为常量；**私钥不入仓库**（.tmp 一次性工具签发测试 license）。

## 四、V1 边界备案（指挥官拍板，任务书 §2）

- **unsigned 包**：无 Apple 开发者账号，不配签名/公证（electron-builder.yml `identity: null` 显式注释）；首次打开需右键→打开。
- **更新 = 轻量检查**：manifest URL 可配，未配置显式态；不做自动下载/安装（不引 electron-updater）。
- **遥测**：设置项在场、默认关、无上报通道。

## 五、收口基线（2026-09-12，22 道门）

- `pnpm gates`：**22 道全绿 + 恒真式体检零命中 + exit 0**（M4b 终审实录 `.tmp/m4b-final-gates.log`）。
- test = **45 files / 413 passed / 0 skipped**（M4a 后 384 → +29）。
- 冻结判卷 sha256 3/3；`scripts/frozen-sha256.json` sha256 = `9b7f44f9…8c4ba` 逐字节未改。
- 反向验证 4 条红→绿（PROGRESS M4b 段实录）：①safeStorage 不可用静默放行 → C4b 红；②摘 license 签名比对 → A2/A3/A4 红；③更新比对恒「无新版」→ B5 红；④onboarded 缺省 true → D2/D2b/D2d 红 + onboarding 反向锚单测红。
- 密钥卫生：词边界扫描命中均为文档/演练假 key 字面量，真实 key 0 命中。

## 六、计划完成声明

**M0–M4 五个里程碑全部收口**（M0 骨架 / M1 会话内核 / M2 编程能力 / M3 多 agent 编排 / M4 商业化），`agent-plan.md` §14 里程碑表全部行有验收对表：`docs/m2-acceptance.md`、`docs/m3-acceptance.md`、本文件。M4+ 候选（hourly/monthly/custom kind、loopback 重跑、热恢复、license 服务端、签名公证）见各对表「未证/留位」节，均未在对应里程碑偷做。
