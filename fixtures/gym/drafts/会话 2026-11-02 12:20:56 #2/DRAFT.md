# 靶场草稿 会话 2026-11-02 12:20:56 #2（**不是判据，别登记进 frozen-sha256.json**）

自动得出的部分：task.md、expect.candidate.json、本清单。
还缺（人必须给，缺一就不能 promote）：
- repo/：pristine 靶子不在事件流里（会话跑在真工作区上；D7 快照只覆盖非空覆写那一格）⇒ 必须人给一份最小仓库
- negative.json：已知错误解要人写（自动生成＝编一个反例来证明尺子有效）
- expect.mustChangeFiles：这里给的是**改过**的文件，不是**必改**的文件 ⇒ 逐条人核，尤其要删掉跑偏那几笔
- 题面之外还有 1 条 user_message：一条 case 只装一个题面，多出来的要人决定并入还是另开一条
- 主流程一次成功的写盘都没有 ⇒ 这不是一条改动类任务，不适合直接进靶场

候选必改集（= 会话里成功写过的文件，逐条核）：
- （无）

统计：tool_call 6 次 · verify 1 次（最后一次 红）· 写失败 0 · worker 写 0 · 无结果的工具调用 0

## 为什么固化这条（失败证据原文，出自 `failureDigestFromEvents`）
[失败轨迹·高价值沉淀素材] 本轮：read_file×2, unknown×1（工具失败）；1 次验证失败。
这些是「下次怎么不重犯」的直接证据——若失败原因属于代码/git 推导不出的（环境口径、隐蔽依赖、反复踩的坑），
请按类型 feedback 沉淀（remember，kind=memory、type=feedback、scope=project）；能从代码/git 推导的不入记忆。
