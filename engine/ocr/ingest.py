"""Optional screenshot panel: one ingest path for the folder watcher, uploads and the hotkey.

Ported from the beta's watcher. One screenshot = at most one logged result:
  1. pixel hash: the same image is ingested once;
  2. same result: a second screenshot of the same results screen within 5 minutes is a duplicate;
  3. anything the parser is unsure about waits as "pending" until the user confirms it.
Only the parsed numbers and the hash are stored. The image itself is not kept.
Scores never enter the sens fit; they are shown next to it.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import queue
import threading
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image

from ..capture.source import fullscreen_app_running
from ..storage.db import DB, now_iso
from .parser import CRITICAL, FIELDS, MIN_CONF, parse_image, task_key

SENS_TOL = 0.005 + 1e-6
SAME_RESULT_WINDOW = timedelta(minutes=5)
OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
NOT_AIMLAB = "Couldn't read that. Make sure the results screen is fully visible."
_LOCK = threading.RLock()


def image_hash(img: Image.Image) -> str:
    """Hash of decoded pixels, so a re-encoded copy of the same screenshot still dedupes."""
    img = img.convert("RGB")
    h = hashlib.sha256(f"{img.size}".encode())
    h.update(img.tobytes())
    return h.hexdigest()


def view(row: dict) -> dict:
    f = json.loads(row["fields"] or "{}")
    return {"id": row["id"], "created_at": row["created_at"], "status": row["status"], "reason": row["reason"],
            "warnings": json.loads(row["warnings"] or "[]"),
            "fields": {k: f.get(k) for k in ("task", "score", "accuracy", "hits", "shots", "sens")}}


def list_shots(db: DB, limit: int = 100) -> list[dict]:
    return [view(r) for r in db.q("SELECT * FROM shots ORDER BY id DESC LIMIT ?", (limit,))]


def ollama_parse(img: Image.Image, model: str) -> dict | None:
    """Local vision fallback. Talks to Ollama on 127.0.0.1 only, and unloads the model right after."""
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "PNG")
    body = {"model": model, "stream": False, "format": "json", "keep_alive": 0,
            "images": [base64.b64encode(buf.getvalue()).decode()],
            "prompt": ("This is a screenshot. If it is an Aim Lab results screen, reply with a JSON object with keys: "
                       "is_aimlabs_results (true), task (top-left title), score (integer under SCORE), sens (number "
                       "above 'Sensitivity'), accuracy (number above 'Accuracy', no %), hits and shots (from "
                       "'Hits/Shots' like 97/126). Use null for anything unreadable. Otherwise reply "
                       "{\"is_aimlabs_results\": false}.")}
    try:
        req = urllib.request.Request(OLLAMA_URL, json.dumps(body).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:      # noqa: S310 - fixed localhost URL
            return json.loads(json.loads(r.read())["response"])
    except Exception:                                            # never let the optional path break ingest
        return None


def _fallback(ollama: dict | None):
    if not ollama or not ollama.get("enabled"):
        return None
    if fullscreen_app_running() and not ollama.get("allow_while_gaming"):
        return None                                              # don't fight a fullscreen game for the GPU
    return lambda img: ollama_parse(img, ollama.get("model") or "qwen3-vl:8b")


def _same_result(db: DB, fields: dict) -> bool:
    if any(fields.get(k) is None for k in ("score", "hits", "shots")):
        return False
    since = (datetime.now() - SAME_RESULT_WINDOW).isoformat(timespec="seconds")
    key = (task_key(str(fields.get("task") or "")), int(fields["score"]), int(fields["hits"]), int(fields["shots"]))
    for r in db.q("SELECT fields FROM shots WHERE status IN ('saved','pending') AND created_at >= ?", (since,)):
        f = json.loads(r["fields"])
        try:
            other = (task_key(str(f.get("task") or "")), int(f["score"]), int(f["hits"]), int(f["shots"]))
        except (TypeError, ValueError, KeyError):
            continue
        same_sens = fields.get("sens") is None or f.get("sens") is None or abs(f["sens"] - fields["sens"]) < SENS_TOL
        if other == key and same_sens:
            return True
    return False


def ingest(db: DB, img: Image.Image, sens: float | None = None, ollama: dict | None = None) -> dict:
    """Returns a Shot dict with status saved | pending | duplicate | rejected."""
    img.load()
    h = image_hash(img)
    with _LOCK:
        seen = db.q("SELECT * FROM shots WHERE hash=?", (h,))
        if seen:
            return {**view(seen[0]), "status": "duplicate", "reason": "This screenshot was already logged."}
        known = sorted({json.loads(r["fields"]).get("task") or "" for r in
                        db.q("SELECT fields FROM shots WHERE status='saved'")} - {""})
        run = parse_image(img, known, fallback=_fallback(ollama))
        if run is None:
            rid = db.insert("shots", created_at=now_iso(), hash=h, status="rejected", reason=NOT_AIMLAB,
                            warnings="[]", fields="{}")
            return view(db.q("SELECT * FROM shots WHERE id=?", (rid,))[0])
        fields = {k: getattr(run, k) for k in FIELDS}
        if _same_result(db, fields):
            return {"id": 0, "created_at": now_iso(), "status": "duplicate",
                    "reason": "Same result as one logged in the last 5 minutes.", "warnings": [],
                    "fields": {k: fields[k] for k in ("task", "score", "accuracy", "hits", "shots", "sens")}}
        warnings = list(run.warnings)
        if sens is not None and run.sens is not None and abs(run.sens - sens) > SENS_TOL:
            warnings.append(f"The screenshot shows sens {run.sens}, but this run was at {sens:.2f}. "
                            "Did the sens get changed in-game?")
        if run.needs_review and not warnings:
            unclear = [f for f in CRITICAL if getattr(run, f) is None or run.confidence.get(f, 0) < MIN_CONF]
            warnings.append("Not sure about: " + ", ".join(unclear or ["some fields"]))
        status = "pending" if (run.needs_review or warnings) else "saved"
        rid = db.insert("shots", created_at=now_iso(), hash=h, status=status, reason=None,
                        warnings=json.dumps(warnings), fields=json.dumps(fields))
        return view(db.q("SELECT * FROM shots WHERE id=?", (rid,))[0])


def confirm(db: DB, shot_id: int, fields: dict) -> dict | None:
    rows = db.q("SELECT * FROM shots WHERE id=?", (shot_id,))
    if not rows:
        return None
    merged = {**json.loads(rows[0]["fields"] or "{}"), **{k: v for k, v in fields.items() if k in FIELDS}}
    db.x("UPDATE shots SET status='saved', reason=NULL, warnings='[]', fields=? WHERE id=?",
         (json.dumps(merged), shot_id))
    return view(db.q("SELECT * FROM shots WHERE id=?", (shot_id,))[0])


def _open_when_ready(path: Path, timeout: float = 15.0):
    """Screenshots are written in pieces: wait until the file decodes and its size stopped changing."""
    start, last = time.time(), None
    while time.time() - start < timeout:
        try:
            s = path.stat()
            key = (s.st_size, s.st_mtime_ns)
            if key == last and key[0] > 0:
                img = Image.open(path)
                img.load()
                return img, key
            last = key
        except FileNotFoundError:
            if time.time() - start > 1.5:
                return None, None
        except Exception:
            last = None
        time.sleep(0.3)
    return None, None


class Watcher:
    """Watches a folder the user's own screenshots land in. It never captures the screen itself."""

    def __init__(self, folder: str | Path, on_image):
        self.folder, self.on_image = Path(folder), on_image
        self.q: queue.Queue = queue.Queue()
        self.observer = None
        self.running, self.error = False, None
        self.processed = 0
        self._seen: set[tuple] = set()

    def start(self) -> "Watcher":
        if not self.folder.is_dir():
            self.error = f"Folder not found: {self.folder}"
            return self
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
        q = self.q

        class Handler(FileSystemEventHandler):
            def on_created(self, e):
                if not e.is_directory:
                    q.put(e.src_path)

            def on_moved(self, e):
                if not e.is_directory:
                    q.put(e.dest_path)

        self.observer = Observer()
        self.observer.schedule(Handler(), str(self.folder), recursive=False)
        self.observer.daemon = True
        self.observer.start()
        threading.Thread(target=self._work, daemon=True).start()
        self.running = True
        return self

    def stop(self) -> None:
        if self.observer:
            self.observer.stop()
            self.observer.join(timeout=5)
        self.q.put(None)
        self.running = False

    def _work(self) -> None:
        while True:
            p = self.q.get()
            if p is None:
                return
            path = Path(p)
            if path.suffix.lower() != ".png":
                continue
            try:
                img, key = _open_when_ready(path)
                if img is None or (str(path), *key) in self._seen:
                    continue
                self._seen.add((str(path), *key))
                self.on_image(img)
                self.processed += 1
                self.error = None
            except Exception as e:                               # keep the thread alive
                self.error = f"{path.name}: {e}"
