"""Flick segmentation from movement shape alone (no target positions) and per-run flick metrics.

A flick = the biggest movement burst before a click. P is where the primary movement ends, F is where
the click lands. Signed correction s = ((F - P) . u) / |P - start|: positive means the primary stopped
short (underflick), negative means the hand came back (overflick).
"""
from __future__ import annotations

import numpy as np
from scipy.signal import find_peaks

from .trace import Grid, Trace, packet_rate, to_grid
from .tracking import tracking_metrics


def segment(grid: Grid, cfg: dict) -> tuple[list[dict], list[dict]]:
    """Returns (flicks, dropped). Dropped entries carry the reason, for the Lab view."""
    f, hz, v = cfg["flick"], grid.hz, grid.speed
    gap = f["min_click_gap_ms"] * hz / 1000
    look = int(f["max_flick_ms"] * hz / 1000)
    kept: list[dict] = []
    dropped: list[dict] = []
    prev = None
    for ic in (int(c) for c in grid.clicks):
        last, prev = prev, ic
        if last is not None and ic - last < gap:
            dropped.append({"click": ic, "reason": "double click"})
            continue
        lo = max(0 if last is None else last + 1, ic - look)
        if ic - lo < 5:
            dropped.append({"click": ic, "reason": "no movement"})
            continue
        pk = lo + int(np.argmax(v[lo:ic + 1]))
        vpeak = float(v[pk])
        if vpeak < f["onset_speed"]:
            dropped.append({"click": ic, "reason": "no movement"})
            continue
        j = pk                                    # walk back to where the hand was last still
        while j > lo and v[j] >= f["rest_speed"]:
            j -= 1
        start = j + int(np.nonzero(v[j:pk + 1] > f["onset_speed"])[0][0])
        thr = max(f["endpoint_frac"] * vpeak, f["rest_speed"])
        below = np.nonzero(v[pk:ic + 1] < thr)[0]
        if len(below):
            p = pk + int(below[0])
            while p < ic and v[p + 1] <= v[p]:    # slide to the speed minimum
                p += 1
        else:
            p = ic
        info = {"start": start, "peak": pk, "p": p, "click": ic}
        if v[ic] > f["max_click_speed_frac"] * vpeak:
            dropped.append({**info, "reason": "clicked mid-motion"})
            continue
        px, py = grid.x[p] - grid.x[start], grid.y[p] - grid.y[start]
        plen = float(np.hypot(px, py))
        if plen < f["min_travel_cm"]:
            dropped.append({**info, "reason": "too short"})
            continue
        cx, cy = grid.x[ic] - grid.x[p], grid.y[ic] - grid.y[p]
        s = float((cx * px + cy * py) / plen ** 2)
        tail = v[p:ic + 1]
        # distance: count quantisation twin-peaks on one bump once (corrections are >= 40 ms apart)
        ncorr = len(find_peaks(tail, prominence=f["correction_prominence"], distance=max(1, hz // 25))[0]) \
            if len(tail) > 2 else 0
        label = "over" if s < f["over_threshold"] else "under" if s > f["under_threshold"] else "on"
        kept.append({**info, "vpeak": vpeak, "length": plen, "s": s, "corrections": ncorr,
                     "t_correct_ms": (ic - p) * 1000.0 / hz, "label": label})
    return kept, dropped


def flick_metrics(flicks: list[dict], cfg: dict, duration: float) -> dict:
    n = len(flicks)
    if n == 0:
        return {"n": 0, "over_rate": 0.0, "under_rate": 0.0, "balance": 0.0, "median_s": 0.0, "mean_abs_s": 0.0,
                "corrections": 0.0, "t_correct_ms": 0.0, "cv_len": 0.0, "flicks_per_min": 0.0}
    s = np.array([k["s"] for k in flicks])
    length = np.array([k["length"] for k in flicks])
    over = float(np.mean(s < cfg["flick"]["over_threshold"]))
    under = float(np.mean(s > cfg["flick"]["under_threshold"]))
    return {"n": n, "over_rate": over, "under_rate": under, "balance": over - under,
            "median_s": float(np.median(s)), "mean_abs_s": float(np.mean(np.abs(s))),
            "corrections": float(np.mean([k["corrections"] for k in flicks])),
            "t_correct_ms": float(np.median([k["t_correct_ms"] for k in flicks])),
            "cv_len": float(length.std() / length.mean()) if length.mean() > 0 else 0.0,
            "flicks_per_min": n / max(duration, 1e-9) * 60.0}


def analyze_run(trace: Trace, kind: str, cfg: dict) -> dict:
    """Everything stored for a run. Pure function of (trace, kind, cfg), so it recomputes identically."""
    grid = to_grid(trace, cfg)
    flicks, dropped = segment(grid, cfg)
    out = {"kind": kind, "duration": trace.duration, "packets": int(len(trace.t)),
           "packet_rate": round(packet_rate(trace), 1), "clicks": int(len(trace.clicks)),
           "flick": flick_metrics(flicks, cfg, trace.duration), "s": [round(k["s"], 5) for k in flicks],
           "dropped": len(dropped)}
    if kind == "tracking":
        out["tracking"] = tracking_metrics(grid, cfg)
    return out
