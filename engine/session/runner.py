"""One sens-finding session: walks the plan, re-plans after every block, and builds the verdict.

The clock is injected so Demo mode and the tests can run a whole session on a virtual clock.
"""
from __future__ import annotations

import time

import numpy as np

from ..analysis.estimator import confirm, estimate, fatigue, fatigue_weight
from ..analysis.flicks import analyze_run
from ..sim.player import Player, flick_run, tracking_run
from ..training import build_plan as training_plan
from ..training import diagnose
from ..units import cm360 as to_cm360
from ..units import sens_from_cm360
from .scheduler import (CURRENT, DROP_WORDS, HARD_CAP, TIERS, Block, Overheads, build_plan, fit, repeat_of,
                        slot_cm)

SCORED = ("bracket", "drift", "drift2", "refine", "confirm")


class VirtualClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, s: float) -> None:
        self.now += s


class Session:
    def __init__(self, tier: str, start_cm: float, cfg: dict, dpi: float = 800, yaw: float = 0.022,
                 game: str = "cs2", clock=time.monotonic, seed: int | None = None, sens_change_s: float = 60.0,
                 demo: bool = False):
        self.tier, self.start_cm, self.cfg, self.dpi, self.yaw, self.game = tier, float(start_cm), cfg, dpi, yaw, game
        self.clock, self.demo = clock, demo
        self.queue = build_plan(tier, np.random.default_rng(seed))
        for b in self.queue:
            b.cm360 = slot_cm(b.slot, self.start_cm)
        self.next_id = len(self.queue)
        self.oh = Overheads(change=sens_change_s)
        self.done: list[dict] = []
        self.active: Block | None = None
        self.active_t0 = 0.0
        self.t_start = clock()
        self.paused_at: float | None = None
        self.paused_total = 0.0
        self.prev_slot, self.last_end = CURRENT, None
        self.balance_cm: float | None = None
        self.pick_cm: float | None = None
        self.messages: list[str] = []
        self.repeated: set[str] = set()
        self.fat = {"flag": False, "speed_pct_per_10min": 0.0, "error_pct_per_10min": 0.0}
        self.est = estimate([], cfg, start_cm=self.start_cm)
        self.finished = False
        self.verdict: dict | None = None

    # ---------- time ----------
    def elapsed(self) -> float:
        now = self.paused_at if self.paused_at is not None else self.clock()
        return now - self.t_start - self.paused_total

    def pause(self) -> None:
        if self.paused_at is None:
            self.paused_at = self.clock()

    def resume(self) -> None:
        if self.paused_at is not None:
            self.paused_total += self.clock() - self.paused_at
            self.paused_at = None

    def sens(self, cm: float | None) -> float | None:
        return None if cm is None else sens_from_cm360(cm, self.dpi, self.yaw)

    # ---------- plan ----------
    def plan(self) -> tuple[list[Block], list[Block]]:
        if self.finished:
            return [], []
        if self.active is not None:
            rest = [b for b in self.queue if b is not self.active]
            slot = self.active.slot if self.active.is_run else self.prev_slot
            kept, dropped = fit(rest, self.active_t0 + self.active.duration, self.tier, self.oh, slot)
            return [self.active] + kept, dropped
        return fit(self.queue, self.elapsed(), self.tier, self.oh, self.prev_slot)

    def current(self) -> Block | None:
        self._resolve()
        kept, _ = self.plan()
        return kept[0] if kept else None

    def begin(self) -> Block | None:
        if self.active is not None or self.finished:
            return self.active
        blk = self.current()
        if blk is None:
            self._wrap()
            return None
        now = self.elapsed()
        if blk.is_run and self.last_end is not None:       # learn how long sens changes really take
            gap = now - self.last_end
            if blk.slot != self.prev_slot:
                self.oh.change = float(np.clip(0.5 * self.oh.change + 0.5 * gap, 10, 300))
            else:
                self.oh.restart = float(np.clip(0.5 * self.oh.restart + 0.5 * gap, 3, 120))
        self.active, self.active_t0 = blk, now
        return blk

    def finish(self, result: dict | None = None, partial: bool = False, run_id: int | None = None) -> None:
        blk = self.active
        if blk is None:
            return
        self.done.append({"block": blk, "result": result, "t0": self.active_t0, "t1": self.elapsed(),
                          "partial": partial, "skipped": False, "run_id": run_id})
        self._close(blk)
        self._advance(blk, result)

    def skip(self) -> None:
        """Skip this sens: drops the current block and its partner blocks at the same sens."""
        blk = self.active or self.current()
        if blk is None:
            return
        self.active = blk
        group = [blk]
        for b in self.queue[self.queue.index(blk) + 1:]:
            if b.slot != blk.slot or b.stage != blk.stage:
                break
            group.append(b)
        for b in group:
            self.done.append({"block": b, "result": None, "t0": self.elapsed(), "t1": self.elapsed(),
                              "partial": False, "skipped": True, "run_id": None})
            self.queue.remove(b)
        self.active = None
        self.last_end = self.elapsed()
        self._advance(blk, None)

    def _close(self, blk: Block) -> None:
        self.queue.remove(blk)
        if blk.is_run:
            self.prev_slot = blk.slot
        self.last_end = self.elapsed()
        self.active = None

    # ---------- analysis ----------
    def _scored(self, kind: str) -> list[dict]:
        return [d for d in self.done if d["block"].kind == kind and d["block"].stage in SCORED
                and d["result"] and not d["skipped"]]

    def _levels(self) -> list[dict]:
        flicks = self._scored("flick")
        self.fat = fatigue([{"t_min": d["t0"] / 60, "cm360": d["block"].cm360,
                             "flicks_per_min": d["result"]["flick"]["flicks_per_min"],
                             "mean_abs_s": d["result"]["flick"]["mean_abs_s"]} for d in flicks], self.cfg)
        t_first = flicks[0]["t0"] / 60 if flicks else 0.0
        levels: dict[float, dict] = {}
        for d in flicks:
            l = levels.setdefault(round(d["block"].cm360, 3), {"cm360": d["block"].cm360, "s": [], "w": [],
                                                              "tracking": []})
            l["s"] += d["result"]["s"]
            l["w"].append(fatigue_weight(d["t0"] / 60, t_first, self.fat, self.cfg))
        for d in self._scored("tracking"):
            key = round(d["block"].cm360, 3)
            if key in levels:
                levels[key]["tracking"].append(d["result"]["tracking"])
        return [{**l, "weight": float(np.mean(l["w"]))} for l in levels.values()]

    def _reestimate(self) -> None:
        was_tired = self.fat["flag"]
        self.est = estimate(self._levels(), self.cfg, rng=np.random.default_rng(20261114), start_cm=self.start_cm)
        if self.fat["flag"] and not was_tired:
            self.messages.append(f"You look like you're tiring: flick speed is down about "
                                 f"{abs(self.fat['speed_pct_per_10min']):.0f}% per 10 minutes. Take a break if you "
                                 "can. Later runs count a bit less.")

    def _advance(self, blk: Block, result: dict | None) -> None:
        cfg_e = self.cfg["estimator"]
        if blk.kind in ("flick", "tracking") and blk.stage in SCORED and result:
            self._reestimate()
        if blk.stage == "refine" and blk.kind == "flick" and result \
                and result["flick"]["n"] < cfg_e["min_flicks_per_level"] and blk.slot not in self.repeated:
            self.repeated.add(blk.slot)
            self.queue.insert(0, repeat_of(blk, self.next_id))
            self.next_id += 1
            self.messages.append(f"Pretty noisy. One more at {self.sens(blk.cm360):.2f}.")

        n_refine = sum(1 for d in self.done if d["block"].stage == "refine" and d["result"])
        if blk.stage == "refine" and any(b.stage == "refine" for b in self.queue) \
                and self.est["confidence"] == "Locked in" and n_refine >= TIERS[self.tier]["min_refine"]:
            self.queue = [b for b in self.queue if b.stage != "refine"]
            self.messages.append("Nice, that's locked in. Skipping the remaining refine runs.")
        self._resolve()
        if not self.plan()[0]:
            self._wrap()

    def _resolve(self) -> None:
        """Stage changes follow the plan that still fits, not the wish list. Once a stage is over its
        leftover (dropped) blocks are removed so they can't come back out of order, and the next stage's
        sens values are filled in from the current estimate."""
        if self.active is not None or self.finished:
            return
        stages = {b.stage for b in self.plan()[0]}
        if self.balance_cm is None and not stages & {"warmup", "bracket", "drift"}:
            self.queue = [b for b in self.queue if b.stage not in ("warmup", "bracket", "drift")]
            bal = self.est["pick_cm"] if self.est["trend"] else self.start_cm
            self.balance_cm = float(np.clip(bal, self.start_cm * 0.5, self.start_cm * 2.0))
            for b in self.queue:
                if b.stage == "refine":
                    b.cm360 = slot_cm(b.slot, self.start_cm, self.balance_cm)
            stages = {b.stage for b in self.plan()[0]}
        if self.balance_cm is not None and self.pick_cm is None and "refine" not in stages:
            self.queue = [b for b in self.queue if b.stage != "refine"]
            self.pick_cm = float(self.est["pick_cm"] if self.est["trend"] else self.balance_cm)
            for b in self.queue:
                if b.slot == "pick":
                    b.cm360 = self.pick_cm

    def _wrap(self) -> None:
        if self.finished:
            return
        dropped = self.plan()[1]
        self.active = None
        self.finished = True
        self.verdict = self._verdict(dropped)

    # ---------- verdict ----------
    def _nearest(self, runs: list[dict], cm: float) -> dict | None:
        return min(runs, key=lambda d: abs(np.log(d["block"].cm360 / cm)), default=None)

    def _verdict(self, dropped: list[Block]) -> dict:
        self._reestimate()
        e = self.est
        pick, lo, hi = e["pick_cm"], e["lo_cm"], e["hi_cm"]
        notes = list(e["notes"])
        confirm_res = None
        flicks = self._scored("flick")
        cur = [d["result"]["flick"] for d in flicks if d["block"].stage == "confirm" and d["block"].slot == CURRENT]
        mine = [d["result"]["flick"] for d in flicks if d["block"].stage == "confirm" and d["block"].slot == "pick"]
        if not mine:                                   # Quick: the refine run at the balance point stands in
            mine = [d["result"]["flick"] for d in flicks if d["block"].stage == "refine" and d["block"].slot == "B"]
        if cur and mine and e["trend"]:
            confirm_res = confirm(mine, cur)
            if not confirm_res["accept"]:
                lo, hi = min(lo, self.start_cm), max(hi, self.start_cm)
                notes.append(f"At {self.sens(pick):.2f} your {' and '.join(confirm_res['worse'])} came out worse "
                             f"than at your current {self.sens(self.start_cm):.2f}, so the range is widened back "
                             "toward your current sens.")
        if dropped:
            words = sorted({DROP_WORDS[b.priority] for b in dropped})
            notes.append(f"Ran short on time, so I skipped {', '.join(words)}.")
        if self.fat["flag"]:
            notes.append("Signs of fatigue in the second half; later runs were weighted less.")
        x1 = [d["result"]["flick"]["balance"] for d in flicks if d["block"].slot == CURRENT
              and d["block"].stage in ("bracket", "drift", "drift2")]
        near = self._nearest(flicks, pick)
        near_t = self._nearest(self._scored("tracking"), pick)
        patterns = diagnose(near["result"]["flick"] if near else None,
                            near_t["result"]["tracking"] if near_t else None)
        return {
            "tier": self.tier, "game": self.game, "dpi": self.dpi, "yaw": self.yaw, "demo": self.demo,
            "method": e["method"], "trend": e["trend"],
            "start_cm": self.start_cm, "start_sens": self.sens(self.start_cm),
            "pick_cm": pick, "pick_sens": self.sens(pick),
            "lo_cm": lo, "hi_cm": hi, "lo_sens": self.sens(hi), "hi_sens": self.sens(lo),
            "confidence": e["confidence"], "halfwidth": e["halfwidth"], "balance_cm": e["balance_cm"],
            "shake_cm": e["shake_cm"],
            "levels": [{**r, "sens": self.sens(r["cm360"])} for r in e["levels"]],
            "confirm": confirm_res, "notes": notes, "fatigue": self.fat,
            "drift": (x1[-1] - x1[0]) if len(x1) >= 2 else None,
            "elapsed_s": self.elapsed(), "budget_s": TIERS[self.tier]["budget"],
            "runs": len(flicks) + len(self._scored("tracking")),
            "flicks": int(sum(d["result"]["flick"]["n"] for d in flicks)),
            "diagnosis": patterns, "plan": training_plan(patterns, self.game),
        }

    # ---------- UI state ----------
    def state(self) -> dict:
        kept, dropped = self.plan()
        cur = kept[0] if kept else None
        runs_done = sum(1 for d in self.done if d["block"].is_run)
        runs_left = sum(1 for b in kept if b.is_run)
        elapsed = self.elapsed()

        def view(b: Block, status: str) -> dict:
            return {"id": b.id, "stage": b.stage, "kind": b.kind, "slot": b.slot, "duration": b.duration,
                    "cm360": b.cm360, "sens": self.sens(b.cm360), "note": b.note, "status": status}

        plan = [view(d["block"], "skipped" if d["skipped"] else "done") for d in self.done]
        plan += [view(b, "current" if b is cur else "upcoming") for b in kept]
        plan += [view(b, "dropped") for b in dropped]
        notices = list(self.messages[-3:])
        if dropped and not self.finished:
            words = sorted({DROP_WORDS[b.priority] for b in dropped})
            notices.append(f"Short on time, so I'm skipping {', '.join(words)}.")
        return {
            "tier": self.tier, "tier_label": TIERS[self.tier]["label"], "demo": self.demo, "game": self.game,
            "budget_s": TIERS[self.tier]["budget"], "hard_cap_s": HARD_CAP, "elapsed_s": elapsed,
            "paused": self.paused_at is not None, "finished": self.finished,
            "running": self.active is not None,
            "run_elapsed_s": (elapsed - self.active_t0) if self.active is not None else 0.0,
            "block": view(cur, "current") if cur else None,
            "change_sens": bool(cur and cur.is_run and cur.slot != self.prev_slot),
            "test_index": runs_done + (1 if cur and cur.is_run else 0), "test_total": runs_done + runs_left,
            "plan": plan, "notices": notices,
            "confidence": {"label": self.est["confidence"], "fill": self.est["fill"]},
            "curve": [{"cm360": r["cm360"], "sens": self.sens(r["cm360"]), "balance": r["balance"], "n": r["n"]}
                      for r in self.est["levels"] if r["n"]],
            "estimate": {"pick_cm": self.est["pick_cm"], "pick_sens": self.sens(self.est["pick_cm"]),
                         "lo_cm": self.est["lo_cm"], "hi_cm": self.est["hi_cm"], "trend": self.est["trend"]},
            "overheads": {"change_s": self.oh.change, "restart_s": self.oh.restart},
            "fatigue": self.fat, "verdict": self.verdict,
        }


