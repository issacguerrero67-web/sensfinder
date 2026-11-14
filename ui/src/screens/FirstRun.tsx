import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Lock, Ruler, ShieldCheck } from "lucide-react";
import { Button, Chip, Field, Input, Segmented, cx } from "../components/ui";
import { CalibrateRivals, StepCard } from "../components/widgets";
import { TrailPlot } from "../components/charts";
import { api } from "../lib/api";
import { reportError, useApp, useSaveSettings } from "../lib/store";
import { CS2_YAW, GAMES, HERO_CLASSES, RIVALS_BANNER, cm360, dpiMismatch, fmtCm } from "../lib/units";
import type { Game, HeroClass, Settings } from "../lib/types";

const STEPS = ["Game", "Mouse", "Sens", "Capture test"];

/** DPI detect: swipe a 10 cm line between Start and Done. Shared with Settings. */
export function DetectDpi({ dpi, onUse }: { dpi: number; onUse: (dpi: number) => void }) {
  const [phase, setPhase] = React.useState<"idle" | "measuring" | "done">("idle");
  const [res, setRes] = React.useState<{ counts: number; dpi: number; suggested: number } | null>(null);
  const start = async () => { try { await api.measureStart(); setRes(null); setPhase("measuring"); } catch (e) { reportError(e); } };
  const stop = async () => {
    try {
      const r = await api.measureDpi(10);
      setRes(r); setPhase("done");
      useApp.setState({ detectedDpi: r.suggested });
    } catch (e) { reportError(e); setPhase("idle"); }
  };
  const off = res && dpiMismatch(res.suggested, dpi);
  return (
    <div className="border-t border-line pt-6">
      <div className="flex items-start gap-4">
        <Ruler size={18} className="mt-1 shrink-0 text-faint" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium text-text">Detect DPI: swipe a 10 cm line</div>
          <p className="mt-1 text-sm text-muted">
            {phase === "measuring" ? "Counting. Move the mouse exactly 10 cm along a ruler, in a straight line, then press Done."
              : "Not sure what your mouse is set to? Put a ruler next to it and measure."}
          </p>
          {phase === "done" && res && (
            <div className={cx("mt-3 flex flex-wrap items-center gap-3 text-sm", off ? "text-warn" : "text-good")} role="status">
              {off ? <AlertTriangle size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
              <span className="text-text">
                Measured about <span className="num">{Math.round(res.dpi)}</span> DPI
                {off ? <>, which doesn't match <span className="num">{dpi}</span>. Closest standard step is <span className="num">{res.suggested}</span>.</> : <>. That matches <span className="num">{dpi}</span>.</>}
              </span>
              {off && <Button size="sm" onClick={() => { onUse(res.suggested); useApp.setState({ detectedDpi: null }); }}>Use {res.suggested}</Button>}
            </div>
          )}
        </div>
        {phase === "measuring"
          ? <Button variant="primary" onClick={stop}>Done</Button>
          : <Button onClick={start}>{phase === "done" ? "Measure again" : "Start measuring"}</Button>}
      </div>
    </div>
  );
}

export default function FirstRun({ settings }: { settings: Settings }) {
  const save = useSaveSettings();
  const [step, setStep] = React.useState(0);
  const [game, setGame] = React.useState<Game>(settings.game);
  const [hero, setHero] = React.useState<HeroClass>(settings.hero_class ?? "hitscan");
  const [dpi, setDpi] = React.useState(String(settings.dpi));
  const [polling, setPolling] = React.useState(settings.polling_hz);
  const [sens, setSens] = React.useState(String(settings.sens));
  const [calOpen, setCalOpen] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  const yaw = game === "rivals" ? settings.rivals_yaw : CS2_YAW;
  const dpiN = Number(dpi), sensN = Number(sens);
  const cm = yaw ? cm360(sensN, dpiN, yaw) : NaN;
  const g = GAMES[game];
  const locked = game === "rivals" && !settings.rivals_yaw;

  const test = useQuery({ queryKey: ["capture-test"], queryFn: api.captureTest, enabled: testing, refetchInterval: 200 });
  const liveOn = testing && test.data?.state === "running";
  const live = useQuery({ queryKey: ["capture-live"], queryFn: api.captureLive, enabled: liveOn, refetchInterval: 60 });
  const t = testing ? test.data : undefined;
  const done = t?.state === "done";

  const valid = [!locked, dpiN >= 100 && dpiN <= 64000, sensN > 0 && isFinite(cm), true][step];
  const next = () => {
    const patch: Partial<Settings> = step === 0 ? { game, hero_class: game === "rivals" ? hero : null, yaw: yaw ?? settings.yaw }
      : step === 1 ? { dpi: dpiN, polling_hz: polling } : { sens: sensN };
    save.mutate(patch, { onSuccess: () => setStep(step + 1) });
  };
  const startTest = async () => { try { await api.captureTestStart(5); setTesting(true); test.refetch(); } catch (e) { reportError(e); } };
  const finish = () => save.mutate({ first_run_done: true }, { onSuccess: () => useApp.getState().nav("home") });

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-10 py-10">
      <ol className="mb-12 flex items-center gap-3" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-3" aria-current={i === step ? "step" : undefined}>
            <span className={cx("num flex size-6 items-center justify-center rounded-full border text-xs",
              i < step ? "border-accent-strong bg-accent-strong text-white" : i === step ? "border-accent text-text" : "border-line text-muted")}>
              {i < step ? <Check size={13} aria-label="done" /> : i + 1}
            </span>
            <span className={cx("text-sm font-medium", i === step ? "text-text" : "text-muted")}>{s}</span>
            {i < STEPS.length - 1 && <span className="h-px w-8 bg-line" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="flex-1" key={step}>
        {step === 0 && (
          <StepCard eyebrow="Step 1 of 4" title="Which game are you tuning?">
            You can add the other one later in Settings.
            <div role="radiogroup" aria-label="Game" className="mt-6 grid grid-cols-2 gap-4">
              {(["cs2", "rivals"] as Game[]).map((id) => (
                <button key={id} type="button" role="radio" aria-checked={game === id} onClick={() => setGame(id)}
                  className={cx("flex flex-col items-start rounded-md border p-5 text-left", game === id ? "border-accent bg-accent/10" : "border-line bg-s1 hover:border-[#343a42]")}>
                  <span className="text-lg font-semibold text-text">{GAMES[id].name}</span>
                  <span className="mt-1 text-sm text-muted">
                    {id === "cs2" ? "Ready to go. Sens converts with the known yaw of 0.022." : "Needs a one-time calibration turn before the first session."}
                  </span>
                </button>
              ))}
            </div>
            {game === "rivals" && (
              <div className="mt-6 space-y-5">
                <p className="flex gap-3 border-l-2 border-warn pl-4 text-sm text-text"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />{RIVALS_BANNER}</p>
                <div className="flex items-center justify-between gap-4">
                  <Field label="Hero class"><Segmented label="Hero class" value={hero} onChange={setHero} options={HERO_CLASSES.map((h) => ({ value: h, label: h }))} /></Field>
                  <div className="flex items-center gap-3">
                    {settings.rivals_yaw ? <Chip tone="good" icon={<Check size={13} aria-hidden />}>Calibrated</Chip> : <Chip tone="warn" icon={<Lock size={12} aria-hidden />}>Locked until calibrated</Chip>}
                    <Button onClick={() => setCalOpen(true)}>{settings.rivals_yaw ? "Recalibrate" : "Calibrate game"}</Button>
                  </div>
                </div>
              </div>
            )}
          </StepCard>
        )}

        {step === 1 && (
          <StepCard eyebrow="Step 2 of 4" title="Your mouse">
            Sensfinder never changes your DPI. It stays fixed and only the in-game sens moves.
            <div className="mt-6 flex items-end gap-6">
              <Field label="DPI" className="w-40"><Input mono inputMode="numeric" value={dpi} onChange={(e) => setDpi(e.target.value.replace(/[^\d]/g, ""))} /></Field>
              <div className="flex gap-2" role="group" aria-label="DPI presets">
                {[400, 800].map((p) => <Button key={p} className="num" onClick={() => setDpi(String(p))} aria-pressed={dpiN === p}>{p}</Button>)}
              </div>
              <Field label="Polling rate" className="ml-auto w-40">
                <select value={polling} onChange={(e) => setPolling(Number(e.target.value))}
                  className="num h-10 rounded-sm border border-line bg-s1 px-3 text-base text-text hover:border-[#343a42] focus:border-accent">
                  {[125, 500, 1000, 2000, 4000, 8000].map((h) => <option key={h} value={h}>{h} Hz</option>)}
                </select>
              </Field>
            </div>
            <div className="mt-8"><DetectDpi dpi={dpiN} onUse={(d) => setDpi(String(d))} /></div>
          </StepCard>
        )}

        {step === 2 && (
          <StepCard eyebrow="Step 3 of 4" title="Your current sens">
            The number in {g.name}'s settings right now. The session starts from here.
            <div className="mt-6 flex items-end gap-10">
              <Field label="In-game sens" className="w-40"><Input mono inputMode="decimal" autoFocus value={sens} onChange={(e) => setSens(e.target.value)} /></Field>
              <div>
                <div className="label">That works out to</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="num text-2xl font-medium text-text" data-testid="first-run-cm">{fmtCm(cm, 2)}</span>
                  <span className="text-base text-muted">cm/360 at <span className="num">{dpiN || "–"}</span> DPI</span>
                </div>
              </div>
            </div>
            <p className="mt-8 border-t border-line pt-5 text-sm text-muted">
              Community range for {g.name}: <span className="num text-text">{g.range[0]}–{g.range[1]}</span> cm/360, with <span className="num text-text">{g.start}</span> as a common starting point.
              These are community ranges, not evidence.
              {isFinite(cm) && (cm < g.range[0] || cm > g.range[1]) && <span className="text-text"> Yours sits outside it, which is fine. The session tests around wherever you start.</span>}
            </p>
          </StepCard>
        )}

        {step === 3 && (
          <StepCard eyebrow="Step 4 of 4" title={done && t?.ok ? "Capture works." : "5-second capture test"}>
            {done ? (t?.ok ? `Saw ${t.packets.toLocaleString("en-US")} packets at about ${Math.round(t.packet_rate)}/s. Sensfinder can hear your mouse.` : t?.message) : "Move your mouse around for five seconds. If you see the trail, Sensfinder can hear your mouse."}
            <div className="mt-6 overflow-hidden rounded-md border border-line bg-s1">
              {liveOn || done ? <TrailPlot trail={live.data?.trail ?? []} height={220} ariaLabel="Live mouse trail" />
                : <div className="flex h-[220px] items-center justify-center text-sm text-muted">The trail shows up here.</div>}
              <dl className="grid grid-cols-4 border-t border-line text-sm">
                {[["Time left", t ? `${Math.ceil(t.seconds_left)}s` : "5s"], ["Packets", t ? t.packets.toLocaleString("en-US") : "–"],
                  ["Packet rate", t?.packet_rate ? `${Math.round(t.packet_rate)}/s` : "–"], ["Distance", t ? `${t.distance_cm.toFixed(1)} cm` : "–"]].map(([k, v]) => (
                  <div key={k} className="px-4 py-3"><dt className="label">{k}</dt><dd className="num mt-1 text-base text-text">{v}</dd></div>
                ))}
              </dl>
            </div>
            {done && !t?.ok && <p className="mt-4 flex items-center gap-2 text-sm text-danger" role="alert"><AlertTriangle size={16} aria-hidden /><span className="text-text">No mouse packets arrived. Check that nothing is blocking Raw Input, then try again.</span></p>}
          </StepCard>
        )}
      </div>

      <div className="mt-10 flex items-center gap-3">
        {step > 0 && <Button variant="ghost" size="lg" icon={<ArrowLeft size={16} aria-hidden />} onClick={() => setStep(step - 1)}>Back</Button>}
        <div className="flex-1" />
        {step < 3 && <Button variant="primary" size="lg" disabled={!valid || save.isPending} onClick={next}>Continue<ArrowRight size={16} aria-hidden /></Button>}
        {step === 3 && !done && <>
          <Button variant="ghost" size="lg" onClick={finish}>Skip the test</Button>
          <Button variant="primary" size="lg" disabled={liveOn} onClick={startTest}>{liveOn ? "Testing..." : "Start 5-second test"}</Button>
        </>}
        {step === 3 && done && <>
          <Button variant="ghost" size="lg" onClick={startTest}>Run it again</Button>
          <Button variant="primary" size="lg" disabled={save.isPending} onClick={finish}>Finish setup</Button>
        </>}
      </div>

      <p className="mt-8 flex items-start gap-3 border-t border-line pt-5 text-sm text-muted">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-good" aria-hidden />
        <span>No telemetry. No network calls, except when you press "Check for updates" yourself. Logs and runs stay on this PC. Sensfinder listens to mouse movement only: no keys, no window titles, no screen.</span>
      </p>
      <CalibrateRivals open={calOpen} onClose={() => setCalOpen(false)} settings={settings} />
    </div>
  );
}
