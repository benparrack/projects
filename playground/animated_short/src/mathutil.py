import numpy as np


def V(*a):
    return np.array(a, dtype=np.float64)


def norm(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def clamp01(x):
    return min(max(x, 0.0), 1.0)


def smooth(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def smoother(x):
    x = clamp01(x)
    return x * x * x * (x * (6 * x - 15) + 10)


def ramp(t, a, b):
    """0 before a, 1 after b, smoothstep in between."""
    if b == a:
        return 1.0 if t >= a else 0.0
    return smooth((t - a) / (b - a))


def lerp(a, b, x):
    return a + (b - a) * x


def rot_axis(axis, ang):
    k = norm(axis)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * (K @ K)


def look_at(pos, target, up=(0, 1, 0), roll=0.0):
    """Camera basis as columns (right, up, forward)."""
    f = norm(np.asarray(target, float) - np.asarray(pos, float))
    r = norm(np.cross(f, up))
    u = np.cross(r, f)
    if roll:
        R = rot_axis(f, roll)
        r, u = R @ r, R @ u
    return np.column_stack([r, u, f])


def look_dir(f, up=(0, 1, 0), roll=0.0):
    return look_at(np.zeros(3), f, up, roll)


def spline(keys, t):
    """Cubic Hermite through (time, value) keys with Catmull-Rom tangents
    (non-uniform), zero tangent at the ends (eases in/out)."""
    ts = [k[0] for k in keys]
    ps = [np.asarray(k[1], dtype=np.float64) for k in keys]
    if t <= ts[0]:
        return ps[0].copy()
    if t >= ts[-1]:
        return ps[-1].copy()
    i = 0
    while ts[i + 1] < t:
        i += 1
    n = len(keys)

    def tangent(j):
        if j == 0 or j == n - 1:
            return ps[j] * 0.0
        return (ps[j + 1] - ps[j - 1]) / (ts[j + 1] - ts[j - 1])

    h = ts[i + 1] - ts[i]
    s = (t - ts[i]) / h
    m0, m1 = tangent(i) * h, tangent(i + 1) * h
    s2, s3 = s * s, s * s * s
    return ((2 * s3 - 3 * s2 + 1) * ps[i] + (s3 - 2 * s2 + s) * m0
            + (-2 * s3 + 3 * s2) * ps[i + 1] + (s3 - s2) * m1)


def halton(i, b):
    f, r = 1.0, 0.0
    while i > 0:
        f /= b
        r += f * (i % b)
        i //= b
    return r


def value_noise1(x, seed=0.0):
    """Smooth deterministic 1D noise in [-1,1] (for camera shake / flicker)."""
    def h(n):
        return (np.sin(n * 127.1 + seed * 311.7) * 43758.5453) % 1.0
    i = np.floor(x)
    f = x - i
    u = f * f * (3 - 2 * f)
    return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1
