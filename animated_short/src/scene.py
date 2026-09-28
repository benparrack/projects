"""The film as a pure function of time: state(t) -> shader uniforms.

World units are km (float64 here). Each shot is a function that fills a
world-space state (camera, probe, which objects exist, event levels);
`finalize` turns that into per-object, camera-relative uniforms for the shader.
"""
import numpy as np

import timeline as TL
from mathutil import (V, norm, smooth, smoother, ramp, lerp, rot_axis, look_at,
                      look_dir, spline, value_noise1, clamp01)

# ------------------------------------------------------------------ world
PL_R = 60000.0
PL_C = V(0, 0, 0)
SUN = norm(V(1.0, 0.15, -0.1))
SUN_COL = V(1.0, 0.95, 0.88) * 1.15

_w = norm(np.cross(SUN, V(0, 1, 0)))          # horizontal, perpendicular to the sun
_v = norm(np.cross(_w, SUN))                  # completes the frame

# planet orientation (world -> planet): slight axial tilt
_py = norm(V(0.12, 1.0, 0.06))
_px = norm(np.cross(_py, V(0, 0, 1)))
_pz = np.cross(_px, _py)
PL_ROT = np.vstack([_px, _py, _pz])

# the Gate
RING_R = 3000.0            # body centre-line radius
RING_RW = 60.0             # radial half thickness  (inner floor at R-RW)
RING_C = 100000.0 * norm(-0.25 * SUN + _w + 0.12 * _v)
RING_N = norm(0.35 * SUN + 0.25 * _w + 0.90 * _v)
_e1 = norm(np.cross(RING_N, SUN))
_e2 = np.cross(_e1, RING_N)
RING_M = np.vstack([_e1, RING_N, _e2])         # world -> ring-centred
PATTERN_P = 3542.0                              # ring greeble pattern period (km)

# The probe's position during the deep-space opening: night side, sun hidden.
PROBE0 = PL_C + 120000.0 * norm(-SUN + 0.35 * _v + 0.12 * _w)

PB_SCALE = 0.001            # km per probe unit (1 m)
REF_LINES = 804             # reference picture height for pixel-size decisions


def ring_point(ang, h_above_floor=None, y=0.0, rad=None):
    """World position on/around the ring. ang = true ring angle.
    Either give height above the inner floor or a raw radial offset."""
    if rad is None:
        rad = -RING_RW - (h_above_floor or 0.0)
    r = RING_R + rad
    pc = V(np.cos(ang) * r, y, np.sin(ang) * r)
    return RING_C + RING_M.T @ pc


def ring_frame_at(ang):
    """(tangent (+angle), up-from-floor (toward centre), axis) in world."""
    t = RING_M.T @ V(-np.sin(ang), 0, np.cos(ang))
    inward = RING_M.T @ V(-np.cos(ang), 0, -np.sin(ang))
    return t, inward, RING_N


def inner_sun(ang):
    """How much sun the inner floor gets at this ring angle."""
    _, up, _ = ring_frame_at(ang)
    return float(np.dot(up, SUN))


# pick the beacon angle: floor lit at a low grazing angle (dramatic)
def _pick_beacon():
    best, ba = 9, 0
    for a in np.linspace(-np.pi, np.pi, 3600):
        s = inner_sun(a)
        if abs(s - 0.28) < best and np.dot(ring_frame_at(a)[0], SUN) > 0:
            best, ba = abs(s - 0.28), a
    return ba


BEACON_ANG = _pick_beacon()


# ------------------------------------------------------------------ global curves
def core_level(t):
    c = 1.0
    for a, b, depth in TL.FLICKERS:
        if a <= t <= b:
            x = (t - a) / (b - a)
            env = np.sin(np.pi * x)
            fl = 0.5 + 0.5 * np.sign(np.sin(t * 37.0 + 3 * np.sin(t * 11.0)))
            c = 1.0 - depth * env * (0.6 + 0.4 * fl)
    # knocked out by the shockwave, then relit
    if TL.SHOCK_HIT <= t < TL.DARK_END:
        c = max(0.0, 1.0 - (t - TL.SHOCK_HIT) / 0.25) * (1.0 + 2.5 * np.exp(-(t - TL.SHOCK_HIT) * 20))
    if TL.DARK_END <= t < TL.RELIT:
        x = (t - TL.DARK_END) / (TL.RELIT - TL.DARK_END)
        sputter = [(0.0, 0.08), (0.18, 0.3), (0.35, 0.42)]
        c = 0.0
        for a, b in sputter:
            if a <= x < b:
                c = 0.35 * np.sin(np.pi * (x - a) / (b - a))
        if x >= 0.45:
            c = smooth((x - 0.45) / 0.55) * 1.05
    if TL.RELIT <= t < 133.0:
        c = 1.0 + 0.15 * np.exp(-(t - TL.RELIT) * 2)
    return float(c)