def sim_result(blk: Block, player: Player, cfg: dict, rng: np.random.Generator, hz: int = 1000,
               dpi: float = 800):
    """(trace, analysis) for one block played by the synthetic player. None for warmup/rest."""
    if not blk.is_run and blk.kind != "warmup":
        return None, None
    make = tracking_run if blk.kind == "tracking" else flick_run
    trace = make(player, blk.cm360, blk.duration if blk.is_run else 60.0, hz, dpi, rng)
    return trace, analyze_run(trace, "tracking" if blk.kind == "tracking" else "flick", cfg)


def simulate_session(tier: str, start_cm: float, player: Player, cfg: dict, seed: int = 0, hz: int = 1000,
                     change_s=(30.0, 90.0), skip: set[int] | None = None) -> tuple[Session, VirtualClock]:
    """Plays a whole session on a virtual clock. Used by the recovery/property tests and by Demo mode."""
    clock = VirtualClock()
    rng = np.random.default_rng(seed)
    s = Session(tier, start_cm, cfg, clock=clock, seed=seed, demo=True)
    i = 0
    while not s.finished:
        blk = s.current()
        if blk is None:
            s.begin()
            break
        if blk.is_run:
            clock.advance(rng.uniform(*change_s) if blk.slot != s.prev_slot else rng.uniform(5, 20))
        if skip and i in skip and blk.is_run:
            s.skip()
        elif s.begin() is not None:
            _, res = sim_result(s.active, player, cfg, rng, hz)
            clock.advance(s.active.duration)
            s.finish(res if s.active.is_run else None)
        i += 1
    return s, clock
