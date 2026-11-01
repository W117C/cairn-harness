#!/bin/sh
# 2026-11-01 复核：把 REPOSITORY-STATUS「需要优化」表里标着「现读」的数字重新量一遍。
set -e
cd "$(dirname "$0")/../.."
echo "## 大入口行数"
wc -l src/main/agent-runner.ts src/cli.ts apps/desktop/src/main/index.ts
echo
echo "## 证据占比（tracked）"
echo "tracked_all=$(git ls-files | wc -l | tr -d ' ')"
echo "tracked_outputs=$(git ls-files outputs | wc -l | tr -d ' ')"
echo
echo "## 主 chunk 体积（raw / gzip 字节）"
cd apps/desktop/dist
entry=$(grep -o 'assets/index-[A-Za-z0-9_.-]*\.js' index.html | head -1)
for f in "$entry" "assets/$(cd assets && ls App-*.js | head -1)" "assets/$(cd assets && ls xterm-*.js | head -1)"; do
  printf '%s raw=%s gzip=%s\n' "$f" "$(wc -c < "$f" | tr -d ' ')" "$(gzip -c "$f" | wc -c | tr -d ' ')"
done
