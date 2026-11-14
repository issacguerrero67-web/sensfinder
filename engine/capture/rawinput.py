"""Windows Raw Input mouse listener (ctypes).

A message-only window on a dedicated thread registers for HID mouse input (usage page 0x01, usage 0x02)
with RIDEV_INPUTSINK, so packets arrive while a game has focus. Packets are drained with
GetRawInputBuffer and stamped with QueryPerformanceCounter (time.perf_counter) on receipt.

This is a separate-process listener. It installs no hooks, injects nothing, reads no game memory and
synthesises no input. Mouse only.
"""
from __future__ import annotations

import ctypes
import threading
import time
from ctypes import wintypes

from .source import Recorder

WM_INPUT, WM_QUIT = 0x00FF, 0x0012
RID_INPUT, RIM_TYPEMOUSE = 0x10000003, 0
RIDEV_INPUTSINK = 0x00000100
RI_MOUSE_LEFT_BUTTON_DOWN = 0x0001
MOUSE_MOVE_ABSOLUTE = 0x0001
HWND_MESSAGE = -3


class RAWINPUTDEVICE(ctypes.Structure):
    _fields_ = [("usUsagePage", wintypes.USHORT), ("usUsage", wintypes.USHORT),
                ("dwFlags", wintypes.DWORD), ("hwndTarget", wintypes.HWND)]


class RAWINPUTHEADER(ctypes.Structure):
    _fields_ = [("dwType", wintypes.DWORD), ("dwSize", wintypes.DWORD),
                ("hDevice", wintypes.HANDLE), ("wParam", wintypes.WPARAM)]


class RAWMOUSE(ctypes.Structure):
    _fields_ = [("usFlags", wintypes.USHORT), ("_pad", wintypes.USHORT),
                ("usButtonFlags", wintypes.USHORT), ("usButtonData", wintypes.USHORT),
                ("ulRawButtons", wintypes.ULONG), ("lLastX", wintypes.LONG), ("lLastY", wintypes.LONG),
                ("ulExtraInformation", wintypes.ULONG)]


HDR = ctypes.sizeof(RAWINPUTHEADER)


class RawInputSource:
    name = "rawinput"

    def __init__(self, recorder: Recorder):
        self.recorder = recorder
        self.available = False
        self.error: str | None = None
        self.thread: threading.Thread | None = None
        self.thread_id = 0
        self._ready = threading.Event()
        self._last = 0.0
        self._buf = ctypes.create_string_buffer(64 * 1024)

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self._ready.clear()
        self.thread = threading.Thread(target=self._loop, name="rawinput", daemon=True)
        self.thread.start()
        self._ready.wait(3.0)

    def stop(self) -> None:
        if self.thread and self.thread.is_alive() and self.thread_id:
            ctypes.windll.user32.PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0)
            self.thread.join(2.0)
        self.available = False

    # ---- thread ----
    def _loop(self) -> None:
        u32 = ctypes.WinDLL("user32", use_last_error=True)
        u32.CreateWindowExW.restype = wintypes.HWND
        u32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
                                        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND,
                                        wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
        u32.GetRawInputData.restype = wintypes.UINT
        u32.GetRawInputData.argtypes = [wintypes.HANDLE, wintypes.UINT, wintypes.LPVOID,
                                        ctypes.POINTER(wintypes.UINT), wintypes.UINT]
        u32.GetRawInputBuffer.restype = wintypes.UINT
        u32.GetRawInputBuffer.argtypes = [wintypes.LPVOID, ctypes.POINTER(wintypes.UINT), wintypes.UINT]
        u32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
        u32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
        u32.DestroyWindow.argtypes = [wintypes.HWND]
        self._u32 = u32
        self.thread_id = ctypes.windll.kernel32.GetCurrentThreadId()
        hwnd = u32.CreateWindowExW(0, "STATIC", "SensfinderRawInput", 0, 0, 0, 0, 0,
                                   wintypes.HWND(HWND_MESSAGE), None, None, None)
        if not hwnd:
            self.error = f"could not create the capture window (error {ctypes.get_last_error()})"
            self._ready.set()
            return
        dev = RAWINPUTDEVICE(0x01, 0x02, RIDEV_INPUTSINK, hwnd)
        if not u32.RegisterRawInputDevices(ctypes.byref(dev), 1, ctypes.sizeof(dev)):
            self.error = f"RegisterRawInputDevices failed (error {ctypes.get_last_error()})"
            u32.DestroyWindow(hwnd)
            self._ready.set()
            return
        self.available, self.error = True, None
        self._last = time.perf_counter()
        self._ready.set()
        msg = wintypes.MSG()
        try:
            while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                if msg.message == WM_INPUT:
                    now = time.perf_counter()
                    events = self._read_one(msg.lParam)
                    events += self._drain()
                    self._deliver(events, now)
                u32.DispatchMessageW(ctypes.byref(msg))
        finally:
            self.available = False
            u32.DestroyWindow(hwnd)

    def _mouse(self, m: RAWMOUSE):
        if m.usFlags & MOUSE_MOVE_ABSOLUTE:               # tablets / remote desktop: not relative counts
            return None
        return m.lLastX, m.lLastY, bool(m.usButtonFlags & RI_MOUSE_LEFT_BUTTON_DOWN)

    def _read_one(self, handle) -> list:
        size = wintypes.UINT(0)
        self._u32.GetRawInputData(handle, RID_INPUT, None, ctypes.byref(size), HDR)
        if not size.value or size.value > len(self._buf):
            return []
        buf = ctypes.create_string_buffer(size.value)
        if self._u32.GetRawInputData(handle, RID_INPUT, buf, ctypes.byref(size), HDR) != size.value:
            return []
        if RAWINPUTHEADER.from_buffer(buf).dwType != RIM_TYPEMOUSE:
            return []
        ev = self._mouse(RAWMOUSE.from_buffer(buf, HDR))
        return [ev] if ev else []

    def _drain(self) -> list:
        out = []
        size = wintypes.UINT()
        while True:
            size.value = len(self._buf)
            n = self._u32.GetRawInputBuffer(self._buf, ctypes.byref(size), HDR)
            if n == 0 or n == 0xFFFFFFFF:
                return out
            off = 0
            for _ in range(n):
                hdr = RAWINPUTHEADER.from_buffer(self._buf, off)
                if hdr.dwType == RIM_TYPEMOUSE:
                    ev = self._mouse(RAWMOUSE.from_buffer(self._buf, off + HDR))
                    if ev:
                        out.append(ev)
                off += (hdr.dwSize + 7) & ~7                # NEXTRAWINPUTBLOCK alignment on x64

    def _deliver(self, events: list, now: float) -> None:
        """A batch arrived between the last receipt and now: spread it over that gap (at most 8 ms).
        Single-event timing is not trusted anyway; analysis sums deltas into fixed windows."""
        if not events:
            return
        gap = min(now - self._last, 0.008)
        n = len(events)
        for i, (dx, dy, click) in enumerate(events):
            self.recorder.push(now - gap * (n - 1 - i) / n, dx, dy, click)
        self._last = now
