"""Tier plans and the budget rule.

The scheduler builds the plan it would like to run, then drops optional blocks until the plan fits the time
that is left. Drop order is fixed: extra reps -> tracking -> refine neighbors. It never plans past the tier
budget, and never past the 60:00 hard cap.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

MULTS = (0.6, 0.77, 1.0, 1.3, 1.67)     # of the starting cm/360
HARD_CAP = 3600.0
RUN_S = 60.0
NEIGHBOR = 1.15
CURRENT = "x1"

# priority: 0 required, 1 refine neighbors, 2 tracking, 3 extra reps (dropped first)
TIERS = {
    "quick": {"label": "Quick", "budget": 1200.0, "warmup": 180.0, "tracking": False, "rest": 60.0,
              "optional_rest": True, "drift_priority": 3, "refine": "B", "refine_extra": "",
              "confirm_pick": 0, "confirm_current": 1, "final_drift": False, "min_refine": 1,
              "promise": "Rough range. Good for a first look."},
    "standard": {"label": "Standard", "budget": 2700.0, "warmup": 210.0, "tracking": True, "rest": 180.0,
                 "optional_rest": False, "drift_priority": 0, "refine": "ABCCBA", "refine_extra": "",
                 "confirm_pick": 3, "confirm_current": 3, "final_drift": False, "min_refine": 3,
                 "promise": "Reliable range and a best pick."},
    "precision": {"label": "Precision", "budget": 3600.0, "warmup": 240.0, "tracking": True, "rest": 180.0,
                  "optional_rest": False, "drift_priority": 0, "refine": "ABCCBA", "refine_extra": "ABC",
                  "confirm_pick": 3, "confirm_current": 3, "final_drift": True, "min_refine": 3,
                  "promise": "Tightest range this method can give."},
}
DROP_WORDS = {3: "extra reps", 2: "tracking runs", 1: "refine neighbors", 0: "the last planned runs"}


@dataclass
class Block:
    id: int
    stage: str               # warmup | bracket | drift | rest | refine | confirm | drift2
    kind: str                # warmup | flick | tracking | rest
    slot: str                # x0.6 .. x1.67, A, B, C, pick
    duration: float
    priority: int = 0
    cm360: float | None = None
    note: str = ""

    @property
    def is_run(self) -> bool:
        return self.kind in ("flick", "tracking")


@dataclass
class Overheads:
    change: float = 60.0     # seconds to change sens in-game (measured live)
    restart: float = 15.0    # seconds between two runs at the same sens


def build_plan(tier: str, rng: np.random.Generator) -> list[Block]:
    t = TIERS[tier]
    blocks: list[Block] = []

    def add(stage, kind, slot, duration=RUN_S, priority=0):
        blocks.append(Block(len(blocks), stage, kind, slot, duration, priority))

    add("warmup", "warmup", CURRENT, t["warmup"])
    for m in rng.permutation(MULTS):
        add("bracket", "flick", f"x{m:g}")
        if t["tracking"]:
            add("bracket", "tracking", f"x{m:g}", priority=2)
    add("drift", "flick", CURRENT, priority=t["drift_priority"])
    add("rest", "rest", "", t["rest"], priority=3 if t["optional_rest"] else 0)
    seen = set()
    for ch in t["refine"]:
        add("refine", "flick", ch, priority=3 if ch in seen else (0 if ch == "B" else 1))
        seen.add(ch)
    for ch in t["refine_extra"]:
        add("refine", "flick", ch, priority=3)
    for i in range(max(t["confirm_pick"], t["confirm_current"])):
        if i < t["confirm_pick"]:
            add("confirm", "flick", "pick", priority=0 if i == 0 else 3)
        if i < t["confirm_current"]:
            add("confirm", "flick", CURRENT, priority=0 if i == 0 else 3)
    if t["final_drift"]:
        add("drift2", "flick", CURRENT, priority=3)
    return blocks


def slot_cm(slot: str, start_cm: float, balance_cm: float | None = None, pick_cm: float | None = None):
    if slot.startswith("x"):
        return start_cm * float(slot[1:])
    if slot in "ABC" and slot and balance_cm:
        return balance_cm * {"A": 1 / NEIGHBOR, "B": 1.0, "C": NEIGHBOR}[slot]
    if slot == "pick" and pick_cm:
        return pick_cm
    return None


def cost(blocks: list[Block], prev_slot: str, oh: Overheads) -> float:
    total = 0.0
    for b in blocks:
        total += b.duration
        if b.is_run:
            total += oh.change if b.slot != prev_slot else oh.restart
            prev_slot = b.slot
    return total


def fit(queue: list[Block], elapsed: float, tier: str, oh: Overheads, prev_slot: str = CURRENT):
    """(kept, dropped): the part of the queue that still fits the budget, and what had to go."""
    limit = min(TIERS[tier]["budget"], HARD_CAP)
    kept, dropped = list(queue), []
    while kept and elapsed + cost(kept, prev_slot, oh) > limit:
        top = max(b.priority for b in kept)
        victim = [b for b in kept if b.priority == top][-1] if top > 0 else kept[-1]
        kept.remove(victim)
        dropped.append(victim)
    return kept, dropped


def repeat_of(block: Block, new_id: int) -> Block:
    return replace(block, id=new_id, priority=3, note="noisy")
