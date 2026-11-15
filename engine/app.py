"""FastAPI surface of the engine. Bound to 127.0.0.1 only, on a random free port, with a per-launch token.
The routes are the contract in docs/API.md."""
from __future__ import annotations

import argparse
import io
import json
import secrets
import socket
import threading
from pathlib import Path

import uvicorn
from fastapi import Body, FastAPI, File, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .service import ApiError, Engine

HOST = "127.0.0.1"


def create_app(engine: Engine, token: str | None = None, ui_dir: Path | str | None = None) -> FastAPI:
    app = FastAPI(title="Sensfinder engine", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    e = engine

    @app.middleware("http")
    async def auth(request: Request, call_next):
        if token and request.url.path.startswith("/api") and request.headers.get("x-sensfinder-token") != token:
            return JSONResponse({"detail": "Missing or wrong token."}, status_code=401)
        return await call_next(request)

    @app.exception_handler(ApiError)
    async def api_error(_: Request, err: ApiError):
        return JSONResponse({"detail": err.detail}, status_code=err.status)

    # ---- app ----
    app.get("/api/status")(lambda: e.status())
    app.get("/api/settings")(lambda: e.settings())

    @app.put("/api/settings")
    def put_settings(patch: dict = Body(default={})):
        return e.put_settings(patch)

    @app.post("/api/open")
    def open_(body: dict = Body(default={})):
        return e.open(body.get("what", ""))

    app.post("/api/diagnostics/export")(lambda: e.export_diagnostics())

    # ---- capture ----
    app.get("/api/capture/live")(lambda: e.live())
    app.get("/api/capture/test")(lambda: e.capture_test())

    @app.post("/api/capture/pause")
    def capture_pause(body: dict = Body(default={})):
        return e.set_capture_paused(bool(body.get("paused")))

    @app.post("/api/capture/test")
    def capture_test(body: dict = Body(default={})):
        return e.capture_test_start(float(body.get("seconds", 5)))

    app.post("/api/measure/start")(lambda: e.measure_start())

    @app.post("/api/measure/stop")
    def measure_stop(body: dict = Body(default={})):
        return e.measure_stop(body.get("mode", ""), float(body.get("distance_cm", 10)), body.get("sens"))

    # ---- session ----
    app.get("/api/session")(lambda: e.session_state())

    @app.post("/api/session/start")
    def session_start(body: dict = Body(default={})):
        return e.session_start(body.get("tier", "standard"), bool(body.get("demo")))

    app.post("/api/session/run/start")(lambda: e.run_start())
    app.post("/api/session/run/stop")(lambda: e.run_stop())
    app.post("/api/session/skip")(lambda: e.session_skip())
    app.post("/api/session/end")(lambda: e.session_end())
    app.delete("/api/session")(lambda: e.session_close())

    @app.post("/api/session/pause")
    def session_pause(body: dict = Body(default={})):
        return e.session_pause(bool(body.get("paused")))

    # ---- verdicts / plan ----
    @app.get("/api/verdicts")
    def verdicts(game: str | None = None, hero_class: str | None = None):
        return e.verdicts(game or None, hero_class or None)

    @app.get("/api/verdicts/latest")
    def verdict_latest():
        v = e.verdict()
        return None if v is None else {"id": v["id"], "created_at": v["created_at"], "verdict": v["verdict"]}

    app.get("/api/verdicts/{vid}")(lambda vid: e.verdict(int(vid)))
    app.delete("/api/verdicts/{vid}")(lambda vid: e.verdict_delete(int(vid)))
    app.post("/api/verdicts/{vid}/cfg")(lambda vid: e.verdict_cfg(int(vid)))

    @app.post("/api/verdicts/{vid}/save")
    def verdict_save(vid: int, body: dict = Body(default={})):
        return e.verdict_save(vid, body.get("name", ""), body.get("hero_class"))

    app.get("/api/plan")(lambda: e.plan())

    @app.post("/api/plan/check")
    def plan_check(body: dict = Body(default={})):
        return e.plan_check(str(body.get("item_id", "")), bool(body.get("checked")))

    # ---- runs / lab ----
    @app.get("/api/runs")
    def runs(limit: int = 100):
        return e.runs(limit)

    @app.post("/api/runs/{run_id}/lab")
    def lab(run_id: int, body: dict = Body(default={})):
        return e.lab(run_id, body.get("overrides"))

    @app.post("/api/lab/save-default")
    def lab_save(body: dict = Body(default={})):
        return e.lab_save_default(body.get("overrides"))

    # ---- beta / screenshots / demos ----
    app.get("/api/beta")(lambda: e.beta())
    app.post("/api/beta/import")(lambda: e.beta_import())
    app.get("/api/beta/trials")(lambda: e.db.beta_trials())
    app.get("/api/screenshots")(lambda: e.screenshots())
    app.post("/api/screenshots/ingest-latest")(lambda: e.ingest_latest())

    @app.post("/api/screenshots/upload")
    async def shot_upload(file: UploadFile = File(...)):
        from PIL import Image
        try:
            img = Image.open(io.BytesIO(await file.read()))
            img.load()
        except Exception as err:
            raise ApiError(400, "That file isn't an image.") from err
        return e.ingest_image(img)

    @app.post("/api/screenshots/{shot_id}/confirm")
    def shot_confirm(shot_id: int, body: dict = Body(default={})):
        from .ocr import ingest
        shot = ingest.confirm(e.db, shot_id, body.get("fields") or {})
        if shot is None:
            raise ApiError(404, "That screenshot entry doesn't exist.")
        return shot

    @app.delete("/api/screenshots/{shot_id}")
    def shot_delete(shot_id: int):
        e.db.x("DELETE FROM shots WHERE id=?", (shot_id,))
        return {"ok": True}

    app.get("/api/demos")(lambda: e.demos())

    @app.post("/api/demos/analyze")
    async def demo_analyze(request: Request):
        if "multipart/form-data" in request.headers.get("content-type", ""):
            upload = (await request.form()).get("file")
            if upload is None:
                raise ApiError(400, "No file was sent.")
            folder = e.dir / "demos"
            folder.mkdir(exist_ok=True)
            path = folder / Path(upload.filename or "upload.dem").name
            path.write_bytes(await upload.read())
            return e.demo_analyze(str(path))
        body = json.loads(await request.body() or b"{}")
        if not body.get("path"):
            raise ApiError(400, "Give the path to a .dem file.")
        return e.demo_analyze(body["path"], body.get("player") or None)

    # ---- the UI ----
    ui = Path(ui_dir) if ui_dir else None
    if ui and (ui / "index.html").exists():
        boot = f"<script>window.__SF__={json.dumps({'token': token or '', 'version': __version__})}</script>"

        @app.get("/", response_class=HTMLResponse)
        def index():
            html = (ui / "index.html").read_text(encoding="utf-8").replace("<!--SF_BOOT-->", boot)
            return HTMLResponse(html, headers={"Cache-Control": "no-store"})

        app.mount("/", StaticFiles(directory=ui), name="ui")
    return app


def free_port() -> int:
    with socket.socket() as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def serve(engine: Engine, ui_dir: Path | str | None, port: int | None = None, token: str | None = None):
    """Start the server on a background thread. Returns (server, thread, port, token)."""
    port = port or free_port()
    token = token if token is not None else secrets.token_urlsafe(24)
    server = uvicorn.Server(uvicorn.Config(create_app(engine, token, ui_dir), host=HOST, port=port,
                                           log_level="warning", access_log=False,
                                           log_config=None))    # the windowed exe has no stdout to log to
    thread = threading.Thread(target=server.run, name="api", daemon=True)
    thread.start()
    return server, thread, port, token


def main() -> None:
    ap = argparse.ArgumentParser(description="Sensfinder engine (dev entry point; the app uses shell/main.py)")
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--token", default=None, help="fixed token for dev; empty string disables the check")
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--ui", default=str(Path(__file__).resolve().parents[1] / "ui" / "dist"))
    ap.add_argument("--fake-capture", action="store_true")
    a = ap.parse_args()
    engine = Engine(a.data_dir, fake_capture=a.fake_capture)
    server, thread, port, token = serve(engine, a.ui, a.port or None, a.token)
    print(f"SENSFINDER_READY http://{HOST}:{port}/ token={token}", flush=True)
    try:
        thread.join()
    except KeyboardInterrupt:
        server.should_exit = True
    finally:
        engine.close()


if __name__ == "__main__":
    main()
