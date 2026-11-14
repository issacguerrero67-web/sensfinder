"""API, storage, beta migration, Demo-mode session end to end, recompute-from-trace."""
import hashlib
import json
import time
import zipfile
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from engine.app import create_app
from engine.service import Engine
from engine.session.runner import VirtualClock
from engine.session.scheduler import TIERS
from engine.sim.player import Player, flick_run

TOKEN = "test-token"
ROOT = Path(__file__).resolve().parents[2]
BETA_CSV = ("schema_version,op,id,timestamp,task,score,accuracy,hits,shots,targets_killed,total_targets,"
            "total_shots,sens,ocr_sens,dpi,yaw,cm360,warmup_override,source,image_hash,note\n"
            "1,add,aaa11111,2026-11-10T10:00:00,Microshot CS2,851,77.0,97,126,97,99,126,1.2,1.2,800,0.022,43.295,,seed,,\n"
            "1,add,bbb22222,2026-11-10T10:05:00,Microshot CS2,900,80.0,100,125,100,101,125,1.4,1.4,800,0.022,37.11,,watcher:ocr,,\n"
            "1,edit,bbb22222,2026-11-10T10:05:00,Microshot CS2,910,80.0,100,125,100,101,125,1.4,1.4,800,0.022,37.11,,watcher:ocr,,\n"
            "1,add,ccc33333,2026-11-10T10:09:00,Microshot CS2,700,70.0,80,114,80,90,114,1.0,1.0,800,0.022,51.955,,watcher:ocr,,\n"
            "1,delete,ccc33333,,,,,,,,,,,,,,,,,,\n")


@pytest.fixture
def engine(tmp_path):
    e = Engine(tmp_path / "data", fake_capture=True, demo_scale=4000.0, start_io=False)
    e.opened = []
    e.opener = e.opened.append
    yield e
    e.close()


@pytest.fixture
def api(engine):
    c = TestClient(create_app(engine, TOKEN))
    c.headers["X-Sensfinder-Token"] = TOKEN
    return c


def play_demo(api, tier="standard", limit=120):
    st = api.post("/api/session/start", json={"tier": tier, "demo": True}).json()
    for _ in range(limit):
        if st["finished"]:
            return st
        st = api.post("/api/session/run/start").json()
        deadline = time.time() + 5
        while st["running"] and time.time() < deadline:
            time.sleep(0.004)
            st = api.get("/api/session").json()
        assert not st["running"], "block did not stop by itself"
    raise AssertionError("session did not finish")


def test_token_is_required(engine):
    c = TestClient(create_app(engine, TOKEN))
    assert c.get("/api/status").status_code == 401
    assert c.get("/api/status", headers={"X-Sensfinder-Token": TOKEN}).status_code == 200


def test_status_and_settings(api):
    st = api.get("/api/status").json()
    assert st["version"] == "1.0.0" and st["method"] == "v1.0 beta method"
    assert st["capture"]["source"] == "fake" and len(st["hotkeys"]) == 4 and not st["first_run_done"]
    s = api.put("/api/settings", json={"sens": 1.2, "first_run_done": True, "hotkeys": {"run": "Ctrl+Alt+R"}}).json()
    assert s["sens"] == 1.2 and s["hotkeys"]["run"] == "Ctrl+Alt+R" and s["hotkeys"]["next"] == "Ctrl+Alt+N"
    assert s["ollama"]["enabled"] is False and s["watch_screenshots"] is False and s["dpi"] == 800
    assert api.get("/api/settings").json() == s
    assert api.put("/api/settings", json={"hotkeys": {"run": "Banana"}}).status_code == 400
    assert api.put("/api/settings", json={"hotkeys": {"run": "Ctrl+Alt+N"}}).status_code == 400    # clash
    assert api.put("/api/settings", json={"dpi": -5}).status_code == 400


