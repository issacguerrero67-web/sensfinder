import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, CheckCircle2, Coffee, Flag, Pause, Play, SkipForward, Timer } from "lucide-react";
import { Button, Chip, Modal, cx } from "../components/ui";
import { ConfidenceMeter, EmptyState, HotkeyBadge, ProgressRing, SensCopyChip } from "../components/widgets";
import { Sparkline, SpeedTrace } from "../components/charts";
import { api } from "../lib/api";
import { useApp, useSession, useSessionAction, useSettings } from "../lib/store";
import { TASK_HINT, budgetState, fmtClock, fmtCm, fmtPct, fmtRange, fmtSens, planSummary } from "../lib/units";
import type { Block, SessionState } from "../lib/types";

const STAGE: Record<Block["stage"], string> = {
  warmup: "Warm-up", bracket: "Bracket", drift: "Drift check", rest: "Rest", refine: "Refine", confirm: "Confirm", drift2: "Drift check",
};
const isTest = (b: Block | null) => !!b && (b.kind === "flick" || b.kind === "tracking");
const TRACE_T = Array.from({ length: 200 }, (_, i) => (i - 199) / 100);

/** Soft two-note chime, synthesized so nothing has to be downloaded. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctx(), t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(660, t); o.frequency.setValueAtTime(880, t + 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.65);
    o.onended = () => ctx.close();
  } catch { /* no audio device: the on-screen confirmation is enough */ }
}

function Center({ s, got }: { s: SessionState; got: boolean }) {
  const { data: settings } = useSettings();
  const act = useSessionAction();
  const b = s.block!;
  const left = Math.max(0, b.duration - s.run_elapsed_s);
  const liveOn = s.running && isTest(b) && !s.paused;
  const live = useQuery({ queryKey: ["capture-live"], queryFn: api.captureLive, enabled: liveOn, refetchInterval: 60 });
  const runKey = settings?.hotkeys.run ?? "Ctrl+Alt+Enter";

  if (got && s.last_run) {
    const r = s.last_run;
    return (
      <div className="pop-in flex flex-col items-center text-center" role="status" data-testid="got-it">
        <CheckCircle2 size={44} className="text-good" aria-hidden />
        <h2 className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-text">Got it, +1 data point</h2>
        <p className="mt-3 text-base text-muted">
          {r.kind === "flick"
            ? <><span className="num text-text">{r.flicks}</span> flicks at <span className="num text-text">{fmtSens(r.sens)}</span> · over <span className="num text-text">{fmtPct(r.over_rate)}</span> · under <span className="num text-text">{fmtPct(r.under_rate)}</span></>
            : <>Tracking run at <span className="num text-text">{fmtSens(r.sens)}</span> saved.</>}
        </p>
        {r.partial && <p className="mt-3 flex items-center gap-2 text-sm text-warn"><AlertTriangle size={15} aria-hidden /><span className="text-text">{r.warning ?? "Capture paused during this run."} Saved as partial.</span></p>}
      </div>
    );
  }
  if (s.paused) {
    return (
      <div className="screen-in flex flex-col items-center text-center">
        <div className="label">Session paused</div>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-text">Take your time.</h2>
        <p className="mt-3 text-base text-muted">The clock is stopped. Nothing is lost.</p>
        <Button variant="primary" size="hero" className="mt-8" icon={<Play size={18} fill="currentColor" aria-hidden />} onClick={() => act(() => api.pause(false))}>Resume session</Button>
      </div>
    );
  }
  if (s.running) {
    const calm = !isTest(b);
    return (
      <div className="screen-in flex w-full flex-col items-center text-center">
        <div className="label">{b.kind === "rest" ? "Rest" : b.kind === "warmup" ? "Warm-up" : "Run in progress"}</div>
        <div className={cx("num mt-4 text-hero font-medium tracking-[-0.03em]", calm ? "text-muted" : "text-text")} role="timer" aria-label="Time left in this block" data-testid="countdown">{fmtClock(left)}</div>
        <p className="mt-4 max-w-[440px] text-base text-muted">
          {b.kind === "rest" ? "Hands off the mouse. Shake your arm out, look at something far away."
            : b.kind === "warmup" ? "Play anything at your current sens. This part isn't scored."
            : `${TASK_HINT[b.kind as "flick" | "tracking"]}. Play it the way you normally would.`}
        </p>
        {isTest(b) && (
          <div className="mt-6 w-full max-w-[460px]">
            <SpeedTrace t={TRACE_T} speed={live.data?.speed ?? TRACE_T.map(() => 0)} height={88} ariaLabel="Live mouse speed, last two seconds" />
          </div>
        )}
        <div className="mt-6 flex items-center gap-3">
          {b.kind === "rest" && <Button size="lg" onClick={() => act(api.runStop)}>Skip rest</Button>}
          {b.kind === "warmup" && <Button size="lg" onClick={() => act(api.runStop)}>Skip warm-up</Button>}
          {isTest(b) && <><Button variant="ghost" onClick={() => act(api.runStop)}>Stop run now</Button><HotkeyBadge combo={runKey} /></>}
        </div>
      </div>
    );
  }
  if (b.kind === "rest") {
    return <div className="flex flex-col items-center text-center" role="status"><Coffee size={32} className="text-muted" aria-hidden /><h2 className="mt-4 text-2xl font-semibold text-text">Rest</h2><p className="mt-2 text-muted">Starting the break.</p></div>;
  }
  const start = (
    <div className="mt-8 flex flex-col items-center gap-3">
      <Button variant="primary" size="hero" className="min-w-[240px]" icon={<Play size={18} fill="currentColor" aria-hidden />} onClick={() => act(api.runStart)}>
        {b.kind === "warmup" ? "Start warm-up" : "Start run"}
      </Button>
      <span className="flex items-center gap-2 text-sm text-muted">or press <HotkeyBadge combo={runKey} /> in-game</span>
    </div>
  );
  if (b.kind === "warmup") {
    return (
      <div className="screen-in flex flex-col items-center text-center">
        <div className="label">Warm-up · {fmtClock(b.duration)}</div>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-text">Warm up at your current sens</h2>
        <p className="mt-3 max-w-[440px] text-base text-muted">Play anything for a few minutes at <span className="num text-text">{fmtSens(b.sens)}</span>. It's recorded but not scored.</p>
        {start}
      </div>
    );
  }
  const sens = fmtSens(b.sens);
  return (
    <div className="screen-in flex flex-col items-center text-center" key={b.id}>
      <div className="label">{s.change_sens ? "Next sens" : b.note === "noisy" ? "One more here" : "Same sens"} · {b.kind === "flick" ? "flick run" : "tracking run"} · {fmtClock(b.duration)}</div>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-text" data-testid="coach-title">
        {s.change_sens ? <>Set <span className="num">{sens}</span> in-game</> : <>Stay at <span className="num">{sens}</span></>}
      </h2>
      <div className="mt-5">{settings && b.sens != null && <SensCopyChip sens={b.sens} dpi={settings.dpi} yaw={settings.yaw} cm={b.cm360} size="lg" />}</div>
      <p className="mt-5 max-w-[460px] text-base text-muted">
        {s.change_sens ? `Set ${sens} in-game, then hit start.` : `No change needed. You're already on ${sens}.`}<br />
        {TASK_HINT[b.kind as "flick" | "tracking"]}.
      </p>
      {start}
    </div>
  );
}

