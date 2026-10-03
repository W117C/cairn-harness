<!-- 取料面：干净 detached 树 `.worktrees/verify-head-742545`，`git rev-parse --short HEAD` 现读＝74254586，
     该树里 `src/permissions/*` 全部等于 HEAD（本笔只往这棵树复制过本探针一份，跑完删除）。
     命令：node --import tsx outputs/s4-permission-floor-2026-10-04/shapes.ts ｜ PROBE_EXIT=0（直接取，不接管道）
     结论行原文见下： -->
取料根＝/Users/ze/Downloads/Cairn/deepseek harness/.worktrees/verify-head-742545
deny「git push」＋allow「git push --force」，命令 git push --force origin main
  命令＝git push --force origin main
  ⇒ verdict=allow ruleId=allow:run_shell:git push --force#1
同上，两条顺序对调（结果与顺序无关）
  命令＝git push --force origin main
  ⇒ verdict=allow ruleId=allow:run_shell:git push --force#0
deny「rm -rf」＋allow 与命令逐词相等
  命令＝rm -rf /tmp/x
  ⇒ verdict=allow ruleId=allow:run_shell:rm -rf /tmp/x#1
等长（deny 与 allow 同字面）⇒ 行为优先序在这里是生效的
  命令＝rm -rf /tmp/x
  ⇒ verdict=deny ruleId=deny:run_shell:rm -rf /tmp/x#0
链式：allow 段在前、deny 段在后 ⇒ 全链 deny（短路是好的）
  命令＝echo hi && rm -rf /tmp/x
  ⇒ verdict=deny ruleId=deny:run_shell:rm -rf#0
**反例（不是缺陷）**：allow 比命令短一整个词元之外的形状 ⇒ 不命中，读成 miss
  命令＝rm -rf /tmp/x
  ⇒ verdict=miss ruleId=-
