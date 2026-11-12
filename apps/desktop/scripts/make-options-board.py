#!/usr/bin/env python3
"""设计方向样板拼图（第 1052 页）：把「现在 / 轻度 / 明显」三张真机截图横向拼成一张带标签的图。

用法：python3 scripts/make-options-board.py ../../outputs/design-options-2026-11-08
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "outputs/design-options-2026-11-08"
OUT = os.path.abspath(OUT)
GROUPS_ALL = {
    "A": ("A 深色模式：层级 / 颜色", ["A-1-now.png", "A-2-light.png", "A-3-strong.png"]),
    "B": ("B 打开菜单时：背景降层", ["B-1-now.png", "B-2-light.png", "B-3-strong.png"]),
    "C": ("C 顶栏：松紧与对齐", ["C-1-now.png", "C-2-light.png", "C-3-strong.png"]),
    "D": ("D 消息之间：疏与密", ["D-1-now.png", "D-2-light.png", "D-3-strong.png"]),
}
keys = (sys.argv[2].split(",") if len(sys.argv) > 2 else ["A", "B"])
GROUPS = [(k, GROUPS_ALL[k][0], GROUPS_ALL[k][1]) for k in keys]
LABELS = ["现在", "轻度", "明显"]
W, H, BAR = 520, 325, 46

def font(size):
    for path in [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
    ]:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()

for key, title, files in GROUPS:
    board = Image.new("RGB", (W * 3, H + BAR), (28, 28, 28))
    draw = ImageDraw.Draw(board)
    f_title = font(22)
    f_label = font(19)
    draw.text((14, 10), title, fill=(240, 240, 240), font=f_title)
    for i, (fn, label) in enumerate(zip(files, LABELS)):
        src = Image.open(os.path.join(OUT, fn)).convert("RGB")
        # Pillow ≥9.1 的 LANCZOS 在 Image.Resampling 下；Pyright 对它报误诊，故显式忽略。
        src.thumbnail((W, H), Image.Resampling.LANCZOS)  # type: ignore[attr-defined]
        tile = Image.new("RGB", (W, H), (20, 20, 20))
        tile.paste(src, ((W - src.width) // 2, (H - src.height) // 2))
        board.paste(tile, (i * W, BAR))
        draw.text((i * W + 14, BAR + 8), label, fill=(255, 196, 120), font=f_label)
        if i > 0:
            draw.line([(i * W, BAR), (i * W, BAR + H)], fill=(90, 90, 90), width=1)
    dest = os.path.join(OUT, key + "-board.png")
    board.save(dest)
    print("board:", dest, board.size)
