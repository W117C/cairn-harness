# 第 433 页 · 第 432 页那一笔被两把秒级尺喊红：注释当切片边界 ＋ 抄生产文案当断言

认证读数（`edf6101b`，认证树独占，两端并发 0）：门表 23/23 绿、typecheck 0、
`Test Files 3 failed | 344 passed (347)｜Tests 3 failed | 4906 passed (4909)`。三条红逐条读：

| 红的那条用例 | 归因 | 本笔动作 |
| --- | --- | --- |
| `tests/scratch-tree-naming.test.ts > 真仓面：注册表里的暂存树名字都没说谎 > 三类不一致都必须为 0…` | 第 413 页登记的常驻红（`gate-mutate-verify` 的豁免在别人工作树里，未落库） | 不动，照旧具名登记 |
| `tests/assertion-health-scan.test.ts > 已跟踪的 tests/ 里不许新增注释文字当边界` | **我的**：`["/** IO 壳"]` —— 装配面那节判卷用 `src.indexOf("/** IO 壳")` 当切片右界 | 右界改成代码标识 `export async function runDoctor` |
| `tests/prose-needle-scan.test.ts > 真仓读数必须在帽内` | **我的**：顶包候选 13（帽 10），三条整串都来自第 432 页判卷抄的生产文案——「来路 缺省」「来路 env M2E_PLUGIN_DATA」「已信任 2 条／已拒绝 1 条」（最后一句还抄了两处） | 见下 |

## 修法（不改帽、不删断言，改的是断言的形状）

1. **切片边界**：`tests/doctor.test.ts` 装配面那节的右界从注释文字换成 `export async function runDoctor`。
   棘轮的理由在这一格特别直观：注释是"说改就改"的，把判卷的取料面钉在注释上，等于任何一次改文案
   都能悄悄把切片挪走而判卷照绿。
2. **来路那两句**：生产的文案改成整串字面量 `"取址来自 env M2E_PLUGIN_DATA"`／`"取址来自用户级缺省落点"`，
   判卷断言这两个整串。原来报的是「来路 缺省」这种**运行时拼出来的片段**，它横跨生产侧好几个字面量，
   改其中任何一个都不会响——尺把这格叫顶包候选，是对的。
3. **条数那一句**：抽出 `trustCountsText(trusted, declined)` 并导出，判卷用
   `toContain(trustCountsText(TRUST_ENTRIES.trusted, TRUST_ENTRIES.declined))` 这种**派生断言**
   （共用生产的拼法），不再抄整串；同时把真盘那一条用例的表改成 3 条／2 条，与纯核基线的 2 条／1 条不再同串。
4. **顺带**：目录读不出那条 hint 原来靠拼接复用 `origin`，换整串后读起来变成「检查这一格的来路（取址来自…）」，
   改成独立的一句「读不出的是数据根本身：用 M2E_PLUGIN_DATA 指到一个可读目录，或把它的权限修好」。

## 这一格有没有变成尺？

- 三条红全是**已有**的秒级尺喊出来的（`assertion-health-scan`、`prose-needle-scan`），不需要新锚点；
  第 432 页那六根 `doctor-trust-*` 针脚一行没动（改的是文案行与 hint 行，不在针脚上）。
- 刻意没给 `trustCountsText` 单独加锚点：它是文案拼法，行为已被六根锚点里的两条（坏表折成 ok／
  算出来没 push）间接钉住；再加一根就是往元验证上叠（业主口径：不要过拟合）。

## 落库前现读

- `typecheck` 0 错；`tests/doctor.test.ts` ＋ `assertion-health-scan` ＋ `prose-needle-scan` 三支 143 条里 1 条红，
  那一条正是帽那一格，且它只在**脏树面**红（在飞 4 条是隔壁的）；`prose-needle-scan` CLI 现读
  `顶包候选 11（已提交 7 ＋ 在飞 4）`，本簇文件贡献 **0** 条 ⚠️（只剩 `·` 那一类共享词，不进门禁）。
- 干净树面要等这笔落库后由认证重读，不在这里替它报数。