def test_rivals_is_locked_until_calibrated(api, engine):
    api.put("/api/settings", json={"game": "rivals", "sens": 2.0})
    r = api.post("/api/session/start", json={"tier": "quick", "demo": True})
    assert r.status_code == 400 and "Calibrate" in r.json()["detail"]
    engine.recorder.measure_start()
    for _ in range(100):
        engine.recorder.push(time.perf_counter(), 90, 0)            # 9000 counts for one turn
    cal = api.post("/api/measure/stop", json={"mode": "yaw", "sens": 2.0}).json()
    assert cal["yaw"] == pytest.approx(360 / (9000 * 2.0)) and cal["cm360"] == pytest.approx(9000 / 800 * 2.54)
    api.put("/api/settings", json={"rivals_yaw": cal["yaw"], "hero_class": "hitscan"})
    st = api.post("/api/session/start", json={"tier": "quick", "demo": True}).json()
    assert st["active"] and st["game"] == "rivals"


def test_dpi_wizard(api, engine):
    api.post("/api/measure/start")
    for _ in range(100):
        engine.recorder.push(time.perf_counter(), 31, 5)
    d = api.post("/api/measure/stop", json={"mode": "dpi", "distance_cm": 10}).json()
    assert d["suggested"] == 800 and d["dpi"] == pytest.approx(800, rel=0.03)
    api.post("/api/measure/start")
    assert api.post("/api/measure/stop", json={"mode": "dpi"}).status_code == 400


def test_capture_test_proves_packets_arrive(api, engine):
    assert api.get("/api/capture/test").json()["state"] == "idle"
    assert api.post("/api/capture/test", json={"seconds": 1}).json()["state"] == "running"
    for _ in range(300):
        engine.recorder.push(time.perf_counter(), 3, -2)
        time.sleep(0.001)
    time.sleep(0.8)
    done = api.get("/api/capture/test").json()
    assert done["state"] == "done" and done["ok"] and done["packets"] == 300 and done["distance_cm"] > 1
    assert len(api.get("/api/capture/live").json()["trail"]) == 200


def test_demo_standard_session_end_to_end(api, engine):
    api.put("/api/settings", json={"sens": 1.1})
    st = api.post("/api/session/start", json={"tier": "standard", "demo": True}).json()
    assert st["block"]["stage"] == "warmup" and st["budget_s"] == 2700 and st["time_scale"] == 4000
    assert api.post("/api/session/start", json={"tier": "quick"}).status_code == 409
    api.delete("/api/session")
    st = play_demo(api)
    v = st["verdict"]
    assert st["finished"] and st["verdict_id"] and v["demo"] and v["method"] == "v1.0 beta method"
    assert st["elapsed_s"] <= TIERS["standard"]["budget"]
    assert v["lo_cm"] <= v["pick_cm"] * 0.9 + 1e-6 and v["hi_cm"] >= v["pick_cm"] * 1.1 - 1e-6     # range, not a point
    assert v["lo_sens"] < v["pick_sens"] < v["hi_sens"] and v["confidence"] in ("Low", "OK", "Locked in")
    assert len(v["plan"]) == 3 and v["diagnosis"] and v["flicks"] > 500
    assert v["pick_cm"] == pytest.approx(engine.player.cm_opt, rel=0.2)
    assert any(r["shake"] is not None for r in v["levels"]) and all("score" in r for r in v["levels"])

    # storage: every stored run recomputes identically from its trace
    runs = api.get("/api/runs?limit=500").json()
    assert len(runs) == v["runs"] and {r["kind"] for r in runs} == {"flick", "tracking"}
    for r in runs:
        stored, again = engine.recompute(r["id"])
        assert stored == again

    latest = api.get("/api/verdicts/latest").json()
    vid = latest["id"]
    assert latest["verdict"]["pick_cm"] == v["pick_cm"] and api.get(f"/api/verdicts/{vid}").json()["id"] == vid
    row = api.post(f"/api/verdicts/{vid}/save", json={"name": "Main"}).json()
    assert row["profile_name"] == "Main" and api.get("/api/verdicts?game=cs2").json()[0]["id"] == vid
    assert api.get("/api/verdicts?game=rivals").json() == []

    cfg = api.post(f"/api/verdicts/{vid}/cfg").json()
    assert cfg["filename"] == "sensfinder_sens.cfg" and cfg["command"] == "exec sensfinder_sens"
    assert f"sensitivity {round(v['pick_sens'], 3):g}" in cfg["content"]
    assert Path(cfg["path"]).parent == engine.dir / "cfg"                 # written to our folder, never the game

    plan = api.get("/api/plan").json()
    item = plan["cards"][0]["items"][0]["id"]
    plan = api.post("/api/plan/check", json={"item_id": item, "checked": True}).json()
    assert plan["cards"][0]["items"][0]["checked"] and plan["retest_on"] > plan["created_at"]

    # Lab: raising the onset threshold removes flicks; nothing is written to the stored run
    rid = next(r["id"] for r in runs if r["kind"] == "flick")
    lab = api.post(f"/api/runs/{rid}/lab", json={}).json()
    strict = api.post(f"/api/runs/{rid}/lab", json={"overrides": {"flick": {"onset_speed": 40, "min_travel_cm": 4}}}).json()
    assert lab["hz"] == 100 and len(lab["t"]) == len(lab["speed"]) and lab["metrics"]["n"] == lab["run"]["flicks"]
    assert 0 < strict["metrics"]["n"] < lab["metrics"]["n"] and len(lab["sliders"]) == 9
    assert all(f["start"] <= f["peak"] <= f["p"] <= f["click"] for f in lab["flicks"])
    assert api.post("/api/runs/99999/lab", json={}).status_code == 404
    saved = api.post("/api/lab/save-default", json={"overrides": {"flick": {"onset_speed": 18}}}).json()
    assert Path(saved["path"]).parent == engine.dir and engine.cfg["flick"]["onset_speed"] == 18.0

    assert api.delete("/api/session").json() == {"active": False}
    assert api.get("/api/session").json() == {"active": False}