def ping_list(t, center_fn, speed, kind=0, times=None, dur=4.0, inten=1.0):
    """Two shells per call (the two notes)."""
    out = []
    for t0 in (times if times is not None else TL.PROBE_PINGS):
        for k, dt in enumerate((0.0, TL.PING_NOTE_GAP)):
            a = t - (t0 + dt)
            if 0.0 <= a < dur:
                c = center_fn(t0 + dt)
                r = speed * a * (1.0 + 0.35 * np.exp(-a * 3))
                w = max(r * 0.06, speed * 0.02)
                fade = (1 - a / dur) ** 2 * (1.0 - np.exp(-a * 25))
                out.append((c, r, inten * fade * (1.0 if k == 0 else 0.8), w, kind))
    return out


# ------------------------------------------------------------------ state
def base_state(t):
    return dict(
        t=t, mode=0, exposure=1.0,
        cam_pos=V(0, 0, 0), cam_M=np.eye(3), fov=40.0,
        sun=SUN.copy(), sun_col=SUN_COL.copy(), star=1.0, neb=1.0,
        planet=False, pl_light=0.0,
        ring=False, ring_detail=0.0, ring_shadow=0.0, beacon=0.0, cascade=0.0,
        power=0.0, filaments=0.0, core_glow=0.0, portal=0.0, ripple=0.0,
        shock_r=0.0, shock_i=0.0,
        probe=False, probe_pos=V(0, 0, 0), probe_R=np.eye(3), core=core_level(t),
        probe_sun=1.0, glow_min_px=2.0,
        pings=[], vcore=norm(V(0.2, 0.1, 1.0)), vista=1.0,
        swarm=-1.0, swarm_far=0.0, tun=0.0, flash=0.0,
        fade=1.0, text=None, text_a=0.0, bloom=0.055, grain=0.035, ca=0.0,
    )


def probe_orient(yaw, pitch=0.0, roll=0.0):
    """world -> probe rotation (probe front = +z)."""
    R = rot_axis(V(0, 1, 0), yaw) @ rot_axis(V(1, 0, 0), pitch) @ rot_axis(V(0, 0, 1), roll)
    return R.T


def probe_orient_to(fwd, up=V(0, 1, 0), roll=0.0):
    M = look_at(V(0, 0, 0), fwd, up, roll)      # columns r,u,f in world
    # probe local: x right, y up, z front  -> world = M; world->probe = M.T
    return M.T


def sun_vis_from(pos, sun):
    """Soft visibility of the sun from a world point (planet occlusion)."""
    o = (pos - PL_C) / PL_R
    b = np.dot(o, sun)
    if b > 0:
        return 1.0
    ca = np.sqrt(max(np.dot(o, o) - b * b, 0.0))
    return float(smooth((ca - 0.985) / 0.03))


# ================================================================== shots
def shot_title(t, s):
    u = (t - 0.0) / 8.0
    s["cam_M"] = look_dir(norm(V(-0.62, 0.18, 0.78)) + V(0.03, 0.0, 0.0) * u, roll=0.02)
    s["fov"] = 38 - 3 * u
    s["star"] = ramp(t, 0.3, 4.0)
    s["neb"] = ramp(t, 0.3, 5.0)
    s["text"], s["text_a"] = "title", ramp(t, 1.5, 2.8) * (1 - ramp(t, 5.6, 7.0))
    s["fade"] = 1.0
    return s


# deep space, before the reveal: the probe is in the planet's shadow
DRIFT_DIR = norm(-0.55 * SUN + 0.6 * _w - 0.2 * _v)  # camera looks roughly away from planet


