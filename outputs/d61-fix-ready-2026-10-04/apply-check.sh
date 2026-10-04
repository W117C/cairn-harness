#!/usr/bin/env sh
# #61 草案补丁的前置闸：`scripts/docs-check.ts` 现在正被隔壁会话改（47 插／5 删＝D-12 与两处类型修正）。
# 该文件一旦是脏的，`git apply` 就会把别人的在飞改动跟我这两处混成同一份工作树状态，
# 而 pathspec 提交的语义是「取工作树整份」⇒ 落笔即替他们落库。所以这里先断言「路是空的」。
#
# 用法：
#   sh outputs/d61-fix-ready-2026-10-04/apply-check.sh            ＝只做判定＋`git apply --check` 预演，不落笔
#   sh outputs/d61-fix-ready-2026-10-04/apply-check.sh --apply    ＝判定通过后才真的打两份补丁
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)")
TARGET="scripts/docs-check.ts"
PATCHES="$SCRIPT_DIR/head-cert-dated-dir.patch $SCRIPT_DIR/ledger-seam.patch"
BASE_HEAD="58a29ffa"          # 草案生成时的 HEAD
BASE_BLOB="1439c2cc6a6afd3ce659f4329c78dd6562e6c12a"   # 草案生成时的 `git hash-object $TARGET`

MODE="check"
case "${1:-}" in
  "" | --dry | --check) MODE="check" ;;
  --apply) MODE="apply" ;;
  *) printf '用法：apply-check.sh [--dry|--apply]（默认 --dry，只预演不落笔）\n' >&2; exit 64 ;;
esac

printf '仓库根：%s\n' "$ROOT"
printf 'HEAD：%s（草案基线：%s）\n' "$(git -C "$ROOT" rev-parse --short=8 HEAD)" "$BASE_HEAD"
printf '现取 blob：%s（草案基线：%s）\n' "$(git -C "$ROOT" hash-object "$TARGET")" "$BASE_BLOB"

# ── 闸一：归属。工作树与索引里都不许有别人对这个文件的未落库改动 ──
DIRTY=$(git -C "$ROOT" status --porcelain -- "$TARGET")
if [ -n "$DIRTY" ]; then
  printf '❌ 让路没成立：`git status --porcelain -- %s` 不为空。\n' "$TARGET" >&2
  printf '   现读：%s\n' "$DIRTY" >&2
  printf '   原因：这份补丁的上下文就取自该文件的工作树，脏着打＝把隔壁在飞的那一段（D-12 与类型修正）\n' >&2
  printf '         与我这两处混成同一份工作树状态，pathspec 提交取「工作树整份」，落笔就替他们落库。\n' >&2
  printf '   出路：等隔壁把那笔提交进去（这一格随之变空），或让持有者自己把这两处一起带上。\n' >&2
  exit 1
fi
printf '✅ 闸一：`%s` 干净（无未落库改动）⇒ 路是空的。\n' "$TARGET"

# ── 闸二：工件齐不齐（两份补丁都要在，缺一就不许只打一半）──
for p in $PATCHES; do
  [ -f "$p" ] || { printf '❌ 缺草案：%s\n' "$p" >&2; exit 2; }
done

# ── 闸三：逐份预演。每份都对**当前**工作树预演，所以顺序固定、且只读不写 ──
n=0
for p in $PATCHES; do
  n=$((n + 1))
  if ! git -C "$ROOT" apply --check -p1 --verbose "$p" 2>/dev/null; then
    printf '❌ 第 %s 份预演没过：`git apply --check` 拒绝 %s\n' "$n" "$(basename "$p")" >&2
    printf '   原因多半是基线挪了（草案的上下文＝工作树 blob %s）。\n' "$BASE_BLOB" >&2
    printf '   这两份 diff 的前驱是**工作树内容**、那个 blob 没入库，所以 `--3way` 找不到共同前驱：\n' >&2
    printf '   照 hunk 手工挪，别改上下文里的中文注释（「不在这里第二次写日期」那句是派生关系的声明）。\n' >&2
    printf '   复现失败的逐字输出：\n' >&2
    git -C "$ROOT" apply --check -p1 --verbose "$p" 2>&1 >/dev/null | sed 's/^/     /' >&2 || true
    exit 3
  fi
  printf '✅ 闸三：%s 预演通过（第 %s 份）\n' "$(basename "$p")" "$n"
done

if [ "$MODE" = "check" ]; then
  printf '\n只预演，没落笔。真要打就按顺序：\n'
  for p in $PATCHES; do printf '  git -C "%s" apply -p1 --verbose "%s"\n' "$ROOT" "$p"; done
  printf '或直接：sh %s --apply\n' "$SCRIPT_DIR/apply-check.sh"
  printf '\n打完**必须先跑**这两条（顺序也是这个）：\n'
  printf '  node --import tsx scripts/docs-check.ts\n'
  printf '  node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts tests/docs-check.test.ts\n'
  printf '再补：node --import tsx scripts/typecheck.ts（`PAGE_HEAD_RE` 是新导出）\n'
  exit 0
fi

# ── 落笔（前闸都过了才走到这里）──
for p in $PATCHES; do
  git -C "$ROOT" apply -p1 --verbose "$p"
  printf '✅ 已打：%s\n' "$(basename "$p")"
done
printf '\n现在去跑第三节那两条命令；预期会浮出 1 条 D-9 红（第 326 页／第 328 页未点名），处理办法见 README.md 第四节。\n'
