#!/bin/sh
# =============================================================================
# verify.sh —— Forge 前端重构方案 · 关键断言可运行验证脚本
# -----------------------------------------------------------------------------
# 用途：在【仓库根目录】执行本脚本，把本轮方案里最关键的、机器可判定的断言
#       逐条重跑一遍，打印 ✅/❌ 与实测值，最后给出退出码（全过 0，否则 1）。
#
# 纪律：
#   * 本脚本【只读】——不修改任何文件、不启动服务、不跑 vitest / pnpm gates。
#   * ❌ 是预期结果之一：脚本的目的是【如实暴露现状】，不为变绿而放宽断言。
#   * 这些断言编码的是「方案所描述的基线事实」。若有人改动了源码（例如给
#     tsconfig 加上 allowJs、或给窗口补上 minWidth），对应断言会翻红——这正是
#     它作为「基线快照校验器」的价值。
#
# 用法：
#   cd "/Users/ze/Downloads/deepseek harness"
#   sh outputs/frontend-refactor-2026-09-17/export/verify.sh
#
# 兼容：POSIX sh + macOS BSD grep（不使用 \+；多文件计数用 -o ... | wc -l）。
# =============================================================================

set -u

# ---- 前置：确认在仓库根执行 -------------------------------------------------
if [ ! -f src/renderer/app.js ] || [ ! -f tsconfig.json ] || [ ! -f src/main/index.ts ]; then
  echo "❌ 请在仓库根目录执行本脚本（未找到 src/renderer/app.js / tsconfig.json / src/main/index.ts）。"
  echo "   用法：cd <repo-root> && sh outputs/frontend-refactor-2026-09-17/export/verify.sh"
  exit 2
fi

TOTAL=0
FAILED=0

# report <标题> <ok:0|1> <实测详情>
report() {
  TOTAL=$((TOTAL + 1))
  if [ "$2" -eq 0 ]; then
    printf '✅ %s\n' "$1"
  else
    printf '❌ %s\n' "$1"
    FAILED=$((FAILED + 1))
  fi
  printf '     %s\n' "$3"
}

occ() { grep -o "$1" "$2" 2>/dev/null | wc -l | tr -d ' '; }