def test_skip_pause_and_end_early(api):
    st = api.post("/api/session/start", json={"tier": "quick", "demo": True}).json()
    st = api.post("/api/session/run/start").json()
    assert st["running"]
    st = api.post("/api/session/pause", json={"paused": True}).json()
    assert st["paused"] and st["running"]
    st = api.post("/api/session/pause", json={"paused": False}).json()
    st = api.post("/api/session/run/stop").json()                        # warmup ended early
    assert not st["running"] and st["block"]["stage"] == "bracket"
    first = st["block"]["slot"]
    st = api.post("/api/session/skip").json()
    assert st["block"]["slot"] != first and any(b["status"] == "skipped" for b in st["plan"])
    st = api.post("/api/session/end").json()
    assert st["finished"] and st["verdict"]["confidence"] == "Low" and st["verdict_id"]


def test_session_wraps_by_itself_when_the_cap_passes(api, engine):
    api.post("/api/session/start", json={"tier": "precision", "demo": True})
    engine.clock.advance(3601)
    st = api.get("/api/session").json()
    assert st["finished"] and st["verdict"] is not None and st["block"] is None


def test_real_capture_run_is_recorded_analyzed_and_kept_when_paused(api, engine):
    clock = VirtualClock()
    engine.recorder.clock = clock
    api.post("/api/session/start", json={"tier": "quick"})
    api.post("/api/session/run/start")
    api.post("/api/session/run/stop")                                    # warmup
    trace = flick_run(Player(cm_opt=45), 50, 30, rng=np.random.default_rng(2))
    api.post("/api/session/run/start")
    clock.advance(30)
    engine.source.play(trace)
    st = api.post("/api/session/run/stop").json()
    assert st["last_run"]["flicks"] > 20 and not st["last_run"]["partial"] and not st["demo"]
    api.post("/api/session/run/start")
    api.post("/api/capture/pause", json={"paused": True})
    assert api.get("/api/session").json()["capture_paused"]
    st = api.post("/api/session/run/stop").json()
    assert st["last_run"]["partial"] and "partial" in st["last_run"]["warning"]
    api.post("/api/capture/pause", json={"paused": False})
    runs = api.get("/api/runs").json()
    assert [r["partial"] for r in runs][:2] == [True, False] and len(runs) == 3      # warmup trace is stored too
    assert all((engine.dir / "runs").glob("*.npz"))


