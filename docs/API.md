# Engine API (v1.0)

The UI only ever talks to `http://127.0.0.1:<port>`. That is the whole contract between UI and engine, so
a different shell (Tauri in v1.1) can replace pywebview without touching the UI.

- Base path: `/api`. JSON in, JSON out. Errors: HTTP 4xx/5xx with `{"detail": "plain sentence"}`.
- Auth: every `/api` call sends header `X-Sensfinder-Token: <token>`. The engine injects
  `window.__SF__ = {token, version}` into `index.html` when it serves the UI. In Vite dev the proxy adds it.
- Timestamps are ISO-8601 local time (`2026-11-14T18:05:00`). Durations are seconds. Sens values are the
  in-game number; `cm360` is centimetres per full turn.
- The UI polls: `/api/session` every 250 ms while a session is open, `/api/status` every 2 s,
  `/api/capture/live` every 60 ms only while a live trail is on screen.

## Types

```ts
type Tier = "quick" | "standard" | "precision";
type Confidence = "Low" | "OK" | "Locked in";
type Game = "cs2" | "rivals";
type HeroClass = "hitscan" | "projectile" | "melee" | "tank" | "flex";

interface Settings {
  first_run_done: boolean;
  game: Game;
  hero_class: HeroClass | null;        // Rivals only
  dpi: number;                         // default 800
  polling_hz: number;                  // what the user says the mouse is set to (1000 default)
  sens: number;                        // current in-game sens
  yaw: number;                         // degrees per count at sens 1. CS2 = 0.022
  rivals_yaw: number | null;           // null until the Calibrate game wizard has run
  sens_change_s: number;               // assumed time to change sens in-game, default 60
  hotkeys: { run: string; next: string; pause: string; shot: string };   // e.g. "Ctrl+Alt+Enter"
  accent: string;                      // "#7C5CFF"
  reduce_motion: boolean;
  screenshots_dir: string;
  watch_screenshots: boolean;          // default false
  ollama: { enabled: boolean; model: string; allow_while_gaming: boolean };   // default off
  beta_dir: string;
}

interface Status {
  version: string;                     // "1.0.0"
  method: string;                      // "v1.0 beta method"
  capture: { available: boolean; source: "rawinput" | "fake"; paused: boolean;
             packet_rate: number;      // measured packets/s while moving, 0 if nothing seen yet
             low_rate: boolean;        // packet rate suspiciously low vs settings.polling_hz
             error: string | null };
  hotkeys: { id: "run" | "next" | "pause" | "shot"; label: string; combo: string; ok: boolean }[];
  first_run_done: boolean;
  beta: { available: boolean; rows: number; imported: number };
  session_active: boolean;
  data_dir: string;
  toasts: { id: number; kind: "info" | "good" | "warn" | "danger"; text: string }[];   // newest last, ids increase
}

interface Block {
  id: number;
  stage: "warmup" | "bracket" | "drift" | "rest" | "refine" | "confirm" | "drift2";
  kind: "warmup" | "flick" | "tracking" | "rest";
  slot: string;
  duration: number;                    // seconds
  cm360: number | null;
  sens: number | null;
  note: string;                        // "noisy" when the engine asked for one more at this sens
  status: "done" | "skipped" | "current" | "upcoming" | "dropped";
}

interface SessionState {
  active: true;
  id: number;
  tier: Tier; tier_label: string; demo: boolean; game: Game;
  budget_s: number; hard_cap_s: number; elapsed_s: number;
  time_scale: number;                  // 1 normally; >1 in Demo mode (session seconds per real second)
  paused: boolean; finished: boolean;
  running: boolean;                    // a block is in progress
  run_elapsed_s: number;               // session seconds into the running block
  block: Block | null;                 // what to do now (null when finished)
  change_sens: boolean;                // true when the user must set a new sens before this block
  test_index: number; test_total: number;     // "Test 3 of 7"
  plan: Block[];
  notices: string[];                   // plain-language lines from the engine, newest last
  confidence: { label: Confidence; fill: number };          // fill 0..1
  curve: { cm360: number; sens: number; balance: number; n: number }[];   // sparkline
  estimate: { pick_cm: number; pick_sens: number; lo_cm: number; hi_cm: number; trend: boolean };
  overheads: { change_s: number; restart_s: number };
  fatigue: { flag: boolean; speed_pct_per_10min: number; error_pct_per_10min: number };
  capture_paused: boolean;             // red-dot banner; the run in progress will be marked partial
  last_run: null | { kind: "flick" | "tracking"; sens: number; flicks: number; over_rate: number;
                     under_rate: number; packet_rate: number; partial: boolean; warning: string | null };
  verdict: Verdict | null;             // set when finished
  verdict_id: number | null;
}

interface LevelRow { cm360: number; sens: number; n: number; over_rate: number; under_rate: number;
                     balance: number; median_s: number; shake: number | null; weight: number }

interface PlanCard { id: string; title: string; why: string; metric: string; minutes: number;
                     suggested: true; retest_days: number;
                     items: { id: string; text: string; checked?: boolean }[] }

interface Verdict {
  tier: Tier; game: Game; dpi: number; yaw: number; demo: boolean;
  method: string; trend: boolean;
  start_cm: number; start_sens: number;
  pick_cm: number; pick_sens: number;
  lo_cm: number; hi_cm: number;        // recommended range in cm/360 (never narrower than +/-10%)
  lo_sens: number; hi_sens: number;    // same range as in-game sens (lo_sens < hi_sens)
  confidence: Confidence; halfwidth: number | null;
  balance_cm: number | null; shake_cm: number | null;
  levels: LevelRow[];
  confirm: null | { accept: boolean; worse: string[]; pick_error: number; current_error: number;
                    pick_corrections: number; current_corrections: number };
  notes: string[];
  fatigue: SessionState["fatigue"];
  drift: number | null;
  elapsed_s: number; budget_s: number; runs: number; flicks: number;
  diagnosis: ("over" | "under" | "shaky" | "inconsistent")[];
  plan: PlanCard[];
}

interface VerdictRow { id: number; created_at: string; tier: Tier; game: Game; hero_class: HeroClass | null;
                       pick_sens: number; pick_cm: number; lo_cm: number; hi_cm: number;
                       confidence: Confidence; demo: boolean; profile_name: string | null }

interface RunRow { id: number; session_id: number; created_at: string; kind: "flick" | "tracking" | "warmup";
                   stage: string; sens: number; cm360: number; duration: number; packet_rate: number;
                   partial: boolean; demo: boolean; flicks: number; over_rate: number; under_rate: number }
```