def drift_probe(t):
    u = clamp01((t - 8.0) / 12.0)
    far_dir = norm(DRIFT_DIR + 0.05 * _v - 0.06 * _w)
    near_dir = norm(DRIFT_DIR + 0.55 * _w - 0.12 * _v)
    d = np.exp(lerp(np.log(1.3), np.log(0.0075), u ** 1.15))
    return PROBE0 + norm(lerp(far_dir, near_dir, smooth((u - 0.5) / 0.5))) * d


def shot_drift(t, s):
    u = (t - 8.0) / 12.0
    cam = PROBE0
    p = drift_probe(t)
    tgt_far = drift_probe(8.0)
    aim = lerp(tgt_far, p, smooth((u - 0.55) / 0.45) * 0.6)
    s["cam_pos"] = cam
    s["cam_M"] = look_at(cam, aim, up=_v, roll=0.0)
    s["fov"] = 36.0
    s["planet"] = True
    s["probe"] = True
    s["probe_pos"] = p
    s["probe_R"] = probe_orient_to(norm(p - cam) * -1 + 0.4 * _w, up=_v, roll=0.3 + 0.4 * u)
    s["probe_sun"] = 0.0
    s["neb"] = 0.55
    s["fade"] = ramp(t, 8.0, 9.2)
    return s


CLOSE_C = PROBE0 + V(0, 0, 0)


def shot_closeup(t, s):
    u = (t - 20.0) / 12.0
    pc = PROBE0 + 0.006 * DRIFT_DIR  # probe hovers here
    ang = -0.9 + 0.7 * u
    dist = 0.0062 - 0.0008 * u
    off = (np.cos(ang) * DRIFT_DIR + np.sin(ang) * _w) * dist + _v * 0.0012
    cam = pc + off
    s["cam_pos"] = cam
    s["cam_M"] = look_at(cam, pc + _v * 0.0002 + 0.0008 * _w, up=_v)
    s["fov"] = 34.0
    s["planet"] = True
    s["probe"] = True
    s["probe_pos"] = pc
    # the eye scans: turns left, pauses, turns right, looks back to camera
    yaw = 0.6 * np.sin(u * 3.0) + 0.25
    look = norm(np.cos(yaw) * (cam - pc) / dist + np.sin(yaw) * _w + 0.1 * _v)
    s["probe_R"] = probe_orient_to(look, up=_v, roll=0.1)
    s["probe_sun"] = 0.0
    s["exposure"] = 0.8
    s["pings"] = ping_list(t, lambda t0: pc, speed=0.022, kind=0)
    return s


REVEAL_PC = PROBE0 + 0.006 * DRIFT_DIR


def reveal_sun(t):
    """Sun direction during the reveal: rises over the limb at TL.SUNRISE."""
    toP = norm(PL_C - REVEAL_PC)
    ax = norm(np.cross(toP, SUN))
    base = np.arccos(np.dot(SUN, toP))
    rho = np.degrees(np.arcsin(PL_R / np.linalg.norm(REVEAL_PC - PL_C)))
    u = (t - 32.0) / 18.0
    # angle (deg) from planet centre: hidden -> crosses the limb at SUNRISE -> clear
    x = (t - TL.SUNRISE) / 9.0
    ang = rho + 2.6 * np.tanh(x * 1.4) + 0.35
    return rot_axis(ax, np.radians(ang) - base) @ SUN


def shot_reveal(t, s):
    u = (t - 32.0) / 18.0
    pc = REVEAL_PC
    sun = reveal_sun(t)
    s["sun"] = sun
    toP = norm(PL_C - pc)
    perp = norm(sun - toP * np.dot(sun, toP))
    rho = np.arcsin(PL_R / np.linalg.norm(pc - PL_C))
    limb_dir = norm(np.cos(rho * 0.93) * toP + np.sin(rho * 0.93) * perp)
    # camera pulls back from 6 m to ~60 km, swinging to frame the limb as a horizon
    d = 0.006 * np.exp(np.log(60.0 / 0.006) * smoother(u * 1.05 - 0.02))
    back = norm(-toP + 0.35 * perp - 0.25 * np.cross(toP, perp))
    cam = pc + back * d
    k = smoother((u - 0.05) / 0.55)
    fwd = norm(lerp(norm(pc - cam), limb_dir, k))
    up = norm(lerp(_v, perp, smooth((u - 0.05) / 0.5)))
    s["cam_pos"] = cam
    s["cam_M"] = look_dir(fwd, up=up)
    s["fov"] = lerp(34.0, 24.0, smooth(u * 1.2))
    s["planet"] = True
    s["pl_light"] = 1.0
    s["probe"] = True
    s["probe_pos"] = pc
    s["probe_R"] = probe_orient_to(norm(toP + 0.2 * _v), up=_v, roll=0.1)
    s["probe_sun"] = sun_vis_from(pc, sun)
    s["glow_min_px"] = 2.5
    return s


