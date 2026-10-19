import math

N = 20
BB = (405, 380)
R = 26

def leg_vals(H, phase):
    vals = []
    for i in range(N):
        th = 2*math.pi*i/N + phase
        fx = BB[0] + R*math.cos(th)
        fy = BB[1] + R*math.sin(th)
        mx = (H[0]+fx)/2.0
        my = (H[1]+fy)/2.0
        dx = fx-H[0]; dy = fy-H[1]
        L = math.hypot(dx, dy) or 1
        px = -dy/L; py = dx/L
        if px < 0:
            px = -px; py = -py
        off = 15
        kx = mx + px*off
        ky = my + py*off
        vals.append("M %.1f %.1f Q %.1f %.1f %.1f %.1f" % (H[0], H[1], kx, ky, fx, fy))
    return vals

legA = leg_vals((398, 288), 0)
legB = leg_vals((416, 292), math.pi)

def join_vals(v):
    return ";".join(v + [v[0]])

def keytimes():
    return ";".join(["%.4f" % (i/N) for i in range(N)] + ["1"])

kt = keytimes()
valsA = join_vals(legA)
valsB = join_vals(legB)

def wheel(cx, cy, r):
    parts = []
    for k in range(8):
        a = math.pi/4*k
        x2 = cx + r*0.88*math.cos(a)
        y2 = cy + r*0.88*math.sin(a)
        parts.append('<line x1="%d" y1="%d" x2="%.1f" y2="%.1f" stroke="#aeb6bd" stroke-width="3"/>' % (cx, cy, x2, y2))
    parts.append('<circle cx="%d" cy="%d" r="%d" fill="none" stroke="#2c2f33" stroke-width="7"/>' % (cx, cy, r))
    parts.append('<circle cx="%d" cy="%d" r="%d" fill="#f4f6f8" stroke="#c9ced3" stroke-width="2"/>' % (cx, cy, r-7))
    parts.append('<circle cx="%d" cy="%d" r="6" fill="#444"/>' % (cx, cy))
    inner = "".join(parts)
    return ('<g>%s<animateTransform attributeName="transform" type="rotate" '
            'from="0 %d %d" to="360 %d %d" dur="1.4s" repeatCount="indefinite"/></g>' % (inner, cx, cy, cx, cy))

def cloud(x, y, s):
    return ('<ellipse cx="%.0f" cy="%.0f" rx="%.0f" ry="%.0f" fill="#ffffff"/>'
            '<ellipse cx="%.0f" cy="%.0f" rx="%.0f" ry="%.0f" fill="#ffffff"/>'
            '<ellipse cx="%.0f" cy="%.0f" rx="%.0f" ry="%.0f" fill="#ffffff"/>'
            % (x, y, 60*s, 26*s, x-40*s, y+8*s, 40*s, 20*s, x+45*s, y+6*s, 44*s, 22*s))

clouds = (cloud(130, 95, 1.0) + cloud(430, 60, 0.8) + cloud(710, 120, 1.1))
clouds2 = (cloud(150, 140, 0.9) + cloud(520, 110, 0.7))

def ground():
    return ''

dashes = ""
for i in range(16):
    x = -70 + i*70
    dashes += '<rect x="%d" y="490" width="34" height="7" rx="3.5" fill="#ffffff" opacity="0.7"/>' % x

crank = ('<g>'
         '<line x1="405" y1="380" x2="431" y2="380" stroke="#3a3f44" stroke-width="6" stroke-linecap="round"/>'
         '<line x1="405" y1="380" x2="379" y2="380" stroke="#3a3f44" stroke-width="6" stroke-linecap="round"/>'
         '<rect x="423" y="374" width="17" height="11" rx="3" fill="#222"/>'
         '<rect x="371" y="374" width="17" height="11" rx="3" fill="#222"/>'
         '<ellipse cx="431" cy="386" rx="12" ry="6" fill="#ff9d3c" stroke="#e07d2a" stroke-width="1.5"/>'
         '<ellipse cx="379" cy="386" rx="12" ry="6" fill="#e07d2a"/>'
         '<animateTransform attributeName="transform" type="rotate" from="0 405 380" to="360 405 380" dur="1.4s" repeatCount="indefinite"/>'
         '</g>')

legB_path = ('<path fill="none" stroke="#e07d2a" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">'
             '<animate attributeName="d" dur="1.4s" repeatCount="indefinite" calcMode="linear" keyTimes="%s" values="%s"/></path>' % (kt, valsB))

legA_path = ('<path fill="none" stroke="#ff9d3c" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">'
             '<animate attributeName="d" dur="1.4s" repeatCount="indefinite" calcMode="linear" keyTimes="%s" values="%s"/></path>' % (kt, valsA))

frame = ('<g fill="none" stroke="#e23b4e" stroke-width="9" stroke-linecap="round">'
         '<path d="M 405 380 L 370 302"/>'
         '<path d="M 405 380 L 522 302"/>'
         '<path d="M 370 302 L 522 302"/>'
         '<path d="M 522 302 L 560 380"/>'
         '<path d="M 405 380 L 250 380"/>'
         '<path d="M 370 302 L 250 380"/>'
         '<path d="M 524 302 L 518 272"/>'
         '</g>'
         '<path d="M 352 299 Q 372 291 393 299 L 389 308 L 356 308 Z" fill="#2c2f33"/>'
         '<circle cx="518" cy="270" r="6" fill="#2c2f33"/>')

