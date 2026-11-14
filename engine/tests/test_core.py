"""Units, segmentation edge cases, metric math on hand-built trajectories, estimator behaviour."""
import numpy as np
import pytest

from engine import config, training
from engine.analysis.estimator import confirm, estimate, fatigue
from engine.analysis.flicks import analyze_run, flick_metrics, segment
from engine.analysis.trace import Trace, packet_rate, to_grid
from engine.analysis.tracking import tracking_metrics
from engine.sim.player import Player, _to_trace, flick_run
from engine.units import cm360, counts_to_cm, dpi_from_swipe, sens_from_cm360, yaw_from_calibration

CFG = config.load()
HZ = 1000


# ---------- conversions ----------
def test_cm360_reference_points():
    assert cm360(1.0, 800) == pytest.approx(51.95, abs=0.01)
    assert cm360(2.0, 400) == pytest.approx(51.95, abs=0.01)
    assert cm360(1.2, 800) == pytest.approx(43.3, abs=0.01)


def test_conversion_round_trips():
    assert sens_from_cm360(cm360(1.37, 800), 800) == pytest.approx(1.37)
    assert counts_to_cm(800, 800) == pytest.approx(2.54)
    assert dpi_from_swipe(10 / 2.54 * 800, 10) == pytest.approx(800)
    counts = 360 / (0.022 * 1.5)                       # one full turn at sens 1.5 in CS2
    assert yaw_from_calibration(counts, 1.5) == pytest.approx(0.022)


# ---------- hand-built trajectories ----------
def build(parts, clicks_after=(), dpi=800):
    """parts: ('move', dx_cm, dy_cm, seconds) | ('hold', seconds) | ('click',). Returns a Trace."""
    pos, segs, clicks, n = np.zeros(2), [], [], 0
    for p in parts:
        if p[0] == "click":
            clicks.append(n / HZ)
            continue
        if p[0] == "hold":
            k = int(p[1] * HZ)
            segs.append(np.repeat(pos[None], k, 0))
        else:
            k = int(p[3] * HZ)
            tau = np.arange(1, k + 1) / k
            vec = np.array([p[1], p[2]], dtype=float)
            segs.append(pos + (10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5)[:, None] * vec)
            pos = pos + vec
        n += k
    segs.append(np.repeat(pos[None], 200, 0))
    path = np.concatenate(segs)
    return _to_trace(path, clicks, HZ, dpi, len(path) / HZ, np.random.default_rng(0), {})


def seg(trace):
    return segment(to_grid(trace, CFG), CFG)


def test_clean_flick_is_on_target():
    kept, dropped = seg(build([("hold", .2), ("move", 5, 0, .2), ("hold", .08), ("click",)]))
    assert len(kept) == 1 and not dropped
    f = kept[0]
    assert f["label"] == "on" and abs(f["s"]) < 0.02
    assert f["length"] == pytest.approx(5.0, abs=0.3)      # travel before the 15 cm/s onset isn't counted


def test_overflick_has_negative_correction():
    kept, _ = seg(build([("hold", .2), ("move", 6, 0, .2), ("hold", .1), ("move", -1, 0, .1), ("hold", .06), ("click",)]))
    assert len(kept) == 1
    assert kept[0]["label"] == "over" and kept[0]["s"] == pytest.approx(-1 / 6, abs=0.03)
    assert kept[0]["corrections"] == 1


def test_underflick_has_positive_correction():
    kept, _ = seg(build([("hold", .2), ("move", 0, 4, .2), ("hold", .1), ("move", 0, 1, .1), ("hold", .06), ("click",)]))
    assert kept[0]["label"] == "under" and kept[0]["s"] == pytest.approx(0.25, abs=0.03)


def test_sideways_correction_is_not_over_or_under():
    kept, _ = seg(build([("hold", .2), ("move", 5, 0, .2), ("hold", .1), ("move", 0, 0.6, .1), ("hold", .06), ("click",)]))
    assert kept[0]["label"] == "on"


def test_double_click_counts_once():
    kept, dropped = seg(build([("hold", .2), ("move", 5, 0, .2), ("hold", .08), ("click",), ("hold", .05), ("click",)]))
    assert len(kept) == 1 and [d["reason"] for d in dropped] == ["double click"]


