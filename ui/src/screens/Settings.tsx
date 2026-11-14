import * as React from "react";
import { AlertTriangle, Check, Download, ExternalLink, FolderOpen, Lock } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Chip, Input, PageHeader, Section, Segmented, Switch, cx } from "../components/ui";
import { CalibrateRivals, HotkeyBadge } from "../components/widgets";
import { DetectDpi } from "./FirstRun";
import { api } from "../lib/api";
import { reportError, useApp, useSaveSettings, useSettings, useStatus } from "../lib/store";
import { CS2_YAW, GAMES, HERO_CLASSES, cm360, comboFromEvent, fmtCm } from "../lib/units";
import type { Game, HotkeyId } from "../lib/types";

const ACCENTS = [["#7C5CFF", "Violet"], ["#3B9EFF", "Blue"], ["#12B5A6", "Teal"], ["#E5589A", "Pink"], ["#E8762B", "Orange"]];

function Row({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-6 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-base text-text">{title}</div>
        {hint && <div className="mt-0.5 text-sm text-muted">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

/** Text box that saves a number on blur / Enter and snaps back if the value is not valid. */
function NumberSetting({ value, onSave, label, width = "w-28", min = 0 }: { value: number; onSave: (n: number) => void; label: string; width?: string; min?: number }) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  const commit = () => { const n = Number(text); if (isFinite(n) && n > min && n !== value) onSave(n); else setText(String(value)); };
  return <Input mono aria-label={label} inputMode="decimal" className={width} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}

export default function Settings() {
  const { data: settings } = useSettings();
  const { data: status } = useStatus();
  const save = useSaveSettings();
  const toast = useApp((s) => s.toast);
  const [binding, setBinding] = React.useState<HotkeyId | null>(null);
  const [calOpen, setCalOpen] = React.useState(false);

  React.useEffect(() => {
    if (!binding || !settings) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") return setBinding(null);
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (Object.entries(settings.hotkeys).some(([k, v]) => k !== binding && v === combo)) { toast("warn", `${combo} is already used by another hotkey.`); return; }
      save.mutate({ hotkeys: { ...settings.hotkeys, [binding]: combo } });
      setBinding(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [binding, settings, save, toast]);

  if (!settings) return null;
  const setGame = (game: Game) => save.mutate({ game, yaw: game === "cs2" ? CS2_YAW : settings.rivals_yaw ?? settings.yaw, hero_class: game === "rivals" ? settings.hero_class ?? "hitscan" : null });
  const locked = settings.game === "rivals" && !settings.rivals_yaw;
  const exportDiag = async () => { try { toast("good", `Diagnostics saved to ${(await api.exportDiagnostics()).path}`); } catch (e) { reportError(e); } };

  return (
    <Page className="max-w-[820px]">
      <PageHeader title="Settings" />

      <Section title="Game" className="border-t-0 pt-0">
        <Row title="Game" hint={locked ? "Marvel Rivals stays locked until you calibrate it." : undefined}>
          {settings.game === "rivals" && (settings.rivals_yaw
            ? <Chip tone="good" icon={<Check size={12} aria-hidden />}>Calibrated</Chip> : <Chip tone="warn" icon={<Lock size={12} aria-hidden />}>Locked</Chip>)}
          {settings.game === "rivals" && <Button size="sm" onClick={() => setCalOpen(true)}>{settings.rivals_yaw ? "Recalibrate" : "Calibrate game"}</Button>}
          <Segmented label="Game" value={settings.game} onChange={setGame} options={(Object.keys(GAMES) as Game[]).map((g) => ({ value: g, label: GAMES[g].name }))} />
        </Row>
        {settings.game === "rivals" && (
          <Row title="Hero class" hint="Each class keeps its own profiles.">
            <Segmented label="Hero class" value={settings.hero_class ?? "hitscan"} onChange={(h) => save.mutate({ hero_class: h })} options={HERO_CLASSES.map((h) => ({ value: h, label: h }))} />
          </Row>
        )}
        <Row title="Current in-game sens" hint={locked ? undefined : <><span className="num">{fmtCm(cm360(settings.sens, settings.dpi, settings.yaw), 2)}</span> cm/360 at <span className="num">{settings.dpi}</span> DPI</>}>
          <NumberSetting label="Current in-game sens" value={settings.sens} onSave={(sens) => save.mutate({ sens })} />
        </Row>
      </Section>

      <Section title="Mouse">
        <Row title="DPI" hint="Sensfinder never changes this. Tell it what the mouse is set to.">
          {[400, 800].map((p) => <Button key={p} size="sm" className="num" aria-pressed={settings.dpi === p} onClick={() => save.mutate({ dpi: p })}>{p}</Button>)}
          <NumberSetting label="DPI" value={settings.dpi} onSave={(dpi) => save.mutate({ dpi })} min={99} />
        </Row>
        <Row title="Polling rate" hint={status?.capture.packet_rate ? <>Measured while moving: <span className="num">{Math.round(status.capture.packet_rate)}</span> packets/s</> : "No packets seen yet."}>
          <select aria-label="Polling rate" value={settings.polling_hz} onChange={(e) => save.mutate({ polling_hz: Number(e.target.value) })}
            className="num h-10 w-28 rounded-sm border border-line bg-s1 px-3 text-base text-text hover:border-[#343a42] focus:border-accent">
            {[125, 500, 1000, 2000, 4000, 8000].map((h) => <option key={h} value={h}>{h} Hz</option>)}
          </select>
        </Row>
        <div className="mt-4"><DetectDpi dpi={settings.dpi} onUse={(dpi) => save.mutate({ dpi })} /></div>
      </Section>

      <Section title="Hotkeys" aside={<span className="text-sm text-muted">Work while the game is focused. Each needs Ctrl, Alt or Shift.</span>}>
        {(status?.hotkeys ?? []).map((h) => (
          <Row key={h.id} title={h.label} hint={!h.ok ? <span className="flex items-center gap-1.5 text-warn"><AlertTriangle size={13} aria-hidden /><span className="text-text">Couldn't register. Another app may be using it.</span></span> : undefined}>
            {binding === h.id ? <span className="pulse text-sm text-accent-soft" role="status">Press the new combo. Esc cancels.</span> : <HotkeyBadge combo={settings.hotkeys[h.id]} />}
            <Button size="sm" onClick={() => setBinding(binding === h.id ? null : h.id)}>{binding === h.id ? "Cancel" : "Rebind"}</Button>
          </Row>
        ))}
      </Section>

      <Section title="Session">
        <Row title="Time to change sens in-game" hint="Used to plan the session. It's re-measured live as you go.">
          <NumberSetting label="Seconds to change sens" value={settings.sens_change_s} onSave={(sens_change_s) => save.mutate({ sens_change_s })} width="w-20" />
          <span className="text-sm text-muted">seconds</span>
        </Row>
      </Section>

      <Section title="Appearance">
        <Row title="Accent color">
          <div role="radiogroup" aria-label="Accent color" className="flex items-center gap-2">
            {ACCENTS.map(([hex, name]) => {
              const on = settings.accent.toLowerCase() === hex.toLowerCase();
              return (
                <button key={hex} type="button" role="radio" aria-checked={on} aria-label={name} title={name} onClick={() => save.mutate({ accent: hex })}
                  className={cx("flex size-8 items-center justify-center rounded-full border-2", on ? "border-text" : "border-transparent hover:border-line")}>
                  <span className="flex size-5 items-center justify-center rounded-full" style={{ background: hex }}>{on && <Check size={12} strokeWidth={3} className="text-black/70" aria-hidden />}</span>
                </button>
              );
            })}
          </div>
        </Row>
        <Row title="Reduce motion" hint="The ring and number count-ups update instantly. Your Windows setting is honored either way.">
          <Switch label="Reduce motion" checked={settings.reduce_motion} onChange={(v) => save.mutate({ reduce_motion: v })} />
        </Row>
      </Section>

      <Section title="Data">
        <Row title="Data folder" hint={<span className="selectable num break-all">{status?.data_dir ?? ""}</span>}>
          <Button size="sm" icon={<FolderOpen size={14} aria-hidden />} onClick={() => api.open("data").catch(reportError)}>Open data folder</Button>
        </Row>
        <Row title="Export diagnostics" hint="A zip of the logs with your user paths scrubbed. Send it along with a bug report.">
          <Button size="sm" icon={<Download size={14} aria-hidden />} onClick={exportDiag}>Export diagnostics</Button>
        </Row>
        <Row title="Updates" hint="Opens the Releases page in your browser. This is the only thing in Sensfinder that goes online, and only when you press it.">
          <Button size="sm" icon={<ExternalLink size={14} aria-hidden />} onClick={() => api.open("releases").catch(reportError)}>Check for updates</Button>
        </Row>
      </Section>

      <Section title="Safety and terms">
        <ul className="space-y-2.5 text-sm text-muted">
          <li>Sensfinder runs as its own process and listens to mouse movement through Windows Raw Input. No memory reading, no injection, no overlays, no synthetic input.</li>
          <li>Mouse only. It never records keystrokes, window titles or the screen.</li>
          <li>It never writes to game files. You type the sens in yourself; for CS2 it can make a cfg in its own folder for you to copy.</li>
          <li>No telemetry. Logs and runs stay on this PC.</li>
          <li className="text-text">Not verified: the Aim Lab terms couldn't be read during research, and how Valve (VAC) and NetEase treat raw-input listeners is inferred, not official. Check them yourself before relying on this. See docs/COMPLIANCE_TODO.md.</li>
        </ul>
      </Section>

      <Section title="About">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold text-text">Sensfinder</span>
          <span className="num text-base text-muted">{status?.version ?? window.__SF__?.version ?? ""}</span>
          <Chip>{status?.method ?? "v1.0 beta method"}</Chip>
        </div>
        <p className="mt-3 max-w-[640px] text-sm text-muted">
          Measures every flick instead of one score per run, then gives a range and a best pick. The thresholds are starting values that haven't been validated yet, which is why the Lab view exists.
          Inspired by the idea of sensitivity finders in aim trainers. It is its own method, not a copy of anyone else's.
        </p>
      </Section>
      <CalibrateRivals open={calOpen} onClose={() => setCalOpen(false)} settings={settings} />
    </Page>
  );
}
