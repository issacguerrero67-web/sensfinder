// In-browser stand-in for the Python engine. Implements every endpoint in docs/API.md with canned
// data and a scripted session. Used by ?mock=1, Vitest, Playwright and the screenshot script.
// Flags (?flags=a,b): ready, empty, rivals, beta, notrend, engine-down, capture-paused, low-rate, dpi-mismatch.
import type {
  Block, CaptureTest, DemoResult, Lab, LevelRow, Overrides, PlanCard, RunRow, SessionState, Settings,
  Shot, Status, Tier, Verdict, VerdictRow, Game, HeroClass,
} from "./types";
import { cm360, sensFromCm, CS2_YAW, fmtSens } from "./units";

export const mockClock = { now: () => Date.now() };

export class MockHttpError extends Error {
  constructor(public status: number, public detail: string) { super(detail); }
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (n: number, d = 2) => Number(n.toFixed(d));
const iso = (ms: number) => {
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const DAY = 86400_000;

const TIER_META: Record<Tier, { label: string; budget: number }> = {
  quick: { label: "Quick", budget: 1200 },
  standard: { label: "Standard", budget: 2700 },
  precision: { label: "Precision", budget: 3600 },
};

function planCards(): PlanCard[] {
  return [
    {
      id: "over", title: "Fix overshoot", why: "You fly past the target more often than you stop short.",
      metric: "Overflick rate", minutes: 12, suggested: true, retest_days: 7,
      items: [
        { id: "over-1", text: "Headshot (Precision) · 3 runs" },
        { id: "over-2", text: "Doubleshot · 3 runs" },
        { id: "over-3", text: "Angleshot Entry ADS · 2 runs" },
      ],
    },
    {
      id: "shaky", title: "Hold tracking", why: "Tracking gets jittery at the faster end of your range.",
      metric: "Tracking shakiness", minutes: 10, suggested: true, retest_days: 7,
      items: [
        { id: "shaky-1", text: "Aimlabs Tracking · 3 runs" },
        { id: "shaky-2", text: "Flytrack OW · 2 runs" },
        { id: "shaky-3", text: "Motionshot (Precision) · 2 runs" },
      ],
    },
    {
      id: "warm", title: "8-minute warm-up", why: "Same short routine before you play, so the first rounds aren't the warm-up.",
      metric: "Flick distance consistency", minutes: 8, suggested: true, retest_days: 7,
      items: [
        { id: "warm-1", text: "Gridshot Ultimate · 2 runs" },
        { id: "warm-2", text: "Twoshot Entry ADS · 2 runs" },
        { id: "warm-3", text: "Aim Botz (uLLeticaL) · 100 kills" },
      ],
    },
  ];
}

export interface MockOptions { flags?: string[]; speed?: number }

export function createMockEngine(opts: MockOptions = {}) {
  const flags = new Set(opts.flags ?? []);
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 30;
  const t0 = mockClock.now();
  let nextId = 100;

  const settings: Settings = {
    first_run_done: flags.has("ready"),
    game: flags.has("rivals") ? "rivals" : "cs2",
    hero_class: flags.has("rivals") ? "hitscan" : null,
    dpi: 800, polling_hz: 1000, sens: 1.0, yaw: CS2_YAW, rivals_yaw: null, sens_change_s: 60,
    hotkeys: { run: "Ctrl+Alt+Enter", next: "Ctrl+Alt+N", pause: "Ctrl+Alt+P", shot: "Ctrl+Alt+S" },
    accent: "#7C5CFF", reduce_motion: false,
    screenshots_dir: "C:\\Users\\you\\Pictures\\Screenshots", watch_screenshots: false,
    ollama: { enabled: false, model: "qwen3-vl:8b", allow_while_gaming: false },
    beta_dir: "C:\\Users\\you\\Documents\\projects\\sensfinder\\data",
  };
  const toasts: Status["toasts"] = [];
  const toast = (kind: Status["toasts"][number]["kind"], text: string) => toasts.push({ id: nextId++, kind, text });
  const beta = { available: flags.has("beta"), rows: flags.has("beta") ? 212 : 0, imported: 0 };
  let capturePaused = flags.has("capture-paused");

  // ---------- verdicts ----------
  function makeVerdict(tier: Tier, demo: boolean, game: Game, seed: number, withScore = false): Verdict {
    const rand = rng(seed);
    const yaw = game === "rivals" ? settings.rivals_yaw ?? 0.0175 : CS2_YAW;
    const start_cm = cm360(settings.sens, settings.dpi, yaw);
    const trend = !flags.has("notrend");
    const pick_cm = trend ? r2(start_cm * 0.83, 1) : r2(start_cm, 1);
    const lo_cm = trend ? r2(pick_cm * 0.88, 1) : r2(start_cm * 0.6, 1);
    const hi_cm = trend ? r2(pick_cm * 1.137, 1) : r2(start_cm * 1.67, 1);
    const s = (cm: number) => r2(sensFromCm(cm, settings.dpi, yaw), 2);
    const mults = [0.6, 0.77, 1, 1.3, 1.67];
    const cms = [...mults.map((m) => start_cm * m), ...(tier === "quick" ? [pick_cm] : [pick_cm * 0.85, pick_cm, pick_cm * 1.15])];
    const levels: LevelRow[] = cms.sort((a, b) => a - b).map((cm) => {
      const b = trend ? Math.max(-0.5, Math.min(0.5, 0.75 * Math.log(pick_cm / cm))) + (rand() - 0.5) * 0.05 : (rand() - 0.5) * 0.12;
      const lr = Math.log(cm / (pick_cm * 1.05));
      return {
        cm360: r2(cm, 1), sens: s(cm), n: 96 + Math.floor(rand() * 40),
        over_rate: r2(0.27 + b / 2, 3), under_rate: r2(0.27 - b / 2, 3), balance: r2(b, 3),
        median_s: r2(-b * 0.09, 3), shake: tier === "quick" ? null : r2(0.9 + lr * lr * 1.6 + rand() * 0.06, 2),
        weight: 1, score: withScore ? Math.round(61000 - lr * lr * 9000 + rand() * 1500) : null,
      };
    });
    return {
      tier, game, dpi: settings.dpi, yaw, demo, method: "v1.0 beta method", trend,
      start_cm: r2(start_cm, 2), start_sens: settings.sens,
      pick_cm, pick_sens: s(pick_cm), lo_cm, hi_cm, lo_sens: s(hi_cm), hi_sens: s(lo_cm),
      confidence: !trend ? "Low" : tier === "quick" ? "OK" : "Locked in", halfwidth: trend ? 0.12 : null,
      balance_cm: trend ? r2(pick_cm * 0.98, 1) : null, shake_cm: tier === "quick" ? null : r2(pick_cm * 1.05, 1),
      levels,
      confirm: tier === "quick" || !trend ? null
        : { accept: true, worse: [], pick_error: 0.041, current_error: 0.057, pick_corrections: 0.31, current_corrections: 0.44 },
      notes: trend
        ? ["Overflicks drop off once you go slower than about 40 cm/360.",
           tier === "quick" ? "Quick tier skips tracking, so the range leans on flicks only." : "Tracking was steadiest a little slower than the flick balance point."]
        : ["No clear balance point showed up, so the range stays wide.", "Your over and underflick rates were about even at every sens tested."],
      fatigue: { flag: false, speed_pct_per_10min: -0.8, error_pct_per_10min: 0.6 },
      drift: 0.012,
      elapsed_s: Math.round(TIER_META[tier].budget * 0.93), budget_s: TIER_META[tier].budget,
      runs: tier === "quick" ? 7 : tier === "standard" ? 19 : 24, flicks: levels.reduce((a, l) => a + l.n, 0),
      diagnosis: trend ? (tier === "quick" ? ["over"] : ["over", "shaky"]) : ["inconsistent"],
      plan: planCards(),
    };
  }

  interface Stored { id: number; created_at: string; hero_class: HeroClass | null; profile_name: string | null; verdict: Verdict }
  const verdicts: Stored[] = [];
  if (!flags.has("empty")) {
    verdicts.push(
      { id: 1, created_at: iso(t0 - 12 * DAY), hero_class: null, profile_name: null, verdict: { ...makeVerdict("quick", false, "cs2", 11), pick_cm: 46.8, pick_sens: 1.11, lo_cm: 39.5, hi_cm: 55.2 } },
      { id: 2, created_at: iso(t0 - 8 * DAY), hero_class: null, profile_name: "Main rifle", verdict: makeVerdict("standard", false, "cs2", 22, true) },
      { id: 3, created_at: iso(t0 - 8 * DAY + 3600_000), hero_class: "hitscan", profile_name: "Hitscan", verdict: { ...makeVerdict("standard", false, "rivals", 33), game: "rivals", pick_cm: 33.4, lo_cm: 29.4, hi_cm: 38.0 } },
      { id: 4, created_at: iso(t0 - 2 * DAY), hero_class: null, profile_name: null, verdict: makeVerdict("standard", true, "cs2", 44) },
    );
    verdicts.reverse(); // newest first, like the engine
  }
  const row = (v: Stored): VerdictRow => ({
    id: v.id, created_at: v.created_at, tier: v.verdict.tier, game: v.verdict.game, hero_class: v.hero_class,
    pick_sens: v.verdict.pick_sens, pick_cm: v.verdict.pick_cm, lo_cm: v.verdict.lo_cm, hi_cm: v.verdict.hi_cm,
    confidence: v.verdict.confidence, demo: v.verdict.demo, profile_name: v.profile_name,
  });
  const findVerdict = (id: number) => {
    const v = verdicts.find((x) => x.id === id);
    if (!v) throw new MockHttpError(404, "That result doesn't exist any more.");
    return v;
  };
  const checked = new Set<string>(flags.has("empty") ? [] : ["over-1", "warm-1"]);

  // ---------- runs + lab ----------
  const runs: RunRow[] = [];
  if (!flags.has("empty")) {
    const sensList = [1.0, 0.77, 1.3, 0.6, 1.67, 1.0];
    sensList.forEach((mult, i) => {
      const sens = r2(1 / mult, 2);
      runs.push({
        id: 40 - i, session_id: 9, created_at: iso(t0 - 2 * DAY - i * 150_000), kind: i === 5 ? "warmup" : i % 3 === 2 ? "tracking" : "flick",
        stage: i === 5 ? "warmup" : "bracket", sens, cm360: r2(cm360(sens, 800), 1), duration: 60, packet_rate: 987 + i * 3,
        partial: i === 3, demo: false, flicks: 104 + i * 5, over_rate: r2(0.2 + (1 / mult - 0.6) * 0.15, 3), under_rate: r2(0.34 - (1 / mult - 0.6) * 0.14, 3),
      });
    });
  }
  const SLIDERS: Lab["sliders"] = [
    { section: "flick", key: "start_speed", label: "Flick start speed", unit: "cm/s", min: 5, max: 40, step: 1, value: 15, default: 15 },
    { section: "flick", key: "min_travel", label: "Minimum travel", unit: "cm", min: 0.5, max: 5, step: 0.1, value: 1.5, default: 1.5 },
    { section: "flick", key: "min_gap_ms", label: "Gap since last click", unit: "ms", min: 50, max: 400, step: 10, value: 120, default: 120 },
    { section: "flick", key: "end_speed_frac", label: "Endpoint speed, share of peak", unit: "", min: 0.05, max: 0.3, step: 0.01, value: 0.1, default: 0.1 },
    { section: "flick", key: "threshold", label: "Over/under threshold", unit: "", min: 0.01, max: 0.1, step: 0.005, value: 0.03, default: 0.03 },
    { section: "flick", key: "max_click_speed_frac", label: "Max speed at click, share of peak", unit: "", min: 0.1, max: 0.6, step: 0.05, value: 0.3, default: 0.3 },
  ];
  const savedDefaults: Record<string, number> = {};
  function lab(id: number, overrides: Overrides = {}): Lab {
    const run = runs.find((x) => x.id === id);
    if (!run) throw new MockHttpError(404, "That run isn't stored any more.");
    const sliders = SLIDERS.map((s) => {
      const def = savedDefaults[s.key] ?? s.default;
      return { ...s, default: def, value: overrides[s.section]?.[s.key] ?? def };
    });
    const val = (k: string) => sliders.find((s) => s.key === k)!.value;
    const rand = rng(id * 7919);
    const hz = 100, n = run.duration * hz;
    const t = Array.from({ length: n }, (_, i) => i / hz);
    const speed = t.map(() => 0.6 + rand() * 1.4);
    const flicks: Lab["flicks"] = [], dropped: Lab["dropped"] = [];
    const bias = (run.sens - 1) * 0.05;
    let at = 0.4, lastClick = -1;
    while (at < run.duration - 0.8) {
      const dur = 0.16 + rand() * 0.12, vpeak = 22 + rand() * 90, corr = 0.06 + rand() * 0.16;
      const length = r2(vpeak * dur * 0.5, 2);
      const s = r2((rand() - 0.5) * 0.14 - bias, 3);
      const start = at, peak = at + dur * 0.45, p = at + dur, click = p + corr;
      const clickFrac = rand() < 0.06 ? 0.35 + rand() * 0.2 : rand() * 0.15;
      for (let i = Math.floor(start * hz); i <= Math.floor(click * hz) && i < n; i++) {
        const tt = i / hz;
        let v = tt <= p ? vpeak * Math.sin((Math.PI * (tt - start)) / dur) ** 2 : Math.abs(s) * vpeak * 2.2 * Math.sin((Math.PI * (tt - p)) / corr) ** 2;
        if (tt > p) v = Math.max(v, clickFrac * vpeak * ((tt - p) / corr));
        speed[i] = Math.max(speed[i], v);
      }
      const c = r2(click, 2);
      if (vpeak < val("start_speed") * 1.6) dropped.push({ click: c, reason: `never got above the start speed (${val("start_speed")} cm/s)` });
      else if (length < val("min_travel")) dropped.push({ click: c, reason: `travel under ${val("min_travel")} cm` });
      else if ((click - lastClick) * 1000 < val("min_gap_ms")) dropped.push({ click: c, reason: `under ${val("min_gap_ms")} ms since the last click` });
      else if (clickFrac > val("max_click_speed_frac")) dropped.push({ click: c, reason: "still moving fast at the click" });
      else {
        const th = val("threshold");
        flicks.push({ start: r2(start), peak: r2(peak), p: r2(p), click: c, s, label: s < -th ? "over" : s > th ? "under" : "on", vpeak: r2(vpeak, 1), length });
      }
      lastClick = click;
      at = click + 0.12 + rand() * 0.38;
    }
    const nf = flicks.length || 1;
    const over = flicks.filter((f) => f.label === "over").length / nf, under = flicks.filter((f) => f.label === "under").length / nf;
    const sorted = flicks.map((f) => f.s).sort((a, b) => a - b);
    return {
      run, hz, t, speed: speed.map((v) => r2(v, 1)), flicks, dropped,
      metrics: {
        n: flicks.length, over_rate: r2(over, 3), under_rate: r2(under, 3), balance: r2(over - under, 3),
        median_s: sorted[Math.floor(sorted.length / 2)] ?? 0, mean_abs_s: r2(flicks.reduce((a, f) => a + Math.abs(f.s), 0) / nf, 3),
        corrections: r2(0.38, 2), t_correct_ms: 142, cv_len: 0.41, flicks_per_min: r2(flicks.length / (run.duration / 60), 1),
      },
      sliders,
    };
  }

  // ---------- screenshots + demos ----------
  const shots: Shot[] = flags.has("empty") ? [] : [
    { id: 71, created_at: iso(t0 - 2 * DAY), status: "saved", reason: null, warnings: [],
      fields: { task: "Gridshot Ultimate", score: 61240, accuracy: 0.912, hits: 92, shots: 101, sens: 1.0 } },
    { id: 72, created_at: iso(t0 - 2 * DAY + 240_000), status: "pending", reason: "low_confidence", warnings: ["Accuracy was hard to read. Check it before saving."],
      fields: { task: "Twoshot Entry ADS", score: 48310, accuracy: 0.87, hits: 64, shots: null, sens: 1.3 } },
    { id: 73, created_at: iso(t0 - 2 * DAY + 500_000), status: "rejected", reason: "not_results_screen", warnings: [],
      fields: { task: null, score: null, accuracy: null, hits: null, shots: null, sens: null } },
  ];
  let watching = false;
  const demos: DemoResult[] = flags.has("empty") ? [] : [{
    id: 81, created_at: iso(t0 - 3 * DAY), file: "aimbotz_gotv_02.dem", usable: true, message: "Read 412 shots against bots.",
    player: "issac", shots: 412, flicks: 188, over_rate: 0.31, under_rate: 0.22, median_error_deg: 1.4,
    notes: ["64-tick sampling is coarse, so this is endpoint error only.", "Bot head height assumed: 64 units standing, 46 crouched."],
  }];

  // ---------- capture ----------
  let testStart: number | null = null, testSeconds = 5;
  function captureTest(): CaptureTest {
    if (testStart == null) return { state: "idle", seconds_left: 0, packets: 0, packet_rate: 0, distance_cm: 0, ok: false, message: "" };
    const el = (mockClock.now() - testStart) / 1000;
    const done = el >= testSeconds, e = Math.min(el, testSeconds);
    const rate = flags.has("low-rate") ? 118 : 991;
    return {
      state: done ? "done" : "running", seconds_left: r2(Math.max(0, testSeconds - el), 1), packets: Math.round(e * rate),
      packet_rate: rate, distance_cm: r2(e * 21.4, 1), ok: done,
      message: done ? `Capture works. Saw ${Math.round(e * rate).toLocaleString("en-US")} packets at about ${rate}/s.` : "Move your mouse around.",
    };
  }
  function live() {
    const now = mockClock.now() / 1000;
    const trail: [number, number][] = [], sp: number[] = [];
    const f = (tt: number): [number, number] => [5 * Math.sin(tt * 2.1) + 2.2 * Math.sin(tt * 5.3), 3.2 * Math.cos(tt * 1.7) + 1.4 * Math.sin(tt * 4.1)];
    const [x0, y0] = f(now - 2);
    for (let i = 0; i < 200; i++) {
      const tt = now - 2 + i * 0.01, [x, y] = f(tt);
      trail.push([r2(x - x0), r2(y - y0)]);
      sp.push(r2(capturePaused ? 0 : 70 * Math.max(0, Math.sin(tt * 5.6)) ** 6 + 8 * Math.abs(Math.sin(tt * 17)), 1));
    }
    return { packet_rate: capturePaused ? 0 : flags.has("low-rate") ? 118 : 991, packets: Math.round((now % 1000) * 991), paused: capturePaused, trail, speed: sp };
  }

  // ---------- session ----------
  interface Sess {
    id: number; tier: Tier; demo: boolean; plan: Block[]; idx: number; running: boolean; runElapsed: number;
    elapsed: number; paused: boolean; finished: boolean; lastTick: number; notices: string[];
    lastRun: SessionState["last_run"]; verdict: Verdict | null; verdictId: number | null;
    prevSens: number | null; change: boolean; startCm: number; partial: boolean;
  }
  let sess: Sess | null = null;

  function buildPlan(tier: Tier, startCm: number): Block[] {
    const yaw = settings.game === "rivals" ? settings.rivals_yaw ?? 0.0175 : CS2_YAW;
    const pick = startCm * 0.83;
    const out: Block[] = [];
    const add = (stage: Block["stage"], kind: Block["kind"], slot: string, duration: number, cm: number | null, note = "") =>
      out.push({ id: out.length + 1, stage, kind, slot, duration, cm360: cm == null ? null : r2(cm, 1),
        sens: cm == null ? null : r2(sensFromCm(cm, settings.dpi, yaw), 2), note, status: "upcoming" });
    add("warmup", "warmup", "warmup", 210, startCm);
    for (const m of [1.3, 0.6, 1.0, 1.67, 0.77]) {
      add("bracket", "flick", `x${m}`, 60, startCm * m);
      if (tier !== "quick") add("bracket", "tracking", `x${m}`, 60, startCm * m);
    }
    if (tier !== "quick") add("drift", "flick", "x1.0", 60, startCm);
    add("rest", "rest", "rest", 180, null);
    if (tier === "quick") { add("refine", "flick", "A", 60, pick); add("refine", "flick", "A", 60, pick, "noisy"); }
    else {
      const seq = tier === "standard" ? [1, 0.85, 0.85, 1] : [0.85, 1, 1.15, 1.15, 1, 0.85];
      seq.forEach((m, i) => add("refine", "flick", "ABC"[i % 3], 60, pick * m, i === 2 ? "noisy" : ""));
      const conf = tier === "standard" ? 4 : 6;
      for (let i = 0; i < conf; i++) add("confirm", "flick", i % 2 ? "current" : "pick", 60, i % 2 ? startCm : pick);
      if (tier === "precision") add("drift2", "flick", "x1.0", 60, startCm);
    }
    return out;
  }
  const isTest = (b: Block) => b.kind === "flick" || b.kind === "tracking";

  function enter(s: Sess) {
    const b = s.plan[s.idx];
    b.status = "current";
    s.change = b.sens != null && b.kind !== "warmup" && b.sens !== s.prevSens;
    if (b.note === "noisy") s.notices.push(`Pretty noisy. One more at ${fmtSens(b.sens)}.`);
    if (b.kind === "rest") s.notices.push("Bracket done. Take three minutes away from the mouse.");
    if (b.stage === "confirm" && s.plan[s.idx - 1]?.stage !== "confirm") s.notices.push("Last part: your pick against your current sens.");
  }
  function advance(s: Sess) {
    s.running = false; s.runElapsed = 0;
    let i = s.idx + 1;
    while (i < s.plan.length && s.plan[i].status !== "upcoming") i++;
    if (i >= s.plan.length) return finish(s);
    s.idx = i;
    enter(s);
  }
  function finish(s: Sess) {
    if (s.finished) return;
    s.plan.forEach((b) => { if (b.status === "upcoming" || b.status === "current") b.status = "dropped"; });
    s.running = false; s.finished = true;
    const v = makeVerdict(s.tier, s.demo, settings.game, s.id);
    v.elapsed_s = Math.round(s.elapsed);
    v.runs = s.plan.filter((b) => isTest(b) && b.status === "done").length;
    s.verdict = v; s.verdictId = nextId++;
    verdicts.unshift({ id: s.verdictId, created_at: iso(mockClock.now()), hero_class: settings.game === "rivals" ? settings.hero_class : null, profile_name: null, verdict: v });
    toast("good", v.confidence === "Locked in" ? "Nice, that's locked in." : "Session done. Your range is ready.");
  }
  function complete(s: Sess) {
    const b = s.plan[s.idx];
    b.status = "done";
    if (isTest(b)) {
      const cm = b.cm360!, bal = 0.75 * Math.log((s.startCm * 0.83) / cm);
      const flicks = b.kind === "flick" ? 98 + ((b.id * 13) % 34) : 0;
      s.lastRun = {
        kind: b.kind as "flick" | "tracking", sens: b.sens!, flicks, over_rate: r2(0.27 + bal / 2, 3), under_rate: r2(0.27 - bal / 2, 3),
        packet_rate: 991, partial: s.partial, warning: s.partial ? "Capture was paused for part of this run." : null,
      };
      runs.unshift({
        id: nextId++, session_id: s.id, created_at: iso(mockClock.now()), kind: b.kind as "flick" | "tracking", stage: b.stage,
        sens: b.sens!, cm360: cm, duration: b.duration, packet_rate: 991, partial: s.partial, demo: s.demo, flicks,
        over_rate: s.lastRun.over_rate, under_rate: s.lastRun.under_rate,
      });
      s.prevSens = b.sens;
    }
    s.partial = false;
    advance(s);
  }
  function tick() {
    const s = sess;
    if (!s) return;
    const now = mockClock.now(), dt = ((now - s.lastTick) / 1000) * speed;
    s.lastTick = now;
    if (!s.running || s.paused || s.finished) return;
    if (capturePaused) s.partial = true;
    const b = s.plan[s.idx], left = b.duration - s.runElapsed, used = Math.min(dt, left);
    s.runElapsed += used; s.elapsed += used;
    if (s.runElapsed >= b.duration - 1e-6) complete(s);
  }
  function state(): SessionState | { active: false } {
    tick();
    const s = sess;
    if (!s) return { active: false };
    const tests = s.plan.filter((b) => isTest(b) && b.status !== "dropped");
    const doneTests = tests.filter((b) => b.status === "done" || b.status === "skipped").length;
    const cur = s.finished ? null : s.plan[s.idx];
    const byCm = new Map<number, { cm360: number; sens: number; balance: number; n: number }>();
    for (const b of s.plan) {
      if (b.kind !== "flick" || b.status !== "done") continue;
      const prev = byCm.get(b.cm360!);
      const bal = Math.max(-0.5, Math.min(0.5, 0.75 * Math.log((s.startCm * 0.83) / b.cm360!))) + (((b.id * 37) % 11) - 5) * 0.006;
      byCm.set(b.cm360!, { cm360: b.cm360!, sens: b.sens!, balance: r2(prev ? (prev.balance + bal) / 2 : bal, 3), n: (prev?.n ?? 0) + 110 });
    }
    const curve = [...byCm.values()].sort((a, b) => a.cm360 - b.cm360);
    const cap = s.tier === "quick" ? 0.78 : 1;
    const fill = s.finished ? cap : Math.min(cap, tests.length ? (doneTests / tests.length) * cap : 0);
    const trend = curve.length >= 3 && !flags.has("notrend");
    const pick = r2(trend ? s.startCm * 0.83 : s.startCm, 1);
    const yaw = settings.game === "rivals" ? settings.rivals_yaw ?? 0.0175 : CS2_YAW;
    return {
      active: true, id: s.id, tier: s.tier, tier_label: TIER_META[s.tier].label, demo: s.demo, game: settings.game,
      budget_s: TIER_META[s.tier].budget, hard_cap_s: 3600, elapsed_s: r2(s.elapsed, 1), time_scale: speed,
      paused: s.paused, finished: s.finished, running: s.running, run_elapsed_s: r2(s.runElapsed, 1),
      block: cur ? { ...cur } : null, change_sens: !!cur && s.change && !s.running,
      test_index: Math.min(tests.length, doneTests + (cur && isTest(cur) ? 1 : 0)) || 1, test_total: tests.length,
      plan: s.plan.map((b) => ({ ...b })), notices: [...s.notices],
      confidence: { label: fill < 0.45 ? "Low" : fill < 0.85 ? "OK" : "Locked in", fill: r2(fill, 3) },
      curve,
      estimate: { pick_cm: r2(pick, 1), pick_sens: r2(sensFromCm(pick, settings.dpi, yaw), 2), lo_cm: r2(trend ? pick * 0.88 : s.startCm * 0.6, 1), hi_cm: r2(trend ? pick * 1.137 : s.startCm * 1.67, 1), trend },
      overheads: { change_s: settings.sens_change_s, restart_s: 8 },
      fatigue: { flag: false, speed_pct_per_10min: -0.8, error_pct_per_10min: 0.6 },
      capture_paused: capturePaused, last_run: s.lastRun, verdict: s.verdict, verdict_id: s.verdictId,
    };
  }
  const need = () => {
    tick();
    if (!sess) throw new MockHttpError(409, "No session is open.");
    return sess;
  };

  // ---------- router ----------
  function status(): Status {
    tick();
    return {
      version: "1.0.0", method: "v1.0 beta method",
      capture: { available: true, source: "fake", paused: capturePaused, packet_rate: flags.has("low-rate") ? 118 : 991, low_rate: flags.has("low-rate"), error: null },
      hotkeys: [
        { id: "run", label: "Start / stop run", combo: settings.hotkeys.run, ok: true },
        { id: "next", label: "Next sens", combo: settings.hotkeys.next, ok: true },
        { id: "pause", label: "Pause capture", combo: settings.hotkeys.pause, ok: true },
        { id: "shot", label: "Ingest latest screenshot", combo: settings.hotkeys.shot, ok: true },
      ],
      first_run_done: settings.first_run_done, beta: { ...beta }, session_active: !!sess,
      data_dir: "C:\\Users\\you\\Documents\\projects\\sensfinder\\data", toasts: [...toasts],
    };
  }
  function planState() {
    const v = verdicts[0];
    if (!v) return null;
    const created = new Date(v.created_at).getTime();
    return {
      verdict_id: v.id, created_at: v.created_at, retest_on: iso(created + 7 * DAY).slice(0, 10),
      cards: v.verdict.plan.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, checked: checked.has(i.id) })) })),
    };
  }

  async function request(method: string, rawPath: string, body?: any): Promise<any> {
    // engine-down: answers for the first 1.5 s so the app can load, then stops answering
    if (flags.has("engine-down") && mockClock.now() - t0 > 1500) throw new TypeError("Failed to fetch");
    const [path, query = ""] = rawPath.split("?");
    const q = new URLSearchParams(query);
    const key = `${method} ${path}`;
    let m: RegExpExecArray | null;
    switch (key) {
      case "GET /api/status": return status();
      case "GET /api/settings": return { ...settings };
      case "PUT /api/settings":
        Object.assign(settings, body ?? {});
        if (settings.game === "rivals" && settings.rivals_yaw) settings.yaw = settings.rivals_yaw;
        if (settings.game === "cs2") settings.yaw = CS2_YAW;
        return { ...settings };
      case "POST /api/open": return { ok: true };
      case "POST /api/diagnostics/export": return { path: "C:\\Users\\<user>\\Documents\\projects\\sensfinder\\data\\diagnostics-2026-11-14.zip" };
      case "GET /api/capture/live": return live();
      case "POST /api/capture/pause": capturePaused = !!body?.paused; return { paused: capturePaused };
      case "POST /api/capture/test": testStart = mockClock.now(); testSeconds = body?.seconds ?? 5; return captureTest();
      case "GET /api/capture/test": return captureTest();
      case "POST /api/measure/start": return { ok: true };
      case "POST /api/measure/stop":
        if (body?.mode === "yaw") {
          const counts = 11024, cm = (counts / settings.dpi) * 2.54;
          return { counts, yaw: Number((360 / (counts * (body.sens || 1))).toFixed(5)), cm360: r2(cm, 1) };
        }
        return flags.has("dpi-mismatch") ? { counts: 6268, dpi: 1592, suggested: 1600 } : { counts: 3161, dpi: 803, suggested: 800 };
      case "GET /api/session": return state();
      case "POST /api/session/start": {
        if (sess && !sess.finished) throw new MockHttpError(409, "A session is already open.");
        const tier: Tier = body?.tier ?? "standard";
        const yaw = settings.game === "rivals" ? settings.rivals_yaw ?? 0.0175 : CS2_YAW;
        const startCm = cm360(settings.sens, settings.dpi, yaw);
        sess = {
          id: nextId++, tier, demo: !!body?.demo, plan: buildPlan(tier, startCm), idx: 0, running: false, runElapsed: 0, elapsed: 0,
          paused: false, finished: false, lastTick: mockClock.now(), notices: [], lastRun: null, verdict: null, verdictId: null,
          prevSens: settings.sens, change: false, startCm, partial: false,
        };
        enter(sess);
        return state();
      }
      case "POST /api/session/run/start": {
        const s = need();
        if (!s.finished && !s.running) {
          s.running = true; s.runElapsed = 0;
          if (s.change) s.elapsed += settings.sens_change_s;
          s.change = false;
          if (s.plan[s.idx].sens != null) s.prevSens = s.plan[s.idx].sens;
        }
        return state();
      }
      case "POST /api/session/run/stop": {
        const s = need();
        if (s.running) complete(s);
        return state();
      }
      case "POST /api/session/skip": {
        const s = need();
        if (!s.finished) { s.plan[s.idx].status = "skipped"; advance(s); }
        return state();
      }
      case "POST /api/session/pause": need().paused = !!body?.paused; return state();
      case "POST /api/session/end": finish(need()); return state();
      case "DELETE /api/session": sess = null; return { active: false };
      case "GET /api/verdicts":
        return verdicts.filter((v) => (!q.get("game") || v.verdict.game === q.get("game")) && (!q.get("hero_class") || v.hero_class === q.get("hero_class"))).map(row);
      case "GET /api/verdicts/latest": return verdicts[0] ? { id: verdicts[0].id, created_at: verdicts[0].created_at, verdict: verdicts[0].verdict } : null;
      case "GET /api/plan": return planState();
      case "POST /api/plan/check": body?.checked ? checked.add(body.item_id) : checked.delete(body?.item_id); return planState();
      case "GET /api/runs": return runs.slice(0, Number(q.get("limit") ?? 100));
      case "POST /api/lab/save-default":
        for (const sec of Object.values((body?.overrides ?? {}) as Overrides)) Object.assign(savedDefaults, sec);
        return { path: "engine\\config\\metrics.toml" };
      case "GET /api/beta": return { ...beta, path: settings.beta_dir + "\\trials.csv" };
      case "POST /api/beta/import": {
        const imported = beta.rows - beta.imported;
        beta.imported = beta.rows;
        return { imported, skipped: beta.rows - imported, total: beta.rows };
      }
      case "GET /api/beta/trials": return beta.imported ? [{ task: "Gridshot Ultimate", sens: 1.0, cm360: 51.95, score: 60120, accuracy: 0.9, timestamp: iso(t0 - 20 * DAY) }] : [];
      case "GET /api/screenshots": return { watching, folder: settings.screenshots_dir, error: null, items: [...shots].reverse() };
      case "POST /api/screenshots/upload":
      case "POST /api/screenshots/ingest-latest": {
        const name: string = body instanceof FormData ? ((body.get("file") as File | null)?.name ?? "") : "latest.png";
        const ok = /\.(png|jpe?g|webp|bmp)$/i.test(name) && !/bad|desktop/i.test(name);
        const shot: Shot = ok
          ? { id: nextId++, created_at: iso(mockClock.now()), status: "pending", reason: "low_confidence", warnings: ["Score was hard to read. Check it before saving."],
              fields: { task: "Gridshot Ultimate", score: 59870, accuracy: 0.9, hits: 90, shots: 100, sens: settings.sens } }
          : { id: nextId++, created_at: iso(mockClock.now()), status: "rejected", reason: "not_results_screen", warnings: [],
              fields: { task: null, score: null, accuracy: null, hits: null, shots: null, sens: null } };
        shots.push(shot);
        return shot;
      }
      case "GET /api/demos": return [...demos].reverse();
      case "POST /api/demos/analyze": {
        const file = String(body instanceof FormData ? ((body.get("file") as File | null)?.name ?? "") : body?.path ?? "").split(/[\\/]/).pop() || "demo.dem";
        const usable = /gotv/i.test(file);
        const d: DemoResult = usable
          ? { ...demos[0] ?? { player: "issac", shots: 380, flicks: 170, over_rate: 0.3, under_rate: 0.23, median_error_deg: 1.5, notes: ["64-tick sampling is coarse, so this is endpoint error only."] } as any,
              id: nextId++, created_at: iso(mockClock.now()), file, usable: true, message: "Read shots against bots." }
          : { id: nextId++, created_at: iso(mockClock.now()), file, usable: false, message: "No usable data. This demo has no bot positions to measure against.",
              player: null, shots: 0, flicks: 0, over_rate: null, under_rate: null, median_error_deg: null, notes: ["Try recording through a local GOTV server."] };
        demos.push(d);
        return d;
      }
    }
    if ((m = /^\/api\/verdicts\/(\d+)$/.exec(path))) {
      const v = findVerdict(Number(m[1]));
      if (method === "DELETE") { verdicts.splice(verdicts.indexOf(v), 1); return { ok: true }; }
      if (method === "GET") return { id: v.id, created_at: v.created_at, hero_class: v.hero_class, profile_name: v.profile_name, verdict: v.verdict };
    }
    if (method === "POST" && (m = /^\/api\/verdicts\/(\d+)\/save$/.exec(path))) {
      const v = findVerdict(Number(m[1]));
      v.profile_name = body?.name || "Profile"; if (body?.hero_class) v.hero_class = body.hero_class;
      return row(v);
    }
    if (method === "POST" && (m = /^\/api\/verdicts\/(\d+)\/cfg$/.exec(path))) {
      const v = findVerdict(Number(m[1]));
      if (v.verdict.game !== "cs2") throw new MockHttpError(400, "The cfg file is for CS2 only.");
      return {
        filename: "sensfinder_sens.cfg", path: "C:\\Users\\you\\Documents\\projects\\sensfinder\\data\\cfg\\sensfinder_sens.cfg",
        content: `// Sensfinder ${v.verdict.method}\n// best pick ${fmtSens(v.verdict.pick_sens)} = ${v.verdict.pick_cm} cm/360 at ${v.verdict.dpi} DPI\n// range ${fmtSens(v.verdict.lo_sens)} to ${fmtSens(v.verdict.hi_sens)}\nsensitivity "${fmtSens(v.verdict.pick_sens)}"\n`,
        command: "exec sensfinder_sens",
      };
    }
    if (method === "POST" && (m = /^\/api\/runs\/(\d+)\/lab$/.exec(path))) return lab(Number(m[1]), body?.overrides);
    if ((m = /^\/api\/screenshots\/(\d+)(\/confirm)?$/.exec(path))) {
      const i = shots.findIndex((s) => s.id === Number(m![1]));
      if (i < 0) throw new MockHttpError(404, "That screenshot is gone.");
      if (method === "DELETE") { shots.splice(i, 1); return { ok: true }; }
      if (method === "POST" && m[2]) {
        shots[i] = { ...shots[i], status: "saved", reason: null, warnings: [], fields: { ...shots[i].fields, ...(body?.fields ?? {}) } };
        return shots[i];
      }
    }
    throw new MockHttpError(404, `Mock engine has no ${key}.`);
  }

  return { request };
}
