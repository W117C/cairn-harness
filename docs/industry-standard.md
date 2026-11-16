# 「行业最高」怎么判：本方标准（可复算）

## 为什么不写「比某某强」

比较级需要**对手的可复现读数**：同一台机器、同一份素材、同一套判据。离线拿不到，硬写就是编。
所以这里换成**可判的标准**：把「最高水平」拆成六条能算的线，每条都要有阈值、有命令、有现读。
谁来看都能重跑；哪条掉了，红的是判据，不是嘴。

## 六条线

| 维度 | 阈值（可判） | 判据命令 | 现读 |
|---|---|---|---|
| S1 可判性 | 评分面 covered 比例 = 1.000；`out` 每格必须带理由（≥8 字） | `npx vitest run --config tests/vitest.config.ts tests/parity-standard.test.ts` | 20/20 covered，2 格 out 均带理由 |
| S2 真实机读数 | 真机冒烟 ≥ 50 条且全绿；四份密封证据都带 `rendererDigest`；**对照报告由读数生成**（`scripts/standard-report.ts`） | `npx tsx scripts/standard-report.ts` | 60/60 绿；四包重签；报告 `outputs/standard-conformance/report.json` 总判 pass |
| S3 失败可见 | 每条降级/裁剪路径都有 UI 点名（不可用 / 缺层 / 取消语义） | `npx vitest run --config tests/vitest.config.ts tests/parity-standard.test.ts` | 降级/缺层/取消 三处均有判据 |
| S4 权限收敛 | 成员权限档 ≤ 团队档（`clampTier` 有判据）；密钥**默认拒** | `npx vitest run --config tests/vitest.config.ts tests/team-members.test.ts tests/team-secrets.test.ts` | 裁剪会出声；无记录即不许用 |
| S5 可审计 | 事件日志只追加：补丁条数只增不减；授权/申请历史保留 | `npx vitest run --config tests/vitest.config.ts tests/team-members.test.ts tests/team-secrets.test.ts` | 移除写墓碑；后写覆盖前写但历史在 |
| S6 可复算 | 任何读数都能用仓库内命令重跑；台账每页点名命令/工件 | `npx tsx scripts/docs-check.ts` | 台账 1277 页，凭证对账面红 0 |

## 判据怎么用

```bash
# 一次跑完六条（在仓库根目录）
node --import tsx scripts/typecheck.ts
npx vitest run --config tests/vitest.config.ts tests/parity-standard.test.ts \
  tests/team-members.test.ts tests/team-secrets.test.ts
pnpm test:capped
npx tsx scripts/docs-check.ts
```

## 按公开标准对照（阈值来自外部，不是我方自定）

比较级需要对手的可复现读数（同机、同素材、同判据），离线拿不到；**公开标准**是可引用的外部阈值。
下表每条都写清「哪份标准的哪一条」「阈值」「我方真机现读」「证据文件」。

| 标准 · 条款 | 阈值（外部） | 我方现读 | 证据 |
|---|---|---|---|
| WCAG 2.2 SC 1.4.3 Contrast Minimum | 正文对比度 ≥ 4.5:1 | **4.526**（按最差格，由 `scripts/standard-report.ts` 从读数算出） | `apps/desktop/scripts/wallpaper-csp-smoke.cjs` `scripts/standard-report.ts` |
| WCAG 2.2 SC 2.1.1 Keyboard | 全部功能可用键盘完成 | 选择器：目录输入可键入、Enter 前往、列表项是 `<button>` 可 Tab 到 | `apps/desktop/tests/wallpaper-browser.test.tsx` `apps/desktop/src/renderer/components/settings/WallpaperBrowser.tsx` |
| CSP Level 3（`script-src` 不许 `unsafe-inline`） | 内联脚本必须被拦 | 反证臂：摘 scheme 即加载失败；CSP 里无 `unsafe-inline` | `apps/desktop/scripts/wallpaper-csp-smoke.cjs` |
| Electron 安全清单（contextIsolation / 无 nodeIntegration / 沙箱） | 三项都为「是」 | preload 只暴露 `window.agent`，渲染层拿不到 node | `apps/desktop/src/preload/index.ts` |
| OWASP Top 10 2021 A09（安全日志与监控） | 敏感值不得进日志 | 注入值出现在输出即被打码（四跳串联判据） | `tests/team-secrets.test.ts` |

## 明确不做（out，带理由）

| 能力 | 为什么不做/判不了 |
|---|---|
| `wallpaper.scene-engine` | 明确不做：与产品定位不符（静态/视频壁纸之外的三维场景不在范围内） |
| `wallpaper.native-click` | 自动化判不到：Electron 无替人点击 API，本机无辅助功能权限。人工脚本 `apps/desktop/scripts/native-pick-accept.cjs` 已**执行过一次**：60.6s `TIMEOUT`（无人点击），读数落 `outputs/native-pick-accept/native-pick-accept.json` |
