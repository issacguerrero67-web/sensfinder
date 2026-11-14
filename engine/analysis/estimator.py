"""Balance-point estimator.

Overflick rate minus underflick rate (b) should rise as cm/360 falls, and the median signed correction
should rise as cm/360 rises. Both are fitted as monotone trends against ln(cm/360); where they cross
zero is the balance point. The interval comes from resampling flicks inside each level.

The optimum is a broad plateau, so the output is a range plus a best pick, never one "perfect" number.
"""
from __future__ import annotations

import numpy as np

from .tracking import shake_scores

MIN_SLOPE_B = 0.10        # atanh(b) per e-fold of cm/360; flatter than this = no usable trend
MIN_SLOPE_S = 0.01        # median s per e-fold
EXTRAPOLATE = float(np.log(1.25))   # never place the balance more than 25% outside what was tested


def _wls_zero(x: np.ndarray, y: np.ndarray, w: np.ndarray):
    """Weighted line fit of y (..., L) on x (L,). Returns (slope, x where the line crosses zero)."""
    xm = (w * x).sum() / w.sum()
    ym = (y * w).sum(-1) / w.sum()
    dx = w * (x - xm)
    slope = ((y - ym[..., None]) * dx).sum(-1) / (dx * (x - xm)).sum()
    with np.errstate(divide="ignore", invalid="ignore"):
        zero = xm - ym / slope
    return slope, zero


def _balance_x(x, over, under, med, w, e) -> np.ndarray:
    zb = np.arctanh(np.clip(over - under, -0.95, 0.95)) - np.arctanh(e["balance_target"])
    sb, xb = _wls_zero(x, zb, w)
    ss, xs = _wls_zero(x, med, w)
    okb, oks = sb < -MIN_SLOPE_B, ss > MIN_SLOPE_S
    wb = e["weight_balance"]
    out = np.where(okb & oks, wb * xb + (1 - wb) * xs, np.where(okb, xb, np.where(oks, xs, np.nan)))
    return np.clip(out, x.min() - EXTRAPOLATE, x.max() + EXTRAPOLATE)


def _mean_tracking(runs: list[dict]) -> dict:
    return {k: float(np.mean([r[k] for r in runs])) for k in runs[0]}


def estimate(levels: list[dict], cfg: dict, rng: np.random.Generator | None = None,
             start_cm: float | None = None) -> dict:
    """levels: [{"cm360": float, "s": [signed corrections], "weight": float, "tracking": [metric dicts]}]."""
    e, f = cfg["estimator"], cfg["flick"]
    rng = rng or np.random.default_rng(0)
    levels = sorted(levels, key=lambda l: l["cm360"])
    ot, ut = f["over_threshold"], f["under_threshold"]
    table = []
    for l in levels:
        s = np.asarray(l["s"], dtype=float)
        row = {"cm360": l["cm360"], "n": int(len(s)), "weight": float(l.get("weight", 1.0)),
               "over_rate": 0.0, "under_rate": 0.0, "balance": 0.0, "median_s": 0.0, "shake": None}
        if len(s):
            row.update(over_rate=float(np.mean(s < ot)), under_rate=float(np.mean(s > ut)),
                       median_s=float(np.median(s)))
            row["balance"] = row["over_rate"] - row["under_rate"]
        table.append(row)

    tracked = [i for i, l in enumerate(levels) if l.get("tracking")]
    if len(tracked) >= 3:
        for i, sc in zip(tracked, shake_scores([_mean_tracking(levels[i]["tracking"]) for i in tracked])):
            table[i]["shake"] = float(sc)

    cms = [l["cm360"] for l in levels] or [start_cm or 50.0]
    fallback = float(start_cm or np.exp(np.mean(np.log(cms))))
    out = {"levels": table, "tested": [float(min(cms)), float(max(cms))], "method": "v1.0 beta method",
           "trend": False, "pick_cm": fallback, "balance_cm": None, "shake_cm": None,
           "lo_cm": float(min(min(cms), fallback * 0.9)), "hi_cm": float(max(max(cms), fallback * 1.1)),
           "halfwidth": None, "confidence": "Low", "fill": 0.05, "inside": True, "notes": []}

    used = [i for i, l in enumerate(levels) if len(l["s"]) >= e["min_flicks_per_level"]]
    if len(used) < 2:
        out["notes"].append("Not enough flicks yet to see a trend.")
        return out

    x = np.log([levels[i]["cm360"] for i in used])
    w = np.array([table[i]["n"] * table[i]["weight"] for i in used], dtype=float)
    point = float(_balance_x(x, np.array([table[i]["over_rate"] for i in used]),
                             np.array([table[i]["under_rate"] for i in used]),
                             np.array([table[i]["median_s"] for i in used]), w, e))
    B = int(e["bootstrap"])
    over, under, med = (np.empty((B, len(used))) for _ in range(3))
    for j, i in enumerate(used):
        s = np.asarray(levels[i]["s"], dtype=float)
        sb = s[rng.integers(0, len(s), (B, len(s)))]
        over[:, j], under[:, j], med[:, j] = (sb < ot).mean(1), (sb > ut).mean(1), np.median(sb, 1)
    boot = _balance_x(x, over, under, med, w, e)
    valid = boot[np.isfinite(boot)]
    if len(valid) < 0.5 * B or not np.isfinite(point):
        out["notes"].append("Overflicks and underflicks didn't change much across these sens levels, "
                            "so there's no clear balance point. Staying near your current sens.")
        return out

    lo, hi = np.percentile(valid, [5, 95])
    in_lo, in_hi = np.percentile(valid, [16, 84])
    pick_x = point
    out["balance_cm"] = float(np.exp(point))

    shaken = [(np.log(r["cm360"]), r["shake"]) for r in table if r["shake"] is not None]
    if len(shaken) >= 3:                       # supporting evidence: lean toward the calmer side, inside the range
        sx, sy = np.array(shaken).T
        a, b, c = np.polyfit(sx, sy, 2)
        vertex = -b / (2 * a) if a > 1e-9 else sx[np.argmin(a * sx ** 2 + b * sx + c)]
        shake_x = float(np.clip(vertex, sx.min(), sx.max()))
        out["shake_cm"] = float(np.exp(shake_x))
        pick_x = point + e["shake_pull"] * (float(np.clip(shake_x, in_lo, in_hi)) - point)

    pick = float(np.exp(pick_x))
    half = float((np.exp(hi) - np.exp(lo)) / (2 * pick))
    m = e["min_display_halfwidth"]
    inside = bool(x.min() <= point <= x.max())
    enough = sum(table[i]["n"] >= e["locked_min_flicks"] for i in used)
    if half <= e["locked_halfwidth"] and enough >= e["locked_min_levels"] and inside and len(valid) >= 0.9 * B:
        conf = "Locked in"
    elif half <= e["ok_halfwidth"]:
        conf = "OK"
    else:
        conf = "Low"
    if not inside:
        out["notes"].append("The balance point sits at the edge of what was tested, so treat this as a direction.")
    out.update(trend=True, pick_cm=pick, lo_cm=float(min(np.exp(lo), pick * (1 - m))),
               hi_cm=float(max(np.exp(hi), pick * (1 + m))), halfwidth=half, confidence=conf,
               fill=float(np.clip(1 - (half - 0.06) / 0.44, 0.05, 1.0)), inside=inside,
               valid_share=float(len(valid) / B))
    return out


