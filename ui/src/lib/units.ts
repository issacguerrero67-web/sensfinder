// Client-side conversions and small display helpers. Pure functions only (unit tested).
import type { Block, Confidence, Game, Tier } from "./types";

export const CS2_YAW = 0.022;

/** cm per full 360 turn. 1.00 @ 800 DPI in CS2 = 51.95. */
export function cm360(sens: number, dpi: number, yaw: number = CS2_YAW): number {
  if (!(sens > 0) || !(dpi > 0) || !(yaw > 0)) return NaN;
  return (360 * 2.54) / (dpi * sens * yaw);
}
export function sensFromCm(cm: number, dpi: number, yaw: number = CS2_YAW): number {
  if (!(cm > 0) || !(dpi > 0) || !(yaw > 0)) return NaN;
  return (360 * 2.54) / (dpi * cm * yaw);
}

export const fmtSens = (s: number | null | undefined) => (s == null || !isFinite(s) ? "–" : s.toFixed(2));
export const fmtCm = (c: number | null | undefined, digits = 1) => (c == null || !isFinite(c) ? "–" : c.toFixed(digits));
export const fmtPct = (r: number | null | undefined) => (r == null || !isFinite(r) ? "–" : `${Math.round(r * 100)}%`);
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "38–49": the range is always shown, never a single falsely precise number. */
export const fmtRange = (lo: number, hi: number) => `${Math.round(lo)}–${Math.round(hi)}`;

/** What the copy chips show and put on the clipboard. */
export function copyChip(sens: number, dpi: number, yaw: number) {
  return { value: fmtSens(sens), label: `${fmtSens(sens)} · ${fmtCm(cm360(sens, dpi, yaw))} cm/360` };
}
export function verdictLine(v: { pick_sens: number; pick_cm: number; lo_cm: number; hi_cm: number }): string {
  return `${fmtSens(v.pick_sens)} · ${fmtCm(v.pick_cm)} cm/360, range ${fmtRange(v.lo_cm, v.hi_cm)}`;
}

export interface TierInfo { id: Tier; label: string; minutes: number; time: string; promise: string; isDefault: boolean }
export const TIERS: TierInfo[] = [
  { id: "quick", label: "Quick", minutes: 20, time: "~20 min", promise: "Rough range. Good for a first look.", isDefault: false },
  { id: "standard", label: "Standard", minutes: 45, time: "~45 min", promise: "Reliable range and a best pick.", isDefault: true },
  { id: "precision", label: "Precision", minutes: 60, time: "up to 60 min", promise: "Tightest range this method can give.", isDefault: false },
];
export const tierInfo = (t: Tier) => TIERS.find((x) => x.id === t)!;

/** One-line summary of a scheduler plan for display. */
export function planSummary(plan: Block[]): string {
  const live = plan.filter((b) => b.status !== "dropped" && b.status !== "skipped");
  const tests = live.filter((b) => b.kind === "flick" || b.kind === "tracking").length;
  const mins = Math.round(live.reduce((a, b) => a + b.duration, 0) / 60);
  return `${tests} ${tests === 1 ? "test" : "tests"} · about ${mins} min of play`;
}

export type Tone = "warn" | "muted" | "good";
export interface ConfidenceInfo { label: Confidence; level: 0 | 1 | 2; tone: Tone; hint: string }
/** Label mapping: status is never color-only, so each level has a step index and a plain hint. */
export function confidenceInfo(label: Confidence): ConfidenceInfo {
  switch (label) {
    case "Locked in": return { label, level: 2, tone: "good", hint: "More runs won't change the answer much." };
    case "OK": return { label, level: 1, tone: "muted", hint: "Usable. A few more runs would tighten it." };
    default: return { label: "Low", level: 0, tone: "warn", hint: "Not enough flicks yet." };
  }
}

/** Budget bar turns amber at 85% of the tier budget. */
export function budgetState(elapsed: number, budget: number): { pct: number; amber: boolean } {
  const pct = budget > 0 ? Math.min(1, Math.max(0, elapsed / budget)) : 0;
  return { pct, amber: budget > 0 && elapsed / budget >= 0.85 };
}

export const GAMES: Record<Game, { name: string; range: [number, number]; start: number }> = {
  cs2: { name: "CS2", range: [35, 75], start: 50 },
  rivals: { name: "Marvel Rivals", range: [20, 60], start: 35 },
};
export const HERO_CLASSES = ["hitscan", "projectile", "melee", "tank", "flex"] as const;

export const TASK_HINT: Record<"flick" | "tracking", string> = {
  flick: "Play your flick task (for example Twoshot Entry ADS or Gridshot Ultimate)",
  tracking: "Play your tracking task (for example Aimlabs Tracking)",
};

export const RIVALS_BANNER =
  "NetEase is strict about third-party tools. Sensfinder only listens to your mouse from a separate process. Use at your own risk; if you're worried, use a throwaway account.";

/** DPI mismatch: detected value differs from the setting by more than 8%. */
export function dpiMismatch(detected: number | null, setting: number): boolean {
  return detected != null && setting > 0 && Math.abs(detected - setting) / setting > 0.08;
}

export interface CurveSeriesDef { key: string; label: string; color: "accent" | "good" | "warn"; axis: "bal" | "shake" | "score"; dash?: string }
/** Verdict chart data: balance always, shakiness where measured, score only if some level has one. */
export function curveFor(levels: { cm360: number; balance: number; shake: number | null; score?: number | null }[]) {
  const rows = [...levels].sort((a, b) => a.cm360 - b.cm360)
    .map((l) => ({ cm360: l.cm360, balance: l.balance, shake: l.shake ?? null, score: l.score ?? null }));
  const series: CurveSeriesDef[] = [{ key: "balance", label: "balance", color: "accent", axis: "bal" }];
  if (rows.some((r) => r.shake != null)) series.push({ key: "shake", label: "shakiness", color: "warn", axis: "shake" });
  if (rows.some((r) => r.score != null)) series.push({ key: "score", label: "score", color: "good", axis: "score", dash: "4 3" });
  return { rows, series };
}

function clampByte(n: number) { return Math.max(0, Math.min(255, Math.round(n))); }
/** Mix a #rrggbb color toward black (amt<0) or white (amt>0). Used to derive accessible accent shades. */
export function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const to = amt < 0 ? 0 : 255, k = Math.abs(amt);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => clampByte(c + (to - c) * k));
  return "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** Keyboard event -> "Ctrl+Alt+Enter" style combo, or null if only modifiers are down. */
export function comboFromEvent(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (!parts.length) return null; // global hotkeys need a modifier
  const k = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [...parts, k].join("+");
}
