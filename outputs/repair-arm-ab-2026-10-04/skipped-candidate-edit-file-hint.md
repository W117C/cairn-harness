# 候选增量：给 `edit_file` 的「文件不存在」也带上近名建议 —— **量过之后决定不做**

## 想法来源

`src/tools/read_file.ts:40` 的私有函数 `nearNameSuggestions` 会在读不到文件时给最多 3 个近名建议
（同目录前缀匹配优先，其次同扩展名），而 `src/tools/edit_file.ts:61` 的「文件不存在或不可读」是一个**死胡同**：
模型拿到这句只能自己再去 `glob`/`ls` 找一遍。把那份决策导出复用，看起来是一处便宜的返工削减。

## 现读：这个失败在真实轨迹里发生几次

取料面＝本机留档的基准事件流（`outputs/*/*.events.jsonl`，**84 份**）＋可及的 fixtures 面；
判据＝按 `tool_result` 正文里的**报错原文子串**计数（这些文案由 `edit_file.ts`/`read_file.ts` 自己产出，不是别处的散文）。

| 计数对象（逐字子串） | 命中 |
| --- | --- |
| `edit_file: 文件不存在或不可读` | **0** |
| `read_file: 文件不存在或不可读` | 1 |
| `old_string 在文件中 0 处匹配` | 1 |

（同一条命令里还出现过一次 `no matches found: fixtures/*.jsonl` —— zsh 把 glob 吃了，所以 fixtures 那一面**没扫到**，
本表只对 84 份基准轨迹负责。这一格要说清，不许读成"全仓 0 次"。）

## 结论与边界

- **不做**。在一个从未发生失败的面上加提示，属于"能写但没人用"的改动；它还要动 `read_file.ts`
  与 `edit_file.ts` 两支被 8 根变异针脚钉着的文件（`edit-file-hint-*` 四根、替换两支、delta 一根、`read-file-oversize-note-dropped` 一根），
  风险与收益不成比例。
- **读数能支持的最强结论到此为止**：基准任务集是小型靶子仓库（文件少、路径不容易记错），
  所以「0 次」**不能外推**到大仓库真实会话。真要判这件事，缺的是"用户工作区里的轨迹"这一面，不是这条改动。
- 反转条件：若后续在有真实用户工作区轨迹的面上看到这一句 ≥3 次，就按"导出复用、不搬家"的做法补上
  （`export nearNameSuggestions` ＋ `edit_file` 的缺失支引用它，两支判卷 `tests/read-shape.test.ts` 与 `tests/edit-file-hint.test.ts` 都要跑）。

## 同一次顺手抓到的工具面事实（不是缺陷，是给下一个人的地图）

钉这两支文件的变异针脚（现读 `scripts/mutate-verify.mjs`，逐条抄原文）：
`edit-file-single-branch-expands-pattern`／`edit-file-replace-all-branch-drifts`／`edit-file-hint-indent-branch-removed`／
`edit-file-hint-token-scan-blind`／`edit-file-hint-threshold-zero`／`edit-file-hint-long-line-unbounded`／`edit-file-delta-hardcoded-zero`／
`read-file-oversize-note-dropped` —— **没有一根钉在「文件不存在」那一行上**，
所以真要改那一行时，`--check-needles` 会一片安静：那是一格**没有锚点保护的出口**，改它得自带判卷。
