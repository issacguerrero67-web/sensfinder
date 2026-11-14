import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FlaskConical, RotateCcw } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Chip, PageHeader, Section, Segmented } from "../components/ui";
import { EmptyState } from "../components/widgets";
import { SpeedTrace } from "../components/charts";
import { api } from "../lib/api";
import { reportError, useApp } from "../lib/store";
import { fmtCm, fmtDate, fmtPct, fmtSens } from "../lib/units";
import type { Overrides } from "../lib/types";

const LEGEND = [
  { label: "Overflick", color: "bg-danger", note: "went past, came back" },
  { label: "Underflick", color: "bg-warn", note: "stopped short, pushed on" },
  { label: "On target", color: "bg-good", note: "little or no correction" },
];

export default function Lab() {
  const nav = useApp((s) => s.nav), toast = useApp((s) => s.toast);
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api.runs(100) });
  const [runId, setRunId] = React.useState<number | null>(null);
  const [overrides, setOverrides] = React.useState<Overrides>({});
  const [debounced, setDebounced] = React.useState<Overrides>({});
  const [zoom, setZoom] = React.useState<"6" | "15" | "all">("15");
  const [pos, setPos] = React.useState(0);
  const id = runId ?? runs.data?.[0]?.id ?? null;

  React.useEffect(() => { const t = setTimeout(() => setDebounced(overrides), 200); return () => clearTimeout(t); }, [overrides]);
  const lab = useQuery({ queryKey: ["lab", id, debounced], queryFn: () => api.lab(id!, debounced), enabled: id != null, placeholderData: keepPreviousData });
  const L = lab.data;

  if (runs.isLoading) return null;
  if (!runs.data?.length) {
    return <EmptyState icon={<FlaskConical size={20} aria-hidden />} title="No stored runs yet"
      body="Every run you play is saved as a raw mouse trace. Finish one and you can replay it here and see exactly which flicks were detected."
      action={<Button variant="primary" size="lg" onClick={() => nav("home")}>Start a session</Button>} />;
  }
  const dur = L ? L.run.duration : 60, win = zoom === "all" ? dur : Number(zoom);
  const from = Math.min(pos, Math.max(0, dur - win));
  const changed = Object.values(overrides).some((sec) => Object.keys(sec).length > 0);
  const setSlider = (section: string, key: string, value: number) => setOverrides((o) => ({ ...o, [section]: { ...o[section], [key]: value } }));
  const saveDefault = async () => {
    try { const r = await api.labSaveDefault(overrides); toast("good", `Saved as the new defaults in ${r.path}.`); setOverrides({}); lab.refetch(); } catch (e) { reportError(e); }
  };

  return (
    <Page className="max-w-[1120px]">
      <PageHeader title="Lab" sub="Replay a stored run and see what the segmentation picked up. These thresholds are starting values, not validated, so check them against your own runs."
        right={<Chip tone="warn">not validated</Chip>} />

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <label className="flex min-w-[320px] flex-col gap-2">
          <span className="label">Run</span>
          <select value={id ?? ""} onChange={(e) => { setRunId(Number(e.target.value)); setPos(0); }}
            className="h-10 rounded-sm border border-line bg-s1 px-3 text-sm text-text hover:border-[#343a42] focus:border-accent">
            {runs.data.map((r) => (
              <option key={r.id} value={r.id}>{fmtDate(r.created_at)} · {r.kind} · sens {fmtSens(r.sens)} ({fmtCm(r.cm360)} cm/360){r.partial ? " · partial" : ""}{r.demo ? " · demo" : ""}</option>
            ))}
          </select>
        </label>
        {L && <div className="flex items-center gap-2 pb-2">
          <Chip>{L.run.duration}s</Chip><Chip><span className="num">{Math.round(L.run.packet_rate)}/s</span></Chip>
          {L.run.partial && <Chip tone="warn">partial run</Chip>}
        </div>}
        <Segmented className="ml-auto" label="Zoom" value={zoom} onChange={setZoom} options={[{ value: "6", label: "6 s" }, { value: "15", label: "15 s" }, { value: "all", label: "Whole run" }]} />
      </div>

      {L && (
        <>
          <div className="rounded-md border border-line bg-s1 px-4 pb-3 pt-2">
            <SpeedTrace t={L.t} speed={L.speed} flicks={L.flicks} dropped={L.dropped} range={[from, from + win]} height={250}
              ariaLabel={`Mouse speed trace with ${L.flicks.length} detected flicks`} />
            <label className="mt-1 flex items-center gap-4">
              <span className="label w-16 shrink-0">Scrub</span>
              <input type="range" min={0} max={Math.max(0, dur - win)} step={0.5} value={from} disabled={zoom === "all"} onChange={(e) => setPos(Number(e.target.value))} aria-label="Scrub through the run" />
              <span className="num w-28 shrink-0 text-right text-xs text-muted">{from.toFixed(1)}–{(from + win).toFixed(1)} s</span>
            </label>
          </div>
          <ul className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted" aria-label="Legend">
            {LEGEND.map((l) => <li key={l.label} className="flex items-center gap-2"><span className={`size-2.5 rounded-[3px] ${l.color}`} aria-hidden /><span className="text-text">{l.label}</span>{l.note}</li>)}
            <li>Band = start to click</li><li>Dashed line = P, the first stop</li><li>Dot = click</li><li>✕ = dropped click</li>
          </ul>

          <div className="mt-8 grid grid-cols-[minmax(0,1fr)_340px] gap-10">
            <Section title="Thresholds" aside={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" icon={<RotateCcw size={14} aria-hidden />} disabled={!changed} onClick={() => setOverrides({})}>Reset</Button>
                <Button size="sm" disabled={!changed} onClick={saveDefault}>Save as default</Button>
              </div>}>
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                {L.sliders.map((s) => {
                  const value = overrides[s.section]?.[s.key] ?? s.value;
                  return (
                    <label key={s.key} className="flex flex-col">
                      <span className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-text">{s.label}</span>
                        <span className="num text-text">{value}{s.unit && <span className="text-muted"> {s.unit}</span>}{value !== s.default && <span className="ml-2 text-xs text-muted">was {s.default}</span>}</span>
                      </span>
                      <input type="range" min={s.min} max={s.max} step={s.step} value={value} onChange={(e) => setSlider(s.section, s.key, Number(e.target.value))} />
                    </label>
                  );
                })}
              </div>
              <p className="mt-4 text-sm text-muted">Sliders re-run segmentation on this stored trace only. The trace itself is never changed. "Save as default" writes the values to metrics.toml for future runs.</p>
            </Section>

            <div>
              <Section title="This run">
                <dl className="grid grid-cols-3 gap-x-4 gap-y-4">
                  {[["Flicks", String(L.metrics.n)], ["Over", fmtPct(L.metrics.over_rate)], ["Under", fmtPct(L.metrics.under_rate)],
                    ["Balance", `${L.metrics.balance > 0 ? "+" : ""}${Math.round(L.metrics.balance * 100)}`], ["Median s", L.metrics.median_s.toFixed(3)], ["Per min", L.metrics.flicks_per_min.toFixed(0)]].map(([k, v]) => (
                    <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="num mt-1 text-lg text-text">{v}</dd></div>
                  ))}
                </dl>
              </Section>
              <Section title={`Dropped clicks (${L.dropped.length})`}>
                {L.dropped.length === 0 ? <p className="text-sm text-muted">Every click was kept as a flick.</p> : (
                  <ul className="max-h-[168px] space-y-1.5 overflow-y-auto pr-2 text-sm" tabIndex={0} aria-label="Dropped clicks">
                    {L.dropped.map((d, i) => (
                      <li key={i} className="flex gap-3">
                        <button className="num w-14 shrink-0 text-left text-accent-soft hover:underline" onClick={() => { if (zoom === "all") setZoom("15"); setPos(Math.max(0, d.click - 3)); }}>{d.click.toFixed(2)}s</button>
                        <span className="text-muted">{d.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
