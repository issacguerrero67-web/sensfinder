"""Scheduler property tests and the simulator recovery test (the +/-15% claim)."""
import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from engine import config
from engine.session.runner import Session, VirtualClock, simulate_session
from engine.session.scheduler import HARD_CAP, MULTS, TIERS, Overheads, build_plan, cost, fit
from engine.sim.player import Player

CFG = config.load()
tiers = st.sampled_from(sorted(TIERS))


# ---------- scheduler ----------
@given(tier=tiers, seed=st.integers(0, 10_000), elapsed=st.floats(0, 4000), change=st.floats(10, 300),
       restart=st.floats(3, 120))
def test_fit_never_plans_past_the_budget(tier, seed, elapsed, change, restart):
    oh = Overheads(change, restart)
    kept, dropped = fit(build_plan(tier, np.random.default_rng(seed)), elapsed, tier, oh)
    limit = min(TIERS[tier]["budget"], HARD_CAP)
    assert not kept or elapsed + cost(kept, "x1", oh) <= limit
    assert len(kept) + len(dropped) == len(build_plan(tier, np.random.default_rng(seed)))


@given(tier=tiers, seed=st.integers(0, 10_000), elapsed=st.floats(0, 3600), change=st.floats(10, 300))
def test_fit_drops_in_priority_order(tier, seed, elapsed, change):
    """extra reps (3) go before tracking (2), tracking before refine neighbors (1), required blocks last."""
    kept, dropped = fit(build_plan(tier, np.random.default_rng(seed)), elapsed, tier, Overheads(change))
    order = [b.priority for b in dropped]
    optional = [p for p in order if p > 0]
    assert optional == sorted(optional, reverse=True)
    if 0 in order:
        assert order.index(0) == len(optional) and all(b.priority == 0 for b in kept)
    for p in set(optional):
        assert not any(b.priority > p for b in kept)


def test_plan_shapes():
    for tier, t in TIERS.items():
        plan = build_plan(tier, np.random.default_rng(1))
        bracket = [b for b in plan if b.stage == "bracket" and b.kind == "flick"]
        assert sorted(b.slot for b in bracket) == sorted(f"x{m:g}" for m in MULTS)      # one flick run per sens
        assert any(b.kind == "tracking" for b in plan) == t["tracking"]
        assert plan[0].stage == "warmup" and 180 <= plan[0].duration <= 240
        assert t["budget"] <= HARD_CAP
    assert TIERS["standard"]["budget"] == 45 * 60
    assert {tuple(b.slot for b in build_plan("standard", np.random.default_rng(s)) if b.stage == "bracket")
            for s in range(8)}.__len__() > 1                                              # order is randomised


@settings(max_examples=25, deadline=None)
@given(tier=tiers, seed=st.integers(0, 500), slow=st.floats(20, 240), skips=st.sets(st.integers(1, 30), max_size=3))
def test_a_session_never_runs_a_block_past_its_budget(tier, seed, slow, skips):
    s, clock = simulate_session(tier, 50.0, Player(cm_opt=42), CFG, seed=seed, change_s=(slow * 0.6, slow),
                                skip=skips)
    assert s.finished and s.verdict is not None
    budget = TIERS[tier]["budget"]
    assert all(d["t1"] <= budget + 1e-6 for d in s.done)
    assert max((d["t1"] for d in s.done), default=0) <= HARD_CAP
    scored = [d["block"] for d in s.done if d["block"].stage == "bracket" and d["block"].kind == "flick"]
    assert len({b.slot for b in scored}) == len(scored)                 # never two bracket flick runs at one sens


def test_slow_sens_changes_drop_blocks_in_order():
    s, _ = simulate_session("standard", 50.0, Player(cm_opt=42), CFG, seed=3, change_s=(150, 170))
    assert any("Ran short on time" in n for n in s.verdict["notes"])
    assert s.oh.change > 100                                             # it learned how slow the changes are
    assert sum(1 for d in s.done if d["block"].kind == "tracking") < len(MULTS)   # tracking runs were cut


def test_early_finish_skips_remaining_refine_runs():
    s, _ = simulate_session("precision", 50.0, Player(cm_opt=45), CFG, seed=1)
    refine = [d for d in s.done if d["block"].stage == "refine"]
    assert any("locked in" in m for m in s.messages)
    assert 3 <= len(refine) < len(TIERS["precision"]["refine"] + TIERS["precision"]["refine_extra"])


def test_skip_removes_the_sens_and_the_session_still_finishes():
    clock = VirtualClock()
    s = Session("standard", 50.0, CFG, clock=clock, seed=0)
    s.begin(); clock.advance(210); s.finish()                            # warmup
    first = s.current()
    assert first.stage == "bracket" and first.kind == "flick"
    s.skip()
    skipped = [d["block"] for d in s.done if d["skipped"]]
    assert [b.kind for b in skipped] == ["flick", "tracking"] and {b.slot for b in skipped} == {first.slot}
    assert s.current().slot != first.slot
    st_ = s.state()
    assert st_["block"]["status"] == "current" and st_["test_total"] > st_["test_index"] >= 1


def test_pause_stops_the_session_clock():
    clock = VirtualClock()
    s = Session("quick", 50.0, CFG, clock=clock)
    clock.advance(30); s.pause(); clock.advance(500); s.resume(); clock.advance(10)
    assert s.elapsed() == pytest.approx(40)


def test_hard_cap_wraps_with_best_so_far():
    clock = VirtualClock()
    s = Session("precision", 50.0, CFG, clock=clock)
    clock.advance(3599)
    assert s.begin() is None and s.finished and s.verdict["confidence"] == "Low"


# ---------- recovery: the full scheduled session against a known optimum ----------
def run_recovery(tier, n, hz, base_seed):
    rng = np.random.default_rng(base_seed)
    errs = []
    for i in range(n):
        opt = rng.uniform(25, 70)
        start = float(np.clip(opt * np.exp(rng.uniform(-0.4, 0.4)), 20, 80))      # current sens is off by up to ~1.5x
        s, clock = simulate_session(tier, start, Player(cm_opt=opt), CFG, seed=base_seed * 1000 + i, hz=hz)
        assert all(d["t1"] <= TIERS[tier]["budget"] for d in s.done)
        v = s.verdict
        assert v["hi_cm"] / v["pick_cm"] >= 1.1 - 1e-9 and v["lo_cm"] / v["pick_cm"] <= 0.9 + 1e-9
        errs.append(v["pick_cm"] / opt - 1)
    return np.array(errs)


def test_standard_session_recovers_the_optimum_within_15_percent():
    # 125 Hz is what Windows 11 actually delivers to a background listener while the game is in front
    errs = np.r_[run_recovery("standard", 30, 1000, 11), run_recovery("standard", 15, 4000, 12),
                 run_recovery("standard", 20, 125, 13)]
    rate = float(np.mean(np.abs(errs) <= 0.15))
    print(f"\nrecovery standard: {rate:.3f} within 15% over {len(errs)} seeds, bias {errs.mean():+.3f}, sd {errs.std():.3f}")
    assert len(errs) >= 50 and rate >= 0.90


@pytest.mark.parametrize("tier", ["quick", "precision"])
def test_other_tiers_recover_too(tier):
    errs = run_recovery(tier, 30, 1000, 21)
    assert float(np.mean(np.abs(errs) <= 0.15)) >= (0.90 if tier == "precision" else 0.80)
