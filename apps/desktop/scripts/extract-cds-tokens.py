#!/usr/bin/env python3
# 从本机 Claude Desktop 的 app.asar 里取出两份官方产物，并**验证摘要**：
#
#   1. tokens.css            ← .vite/build/index.chunk-*.js 里内嵌的 `@ant/cds/tokens.vanilla.css`
#                               样式薄字符串（逐字节还原：切片 → 解 JS 转义）
#   2. MainWindowPage-*.css  ← .vite/renderer/main_window/assets/ 下的渲染层 CSS 成员
#                               （组件抽取脚本的输入，见 extract-cds-components.mjs）
#
# 为什么需要这个脚本：`UPSTREAM.json` 原先把通道写成「ad-hoc asar member parse，脚本未保留」。
# 没有脚本的取证链不可复现——事实上那条链就错了一次：asar 数据段起点被算成 `16 + jsonLen`，
# 正确是 `8 + u32@4`，两者相差 1 字节，于是摘要覆盖的是「前一个成员结尾的换行 + 本成员少最后一个
# 字节」的窗口。它算出的 `93ee8d85…` 正是这么来的；本机真实成员是 `948bac16…`。
# 本脚本按正确偏移取，并与 UPSTREAM.json / components.json 的记录对账。
#
# 用法：
#   python3 scripts/extract-cds-tokens.py --check            # 只核对（默认）
#   python3 scripts/extract-cds-tokens.py --write <out-dir>  # 落盘 tokens.css + 渲染层 CSS
#
# --write 的 out-dir 通常就是 src/renderer/vendor/cds-official；
# 渲染层 CSS 落到 <out-dir>/../_cache/ 供组件抽取脚本使用（不入库）。
import argparse
import hashlib
import json
import os
import re
import struct
import sys
import tempfile

DEFAULT_ASAR = "/Applications/Claude.app/Contents/Resources/app.asar"
HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.abspath(os.path.join(HERE, "..", "src", "renderer", "vendor", "cds-official"))

# tokens.vanilla.css 在构建包里的起止锚点。起点是样式薄的第一行，止点是它所在的 <style> 结束标记。
TOKENS_START = ":root {\\n  --radius: calc(0.5rem * var(--cds-rem-scale, 1));"
TOKENS_END = "</style>"


def read_asar(path):
    """返回 (header, data_start, blob)。数据段起点 = 8 + u32le@4（不是 16 + jsonLen）。"""
    with open(path, "rb") as fh:
        blob = fh.read()
    payload_size = struct.unpack("<I", blob[4:8])[0]
    json_len = struct.unpack("<I", blob[12:16])[0]
    header = json.loads(blob[16 : 16 + json_len])
    return header, 8 + payload_size


def walk(node, prefix=""):
    if "files" in node:
        for name, child in node["files"].items():
            yield from walk(child, prefix + "/" + name)
    elif "offset" in node:
        yield prefix, int(node["offset"]), int(node["size"])


def find_member(header, pattern):
    hits = [(p, o, s) for p, o, s in walk(header) if re.search(pattern, p)]
    return hits


