"""Sensitivity conversions. One fixed DPI; only the in-game sens changes."""
from __future__ import annotations

CS2_YAW = 0.022          # degrees per count at sens 1.0 (verified: 1.00 @ 800 DPI = 51.95 cm/360)
CM_PER_INCH = 2.54


def cm360(sens: float, dpi: float = 800, yaw: float = CS2_YAW) -> float:
    """Centimetres of mouse travel for a full 360 degree turn."""
    return (360.0 * CM_PER_INCH) / (dpi * sens * yaw)


def sens_from_cm360(cm: float, dpi: float = 800, yaw: float = CS2_YAW) -> float:
    return (360.0 * CM_PER_INCH) / (dpi * cm * yaw)


def counts_to_cm(counts: float, dpi: float = 800) -> float:
    return counts / dpi * CM_PER_INCH


def yaw_from_calibration(counts_for_360: float, sens: float) -> float:
    """Calibrate-game wizard: the user turns exactly 360 degrees; yaw = 360 / (counts * sens)."""
    return 360.0 / (abs(counts_for_360) * sens)


def dpi_from_swipe(counts: float, distance_cm: float = 10.0) -> float:
    """DPI wizard: the user swipes a known distance."""
    return abs(counts) / (distance_cm / CM_PER_INCH)


def snap_dpi(dpi: float) -> int:
    """Nearest common DPI step, for the 'did you mean 800?' hint."""
    common = (400, 800, 1200, 1600, 2400, 3200)
    return min(common, key=lambda c: abs(c - dpi))
