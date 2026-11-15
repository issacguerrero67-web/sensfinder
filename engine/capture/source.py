"""Where mouse packets land. Sources (Raw Input on Windows, a fake one for CI and Demo mode) push into a
Recorder; the Recorder keeps a short ring for the live trail and the full trace while a run is recording.

Mouse deltas and left clicks only. No keystrokes, window titles or screen contents are ever captured.
"""
from __future__ import annotations

import sys
import threading
import time
from collections import deque

import numpy as np

from ..analysis.trace import Trace, polling_rate
from ..units import CM_PER_INCH


class Recorder:
    def __init__(self, clock=time.perf_counter):
        self.clock = clock
        self.lock = threading.Lock()
        self.ring: deque = deque(maxlen=24000)          # (t, dx, dy), about 6 s at 4000 Hz
        self.run: dict | None = None
        self.measure: dict | None = None
        self.paused = False
        self.paused_in_run = False
        self.packets = 0
        self.last_rate = 0.0

    def push(self, t: float, dx: int, dy: int, click: bool = False) -> None:
        with self.lock:
            if self.paused:
                return
            self.packets += 1
            if dx or dy:
                self.ring.append((t, dx, dy))
                if self.run is not None:
                    self.run["ev"].append((t, dx, dy))
                if self.measure is not None:
                    self.measure["x"] += dx
                    self.measure["y"] += dy
                    self.measure["n"] += 1
            if click and self.run is not None:
                self.run["clicks"].append(t)

    def set_paused(self, paused: bool) -> None:
        with self.lock:
            self.paused = paused
            if paused and self.run is not None:
                self.paused_in_run = True

    def start_run(self) -> None:
        with self.lock:
            self.run = {"t0": self.clock(), "ev": [], "clicks": []}
            self.paused_in_run = self.paused

    def stop_run(self, dpi: float, meta: dict | None = None) -> tuple[Trace, bool]:
        """(trace, partial). A run that was paused at any point is kept and marked partial, never discarded."""
        with self.lock:
            run, self.run = self.run, None
            partial = self.paused_in_run
        if run is None:
            return Trace([], [], [], [], dpi, 0.0, meta or {}), True
        ev = np.array(run["ev"], dtype=float).reshape(-1, 3)
        t0, dur = run["t0"], self.clock() - run["t0"]
        return Trace(ev[:, 0] - t0, ev[:, 1], ev[:, 2], np.array(run["clicks"]) - t0, dpi, dur, meta or {}), partial

    def measure_start(self) -> None:
        with self.lock:
            self.measure = {"x": 0, "y": 0, "n": 0, "t0": self.clock()}

    def measure_peek(self) -> dict:
        with self.lock:
            m = dict(self.measure or {"x": 0, "y": 0, "n": 0, "t0": self.clock()})
        m["seconds"] = self.clock() - m["t0"]
        return m

    def measure_stop(self) -> dict:
        m = self.measure_peek()
        with self.lock:
            self.measure = None
        return m

    def _recent(self, seconds: float) -> np.ndarray:
        cut = self.clock() - seconds
        with self.lock:
            ev = [e for e in self.ring if e[0] >= cut]
        return np.array(ev, dtype=float).reshape(-1, 3)

    def packet_rate(self) -> float:
        """Last measured polling rate. It only updates during movement fast enough to measure (see
        polling_rate), and keeps its value while the mouse rests instead of dropping to 0."""
        ev = self._recent(3.0)
        rate = polling_rate(ev[:, 0], ev[:, 1], ev[:, 2])
        if rate:
            self.last_rate = rate
        return self.last_rate

    def live(self, dpi: float, seconds: float = 2.0, step: float = 0.01) -> dict:
        ev = self._recent(seconds)
        n = int(seconds / step)
        k = CM_PER_INCH / dpi
        dx, dy = np.zeros(n), np.zeros(n)
        if len(ev):
            b = np.clip(((ev[:, 0] - (self.clock() - seconds)) / step).astype(np.int64), 0, n - 1)
            dx = np.bincount(b, weights=ev[:, 1], minlength=n) * k
            dy = np.bincount(b, weights=ev[:, 2], minlength=n) * k
        trail = np.c_[np.cumsum(dx), np.cumsum(dy)]
        return {"packet_rate": round(self.packet_rate(), 1), "packets": self.packets, "paused": self.paused,
                "trail": np.round(trail, 4).tolist(), "speed": np.round(np.hypot(dx, dy) / step, 2).tolist()}


class FakeSource:
    """Stand-in for Raw Input: used on non-Windows, in CI, and with SENSFINDER_FAKE_CAPTURE=1."""
    name = "fake"
    available = True
    error: str | None = None

    def __init__(self, recorder: Recorder):
        self.recorder = recorder

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def play(self, trace: Trace) -> None:
        """Feed a whole trace into the recorder as if it had just been moved, ending now."""
        t0 = self.recorder.clock() - trace.duration
        clicks = iter(sorted(trace.clicks))
        nxt = next(clicks, None)
        for t, dx, dy in zip(trace.t, trace.dx, trace.dy):
            while nxt is not None and nxt <= t:
                self.recorder.push(t0 + nxt, 0, 0, click=True)
                nxt = next(clicks, None)
            self.recorder.push(t0 + t, int(dx), int(dy))
        while nxt is not None:
            self.recorder.push(t0 + nxt, 0, 0, click=True)
            nxt = next(clicks, None)


def make_source(recorder: Recorder, fake: bool = False):
    if fake or sys.platform != "win32":
        return FakeSource(recorder)
    from .rawinput import RawInputSource
    return RawInputSource(recorder)


def fullscreen_app_running() -> bool:
    """True when Windows reports a fullscreen/D3D app in front. Uses the shell's notification state only:
    no window titles, no process list."""
    if sys.platform != "win32":
        return False
    import ctypes
    state = ctypes.c_int(0)
    try:
        if ctypes.windll.shell32.SHQueryUserNotificationState(ctypes.byref(state)) != 0:
            return False
    except Exception:
        return False
    return state.value in (2, 3, 4)          # QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE
