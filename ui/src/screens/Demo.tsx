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
  const reanalyze = async (p: string, player: string) => {
    setBusy(true);
    try { await api.demoAnalyze(p, player); qc.invalidateQueries({ queryKey: ["demos"] }); } catch (err) { reportError(err); } finally { setBusy(false); }
  };
  const list = demos.data ?? [];

  return (
    <Page>
      <PageHeader title="Demo Analyzer" right={<><Chip tone="warn">beta</Chip><Chip>supporting evidence</Chip></>}
        sub="Reads a CS2 demo and estimates how far your shots landed from enemy heads. 64-tick demos are too coarse to see flick shape, so this only backs up the mouse-capture result. It never replaces it." />

      <form onSubmit={analyze} className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-2">
          <span className="label">Path to a .dem file</span>
          <Input mono value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\...\game\csgo\replays\match730_....dem" spellCheck={false} />
        </label>
        <Button variant="primary" type="submit" disabled={busy || !path.trim()}>{busy ? "Reading..." : "Analyze"}</Button>
      </form>

      <Section title="Results" className="mt-8">
        {demos.isLoading ? null : list.length === 0 ? (
          <EmptyState icon={<Film size={20} aria-hidden />} title="No demos analyzed yet" body="Paste the path to a matchmaking replay above. The steps below say where CS2 keeps them." />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((d) => (
              <li key={d.id} className="py-4 first:pt-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="num selectable text-base text-text">{d.file}</span>
                  <span className="text-sm text-muted">{fmtDate(d.created_at)}</span>
                  {d.path && (d.players?.length ?? 0) > 1 ? (
                    <label className="ml-auto flex items-center gap-2 text-sm text-muted">
                      Player
                      <select aria-label={`Player to analyze in ${d.file}`} disabled={busy} value={d.player ?? ""}
                        onChange={(e) => reanalyze(d.path!, e.target.value)}
                        className="h-8 rounded-[6px] border border-line bg-s1 px-2 text-sm text-text">
                        {d.players!.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.shots} shots)</option>)}
                      </select>
                    </label>
                  ) : d.player ? <span className="text-sm text-muted">· {d.player}</span> : null}
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

      <Section title="Where to get a demo">
        <ol className="space-y-3 text-base text-muted">
          <li><span className="num mr-3 text-text">1</span>Use a <span className="text-text">matchmaking replay</span>. CS2 downloads them when you watch a match from your match history, into <Code>...\Counter-Strike Global Offensive\game\csgo\replays\</Code>.</li>
          <li><span className="num mr-3 text-text">2</span>Paste the full path above and press Analyze, then pick <span className="text-text">your name</span> in the Player list. Sensfinder remembers it for next time.</li>
          <li><span className="num mr-3 text-text">3</span>Only enemies count as targets, and only quick turns onto a head count as flicks, so expect a few dozen flicks per match, not hundreds.</li>
        </ol>
        <div className="mt-5 flex items-start gap-3 border-l-2 border-warn pl-4 text-sm text-muted">
          <Chip tone="warn" className="shrink-0">offline</Chip>
          <p>Recording your own practice with <Code>record</Code> didn't work in testing: an offline match refused it as a cheat command, even with <Code>sv_cheats 1</Code>. Use matchmaking replays instead.</p>
        </div>
      </Section>
    </Page>
  );
}
