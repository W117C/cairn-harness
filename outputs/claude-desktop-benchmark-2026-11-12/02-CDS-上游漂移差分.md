# CDS 上游漂移差分：3.6556.2 → 5.1231.2

> 取证日：2026-11-12。结论一句话：**本仓 vendored 的 CDS 令牌薄与组件薄都停在 3.6556.2，
> 本机上游已是 5.1231.2，两边已经对不上了**——而且上游这次**删掉了一整族 git-diff 状态色**。
> 全部命令可复跑，日志在 `logs/`。

## 一、权威判定（仓库自带脚本）

```bash
python3 apps/desktop/scripts/extract-cds-tokens.py --check
```

日志：`logs/cds-parity-check.log`。输出要点：

| 项 | 记录值（= 仓库 vendored 记录的 3.6556.2） | 本机现读（5.1231.2） | 一致 |
|---|---|---|---|
| tokens 成员 | `.vite/build/index.chunk-CbnfBP-3.js` | `.vite/build/index.chunk-SLtcb4nU.js` | ✗ |
| tokens 字节 | 41,505 | 38,918 | ✗ |
| tokens sha256 | `8386ae2ddb7a712a01ac2d2d404f9e4a5526d3f2aa1b04702363e033a5c01280` | `1a40aa7a3c11998feefc34184de5075f1e5eeedeeaabe9ec894a577fca91184e` | ✗ |
| 渲染层 CSS 成员 | `MainWindowPage-BjVtjJFx.css`（237,153 B） | `MainWindowPage-CinbABxl.css`（246,160 B） | ✗ |
| 渲染层 CSS sha256 | `948bac16bdceb510a49a832778b3c0bb7de6bc1fac86ebc10672a0c3cbd97960` | `1be41faf06028ae594f077095575181d3d34008183e1492caedd27a28d9e9fbf` | ✗ |

脚本自己的 `verdict` 字段：**`FAIL`**。

> 注：`apps/desktop/tests/cds-parity.test.ts` 此刻**仍绿**——它钉的是「vendored 文件自身与 UPSTREAM.json 记录一致」，
> 不是「vendored 文件与本机上游一致」。⇒ **漂移不会被现有判卷发现**，这是本轮最要紧的一句。

## 二、令牌级差分（`logs/cds-token-diff.log`）

按无前缀令牌名逐条比（vanilla 薄用的是 `--radius` / `--gray-450` / `--fill-accent` 这类**不带 `cds` 前缀**的名字；
前缀是编译期由适配层加的，比前缀会错位）：

| 量 | vendored（3.6556.2） | 上游（5.1231.2） | 差 |
|---|---|---|---|
| 字节 | 41,505 | 38,918 | **−2,587** |
| 声明数 | 1,021 | 957 | **−64** |
| 不同名 | 704 | 674 | **−30** |

- **新增：0 个。**
- **删除：30 个，全部是 git-diff 状态色族**：
  `--fill-git-{added,closed,conflicting,draft,merged,modified,opened,queued,removed}` 及其 `-hover` 变体、
  `--on-git-*`（9 个）、`--text-git-{opened,queued}`、`--bg-git-{opened,queued}`、`--border-git-{opened,queued}`。
- **同名字段值变：1 个**——`--opacity-icon-secondary`：`0.4` → `0.3`。

## 三、漂移对本仓的实际影响（现读代码）

1. **被删的 30 个令牌在本仓无人消费。**
   `grep -rn "git-opened|git-queued|git-merged|git-conflicting|git-draft|opacity-icon-secondary" apps/desktop/src/`
   命中 **54** 处，**全部落在 `apps/desktop/src/renderer/vendor/cds-official/tokens.css` 自身**（含 `--opacity-icon-secondary`
   的定义行），自有组件与适配层一处都没有。
   ⇒ 它们是 vendored 薄里的**死重**，重抽取时会被自然带走，不需要本仓先做适配。

2. **`--opacity-icon-secondary` 改值当前不影响本仓**：定义在 vendored 薄里，但没有任何消费方引用它
   （同一次 grep 的结论）。若将来按上游取 0.3，本仓视觉不会跳变。

3. **渲染层 CSS 涨了 9,007 B，动的不是本仓已 vendored 的组件面。**
   `components.css` 是从旧的 `MainWindowPage-BjVtjJFx.css` 里按 `[data-cds=…]` 选择器抽出来的
   （UPSTREAM.json 记：115 条规则 / 465 条声明 / 45 个组件）。新 CSS 里多出的 56 个 `@keyframes` 中，
   绝大多数属于**本仓从未 vendored 的组件族**（working-dot、scroll-fade、sticky-edge、skeleton），
   ⇒ 现有 `components.css` 的 45 个组件面**大概率不受影响**，但这是推断，需要重抽取时实测确认（见下）。

4. **ADR 0009 记的动效结论有一处需要修正**：
   0009 记的是 `cds-pill-pop`（一次「上冲 1.32 再落回」）；
   5.1231.2 的编译产物里是 **`cds-pill-pop-up` + `cds-pill-pop-down` 两条分开的关键帧**
   （上冲与下落各一条），另有 `cds-pill-dip-up` / `cds-pill-dip-down`、`cds-pill-roll-in-up` / `cds-pill-roll-in-down` /
   `cds-pill-roll-out`、`cds-pill-in` / `cds-pill-out`。
   ⇒ **弹跳动画在上游被拆成了「上冲」「下落」两段**，本仓照抄的「一条动画里上冲 40% + 回落 60%」是旧版形状。
   这一条是**读编译产物得到的形状差异**，具体时长/缓动值要从新 CSS 里逐条量（本次未逐条量，见第七节未知项）。

## 四、重抽取要动的东西（尚未执行）

`apps/desktop/src/renderer/vendor/cds-official/` 下的四件产物全部会变：
`tokens.css`（字节、声明数、名数）、`components.css`（规则集）、`components.json`（逐组件计数与源摘要）、
`component-map.json`（45 个组件的 ported / no-cairn-counterpart 逐条账）、以及 `UPSTREAM.json`
（`shortVersion`、`asarSha256`、`member`、两份 sha256、`tokenDeclarationCount`、`uniqueTokenNames`、证据成员名与摘要）。

命令是现成的：

```bash
python3 apps/desktop/scripts/extract-cds-tokens.py --write apps/desktop/src/renderer/vendor/cds-official
node apps/desktop/scripts/extract-cds-components.mjs <新的 MainWindowPage-*.css> apps/desktop/src/renderer/vendor/cds-official
```

`component-map.json` **不能由脚本生成**——它是逐条人工判断的账（ported / no-cairn-counterpart / no-component-css），
上游组件集变了就得逐条重判。

## 五、本轮明确不做（业主 2026-11-12 选「只出对标报告，不动代码」）

- 不执行 `--write`：vendor 目录字节与 `UPSTREAM.json` 本轮保持原样。
- 不改 `cds-parity.test.ts`：现有判据钉的是「vendored 自身与记录一致」，本轮不动它；
  但**「上游漂移不被判卷发现」这件事要留在账上**（见 `docs/adr/0010-claude-desktop-5x-benchmark.md` 的待办）。
- 不动 `apps/desktop/src/renderer/tokens.css` 的语义层（本仓自有令牌，与 CDS 薄是两回事）。

## 六、复现命令汇总

```bash
# 权威判定
python3 apps/desktop/scripts/extract-cds-tokens.py --check
# 抽当前上游到临时目录（只读本机 app.asar）
python3 apps/desktop/scripts/extract-cds-tokens.py --write /tmp/cds_current
# 令牌名级差分（本轮脚本在 /tmp/cds_diff2.py；产物见 logs/cds-token-diff.log）
```

## 七、未知项（如实记）

- **逐条量新 CSS 的 `@keyframes` 具体时长/缓动值**本轮未做（只量了关键帧名单、时长令牌与 `cubic-bezier` 取值集合），
  因此 ADR 0009 的「上冲 1.32 / 40% 时长 / overshoot」在新版是否仍同值**未证**。
- 新 CSS 里 `components.css` 那 45 个组件的规则是否**逐条不变**，未实测（判据是推断，见第三节第 3 条）。
- 上游 3.6556.2 → 5.1231.2 之间**经历了哪些版本**本轮没查（只知两端）。
- `--opacity-icon-secondary` 是**编译产物里的值**，vanilla 薄里该名的定义本轮未单独定位。