def test_no_clicks_means_no_flicks():
    tr = build([("hold", .2), ("move", 5, 0, .2), ("hold", .3)])
    assert seg(tr) == ([], [])
    m = analyze_run(tr, "flick", CFG)
    assert m["flick"]["n"] == 0 and m["s"] == []


def test_slow_drift_is_not_a_flick():
    kept, dropped = seg(build([("hold", .2), ("move", 3, 0, 1.2), ("hold", .08), ("click",)]))   # peak ~4.7 cm/s
    assert not kept and dropped[0]["reason"] == "no movement"


def test_micro_jitter_is_too_short():
    kept, dropped = seg(build([("hold", .2), ("move", 0.6, 0, .05), ("hold", .08), ("click",)]))
    assert not kept and dropped[0]["reason"] == "too short"


def test_click_mid_motion_is_dropped():
    tr = build([("hold", .2), ("move", 6, 0, .2), ("hold", .2)])
    tr.clicks = np.array([0.2 + 0.1])                  # at peak speed
    kept, dropped = seg(tr)
    assert not kept and dropped[0]["reason"] == "clicked mid-motion"


def test_empty_trace_does_not_crash():
    tr = Trace([], [], [], [], 800, 1.0)
    m = analyze_run(tr, "tracking", CFG)
    assert m["flick"]["n"] == 0 and m["packet_rate"] == 0.0 and m["tracking"]["reversal_rate"] == 0.0


def test_flick_metrics_math():
    flicks = [{"s": s, "length": l, "corrections": c, "t_correct_ms": 100.0}
              for s, l, c in ((-0.10, 4, 1), (-0.05, 6, 1), (0.0, 5, 0), (0.08, 5, 2))]
    m = flick_metrics(flicks, CFG, 30.0)
    assert m["over_rate"] == 0.5 and m["under_rate"] == 0.25 and m["balance"] == 0.25
    assert m["median_s"] == pytest.approx(-0.025) and m["corrections"] == 1.0
    assert m["flicks_per_min"] == 8.0
    assert m["cv_len"] == pytest.approx(np.std([4, 6, 5, 5]) / 5)


def test_packet_rate_and_grid_are_rate_independent():
    pl, out = Player(cm_opt=45), {}
    for hz in (1000, 4000):
        tr = flick_run(pl, 45, 20, hz, rng=np.random.default_rng(3))
        assert packet_rate(tr) == pytest.approx(hz, rel=0.15)
        out[hz] = analyze_run(tr, "flick", CFG)["flick"]
    assert out[1000]["n"] == pytest.approx(out[4000]["n"], abs=6)


def test_trace_round_trip(tmp_path):
    tr = flick_run(Player(), 45, 5, rng=np.random.default_rng(1))
    tr.save(tmp_path / "run.npz")
    back = Trace.load(tmp_path / "run.npz")
    assert analyze_run(back, "flick", CFG) == analyze_run(tr, "flick", CFG)


# ---------- tracking ----------
def tracking_trace(wobble_cm=0.0):
    t = np.arange(10 * HZ) / HZ
    path = np.c_[8 * np.sin(2 * np.pi * 0.3 * t) + wobble_cm * np.sin(2 * np.pi * 9 * t), 0 * t]
    return _to_trace(path, [], HZ, 800, 10.0, np.random.default_rng(0), {})


def test_wobble_raises_shakiness():
    calm = tracking_metrics(to_grid(tracking_trace(0.0), CFG), CFG)
    shaky = tracking_metrics(to_grid(tracking_trace(0.25), CFG), CFG)
    assert calm["reversal_rate"] == pytest.approx(0.6, abs=0.2)         # a 0.3 Hz sine turns around 0.6x per s
    assert shaky["reversal_rate"] > calm["reversal_rate"] * 5
    assert shaky["band_share"] > calm["band_share"] + 0.2
    assert shaky["norm_jerk"] > calm["norm_jerk"]
    assert shaky["path_eff"] < calm["path_eff"] <= 1.0