def shot_approach(t, s):
    u = (t - 50.0) / 12.0
    # camera on the anti-sun side, looking sunward: the ring silhouettes against the lit crescent
    d = norm(-0.63 * SUN + 0.71 * _w - 0.30 * _v)
    side = norm(np.cross(d, RING_N))
    cam0 = RING_C + d * 30000
    cam = cam0 + (RING_C - cam0) * 0.18 * smooth(u)
    tgt = RING_C - side * 500
    s["cam_pos"] = cam
    s["cam_M"] = look_at(cam, tgt, up=RING_N, roll=0.03)
    s["fov"] = lerp(16.0, 14.0, u)
    s["planet"] = True
    s["ring"] = True
    # probe: a tiny light heading away from the camera toward the gate
    pd = norm(tgt - cam)
    pos = cam + pd * (0.4 + 3.0 * u) + side * 0.06 - RING_N * 0.03
    s["probe"] = True
    s["probe_pos"] = pos
    s["probe_R"] = probe_orient_to(pd, up=_v)
    s["glow_min_px"] = 2.5
    return s


def shot_ringreveal(t, s):
    u = (t - 62.0) / 14.0
    a0 = BEACON_ANG - 0.40
    # start below the ring plane, just outside the outer rim, looking along it; rise above
    a = a0 + 0.02 * u
    y = lerp(-70.0, 260.0, smoother(u))
    rad = lerp(160.0, 420.0, smooth(u))
    cam = RING_C + RING_M.T @ V(np.cos(a) * (RING_R + rad), y, np.sin(a) * (RING_R + rad))
    tan, inward, ax = ring_frame_at(a)
    look_pt = ring_point(a + lerp(0.18, 0.55, smooth(u)), rad=0.0, y=lerp(0.0, -40.0, u))
    s["cam_pos"] = cam
    s["cam_M"] = look_at(cam, look_pt, up=ax, roll=lerp(0.25, 0.0, smooth(u)))
    s["fov"] = lerp(42.0, 50.0, u)
    s["planet"] = True
    s["ring"] = True
    s["ring_detail"] = 0.0
    # probe crosses the foreground early for scale
    x = (t - 63.0) / 5.0
    fwd = norm(look_pt - cam)
    pp = cam + fwd * 0.05 + np.cross(fwd, ax) * lerp(-0.03, 0.035, x) - ax * 0.004
    s["probe"] = True
    s["probe_pos"] = pp
    s["probe_R"] = probe_orient_to(np.cross(fwd, ax), up=ax)
    s["probe_on_until"] = 68.5
    return s


def fly_ang(t):
    """Probe's ring angle along the flyover: fast, decelerating to the beacon."""
    T0, T1 = 76.0, 88.0
    x = clamp01((t - T0) / (T1 - T0))
    # travel ~ 260 km of arc, ease out
    dist = 260.0 * (1 - (1 - x) ** 2.2)
    return BEACON_ANG - (260.0 - dist) / RING_R + 0.0


def shot_flyover(t, s):
    ap = fly_ang(t)
    u = clamp01((t - 76.0) / 12.0)
    # high three-quarter chase: a tiny lamp streaking down a vast dead canyon,
    # camera descending toward it as it slows for the beacon
    lag = lerp(9.0, 2.2, smooth(u)) / RING_R
    ac = ap - lag
    shake = value_noise1(t * 2.0, 1.0)
    cam = ring_point(ac, h_above_floor=lerp(7.5, 1.6, smooth(u)) + 0.05 * shake,
                     y=lerp(-7.0, -2.5, smooth(u)))
    pp = ring_point(ap, h_above_floor=0.30 + 0.03 * np.sin(t * 1.1), y=0.8 + 0.25 * np.sin(t * 0.9))
    tan, up, ax = ring_frame_at(ac)
    look_pt = pp + ring_frame_at(ap)[0] * lerp(6.0, 1.5, smooth(u))
    s["cam_pos"] = cam
    s["cam_M"] = look_at(cam, look_pt, up=up, roll=0.04 * np.sin(t * 0.5) + 0.01 * shake)
    s["fov"] = 50.0
    s["planet"] = True
    s["ring"] = True
    s["ring_detail"] = 1.0
    s["ring_shadow"] = 1.0
    s["probe"] = True
    s["probe_pos"] = pp
    s["probe_R"] = probe_orient_to(ring_frame_at(ap)[0], up=up)
    s["glow_min_px"] = 9.0
    return s


