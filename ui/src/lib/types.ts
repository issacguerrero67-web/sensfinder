// Mirrors docs/API.md exactly. Do not add fields here that the engine does not send.
export type Tier = "quick" | "standard" | "precision";
export type Confidence = "Low" | "OK" | "Locked in";
export type Game = "cs2" | "rivals";
export type HeroClass = "hitscan" | "projectile" | "melee" | "tank" | "flex";

export interface Settings {
  first_run_done: boolean;
  game: Game;
  hero_class: HeroClass | null;
  dpi: number;
  polling_hz: number;
  sens: number;
  yaw: number;
  rivals_yaw: number | null;
  sens_change_s: number;
  hotkeys: { run: string; next: string; pause: string; shot: string };
  accent: string;
  reduce_motion: boolean;
  screenshots_dir: string;
  watch_screenshots: boolean;
  ollama: { enabled: boolean; model: string; allow_while_gaming: boolean };
  beta_dir: string;
}

export type ToastKind = "info" | "good" | "warn" | "danger";
export type HotkeyId = "run" | "next" | "pause" | "shot";

export interface Status {
  version: string;
  method: string;
  capture: {
    available: boolean; source: "rawinput" | "fake"; paused: boolean;
    packet_rate: number; low_rate: boolean; error: string | null;
  };
  hotkeys: { id: HotkeyId; label: string; combo: string; ok: boolean }[];
  first_run_done: boolean;
  beta: { available: boolean; rows: number; imported: number };
  session_active: boolean;
  data_dir: string;
  toasts: { id: number; kind: ToastKind; text: string }[];
}

export interface Block {
  id: number;
  stage: "warmup" | "bracket" | "drift" | "rest" | "refine" | "confirm" | "drift2";
  kind: "warmup" | "flick" | "tracking" | "rest";
  slot: string;
  duration: number;
  cm360: number | null;
  sens: number | null;
  note: string;
  status: "done" | "skipped" | "current" | "upcoming" | "dropped";
}

export interface Fatigue { flag: boolean; speed_pct_per_10min: number; error_pct_per_10min: number }

export interface SessionState {
  active: true;
  id: number;
  tier: Tier; tier_label: string; demo: boolean; game: Game;
  budget_s: number; hard_cap_s: number; elapsed_s: number;
  time_scale: number;
  paused: boolean; finished: boolean;
  running: boolean;
  run_elapsed_s: number;
  block: Block | null;
  change_sens: boolean;
  test_index: number; test_total: number;
  plan: Block[];
  notices: string[];
  confidence: { label: Confidence; fill: number };
  curve: { cm360: number; sens: number; balance: number; n: number }[];
  estimate: { pick_cm: number; pick_sens: number; lo_cm: number; hi_cm: number; trend: boolean };
  overheads: { change_s: number; restart_s: number };
  fatigue: Fatigue;
  capture_paused: boolean;
  last_run: null | {
    kind: "flick" | "tracking"; sens: number; flicks: number; over_rate: number;
    under_rate: number; packet_rate: number; partial: boolean; warning: string | null;
  };
  verdict: Verdict | null;
  verdict_id: number | null;
}
export type SessionPoll = SessionState | { active: false };

export interface LevelRow {
  cm360: number; sens: number; n: number; over_rate: number; under_rate: number;
  balance: number; median_s: number; shake: number | null; weight: number;
  score?: number | null;
}

export interface PlanCard {
  id: string; title: string; why: string; metric: string; minutes: number;
  suggested: true; retest_days: number;
  items: { id: string; text: string; checked?: boolean }[];
}

export interface Verdict {
  tier: Tier; game: Game; dpi: number; yaw: number; demo: boolean;
  method: string; trend: boolean;
  start_cm: number; start_sens: number;
  pick_cm: number; pick_sens: number;
  lo_cm: number; hi_cm: number;
  lo_sens: number; hi_sens: number;
  confidence: Confidence; halfwidth: number | null;
  balance_cm: number | null; shake_cm: number | null;
  levels: LevelRow[];
  confirm: null | {
    accept: boolean; worse: string[]; pick_error: number; current_error: number;
    pick_corrections: number; current_corrections: number;
  };
  notes: string[];
  fatigue: Fatigue;
  drift: number | null;
  elapsed_s: number; budget_s: number; runs: number; flicks: number;
  diagnosis: ("over" | "under" | "shaky" | "inconsistent")[];
  plan: PlanCard[];
}

export interface VerdictRow {
  id: number; created_at: string; tier: Tier; game: Game; hero_class: HeroClass | null;
  pick_sens: number; pick_cm: number; lo_cm: number; hi_cm: number;
  confidence: Confidence; demo: boolean; profile_name: string | null;
}
export interface VerdictFull {
  id: number; created_at: string; hero_class?: HeroClass | null; profile_name?: string | null; verdict: Verdict;
}

export interface RunRow {
  id: number; session_id: number; created_at: string; kind: "flick" | "tracking" | "warmup";
  stage: string; sens: number; cm360: number; duration: number; packet_rate: number;
  partial: boolean; demo: boolean; flicks: number; over_rate: number; under_rate: number;
}

export interface Lab {
  run: RunRow;
  hz: number;
  t: number[]; speed: number[];
  flicks: {
    start: number; peak: number; p: number; click: number;
    s: number; label: "over" | "under" | "on"; vpeak: number; length: number;
  }[];
  dropped: { click: number; reason: string }[];
  metrics: {
    n: number; over_rate: number; under_rate: number; balance: number; median_s: number;
    mean_abs_s: number; corrections: number; t_correct_ms: number; cv_len: number; flicks_per_min: number;
  };
  sliders: {
    section: string; key: string; label: string; unit: string; min: number; max: number;
    step: number; value: number; default: number;
  }[];
}
export type Overrides = Record<string, Record<string, number>>;

export interface CaptureLive { packet_rate: number; packets: number; paused: boolean; trail: [number, number][]; speed: number[] }
export interface CaptureTest {
  state: "idle" | "running" | "done"; seconds_left: number; packets: number; packet_rate: number;
  distance_cm: number; ok: boolean; message: string;
}

export interface Shot {
  id: number; created_at: string; status: "saved" | "pending" | "duplicate" | "rejected";
  reason: string | null; warnings: string[];
  fields: {
    task: string | null; score: number | null; accuracy: number | null;
    hits: number | null; shots: number | null; sens: number | null;
  };
}
export interface ShotList { watching: boolean; folder: string; error: string | null; items: Shot[] }

export interface DemoResult {
  id: number; created_at: string; file: string; usable: boolean; message: string;
  player: string | null; shots: number; flicks: number;
  over_rate: number | null; under_rate: number | null; median_error_deg: number | null;
  notes: string[];
}

export interface PlanState { verdict_id: number; created_at: string; retest_on: string; cards: PlanCard[] }
export interface CfgResult { filename: string; path: string; content: string; command: string }
export interface BetaInfo { available: boolean; path: string; rows: number; imported: number }