def js_unescape(text):
    """把 JS 字符串字面量里的转义还原成真实字符（本包只用到 \\n \\t \\r \\\\ \\" \\xNN \\uNNNN）。"""
    out = []
    i = 0
    simple = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", '"': '"', "'": "'", "`": "`", "/": "/"}
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text):
            nxt = text[i + 1]
            if nxt in simple:
                out.append(simple[nxt])
                i += 2
                continue
            if nxt == "x":
                out.append(chr(int(text[i + 2 : i + 4], 16)))
                i += 4
                continue
            if nxt == "u":
                if text[i + 2] == "{":
                    close = text.index("}", i)
                    out.append(chr(int(text[i + 3 : close], 16)))
                    i = close + 1
                    continue
                out.append(chr(int(text[i + 2 : i + 6], 16)))
                i += 6
                continue
            out.append(nxt)
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_expected():
    upstream_path = os.path.join(VENDOR, "UPSTREAM.json")
    if not os.path.exists(upstream_path):
        return None
    with open(upstream_path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asar", default=DEFAULT_ASAR)
    ap.add_argument("--check", action="store_true", help="只核对摘要（默认）")
    ap.add_argument("--write", metavar="OUT_DIR", help="落盘 tokens.css（以及 --css-out 指定的渲染层 CSS）")
    ap.add_argument("--css-out", metavar="PATH", help="渲染层 CSS 的落盘路径；缺省落临时目录（不入库）")
    args = ap.parse_args()

    if not os.path.exists(args.asar):
        raise SystemExit(f"找不到 app.asar：{args.asar}")

    header, data_start = read_asar(args.asar)
    with open(args.asar, "rb") as fh:
        blob = fh.read()
    # walk() 的 offset 是相对数据段的，这里补上正确起点
    def shifted(pattern):
        return [(p, data_start + o, s) for p, o, s in find_member(header, pattern)]

    tokens_text, tokens_member = None, None
    for path, offset, size in shifted(r"\.vite/build/index\.chunk-.*\.js$"):
        chunk = blob[offset : offset + size].decode("utf-8", "replace")
        if "tokens.vanilla" not in chunk:
            continue
        start = chunk.find(TOKENS_START)
        # 止点必须是**这个 JS 字符串自己的**闭合反引号，不是后面的 </style>。
        # 5.1231.2 把样式薄改成多段模板串拼接（`,b=`</style>...）：照旧用 </style>
        # 当止点会把 5 字节的压缩 JS 混进 CSS，PostCSS 当场报 Unknown word（构建全红）。
        # 反斜杠转义过的反引号是内容，跳过；闭合串之后才允许出现 </style>。
        end = -1
        if start >= 0:
            i = start
            while i < len(chunk):
                if chunk[i] == "\\":
                    i += 2
                    continue
                if chunk[i] == "`":
                    end = i
                    break
                i += 1
        if start >= 0 and end >= 0 and chunk.find(TOKENS_END, end) >= 0:
            tokens_text, tokens_member = js_unescape(chunk[start:end]), path
            break
    if tokens_text is None:
        raise SystemExit("没能从构建包里还原 tokens.vanilla.css")

    css_hits = shifted(r"/\.vite/renderer/main_window/assets/MainWindowPage-[^/]*\.css$")
    if len(css_hits) != 1:
        raise SystemExit(f"期望恰好一个 MainWindowPage-*.css 成员，实际 {len(css_hits)} 个")
    css_path, css_offset, css_size = css_hits[0]
    css_bytes = blob[css_offset : css_offset + css_size]

    tokens_bytes = tokens_text.encode("utf-8")
    report = {
        "asar": args.asar,
        "tokens": {
            "member": tokens_member,
            "bytes": len(tokens_bytes),
            "sha256": sha(tokens_bytes),
        },
        "rendererCss": {
            "member": css_path,
            "bytes": len(css_bytes),
            "sha256": sha(css_bytes),
        },
    }

    expected = load_expected()
    verdict = "no-upstream-record"
    if expected is not None:
        files = {f["file"]: f for f in expected.get("files", [])}
        rec_tokens = files.get("tokens.css", {})
        evidence = (expected.get("evidence") or [{}])[0]
        rec_css = {"sha256": evidence.get("sha256"), "bytes": evidence.get("bytes")}
        report["expected"] = {
            "tokens.css": {"sha256": rec_tokens.get("sha256"), "bytes": rec_tokens.get("bytes")},
            "rendererCss": rec_css,
        }
        ok_tokens = rec_tokens.get("sha256") == report["tokens"]["sha256"] and rec_tokens.get("bytes") == report["tokens"]["bytes"]
        ok_css = rec_css.get("sha256") == report["rendererCss"]["sha256"] and rec_css.get("bytes") == report["rendererCss"]["bytes"]
        report["match"] = {"tokens.css": ok_tokens, "rendererCss": ok_css}
        verdict = "PASS" if ok_tokens and ok_css else "FAIL"
    report["verdict"] = verdict

    if args.write:
        out_dir = os.path.abspath(args.write)
        os.makedirs(out_dir, exist_ok=True)
        tokens_out = os.path.join(out_dir, "tokens.css")
        with open(tokens_out, "wb") as fh:
            fh.write(tokens_bytes)
        css_out = args.css_out or os.path.join(tempfile.mkdtemp(prefix="cds-renderer-"), os.path.basename(css_path))
        os.makedirs(os.path.dirname(os.path.abspath(css_out)), exist_ok=True)
        with open(css_out, "wb") as fh:
            fh.write(css_bytes)
        report["written"] = {"tokens.css": tokens_out, "rendererCss": css_out}

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if verdict in ("PASS", "no-upstream-record") else 1


if __name__ == "__main__":
    sys.exit(main())
