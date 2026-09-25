# 第 81 页 · 第 80 页那把尺漏了一种假绿：`vi.mock` 的边不算执行——三种「没跑过」从此分开点名

第 80 页的判据写的是"有值边从测试通向它"。这句话有一个我自己踩过的洞：
**`vi.mock("../src/x")` 之后，那条 import 边还在，而 x 的真实实现一行都不执行**
（本仓记忆里 `vi.mock` 那一族已经咬过多次——规则 127 讲的是桩只补一个导出把一片测试打崩，这次是反向：桩把"跑过"这件事偷走了）。

## 一、三种「没执行」必须分开，因为修法完全不同

| 成因 | 判据里的集合 | 修法 |
| --- | --- | --- |
| 根本没人引 | `src ∖ naiveLive ∖ all` | 补测试，或同批摘掉实现（第 79 页 A 类） |
| 只有类型边连着测试（`import type`） | `all ∖ naiveLive` | 同上——但读的人最容易把它当"已覆盖" |
| **引它的测试全把它 mock 掉了** | `naiveLive ∖ live` | 让某个测试真跑它，或换成局部桩；不能靠这条 mock 边充数 |

尺现在逐测试求可达（跳过被 mock 的模块**及其整棵下游**——被换掉的模块自己 import 的东西在那个测试里同样不跑），
再对所有测试取并集；`naiveLive`（不扣 mock 的旧口径）留在结构里，**专门用来量这把改动自己改变了多少**。

## 二、现态读数：5 条 `vi.mock(src)`，一条都没掩盖掉模块

```
生产面 150 个 .ts｜测试入口 222 个｜vi.mock(src) 边 5 条
真被执行 149 个 ⇒ 没有执行路径 1 个＝根本没人引 0 + 只有类型边 1 + 被 mock 掩盖 0
（那 1 个仍是 src/main/ipc-protocol.ts，纯契约面，例外表里带着"运行时导出为 0"的证明）
```

⇒ 第 80 页那条判据**今天没有假绿**；这一页不是补漏洞，是把"以后别想靠 mock 边充数"钉住。
（对照：如果只报"缺口 1 个"而不报三个成因，读者就看不出这把尺扣没扣 mock——口径要能自己交代。）

## 三、当场造红：新那一半在真树上跑，不在 fixture 里自证

```
① 建 src/zz-tmp-mocked.ts + tests/zz-tmp-mock.test.ts（vi.mock 它并 import 它）
   → 2 条红：缺口清单 ['src/main/ipc-protocol.ts', +'src/zz-tmp-mocked.ts']
             被 mock 掩盖 ['src/zz-tmp-mocked.ts'] to equal []
   其余 4 条不误伤（Tests 2 failed | 4 passed (6)）
② 只删掉那行 vi.mock，让测试真跑它 → 6/6 复绿
③ 尺的自检（--self-test）加了同一格：7 条分类 + 1 条 mockedTargets 解析，全对
清理：两个临时文件删除，`git status` 无 zz- 残留
```

第 ① 步同时证明"mock 那条红"不是恒真：它只在那格存在时才响。
第 ③ 步的 `mockedTargets` 半边是必要的——只验分类的话，「解析不到任何 mock」也会给出同样的 gap 答案（规则 172 的 no-op 读数形状）。

## 留尾

- `live` 现在比 `naiveLive` 严格，代价是 `analyze` 从"一次闭包"变成"每测试一次 BFS"（150 节点、222 根，实测 <100ms，仍在秒级）。
- 这一族还剩的第三种假绿：**测试跑到了但断言没碰到**（可达 ≠ 断言）。要量它得要有语句级覆盖率，
  而本仓没装覆盖率底料（`node_modules/@vitest` 整个目录不存在，`c8`/`istanbul-lib-coverage` 也没有——三处都查过），
  ⇒ **不擅自装依赖**，先把这条记成"量不了，缺覆盖率底料"（口径同评估面那句"量不了要写成缺快照/缺凭据"，而不是报 0）。

## 验证口径（本轮实跑）

| 面 | 命令 | 读数 |
| --- | --- | --- |
| 尺自检 | `…/01-reach.mts --self-test` | 7 分类 + mock 解析全对 ✅ |
| 全仓读数 | `…/01-reach.mts` | 150 src／5 条 mock 边／缺口 1（三个成因：0+1+0） |
| 判卷面 | `vitest run … tests/src-execution-path.test.ts` | 6 passed（第 80 页是 5） |
| 全量 | `vitest run --config tests/vitest.config.ts` | **222 files / 2412 tests passed，exit 0** |
| 类型/文档 | `scripts/typecheck.ts`、`scripts/docs-check.ts` | 真退出码 0 / 全绿 `UNVERIFIED=3` |