def contact_probe(t):
    return ring_point(BEACON_ANG, h_above_floor=0.32 + 0.01 * np.sin(t * 1.3), y=0.0)


def beacon_pos():
    return ring_point(BEACON_ANG, h_above_floor=0.9 - 0.9, y=0.0) + ring_frame_at(BEACON_ANG)[1] * 0.02


def shot_contact(t, s):
    u = (t - 88.0) / 10.0
    tan, up, ax = ring_frame_at(BEACON_ANG)
    pc = contact_probe(t)
    cam = pc - tan * 1.25 + up * 0.18 + ax * 0.55 + tan * 0.08 * u
    s["cam_pos"] = cam
    s["cam_M"] = look_at(cam, pc - up * 0.12 + tan * 0.1, up=up)
    s["fov"] = 40.0
    s["planet"] = True
    s["ring"] = True
    s["ring_detail"] = 1.0
    s["ring_shadow"] = 1.0
    s["probe"] = True
    s["probe_pos"] = pc
    look = norm(-up + 0.2 * tan) if t < 95 else norm(-up * 0.5 + 0.5 * tan + 0.4 * (-norm(cam - pc)) * -1)
    s["probe_R"] = probe_orient_to(norm(lerp(tan, -up, smooth((t - 88.5) / 1.0))), up=up)
    s["pings"] = ping_list(t, contact_probe, speed=0.35, kind=0, dur=3.5, inten=0.35)
    s["pings"] += ping_list(t, lambda t0: beacon_pos(), speed=0.5, kind=1,
                            times=TL.BEACON_ANSWERS, dur=3.5, inten=0.5)
    s["beacon"] = beacon_level(t)
    s["glow_min_px"] = 7.0
    return s


def beacon_level(t):
    b = 0.0
    for a in TL.BEACON_ANSWERS:
        x = t - a
        if x >= 0:
            b = max(b, np.exp(-x * 1.2) * 1.0 + 0.25)
    if t >= TL.CASCADE_START:
        b = max(b, 0.6)
    return b


def cascade_level(t):
    if t < TL.CASCADE_START:
        return 0.0
    x = (t - TL.CASCADE_START) / (TL.CASCADE_MEET - TL.CASCADE_START)
    return float(np.pi * 1.02 * (x ** 1.7 if x < 1 else 1.0)) + 0.0005


def power_level(t):
    return float(0.35 * ramp(t, 106.0, 110.0) + 0.9 * ramp(t, TL.POWER_START, 121.0))


def shot_cascade(t, s):
    u = (t - 98.0) / 12.0
    tan, up, ax = ring_frame_at(BEACON_ANG)
    b = ring_point(BEACON_ANG)
    # start high above the beacon looking down the arc; crane back to see the whole ring
    k = smoother(u)
    # crane from above the beacon out to the approach viewpoint: whole ring against the lit crescent
    start = b + up * 250.0 + ax * 750.0 - tan * 300.0
    far_dir = norm(-0.63 * SUN + 0.71 * _w - 0.30 * _v)
    end = RING_C + far_dir * 15000.0
    cam = lerp(start, end, k ** 1.2)
    tgt = lerp(b + tan * 900 + up * 100, RING_C, smoother((u - 0.1) / 0.8))
    s["cam_pos"] = cam
    s["cam_M"] = look_at(cam, tgt, up=norm(lerp(up, RING_N, smooth((u - 0.2) / 0.6))))
    s["fov"] = lerp(50.0, 42.0, smooth(u))
    s["planet"] = True
    s["ring"] = True
    s["ring_detail"] = 0.0
    s["beacon"] = beacon_level(t)
    s["cascade"] = cascade_level(t)
    s["power"] = power_level(t)
    return s


def gate_cam_setup():
    """Camera/probe for the power-up + gate shots: above the ring plane near the rim."""
    a = BEACON_ANG
    tan, up, ax = ring_frame_at(a)
    pc = ring_point(a, h_above_floor=900.0, y=1500.0)
    return pc, tan, up, ax


