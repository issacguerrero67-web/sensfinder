"""Optional screenshot OCR (ported from the beta) and the CS2 demo analyzer (beta)."""
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

from engine.demos.analyzer import analyze_file, analyze_frames
from engine.ocr import ingest
from engine.ocr.parser import ParsedRun, parse_image, reconcile_score
from engine.storage.db import DB

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "legacy" / "tests" / "fixtures" / "example.png"


# ---------- OCR ----------
@pytest.mark.skipif(not FIXTURE.exists(), reason="beta fixture not present")
def test_beta_fixture_still_parses():
    run = parse_image(FIXTURE, ["Microshot CS2"])
    assert run is not None
    assert (run.task, run.score, run.hits, run.shots, run.sens) == ("Microshot CS2", 851, 97, 126, 1.2)
    assert run.accuracy == pytest.approx(77.0, abs=0.1) and not run.needs_review


def not_aimlab():
    img = Image.new("RGB", (900, 500), (20, 24, 30))
    d = ImageDraw.Draw(img)
    d.text((60, 60), "Quarterly report: revenue 1,442 and accuracy of forecast 77%", fill=(230, 230, 230))
    d.text((60, 120), "Sensitivity analysis attached", fill=(230, 230, 230))
    return img


def test_a_non_aim_lab_image_is_rejected(tmp_path):
    assert parse_image(not_aimlab()) is None
    shot = ingest.ingest(DB(tmp_path / "t.db"), not_aimlab())
    assert shot["status"] == "rejected" and "Couldn't read that" in shot["reason"]


def test_score_close_up_reconciliation():
    assert reconcile_score("1,442", "1,442", 0.99) == (1442, None, None)
    score, note, warning = reconcile_score("442", "1,442", 0.99)          # dropped leading digit recovered
    assert score == 1442 and note and not warning
    assert reconcile_score(",442", None)[2].startswith("Score looks cut off")
    assert "unclear" in reconcile_score("1442", "1492", 0.99)[2]


def fake_run(score=900, sens=1.4, conf=0.99, warnings=()):
    r = ParsedRun(task="Microshot CS2", score=score, accuracy=80.0, hits=100, shots=125, sens=sens)
    r.confidence = {k: conf for k in ("task", "score", "accuracy", "hits", "shots", "sens")}
    r.warnings = list(warnings)
    return r


def solid(color):
    return Image.new("RGB", (64, 64), color)


def test_ingest_dedupes_and_asks_when_unsure(tmp_path, monkeypatch):
    db = DB(tmp_path / "t.db")
    monkeypatch.setattr(ingest, "parse_image", lambda img, known, fallback=None: fake_run())
    first = ingest.ingest(db, solid((1, 2, 3)), sens=1.4)
    assert first["status"] == "saved" and first["fields"]["score"] == 900 and first["warnings"] == []
    assert ingest.ingest(db, solid((1, 2, 3)))["status"] == "duplicate"                 # same pixels
    assert ingest.ingest(db, solid((9, 9, 9)))["status"] == "duplicate"                 # same result, new capture

    monkeypatch.setattr(ingest, "parse_image", lambda img, known, fallback=None: fake_run(score=955))
    wrong_sens = ingest.ingest(db, solid((4, 4, 4)), sens=1.2)
    assert wrong_sens["status"] == "pending" and "1.20" in wrong_sens["warnings"][0]
    done = ingest.confirm(db, wrong_sens["id"], {"sens": 1.2, "score": 956, "bogus": 1})
    assert done["status"] == "saved" and done["fields"]["sens"] == 1.2 and done["fields"]["score"] == 956

    monkeypatch.setattr(ingest, "parse_image", lambda img, known, fallback=None: fake_run(score=1001, conf=0.5))
    unsure = ingest.ingest(db, solid((7, 7, 7)))
    assert unsure["status"] == "pending" and unsure["warnings"][0].startswith("Not sure about")
    assert [s["status"] for s in ingest.list_shots(db)] == ["pending", "saved", "saved"]
    assert ingest.confirm(db, 999, {}) is None


def test_vision_fallback_is_off_by_default_and_yields_to_fullscreen_games(monkeypatch):
    assert ingest._fallback(None) is None
    assert ingest._fallback({"enabled": False, "model": "qwen3-vl:8b"}) is None
    monkeypatch.setattr(ingest, "fullscreen_app_running", lambda: True)
    assert ingest._fallback({"enabled": True, "model": "qwen3-vl:8b", "allow_while_gaming": False}) is None
    assert ingest._fallback({"enabled": True, "model": "qwen3-vl:8b", "allow_while_gaming": True}) is not None
    monkeypatch.setattr(ingest, "fullscreen_app_running", lambda: False)
    assert ingest._fallback({"enabled": True, "model": "qwen3-vl:8b"}) is not None


# ---------- demos ----------
def synthetic_demo(errors_deg, with_bot=True):
    """Shooter at the origin flicks from -20 degrees onto a bot straight ahead, landing errors_deg past it."""
    ticks, yaw, fires = [], [], []
    t = 0
    for err in errors_deg:
        seq = [-20.0] * 20 + list(np.linspace(-20.0, err, 7)[1:]) + [err] * 3
        for y in seq:
            ticks.append(t)
            yaw.append(y)
            t += 1
        fires.append((t - 1, "me"))
    n = len(ticks)
    frames = {"me": {"tick": np.array(ticks), "x": np.zeros(n), "y": np.zeros(n), "z": np.zeros(n),
                     "pitch": np.zeros(n), "yaw": np.array(yaw)}}
    if with_bot:
        frames["bot"] = {"tick": np.array(ticks), "x": np.full(n, 800.0), "y": np.zeros(n), "z": np.zeros(n),
                         "pitch": np.zeros(n), "yaw": np.zeros(n), "alive": np.ones(n, bool)}
    return frames, fires


def test_demo_endpoint_error_is_signed_along_the_flick():
    frames, fires = synthetic_demo([2.0] * 6 + [-2.0] * 3 + [0.1] * 3)
    res = analyze_frames(frames, fires)
    assert res["usable"] and res["player"] == "me" and res["shots"] == 12 and res["flicks"] == 12
    assert res["over_rate"] == pytest.approx(0.5) and res["under_rate"] == pytest.approx(0.25)
    assert res["median_error_deg"] == pytest.approx(2.0, abs=0.05)
    assert "supporting evidence" in " ".join(res["notes"])


def test_demo_without_targets_is_a_clean_empty_state():
    frames, fires = synthetic_demo([2.0] * 8, with_bot=False)
    res = analyze_frames(frames, fires)
    assert not res["usable"] and "GOTV" in res["message"] and res["over_rate"] is None
    assert not analyze_frames(frames, [])["usable"]
    few = analyze_frames(*synthetic_demo([2.0] * 2))
    assert not few["usable"] and "Not enough" in few["message"]


def test_bad_demo_files_never_crash(tmp_path):
    junk = tmp_path / "broken.dem"
    junk.write_bytes(b"PBDEMS2\x00" + bytes(range(256)) * 20)
    for path in (junk, tmp_path / "missing.dem", tmp_path):
        res = analyze_file(str(path))
        assert res["usable"] is False and res["message"]
    txt = tmp_path / "notes.txt"
    txt.write_text("hi")
    assert "isn't a .dem" in analyze_file(str(txt))["message"]
