"""Sensfinder desktop shell: one process that starts the engine, serves the UI on 127.0.0.1 and shows it in a
frameless WebView2 window (pywebview), with a tray icon and a single-instance lock.

The UI only talks to http://127.0.0.1:<port>, so a Tauri shell can replace this file in v1.1 without UI changes.
"""
from __future__ import annotations

import ctypes
import json
import os
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
if not FROZEN:
    sys.path.insert(0, str(ROOT))

from engine import __version__            # noqa: E402
from engine.app import serve              # noqa: E402
from engine.service import Engine         # noqa: E402

UI_DIR = ROOT / "ui" if FROZEN else ROOT / "ui" / "dist"
ACCENT, GOOD, DANGER = (124, 92, 255), (61, 220, 151), (255, 92, 108)


def make_icon(size: int = 64, dot=None):
    """The app mark: a ring with a centre dot on the accent colour. `dot` colours the status dot (tray)."""
    from PIL import Image, ImageDraw
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s // 4, fill=(11, 12, 14, 255))
    d.ellipse((s * 0.2, s * 0.2, s * 0.8, s * 0.8), outline=ACCENT + (255,), width=max(2, s // 12))
    d.ellipse((s * 0.42, s * 0.42, s * 0.58, s * 0.58), fill=(242, 244, 247, 255))
    if dot:
        d.ellipse((s * 0.68, s * 0.68, s * 0.96, s * 0.96), fill=dot + (255,), outline=(11, 12, 14, 255),
                  width=max(1, s // 32))
    return img.resize((size, size), Image.LANCZOS)


def single_instance() -> bool:
    if sys.platform != "win32":
        return True
    ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\Sensfinder.SingleInstance")
    return ctypes.windll.kernel32.GetLastError() != 183          # ERROR_ALREADY_EXISTS


WS_THICKFRAME, WS_MAXIMIZEBOX = 0x00040000, 0x00010000


def hwnd_of(window) -> int:
    return int(window.native.Handle.ToInt64())


def dark_frame(window) -> None:
    """Native Windows frame (so Snap, Win+arrows and snap layouts work), tinted to match the app.
    Dark mode works on Windows 10 and 11; the exact caption colours are Windows 11 only and fail quietly elsewhere."""
    if sys.platform != "win32":
        return
    dwm, hwnd = ctypes.windll.dwmapi, hwnd_of(window)
    for attr, value in ((20, 1),               # DWMWA_USE_IMMERSIVE_DARK_MODE
                        (35, 0x000E0C0B),      # DWMWA_CAPTION_COLOR  #0B0C0E (COLORREF is 0x00BBGGRR)
                        (36, 0x00F7F4F2),      # DWMWA_TEXT_COLOR     #F2F4F7
                        (34, 0x002D2723)):     # DWMWA_BORDER_COLOR   #23272D
        v = ctypes.c_int(value)
        dwm.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(v), ctypes.sizeof(v))


def snap_ready(window) -> bool:
    """Snap needs a sizable, maximizable native frame."""
    style = ctypes.windll.user32.GetWindowLongW(hwnd_of(window), -16)     # GWL_STYLE
    return bool(style & WS_THICKFRAME and style & WS_MAXIMIZEBOX)


def start_tray(engine: Engine, window):
    """Tray icon with capture status. Returns the icon (or None if the tray can't start)."""
    try:
        import pystray
    except Exception:
        return None

    def status_text(_=None):
        if not engine.source.available:
            return "Capture: not running"
        return "Capture: paused" if engine.recorder.paused else "Capture: listening (mouse only)"

    def toggle(icon, item):
        engine.set_capture_paused(not engine.recorder.paused)

    icon = pystray.Icon("sensfinder", make_icon(64, GOOD), "Sensfinder", menu=pystray.Menu(
        pystray.MenuItem("Show Sensfinder", lambda icon, item: (window.restore(), window.show()), default=True),
        pystray.MenuItem(status_text, None, enabled=False),
        pystray.MenuItem("Pause capture", toggle, checked=lambda item: engine.recorder.paused),
        pystray.MenuItem("Quit", lambda icon, item: window.destroy())))

    def refresh():
        last = None
        while icon.visible or last is None:
            state = (engine.source.available, engine.recorder.paused)
            if state != last:
                icon.icon = make_icon(64, GOOD if state == (True, False) else DANGER)
                icon.title = "Sensfinder - " + status_text()
                last = state
            time.sleep(2)

    icon.run_detached()
    threading.Thread(target=refresh, daemon=True).start()
    return icon


def headless_check(out: str | None) -> int:
    """Start the engine and the UI server without a window, confirm both answer, then exit.
    Uses a throwaway data folder unless SENSFINDER_DATA_DIR is set."""
    data = os.environ.get("SENSFINDER_DATA_DIR") or tempfile.mkdtemp(prefix="sensfinder-check-")
    result = {"ok": False, "version": __version__}
    engine = None
    try:
        engine = Engine(data)
        server, thread, port, token = serve(engine, UI_DIR)
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.1)
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/status", headers={"X-Sensfinder-Token": token})
        status = json.load(urllib.request.urlopen(req, timeout=10))       # noqa: S310 - localhost
        html = urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=10).read().decode()   # noqa: S310
        result.update(engine=status["version"] == __version__, capture=status["capture"],
                      hotkeys=[h["ok"] for h in status["hotkeys"]], ui="window.__SF__" in html and "<div" in html)
        result["ok"] = bool(result["engine"] and result["ui"])
        server.should_exit = True
    except Exception as e:
        result["error"] = repr(e)
    finally:
        if engine:
            engine.close()
    text = json.dumps(result)
    if out:
        Path(out).write_text(text, encoding="utf-8")
    if sys.stdout:
        print(text)
    return 0 if result["ok"] else 1


def main() -> int:
    if "--headless-check" in sys.argv:
        i = sys.argv.index("--headless-check")
        return headless_check(sys.argv[i + 1] if len(sys.argv) > i + 1 else None)
    if not single_instance():
        if sys.platform == "win32":
            ctypes.windll.user32.MessageBoxW(None, "Sensfinder is already running. Look for it in the tray.",
                                             "Sensfinder", 0x40)
        return 0
    import webview
    engine = Engine()
    server, _, port, _token = serve(engine, UI_DIR)
    # Native frame on purpose: a frameless window loses Windows Snap, Win+arrow keys and snap layouts.
    window = webview.create_window("Sensfinder", f"http://127.0.0.1:{port}/", width=1280, height=800,
                                   min_size=(1100, 700), background_color="#0B0C0E")
    tray = {}

    def on_shown():
        try:
            dark_frame(window)
        except Exception:                         # cosmetic only
            pass
        tray.setdefault("icon", start_tray(engine, window))

    window.events.shown += on_shown
    if "--window-check" in sys.argv:              # build check: open the real window, prove the UI is alive, close
        out = sys.argv[sys.argv.index("--window-check") + 1]

        def check():
            result = {"ok": False}
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{port}/api/status",
                                             headers={"X-Sensfinder-Token": _token})
                for _ in range(40):                # the page needs a moment to load and render
                    time.sleep(0.5)
                    json.load(urllib.request.urlopen(req, timeout=5))             # noqa: S310 - localhost
                    text = window.evaluate_js("document.querySelector('main') ? document.querySelector('main').innerText : ''")
                    if text and "Starting up" not in text and "Waiting for" not in text:
                        result = {"screen": text.strip().splitlines()[0][:80], "snap": snap_ready(window)}
                        result["ok"] = result["snap"]
                        break
            except Exception as e:
                result["error"] = repr(e)
            Path(out).write_text(json.dumps(result), encoding="utf-8")
            window.destroy()

        window.events.loaded += lambda: threading.Thread(target=check, daemon=True).start()
    try:
        webview.start()
    finally:
        if tray.get("icon"):
            tray["icon"].stop()
        server.should_exit = True
        engine.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