def gate_probe(t):
    pc, tan, up, ax = gate_cam_setup()
    return pc + up * 0.015 - tan * 0.004


def shot_powerup(t, s):
    u = (t - 110.0) / 12.0
    pc, tan, up, ax = gate_cam_setup()
    probe = gate_probe(t)
    cam = probe - up * 0.009 + ax * 0.0022 + tan * 0.0015 - up * 0.004 * u
    s["cam_pos"] = cam
    s["cam_M"] = look_at(cam, RING_C + ax * 620, up=ax)
    s["fov"] = lerp(52.0, 46.0, smooth(u))
    s["planet"] = True
    s["ring"] = True
    s["beacon"] = 0.6
    s["cascade"] = cascade_level(t)
    s["power"] = power_level(t)
    s["filaments"] = ramp(t, 111.0, 115.0)
    s["core_glow"] = ramp(t, 112.0, 121.5) * 1.3
    s["ripple"] = ramp(t, 114.0, 120.0)
    s["probe"] = True
    s["probe_pos"] = probe
    s["probe_R"] = probe_orient_to(norm(RING_C - probe), up=ax)
    return s


def shot_gate(t, s):
    s = shot_powerup(t, s)
    pc, tan, up, ax = gate_cam_setup()
    s["filaments"] = 1.0 - ramp(t, 123.0, 124.5)
    s["core_glow"] = 1.3 * (1 - ramp(t, 122.8, 123.6)) + 2.5 * np.exp(-max(t - 122.8, 0) * 3) * (t > 122.8)
    s["portal"] = 0.98 * smoother((t - TL.PORTAL_TEAR) / 2.4) ** 0.7 if t > TL.PORTAL_TEAR else 0.0
    s["ripple"] = 1.0 - ramp(t, 123.0, 125.0)
    probe0 = gate_probe(t)
    cam_d = norm(RING_C - probe0)
    dist_c = np.linalg.norm(RING_C - probe0)
    if t > TL.SHOCK_START:
        r = (t - TL.SHOCK_START) / (TL.SHOCK_HIT - TL.SHOCK_START) * dist_c
        s["shock_r"] = r
        s["shock_i"] = 1.0 * np.exp(-max(t - TL.SHOCK_HIT, 0) * 2.0)
    # hit: probe tumbles backward, camera shakes
    probe = probe0
    R = s["probe_R"]
    if t > TL.SHOCK_HIT:
        a = t - TL.SHOCK_HIT
        push = 0.004 * (1 - np.exp(-a * 3)) + 0.0006 * a
        probe = probe0 - cam_d * push - ax * 0.0012 * (1 - np.exp(-a * 2))
        spin = 2.6 * (1 - np.exp(-a * 1.1))
        R = R @ rot_axis(V(1, 0.3, 0.2), spin).T
        s["flash"] = 1.8 * np.exp(-a * 9)
    s["probe_pos"] = probe
    s["probe_R"] = R
    cam = s["cam_pos"]
    if t > TL.SHOCK_HIT:
        a = t - TL.SHOCK_HIT
        amp = 0.0012 * np.exp(-a * 1.6)
        cam = cam + amp * V(value_noise1(t * 22, 1), value_noise1(t * 22, 2), value_noise1(t * 22, 3))
        s["cam_pos"] = cam
        s["cam_M"] = look_at(cam, RING_C + ax * 300 + 60 * amp / 0.0012 * V(value_noise1(t * 15, 4), value_noise1(t * 15, 5), 0), up=ax)
    s["power"] = power_level(t) * (1.0 + 0.6 * ramp(t, 122.8, 123.5)) * (1 - 0.3 * ramp(t, 126, 130))
    return s