def test_beta_import_is_idempotent_and_never_touches_the_source(api, tmp_path):
    beta = tmp_path / "beta"
    beta.mkdir()
    csv = beta / "trials.csv"
    csv.write_text(BETA_CSV, encoding="utf-8")
    before = hashlib.sha256(csv.read_bytes()).hexdigest()
    api.put("/api/settings", json={"beta_dir": str(beta)})
    assert api.get("/api/beta").json() == {"available": True, "path": str(csv), "rows": 5, "imported": 0}
    assert api.post("/api/beta/import").json() == {"imported": 5, "skipped": 0, "total": 5}
    assert api.post("/api/beta/import").json() == {"imported": 0, "skipped": 5, "total": 5}
    with csv.open("a", encoding="utf-8") as f:                           # the beta logs one more run later
        f.write("1,add,ddd44444,2026-11-11T09:00:00,Microshot CS2,950,82.0,105,128,105,106,128,1.3,1.3,800,0.022,39.96,,watcher:ocr,,\n")
    assert api.post("/api/beta/import").json() == {"imported": 1, "skipped": 5, "total": 6}
    trials = api.get("/api/beta/trials").json()
    assert [(t["sens"], t["score"]) for t in trials] == [(1.2, 851.0), (1.4, 910.0), (1.3, 950.0)]   # edit applied, delete honoured
    assert hashlib.sha256(csv.read_bytes()).hexdigest() != before        # only because the test appended a row
    assert api.get("/api/status").json()["beta"]["imported"] == 6
    api.put("/api/settings", json={"beta_dir": str(tmp_path / "nope")})
    assert api.post("/api/beta/import").status_code == 404


@pytest.mark.skipif(not (ROOT / "data" / "trials.csv").exists(), reason="no beta data on this machine")
def test_real_beta_data_imports_without_loss_and_stays_untouched(api):
    src = ROOT / "data" / "trials.csv"
    before = (hashlib.sha256(src.read_bytes()).hexdigest(), src.stat().st_mtime_ns)
    listing = sorted(p.name for p in (ROOT / "data").iterdir())
    api.put("/api/settings", json={"beta_dir": str(ROOT / "data")})
    res = api.post("/api/beta/import").json()
    rows = max(0, len(src.read_text(encoding="utf-8").splitlines()) - 1)
    assert res["imported"] == res["total"] == rows > 0
    assert api.post("/api/beta/import").json()["imported"] == 0
    assert (hashlib.sha256(src.read_bytes()).hexdigest(), src.stat().st_mtime_ns) == before
    assert sorted(p.name for p in (ROOT / "data").iterdir()) == listing


def test_open_and_diagnostics(api, engine):
    assert api.post("/api/open", json={"what": "data"}).json() == {"ok": True}
    api.post("/api/open", json={"what": "releases"})
    assert engine.opened[0] == str(engine.dir) and engine.opened[1].endswith("/sensfinder/releases")
    assert api.post("/api/open", json={"what": "nope"}).status_code == 400
    path = api.post("/api/diagnostics/export").json()["path"]
    with zipfile.ZipFile(path) as z:
        info = z.read("info.json").decode()
    assert str(Path.home()) not in info and json.loads(info)["settings"]["dpi"] == 800


def test_ui_is_served_with_the_token_injected(engine, tmp_path):
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<html><head><!--SF_BOOT--></head><body>hi</body></html>", encoding="utf-8")
    (ui / "app.js").write_text("console.log(1)", encoding="utf-8")
    c = TestClient(create_app(engine, TOKEN, ui))
    html = c.get("/").text
    assert '"token": "test-token"' in html and "<!--SF_BOOT-->" not in html
    assert c.get("/app.js").status_code == 200
