import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bot, Database, Lock, Play, Trophy } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Chip, Section, cx } from "../components/ui";
import { CalibrateRivals, EmptyState } from "../components/widgets";
import { api } from "../lib/api";
import { reportError, useApp, useSession, useSettings, useStatus } from "../lib/store";
import { GAMES, TIERS, cm360, confidenceInfo, fmtCm, fmtDate, fmtRange, fmtSens } from "../lib/units";
import type { Tier } from "../lib/types";

export function ConfidenceChip({ label, short }: { label: "Low" | "OK" | "Locked in"; short?: boolean }) {
  const info = confidenceInfo(label);
  return <Chip tone={info.tone === "good" ? "good" : info.tone === "warn" ? "warn" : "accent"}>{short ? label : `Confidence: ${label}`}</Chip>;
}

export default function Home() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: status } = useStatus();
  const { data: session } = useSession();
  const latest = useQuery({ queryKey: ["verdict-latest"], queryFn: api.latestVerdict });
  const tier = useApp((s) => s.tier), nav = useApp((s) => s.nav), toast = useApp((s) => s.toast);
  const [busy, setBusy] = React.useState(false);
  const [calOpen, setCalOpen] = React.useState(false);
  if (!settings) return null;

  const g = GAMES[settings.game];
  const locked = settings.game === "rivals" && !settings.rivals_yaw;
  const open = !!session?.active && !session.finished;
  const cm = cm360(settings.sens, settings.dpi, settings.yaw);

  const start = async (demo: boolean) => {
    setBusy(true);
    try {
      if (session?.active && session.finished) await api.closeSession();
      qc.setQueryData(["session"], await api.sessionStart(tier, demo));
      nav("session");
    } catch (e) { reportError(e); } finally { setBusy(false); }
  };
  const importBeta = async () => {
    try {
      const r = await api.betaImport();
      toast("good", `Imported ${r.imported} beta runs. The original files are untouched.`);
      qc.invalidateQueries({ queryKey: ["status"] });
    } catch (e) { reportError(e); }
  };
  const v = latest.data?.verdict;

  return (
    <Page>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text">Find your sens</h1>
        <p className="mt-2 text-base text-muted">
          {g.name}{settings.game === "rivals" && settings.hero_class ? ` · ${settings.hero_class}` : ""} · currently <span className="num text-text">{fmtSens(settings.sens)}</span>
          {!locked && <> · <span className="num text-text">{fmtCm(cm, 2)}</span> cm/360</>} at <span className="num text-text">{settings.dpi}</span> DPI
        </p>
      </header>

      <div role="radiogroup" aria-label="Session tier" className="grid grid-cols-3 gap-4">
        {TIERS.map((t) => {
          const on = tier === t.id;
          return (
            <button key={t.id} type="button" role="radio" aria-checked={on} disabled={open} onClick={() => useApp.setState({ tier: t.id as Tier })}
              className={cx("flex flex-col items-start rounded-md border p-5 text-left disabled:opacity-60", on ? "border-accent bg-accent/10" : "border-line bg-s1 hover:border-[#343a42]")}>
              <span className="flex w-full items-center justify-between">
                <span className="text-lg font-semibold text-text">{t.label}</span>
                {t.isDefault && <span className="text-xs text-muted">default</span>}
              </span>
              <span className="num mt-3 text-xl font-medium text-text">{t.time}</span>
              <span className="mt-2 text-sm text-muted">{t.promise}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-4">
        {locked ? (
          <Button variant="primary" size="hero" icon={<Lock size={18} aria-hidden />} onClick={() => setCalOpen(true)}>Calibrate game</Button>
        ) : open ? (
          <Button variant="primary" size="hero" onClick={() => nav("session")}>Resume session<ArrowRight size={18} aria-hidden /></Button>
        ) : (
          <Button variant="primary" size="hero" icon={<Play size={18} aria-hidden fill="currentColor" />} disabled={busy} onClick={() => start(false)}>Start session</Button>
        )}
        {!open && !locked && (
          <Button size="hero" variant="secondary" className="font-medium" icon={<Bot size={18} aria-hidden />} disabled={busy} onClick={() => start(true)}>Try Demo mode</Button>
        )}
        <p className="ml-2 max-w-[340px] text-sm text-muted">
          {locked ? "Marvel Rivals is locked until you do one calibration turn. It takes about a minute."
            : open ? `Your ${session.tier_label} session is still open.`
            : "Demo mode runs the whole flow with a simulated player. No mouse or game needed."}
        </p>
      </div>
      <p className="mt-5 text-sm text-muted">
        Usual {g.name} range: <span className="num">{g.range[0]}–{g.range[1]}</span> cm/360 (start around <span className="num">{g.start}</span>). Community ranges, not evidence.
      </p>

      <Section title="Last result" className="mt-10">
        {v && latest.data ? (
          <div className="flex items-center gap-10">
            <div>
              <div className="flex items-baseline gap-3">
                <span className="num text-2xl font-medium text-text">{fmtSens(v.pick_sens)}</span>
                <span className="num text-lg text-muted">{fmtCm(v.pick_cm)} cm/360</span>
              </div>
              <div className="mt-1 text-sm text-muted">range <span className="num text-text">{fmtRange(v.lo_cm, v.hi_cm)}</span> cm/360 · {GAMES[v.game].name} · {fmtDate(latest.data.created_at)}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ConfidenceChip label={v.confidence} />
              {v.demo && <Chip icon={<Bot size={12} aria-hidden />}>Demo: simulated player</Chip>}
            </div>
            <Button className="ml-auto" onClick={() => nav("verdict", latest.data!.id)}>Open result<ArrowRight size={15} aria-hidden /></Button>
          </div>
        ) : latest.isLoading ? <div className="h-12" /> : (
          <EmptyState compact icon={<Trophy size={18} aria-hidden />} title="No result yet"
            body="Pick a tier and start a session. Your best pick and range show up here when it's done." />
        )}
      </Section>

      {status?.beta.available && status.beta.imported === 0 && (
        <Section title="Beta data">
          <div className="flex items-center gap-4">
            <Database size={18} className="shrink-0 text-faint" aria-hidden />
            <p className="flex-1 text-base text-muted">
              Found <span className="num text-text">{status.beta.rows}</span> runs from the beta. Import them so they show up here. The original files stay exactly as they are.
            </p>
            <Button onClick={importBeta}>Import beta data</Button>
          </div>
        </Section>
      )}
      <CalibrateRivals open={calOpen} onClose={() => setCalOpen(false)} settings={settings} />
    </Page>
  );
}
