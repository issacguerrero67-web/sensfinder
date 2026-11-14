"""Synthetic player. Drives the tests and Demo mode; it is a model, not evidence about real aim.

Flicks: a minimum-jerk primary movement toward a random target whose gain depends on how far the sens is
from the player's optimum (too fast -> overshoot, too slow -> undershoot), signal-dependent noise, a pause,
then corrective submovements until the crosshair is on the target, then a click.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..analysis.trace import Trace
from ..units import CM_PER_INCH


@dataclass
class Player:
    cm_opt: float = 45.0
    kappa: float = 0.12              # over/undershoot strength away from the optimum
    noise: float = 0.10              # endpoint noise as a fraction of flick distance
    rushed: float = 0.04             # share of clicks fired mid-motion
    tremor_cm: float = 0.004
    target_radius_deg: float = 1.5
    bias: float = 0.0                # habitual undershoot at the optimum (0 = none)


def _tremor(n: int, hz: int, amp: float, rng, lo: float = 8.0, hi: float = 12.0) -> np.ndarray:
    t = np.arange(n) / hz
    out = np.zeros((n, 2))
    for _ in range(4):
        fq, ph = rng.uniform(lo, hi), rng.uniform(0, 2 * np.pi, 2)
        out[:, 0] += np.sin(2 * np.pi * fq * t + ph[0])
        out[:, 1] += np.sin(2 * np.pi * fq * t + ph[1])
    return out * amp / 2


def _to_trace(path: np.ndarray, clicks: list[float], hz: int, dpi: float, duration: float, rng, meta: dict) -> Trace:
    counts = np.round(path / CM_PER_INCH * dpi).astype(np.int64)
    d = np.diff(counts, axis=0, prepend=counts[:1])
    idx = np.nonzero(d.any(axis=1))[0]
    t = idx / hz + rng.uniform(0, 0.2 / hz, len(idx))        # receipt-time jitter
    return Trace(t, d[idx, 0], d[idx, 1], np.array(clicks), dpi, duration, meta)


def flick_run(player: Player, cm360: float, duration: float = 60.0, hz: int = 1000, dpi: float = 800,
              rng: np.random.Generator | None = None) -> Trace:
    rng = rng or np.random.default_rng()
    segs: list[np.ndarray] = []
    clicks: list[float] = []
    pos = np.zeros(2)
    n_total = 0

    def hold(T):
        nonlocal n_total
        n = max(1, int(T * hz))
        segs.append(np.repeat(pos[None], n, 0))
        n_total += n

    def move(vec, T):
        nonlocal pos, n_total
        n = max(2, int(T * hz))
        tau = np.arange(1, n + 1) / n
        segs.append(pos + (10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5)[:, None] * vec)
        pos = pos + vec
        n_total += n

    gain = (player.cm_opt / cm360) ** player.kappa * (1 - player.bias)
    radius = player.target_radius_deg / 360 * cm360
    while n_total / hz < duration - 1.5:
        hold(rng.uniform(0.15, 0.35))
        d = rng.uniform(10, 60) / 360 * cm360
        th = rng.uniform(0, 2 * np.pi)
        u = np.array([np.cos(th), np.sin(th)])
        target = pos + u * d
        before = n_total
        T1 = 0.09 + 0.05 * np.sqrt(d)
        move(u * d * gain * (1 + rng.normal(0, player.noise))
             + np.array([-u[1], u[0]]) * d * rng.normal(0, player.noise / 3), T1)
        if rng.random() < player.rushed:
            clicks.append((before + 0.5 * T1 * hz) / hz)
            continue
        for _ in range(2):
            err = target - pos
            if np.hypot(*err) <= radius:
                break
            hold(rng.uniform(0.06, 0.14))
            move(err * (1 + rng.normal(0, 0.15)), 0.08 + 0.05 * np.sqrt(np.hypot(*err)))
        hold(rng.uniform(0.03, 0.10))
        clicks.append(n_total / hz)
    hold(max(0.0, duration - n_total / hz))
    path = np.concatenate(segs)
    path += _tremor(len(path), hz, player.tremor_cm, rng)
    return _to_trace(path, clicks, hz, dpi, duration, rng, {"sim": "flick", "cm360": cm360})


def tracking_run(player: Player, cm360: float, duration: float = 60.0, hz: int = 1000, dpi: float = 800,
                 rng: np.random.Generator | None = None) -> Trace:
    rng = rng or np.random.default_rng()
    n = int(duration * hz)
    t = np.arange(n) / hz
    ang = np.zeros((n, 2))
    for amp, fq in ((18, 0.17), (9, 0.41), (5, 0.83)):
        ang[:, 0] += amp * np.sin(2 * np.pi * fq * rng.uniform(0.8, 1.2) * t + rng.uniform(0, 2 * np.pi))
    for amp, fq in ((3, 0.23), (2, 0.6)):
        ang[:, 1] += amp * np.sin(2 * np.pi * fq * rng.uniform(0.8, 1.2) * t + rng.uniform(0, 2 * np.pi))
    path = ang / 360 * cm360
    ratio = player.cm_opt / cm360
    # too fast: the hand over-corrects, a wobble that grows as cm/360 shrinks
    path += _tremor(n, hz, 0.035 * ratio ** 1.2, rng, 4.0, 9.0)
    # too slow: the hand falls behind and catches up in short jerks
    rate = 2.0 * max(0.0, float(np.log(cm360 / player.cm_opt)))
    m = int(0.08 * hz)
    tau = np.arange(1, m + 1) / m
    bump = 10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5
    for start in rng.integers(0, n - m, rng.poisson(rate * duration)):
        direction = np.sign(path[start + 1, 0] - path[start, 0]) or 1.0
        path[start:start + m, 0] += direction * 0.25 / ratio * bump
        path[start + m:, 0] += direction * 0.25 / ratio
    path += _tremor(n, hz, player.tremor_cm, rng)
    return _to_trace(path, [], hz, dpi, duration, rng, {"sim": "tracking", "cm360": cm360})
