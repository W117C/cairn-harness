#!/bin/bash
# 一档实验（2026-10-04 12:30）：**不造新 case**，把 `ga-strategy` 的 solo 臂
# 从 1 个任务扩到剩下 3 支**冻结** case。
#
# 要证的那一句话只有一句：**「不派子代理，这个任务能不能做成」**。
# 刻意**不**跑二档（配对默认臂 ≈ 50 万 token）：一档当闸用，全绿就收，
# 有红才值得花钱去分辨「是 solo 不行，还是这题本身难」。
#
# 三条纪律，写在这里是因为它们各自都对应本仓点过名的失败形状：
#  ① **口径**：ga-strategy.ts 第 10 行自陈「系统提示是本脚本自带的短串，不是 app 的 BASE_SYSTEM」
#     ⇒ 本档量的是「显式下达策略指令后，派活是否划算」，**不是**「摘工具面会不会掉质量」。
#     `solo` 与 `omitTools` **不是同一个变量**（策略 vs 可见性），两批读数不许互相代替着引用。
#  ② **冻结**：`todo-completed-count`／`sum-clamp`／`config-default` 三支都在
#     `fixtures/gym/cases/**` 与 `fixtures/gym/index.json` 里，一个字都不改。
#     本脚本只换 `--case` 参数，不碰判据、不碰 fixtures。
#  ③ **不合并**：`order-pricing-triple-fix` 的三臂读数来自 2026-09-20 那一跑（端点与当时不同），
#     本档三支是今天跑的 ⇒ **四支不合并成一个"n=12"**。四支各自单列。
#
# 每跑一个独立 `--out` 目录：`ga-strategy.ts` 的 readings.json 是整份覆盖写的，
# 循环里复用同一个 `--out` 就只有最后一次活下来（与 `--events` 那次同款坑）。
set -u
cd "$(dirname "$0")/../.." || exit 1
[ -d node_modules ] || { echo "✗ 不在仓根：$PWD"; exit 1; }

# ⚠️ 本行之后**不许**开 `set -x`：会把 CAIRN_API_KEY 的值打进终端输出。
set -a; . ~/.config/cairn/env; set +a
export M0A_PROVIDER=glm

OUT="outputs/ga-solo-t1-2026-10-04"
mkdir -p "$OUT"
CASES="todo-completed-count sum-clamp config-default"
GAP=25
FAILED=0

stamp() { date +%H:%M:%S; }
echo "=== 一档：solo 臂 × 3 支冻结 case × 3 rep｜起点 $(stamp) ==="

for caseId in $CASES; do
  for rep in 1 2 3; do
    runOut="$OUT/$caseId-rep$rep"
    echo "--- $caseId rep$rep $(stamp) ---"
    rm -rf "$runOut"
    node --import tsx scripts/ga-strategy.ts \
        --case "$caseId" --arms solo --out "$runOut" \
        > "$OUT/$caseId-rep$rep.log" 2>&1
    rc=$?
    attempt=0
    while [ $rc -ne 0 ] && grep -q "429\|rate limit" "$OUT/$caseId-rep$rep.log" && [ $attempt -lt 2 ]; do
      attempt=$((attempt+1))
      echo "    429，等 90s 后重试（第 $attempt 次） $(stamp)"
      sleep 90
      node --import tsx scripts/ga-strategy.ts \
          --case "$caseId" --arms solo --out "$runOut" \
          > "$OUT/$caseId-rep$rep.log" 2>&1
      rc=$?
    done
    if [ $rc -ne 0 ]; then
      FAILED=$((FAILED+1))
      echo "    ❌ 失败（rc=$rc），日志 $OUT/$caseId-rep$rep.log"
    else
      s=$(python3 -c "
import json
try:
    a=json.load(open('$runOut/readings.json'))['arms'][0]
    t=a['tokens']
    tot=sum(t.get(k,0) for k in ('mainIn','mainOut','workerIn','workerOut'))
    print('score=%s verify=%s tokens=%d reqs=%s tools=%s spawns=%s 写而不验=%s' % (
        a['score'], a.get('verifyOk'), tot, a.get('requests'), a.get('toolCalls'),
        a.get('spawns'), a.get('writeSessionsWithoutVerifyPass')))
except Exception as e: print('读不出：%s' % e)
" 2>&1)
      echo "    ✅ $s"
    fi
    sleep $GAP
  done
done

echo "=== 全部结束 $(stamp)｜失败 $FAILED 次 ==="
exit $FAILED