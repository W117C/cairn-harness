import math

NEAR = ("M358.0 312.0 L403.3 320.0 L426.0 360.0;M358.0 312.0 L394.3 340.3 L417.8 379.8;"
        "M358.0 312.0 L392.6 342.3 L398.0 388.0;M358.0 312.0 L396.3 337.5 L378.2 379.8;"
        "M358.0 312.0 L401.6 326.6 L370.0 360.0;M358.0 312.0 L402.7 301.3 L378.2 340.2;"
        "M358.0 312.0 L396.0 286.0 L398.0 332.0;M358.0 312.0 L401.5 297.2 L417.8 340.2;"
        "M358.0 312.0 L403.3 320.0 L426.0 360.0")
FAR = ("M372.0 314.0 L410.8 338.7 L370.0 360.0;M372.0 314.0 L417.9 317.0 L378.2 340.2;"
       "M372.0 314.0 L409.6 287.5 L398.0 332.0;M372.0 314.0 L413.6 294.4 L417.8 340.2;"
       "M372.0 314.0 L418.0 314.7 L426.0 360.0;M372.0 314.0 L413.4 334.0 L417.8 379.8;"
       "M372.0 314.0 L407.7 343.0 L398.0 388.0;M372.0 314.0 L407.0 343.9 L378.2 379.8;"
       "M372.0 314.0 L410.8 338.7 L370.0 360.0")

CX, CY, R = 398, 360, 28  # crank center & pedal radius (pedal blocks at ±28)

def feet(s):
    out = []
    for seg in s.split(';'):
        seg = seg.replace('M', '').replace('L', '').split()
        nums = [float(x) for x in seg]
        out.append((nums[4], nums[5]))  # foot = last two coords
    return out

def interp(pts, t):
    N = len(pts)
    x = float(t) * (N - 1)
    i = min(int(math.floor(x)), N - 2)
    f = x - i
    a, b = pts[i], pts[i + 1]
    return (a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f)

def pedal(theta_deg):
    r = math.radians(theta_deg)
    return (CX + R*math.cos(r), CY + R*math.sin(r))

for name, s in [("NEAR", NEAR), ("FAR", FAR)]:
    pts = feet(s)
    N = len(pts)
    dev_circle = max(abs(math.hypot(p[0]-CX, p[1]-CY) - R) for p in pts)
    loop_gap = math.hypot(interp(pts, 0.99999)[0]-pts[0][0],
                          interp(pts, 0.99999)[1]-pts[0][1])
    max_sync = 0
    for i in range(N):
        theta = 360.0 * i / (N - 1) + (180.0 if name == "FAR" else 0.0)
        pd = pedal(theta)
        d = math.hypot(pts[i][0]-pd[0], pts[i][1]-pd[1])
        max_sync = max(max_sync, d)
    print(f"{name}: N={N}  foot-on-crank-circle dev={dev_circle:.3f}px"
          f"  LOOP-SNAP={loop_gap:.2f}px  foot-vs-pedal-at-keyframes={max_sync:.2f}px")
