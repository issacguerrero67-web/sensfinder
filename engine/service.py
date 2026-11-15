"""The engine behind the API: settings, capture, the live session, storage, Lab, exports.

Everything the hotkeys and the HTTP routes do goes through one Engine object and one lock.
No network calls are made from here except, when the user turns it on, the local Ollama on 127.0.0.1.
"""
from __future__ import annotations

import getpass
import json
import logging
import os
import sys
import threading
import time
import webbrowser
import zipfile
from dataclasses import replace
from datetime import datetime, timedelta
from logging.handlers import RotatingFileHandler
from pathlib import Path

import numpy as np

from . import __version__, config
from .analysis.flicks import analyze_run, flick_metrics, segment
from .analysis.trace import Trace, to_grid
from .capture.hotkeys import DEFAULTS as HOTKEY_DEFAULTS
from .capture.hotkeys import Hotkeys, parse
from .capture.source import Recorder, make_source
from .session.runner import Session, VirtualClock, sim_result
from .session.scheduler import TIERS
from .sim.player import Player
from .storage.db import DB, now_iso
from .units import CM_PER_INCH, CS2_YAW, cm360, dpi_from_swipe, snap_dpi, yaw_from_calibration

RELEASES_URL = "https://github.com/issacguerrero67-web/sensfinder/releases"
log = logging.getLogger("sensfinder")

SLIDERS = [  # (section, key, label, unit, min, max, step)
    ("flick", "onset_speed", "Flick starts above", "cm/s", 5, 40, 1),
    ("flick", "rest_speed", "Hand is still below", "cm/s", 1, 10, 0.5),
    ("flick", "min_travel_cm", "Shortest flick", "cm", 0.5, 4, 0.1),
    ("flick", "min_click_gap_ms", "Ignore clicks closer than", "ms", 50, 300, 10),
    ("flick", "endpoint_frac", "Primary ends below share of peak", "", 0.05, 0.3, 0.01),
    ("flick", "max_click_speed_frac", "Drop if still moving at click", "", 0.1, 0.6, 0.05),
    ("flick", "over_threshold", "Overflick below", "", -0.1, -0.01, 0.005),
    ("flick", "under_threshold", "Underflick above", "", 0.01, 0.1, 0.005),
    ("preprocess", "smooth_ms", "Speed smoothing", "ms", 5, 40, 1),
]


# Windows 11 hands background raw-input listeners about 125 packets/s no matter what the mouse is set to
# (measured 2026-11-14: 988/s in front vs 122-130/s behind, unchanged by power-throttling opt-outs).
# Sensfinder always listens from the background, so ~125 is normal and only a rate below that is a problem.
WINDOWS_BACKGROUND_CAP = 125.0


def low_rate(rate: float, polling_hz: float) -> bool:
    return bool(0 < rate < min(0.5 * polling_hz, 0.8 * WINDOWS_BACKGROUND_CAP))


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def default_data_dir() -> Path:
    """v1 keeps its own data out of the beta's data/ folder (that one is read-only to us)."""
    if os.environ.get("SENSFINDER_DATA_DIR"):
        return Path(os.environ["SENSFINDER_DATA_DIR"])
    base = os.environ.get("LOCALAPPDATA") if sys.platform == "win32" else None
    return (Path(base) if base else Path.home() / ".local" / "share") / "Sensfinder" / "data"


def default_beta_dir() -> Path:
    here = Path(__file__).resolve().parents[1] / "data"
    return here if (here / "trials.csv").exists() else Path.home() / "Documents" / "projects" / "sensfinder" / "data"


def default_settings() -> dict:
    return {"first_run_done": False, "game": "cs2", "hero_class": None, "dpi": 800, "polling_hz": 1000,
            "sens": 1.0, "yaw": CS2_YAW, "rivals_yaw": None, "sens_change_s": 60.0,
            "hotkeys": dict(HOTKEY_DEFAULTS), "accent": "#7C5CFF", "reduce_motion": False,
            "screenshots_dir": str(Path.home() / "Pictures" / "Screenshots"), "watch_screenshots": False,
            "ollama": {"enabled": False, "model": "qwen3-vl:8b", "allow_while_gaming": False},
            "beta_dir": str(default_beta_dir()), "demo_player": None}


