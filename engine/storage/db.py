"""SQLite storage. Metadata and computed metrics live here; raw traces live next to it in runs/*.npz.

The beta's data/ folder is only ever read. Its trials.csv is copied row by row into beta_trials
(append-only, source 'beta'); running the import again adds only rows that are not there yet.
"""
from __future__ import annotations

import csv
import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, created_at TEXT, tier TEXT, game TEXT,
  hero_class TEXT, start_cm REAL, dpi REAL, yaw REAL, demo INTEGER);
CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, session_id INTEGER, created_at TEXT, kind TEXT, stage TEXT,
  sens REAL, cm360 REAL, duration REAL, packet_rate REAL, partial INTEGER, demo INTEGER, trace TEXT, metrics TEXT);
CREATE TABLE IF NOT EXISTS verdicts(id INTEGER PRIMARY KEY, session_id INTEGER, created_at TEXT, tier TEXT,
  game TEXT, hero_class TEXT, pick_sens REAL, pick_cm REAL, lo_cm REAL, hi_cm REAL, confidence TEXT, demo INTEGER,
  profile_name TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS plan_checks(verdict_id INTEGER, item_id TEXT, checked INTEGER,
  PRIMARY KEY(verdict_id, item_id));
CREATE TABLE IF NOT EXISTS beta_trials(row_no INTEGER PRIMARY KEY, op TEXT, id TEXT, timestamp TEXT, task TEXT,
  score REAL, accuracy REAL, hits REAL, shots REAL, sens REAL, cm360 REAL, dpi REAL, raw TEXT,
  source TEXT DEFAULT 'beta');
CREATE TABLE IF NOT EXISTS shots(id INTEGER PRIMARY KEY, created_at TEXT, hash TEXT UNIQUE, status TEXT,
  reason TEXT, warnings TEXT, fields TEXT);
CREATE TABLE IF NOT EXISTS demos(id INTEGER PRIMARY KEY, created_at TEXT, file TEXT, data TEXT);
"""


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class DB:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.con = sqlite3.connect(self.path, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.executescript(SCHEMA)
        self.con.commit()

    def q(self, sql: str, args=()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.con.execute(sql, args).fetchall()]

    def x(self, sql: str, args=()) -> int:
        with self.lock:
            cur = self.con.execute(sql, args)
            self.con.commit()
            return cur.lastrowid

    def insert(self, table: str, **cols) -> int:
        keys = ", ".join(cols)
        return self.x(f"INSERT INTO {table}({keys}) VALUES({', '.join('?' * len(cols))})", tuple(cols.values()))

    # ---- settings ----
    def get_json(self, key: str, default=None):
        rows = self.q("SELECT value FROM settings WHERE key=?", (key,))
        return json.loads(rows[0]["value"]) if rows else default

    def set_json(self, key: str, value) -> None:
        self.x("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               (key, json.dumps(value)))

    # ---- beta import ----
    def beta_count(self) -> int:
        return self.q("SELECT COUNT(*) AS n FROM beta_trials")[0]["n"]

    def import_beta(self, csv_path: Path | str) -> dict:
        """Reads the beta's trials.csv (never writes to it). Every row is kept, including edit/delete rows,
        keyed by its line number, so a second run only adds rows appended since."""
        with open(csv_path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        before = self.beta_count()
        with self.lock:
            self.con.executemany(
                "INSERT OR IGNORE INTO beta_trials(row_no, op, id, timestamp, task, score, accuracy, hits, shots,"
                " sens, cm360, dpi, raw) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [(i, r.get("op"), r.get("id"), r.get("timestamp"), r.get("task"), _num(r.get("score")),
                  _num(r.get("accuracy")), _num(r.get("hits")), _num(r.get("shots")), _num(r.get("sens")),
                  _num(r.get("cm360")), _num(r.get("dpi")), json.dumps(r)) for i, r in enumerate(rows)])
            self.con.commit()
        imported = self.beta_count() - before
        return {"imported": imported, "skipped": len(rows) - imported, "total": len(rows)}

    def beta_trials(self) -> list[dict]:
        """Current beta runs: the last version of each id, minus deleted ones (same rule the beta used)."""
        return self.q(
            "SELECT task, sens, cm360, score, accuracy, timestamp FROM beta_trials b WHERE row_no = "
            "(SELECT MAX(row_no) FROM beta_trials WHERE id = b.id) AND op != 'delete' ORDER BY timestamp")
