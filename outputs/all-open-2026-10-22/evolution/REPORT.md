# 自进化遗留修复：当前工作树验证

本批四项核对：两项已有修复且现跑有效；两项缺陷已复现并修复。改动未提交，证据覆盖当前工作树，不覆盖 HEAD 认证或部署结果。

## 结果与具体口径

| 项目 | 当前结论 | 实际行为证据 |
|---|---|---|
| 缺 verify 的样本不晋升 | 既有修复，本批未改实现 | 既存 `evolution-kernel` 测试通过；新增回归经 `extractSignals → tickCanaryFromSignals` 连续两次 none、每次重建 controller 后，样本审计为 2、有效证据仍为 0；再两次 green 才晋升 |
| 安装后内容被改不进入提示词 | 既有修复，本批未改实现 | 既存 `evolution-kernel` 测试实际安装 content-pack、写候选档案、改安装目录 prompt.md，再调用 `activeContentPackNote` 返回空串；有效包与缺档负控也通过 |
| no-progress 规则没有消费者 | 已造红并接线 | 新增真实事件输入含两次主面 work/verify 配对，边界后的 2100 token、均值 1150、基线 1000、factor=2：只命中 no-progress，真实 active 回到 1.0.0，落带原 run 的 lesson |
| registry 损坏使回退失败后永久结案 | 已造红并修复 | 真账本中段写坏、删索引、触发退化：留 degraded + rollbackError + 待重试位；新一轮尚坏不补计样本、不重复 lesson；恢复原账本字节后，生产 tick 完成回退，账本仅一条 rollback，后续 tick settled |

`docs/sema-proposal.md` 只列出 no-progress 指标，没有给尾部 token 数值阈值。本批新增接线的具体判据是：`costMeasurable=true`、有 `tokensPerBoundary`、有正 `baselineTokensPerBoundary`，且 `spendAfterLastBoundary > baselineTokensPerBoundary × costDegradeFactor`。复用既有基线与退化倍数，不新增第二份预算。尾部为 0/1/300、恰好 2000、无基线、没有可测 verify 边界均不回退；factor=3 的负控/正控证明阈值随现有配置变化。此规则判断的是超过预算且没有新 verified 边界的尾部，不等同于“产物完全没有变化”。

回退的三态处理：成功回退后清掉旧 rollbackError；`RegistryLogCorruptError` 是本批唯一明确支持自动重试的错误；没有 previous、previous 位变化等安装拒绝仍结案。历史记录没有新字段时，只认本类已存错误的固定前缀 `registry.jsonl 第 N 行损坏（`，不猜其它失败成因。重试保留原退化 run；旧档未存 run 则诚实写 unknown。pending 档不能被 begin 重开清零。active 已换新版时旧档返回 idle，不改指针；previous 已变则永久拒绝，不在每轮重复结算。

## 改动

- `src/main/evolution/canary.ts`：消费尾部成本；记录可重试回退与原退化 run；恢复及保护 pending 档；解析新增可选字段；恢复成功后更新 lesson。
- `tests/evolution-open-closeout.test.ts`：新增 9 条实际工作区行为测试；全部走生产 signal/tick 缝，使用真实 registry、Installer 与 lesson 存储，没有付费请求。
- 本目录：原样红绿日志、OCR helper 输出和本报告。

未改冻结判卷/夹具、安装授权、AGENTS/STATE/PROGRESS/BLOCKED、package、gate-manifest；未提交、stash 或 reset。

## 当前命令、退出码与计数

所有命令从仓库根执行。

| 阶段 | 命令 | 退出码/实际读数 | 日志 |
|---|---|---|---|
| 首次红测，修复前 | `pnpm exec vitest run tests/evolution-open-closeout.test.ts --config tests/vitest.config.ts --maxWorkers=2` | 1；7 条中 4 失败、3 通过；失败是 no-progress 不回退、修账后仍 degraded、旧 pending 被 settled、旧档不能恢复 | `red.log` |
| no-progress 单项修复后 | 同上追加 `-t 'measurable tail\|normal reply'` | 0；2 通过、5 跳过；这不是完整套件 | `no-progress-green.log` |
| 两项修复后的第一轮 | `pnpm exec vitest run tests/evolution-open-closeout.test.ts --config tests/vitest.config.ts --maxWorkers=2` | 0；7/7 通过 | `green.log` |
| 最终定向复跑 | `pnpm exec vitest run tests/evolution*.test.ts --config tests/vitest.config.ts --maxWorkers=2` | 0；**8 文件 / 173 用例通过，2 workers**（含新增 9 例） | `all-evolution-green.log` |
| 首轮类型检查 | `node --import tsx scripts/typecheck.ts` | 2；新测试辅助函数重复 id 的 TS2783，已修 | `typecheck.log` |
| 最终类型检查 | 同上 | 0；tsc --noEmit，0 报错 | `typecheck-green.log` |
| diff 空白检查 | `git diff --check -- src/main/evolution tests/evolution-open-closeout.test.ts` | 0 | 本批工具输出 |

未跑全量 core、desktop、gates、mutate-verify 或 head-cert-check；由主代理统一验证。当前基点 HEAD 是 `d0708a0`，它不包含本批未提交改动。

## 代码审查与真实边界

已按 OCR delegate 模式调用 `ocr delegate preview --exclude ...` 与 `ocr delegate rule src/main/evolution/canary.ts tests/evolution-open-closeout.test.ts`，两者退出 0。preview 已用排除项限定相关改动，选中 canary.ts；新测试被 helper 默认 `default_path` 排除，所以另对它显式取 rule 并由本代理人工审查。helper 只选文件与解析规则，没有执行模型审查，没有调用 `ocr review`/`ocr scan`。自审未发现新增必须修复项；上述指针、样本、lesson 与旧档负控是重点。

本仓没有 `.codegraph/` 索引，本次使用定向 rg 和读取。对 `src/ apps/ scripts/` 的 `CanaryController` 与 `baselineTokensPerBoundary` 现读只找到 activation-host 的收束实例；本次未证明生产路径会自动 begin 新档，第 645 页对该点的 VOID 结论也不能作为本批证据。此批证明的是“已经合法开档后”的生产收束与恢复，不增加自动安装/开档权限。

跨重启回归使用全新 controller/registry，通过真实盘上记录恢复，无缓存/内存接力；没有执行 OS 杀进程级断电演练。Registry 本身已有的跨进程并发不承诺未被扩大。
