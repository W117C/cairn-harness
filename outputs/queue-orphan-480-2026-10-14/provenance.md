# 第 480 页取料：孤儿队列 sidecar 易主（新会话继承别人没发完的话）

出证时间 2026-10-14；工作树 `/Users/ze/Downloads/Cairn/deepseek harness`，分支 `zcode`。
本目录只放「缺陷复现」与「修复后复验」的原始读数，不放结论（结论在 PROGRESS.md 第 480 页）。

## 1. 复现（修复前，读数逐字）

脚本：`/tmp/inherit.mts`（一次性探针，不入库；路径见下）。走 `src/main/sessions.ts` 的
公开出口 `createSession` / `readSessionQueue`，不碰内部函数。

```
1) 新建 id: 会话 （同名字 ⇒ 复用同一 sidecar 路径）
2) 新会话读到遗留队列? [{"text":"遗留","attachments":[]}]
```

成因（同一脚本的第 1 行已给出）：`createSession` 的撞名加序号只看
`stat(<root>/<id>.jsonl)`——**只看 JSONL，不看 `.queue.json`**。JSONL 被外部删掉
（CLI / 手工清理 / 崩溃半写）而 sidecar 留在盘上时，同名字会算出同一个 id，
于是新会话的 `queueGet` 读到上一条会话没发完的消息。

后果不是"多显示几行"，是**把别人的话当成自己的话发出去**：渲染层恢复闭环里
`App.tsx` 的 `queueGet` 读回后由 `resumeQueue` 交给同一条 `runOn`，队列头即第一轮的用户消息。

## 2. 修复后复验（两条路径各一次）

### 2.1 core 出口（`src/main/sessions.ts`）

```
1) 复用同名 id: true
2) 新会话队列(应为空，修复前是『别人的待发消息』): []
```

### 2.2 桌面 kernel-host（`apps/desktop/src/main/kernel-host.ts`，真 IPC 入口那一层）

```
1) 写后读回: {"items":[{"text":"别人的待发消息","attachments":[]}]}
2) 删 JSONL 后目录: ["会话 2026-10-14 01:58:05.queue.json"]
3) 复用 id: false
4) 新会话队列(应为空): {"items":[]}
```

第 3 行 `false` 要照实读：这一趟 `createSession` 传的是旧 id 字面量，而旧会话文件已删、
`kernel-host` 侧把它另存成了带序号的新 id ⇒ **本次没有走到"同名复用"那条路**，
所以这一趟**不构成修复证据**，只证「正常新建不继承」。修复证据是 2.1 那一趟（复用 id=true）。
本行留着不删，是免得把 4 行的空队列读成第 3 行那条路的战果。

## 3. 回归（正常路径不受影响）

```
1) 正常读回: [{"text":"甲的队列","attachments":[]}]
2) 重命名跟随: [{"text":"甲的队列","attachments":[]}]
3) 删除清空: []
```

## 4. 红-绿与反向验证

- 红态（判卷先写、实现未改）：`tests/sessions.test.ts` 1 红 23 绿，
  失败行 `tests/sessions.test.ts:217`，期望 `[]`、实收 `[{text:"上一个会话没发完的"}]`。
- 绿态：`24 passed (24)`。
- 反向验证（磨掉修复 ⇒ 判卷必须红）：把 `src/main/sessions.ts` 里那行
  `await rm(queuePath(root, id), { force: true }).catch(() => undefined);`
  换成注释 ⇒ `1 failed | 23 passed`（实测）。证这条用例不是死测试。
- 变异锚点 `sessions-queue-orphan-inherited`（`scripts/mutate-verify.mjs`）：
  `--check-needles` 认到 1555 条、本条在列；**当前状态是「钉在飞文本 1 条」**
  ——锚点行已入库而被锚的实现改动还没入库，干净 HEAD 上它等价于空操作。
  入库后该格自动消失，不许靠改针脚去消它。

## 5. 本次未跑 / 不许读成绿

- `mutate-verify` **全表未跑**（1555 条 × 约 1s/条 ≈ 20+ 分钟）。
- 真模型 / 生产行为未跑（无凭据）。
- 「运行时排队」那条路（运行中入队 → 收束后自动派发）本页没有运行时读数：
  它依赖一个可插队的窗口，脚本化一轮 3 秒就收束了。
