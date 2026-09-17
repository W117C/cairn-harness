"""独立复算：oklch -> sRGB -> WCAG 对比度。用于核对 index.html 令牌块注释里的宣称值。"""
import math


def oklch_to_srgb(L, C, H):
    h = math.radians(H)
    a = C * math.cos(h)
    b = C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return tuple(min(1.0, max(0.0, v)) for v in (r, g, bb))


def rel_luminance(lin):
    r, g, b = lin
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(c1, c2):
    l1, l2 = rel_luminance(oklch_to_srgb(*c1)), rel_luminance(oklch_to_srgb(*c2))
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


LIGHT = {
    'bg':     (1.000, 0.000, 0),
    'surface': (1.000, 0.000, 0),
    'surface-2': (0.987, 0.003, 250),
    'fg':     (0.210, 0.006, 250),
    'muted':  (0.450, 0.008, 250),
    'dim':    (0.540, 0.008, 250),
    'accent': (0.480, 0.130, 247),
    'ok':     (0.520, 0.130, 150),
    'danger': (0.540, 0.190, 25),
    'warn':   (0.500, 0.120, 80),
}
DARK = {
    'bg':     (0.168, 0.012, 250),
    'surface': (0.208, 0.014, 250),
    'surface-2': (0.244, 0.015, 250),
    'fg':     (0.930, 0.006, 250),
    'muted':  (0.720, 0.012, 250),
    'dim':    (0.620, 0.012, 250),
    'accent': (0.760, 0.120, 250),
    'ok':     (0.740, 0.150, 150),
    'danger': (0.700, 0.180, 25),
    'warn':   (0.780, 0.130, 80),
}

CLAIMED_LIGHT = {'fg': 19.9, 'muted': 7.8, 'dim': 5.2}
CLAIMED_DARK = {'fg': 16.4, 'muted': 8.1, 'dim': 5.5}

print('=' * 62)
print('LIGHT（相对 --bg oklch(100% 0 0)）')
print('=' * 62)
for k in ('fg', 'muted', 'dim', 'accent', 'ok', 'danger', 'warn'):
    c = contrast(LIGHT[k], LIGHT['bg'])
    claim = CLAIMED_LIGHT.get(k)
    tag = f'  （注释宣称 {claim}:1 → {"吻合" if claim and abs(c - claim) < 0.35 else "不一致"}）' if claim else ''
    print(f'  {k:<8} {c:6.2f}:1{tag}')

print()
print('=' * 62)
print('DARK（相对 --bg oklch(16.8% 0.012 250)）')
print('=' * 62)
for k in ('fg', 'muted', 'dim', 'accent', 'ok', 'danger', 'warn'):
    c = contrast(DARK[k], DARK['bg'])
    claim = CLAIMED_DARK.get(k)
    tag = f'  （注释宣称 {claim}:1 → {"吻合" if claim and abs(c - claim) < 0.35 else "不一致"}）' if claim else ''
    print(f'  {k:<8} {c:6.2f}:1{tag}')

print()
print('=' * 62)
print('四态语义色（09-15 方案值）对照度复核')
print('=' * 62)
ST_LIGHT = {
    'st-run':   (0.520, 0.150, 150),
    'st-wait':  (0.450, 0.008, 250),
    'st-stuck': (0.500, 0.140, 70),
    'st-fail':  (0.530, 0.200, 25),
}
ST_DARK = {
    'st-run':   (0.740, 0.150, 150),
    'st-wait':  (0.760, 0.012, 250),
    'st-stuck': (0.800, 0.130, 80),
    'st-fail':  (0.760, 0.160, 25),
}
CLAIM_L = {'st-run': 5.11, 'st-wait': 7.43, 'st-stuck': 6.15, 'st-fail': 5.86}
CLAIM_D = {'st-run': 8.86, 'st-wait': 8.98, 'st-stuck': 10.19, 'st-fail': 8.11}
for k in ST_LIGHT:
    cl, cd = contrast(ST_LIGHT[k], LIGHT['bg']), contrast(ST_DARK[k], DARK['bg'])
    ok_l = '吻合' if abs(cl - CLAIM_L[k]) < 0.35 else '不一致'
    ok_d = '吻合' if abs(cd - CLAIM_D[k]) < 0.35 else '不一致'
    print(f'  {k:<9} light {cl:6.2f}:1 (宣称 {CLAIM_L[k]}, {ok_l})   dark {cd:6.2f}:1 (宣称 {CLAIM_D[k]}, {ok_d})')

print()
print('=' * 62)
print('accent 作为按钮底 + accent-fg 文字')
print('=' * 62)
print(f"  light accent/accent-fg : {contrast(LIGHT['accent'], (1.0, 0.0, 0)):6.2f}:1")
print(f"  dark  accent/accent-fg : {contrast(DARK['accent'], (0.170, 0.030, 250)):6.2f}:1")
