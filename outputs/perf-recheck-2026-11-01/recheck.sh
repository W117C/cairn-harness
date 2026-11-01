#!/bin/sh
# 2026-11-01 复核（第 957 页）：400 轮长会话的真 Electron 读数，N 跑汇总成区间 + 中位。
# 用法：sh outputs/perf-recheck-2026-11-01/recheck.sh [次数=5]
# 为什么默认 5 跑：本机单跑启动离散度 1.66×（第 956 页），少于 5 跑不足以谈趋势。
set -e
cd "$(dirname "$0")/../.."
n=${1:-5}
if [ "$n" -lt 2 ]; then echo "至少 2 跑（单跑不足以谈趋势）"; exit 2; fi
pnpm --filter cairn-desktop build >/dev/null
dir=$(mktemp -d /tmp/cairn-perf-XXXXXX)
i=1
files=""
while [ "$i" -le "$n" ]; do
  out="$dir/run$i.json"
  env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron \
    scripts/performance-smoke.cjs "$out" 400 40 >/dev/null
  files="$files $out"
  i=$((i+1))
done
node --import tsx scripts/perf-summarize.ts $files
echo "原始报告：$dir"