def shot_dive(t, s):
    u = (t - 134.0) / 10.0
    pc, tan, up, ax = gate_cam_setup()
    start = gate_probe(134.0) - norm(RING_C - gate_probe(134.0)) * 0.006
    # travel into the portal centre: distance covered accelerates
    goal = RING_C + ax * 0.0
    x = u ** 2.6
    probe = lerp(start, goal, x * 0.985)
    dir_ = norm(goal - start)
    cam = probe - dir_ * lerp(0.012, 0.02, u) + ax * 0.003 + np.cross(dir_, ax) * 0.002
    s["cam_pos"] = cam
    s["cam_M"] = look_at(cam, probe + dir_ * 5.0, up=ax, roll=0.2 * smooth(u))
    s["fov"] = lerp(48.0, 60.0, smooth(u))
    s["planet"] = True
    s["ring"] = True
    s["beacon"] = 0.6
    s["cascade"] = np.pi
    s["power"] = 0.8
    s["portal"] = 0.98
    s["probe"] = True
    s["probe_pos"] = probe
    s["probe_R"] = probe_orient_to(dir_, up=ax, roll=0.3 * u)
    s["flash"] = 3.0 * ramp(t, 143.4, 144.0)
    return s


def shot_tunnel(t, s):
    u = (t - 144.0) / 6.0
    s["mode"] = 1
    s["tun"] = u
    s["cam_pos"] = V(0, 0, 0)
    s["cam_M"] = look_dir(V(0.0, 0.0, 1.0), roll=u * 0.9)
    s["fov"] = 62.0
    s["probe"] = True
    s["probe_pos"] = V(0.0, -0.0015, 0.012) + V(0.0006 * np.sin(t * 2), 0.0004 * np.sin(t * 1.3), 0)
    s["probe_R"] = probe_orient_to(V(0, 0, 1), roll=0.5 * np.sin(t))
    s["probe_sun"] = 0.0
    s["sun_col"] = V(0, 0, 0)
    s["flash"] = 3.0 * (1 - ramp(t, 144.0, 144.5)) + 4.0 * ramp(t, 148.8, TL.WHITEOUT)
    return s


def shot_arrival(t, s):
    u = (t - 150.0) / 16.0
    s["mode"] = 2
    s["sun_col"] = V(1.0, 0.85, 0.7) * 0.25
    s["sun"] = norm(V(0.3, 0.1, 1.0))
    vcore = norm(V(0.25, 0.05, 1.0))
    s["vcore"] = vcore
    pc = V(0, 0, 0)
    # close on the probe, then a vast pull back
    d = 0.007 * np.exp(np.log(9000.0 / 7.0) * smoother((t - 157.0) / 9.0))
    ang = 2.6 + 0.35 * u
    off = norm(V(np.sin(ang), 0.25 + 0.35 * smooth((t - 157) / 9), np.cos(ang)))
    cam = pc + off * d
    look = lerp(pc, pc + vcore * 5.0, smooth((t - 157.5) / 7.0) * 0.6)
    s["cam_pos"] = cam
    s["cam_M"] = look_at(cam, look, up=V(0, 1, 0))
    s["fov"] = lerp(40.0, 55.0, smooth((t - 157) / 9))
    s["probe"] = True
    s["probe_pos"] = pc
    s["probe_R"] = probe_orient_to(norm(vcore + V(0, 0.1, 0)), roll=0.05 * np.sin(t))
    s["probe_sun"] = 1.0
    s["pings"] = ping_list(t, lambda t0: pc, speed=0.03, kind=0, times=[TL.PROBE_PINGS[-1]])
    s["swarm"] = t - TL.SWARM_START
    s["swarm_far"] = ramp(t, 157.0, 164.0)
    s["flash"] = 5.0 * (1 - ramp(t, 150.0, 151.2))
    s["fade"] = 1 - ramp(t, *TL.FADE_OUT)
    s["glow_min_px"] = 1.5
    return s


def shot_credits(t, s):
    s["fade"] = 0.0
    s["star"] = 0.0
    s["neb"] = 0.0
    s["text"] = "credits"
    s["text_a"] = ramp(t, 166.8, 168.3) * (1 - ramp(t, 174.0, 175.6))
    return s


SHOT_FNS = {
    "title": shot_title, "drift": shot_drift, "closeup": shot_closeup,
    "reveal": shot_reveal, "approach": shot_approach, "ringreveal": shot_ringreveal,
    "flyover": shot_flyover, "contact": shot_contact, "cascade": shot_cascade,
    "powerup": shot_powerup, "gate": shot_gate, "dive": shot_dive,
    "tunnel": shot_tunnel, "arrival": shot_arrival, "credits": shot_credits,
}


