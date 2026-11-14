// Product components: ProgressRing, ConfidenceMeter, StepCard, SensCopyChip, StatDelta, DropZone,
// HotkeyBadge, EmptyState, CountUp and the Rivals calibration wizard.
import * as React from "react";
import { ArrowDown, ArrowUp, Check, CircleDashed, CircleDot, Copy, Lock, Minus, RotateCw, Upload } from "lucide-react";
import { Button, Field, Input, Modal, cx } from "./ui";
import { api } from "../lib/api";
import { copyText, reportError, useApp, useSaveSettings } from "../lib/store";
import { cm360, confidenceInfo, copyChip, fmtCm, fmtSens } from "../lib/units";
import type { Confidence, Settings } from "../lib/types";

export function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.classList.contains("reduce-motion") ||
    (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/** Number that eases to its new value over 600 ms. Instant when motion is reduced. */
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const [shown, setShown] = React.useState(() => (prefersReducedMotion() ? value : 0));
  const from = React.useRef(shown);
  React.useEffect(() => {
    if (prefersReducedMotion() || !isFinite(value)) { from.current = value; setShown(value); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 600), e = 1 - Math.pow(1 - k, 3);
      const v = a + (value - a) * e;
      from.current = v; setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={cx("num", className)}>{format(shown)}</span>;
}

export function ProgressRing({ value, size = 240, stroke = 6, label, tone = "accent", linearMs, children }: {
  value: number; size?: number; stroke?: number; label: string; tone?: "accent" | "muted" | "good"; linearMs?: number; children?: React.ReactNode;
}) {
  const v = Math.max(0, Math.min(1, isFinite(value) ? value : 0));
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const color = tone === "good" ? "var(--color-good)" : tone === "muted" ? "#4a515b" : "var(--accent)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)}
          style={{ transition: linearMs ? `stroke-dashoffset ${linearMs}ms linear, stroke 200ms` : "stroke-dashoffset var(--dur-count) var(--ease), stroke 200ms" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

const CONF_ICON = [CircleDashed, CircleDot, Lock];
export function ConfidenceMeter({ label, fill }: { label: Confidence; fill: number }) {
  const info = confidenceInfo(label);
  const Icon = CONF_ICON[info.level];
  const f = Math.max(0, Math.min(1, fill));
  const color = info.tone === "good" ? "bg-good" : info.tone === "warn" ? "bg-warn" : "bg-accent";
  return (
    <div>
      <div className="label">Confidence</div>
      <div className="mt-3 flex items-center gap-2 text-lg font-semibold text-text">
        <Icon size={18} aria-hidden className={info.tone === "good" ? "text-good" : info.tone === "warn" ? "text-warn" : "text-accent-soft"} />
        <span data-testid="confidence-label">{label}</span>
      </div>
      <div className="relative mt-4 h-1.5 rounded-full bg-line" role="meter" aria-label="Data confidence" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(f * 100)} aria-valuetext={label}>
        <div className={cx("h-full rounded-full transition-[width] duration-[600ms] ease-out", color)} style={{ width: `${f * 100}%` }} />
        <span className="absolute left-[45%] top-[-3px] h-3 w-px bg-canvas" aria-hidden />
        <span className="absolute left-[85%] top-[-3px] h-3 w-px bg-canvas" aria-hidden />
      </div>
      <div className="mt-2 grid grid-cols-[45fr_40fr_15fr] text-xs">
        {(["Low", "OK", "Locked in"] as Confidence[]).map((l, i) => (
          <span key={l} className={cx("whitespace-nowrap", i === 2 && "text-right", l === label ? "font-semibold text-text" : "text-muted")}>{l}</span>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">{info.hint}</p>
    </div>
  );
}

export function StepCard({ eyebrow, title, children, actions, className }: {
  eyebrow?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cx("screen-in flex flex-col", className)}>
      {eyebrow && <div className="label mb-3">{eyebrow}</div>}
      <h2 className="text-2xl font-semibold tracking-[-0.02em] text-text">{title}</h2>
      {children && <div className="mt-4 text-base text-muted">{children}</div>}
      {actions && <div className="mt-8 flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

/** Shows the sens to type in-game plus its cm/360. Click copies the bare number. */
export function SensCopyChip({ sens, dpi, yaw, cm, size = "md" }: { sens: number; dpi: number; yaw: number; cm?: number | null; size?: "md" | "lg" }) {
  const [copied, setCopied] = React.useState(false);
  const chip = copyChip(sens, dpi, yaw);
  const onClick = async () => {
    if (await copyText(chip.value)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
    else useApp.getState().toast("warn", `Couldn't reach the clipboard. Type ${chip.value} by hand.`);
  };
  return (
    <button type="button" onClick={onClick} data-testid="sens-copy-chip"
      className={cx("inline-flex items-center gap-3 rounded-full border border-line bg-s2 text-text hover:border-accent",
        size === "lg" ? "h-12 pl-5 pr-4 text-lg" : "h-9 pl-4 pr-3 text-sm")}>
      <span className="num font-semibold">{chip.value}</span>
      <span className="num text-muted">{fmtCm(cm ?? cm360(sens, dpi, yaw))} cm/360</span>
      <span className={cx("ml-1 inline-flex items-center gap-1.5 text-sm font-medium", copied ? "text-good" : "text-accent-soft")} aria-live="polite">
        {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

/** A number with a direction arrow and words, so better/worse never depends on color. */
export function StatDelta({ label, value, delta, goodWhen = "down", unit }: {
  label: string; value: string; delta?: number | null; goodWhen?: "down" | "up"; unit?: string;
}) {
  const flat = delta == null || Math.abs(delta) < 0.005;
  const good = !flat && (delta! < 0) === (goodWhen === "down");
  const Icon = flat ? Minus : delta! < 0 ? ArrowDown : ArrowUp;
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="num text-xl font-medium text-text">{value}</span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      {delta !== undefined && (
        <div className={cx("mt-1 flex items-center gap-1 text-sm", flat ? "text-muted" : good ? "text-good" : "text-warn")}>
          <Icon size={14} aria-hidden />
          {flat ? "about the same" : `${Math.abs(Math.round(delta! * 100))}% ${delta! < 0 ? "lower" : "higher"}`}
        </div>
      )}
    </div>
  );
}

export function DropZone({ onFile, accept, title, hint, paste, busy }: {
  onFile: (f: File) => void; accept: string; title: string; hint: string; paste?: boolean; busy?: boolean;
}) {
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!paste) return;
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? [])[0];
      if (f) { e.preventDefault(); onFile(f); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [paste, onFile]);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={cx("flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center transition-colors duration-200",
        over ? "border-accent bg-accent/10" : "border-[#343a42] bg-s1")}>
      <Upload size={22} aria-hidden className="text-faint" />
      <div>
        <div className="text-base font-medium text-text">{title}</div>
        <div className="mt-1 text-sm text-muted">{hint}</div>
      </div>
      <input ref={input} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Reading..." : "Choose a file"}</Button>
    </div>
  );
}

export function HotkeyBadge({ combo, className }: { combo: string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1", className)} aria-label={combo}>
      {combo.split("+").map((k, i) => (
        <kbd key={i} className="num inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] border border-line bg-s2 px-1.5 text-[11px] font-medium text-muted">{k}</kbd>
      ))}
    </span>
  );
}

export function EmptyState({ icon, title, body, action, compact }: { icon: React.ReactNode; title: string; body: React.ReactNode; action?: React.ReactNode; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-s1 text-muted">{icon}</div>
        <div className="min-w-0 flex-1"><div className="text-base font-medium text-text">{title}</div><p className="text-sm text-muted">{body}</p></div>
        {action}
      </div>
    );
  }
  return (
    <div className="screen-in flex min-h-[70%] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-full border border-line bg-s1 text-muted">{icon}</div>
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p className="mt-2 max-w-[420px] text-base text-muted">{body}</p>
      {action && <div className="mt-6 flex items-center gap-3">{action}</div>}
    </div>
  );
}

/** Calibrate game: one full 360 turn between Start and Stop gives the yaw for Marvel Rivals. */
export function CalibrateRivals({ open, onClose, settings }: { open: boolean; onClose: () => void; settings: Settings }) {
  const save = useSaveSettings();
  const [sens, setSens] = React.useState(String(settings.sens));
  const [phase, setPhase] = React.useState<"idle" | "turning" | "done">("idle");
  const [result, setResult] = React.useState<{ counts: number; yaw: number; cm360: number } | null>(null);
  React.useEffect(() => { if (open) { setPhase("idle"); setResult(null); setSens(String(settings.sens)); } }, [open]); // eslint-disable-line
  const s = Number(sens);
  const start = async () => { try { await api.measureStart(); setPhase("turning"); } catch (e) { reportError(e); } };
  const stop = async () => {
    try { setResult(await api.measureYaw(s)); setPhase("done"); } catch (e) { reportError(e); setPhase("idle"); }
  };
  const keep = () => {
    if (!result) return;
    save.mutate({ rivals_yaw: result.yaw, yaw: result.yaw, sens: s }, {
      onSuccess: () => { useApp.getState().toast("good", "Marvel Rivals is calibrated."); onClose(); },
    });
  };
  return (
    <Modal open={open} onClose={onClose} title="Calibrate Marvel Rivals"
      description="Rivals has no verified yaw constant, so Sensfinder measures it from your own mouse.">
      <ol className="mb-6 space-y-2 text-base text-muted">
        <li><span className="num mr-2 text-text">1</span>Open the practice range and stand facing a clear landmark.</li>
        <li><span className="num mr-2 text-text">2</span>Press Start here, then turn exactly one full 360° with a single smooth swipe (lift and reset if you need to).</li>
        <li><span className="num mr-2 text-text">3</span>Stop when you face the landmark again.</li>
      </ol>
      <Field label="In-game sens while turning" className="mb-6 max-w-[260px]">
        <Input mono inputMode="decimal" value={sens} onChange={(e) => setSens(e.target.value)} disabled={phase !== "idle"} />
      </Field>
      {phase === "done" && result && (
        <div className="mb-6 border-y border-line py-4" role="status">
          <div className="label">Measured</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="num text-2xl font-medium text-text">{fmtCm(result.cm360)}</span>
            <span className="text-muted">cm/360 at {fmtSens(s)}</span>
          </div>
          <p className="mt-1 text-sm text-muted"><span className="num">{result.counts.toLocaleString("en-US")}</span> counts · yaw <span className="num">{result.yaw}</span></p>
        </div>
      )}
      <div className="flex items-center gap-3">
        {phase === "idle" && <Button variant="primary" size="lg" disabled={!(s > 0)} onClick={start}>Start</Button>}
        {phase === "turning" && <Button variant="primary" size="lg" onClick={stop}>Stop, I'm back at the landmark</Button>}
        {phase === "done" && <>
          <Button variant="primary" size="lg" onClick={keep} disabled={save.isPending}>Save calibration</Button>
          <Button variant="ghost" size="lg" icon={<RotateCw size={16} aria-hidden />} onClick={() => { setPhase("idle"); setResult(null); }}>Measure again</Button>
        </>}
        {phase === "turning" && <span className="flex items-center gap-2 text-sm text-muted" role="status"><span className="pulse size-2 rounded-full bg-accent" aria-hidden />Counting. Turn now.</span>}
      </div>
    </Modal>
  );
}