## Endpoints

### App
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/status` | | `Status` |
| GET | `/api/settings` | | `Settings` |
| PUT | `/api/settings` | partial `Settings` | `Settings` (hotkeys are re-registered) |
| POST | `/api/open` | `{what: "data" \| "screenshots" \| "releases" \| "cfg"}` | `{ok: true}` (opens a folder or the Releases page) |
| POST | `/api/diagnostics/export` | | `{path}` zip with logs, paths scrubbed |

### Capture and wizards
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/capture/live` | | `{packet_rate, packets, paused, trail: [x_cm, y_cm][], speed: number[]}` last 2 s at 10 ms steps, trail relative to its first point |
| POST | `/api/capture/pause` | `{paused: boolean}` | `{paused}` |
| POST | `/api/capture/test` | `{seconds?: 5}` | `CaptureTest` (starts it) |
| GET | `/api/capture/test` | | `CaptureTest` = `{state: "idle" \| "running" \| "done", seconds_left, packets, packet_rate, distance_cm, ok, message}` |
| POST | `/api/measure/start` | | `{ok: true}` (zeroes the counter) |
| POST | `/api/measure/stop` | `{mode: "dpi", distance_cm: 10}` or `{mode: "yaw", sens}` | dpi: `{counts, dpi, suggested}`; yaw: `{counts, yaw, cm360}` |