# ---------- estimator ----------
def levels_around(opt, cms, n=120, slope=0.25, seed=0):
    rng = np.random.default_rng(seed)
    return [{"cm360": c, "s": list(rng.normal(slope * np.log(c / opt), 0.1, n))} for c in cms]


def test_estimator_finds_the_balance_point():
    e = estimate(levels_around(45, [30, 38, 50, 65, 83]), CFG, start_cm=50)
    assert e["trend"] and e["pick_cm"] == pytest.approx(45, rel=0.08)
    assert e["lo_cm"] <= e["pick_cm"] <= e["hi_cm"]


def test_displayed_range_is_never_narrower_than_ten_percent():
    e = estimate(levels_around(45, [30, 38, 45, 50, 65, 83], n=5000), CFG, start_cm=50)
    assert e["lo_cm"] <= e["pick_cm"] * 0.9 + 1e-9 and e["hi_cm"] >= e["pick_cm"] * 1.1 - 1e-9


def test_flat_signal_reports_no_trend_and_stays_put():
    e = estimate(levels_around(45, [30, 38, 50, 65, 83], slope=0.0), CFG, start_cm=50)
    assert not e["trend"] and e["pick_cm"] == 50 and e["confidence"] == "Low"
    assert e["lo_cm"] <= 30 and e["hi_cm"] >= 83


def test_too_little_data_is_low_confidence():
    e = estimate(levels_around(45, [40, 50], n=5), CFG, start_cm=50)
    assert not e["trend"] and e["confidence"] == "Low" and e["notes"]


def test_confirm_rejects_a_worse_pick():
    good = {"n": 100, "mean_abs_s": 0.05, "corrections": 0.8}
    bad = {"n": 100, "mean_abs_s": 0.09, "corrections": 1.2}
    assert confirm([good], [bad])["accept"]
    res = confirm([bad], [good])
    assert not res["accept"] and "flick error" in res["worse"]


def test_fatigue_flags_a_steady_decline():
    runs = [{"t_min": t, "cm360": 45 + (t % 3), "flicks_per_min": 90 * 0.99 ** t, "mean_abs_s": 0.06 * 1.01 ** t}
            for t in range(0, 30, 3)]
    assert fatigue(runs, CFG)["flag"]
    steady = [{**r, "flicks_per_min": 90, "mean_abs_s": 0.06} for r in runs]
    assert not fatigue(steady, CFG)["flag"]


# ---------- config + training ----------
def test_config_overrides_and_save(tmp_path):
    cfg = config.merged(CFG, {"flick": {"onset_speed": "22", "nope": 1}, "bogus": {"a": 1}})
    assert cfg["flick"]["onset_speed"] == 22.0 and "nope" not in cfg["flick"] and "bogus" not in cfg
    config.dump(cfg, tmp_path / "metrics.toml")
    assert config.load(tmp_path / "metrics.toml")["flick"]["onset_speed"] == 22.0
    assert CFG["flick"]["onset_speed"] == 15.0


ALLOWED = {"Headshot (Precision)", "Doubleshot", "Angleshot Entry ADS", "Spidershot 180", "Speedshot", "Sideclick",
           "Skyswitch Entry ADS", "Aimlabs Tracking", "Flytrack OW", "MFSI Entry ADS", "Motionshot (Precision)",
           "Twoshot Entry ADS", "Aimlabs Switching", "Controlswitch Apex", "Gridshot Ultimate"}
ALLOWED_MAPS = {"Aim Botz (uLLeticaL)", "training_aim_csgo2", "Fast Aim / Reflex Training (yolokas)",
                "Fast Warmup - Bot Training"}


def test_training_uses_only_confirmed_names():
    assert {t for p in training.PATTERNS.values() for t in p["tasks"]} == ALLOWED
    assert set(training.CS2_MAPS) == ALLOWED_MAPS
    cards = training.build_plan(training.diagnose({"n": 80, "over_rate": .5, "under_rate": .2, "cv_len": .3}, None))
    assert len(cards) == 3 and cards[0]["id"] == "over" and cards[-1]["title"] == "8-minute warm-up"
    assert all(c["suggested"] and c["retest_days"] == 7 for c in cards)
