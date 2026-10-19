import math

CX, CY, R = 398.0, 360.0, 28.0   # crank center & arm length (matches pedal blocks at ±28)
L1, L2 = 46.0, 46.0              # thigh, shank

def pedal(theta_deg):
    r = math.radians(theta_deg)
    return (CX + R*math.cos(r), CY + R*math.sin(r))

def knee(hip, foot):
    dx, dy = foot[0]-hip[0], foot[1]-hip[1]
    D = math.hypot(dx, dy)
    D = min(max(D, abs(L1-L2)+0.01), L1+L2-0.01)
    a = math.atan2(dy, dx)
    cosf = (L1*L1 + D*D - L2*L2) / (2*L1*D)
    cosf = max(-1, min(1, cosf))
    phi = math.acos(cosf)
    # two solutions: knee forward (+phi) vs back (-phi). pick forward (larger x).
    k1 = (hip[0] + L1*math.cos(a+phi), hip[1] + L1*math.sin(a+phi))
    k2 = (hip[0] + L1*math.cos(a-phi), hip[1] + L1*math.sin(a-phi))
    return k1 if k1[0] >= k2[0] else k2

def leg_str(hip, foot):
    k = knee(hip, foot)
    return "M%.1f %.1f L%.1f %.1f L%.1f %.1f" % (hip[0], hip[1], k[0], k[1], foot[0], foot[1])

def cycle(hip, phase):
    vals = []
    for i in range(9):                 # 9 values: i=8 == i=0 -> seamless loop
        theta = 45.0 * i + phase
        f = pedal(theta)
        vals.append(leg_str(hip, f))
    return ";".join(vals)

Hn = (358.0, 312.0)   # near (front) leg hip
Hf = (372.0, 314.0)   # far  (back)  leg hip

print("NEAR:", cycle(Hn, 0.0))
print("FAR :", cycle(Hf, 180.0))