def confirm(pick_runs: list[dict], current_runs: list[dict], tol: float = 0.05) -> dict:
    """Stage 3: the pick is accepted only if flick error and shakiness are no worse than at the current sens.

    Each run is a flick-metrics dict. Error = mean |signed correction|, shakiness = corrections per flick.
    """
    def avg(runs, key):
        ws = [r["n"] for r in runs]
        return float(np.average([r[key] for r in runs], weights=ws)) if sum(ws) else 0.0

    pe, ce = avg(pick_runs, "mean_abs_s"), avg(current_runs, "mean_abs_s")
    pc, cc = avg(pick_runs, "corrections"), avg(current_runs, "corrections")
    worse = []
    if pe > ce * (1 + tol) + 0.002:
        worse.append("flick error")
    if pc > cc * (1 + tol) + 0.02:
        worse.append("corrections per flick")
    return {"accept": not worse, "worse": worse, "pick_error": pe, "current_error": ce,
            "pick_corrections": pc, "current_corrections": cc}


def fatigue(runs: list[dict], cfg: dict) -> dict:
    """runs: [{"t_min", "cm360", "flicks_per_min", "mean_abs_s"}] for scored flick runs, in time order.

    Fits speed and error against time with ln(cm/360) as a covariate, so the sens level itself isn't blamed.
    """
    out = {"flag": False, "speed_pct_per_10min": 0.0, "error_pct_per_10min": 0.0}
    runs = [r for r in runs if r["flicks_per_min"] > 0 and r["mean_abs_s"] > 0]
    if len(runs) < 5:
        return out
    t = np.array([r["t_min"] for r in runs])
    A = np.c_[np.ones(len(runs)), t, np.log([r["cm360"] for r in runs])]
    sp = np.linalg.lstsq(A, np.log([r["flicks_per_min"] for r in runs]), rcond=None)[0][1]
    er = np.linalg.lstsq(A, np.log([r["mean_abs_s"] for r in runs]), rcond=None)[0][1]
    out["speed_pct_per_10min"] = float((np.exp(sp * 10) - 1) * 100)
    out["error_pct_per_10min"] = float((np.exp(er * 10) - 1) * 100)
    thr = cfg["fatigue"]["drop_pct_per_10min"]
    out["flag"] = bool(out["speed_pct_per_10min"] <= -thr and out["error_pct_per_10min"] >= thr)
    return out


def fatigue_weight(t_min: float, t_first: float, fat: dict, cfg: dict) -> float:
    """Later blocks count less once fatigue is flagged."""
    if not fat["flag"]:
        return 1.0
    drop = abs(fat["speed_pct_per_10min"]) / 100.0 / 10.0
    return float(max(cfg["fatigue"]["min_weight"], 1.0 - drop * max(0.0, t_min - t_first)))
