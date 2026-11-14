import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  TIERS, budgetState, cm360, comboFromEvent, confidenceInfo, copyChip, curveFor, dpiMismatch, fmtClock, fmtRange,
  planSummary, sensFromCm, shade, tierInfo, verdictLine,
} from "../lib/units";
import { createMockEngine, mockClock } from "../lib/mockEngine";
import { ConfidenceMeter, SensCopyChip } from "../components/widgets";
import type { Block, SessionState } from "../lib/types";

afterEach(cleanup);

describe("unit conversions", () => {
  it("matches the spec's reference points", () => {
    expect(cm360(2.0, 400)).toBeCloseTo(51.95, 2);
    expect(cm360(1.0, 800)).toBeCloseTo(51.95, 2);
    expect(cm360(1.2, 800)).toBeCloseTo(43.3, 1);
  });
  it("round-trips sens <-> cm/360 and rejects nonsense", () => {
    expect(sensFromCm(cm360(1.37, 800), 800)).toBeCloseTo(1.37, 6);
    expect(cm360(0, 800)).toBeNaN();
    expect(cm360(1, 0)).toBeNaN();
  });
  it("formats clocks and ranges", () => {
    expect(fmtClock(125)).toBe("2:05");
    expect(fmtClock(59.2)).toBe("1:00");
    expect(fmtRange(37.9, 49.2)).toBe("38–49");
    expect(verdictLine({ pick_sens: 1.62, pick_cm: 43.1, lo_cm: 38, hi_cm: 49 })).toBe("1.62 · 43.1 cm/360, range 38–49");
  });
});

describe("tier planner display", () => {
  it("shows the three tiers with the spec's budgets and promises", () => {
    expect(TIERS.map((t) => [t.label, t.time, t.promise])).toEqual([
      ["Quick", "~20 min", "Rough range. Good for a first look."],
      ["Standard", "~45 min", "Reliable range and a best pick."],
      ["Precision", "up to 60 min", "Tightest range this method can give."],
    ]);
    expect(TIERS.filter((t) => t.isDefault).map((t) => t.id)).toEqual(["standard"]);
    expect(tierInfo("precision").minutes).toBe(60);
  });
  it("summarises a plan, ignoring dropped and skipped blocks", () => {
    const b = (kind: Block["kind"], duration: number, status: Block["status"] = "upcoming"): Block =>
      ({ id: 0, stage: "bracket", kind, slot: "", duration, cm360: 50, sens: 1, note: "", status });
    expect(planSummary([b("warmup", 210), b("flick", 60), b("tracking", 60), b("rest", 180), b("flick", 60, "dropped"), b("flick", 60, "skipped")]))
      .toBe("2 tests · about 9 min of play");
    expect(planSummary([b("flick", 60)])).toBe("1 test · about 1 min of play");
  });
  it("turns the budget bar amber at 85%", () => {
    expect(budgetState(1000, 1200).amber).toBe(false);
    expect(budgetState(1020, 1200).amber).toBe(true);
    expect(budgetState(5000, 1200).pct).toBe(1);
  });
});

describe("confidence label mapping", () => {
  it("maps each label to a level, tone and hint", () => {
    expect(confidenceInfo("Low")).toMatchObject({ level: 0, tone: "warn" });
    expect(confidenceInfo("OK")).toMatchObject({ level: 1, tone: "muted" });
    expect(confidenceInfo("Locked in")).toMatchObject({ level: 2, tone: "good" });
  });
  it("renders the label as text, not only as color", () => {
    render(<ConfidenceMeter label="Locked in" fill={0.92} />);
    expect(screen.getByTestId("confidence-label")).toHaveTextContent("Locked in");
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "92");
    expect(meter).toHaveAttribute("aria-valuetext", "Locked in");
  });
});

describe("copy chips", () => {
  it("builds the chip text", () => {
    expect(copyChip(1.4, 800, 0.022)).toEqual({ value: "1.40", label: "1.40 · 37.1 cm/360" });
  });
  it("copies the bare sens number and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<SensCopyChip sens={1.4} dpi={800} yaw={0.022} />);
    const chip = screen.getByTestId("sens-copy-chip");
    expect(chip).toHaveTextContent("1.40");
    expect(chip).toHaveTextContent("37.1 cm/360");
    fireEvent.click(chip);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("1.40"));
    await waitFor(() => expect(chip).toHaveTextContent("Copied"));
  });
});

describe("small helpers", () => {
  it("draws the score series only when a level has a score", () => {
    const lv = (score?: number | null) => ({ cm360: 40, balance: 0.1, shake: null, score });
    expect(curveFor([lv(), lv(null)]).series.map((s) => s.key)).toEqual(["balance"]);
    expect(curveFor([lv(), lv(61000)]).series.map((s) => s.key)).toEqual(["balance", "score"]);
    expect(curveFor([{ cm360: 40, balance: 0, shake: 1.1 }]).series.map((s) => s.key)).toEqual(["balance", "shake"]);
  });
  it("flags a DPI mismatch only when it is real", () => {
    expect(dpiMismatch(null, 800)).toBe(false);
    expect(dpiMismatch(803, 800)).toBe(false);
    expect(dpiMismatch(1600, 800)).toBe(true);
  });
  it("builds hotkey combos and accent shades", () => {
    expect(comboFromEvent({ key: "Enter", ctrlKey: true, altKey: true, shiftKey: false })).toBe("Ctrl+Alt+Enter");
    expect(comboFromEvent({ key: "n", ctrlKey: true, altKey: true, shiftKey: false })).toBe("Ctrl+Alt+N");
    expect(comboFromEvent({ key: "Control", ctrlKey: true, altKey: false, shiftKey: false })).toBeNull();
    expect(comboFromEvent({ key: "a", ctrlKey: false, altKey: false, shiftKey: false })).toBeNull();
    expect(shade("#000000", 0.5)).toBe("#808080");
    expect(shade("#ffffff", -1)).toBe("#000000");
  });
});

describe("mock engine", () => {
  async function runSession(tier: "quick" | "standard" | "precision") {
    let now = 1_700_000_000_000;
    const realNow = mockClock.now;
    mockClock.now = () => now;
    try {
      const eng = createMockEngine({ flags: ["ready"], speed: 30 });
      let s: SessionState = await eng.request("POST", "/api/session/start", { tier, demo: true });
      const seen = new Set<string>();
      let maxElapsed = 0;
      for (let i = 0; i < 2000 && !s.finished; i++) {
        if (!s.running) s = await eng.request("POST", "/api/session/run/start");
        seen.add(s.block?.kind ?? "none");
        now += 500;
        s = await eng.request("GET", "/api/session");
        maxElapsed = Math.max(maxElapsed, s.elapsed_s);
      }
      return { s, seen, maxElapsed, eng };
    } finally { mockClock.now = realNow; }
  }

  it("runs a scripted quick session to a verdict", async () => {
    const { s, seen, eng } = await runSession("quick");
    expect(s.finished).toBe(true);
    expect(s.block).toBeNull();
    expect([...seen].sort()).toEqual(["flick", "rest", "warmup"]);
    expect(s.test_total).toBe(7);
    const v = s.verdict!;
    expect(v).toBeTruthy();
    expect(v.method).toBe("v1.0 beta method");
    expect(v.lo_cm).toBeLessThan(v.pick_cm);
    expect(v.hi_cm).toBeGreaterThan(v.pick_cm);
    // never narrower than +/-10% of the pick
    expect(v.pick_cm - v.lo_cm).toBeGreaterThanOrEqual(v.pick_cm * 0.1);
    expect(v.hi_cm - v.pick_cm).toBeGreaterThanOrEqual(v.pick_cm * 0.1);
    expect(v.lo_sens).toBeLessThan(v.hi_sens);
    expect(JSON.stringify(v).toLowerCase()).not.toContain("perfect");
    const latest = await eng.request("GET", "/api/verdicts/latest");
    expect(latest.id).toBe(s.verdict_id);
    expect(s.confidence.fill).toBeGreaterThan(0.7);
  });

  it("keeps every tier inside its budget and the 60:00 cap", async () => {
    for (const tier of ["quick", "standard", "precision"] as const) {
      const { s, maxElapsed } = await runSession(tier);
      expect(s.finished).toBe(true);
      expect(maxElapsed).toBeLessThanOrEqual(s.budget_s);
      expect(s.budget_s).toBeLessThanOrEqual(s.hard_cap_s);
    }
  });

  it("supports skip, end, 409 on double start, and the error flags", async () => {
    const eng = createMockEngine({ flags: ["ready"] });
    let s: SessionState = await eng.request("POST", "/api/session/start", { tier: "quick" });
    await expect(eng.request("POST", "/api/session/start", { tier: "quick" })).rejects.toMatchObject({ status: 409 });
    s = await eng.request("POST", "/api/session/skip");
    expect(s.plan[0].status).toBe("skipped");
    expect(s.change_sens).toBe(true);
    s = await eng.request("POST", "/api/session/end");
    expect(s.finished).toBe(true);
    expect(s.verdict).toBeTruthy();
    expect(await eng.request("DELETE", "/api/session")).toEqual({ active: false });

    const low = await createMockEngine({ flags: ["low-rate", "capture-paused"] }).request("GET", "/api/status");
    expect(low.capture.low_rate).toBe(true);
    expect(low.capture.paused).toBe(true);
    const down = createMockEngine({ flags: ["engine-down"] });
    expect((await down.request("GET", "/api/status")).version).toBe("1.0.0");
    const realNow = mockClock.now;
    mockClock.now = () => realNow() + 5000;
    try { await expect(down.request("GET", "/api/status")).rejects.toBeInstanceOf(TypeError); } finally { mockClock.now = realNow; }
  });
});