export default function Coach() {
  const { data: session } = useSession();
  const act = useSessionAction();
  const nav = useApp((st) => st.nav);
  const [got, setGot] = React.useState(false);
  const [endOpen, setEndOpen] = React.useState(false);
  const prev = React.useRef<{ running: boolean; blockId: number | null; kind: string | null }>({ running: false, blockId: null, kind: null });
  const autoRest = React.useRef<number | null>(null);
  const gotTimer = React.useRef<number | undefined>(undefined);
  const s = session?.active ? session : null;

  // run finished -> chime + "Got it" for 2 s
  React.useEffect(() => {
    if (!s) return;
    const p = prev.current, id = s.block?.id ?? null;
    if (p.running && (!s.running || id !== p.blockId)) {
      chime();
      if (p.kind === "flick" || p.kind === "tracking") {
        setGot(true);
        clearTimeout(gotTimer.current);
        gotTimer.current = window.setTimeout(() => setGot(false), 2000);
      }
    } else if (s.running && !p.running) setGot(false);
    prev.current = { running: s.running, blockId: id, kind: s.block?.kind ?? null };
  }, [s?.running, s?.block?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // rest starts by itself once the "Got it" note is gone
  React.useEffect(() => {
    if (s && !got && !s.finished && !s.paused && !s.running && s.block?.kind === "rest" && autoRest.current !== s.block.id) {
      autoRest.current = s.block.id;
      act(api.runStart);
    }
  }, [s, got, act]);

  React.useEffect(() => { if (s?.finished && !got) nav("verdict", s.verdict_id); }, [s?.finished, s?.verdict_id, got, nav]);

  if (!s) {
    return <EmptyState icon={<Timer size={20} aria-hidden />} title="No session running" body="Pick a tier on Home and start one. The coach walks you through it one step at a time."
      action={<Button variant="primary" size="lg" onClick={() => nav("home")}>Go to Home</Button>} />;
  }
  if (s.finished || !s.block) {
    return <div className="flex h-full items-center justify-center text-muted" role="status">Wrapping up...</div>;
  }
  const b = s.block;
  const budget = budgetState(s.elapsed_s, s.budget_s);
  const ringValue = s.running ? 1 - s.run_elapsed_s / b.duration : 1;
  const notices = [...s.notices.slice(-2), ...(s.fatigue.flag ? ["You're slowing down a little. A short break would help; later runs count a bit less."] : [])];

  return (
    <div className="mx-auto flex h-full min-h-[560px] w-full max-w-[1120px] flex-col px-10 pt-6">
      <div className="flex items-center gap-2">
        <Chip>{s.tier_label} session</Chip>
        <Chip>{STAGE[b.stage]}</Chip>
        {s.demo && <Chip tone="accent" icon={<Bot size={12} aria-hidden />}>Demo mode: simulated player</Chip>}
        <span className="ml-auto text-sm text-muted">{planSummary(s.plan)}</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_240px] items-center gap-10 py-6">
        <div className="flex flex-col items-center">
          <ProgressRing value={ringValue} size={224} label="Time left in this block" tone={s.running ? "accent" : "muted"} linearMs={s.running ? 260 : undefined}>
            {b.sens != null ? (
              <>
                <span className="label">sens</span>
                <span className="num mt-1 text-2xl font-medium text-text">{fmtSens(b.sens)}</span>
                <span className="num mt-1 text-sm text-muted">{fmtCm(b.cm360)} cm/360</span>
              </>
            ) : (
              <><Coffee size={28} className="text-muted" aria-hidden /><span className="mt-2 text-base text-muted">Rest</span></>
            )}
          </ProgressRing>
          <div className="mt-5 text-center text-sm text-muted" data-testid="test-index">
            {isTest(b) ? <>Test <span className="num text-text">{s.test_index}</span> of <span className="num text-text">{s.test_total}</span> · <span className="num text-text">{fmtSens(b.sens)}</span></>
              : b.kind === "warmup" ? <>Warm-up · <span className="num text-text">{s.test_total}</span> tests to go</>
              : <>Break · test <span className="num text-text">{Math.min(s.test_total, s.test_index + 1)}</span> of <span className="num text-text">{s.test_total}</span> is next</>}
          </div>
        </div>

        <div className="flex min-w-0 flex-col items-center justify-center">
          <Center s={s} got={got} />
          {notices.length > 0 && !got && (
            <ul className="mt-8 space-y-1 text-center text-sm" aria-label="Notes from the coach">
              {notices.map((n, i) => <li key={i} className={i === notices.length - 1 ? "text-text" : "text-muted"}>{n}</li>)}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-8 border-l border-line pl-8">
          <ConfidenceMeter label={s.confidence.label} fill={s.confidence.fill} />
          <div>
            <div className="label mb-3">Balance so far</div>
            <Sparkline points={s.curve} width={200} height={60} />
            <p className="mt-3 text-sm text-muted">
              {s.estimate.trend
                ? <>Leaning toward <span className="num text-text">{fmtSens(s.estimate.pick_sens)}</span>, somewhere in <span className="num text-text">{fmtRange(s.estimate.lo_cm, s.estimate.hi_cm)}</span> cm/360.</>
                : "No clear lean yet."}
            </p>
          </div>
        </div>
      </div>

      <footer className="flex items-center gap-6 border-t border-line py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted">Elapsed <span className="num text-text">{fmtClock(s.elapsed_s)}</span> of <span className="num text-text">{fmtClock(s.budget_s)}</span></span>
            {budget.amber && <span className="flex items-center gap-1.5 text-warn"><AlertTriangle size={13} aria-hidden /><span className="text-text">Close to the time budget. Wrapping up soon.</span></span>}
          </div>
          <div className="mt-2 h-1 rounded-full bg-line" role="progressbar" aria-label="Session time used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(budget.pct * 100)}>
            <div className={cx("h-full rounded-full transition-[width] duration-300 ease-linear", budget.amber ? "bg-warn" : "bg-muted")} style={{ width: `${budget.pct * 100}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={s.paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />} onClick={() => act(() => api.pause(!s.paused))}>{s.paused ? "Resume" : "Pause"}</Button>
          <Button icon={<SkipForward size={15} aria-hidden />} disabled={!isTest(b)} onClick={() => act(api.skip)}>Skip this sens</Button>
          <Button variant="ghost" icon={<Flag size={15} aria-hidden />} onClick={() => setEndOpen(true)}>End session</Button>
        </div>
      </footer>

      <Modal open={endOpen} onClose={() => setEndOpen(false)} title="End the session now?" description="You'll get the best range the runs so far can support. It may be wider than a full session would give.">
        <div className="flex justify-end gap-3">
          <Button onClick={() => setEndOpen(false)}>Keep going</Button>
          <Button variant="primary" onClick={() => { setEndOpen(false); act(api.end); }}>End and show result</Button>
        </div>
      </Modal>
    </div>
  );
}
