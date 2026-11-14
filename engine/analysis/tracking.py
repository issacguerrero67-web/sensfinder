"""Tracking shakiness. No target needed; only compare within the same task across sens levels."""
from __future__ import annotations

import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import welch

from .trace import Grid


def tracking_metrics(grid: Grid, cfg: dict) -> dict:
    t, hz = cfg["tracking"], grid.hz
    moving_s = float((grid.speed > 0.5).sum() / hz)
    if moving_s < 2.0:
        return {"reversal_rate": 0.0, "band_share": 0.0, "norm_jerk": 0.0, "path_eff": 1.0, "moving_s": moving_s}

    # direction reversals on the dominant axis, both sides faster than reversal_speed
    va = grid.vx if np.abs(grid.vx).sum() >= np.abs(grid.vy).sum() else grid.vy
    nz = np.nonzero(va)[0]
    sgn = np.sign(va[nz])
    starts = np.r_[0, np.nonzero(np.diff(sgn) != 0)[0] + 1]
    peak = np.maximum.reduceat(np.abs(va[nz]), starts)
    rs = t["reversal_speed"]
    reversals = int(np.sum((peak[:-1] > rs) & (peak[1:] > rs)))

    # share of speed-signal power in the jitter band
    f, p = welch(grid.speed - grid.speed.mean(), fs=hz, nperseg=min(len(grid.speed), 2048))
    total = p[(f >= 0.5) & (f <= 40)].sum()
    band = p[(f >= t["band_lo_hz"]) & (f <= t["band_hi_hz"])].sum()

    # windowed path efficiency and normalized jerk
    w = max(2, int(t["window_ms"] * hz / 1000))
    nwin = (len(grid.x) - 2) // w
    eff, jerk = [], []
    if nwin > 0:
        cut = nwin * w
        path = (grid.speed[:cut] / hz).reshape(nwin, w).sum(1)
        ends = np.arange(1, nwin + 1) * w - 1
        begins = ends - (w - 1)
        net = np.hypot(grid.x[ends] - grid.x[begins], grid.y[ends] - grid.y[begins])
        ok = path > t["min_window_path_cm"]
        eff = np.minimum(net[ok] / path[ok], 1.0)
        # Jerk is differentiated at 100 Hz from extra-smoothed velocity. At the full grid rate the second
        # difference is pure count-quantisation noise and hides real wobble.
        step = max(1, hz // 100)
        fs = hz / step
        sx = uniform_filter1d(grid.vx, 4 * step, mode="nearest")[::step]
        sy = uniform_filter1d(grid.vy, 4 * step, mode="nearest")[::step]
        j2s = (np.diff(sx, 2) ** 2 + np.diff(sy, 2) ** 2) * fs ** 4 / fs
        per = w // step
        j2 = j2s[:nwin * per].reshape(-1, per).sum(1)
        T = w / hz
        ok_j = ok[:len(j2)]
        jerk = np.log10(j2[ok_j] * T ** 5 / path[:len(j2)][ok_j] ** 2 + 1e-12)
    return {"reversal_rate": reversals / moving_s,
            "band_share": float(band / total) if total > 0 else 0.0,
            "norm_jerk": float(np.median(jerk)) if len(jerk) else 0.0,
            "path_eff": float(np.median(eff)) if len(eff) else 1.0,
            "moving_s": moving_s}


SHAKE_KEYS = (("reversal_rate", 1), ("band_share", 1), ("norm_jerk", 1), ("path_eff", -1))


def shake_scores(per_level: list[dict]) -> np.ndarray:
    """One composite number per level: mean z-score across the four metrics (higher = shakier)."""
    z = []
    for key, sign in SHAKE_KEYS:
        v = np.array([m[key] for m in per_level], dtype=float) * sign
        sd = v.std()
        z.append((v - v.mean()) / sd if sd > 1e-12 else np.zeros_like(v))
    return np.mean(z, axis=0)
