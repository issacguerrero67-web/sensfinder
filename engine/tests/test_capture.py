"""Recorder + fake source (runs everywhere), Windows smoke tests, and the safety scan."""
import re
import sys
import time
from pathlib import Path

import numpy as np
import pytest

from engine import config
from engine.analysis.flicks import analyze_run
from engine.capture.hotkeys import DEFAULTS, Hotkeys, parse
from engine.capture.source import FakeSource, Recorder, fullscreen_app_running, make_source
from engine.session.runner import VirtualClock
from engine.sim.player import Player, flick_run

CFG = config.load()
ROOT = Path(__file__).resolve().parents[2]


def recorded(trace, pause_at=None):
    clock = VirtualClock()
    rec = Recorder(clock)
    src = FakeSource(rec)
    rec.start_run()
    clock.advance(trace.duration)
    if pause_at is None:
        src.play(trace)
    else:                                              # first part arrives, then capture is paused
        keep = trace.t < pause_at
        for t, dx, dy in zip(trace.t[keep], trace.dx[keep], trace.dy[keep]):
            rec.push(t, int(dx), int(dy))
        rec.set_paused(True)
        rec.push(pause_at + 1, 50, 50)                 # dropped
    return rec, rec.stop_run(trace.dpi)


def test_recorded_run_matches_the_source_trace():
    tr = flick_run(Player(cm_opt=45), 45, 20, rng=np.random.default_rng(5))
    rec, (got, partial) = recorded(tr)
    assert not partial and got.duration == pytest.approx(20)
    a, b = analyze_run(tr, "flick", CFG), analyze_run(got, "flick", CFG)
    assert b["flick"]["n"] == a["flick"]["n"] > 10 and b["s"] == a["s"]
    assert rec.packets >= len(tr.t)


def test_paused_run_is_kept_and_marked_partial():
    tr = flick_run(Player(cm_opt=45), 45, 20, rng=np.random.default_rng(5))
    _, (got, partial) = recorded(tr, pause_at=8.0)
    assert partial and 0 < len(got.t) < len(tr.t) and got.t.max() < 8.0


def test_measure_and_live_trail():
    clock = VirtualClock()
    rec = Recorder(clock)
    rec.measure_start()
    for i in range(400):
        clock.advance(0.001)
        rec.push(clock(), 8, 0)
    m = rec.measure_stop()
    assert (m["x"], m["y"], m["n"]) == (3200, 0, 400)
    live = rec.live(dpi=800, seconds=2.0)
    assert len(live["trail"]) == 200 == len(live["speed"])
    assert live["trail"][-1][0] == pytest.approx(3200 / 800 * 2.54, abs=0.01)
    assert live["packet_rate"] == pytest.approx(1000, rel=0.1)


def test_slow_movement_does_not_look_like_a_low_polling_rate():
    """A 1000 Hz mouse dragged slowly only reports when it moves a count (~150 packets/s here). That used to
    trigger the 'packet rate looks low' warning. Now slow movement leaves the rate unknown; a fast swipe
    measures it, and the measured value sticks while the mouse rests."""
    clock = VirtualClock()
    rec = Recorder(clock)
    for i in range(3000):                              # 3 s, a 1-count step every ~7 ms
        clock.advance(0.001)
        if i % 7 == 0:
            rec.push(clock(), 1, 0)
    assert rec.packet_rate() == 0.0
    for _ in range(500):                               # fast swipe: 6 counts in every 1 ms report
        clock.advance(0.001)
        rec.push(clock(), 6, 1)
    assert rec.packet_rate() == pytest.approx(1000, rel=0.05)
    clock.advance(5.0)                                 # mouse at rest
    assert rec.packet_rate() == pytest.approx(1000, rel=0.05)


def test_a_genuinely_slow_mouse_is_still_caught():
    clock = VirtualClock()
    rec = Recorder(clock)
    for _ in range(250):                               # 125 Hz mouse, fast swipe: 8 ms between reports
        clock.advance(0.008)
        rec.push(clock(), 40, 3)
    assert rec.packet_rate() == pytest.approx(125, rel=0.05)      # used to read 150


def test_windows_background_cap_is_not_a_warning():
    from engine.service import low_rate
    assert not low_rate(125, 1000) and not low_rate(130, 1000)      # what Windows gives a background listener
    assert low_rate(60, 1000)                                        # genuinely broken
    assert not low_rate(0, 1000)                                     # not measured yet


def test_hotkey_parsing():
    assert parse("Ctrl+Alt+Enter") == (0x0003, 0x0D)
    assert parse("ctrl+alt+n") == (0x0003, ord("N"))
    assert parse("Ctrl+Shift+F5") == (0x0006, 0x74)
    for bad in ("N", "Ctrl+", "Hyper+N", "Ctrl+Alt+Banana"):
        with pytest.raises(ValueError):
            parse(bad)
    assert len({parse(c) for c in DEFAULTS.values()}) == 4


def test_fake_source_is_used_when_asked():
    assert make_source(Recorder(), fake=True).name == "fake"
    assert fullscreen_app_running() in (True, False)


@pytest.mark.windows
@pytest.mark.skipif(sys.platform != "win32", reason="Raw Input is Windows only")
def test_raw_input_window_opens_and_listens_for_3_seconds():
    rec = Recorder()
    src = make_source(rec)
    assert src.name == "rawinput"
    src.start()
    try:
        assert src.available and src.error is None
        time.sleep(3.0)
        assert src.thread.is_alive()
        print(f"\nraw input smoke: {rec.packets} packets in 3 s, measured rate {rec.packet_rate():.0f}/s")
    finally:
        src.stop()
    assert not src.thread.is_alive()


@pytest.mark.windows
@pytest.mark.skipif(sys.platform != "win32", reason="RegisterHotKey is Windows only")
def test_hotkeys_register_and_rebind():
    hk = Hotkeys(lambda name: None)
    odd = {"run": "Ctrl+Alt+Shift+F9", "next": "Ctrl+Alt+Shift+F10", "pause": "Ctrl+Alt+Shift+F11",
           "shot": "Ctrl+Alt+Shift+F12"}
    hk.start(odd)
    try:
        assert all(h["ok"] for h in hk.status())
        hk.start({**odd, "run": "Ctrl+Alt+Shift+F8"})
        time.sleep(0.2)
        assert hk.status()[0]["combo"] == "Ctrl+Alt+Shift+F8" and hk.status()[0]["ok"]
    finally:
        hk.stop()


FORBIDDEN = ["SetWindowsHookEx", "SendInput", "mouse_event", "keybd_event", "ReadProcessMemory",
             "WriteProcessMemory", "CreateRemoteThread", "VirtualAllocEx", "OpenProcess", "GetAsyncKeyState",
             "GetForegroundWindow", "GetWindowText", "pynput", "pyautogui", "ImageGrab", "BitBlt",
             "GameUserSettings.ini", "aimlab_tb"]


def test_no_forbidden_apis_in_shipped_code():
    """Spec section 2: no hooks, no injection, no memory reading, no input synthesis, no screen capture,
    no window titles, no writes to game settings files. A hit here is a release blocker."""
    hits = []
    for folder in ("engine", "shell"):
        for f in (ROOT / folder).rglob("*.py"):
            if "tests" in f.parts:
                continue
            text = f.read_text(encoding="utf-8", errors="replace")
            hits += [f"{f.relative_to(ROOT)}: {w}" for w in FORBIDDEN if re.search(rf"\b{re.escape(w)}\b", text)]
    assert not hits, hits
