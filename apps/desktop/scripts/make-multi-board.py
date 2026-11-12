#!/usr/bin/env python3
"""首页四路线四宫格拼图（第 1055 页）：2×2，每格带中文方案名。
用法：python3 scripts/make-multi-board.py <outDir>
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "outputs/design-options-2026-11-08")
ITEMS = [
    ("M-1-now.png", "① 现在"),
    ("M-2-focus.png", "② 更聚焦"),
    ("M-3-info.png", "③ 更有内容"),
    ("M-4-layer.png", "④ 更柔和分层"),
]
W, H, BAR, LABEL = 720, 450, 44, 34


def font(size):
    for path in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


board = Image.new("RGB", (W * 2, (H + LABEL) * 2 + BAR), (28, 28, 28))
draw = ImageDraw.Draw(board)
draw.text((16, 10), "首页四种路线（挑一种，不是挑力度）", fill=(240, 240, 240), font=font(23))
for i, (fn, label) in enumerate(ITEMS):
    src = Image.open(os.path.join(OUT, fn)).convert("RGB")
    src.thumbnail((W, H), Image.Resampling.LANCZOS)  # type: ignore[attr-defined]
    tile = Image.new("RGB", (W, H), (20, 20, 20))
    tile.paste(src, ((W - src.width) // 2, (H - src.height) // 2))
    x, y = (i % 2) * W, BAR + (i // 2) * (H + LABEL)
    draw.text((x + 14, y + 4), label, fill=(255, 196, 120), font=font(20))
    board.paste(tile, (x, y + LABEL))
    draw.rectangle([x, y + LABEL, x + W - 1, y + LABEL + H - 1], outline=(70, 70, 70), width=1)
dest = os.path.join(OUT, "M-board.png")
board.save(dest)
print("board:", dest, board.size)