class DemoClock(VirtualClock):
    """Session time for Demo mode: runs `scale` times faster than real time while a block is playing."""

    def __init__(self, scale: float):
        super().__init__()
        self.scale, self.since = scale, None

    def __call__(self) -> float:
        return self.now + ((time.perf_counter() - self.since) * self.scale if self.since is not None else 0.0)

    def start(self) -> None:
        self.since = time.perf_counter()

    def stop(self) -> None:
        self.now, self.since = self(), None


def scrub(text: str) -> str:
    """Remove the user's home path and account name from diagnostics."""
    home, user = str(Path.home()), getpass.getuser()
    for a, b in ((home, "%USERPROFILE%"), (home.replace("\\", "/"), "%USERPROFILE%"),
                 (home.replace("\\", "\\\\"), "%USERPROFILE%"), (user, "%USERNAME%")):
        if a:
            text = text.replace(a, b)
    return text


class Engine:
    def __init__(self, data_dir: Path | str | None = None, fake_capture: bool = False, demo_scale: float = 20.0,
                 start_io: bool = True):
        self.dir = Path(data_dir) if data_dir else default_data_dir()
        for sub in ("runs", "logs", "cfg", "diagnostics"):
            (self.dir / sub).mkdir(parents=True, exist_ok=True)
        if not log.handlers:
            h = RotatingFileHandler(self.dir / "logs" / "engine.log", maxBytes=2_000_000, backupCount=5,
                                    encoding="utf-8")
            h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
            log.addHandler(h)
            log.setLevel(logging.INFO)
        self.db = DB(self.dir / "sensfinder.db")
        self.user_cfg = self.dir / "metrics.toml"
        self.cfg = config.load(self.user_cfg)
        self.recorder = Recorder()
        self.source = make_source(self.recorder, fake_capture or os.environ.get("SENSFINDER_FAKE_CAPTURE") == "1")
        self.hotkeys = Hotkeys(self.on_hotkey)
        self.lock = threading.RLock()
        self.demo_scale = demo_scale
        self.session: Session | None = None
        self.session_id: int | None = None
        self.session_started = ""
        self.verdict_id: int | None = None
        self.clock = None
        self.player: Player | None = None
        self.rng = np.random.default_rng()
        self.timer: threading.Timer | None = None
        self.remaining: float | None = None
        self.last_run: dict | None = None
        self.toasts: list[dict] = []
        self.test = {"state": "idle", "until": 0.0, "seconds": 5.0, "result": None}
        self.watcher = None
        self.opener = self._open
        if start_io:
            self.source.start()
            self.hotkeys.start(self.settings()["hotkeys"])
            self._sync_watcher()
        log.info("engine started v%s capture=%s", __version__, self.source.name)

    def close(self) -> None:
        with self.lock:
            if self.timer:
                self.timer.cancel()
        self.hotkeys.stop()
        self.source.stop()
        if self.watcher:
            self.watcher.stop()

    # ---------- settings / status ----------
    def settings(self) -> dict:
        s = default_settings()
        stored = self.db.get_json("settings", {})
        for k, v in stored.items():
            if isinstance(s.get(k), dict) and isinstance(v, dict):
                s[k].update(v)
            elif k in s:
                s[k] = v
        return s

    def put_settings(self, patch: dict) -> dict:
        s = self.settings()
        for k, v in patch.items():
            if k not in s:
                continue
            if isinstance(s[k], dict) and isinstance(v, dict):
                s[k].update({a: b for a, b in v.items() if a in s[k]})
            else:
                s[k] = v
        if s["game"] not in ("cs2", "rivals"):
            raise ApiError(400, "Game must be CS2 or Marvel Rivals.")
        for key in ("dpi", "sens", "polling_hz", "sens_change_s"):
            if not isinstance(s[key], (int, float)) or s[key] <= 0:
                raise ApiError(400, f"{key} has to be a positive number.")
        try:
            combos = [parse(c) for c in s["hotkeys"].values()]
        except ValueError as e:
            raise ApiError(400, str(e)) from e
        if len(set(combos)) != len(combos):
            raise ApiError(400, "Two hotkeys use the same keys.")
        self.db.set_json("settings", s)
        self.hotkeys.start(s["hotkeys"])
        self._sync_watcher()
        return s

    def toast(self, kind: str, text: str) -> None:
        nxt = (self.toasts[-1]["id"] + 1) if self.toasts else 1
        self.toasts = (self.toasts + [{"id": nxt, "kind": kind, "text": text}])[-10:]

    def status(self) -> dict:
        s = self.settings()
        rate = self.recorder.packet_rate()
        beta = self.beta()
        return {"version": __version__, "method": "v1.0 beta method",
                "capture": {"available": bool(self.source.available), "source": self.source.name,
                            "paused": self.recorder.paused, "packet_rate": round(rate, 1),
                            "low_rate": low_rate(rate, s["polling_hz"]), "error": self.source.error},
                "hotkeys": self.hotkeys.status(), "first_run_done": s["first_run_done"],
                "beta": {"available": beta["available"], "rows": beta["rows"], "imported": beta["imported"]},
                "session_active": self.session is not None, "data_dir": str(self.dir), "toasts": self.toasts}

    def _open(self, target: str) -> None:
        if target.startswith("http"):
            webbrowser.open(target)
        elif sys.platform == "win32":
            os.startfile(target)                          # noqa: S606 - opens a folder in Explorer

    def open(self, what: str) -> dict:
        targets = {"data": str(self.dir), "cfg": str(self.dir / "cfg"), "releases": RELEASES_URL,
                   "screenshots": self.settings()["screenshots_dir"]}
        if what not in targets:
            raise ApiError(400, "Don't know how to open that.")
        if not targets[what].startswith("http") and not Path(targets[what]).is_dir():
            raise ApiError(404, "That folder doesn't exist yet.")
        self.opener(targets[what])
        return {"ok": True}

    def export_diagnostics(self) -> dict:
        path = self.dir / "diagnostics" / f"sensfinder-diagnostics-{datetime.now():%Y%m%d-%H%M%S}.zip"
        st = self.status()
        st.pop("toasts", None)
        info = {"status": st, "settings": self.settings(), "platform": sys.platform, "python": sys.version,
                "runs": self.db.q("SELECT COUNT(*) AS n FROM runs")[0]["n"]}
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("info.json", scrub(json.dumps(info, indent=1)))
            for f in sorted((self.dir / "logs").glob("*.log*")):
                z.writestr(f"logs/{f.name}", scrub(f.read_text(encoding="utf-8", errors="replace")))
        return {"path": str(path)}

    # ---------- capture + wizards ----------
    def live(self) -> dict:
        return self.recorder.live(self.settings()["dpi"])

    def set_capture_paused(self, paused: bool) -> dict:
        self.recorder.set_paused(bool(paused))
        return {"paused": self.recorder.paused}

    def capture_test_start(self, seconds: float = 5.0) -> dict:
        seconds = float(min(max(seconds, 1.0), 30.0))
        self.recorder.measure_start()
        self.test = {"state": "running", "until": time.perf_counter() + seconds, "seconds": seconds, "result": None}
        return self.capture_test()

    def capture_test(self) -> dict:
        t = self.test
        if t["state"] == "idle":
            return {"state": "idle", "seconds_left": 0.0, "packets": 0, "packet_rate": 0.0, "distance_cm": 0.0,
                    "ok": False, "message": ""}
        if t["state"] == "running":
            m = self.recorder.measure_peek()
            left = t["until"] - time.perf_counter()
            dist = float(np.hypot(m["x"], m["y"]) / self.settings()["dpi"] * CM_PER_INCH)
            rate = self.recorder.packet_rate()
            if left > 0:
                return {"state": "running", "seconds_left": round(left, 2), "packets": m["n"],
                        "packet_rate": round(rate, 1), "distance_cm": round(dist, 2), "ok": m["n"] > 0,
                        "message": ""}
            self.recorder.measure_stop()
            ok = m["n"] >= 50
            if not self.source.available:
                msg = f"Mouse capture isn't running: {self.source.error or 'not available on this system'}."
            elif ok:
                msg = f"Raw Input is working. Measured about {rate:.0f} packets per second."
            else:
                msg = "No mouse movement seen. Move the mouse around during the test and try again."
            t.update(state="done", result={"state": "done", "seconds_left": 0.0, "packets": m["n"],
                                           "packet_rate": round(rate, 1), "distance_cm": round(dist, 2),
                                           "ok": ok, "message": msg})
        return t["result"]

    def measure_start(self) -> dict:
        self.recorder.measure_start()
        return {"ok": True}

    def measure_stop(self, mode: str, distance_cm: float = 10.0, sens: float | None = None) -> dict:
        m = self.recorder.measure_stop()
        if mode == "dpi":
            counts = float(np.hypot(m["x"], m["y"]))
            if counts < 100:
                raise ApiError(400, "Didn't see enough movement. Swipe the full 10 cm in one straight line.")
            dpi = dpi_from_swipe(counts, distance_cm)
            return {"counts": round(counts), "dpi": round(dpi, 1), "suggested": snap_dpi(dpi)}
        if mode == "yaw":
            counts = abs(float(m["x"]))
            if counts < 500 or not sens or sens <= 0:
                raise ApiError(400, "Didn't see a full turn. Turn exactly 360 degrees sideways, then stop.")
            yaw = yaw_from_calibration(counts, sens)
            return {"counts": round(counts), "yaw": yaw, "cm360": counts / self.settings()["dpi"] * CM_PER_INCH}
        raise ApiError(400, "mode must be dpi or yaw.")

    # ---------- session ----------
    def _game(self) -> tuple[str, float, float, str | None]:
        s = self.settings()
        if s["game"] == "rivals":
            if not s["rivals_yaw"]:
                raise ApiError(400, "Calibrate Marvel Rivals first, so its cm/360 is measured and not guessed.")
            return "rivals", s["rivals_yaw"], s["dpi"], s["hero_class"]
        return "cs2", s["yaw"], s["dpi"], None

    def session_start(self, tier: str, demo: bool = False) -> dict:
        with self.lock:
            if self.session is not None:
                raise ApiError(409, "A session is already open.")
            if tier not in TIERS:
                raise ApiError(400, "Pick Quick, Standard or Precision.")
            s = self.settings()
            game, yaw, dpi, hero = self._game()
            start_cm = cm360(s["sens"], dpi, yaw)
            self.rng = np.random.default_rng()
            self.clock = DemoClock(self.demo_scale) if demo else time.monotonic
            self.session = Session(tier, start_cm, self.cfg, dpi=dpi, yaw=yaw, game=game, clock=self.clock,
                                   sens_change_s=s["sens_change_s"], demo=demo)
            self.player = Player(cm_opt=float(start_cm * self.rng.uniform(0.75, 1.3))) if demo else None
            self.session_started = now_iso()
            self.session_id = self.db.insert("sessions", created_at=self.session_started, tier=tier, game=game,
                                             hero_class=hero, start_cm=start_cm, dpi=dpi, yaw=yaw, demo=int(demo))
            self.verdict_id, self.last_run, self.remaining = None, None, None
            log.info("session %s started tier=%s demo=%s", self.session_id, tier, demo)
            return self.session_state()

    def _need(self) -> Session:
        if self.session is None:
            raise ApiError(404, "No session is open.")
        return self.session

    def _arm(self, session_seconds: float) -> None:
        s = self.session
        real = session_seconds / (self.demo_scale if s.demo else 1.0)
        self.timer = threading.Timer(max(real, 0.01), self._auto_stop, args=[s.active.id])
        self.timer.daemon = True
        self.timer.start()

    def run_start(self) -> dict:
        with self.lock:
            s = self._need()
            if s.active is None and not s.finished and not s.paused_at:
                nxt = s.current()
                if s.demo and nxt is not None and nxt.is_run:      # pretend the sens change took a while
                    self.clock.advance(45.0 if nxt.slot != s.prev_slot else 10.0)
                blk = s.begin()
                if blk is not None:
                    if s.demo:
                        self.clock.start()
                    elif blk.kind != "rest":
                        self.recorder.start_run()
                    self._arm(blk.duration)
            return self.session_state()

    def _auto_stop(self, block_id: int) -> None:
        with self.lock:
            s = self.session
            if s is not None and s.active is not None and s.active.id == block_id and s.paused_at is None:
                self._stop_block(auto=True)

    def run_stop(self) -> dict:
        with self.lock:
            self._need()
            self._stop_block(auto=False)
            return self.session_state()

    def _stop_block(self, auto: bool) -> None:
        s = self.session
        blk = s.active
        if blk is None:
            return
        if self.timer:
            self.timer.cancel()
        used = s.elapsed() - s.active_t0
        if s.demo:
            self.clock.stop()
            if auto:                                              # land exactly on the planned end
                self.clock.now -= max(0.0, s.elapsed() - (s.active_t0 + blk.duration))
            used = min(used, blk.duration)
        res, partial, run_id, trace = None, False, None, None
        kind = "tracking" if blk.kind == "tracking" else "flick"
        if s.demo and blk.is_run:
            played = blk if auto else replace(blk, duration=float(max(5.0, used)))
            trace, res = sim_result(played, self.player, self.cfg, self.rng)
        elif not s.demo and blk.kind != "rest":
            trace, partial = self.recorder.stop_run(s.dpi, {"block": blk.id, "stage": blk.stage})
            res = analyze_run(trace, kind, self.cfg)
        if trace is not None:
            run_id = self._store_run(blk, trace, res, partial)
        if blk.is_run and res is not None:
            self.last_run = {"kind": kind, "sens": s.sens(blk.cm360), "flicks": res["flick"]["n"],
                             "over_rate": res["flick"]["over_rate"], "under_rate": res["flick"]["under_rate"],
                             "packet_rate": res["packet_rate"], "partial": partial,
                             "warning": self._run_warning(res, kind, partial, s.demo)}
        s.finish(res if blk.is_run else None, partial, run_id)

    def _run_warning(self, res: dict, kind: str, partial: bool, demo: bool) -> str | None:
        if partial:
            return "Capture was paused during that run, so it's marked partial. The data is kept."
        if demo:
            return None
        if res["packets"] == 0:
            return "No mouse movement was captured in that run."
        if low_rate(res["packet_rate"], self.settings()["polling_hz"]):
            return f"Packet rate looked low ({res['packet_rate']:.0f}/s). Check the mouse's polling rate."
        if kind == "flick" and res["flick"]["n"] < 10:
            return f"Only {res['flick']['n']} flicks detected. Was that a flick task with clicks?"
        return None

    def _store_run(self, blk, trace: Trace, res: dict, partial: bool) -> int:
        s = self.session
        name = f"s{self.session_id:05d}_b{blk.id:03d}_{datetime.now():%Y%m%d-%H%M%S}.npz"
        trace.save(self.dir / "runs" / name)
        return self.db.insert("runs", session_id=self.session_id, created_at=now_iso(), kind=blk.kind,
                              stage=blk.stage, sens=s.sens(blk.cm360), cm360=blk.cm360, duration=trace.duration,
                              packet_rate=res["packet_rate"], partial=int(partial), demo=int(s.demo),
                              trace=name, metrics=json.dumps(res))

    def session_skip(self) -> dict:
        with self.lock:
            s = self._need()
            if self.timer:
                self.timer.cancel()
            if s.active is not None:
                if s.demo:
                    self.clock.stop()
                elif s.active.kind != "rest":
                    self.recorder.stop_run(s.dpi)
            s.skip()
            return self.session_state()

    def session_pause(self, paused: bool) -> dict:
        with self.lock:
            s = self._need()
            if paused and s.paused_at is None:
                if s.active is not None:
                    self.remaining = max(0.0, s.active.duration - (s.elapsed() - s.active_t0))
                    if self.timer:
                        self.timer.cancel()
                    if s.demo:
                        self.clock.stop()
                    else:
                        self.recorder.set_paused(True)
                s.pause()
            elif not paused and s.paused_at is not None:
                s.resume()
                if s.active is not None:
                    if s.demo:
                        self.clock.start()
                    else:
                        self.recorder.set_paused(False)
                    self._arm(self.remaining or 0.0)
                self.remaining = None
            return self.session_state()

    def session_end(self) -> dict:
        with self.lock:
            s = self._need()
            if s.paused_at is not None:
                s.resume()
                self.recorder.set_paused(False)
            self._stop_block(auto=False)
            s.wrap()
            return self.session_state()

    def session_close(self) -> dict:
        with self.lock:
            s = self.session
            if s is not None:
                if self.timer:
                    self.timer.cancel()
                if s.active is not None and not s.demo and s.active.kind != "rest":
                    self.recorder.stop_run(s.dpi)
                self.session = None
            return {"active": False}

    def session_state(self) -> dict:
        with self.lock:
            s = self.session
            if s is None:
                return {"active": False}
            if not s.finished and s.active is None and s.paused_at is None and not s.plan()[0]:
                s.wrap()                                          # budget or the 60:00 cap ran out while idle
            if s.finished and self.verdict_id is None:
                self._save_verdict()
            st = s.state()
            st.update(active=True, id=self.session_id, time_scale=self.demo_scale if s.demo else 1.0,
                      capture_paused=bool(self.recorder.paused and not s.demo), last_run=self.last_run,
                      verdict_id=self.verdict_id)
            return st

    def _save_verdict(self) -> None:
        s, v = self.session, self.session.verdict
        shots = [json.loads(r["fields"]) for r in self.db.q(
            "SELECT fields FROM shots WHERE status='saved' AND created_at >= ?", (self.session_started,))]
        for row in v["levels"]:                                   # side panel only: never part of the fit
            scores = [f["score"] for f in shots if f.get("score") is not None and f.get("sens") is not None
                      and abs(f["sens"] - row["sens"]) < 0.006]
            row["score"] = float(np.mean(scores)) if scores else None
        self.verdict_id = self.db.insert(
            "verdicts", session_id=self.session_id, created_at=now_iso(), tier=v["tier"], game=v["game"],
            hero_class=self.settings()["hero_class"] if v["game"] == "rivals" else None, pick_sens=v["pick_sens"],
            pick_cm=v["pick_cm"], lo_cm=v["lo_cm"], hi_cm=v["hi_cm"], confidence=v["confidence"],
            demo=int(s.demo), profile_name=None, data=json.dumps(v))
        log.info("session %s finished: pick %.1f cm/360 (%s)", self.session_id, v["pick_cm"], v["confidence"])

    def on_hotkey(self, name: str) -> None:
        try:
            if name == "run":
                with self.lock:
                    if self.session is None:
                        return self.toast("info", "Start a session first.")
                    self.run_stop() if self.session.active is not None else self.run_start()
            elif name == "next":
                if self.session is not None:
                    self.run_start()
            elif name == "pause":
                paused = self.set_capture_paused(not self.recorder.paused)["paused"]
                self.toast("warn" if paused else "good", "Capture paused." if paused else "Capture resumed.")
            elif name == "shot":
                shot = self.ingest_latest()
                self.toast("good" if shot["status"] == "saved" else "warn",
                           "Screenshot logged." if shot["status"] == "saved" else (shot["reason"] or "Check that screenshot."))
        except ApiError as e:
            self.toast("warn", e.detail)

    # ---------- verdicts / profiles / plan ----------
    VERDICT_COLS = ("id, created_at, tier, game, hero_class, pick_sens, pick_cm, lo_cm, hi_cm, confidence, demo, "
                    "profile_name")

    def _row(self, r: dict) -> dict:
        return {**r, "demo": bool(r["demo"])}

    def verdicts(self, game: str | None = None, hero_class: str | None = None) -> list[dict]:
        sql, args = f"SELECT {self.VERDICT_COLS} FROM verdicts WHERE 1=1", []
        if game:
            sql, args = sql + " AND game=?", args + [game]
        if hero_class:
            sql, args = sql + " AND hero_class=?", args + [hero_class]
        return [self._row(r) for r in self.db.q(sql + " ORDER BY id DESC", args)]

    def verdict(self, vid: int | None = None) -> dict | None:
        rows = self.db.q("SELECT * FROM verdicts WHERE id=?", (vid,)) if vid is not None else \
            self.db.q("SELECT * FROM verdicts ORDER BY id DESC LIMIT 1")
        if not rows:
            if vid is None:
                return None
            raise ApiError(404, "That verdict doesn't exist.")
        r = rows[0]
        return {"id": r["id"], "created_at": r["created_at"], "hero_class": r["hero_class"],
                "profile_name": r["profile_name"], "verdict": json.loads(r["data"])}

    def verdict_save(self, vid: int, name: str, hero_class: str | None = None) -> dict:
        self.verdict(vid)
        if not (name or "").strip():
            raise ApiError(400, "Give the profile a name.")
        self.db.x("UPDATE verdicts SET profile_name=?, hero_class=COALESCE(?, hero_class) WHERE id=?",
                  (name.strip(), hero_class, vid))
        return self._row(self.db.q(f"SELECT {self.VERDICT_COLS} FROM verdicts WHERE id=?", (vid,))[0])

    def verdict_delete(self, vid: int) -> dict:
        self.db.x("DELETE FROM verdicts WHERE id=?", (vid,))
        self.db.x("DELETE FROM plan_checks WHERE verdict_id=?", (vid,))
        return {"ok": True}

    def verdict_cfg(self, vid: int) -> dict:
        v = self.verdict(vid)["verdict"]
        if v["game"] != "cs2":
            raise ApiError(400, "The cfg file is for CS2 only. For other games, type the value in yourself.")
        sens = round(v["pick_sens"], 3)
        content = ("// Sensfinder v1.0 - copy this file into ...\\game\\csgo\\cfg\\ yourself, then run in the console:\n"
                   "//   exec sensfinder_sens\n"
                   f"sensitivity {sens:g}\n"
                   f"echo \"Sensfinder: sensitivity {sens:g} ({v['pick_cm']:.1f} cm/360 at {v['dpi']:g} DPI)\"\n")
        path = self.dir / "cfg" / "sensfinder_sens.cfg"
        path.write_text(content, encoding="utf-8")
        return {"filename": path.name, "path": str(path), "content": content, "command": "exec sensfinder_sens"}

    def plan(self) -> dict | None:
        latest = self.verdict()
        if latest is None:
            return None
        checks = {r["item_id"]: bool(r["checked"]) for r in
                  self.db.q("SELECT item_id, checked FROM plan_checks WHERE verdict_id=?", (latest["id"],))}
        cards = latest["verdict"]["plan"]
        for c in cards:
            for item in c["items"]:
                item["checked"] = checks.get(item["id"], False)
        retest = datetime.fromisoformat(latest["created_at"]) + timedelta(days=cards[0]["retest_days"] if cards else 7)
        return {"verdict_id": latest["id"], "created_at": latest["created_at"],
                "retest_on": retest.date().isoformat(), "cards": cards}      # a day, not a moment

    def plan_check(self, item_id: str, checked: bool) -> dict | None:
        latest = self.verdict()
        if latest is None:
            raise ApiError(404, "No plan yet. Finish a session first.")
        self.db.x("INSERT INTO plan_checks(verdict_id, item_id, checked) VALUES(?,?,?) "
                  "ON CONFLICT(verdict_id, item_id) DO UPDATE SET checked=excluded.checked",
                  (latest["id"], item_id, int(bool(checked))))
        return self.plan()

    # ---------- runs / Lab ----------
    def _run_row(self, r: dict) -> dict:
        m = json.loads(r["metrics"])["flick"]
        return {"id": r["id"], "session_id": r["session_id"], "created_at": r["created_at"], "kind": r["kind"],
                "stage": r["stage"], "sens": r["sens"], "cm360": r["cm360"], "duration": r["duration"],
                "packet_rate": r["packet_rate"], "partial": bool(r["partial"]), "demo": bool(r["demo"]),
                "flicks": m["n"], "over_rate": m["over_rate"], "under_rate": m["under_rate"]}

    def runs(self, limit: int = 100) -> list[dict]:
        return [self._run_row(r) for r in self.db.q("SELECT * FROM runs ORDER BY id DESC LIMIT ?", (int(limit),))]

    def recompute(self, run_id: int) -> tuple[dict, dict]:
        """(stored metrics, metrics recomputed from the trace with the current config)."""
        r = self.db.q("SELECT * FROM runs WHERE id=?", (run_id,))
        if not r:
            raise ApiError(404, "That run doesn't exist.")
        trace = Trace.load(self.dir / "runs" / r[0]["trace"])
        kind = "tracking" if r[0]["kind"] == "tracking" else "flick"
        return json.loads(r[0]["metrics"]), analyze_run(trace, kind, self.cfg)

    def lab(self, run_id: int, overrides: dict | None = None) -> dict:
        r = self.db.q("SELECT * FROM runs WHERE id=?", (run_id,))
        if not r:
            raise ApiError(404, "That run doesn't exist.")
        path = self.dir / "runs" / r[0]["trace"]
        if not path.exists():
            raise ApiError(404, "The trace file for that run is missing.")
        cfg = config.merged(self.cfg, overrides)
        trace = Trace.load(path)
        grid = to_grid(trace, cfg)
        kept, dropped = segment(grid, cfg)
        hz = grid.hz
        step = max(1, hz // 100)
        n = len(grid.speed) // step
        speed = grid.speed[:n * step].reshape(n, step).max(1)       # keep the peaks when thinning to 100 Hz
        shipped = config.load(None)
        return {"run": self._run_row(r[0]), "hz": hz // step,
                "t": np.round(np.arange(n) * step / hz, 3).tolist(), "speed": np.round(speed, 2).tolist(),
                "flicks": [{"start": k["start"] / hz, "peak": k["peak"] / hz, "p": k["p"] / hz,
                            "click": k["click"] / hz, "s": k["s"], "label": k["label"], "vpeak": k["vpeak"],
                            "length": k["length"]} for k in kept],
                "dropped": [{"click": d["click"] / hz, "reason": d["reason"]} for d in dropped],
                "metrics": flick_metrics(kept, cfg, trace.duration),
                "sliders": [{"section": sec, "key": key, "label": label, "unit": unit, "min": lo, "max": hi,
                             "step": st, "value": cfg[sec][key], "default": shipped[sec][key]}
                            for sec, key, label, unit, lo, hi, st in SLIDERS]}

    def lab_save_default(self, overrides: dict | None) -> dict:
        self.cfg = config.merged(self.cfg, overrides)
        config.dump(self.cfg, self.user_cfg)
        return {"path": str(self.user_cfg)}

    # ---------- beta data ----------
    def beta(self) -> dict:
        path = Path(self.settings()["beta_dir"]) / "trials.csv"
        rows = 0
        if path.exists():
            with open(path, encoding="utf-8") as f:
                rows = max(0, sum(1 for _ in f) - 1)
        return {"available": path.exists(), "path": str(path), "rows": rows, "imported": self.db.beta_count()}

    def beta_import(self) -> dict:
        b = self.beta()
        if not b["available"]:
            raise ApiError(404, "No beta data found at " + b["path"])
        return self.db.import_beta(b["path"])

    # ---------- screenshots (optional) ----------
    def _current_sens(self) -> float | None:
        s = self.session
        if s is not None and s.active is not None and s.active.is_run:
            return s.sens(s.active.cm360)
        if s is not None and self.last_run:
            return self.last_run["sens"]
        return None

    def ingest_image(self, img) -> dict:
        from .ocr import ingest
        return ingest.ingest(self.db, img, sens=self._current_sens(), ollama=self.settings()["ollama"])

    def ingest_latest(self) -> dict:
        from PIL import Image
        folder = Path(self.settings()["screenshots_dir"])
        files = sorted(folder.glob("*.png"), key=lambda p: p.stat().st_mtime) if folder.is_dir() else []
        if not files:
            raise ApiError(404, "No screenshots found in " + str(folder))
        return self.ingest_image(Image.open(files[-1]))

    def screenshots(self) -> dict:
        from .ocr import ingest
        w = self.watcher
        return {"watching": bool(w and w.running), "folder": self.settings()["screenshots_dir"],
                "error": w.error if w else None, "items": ingest.list_shots(self.db)}

    def _sync_watcher(self) -> None:
        s = self.settings()
        want = s["watch_screenshots"]
        if self.watcher and (not want or self.watcher.folder != Path(s["screenshots_dir"])):
            self.watcher.stop()
            self.watcher = None
        if want and self.watcher is None:
            from .ocr.ingest import Watcher
            self.watcher = Watcher(s["screenshots_dir"], self.ingest_image).start()

    # ---------- demos (beta) ----------
    def demo_analyze(self, path: str, player: str | None = None) -> dict:
        """player: who to analyze. Picking one remembers it, so later demos default to you, not the top fragger."""
        from .demos.analyzer import analyze_file
        if player:
            self.put_settings({"demo_player": player})
        res = analyze_file(path, player or self.settings()["demo_player"])
        res["path"] = str(Path(str(path).strip().strip('"')))
        self.db.x("DELETE FROM demos WHERE json_extract(data, '$.path') = ?", (res["path"],))   # re-analysis replaces
        rid = self.db.insert("demos", created_at=now_iso(), file=Path(res["path"]).name, data=json.dumps(res))
        return {"id": rid, "created_at": now_iso(), "file": Path(res["path"]).name, **res}

    def demos(self) -> list[dict]:
        return [{"id": r["id"], "created_at": r["created_at"], "file": r["file"], **json.loads(r["data"])}
                for r in self.db.q("SELECT * FROM demos ORDER BY id DESC LIMIT 50")]
