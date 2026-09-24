# 第 49 页 · 阴性说明指的那条逃生口，对 glob 自己排的排除根本不通

日期 2026-09-24。基线 HEAD `02f3efb`。
起因是一句看起来已经收口的政策文案：`grep` 与 `glob` 共用 `rgNegativeNote()`，
零命中时都告诉模型「把 path 显式指到那个目录/文件再搜一次（显式路径不受忽略规则挡）」。
我去核这句话在**两支**上是不是都成立——它只在其中一支成立。

## 一、结论

`ripgrep.ts` 里那句"实测"只测了 **rg 的忽略文件**那一类。本仓在 `glob` 里**自己加的** `--glob` 排除
**不让位于显式路径**：模型照说明做了，得到的是同一个"无匹配文件"。
⇒ 说明本身就是那条冤枉路的指路牌——而它存在的唯一理由是消掉冤枉路。

实测（真 `@vscode/ripgrep` 二进制，临时 git 仓库，`.gitignore` 含 `gen/`、`node_modules/`、`.env`）：

| 命令形状 | 目标 | 结果 | 含义 |
| --- | --- | --- | --- |
| `rg -e x .` | 被 `.gitignore` 挡的 `gen/` | 看不见 | 默认扫描面的真相 |
| `rg -e x gen` | 同上，显式路径 | **看得见** | 逃生口对 `.gitignore` 成立（grep 那支）|
| `rg --files --glob '!**/node_modules/**' .` | 噪声目录 | 看不见 | 默认面（设计如此）|
| `rg --files --glob '!**/node_modules/**' node_modules` | **显式指进去** | **空、退出码 0** | 逃生口对自建 `--glob` 排除**不成立** |
| 同上，`dist` | 显式指进去 | 空 | 同一条 |

退出码 0 + 空 ⇒ 工具回 `ok:true` + 同一句假说明。模型分不清"这里真没有"和"这条路被我自己堵着"，
于是它要么认定文件不存在（改完一处不去改调用方 = 返工），要么再花一轮换查法。

顺手量了模型的另一条自然改道：**把 pattern 写宽**（`pattern: "node_modules/**"`）。也不通，而这次是**设计如此**：
排除串排在用户 pattern 之后（`glob.ts` 里那句"后写优先"的老注释），实测
`--glob 'node_modules/**' --glob '!**/node_modules/**' .` ⇒ 空；把两条对调 ⇒ 同一命令立刻出文件。
⇒ 这条**不改**（默认扫描面不该被 node_modules 灌满，`MAX_FILES` 也救不了它——100 个名额全给噪声），
但要说出来：修完之后，**显式 path 是唯一一条活路**，而它恰好就是那句政策让模型走的那条。

## 二、修法（改行为，不改文案）

`src/tools/glob.ts`：`NOISE_DIRS` 由三条 glob 串改成三个**目录名**，被点名时撤掉那一条排除。

```ts
const pointed = relative(resolve(ctx.workspace), resolve(abs)).split(sep).join("/");
const noise = NOISE_DIRS.filter((d) => pointed !== d && !pointed.startsWith(d + "/"));
```

为什么改行为而不是改句子：改句子只能把"这条路不通"讲清楚，模型还是得自己找别的路；
而 `grep` 那支**本来就能**搜进 `node_modules`（它没有自建排除）⇒ 这是同族两支的行为不对称，
修齐它同时让原有那句政策变真。**针脚 `glob-negative-note-loses-escape-hatch` 一字未动**
（它变异的是 `rgNegativeNote(...)` 那个调用文本），所以热表没被我碰。

排除只在"点名进那个目录"时撤：`path: "src"` 里若藏着 `src/node_modules/`，照旧不出现（反向用例钉住）。

## 三、两侧用例与读数

`tests/grep-glob-edit.test.ts`（`rgNegativeNote` 的判卷面所在文件）新增两条：

1. `逃生口对 glob **自己排的**噪声目录也成立：显式 path 指进 node_modules 必须列得出文件`
   —— **RED 见过**，原文：`expected '无匹配文件\n这不是「仓库里没有」——本次扫描跳过了 .gitignore…' to contain 'node_modules/pkg/index.js'`。
   这条失败读数本身就是缺陷现场：工具先说"没有"，再教模型做它刚刚做过的事。
2. `反向：显式 path 在别处时，噪声排除一字不减（撤排除只服务于「点名要进那个目录」）` —— 钉收窄的那一半。

第一版实现把排除串重建成 `!node_modules/**`（锚定式，匹配不到 `./node_modules/…`），
**三条一起红**：包括一条我没动的既有判卷 `列文件相对路径；噪音目录（.git/node_modules/dist）不出现`。
⇒ 改完必须跑**整个判卷文件**而不是只跑新用例，否则"新用例绿了"会盖掉"默认面漏了"。

本次跑过的：`tests/grep-glob-edit.test.ts` + `tests/grep-context.test.ts` 23/23；
整张 `test` 门 210 文件 / 2267 条全过（退出码 0）；
`pnpm run tools-check` 退出码 0（grep/glob/read_file/lsp 各三项全绿）；`typecheck` 0 错；
`pnpm run docs-check` 退出码 0（另有 4 项未检：`STATE.md` 与 `docs/ui-fact-baseline.md` 被并发会话从盘上删掉，
属"未证 ≠ 通过"，不是本次改动造成的）；
`mutate-verify --check-needles` 阻断数与改动前同（5）、无一条点名 `src/tools/glob.ts`。

## 四、顺带抓到的两件事

1. **注释里写 `**/` 会关掉块注释**。我给 `ripgrep.ts` 的 docstring 补这句实测时写了
   `` `--glob '!**/node_modules/**'` ``，其中 `*/` **提前结束块注释**，后面整段变成代码，
   真实报错是 `ReferenceError: node_modules is not defined`。
   tsc 之所以没抓到，是因为它跑在**这次编辑之前**（老规矩：改完必须重跑）。
   ⇒ 块注释里不许出现 glob 的 `**/` 形状；要写就用文字描述目录名。
2. **文档级政策句的"实测"要带形状**。`rgNegativeNote` 的注释写的是「显式路径不受忽略规则挡」，
   没有说清这条**只**对 `.gitignore` 成立；两工具共用一句 ⇒ 一支真、一支假。
   已把限定条件写回该注释（含这条实测的日期与命令形状）。

## 五、留给下轮的两条

- **锚点未注册**：`撤排除` 这段逻辑目前没有变异针脚（只有 vitest 判卷）。
  `scripts/mutate-verify.mjs` 正被另一会话占用（`M`），按规矩不写热表；
  表干净后补一条「`filter` 拿掉 ⇒ 第 1 条用例红」的锚点（见任务 #3 的同一流程）。
- **同族待查**：`glob` 与 `grep` 的超时/输出帽常量在两支各写一份字面量
  （`60_000` / `32MB`，`glob.ts` 注释自称「与 `runRgJson` 同口径」，但 `RG_TIMEOUT_MS`/`RG_OUTPUT_CAP_BYTES` 未导出）
  ——这是「与 X 对齐」是注释不是实现的那一族。本轮**未动**：今天两侧数值相同，拿不出会红的用例，
  按第 42 页那条规矩不当作缺陷施工，只登记。