def world_state(t, shot=None):
    if shot is None:
        shot = TL.shot_at(t)[1]
    else:
        # motion-blur sub-samples of a shot's first/last frame can fall just
        # outside it; clamp so shot curves never see u < 0 (x**1.x -> complex)
        a, b = next((a, b) for n, a, b in TL.SHOTS if n == shot)
        t = min(max(t, a), b)
    s = base_state(t)
    s = SHOT_FNS[shot](t, s)
    if "probe_on_until" in s and t > s["probe_on_until"]:
        s["probe"] = False
    return s


# ================================================================== uniforms
def _mat(M):
    return M


def finalize(s):
    cam = s["cam_pos"]
    u = {}
    u["uTime"] = s["t"]
    u["uMode"] = int(s["mode"])
    u["uExposure"] = s["exposure"]
    u["uCam"] = s["cam_M"]
    tan_half = np.tan(np.radians(s["fov"]) / 2)
    u["uTanHalf"] = tan_half
    u["uSunDir"] = s["sun"]
    u["uSunCol"] = s["sun_col"]
    u["uStarI"] = s["star"]
    u["uNebI"] = s["neb"]
    # planet
    u["uPlOn"] = 1.0 if s["planet"] else 0.0
    u["uPlRo"] = PL_ROT @ (cam - PL_C) / PL_R
    u["uPlRot"] = PL_ROT
    u["uPlR"] = PL_R
    u["uPlLight"] = s["pl_light"]
    # ring (anchored frame)
    u["uRgOn"] = 1.0 if s["ring"] else 0.0
    pc = RING_M @ (cam - RING_C)
    alpha = np.arctan2(pc[2], pc[0])
    ca, sa = np.cos(alpha), np.sin(alpha)
    A = np.array([[ca, 0, sa], [0, 1, 0], [-sa, 0, ca]])
    ARot = A @ RING_M

    def to_anch(w):
        return ARot @ (w - RING_C) - V(RING_R, 0, 0)

    u["uRgRot"] = ARot
    u["uRgRo"] = to_anch(cam)
    u["uRgR"] = RING_R
    u["uRgAnchor"] = alpha
    u["uRgUOff"] = np.mod(alpha * RING_R, PATTERN_P)
    u["uRgDetail"] = s["ring_detail"]
    u["uRgShadow"] = s["ring_shadow"]
    u["uBeaconAng"] = BEACON_ANG
    u["uBeacon"] = s["beacon"]
    u["uCascade"] = s["cascade"]
    u["uRgPower"] = s["power"]
    u["uFilaments"] = s["filaments"]
    u["uCoreGlow"] = s["core_glow"]
    u["uPortal"] = s["portal"]
    u["uRipple"] = s["ripple"]
    u["uShockR"] = s["shock_r"]
    u["uShockI"] = s["shock_i"]
    # probe
    u["uPbOn"] = 1.0 if s["probe"] else 0.0
    rel = s["probe_pos"] - cam
    u["uPbRo"] = s["probe_R"] @ (-rel) / PB_SCALE
    u["uPbRot"] = s["probe_R"]
    u["uPbScale"] = PB_SCALE
    u["uPbCore"] = s["core"]
    u["uPbPosW"] = rel
    u["uPbSun"] = s["probe_sun"]
    dist = np.linalg.norm(rel)
    pix = 2 * tan_half / REF_LINES
    base = PB_SCALE * 0.9
    u["uPbGlowSize"] = max(1.0, s["glow_min_px"] * pix * dist / base)
    u["uPbLightRg"] = to_anch(s["probe_pos"])
    # pings
    P = np.zeros((6, 4))
    PP = np.zeros((6, 4))
    for i, (c, r, inten, w, kind) in enumerate(s["pings"][:6]):
        P[i, :3] = c - cam
        P[i, 3] = r
        PP[i] = (inten, w, kind, 0)
    u["uPing"] = P
    u["uPingP"] = PP
    # vista
    u["uVCoreDir"] = s["vcore"]
    u["uVistaI"] = s["vista"]
    u["uSwarm"] = s["swarm"]
    u["uSwC"] = V(0, 0, 0) - cam if s["mode"] == 2 else V(0, 0, 0)
    u["uSwFar"] = s["swarm_far"]
    u["uTunT"] = s["tun"]
    u["uFlash"] = s["flash"]
    post = dict(fade=s["fade"], text=s["text"], text_a=s["text_a"], bloom=s["bloom"],
                grain=s["grain"], ca=s["ca"])
    return u, post
