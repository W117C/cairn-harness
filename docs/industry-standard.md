# 「行业最高」怎么判：本方标准（可复算）

## 为什么不写「比某某强」

比较级需要**对手的可复现读数**：同一台机器、同一份素材、同一套判据。离线拿不到，硬写就是编。
所以这里换成**可判的标准**：把「最高水平」拆成六条能算的线，每条都要有阈值、有命令、有现读。
谁来看都能重跑；哪条掉了，红的是判据，不是嘴。

## 六条线

| 维度 | 阈值（可判） | 判据命令 | 现读 |
|---|---|---|---|
| S1 可判性 | 评分面 covered 比例 = 1.000；`out` 每格必须带理由（≥8 字） | `npx vitest run --config tests/vitest.config.ts tests/parity-standard.test.ts` | 20/20 covered，2 格 out 均带理由 |
| S2 真实机读数 | 真机冒烟 ≥ 50 条且全绿；四份密封证据都带 `rendererDigest` | `npx electron apps/desktop/scripts/wallpaper-csp-smoke.cjs <out>` | 60/60 绿；四包重签 |
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

## 明确不做（out，带理由）

| 能力 | 为什么不做/判不了 |
|---|---|
| `wallpaper.scene-engine` | 明确不做：与产品定位不符（静态/视频壁纸之外的三维场景不在范围内） |
| `wallpaper.native-click` | 自动化判不到：Electron 无替人点击 API，本机无辅助功能权限。人工脚本 `apps/desktop/scripts/native-pick-accept.cjs` 已**执行过一次**：60.6s `TIMEOUT`（无人点击），读数落 `outputs/native-pick-accept/native-pick-accept.json` |
