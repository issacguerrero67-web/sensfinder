"""CS2 demo analyzer (beta). Supporting evidence only.

For each shot the player fires, find the enemy head the crosshair was closest to, and measure how far past
or short of it the flick ended. 64-tick demos sample every ~15.6 ms, which is too coarse to see the shape of
a flick, so this reports endpoint error only.

Checked on the owner's PC on 2026-11-14: matchmaking replays (game\\csgo\\replays\\) parse fine and carry every
player's position, so they are the usable source. `record` in an offline match was refused as a cheat command,
even after `sv_cheats 1`. Only enemies count as targets when the demo has team numbers.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

EYE_STAND, EYE_CROUCH = 64.0, 46.0
MAX_AIM_ERROR_DEG = 10.0       # a shot further than this from every head isn't a shot at a target
MIN_FLICK_DEG = 3.0
LOOKBACK_TICKS = 32            # 0.5 s at 64 tick
STILL_DEG_PER_TICK = 0.15
REL_THRESHOLD = 0.03
NOTES = ["Beta. 64-tick demos are coarse, so this is endpoint error only.",
         "Shown as supporting evidence next to the mouse-capture result, never mixed into it."]


def _empty(message: str, player: str | None = None, shots: int = 0) -> dict:
    return {"usable": False, "message": message, "player": player, "shots": shots, "flicks": 0,
            "over_rate": None, "under_rate": None, "median_error_deg": None, "notes": NOTES, "players": []}


def _wrap(deg):
    return (np.asarray(deg) + 180.0) % 360.0 - 180.0


def shooters(fires: list[tuple[int, str]]) -> list[dict]:
    """Everyone who fired, most shots first. The UI offers these so you can pick yourself."""
    counts: dict[str, int] = {}
    for _, n in fires:
        counts[n] = counts.get(n, 0) + 1
    return [{"name": n, "shots": c} for n, c in sorted(counts.items(), key=lambda x: -x[1])]


def analyze_frames(frames: dict, fires: list[tuple[int, str]], player: str | None = None) -> dict:
    """frames: {name: {"tick": int[], "x","y","z","pitch","yaw": float[], optional "ducking","alive": bool[],
    optional "team": int[]}}. fires: [(tick, name)] from weapon_fire. Pure function, tested with a synthetic
    fixture. `player` falls back to whoever fired most when it's missing or not in the demo."""
    players = shooters(fires)
    if player not in {p["name"] for p in players}:
        player = players[0]["name"] if players else None
    return {**_analyze(frames, fires, player), "players": players}


