"""Raw mouse trace + the fixed-window grid every metric is computed on.

Raw Input has no hardware timestamp, so single-event timing is not trusted: deltas are summed into
fixed windows (1 ms by default). That also makes 1000 Hz and 4000 Hz mice look the same downstream.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.ndimage import uniform_filter1d

from ..units import CM_PER_INCH


@dataclass
class Trace:
    t: np.ndarray            # seconds from run start, one per mouse packet
    dx: np.ndarray           # counts
    dy: np.ndarray
    clicks: np.ndarray       # seconds, left-button-down
    dpi: float = 800.0
    duration: float = 0.0
    meta: dict = field(default_factory=dict)

    def __post_init__(self):
        self.t = np.asarray(self.t, dtype=np.float64)
        self.dx = np.asarray(self.dx, dtype=np.int32)
        self.dy = np.asarray(self.dy, dtype=np.int32)
        self.clicks = np.asarray(self.clicks, dtype=np.float64)
        if not self.duration:
            self.duration = float(max(self.t.max(initial=0.0), self.clicks.max(initial=0.0)))

    def save(self, path: Path | str) -> None:
        info = json.dumps({"dpi": self.dpi, "duration": self.duration, "meta": self.meta})
        np.savez_compressed(path, t=self.t, dx=self.dx, dy=self.dy, clicks=self.clicks, info=info)

    @classmethod
    def load(cls, path: Path | str) -> "Trace":
        with np.load(path, allow_pickle=False) as z:
            info = json.loads(str(z["info"]))
            return cls(z["t"], z["dx"], z["dy"], z["clicks"], info["dpi"], info["duration"], info.get("meta", {}))


@dataclass
class Grid:
    hz: int
    x: np.ndarray            # cm, cumulative
    y: np.ndarray
    vx: np.ndarray           # cm/s, smoothed
    vy: np.ndarray
    speed: np.ndarray        # cm/s, smoothed
    clicks: np.ndarray       # grid indices


def to_grid(trace: Trace, cfg: dict) -> Grid:
    hz = int(cfg["preprocess"]["grid_hz"])
    n = max(int(np.ceil(trace.duration * hz)) + 1, 2)
    k = CM_PER_INCH / trace.dpi
    if len(trace.t):
        b = np.clip((trace.t * hz).astype(np.int64), 0, n - 1)
        dx = np.bincount(b, weights=trace.dx, minlength=n) * k
        dy = np.bincount(b, weights=trace.dy, minlength=n) * k
    else:
        dx = dy = np.zeros(n)
    w = max(1, round(cfg["preprocess"]["smooth_ms"] * hz / 1000))
    vx = uniform_filter1d(dx * hz, w, mode="nearest")
    vy = uniform_filter1d(dy * hz, w, mode="nearest")
    clicks = np.unique(np.clip((trace.clicks * hz).astype(np.int64), 0, n - 1))
    return Grid(hz, np.cumsum(dx), np.cumsum(dy), vx, vy, np.hypot(vx, vy), clicks)


def packet_rate(trace: Trace) -> float:
    """Measured packets per second while the mouse is moving (90th percentile of busy 20 ms windows)."""
    if len(trace.t) < 20:
        return 0.0
    bins = np.bincount((trace.t * 50).astype(np.int64))
    busy = bins[bins > 0]
    return float(np.percentile(busy, 90) * 50)