### Session
All return `SessionState`, except GET when nothing is open: `{active: false}`.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/session` | | poll |
| POST | `/api/session/start` | `{tier, demo?: boolean}` | 409 if one is already open |
| POST | `/api/session/run/start` | | starts the current block (run, warmup or rest). Runs stop by themselves when the time is up |
| POST | `/api/session/run/stop` | | ends the running block now (also "skip rest") |
| POST | `/api/session/skip` | | "Skip this sens" |
| POST | `/api/session/pause` | `{paused: boolean}` | |
| POST | `/api/session/end` | | wrap up now with best-so-far |
| DELETE | `/api/session` | | closes the session (after the verdict, or to discard) -> `{active: false}` |

Hotkeys call the same actions: `run` = run/start or run/stop, `next` = run/start for the next block,
`pause` = capture pause toggle, `shot` = screenshots/ingest-latest.

### Verdicts, profiles, plan
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/verdicts?game=&hero_class=` | | `VerdictRow[]`, newest first |
| GET | `/api/verdicts/latest` | | `{id, created_at, verdict: Verdict}` or `null` |
| GET | `/api/verdicts/{id}` | | `{id, created_at, hero_class, profile_name, verdict: Verdict}` |
| POST | `/api/verdicts/{id}/save` | `{name, hero_class?}` | `VerdictRow` (saved as a profile) |
| DELETE | `/api/verdicts/{id}` | | `{ok: true}` |
| POST | `/api/verdicts/{id}/cfg` | | `{filename: "sensfinder_sens.cfg", path, content, command: "exec sensfinder_sens"}` (CS2 only, written to the data folder, never to the game) |
| GET | `/api/plan` | | `{verdict_id, created_at, retest_on, cards: PlanCard[]}` or `null` |
| POST | `/api/plan/check` | `{item_id, checked}` | same as GET |

### Runs and Lab
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/runs?limit=100` | | `RunRow[]`, newest first |
| POST | `/api/runs/{id}/lab` | `{overrides?: {section: {key: value}}}` | `Lab` |
| POST | `/api/lab/save-default` | `{overrides}` | `{path}` |

```ts
interface Lab {
  run: RunRow;
  hz: number;                           // sample rate of t/speed (100)
  t: number[]; speed: number[];         // seconds, cm/s
  flicks: { start: number; peak: number; p: number; click: number;   // seconds
            s: number; label: "over" | "under" | "on"; vpeak: number; length: number }[];
  dropped: { click: number; reason: string }[];
  metrics: { n: number; over_rate: number; under_rate: number; balance: number; median_s: number;
             mean_abs_s: number; corrections: number; t_correct_ms: number; cv_len: number;
             flicks_per_min: number };
  sliders: { section: string; key: string; label: string; unit: string; min: number; max: number;
             step: number; value: number; default: number }[];
}
```

### Beta data, screenshots, demos
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/beta` | | `{available, path, rows, imported}` |
| POST | `/api/beta/import` | | `{imported, skipped, total}` (safe to run twice) |
| GET | `/api/beta/trials` | | `{task, sens, cm360, score, accuracy, timestamp}[]` |
| GET | `/api/screenshots` | | `{watching, folder, error, items: Shot[]}` |
| POST | `/api/screenshots/upload` | multipart `file` | `Shot` |
| POST | `/api/screenshots/ingest-latest` | | `Shot` |
| POST | `/api/screenshots/{id}/confirm` | `{fields}` | `Shot` |
| DELETE | `/api/screenshots/{id}` | | `{ok: true}` |
| GET | `/api/demos` | | `DemoResult[]` |
| POST | `/api/demos/analyze` | `{path, player?}` or multipart `file` | `DemoResult`. `player` picks who to analyze and is remembered (`settings.demo_player`); re-analyzing a path replaces its row |

```ts
interface Shot { id: number; created_at: string; status: "saved" | "pending" | "duplicate" | "rejected";
                 reason: string | null; warnings: string[];
                 fields: { task: string | null; score: number | null; accuracy: number | null;
                           hits: number | null; shots: number | null; sens: number | null } }

interface DemoResult { id: number; created_at: string; file: string; usable: boolean; message: string;
                       player: string | null; shots: number; flicks: number;
                       over_rate: number | null; under_rate: number | null; median_error_deg: number | null;
                       notes: string[];
                       path?: string;                              // full path, for re-analysis
                       players?: { name: string; shots: number }[] }  // everyone who fired, most first
```
