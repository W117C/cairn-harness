"""定案 --border-strong dark：先把 oklch 底/描边转成真实 sRGB hex，再算对比度。"""
import math


def oklch_to_srgb_hex(L, C, H):
    h = math.radians(H)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    lin = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
           -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    out = []
    for v in lin:
        v = min(1.0, max(0.0, v))
        srgb = 12.92 * v if v <= 0.0031308 else 1.055 * (v ** (1 / 2.4)) - 0.055
        out.append(round(min(1.0, max(0.0, srgb)) * 255))
    return '#%02x%02x%02x' % tuple(out)


def lum_from_hex(h):
    h = h.lstrip('#')
    ch = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    ch = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def ct(h1, h2):
    a, b = lum_from_hex(h1), lum_from_hex(h2)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


print('=== 深色底的真实 hex ===')
dark_bg = oklch_to_srgb_hex(0.168, 0.012, 250)
dark_s2 = oklch_to_srgb_hex(0.244, 0.015, 250)
dark_surface = oklch_to_srgb_hex(0.208, 0.014, 250)
bs_dark = oklch_to_srgb_hex(0.560, 0.012, 250)
bs_light = oklch_to_srgb_hex(0.620, 0.008, 250)
print(f'  dark --bg        oklch(16.8% .012 250) -> {dark_bg}')
print(f'  dark --surface   oklch(20.8% .014 250) -> {dark_surface}')
print(f'  dark --surface-2 oklch(24.4% .015 250) -> {dark_s2}')
print(f'  dark --border-strong oklch(56% .012 250) -> {bs_dark}')
print(f'  light --border-strong oklch(62% .008 250) -> {bs_light}')
print()
print('=== --border-strong dark 定案 ===')
print(f'  vs --bg        {ct(bs_dark, dark_bg):6.2f}:1')
print(f'  vs --surface   {ct(bs_dark, dark_surface):6.2f}:1')
print(f'  vs --surface-2 {ct(bs_dark, dark_s2):6.2f}:1')
print()
print('=== --border-strong light 定案 ===')
print(f'  vs --bg        {ct(bs_light, "#ffffff"):6.2f}:1')
print()
print('=== 对照：--border（装饰） ===')
b_light = oklch_to_srgb_hex(0.936, 0.005, 250)
b_dark = oklch_to_srgb_hex(0.305, 0.016, 250)
print(f'  light {b_light} vs #ffffff : {ct(b_light, "#ffffff"):6.2f}:1')
print(f'  dark  {b_dark} vs {dark_bg} : {ct(b_dark, dark_bg):6.2f}:1')
print(f'  dark  {b_dark} vs {dark_surface} : {ct(b_dark, dark_surface):6.2f}:1')
