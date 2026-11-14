"""Diagnosis -> training cards.

Only task and map names that research confirmed exist are used. The pattern -> task mapping is a
suggestion (our judgment), not Aimlabs' own labelling.
"""
from __future__ import annotations

PATTERNS = {
    "over": {"title": "Fix overshoot", "metric": "overflick rate",
             "tasks": ["Headshot (Precision)", "Doubleshot", "Angleshot Entry ADS"],
             "why": "Your first movement tends to go past the target and you pull back."},
    "under": {"title": "Commit to the flick", "metric": "underflick rate",
              "tasks": ["Spidershot 180", "Speedshot", "Sideclick", "Skyswitch Entry ADS"],
              "why": "Your first movement tends to stop short and you nudge forward."},
    "shaky": {"title": "Hold tracking", "metric": "direction reversals per second",
              "tasks": ["Aimlabs Tracking", "Flytrack OW", "MFSI Entry ADS", "Motionshot (Precision)"],
              "why": "Your crosshair changes direction a lot while following a target."},
    "inconsistent": {"title": "Even out flick distance", "metric": "flick-length spread",
                     "tasks": ["Twoshot Entry ADS", "Aimlabs Switching", "Controlswitch Apex", "Gridshot Ultimate"],
                     "why": "Your flick lengths vary a lot from one shot to the next."},
}
CS2_MAPS = ["Aim Botz (uLLeticaL)", "training_aim_csgo2", "Fast Aim / Reflex Training (yolokas)",
            "Fast Warmup - Bot Training"]
RETEST_DAYS = 7


def diagnose(flick: dict | None, tracking: dict | None) -> list[str]:
    """Ordered patterns from the flick metrics nearest the pick and (optional) tracking metrics there."""
    out = []
    if flick and flick.get("n"):
        out.append("over" if flick["over_rate"] >= flick["under_rate"] else "under")
    if tracking and (tracking["reversal_rate"] > 1.0 or tracking["band_share"] > 0.25):
        out.append("shaky")
    if flick and flick.get("cv_len", 0) > 0.55:
        out.append("inconsistent")
    for fallback in ("shaky", "inconsistent", "over"):
        if len(out) >= 2:
            break
        if fallback not in out:
            out.append(fallback)
    return out[:2]


def build_plan(patterns: list[str], game: str = "cs2") -> list[dict]:
    """Three cards: two pattern cards and the 8-minute warm-up."""
    cards = []
    for p in patterns[:2]:
        d = PATTERNS[p]
        items = [{"id": f"{p}:{i}", "text": f"{t} (5 min)"} for i, t in enumerate(d["tasks"][:3])]
        if game == "cs2":
            items.append({"id": f"{p}:map", "text": f"CS2: 10 min on {CS2_MAPS[0 if p != 'shaky' else 1]}"})
        cards.append({"id": p, "title": d["title"], "why": d["why"], "metric": d["metric"],
                      "minutes": 5 * len(d["tasks"][:3]), "items": items, "suggested": True,
                      "retest_days": RETEST_DAYS})
    first = PATTERNS[patterns[0]]["tasks"][0] if patterns else "Headshot (Precision)"
    cards.append({"id": "warmup", "title": "8-minute warm-up", "why": "Same short routine before every session.",
                  "metric": "run-to-run consistency", "minutes": 8, "suggested": True, "retest_days": RETEST_DAYS,
                  "items": [{"id": "warmup:0", "text": "Gridshot Ultimate (3 min)"},
                            {"id": "warmup:1", "text": "Aimlabs Tracking (3 min)"},
                            {"id": "warmup:2", "text": f"{first} (2 min)"}]})
    return cards