def _analyze(frames: dict, fires: list[tuple[int, str]], player: str | None) -> dict:
    if not fires or player is None:
        return _empty("No shots found in this demo.")
    me = frames.get(player)
    others = {n: f for n, f in frames.items() if n != player and len(f["tick"])}
    shots = [t for t, n in fires if n == player]
    if me is None or not len(me["tick"]):
        return _empty("The demo has no view angles for the shooter.", player, len(shots))
    if not others:
        return _empty("This demo has no other players or bots in it, so there's nothing to measure against. "
                      "POV demos may not contain bot positions; try a local GOTV recording.", player, len(shots))
    idx = {int(t): i for i, t in enumerate(me["tick"])}
    lookup = {n: {int(t): i for i, t in enumerate(f["tick"])} for n, f in others.items()}
    signed, errors = [], []
    for t in shots:
        i = idx.get(int(t))
        if i is None or i < 2:
            continue
        duck = bool(me["ducking"][i]) if "ducking" in me else False
        eye = np.array([me["x"][i], me["y"][i], me["z"][i] + (EYE_CROUCH if duck else EYE_STAND)])
        best = None
        for n, f in others.items():
            j = lookup[n].get(int(t))
            if j is None or ("alive" in f and not f["alive"][j]):
                continue
            if "team" in f and "team" in me and f["team"][j] == me["team"][i]:
                continue                                       # teammates aren't targets
            head_z = f["z"][j] + (EYE_CROUCH if ("ducking" in f and f["ducking"][j]) else EYE_STAND)
            d = np.array([f["x"][j], f["y"][j], head_z]) - eye
            ideal_yaw = np.degrees(np.arctan2(d[1], d[0]))
            ideal_pitch = -np.degrees(np.arctan2(d[2], np.hypot(d[0], d[1])))
            cosp = np.cos(np.radians(me["pitch"][i]))
            e = np.array([_wrap(me["yaw"][i] - ideal_yaw) * cosp, me["pitch"][i] - ideal_pitch])
            if best is None or np.hypot(*e) < np.hypot(*best):
                best = e
        if best is None or np.hypot(*best) > MAX_AIM_ERROR_DEG:
            continue
        lo = max(1, i - LOOKBACK_TICKS)
        cosp = np.cos(np.radians(me["pitch"][lo:i + 1]))
        dyaw = _wrap(np.diff(me["yaw"][lo - 1:i + 1])) * cosp
        dpitch = np.diff(me["pitch"][lo - 1:i + 1])
        speed = np.hypot(dyaw, dpitch)
        k = len(speed) - 1
        while k >= 0 and speed[k] < STILL_DEG_PER_TICK:        # skip the settle before the shot
            k -= 1
        end = k
        while k >= 0 and speed[k] >= STILL_DEG_PER_TICK:
            k -= 1
        move = np.array([dyaw[k + 1:end + 1].sum(), dpitch[k + 1:end + 1].sum()])
        amp = float(np.hypot(*move))
        if amp < MIN_FLICK_DEG:
            continue
        signed.append(float(best @ move / amp) / amp)          # > 0: went past the head, < 0: stopped short
        errors.append(float(np.hypot(*best)))
    if len(signed) < 5:
        return _empty(f"Found {len(shots)} shots but only {len(signed)} flicks onto a target. Not enough to say "
                      "anything.", player, len(shots))
    s = np.array(signed)
    return {"usable": True, "message": f"{len(s)} flicks onto a target out of {len(shots)} shots.",
            "player": player, "shots": len(shots), "flicks": int(len(s)),
            "over_rate": float(np.mean(s > REL_THRESHOLD)), "under_rate": float(np.mean(s < -REL_THRESHOLD)),
            "median_error_deg": float(np.median(errors)), "notes": NOTES}


def load_demo(path: str | Path):
    """(frames, fires) via demoparser2. Column names differ between demo types, so this is defensive."""
    from demoparser2 import DemoParser
    p = DemoParser(str(path))
    try:
        ticks = p.parse_ticks(["X", "Y", "Z", "pitch", "yaw", "is_alive", "ducking", "team_num"])
    except Exception:
        ticks = p.parse_ticks(["X", "Y", "Z", "pitch", "yaw"])
    fire = p.parse_event("weapon_fire")
    frames = {}
    for name, g in ticks.groupby("name"):
        f = {"tick": g["tick"].to_numpy(), "x": g["X"].to_numpy(float), "y": g["Y"].to_numpy(float),
             "z": g["Z"].to_numpy(float), "pitch": g["pitch"].to_numpy(float), "yaw": g["yaw"].to_numpy(float)}
        if "is_alive" in g:
            f["alive"] = g["is_alive"].to_numpy(bool)
        if "ducking" in g:
            f["ducking"] = g["ducking"].to_numpy(bool)
        if "team_num" in g:
            f["team"] = g["team_num"].to_numpy(int)
        frames[str(name)] = f
    fires = [(int(t), str(n)) for t, n in zip(fire["tick"], fire["user_name"])] if len(fire) else []
    return frames, fires


def analyze_file(path: str | Path, player: str | None = None) -> dict:
    """Never raises on a bad file."""
    path = Path(str(path).strip().strip('"'))
    if not path.is_file():
        return _empty("That file doesn't exist.")
    if path.suffix.lower() != ".dem":
        return _empty("That isn't a .dem file.")
    try:
        frames, fires = load_demo(path)
    except BaseException as e:                                   # the Rust parser can panic on a bad file
        if isinstance(e, (KeyboardInterrupt, SystemExit)):
            raise
        return _empty("Couldn't read that demo. It may be damaged or from an unsupported version.")
    try:
        return analyze_frames(frames, fires, player)
    except Exception:
        return _empty("The demo was read, but it has no usable aim data.")
