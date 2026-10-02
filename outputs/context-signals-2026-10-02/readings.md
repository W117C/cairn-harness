# 第 301 页取证 · 能力 1 的接线尾巴：「问题→位置」两只正则收成唯一出处（镜像那一格结构上不存在了）

现读时间 2026-10-02 12:40–12:43（本机）。这一簇很小，但收的是**上一把尺的谎面**：尺自己抄生产端的正则 ⇒ 改了生产端而尺不知道，A 臂就撒谎（第 297 页的注释里写着这句话，靠注释守就不是判据）。

## 1. 改动之前的事实

| 面 | 出处 | 写法 |
| --- | --- | --- |
| 生产端 · 路径形状 | `src/agent/glm-session.ts` 的 `contextFilesFromEvents` | 就地写死 `/[\w./-]+\.[a-z]{1,5}/g` |
| 生产端 · 标识符形状 | 同文件的 `mentionedFromEvents` | `[A-Za-z_][A-Za-z0-9_]{3,}` |
| 尺（臂 A 的输入） | `scripts/probe-locate-recall.ts` | **逐字镜像**那两条，注释写「改了那两行而不改这里，A 臂就撒谎」 |

两只是 `createGlmSessionProvider` 内的局部闭包（都是 events 的纯函数）没导出 ⇒ 尺没法 import，只能抄。这就是页上说的「接线尾巴」。

## 2. 改动之后

- 新 `src/agent/context-signals.ts`：`PATHISH_SOURCE` / `MENTIONED_SOURCE` 两支源串 ＋ `makePathishRe()` / `makeMentionedRe()` 两个 builder（**给 builder 不给常量 RegExp**：`/g` 的 `lastIndex` 有状态，同一实例跨调用点复用会串位；哪天有人写 `exec` 循环就踩雷）。
- `glm-session.ts` 两处改为 `match(makePathishRe())` / `match(makeMentionedRe())`；
- `probe-locate-recall.ts` 改为从 `../src/agent/context-signals` 取同一支（模块级实例在本尺安全的前提＝两处都用 `.match()`，这条前提本身也有判卷钉着）。

## 3. 读数（改动前后必须同值，否则这次是"顺手改了语义"）

- `locate-recall-after-sharing.log`：候选 587、进图 587、渲染 61（1024 档）、tokens 904；
  **A 臂 6/16、B 臂 5/16（三档同值）**；`L-POS` 命中、负控 MISS、`自检 ✅ …可以引用`、`PROBE_EXIT=0`。
  与第 300 页那份（`outputs/map-import-edges-2026-10-02/locate-recall-after-import-edges.log`：A 6/16、B 5/16）逐值相同 ⇒ **抽取语义零漂移**，这一格不是靠"看起来一样"，而是由 `tests/context-signals.test.ts` 的对拍用例钉住（`notes.yamlxy` 只吃到第五个字母、`abc abcd _abc8 x1_y2` 三个字符不算）。

## 4. 判卷 / 造红 / 门

- `tests/context-signals.test.ts` **7 条**：语义对拍 2（长度档、扩展名档）＋全局位 1＋实例复位前提 1＋不返回同一对象 1＋接线两半各 1（provider 那半、尺那半，每半都配**反向**那一格：源串里再出现字面量就红）。
- 四台造红（`redmachines.log`，复原逐字节一致）：
  M1 provider 退回自带字面量 ⇒ 只红「provider 那半」；
  M2 尺退回镜像并把长度档挪一格 ⇒ 只红「尺那半」；
  M3 `PATHISH_SOURCE` 放宽到 `{1,6}` ⇒ 只红「扩展名最长 5 个字母」；
  M4 builder 掉 `g` ⇒ 红 3 条，其中独有的是「两只 builder 出的都是全局正则」
  （这条专门存在，因为「同一实例连用两次结果相同」在非全局时**照样绿**——两半得分开设，否则一条判卷盖住两种坏法）。
- 锚点表 1282 → **1286**（+4 ✓）；`改法语法全部合法`；阻断 8 条＝未入库面 6＋钉在飞文本 2（同笔未落库的预期读数）。
- 「每次新建实例」那条判卷**刻意不配锚点**：要模拟缓存复用得先往实现里插一个模块级变量，那是往判卷里搬实现，不是改一个既有写法。理由写在这里而不是留白。

## 5. 顺带清掉的两处过期文案

`probe-locate-recall.ts` 头部注释里那三行「镜像／接线尾巴／glm-session.ts:793」的行号引用一并换成符号名——
D-10 那把尺量的是台账里的 `file.ts:NN` 能不能在 HEAD 追到；源码注释里的行号同样会烂，只是这次是**被自己引用的代码搬家**弄烂的（本次改动让那两行的行号继续漂了一格）。
