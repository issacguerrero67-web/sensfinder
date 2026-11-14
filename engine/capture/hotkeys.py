"""Global hotkeys through RegisterHotKey (no keyboard hooks). Windows only; a no-op elsewhere."""
from __future__ import annotations

import ctypes
import sys
import threading
from ctypes import wintypes

WM_HOTKEY, WM_QUIT, WM_APP_REBIND = 0x0312, 0x0012, 0x8001
MODS = {"ctrl": 0x0002, "alt": 0x0001, "shift": 0x0004, "win": 0x0008}
MOD_NOREPEAT = 0x4000
KEYS = {"enter": 0x0D, "space": 0x20, "tab": 0x09, "esc": 0x1B, **{f"f{i}": 0x6F + i for i in range(1, 13)}}
LABELS = {"run": "Start / stop run", "next": "Next sens", "pause": "Pause capture",
          "shot": "Ingest latest screenshot"}
DEFAULTS = {"run": "Ctrl+Alt+Enter", "next": "Ctrl+Alt+N", "pause": "Ctrl+Alt+P", "shot": "Ctrl+Alt+S"}


def parse(combo: str) -> tuple[int, int]:
    """'Ctrl+Alt+N' -> (modifier flags, virtual key). Needs at least one modifier."""
    parts = [p.strip().lower() for p in combo.split("+") if p.strip()]
    if len(parts) < 2:
        raise ValueError(f"'{combo}' needs a modifier and a key, like Ctrl+Alt+N")
    mods = 0
    for p in parts[:-1]:
        if p not in MODS:
            raise ValueError(f"unknown modifier '{p}' in '{combo}'")
        mods |= MODS[p]
    key = parts[-1]
    if key in KEYS:
        return mods, KEYS[key]
    if len(key) == 1 and (key.isalpha() or key.isdigit()):
        return mods, ord(key.upper())
    raise ValueError(f"unknown key '{key}' in '{combo}'")


class Hotkeys:
    def __init__(self, on_hotkey):
        self.on_hotkey = on_hotkey
        self.wanted: dict[str, str] = dict(DEFAULTS)
        self.ok: dict[str, bool] = {k: False for k in DEFAULTS}
        self.thread: threading.Thread | None = None
        self.thread_id = 0
        self._ready = threading.Event()

    def status(self) -> list[dict]:
        return [{"id": k, "label": LABELS[k], "combo": self.wanted[k], "ok": self.ok.get(k, False)} for k in LABELS]

    def start(self, bindings: dict[str, str]) -> None:
        self.wanted = {**DEFAULTS, **{k: v for k, v in bindings.items() if k in DEFAULTS}}
        if sys.platform != "win32":
            return
        if self.thread and self.thread.is_alive():
            ctypes.windll.user32.PostThreadMessageW(self.thread_id, WM_APP_REBIND, 0, 0)
            return
        self._ready.clear()
        self.thread = threading.Thread(target=self._loop, name="hotkeys", daemon=True)
        self.thread.start()
        self._ready.wait(2.0)

    def stop(self) -> None:
        if self.thread and self.thread.is_alive():
            ctypes.windll.user32.PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0)
            self.thread.join(2.0)

    def _register(self, u32) -> None:
        for i, name in enumerate(LABELS, start=1):
            u32.UnregisterHotKey(None, i)
            try:
                mods, vk = parse(self.wanted[name])
                self.ok[name] = bool(u32.RegisterHotKey(None, i, mods | MOD_NOREPEAT, vk))
            except ValueError:
                self.ok[name] = False

    def _loop(self) -> None:
        u32 = ctypes.windll.user32
        self.thread_id = ctypes.windll.kernel32.GetCurrentThreadId()
        msg = wintypes.MSG()
        u32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 0)       # make sure this thread has a message queue
        self._register(u32)
        self._ready.set()
        names = list(LABELS)
        while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == WM_HOTKEY and 1 <= msg.wParam <= len(names):
                try:
                    self.on_hotkey(names[msg.wParam - 1])
                except Exception:                                # a failing action must not kill the hotkeys
                    pass
            elif msg.message == WM_APP_REBIND:
                self._register(u32)
        for i in range(1, len(names) + 1):
            u32.UnregisterHotKey(None, i)
