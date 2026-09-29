# 零命中指针的分类（09-28 v3；前两版的错也记在这里）

取料树：..worktrees/p169-staging @ 8c9ce29；表长 946 条；异常 11 条。
与门那一格对齐：**一致**（门点出 11 条）。

v1 的错：候选取自「同文件里任意一条唯一标题」⇒ 把锚点配到**别的用例**上（守错格，规则 224）。
v2 的错：用「标题静态段按顺序都出现在指针里」认意图 ⇒ 11 条全被判成「认不出意图」，因为它们的指针根本不是标题文字。
v3 的判据：指针逐字落在哪条 `it()` 的**语句体内**，就认那条为意图；取不到逐字才归「标题是拼出来的」。

⇒ 分类：**A 指针写的是断言文字（可机械改指）0 条** ／ B 标题是拼出来的（要人裁决）9 条 ／ C 探针取不到 2 条 ／ D 多命中 0 条

## B_标题是拼出来的
- auto-verify-default-on｜文件：tests/loop.test.ts｜指针（逐字取不到，只有靠占位符展开才认得）：零行为回退：缺省不开闸（未给 autoVerify） → 无 verify_result、请求数与旧行为同形
- worker-impact-spec-not-appended｜文件：tests/worker-impact-query.test.ts｜指针（逐字取不到，只有靠占位符展开才认得）：read 档：开关开启时规格与实例同名同时出现，白名单同步
- worker-impact-whitelist-not-appended｜文件：tests/worker-impact-query.test.ts｜指针（逐字取不到，只有靠占位符展开才认得）：read 档：开关开启时规格与实例同名同时出现，白名单同步
- hook-matcher-exact-list-degrades-to-substring-regex｜文件：tests/hooks-input-contract.test.ts｜指针（逐字取不到，只有靠占位符展开才认得）：纯精确名不做子串：matcher "Edit" 不得命中 NotebookEdit
- read-worker-inherits-wide-hook-mode｜文件：tests/worker-hooks.test.ts｜指针（逐字取不到，只有靠占位符展开才认得）：forWorkerMode("read") 把引擎降成只读档：中等风险的钩子命令拒跑；"write" 沿用原档
- redaction-stops-recursing-into-containers｜文件：tests/stream-redaction.test.ts｜指针（逐字取不到，只有靠占位符展开才认得）：verify_result 的声明路径种得进密钥、也擦得掉
- worker-git-newline-not-a-separator｜文件：tests/shell-bypass-composition.test.ts｜指针（逐字取不到，只有靠占位符展开才认得）：换行是命令分隔符：`echo hi\ngit push --force` 不得因为整段首词是 echo 而漏判
- g-b-injection-face-ignores-table-form｜文件：tests/tool-surface-parity.test.ts｜指针（逐字取不到，只有靠占位符展开才认得）：扩形后的分母自证：table["name"] = 那一形确实被算进来了（解析器静默 0 命中比不扩更坏）
- loose-pointer-counts-literal｜文件：tests/mutate-verify-gates.test.ts｜指针（逐字取不到，只有靠占位符展开才认得）：水位：真表现读松钉只准调低（帽 10，09-27 现读 10）——新增一根要写明为什么

## C_探针取不到
- shape-leading-env-assignment-not-skipped｜指针在文件第 26 行，却不在任何 it() 体内：GIT_PAGER=cat git push --force
- pb-control-arm-always-wired｜指针在文件第 132 行，却不在任何 it() 体内：对照臂判据：门槛旋钮接得上

## 执行时配套的判据（缺一条就别自称改对了）
1. 只改 `expectFail` 字符串，不动实现、不动判卷标题；候选段必须取自**指针所属那条用例**的标题。
2. 改完跑 `--check-needles`：那一格「零命中 N 条」只准调低（水位，规则 235），并逐条单跑确认仍然**被杀死**（不是变成守别的用例）。
3. 改指之后 selector 模式下 `-t` 吃的是新串，所以候选段必须与那条标题**逐字一致的一段**（规则 234：指针脆在标题的字面形状上）。
4. 元锚点自己也在名单里（`loose-pointer-counts-literal`）⇒ 改它的指针要同笔跟着改它指到的引用（规则 235）。