body = ('''
<g>
  <path d="M 425 240 Q 472 234 458 263 Q 440 263 425 255 Z" fill="#eef2f5" stroke="#d3dbe1" stroke-width="2"/>
  <ellipse cx="358" cy="258" rx="66" ry="48" fill="#fbfdff" stroke="#dde6ec" stroke-width="2"/>
  <path d="M 304 286 Q 358 320 414 286 Q 394 304 358 308 Q 322 304 304 286 Z" fill="#eef3f7"/>
  <g>
    <path d="M 334 240 Q 300 254 318 294 Q 360 288 380 252 Q 358 236 334 240 Z" fill="#e7eef3" stroke="#cfd9e0" stroke-width="2"/>
    <animateTransform attributeName="transform" type="rotate" values="-6 334 240; 6 334 240; -6 334 240" dur="1.1s" repeatCount="indefinite"/>
  </g>
  <path d="M 345 244 Q 430 252 510 266" fill="none" stroke="#dde6ec" stroke-width="19" stroke-linecap="round"/>
  <path d="M 345 244 Q 430 252 510 266" fill="none" stroke="#fbfdff" stroke-width="14" stroke-linecap="round"/>
  <circle cx="513" cy="267" r="9" fill="#fbfdff" stroke="#dde6ec" stroke-width="2"/>
  <path d="M 334 226 Q 312 196 320 154" fill="none" stroke="#fbfdff" stroke-width="25" stroke-linecap="round"/>
  <path d="M 334 226 Q 312 196 320 154" fill="none" stroke="#dde6ec" stroke-width="2" stroke-linecap="round" opacity="0.45" transform="translate(-12,0)"/>
  <circle cx="318" cy="150" r="26" fill="#fbfdff" stroke="#dde6ec" stroke-width="2"/>
  <path d="M 298 139 Q 258 140 219 174 Q 248 161 298 153 Z" fill="#ffb24d" stroke="#e8962f" stroke-width="2"/>
  <path d="M 298 157 Q 252 198 226 177 Q 247 168 298 150 Z" fill="#ffd28a" stroke="#e8962f" stroke-width="2"/>
  <circle cx="312" cy="144" r="4.6" fill="#222"/>
  <circle cx="313.6" cy="142.4" r="1.6" fill="#fff"/>
</g>
''')

svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 520" preserveAspectRatio="xMidYMid meet">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#9fdcff"/>
    <stop offset="0.55" stop-color="#cdeeff"/>
    <stop offset="1" stop-color="#eafaff"/>
  </linearGradient>
  <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#fff4c2"/>
    <stop offset="0.6" stop-color="#ffe27a"/>
    <stop offset="1" stop-color="#ffd24d"/>
  </radialGradient>
</defs>
<rect x="0" y="0" width="900" height="520" fill="url(#sky)"/>
<g opacity="0.55">
  <g>
    ''' + ("".join('<line x1="780" y1="90" x2="%d" y2="%d" stroke="#ffe27a" stroke-width="4" stroke-linecap="round"/>' % (780+54*math.cos(a), 90+54*math.sin(a)) for a in [math.pi/8*i for i in range(8)])) + '''
    <animateTransform attributeName="transform" type="rotate" from="0 780 90" to="360 780 90" dur="40s" repeatCount="indefinite"/>
  </g>
</g>
<circle cx="780" cy="90" r="46" fill="url(#sun)"/>
<g>
  ''' + clouds + clouds2 + '''
  <g transform="translate(-900,0)">''' + clouds + clouds2 + '''</g>
  <animateTransform attributeName="transform" type="translate" from="0 0" to="900 0" dur="32s" repeatCount="indefinite"/>
</g>
<path d="M0 452 Q 160 384 330 442 Q 510 402 700 450 Q 820 424 900 450 L900 520 L0 520 Z" fill="#bfe6a0"/>
<path d="M0 470 Q 200 440 420 470 Q 640 446 900 470 L900 520 L0 520 Z" fill="#a9d98a"/>
<rect x="0" y="466" width="900" height="54" fill="#6cbf4f"/>
<rect x="0" y="466" width="900" height="6" fill="#5aa83f"/>
<g>''' + dashes + '''<animateTransform attributeName="transform" type="translate" from="0 0" to="70 0" dur="0.55s" repeatCount="indefinite"/></g>
<ellipse cx="250" cy="454" rx="78" ry="12" fill="#000000" opacity="0.12"/>
<ellipse cx="560" cy="454" rx="78" ry="12" fill="#000000" opacity="0.12"/>
''' + wheel(250, 380, 70) + wheel(560, 380, 70) + frame + crank + legB_path + body + legA_path + '''
</svg>'''

html = ('<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>鹈鹕骑自行车</title>'
        '<style>'
        'html,body{margin:0;height:100%;background:linear-gradient(#9fdcff,#eafaff);overflow:hidden;}'
        'svg{width:100vw;height:100vh;display:block;}'
        '</style></head><body>' + svg + '</body></html>')

with open('pelican-bike.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("written", len(html), "bytes")
