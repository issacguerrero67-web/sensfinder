import * as React from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, GitCompareArrows, History as HistoryIcon, Star, Trash2 } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Chip, IconButton, Modal, PageHeader, Segmented, cx } from "../components/ui";
import { EmptyState } from "../components/widgets";
import { CurveChart } from "../components/charts";
import { ConfidenceChip } from "./Home";
import { api } from "../lib/api";
import { reportError, useApp, useSettings } from "../lib/store";
import { GAMES, HERO_CLASSES, fmtCm, fmtDate, fmtRange, fmtSens, tierInfo } from "../lib/units";
import type { Game, HeroClass } from "../lib/types";

function Compare({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const qs = useQueries({ queries: ids.map((id) => ({ queryKey: ["verdict", id], queryFn: () => api.verdict(id) })) });
  const [a, b] = qs.map((q) => q.data);
  const ready = a && b;
  const rows = React.useMemo(() => {
    if (!a || !b) return [];
    const m = new Map<number, Record<string, number | null>>();
    for (const l of a.verdict.levels) m.set(l.cm360, { cm360: l.cm360, a: l.balance, b: null });
    for (const l of b.verdict.levels) m.set(l.cm360, { ...(m.get(l.cm360) ?? { cm360: l.cm360, a: null }), b: l.balance });
    return [...m.values()].sort((x, y) => (x.cm360 as number) - (y.cm360 as number));
  }, [a, b]);
  return (
    <Modal open onClose={onClose} title="Compare sessions" width={820} description="Balance curves from both sessions on the same axes. The vertical lines are each session's pick.">
      {!ready ? <div className="h-[320px]" /> : (
        <>
          <CurveChart rows={rows} height={320}
            series={[{ key: "a", label: fmtDate(a.created_at).replace(/, \d{4}$/, ""), color: "accent", axis: "bal" }, { key: "b", label: fmtDate(b.created_at).replace(/, \d{4}$/, ""), color: "good", axis: "bal", dash: "5 4" }]}
            picks={[{ cm: a.verdict.pick_cm, label: fmtCm(a.verdict.pick_cm) }, { cm: b.verdict.pick_cm, label: fmtCm(b.verdict.pick_cm) }]}
            ariaLabel="Balance curves of two sessions overlaid" />
          <div className="mt-4 grid grid-cols-2 gap-6 border-t border-line pt-4">
            {[a, b].map((x, i) => (
              <div key={x.id}>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span className={cx("h-0.5 w-5", i === 0 ? "bg-accent" : "border-t-2 border-dashed border-good")} aria-hidden />
                  {i === 0 ? "Solid line" : "Dashed line"} · {fmtDate(x.created_at)} · {tierInfo(x.verdict.tier).label}
                </div>
                <div className="num mt-2 text-lg text-text">{fmtSens(x.verdict.pick_sens)} <span className="text-muted">· {fmtCm(x.verdict.pick_cm)} cm/360, range {fmtRange(x.verdict.lo_cm, x.verdict.hi_cm)}</span></div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

export default function History() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const nav = useApp((s) => s.nav);
  const [game, setGame] = React.useState<Game>(settings?.game ?? "cs2");
  const [hero, setHero] = React.useState<HeroClass | "all">("all");
  const [picked, setPicked] = React.useState<number[]>([]);
  const [comparing, setComparing] = React.useState(false);
  const heroArg = game === "rivals" && hero !== "all" ? hero : null;
  const list = useQuery({ queryKey: ["verdicts", game, heroArg], queryFn: () => api.verdicts(game, heroArg) });
  const rows = list.data ?? [];

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const remove = async (id: number) => {
    try { await api.deleteVerdict(id); setPicked((p) => p.filter((x) => x !== id)); qc.invalidateQueries({ queryKey: ["verdicts"] }); qc.invalidateQueries({ queryKey: ["verdict-latest"] }); } catch (e) { reportError(e); }
  };

  return (
    <Page>
      <PageHeader title="History" sub="Every finished session, newest first. Saved profiles are starred."
        right={<Button icon={<GitCompareArrows size={15} aria-hidden />} disabled={picked.length !== 2} onClick={() => setComparing(true)}>
          {picked.length === 2 ? "Compare sessions" : `Compare sessions (pick ${2 - picked.length})`}</Button>} />
      <div className="grid grid-cols-[176px_minmax(0,1fr)] gap-8">
        <div role="tablist" aria-label="Game" aria-orientation="vertical" className="flex flex-col gap-0.5">
          <div className="label mb-2 px-3">Games</div>
          {(Object.keys(GAMES) as Game[]).map((g) => (
            <button key={g} role="tab" aria-selected={game === g} onClick={() => { setGame(g); setPicked([]); }}
              className={cx("flex h-9 items-center rounded-sm px-3 text-left text-sm font-medium", game === g ? "bg-s2 text-text" : "text-muted hover:bg-s1 hover:text-text")}>{GAMES[g].name}</button>
          ))}
        </div>
        <div className="min-w-0">
          {game === "rivals" && (
            <Segmented className="mb-5" label="Hero class" value={hero} onChange={(h) => { setHero(h); setPicked([]); }}
              options={[{ value: "all" as const, label: "All" }, ...HERO_CLASSES.map((h) => ({ value: h, label: h }))]} />
          )}
          {list.isLoading ? null : rows.length === 0 ? (
            <EmptyState icon={<HistoryIcon size={20} aria-hidden />} title={`No ${GAMES[game].name} sessions yet`}
              body={game === "rivals" && hero !== "all" ? `Nothing saved for ${hero} heroes. Finish a session with that class picked and it lands here.` : "Finish a session and it lands here with its pick, range and confidence."}
              action={<Button variant="primary" onClick={() => nav("home")}>Start a session</Button>} />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="label w-10 py-2 font-medium"><span className="sr-only">Compare</span></th>
                  <th scope="col" className="label py-2 font-medium">Session</th>
                  <th scope="col" className="label py-2 text-right font-medium">Sens</th>
                  <th scope="col" className="label py-2 text-right font-medium">cm/360</th>
                  <th scope="col" className="label py-2 pl-6 font-medium">Range</th>
                  <th scope="col" className="label py-2 font-medium">Confidence</th>
                  <th scope="col" className="label py-2 font-medium">Date</th>
                  <th scope="col" className="w-10"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="group border-b border-line hover:bg-s1">
                    <td className="py-0">
                      <label className="flex size-10 cursor-pointer items-center justify-center">
                        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Pick the ${fmtDate(r.created_at)} session to compare`} />
                      </label>
                    </td>
                    <td className="py-3">
                      <button className="flex items-center gap-2 text-left font-medium text-text hover:text-accent-soft" onClick={() => nav("verdict", r.id)}>
                        {r.profile_name ? <><Star size={13} className="text-warn" fill="currentColor" aria-label="saved profile" />{r.profile_name}</> : `${tierInfo(r.tier).label} session`}
                      </button>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        {r.profile_name && <span>{tierInfo(r.tier).label}</span>}
                        {r.hero_class && <span className="capitalize">{r.hero_class}</span>}
                        {r.demo && <Chip className="h-5 px-2" icon={<Bot size={11} aria-hidden />}>Demo</Chip>}
                      </div>
                    </td>
                    <td className="num py-3 text-right text-base text-text">{fmtSens(r.pick_sens)}</td>
                    <td className="num py-3 text-right text-text">{fmtCm(r.pick_cm)}</td>
                    <td className="num py-3 pl-6 text-muted">{fmtRange(r.lo_cm, r.hi_cm)}</td>
                    <td className="py-3"><ConfidenceChip short label={r.confidence} /></td>
                    <td className="py-3 text-muted">{fmtDate(r.created_at)}</td>
                    <td className="py-3"><IconButton label={`Delete the ${fmtDate(r.created_at)} session`} onClick={() => remove(r.id)}><Trash2 size={15} aria-hidden /></IconButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {comparing && picked.length === 2 && <Compare ids={picked} onClose={() => setComparing(false)} />}
    </Page>
  );
}