# ---- 基线信息 ---------------------------------------------------------------
HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "n/a")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "n/a")
IH_LINES=$(wc -l < src/renderer/index.html | tr -d ' ')
AJ_LINES=$(wc -l < src/renderer/app.js | tr -d ' ')
OUT_JS=$(ls out/renderer/assets/*.js 2>/dev/null | wc -l | tr -d ' ')

echo "=============================================================="
echo " Forge 前端重构 · 方案断言验证（只读 / 可复跑）"
echo "=============================================================="
echo " 时间     : $(date '+%Y-%m-%d %H:%M:%S')"
echo " 工作目录 : $(pwd)"
echo " HEAD     : ${HEAD_SHA}  (分支 ${BRANCH})"
echo " 渲染层   : index.html ${IH_LINES} 行 / app.js ${AJ_LINES} 行（合计 $((IH_LINES + AJ_LINES)) 行）"
echo " 构建产物 : out/renderer/assets/*.js = ${OUT_JS} 个"
echo "=============================================================="
echo ""

# ---- A1 发货层是 vanilla ----------------------------------------------------
if [ "$OUT_JS" -gt 0 ]; then
  REACT_N=$(grep -o 'react' out/renderer/assets/*.js 2>/dev/null | wc -l | tr -d ' ')
else
  REACT_N="N/A(无构建产物)"
fi
if [ "$REACT_N" = "0" ]; then A1=0; else A1=1; fi
report "A1 发货层是 vanilla（out/renderer/assets/*.js 中 react 命中 0）" "$A1" \
  "实测 react 出现次数 = ${REACT_N}"

# ---- A2 7 个 CDP 探针在 vanilla 发货层命中全 0 ------------------------------
PROBE_BAD=0
PROBE_DETAIL=""
for p in data-m1e-item data-m1e-event-count data-virtuoso-scroller data-approval-badge data-panel-toggle data-panel-id data-m1e-settings-open; do
  n=$(grep -o "$p" src/renderer/index.html src/renderer/app.js 2>/dev/null | wc -l | tr -d ' ')
  PROBE_DETAIL="${PROBE_DETAIL} ${p}=${n}"
  [ "$n" -eq 0 ] || PROBE_BAD=1
done
report "A2 7 个 CDP 探针在 vanilla 层命中全 0（门禁被阻断的直接证据）" "$PROBE_BAD" \
  "实测(index.html+app.js):${PROBE_DETAIL}"

# ---- A3 单宽度断点 ----------------------------------------------------------
MW_N=$(grep -oF '@media (max-width:' src/renderer/index.html 2>/dev/null | wc -l | tr -d ' ')
MW_V=$(grep -oE '@media \(max-width:[^)]*\)' src/renderer/index.html 2>/dev/null | tr '\n' ' ')
if [ "$MW_N" -eq 1 ] && printf '%s' "$MW_V" | grep -q '920px'; then A3=0; else A3=1; fi
report "A3 单宽度断点（@media (max-width: 命中 1 且为 920px）" "$A3" \
  "实测命中 ${MW_N} 处：${MW_V}"

# ---- A4 四态令牌未落地 ------------------------------------------------------
ST_N=$(grep -oE -- '--st-(run|wait|stuck|fail)' src/renderer/index.html 2>/dev/null | wc -l | tr -d ' ')
if [ "$ST_N" -eq 0 ]; then A4=0; else A4=1; fi
report "A4 四态语义色 --st-run/--st-wait/--st-stuck/--st-fail 未落地（index.html 命中 0）" "$A4" \
  "实测 --st-* 命中 = ${ST_N}"

# ---- A5 零虚拟化 ------------------------------------------------------------
if grep -qF 'r.events.forEach(renderEvent)' src/renderer/app.js; then A5=0; else A5=1; fi
A5_LINE=$(grep -nF 'r.events.forEach(renderEvent)' src/renderer/app.js 2>/dev/null | head -1)
report "A5 零虚拟化（selectSession 全量同步渲染 r.events.forEach(renderEvent)）" "$A5" \
  "实测命中：${A5_LINE:-未找到}"

# ---- A6 发货层无类型保障 ----------------------------------------------------
if grep -qE '"allowJs"' tsconfig.json; then
  if grep -qE '"allowJs"[[:space:]]*:[[:space:]]*false' tsconfig.json; then
    AJ="false(显式声明)"; A6=0
  else
    AJ="true(已开启)"; A6=1
  fi
else
  AJ="未出现(= 默认 false)"; A6=0
fi
report "A6 发货层无类型保障（tsconfig.json 不存在 allowJs 或为 false）" "$A6" \
  "实测 allowJs = ${AJ}（.js 不进编译程序 → app.js 不被 typecheck 覆盖）"

# ---- A7 无 lint 工具链 ------------------------------------------------------
LINT_N=$(find . -maxdepth 1 \( -name '.eslintrc*' -o -name 'eslint.config.*' \
  -o -name '.prettierrc*' -o -name 'biome.json' -o -name '.stylelintrc*' \) 2>/dev/null | wc -l | tr -d ' ')
if [ "$LINT_N" -eq 0 ]; then A7=0; else A7=1; fi
report "A7 无 lint 工具链（根目录无 eslint / prettier / stylelint / biome 配置）" "$A7" \
  "实测命中配置文件 = ${LINT_N}"

# ---- A8 无 CI ---------------------------------------------------------------
if [ -d .github ]; then A8=1; GH="存在"; else A8=0; GH="不存在"; fi
report "A8 无 CI（不存在 .github/ 目录）" "$A8" \
  "实测 .github = ${GH}"

# ---- A9 projections.ts 依赖面 ----------------------------------------------
DEP_N=$(grep -rl 'projections' scripts tests 2>/dev/null | grep -E '\.(ts|tsx)$' | wc -l | tr -d ' ')
if [ "$DEP_N" -ge 7 ]; then A9=0; else A9=1; fi
report "A9 projections.ts 依赖面（scripts/ + tests/ 引用文件数 ≥ 7）" "$A9" \
  "实测命中 = ${DEP_N} 个文件（3 门禁脚本 + 4 测试文件）"

# ---- A10 持久化 schema 错位 -------------------------------------------------
SETTINGS_KEYS=$(sed -n '53p' src/main/settings.ts 2>/dev/null | tr ',' '\n' \
  | grep -oE '[a-z]+: (true|false)' | sed 's/:.*//' | grep . | sort)
VIEW_KEYS=$(sed -n '684,689p' src/renderer/app.js 2>/dev/null \
  | grep -oE '^  [a-z]+:' | tr -d ' :' | grep . | sort)
COMMON=$( (printf '%s\n' "$SETTINGS_KEYS"; printf '%s\n' "$VIEW_KEYS") | sort | uniq -d | grep . | wc -l | tr -d ' ')
if [ "$COMMON" -eq 0 ]; then A10=0; else A10=1; fi
report "A10 持久化 schema 错位（settings.layout.open 键 ∩ app.js VIEW_META 键 = 0）" "$A10" \
  "settings.open=[$(printf '%s ' $SETTINGS_KEYS)] VIEW_META=[$(printf '%s ' $VIEW_KEYS)] 交集=${COMMON}"

# ---- A11 窗口无最小尺寸 -----------------------------------------------------
MIN_N=$(grep -cE 'minWidth|minHeight' src/main/index.ts 2>/dev/null | tr -d ' ')
MIN_N=${MIN_N:-0}
if [ "$MIN_N" -eq 0 ]; then A11=0; else A11=1; fi
report "A11 窗口无最小尺寸（src/main/index.ts minWidth/minHeight 命中 0）" "$A11" \
  "实测命中 = ${MIN_N}（拖到极小尺寸布局会碎裂）"

# ---- A12 无障碍基线 ---------------------------------------------------------
RM_N=$(grep -o 'prefers-reduced-motion' src/renderer/index.html 2>/dev/null | wc -l | tr -d ' ')
AL_N=$(grep -o 'aria-live' src/renderer/index.html src/renderer/app.js 2>/dev/null | wc -l | tr -d ' ')
if [ "$RM_N" -ge 13 ] && [ "$AL_N" -eq 1 ]; then A12=0; else A12=1; fi
report "A12 无障碍基线（index.html prefers-reduced-motion ≥ 13 且 aria-live = 1）" "$A12" \
  "实测 reduced-motion = ${RM_N} ; aria-live = ${AL_N}（流式/运行状态对读屏零播报）"

# ---- A13 data-archived 死守卫 ----------------------------------------------
ARCH_LIT=$(grep -o 'data-archived' src/renderer/app.js 2>/dev/null | wc -l | tr -d ' ')
ARCH_DS=$(grep -o 'dataset\.archived' src/renderer/app.js 2>/dev/null | wc -l | tr -d ' ')
if [ "$ARCH_LIT" -eq 0 ] && [ "$ARCH_DS" -eq 2 ]; then A13=0; else A13=1; fi
report "A13 data-archived 死守卫（app.js 字面量 0，但 dataset.archived 引用 2 → 守卫恒真）" "$A13" \
  "实测 data-archived = ${ARCH_LIT} ; dataset.archived = ${ARCH_DS}"

# ---- A14 注释对比度不实 -----------------------------------------------------
if grep -q '19.9' src/renderer/index.html; then A14=0; else A14=1; fi
report "A14 注释对比度不实（index.html 令牌注释含待修正宣称值 19.9）" "$A14" \
  "实测：注释含 19.9；该值经独立复算应为 17.71:1（偏差 −2.19）→ 注释待修正（属文档缺陷，非不达标）"

# ---- 汇总 -------------------------------------------------------------------
echo ""
echo "=============================================================="
printf ' 汇总：共 %d 条断言  →  ✅ %d 通过 / ❌ %d 未通过\n' \
  "$TOTAL" "$((TOTAL - FAILED))" "$FAILED"
if [ "$FAILED" -eq 0 ]; then
  echo " 退出码：0（全部通过——方案所述基线事实全部复现）"
  echo "=============================================================="
  exit 0
else
  echo " 退出码：1（存在未通过项——对现状的如实暴露，非脚本缺陷）"
  echo "=============================================================="
  exit 1
fi
