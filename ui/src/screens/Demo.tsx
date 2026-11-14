import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileQuestion, Film } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Chip, Input, PageHeader, Section } from "../components/ui";
import { EmptyState } from "../components/widgets";
import { api } from "../lib/api";
import { reportError } from "../lib/store";
import { fmtDate, fmtPct } from "../lib/units";

const Code = ({ children }: { children: React.ReactNode }) => <code className="num selectable rounded-[5px] border border-line bg-s1 px-1.5 py-0.5 text-[13px] text-text">{children}</code>;

export default function Demo() {
  const qc = useQueryClient();
  const demos = useQuery({ queryKey: ["demos"], queryFn: api.demos });
  const [path, setPath] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const analyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    setBusy(true);
    try { await api.demoAnalyze(path.trim()); setPath(""); qc.invalidateQueries({ queryKey: ["demos"] }); } catch (err) { reportError(err); } finally { setBusy(false); }
  };
  const list = demos.data ?? [];

  return (
    <Page>
      <PageHeader title="Demo Analyzer" right={<><Chip tone="warn">beta</Chip><Chip>supporting evidence</Chip></>}
        sub="Reads a CS2 demo and estimates how far your shots landed from bot heads. 64-tick demos are too coarse to see flick shape, so this only backs up the mouse-capture result. It never replaces it." />

      <form onSubmit={analyze} className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-2">
          <span className="label">Path to a .dem file</span>
          <Input mono value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\...\game\csgo\aimbotz_gotv_01.dem" spellCheck={false} />
        </label>
        <Button variant="primary" type="submit" disabled={busy || !path.trim()}>{busy ? "Reading..." : "Analyze"}</Button>
      </form>

      <Section title="Results" className="mt-8">
        {demos.isLoading ? null : list.length === 0 ? (
          <EmptyState icon={<Film size={20} aria-hidden />} title="No demos analyzed yet" body="Record one with the steps below, then paste its path above." />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((d) => (
              <li key={d.id} className="py-4 first:pt-0">
                <div className="flex items-center gap-3">
                  <span className="num selectable text-base text-text">{d.file}</span>
                  <span className="text-sm text-muted">{fmtDate(d.created_at)}{d.player ? ` · ${d.player}` : ""}</span>
                </div>
                {d.usable ? (
                  <>
                    <dl className="mt-3 grid grid-cols-5 gap-4">
                      {[["Shots", String(d.shots)], ["Flicks", String(d.flicks)], ["Over", fmtPct(d.over_rate)], ["Under", fmtPct(d.under_rate)],
                        ["Median error", d.median_error_deg == null ? "–" : `${d.median_error_deg.toFixed(1)}°`]].map(([k, v]) => (
                        <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="num mt-1 text-lg text-text">{v}</dd></div>
                      ))}
                    </dl>
                    {d.notes.length > 0 && <p className="mt-3 text-sm text-muted">{d.notes.join(" ")}</p>}
                  </>
                ) : (
                  <div className="mt-2 flex items-start gap-3 text-sm" role="status">
                    <FileQuestion size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                    <p className="text-muted"><span className="font-medium text-text">No usable data.</span> {d.message.replace(/^No usable data\.\s*/, "")} {d.notes.join(" ")}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="How to record a demo">
        <ol className="space-y-3 text-base text-muted">
          <li><span className="num mr-3 text-text">1</span>In CS2 settings, turn on <span className="text-text">Enable Developer Console</span>, then open it with <Code>~</Code>.</li>
          <li><span className="num mr-3 text-text">2</span>Load your practice map, then type <Code>record &lt;name&gt;</Code>. Play. Type <Code>stop</Code> when you're done.</li>
          <li><span className="num mr-3 text-text">3</span>If that demo has nothing usable, run a local GOTV server instead: <Code>tv_enable 1</Code>, reload the map, then <Code>tv_record &lt;name&gt;</Code>.</li>
          <li><span className="num mr-3 text-text">4</span>Files land in <Code>...\Counter-Strike Global Offensive\game\csgo\</Code> as <Code>&lt;name&gt;.dem</Code>.</li>
        </ol>
        <div className="mt-5 flex items-start gap-3 border-l-2 border-warn pl-4 text-sm text-muted">
          <Chip tone="warn" className="shrink-0">unverified</Chip>
          <p>Two things haven't been checked on a real machine yet: whether <Code>record</Code> works in offline and workshop sessions, and whether a POV demo contains bot positions at all. If your demo comes back with no usable data, that's probably why.</p>
        </div>
      </Section>
    </Page>
  );
}
