#!/bin/bash
# 生成 grep-target 的**真回执**（2026-10-04 11:35起）。
#
# 为什么要有这个脚本：2026-10-04 02:37 那批读数（grep-target 3/3、A/B 两臂各 4/4、
# token 差 −1,546 / −6,953）**跑完了但没落盘**，全仓搜那五个数字命中全是无关日志的子串巧合。
# `scripts/gym-tool-choice.ts` 开头自陈「本脚本不写任何账本文件，读数只在终端/JSON」
# ⇒ 终端里划过的东西等于没跑过。这脚本把每次跑的 stdout 落成独立日志，让读数可回查。
#
# 协议（为什么是 4+2 而不是原来那个 3+4）：
#   · 4 轮 `--ab`：每轮内部先 full 再 pruned，**同进程、同模型、只换工具面** ⇒ token 差可归因。
#     4 轮 = full 臂 4 次 + pruned 臂 4 次。
#   · 再补 2 次单独 `--arm full`，把 full 臂的样本提到 **n=6**——
#     原报告的「方差极小」只有 n=3，而方差是要用样本估的，n=3 估出来的「极小」不可信。
#
# 串行 + 间隔：端点是免费档有速率限制，连着跑会 429。间隔 25s（实测单次跑 ~32s，
# 已在上一批记录里踩过 429，所以不赌）。
set -u
# 脚本在 outputs/<dir>/ 下 ⇒ 回仓根要退**两级**（→ outputs → 仓根）。
# 第一版写成 ../../.. 退了三级，落在 /Users/ze/Downloads/Cairn —— 那里没有 node_modules，
# 于是 node 立刻 ERR_MODULE_NOT_FOUND（没烧掉任何 token，但那一轮读数是假的）。
cd "$(dirname "$0")/../.." || exit 1
# 不静默跑偏目录：靶场脚本按 cwd 找 fixtures 与 src，退错一级会得到「跑成功但什么都不是」。
[ -d node_modules ] || { echo "✗ 不在仓根（node_modules 不存在）：$PWD"; exit 1; }

# 端点凭据在仓外、600 权限，仓库只从这三个环境变量读（src/providers/glm.ts:5,35）。
# ⚠️ 本行之后**不许**开 `set -x`：那会把 CAIRN_API_KEY 的值打进终端输出
#   （2026-10-04 第一版调试时踩过一次，已记进文档）。
set -a; . ~/.config/cairn/env; set +a

OUT="outputs/tool-choice-receipt-2026-10-04"
GAP=25
FAILED=0

# ── 事件流按轮次分目录（第二版）──────────────────────────────────────────
# 第一版把 `--events "$EV"` 指到同一个目录，而靶场脚本的落盘名是
# `<arm>-<caseId>.jsonl`（**不含轮次**）⇒ 每轮覆盖上一轮，8 次跑只活下来 2 支。
# **修法不在靶场脚本，在本驱动**：给每轮各自的目录 ⇒ 靶场脚本一行不改。
# （把那行改名塞进 `scripts/gym-tool-choice.ts` 会让改动面扩散到共用的读数脚本，
#   而问题出在「谁调用、调用几次」——那是本驱动的责任。）
mkdir -p "$OUT/events"

stamp() { date +%H:%M:%S; }

echo "=== 协议 v2：4 轮 A/B ＋ 2 次单独 full｜case=grep-target｜起点 $(stamp) ==="

for i in 1 2 3 4; do
  EV="$OUT/events/ab-round$i"; mkdir -p "$EV"
  echo "--- 第 $i 轮 A/B（full + pruned） $(stamp) ---"
  node --import tsx scripts/gym-tool-choice.ts \
      --case grep-target --ab --events "$EV" \
      > "$OUT/ab-round$i.log" 2>&1
  rc=$?
  # 429 是免费档的正常现象，不是判据失败：单独记一次、隔久一点重来，最多两次。
  attempt=0
  while [ $rc -ne 0 ] && grep -q "429\|rate limit" "$OUT/ab-round$i.log" && [ $attempt -lt 2 ]; do
    attempt=$((attempt+1))
    echo "    429，等 90s 后重试（第 $attempt 次） $(stamp)"
    sleep 90
    node --import tsx scripts/gym-tool-choice.ts \
        --case grep-target --ab --events "$EV" \
        > "$OUT/ab-round$i.log" 2>&1
    rc=$?
  done
  if [ $rc -ne 0 ]; then FAILED=$((FAILED+1)); echo "    ❌ 第 $i 轮失败（rc=$rc），日志在 ab-round$i.log"; else
    echo "    ✅ 第 $i 轮完成 $(stamp)"
  fi
  [ $i -lt 4 ] && sleep $GAP
done

for i in 5 6; do
  EV="$OUT/events/full-run$i"; mkdir -p "$EV"
  echo "--- 补跑 full 臂 #$i （把 full 样本提到 n=6） $(stamp) ---"
  node --import tsx scripts/gym-tool-choice.ts \
      --case grep-target --arm full --events "$EV" \
      > "$OUT/full-run$i.log" 2>&1
  rc=$?
  if [ $rc -ne 0 ]; then FAILED=$((FAILED+1)); echo "    ❌ #$i 失败（rc=$rc）"; else
    echo "    ✅ #$i 完成 $(stamp)"
  fi
  [ $i -lt 6 ] && sleep $GAP
done

echo "=== 全部结束 $(stamp)｜失败 $FAILED 次 ==="
exit $FAILED