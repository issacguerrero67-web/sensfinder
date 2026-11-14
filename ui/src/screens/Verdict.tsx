import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Bot, Check, CheckCircle2, Copy, FileCode2, FolderOpen, HelpCircle, Save, Trophy } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Chip, Field, Input, Modal, Section, Segmented, cx } from "../components/ui";
import { CountUp, EmptyState, StatDelta } from "../components/widgets";
import { CurveChart } from "../components/charts";
import { ConfidenceChip } from "./Home";
import { api } from "../lib/api";
import { copyText, reportError, useApp, useSession } from "../lib/store";
import { GAMES, HERO_CLASSES, curveFor, fmtClock, fmtCm, fmtDate, fmtPct, fmtRange, fmtSens, tierInfo } from "../lib/units";
import type { CfgResult, HeroClass, Verdict } from "../lib/types";

const DIAGNOSIS: Record<Verdict["diagnosis"][number], { title: string; body: string }> = {
  over: { title: "Overflicking", body: "You go past the target and come back more often than you stop short." },
  under: { title: "Underflicking", body: "You stop short of the target and have to push on more often than you overshoot." },
  shaky: { title: "Shaky tracking", body: "Your tracking has a lot of small direction changes at the faster end." },
  inconsistent: { title: "Inconsistent flick distance", body: "Similar flicks land at quite different distances from run to run." },
};

function WhyDrawer({ v, open, onClose }: { v: Verdict; open: boolean; onClose: () => void }) {
  const hasShake = v.levels.some((l) => l.shake != null), hasScore = v.levels.some((l) => l.score != null);
  const th = "label px-3 py-2 text-right font-medium first:text-left";
  const td = "num px-3 py-2.5 text-right text-sm text-text first:text-left";
  return (
    <Modal side open={open} onClose={onClose} title="Why this?" width={640}
      description={`${v.method}. Thresholds are starting values, not validated. The range matters more than the single pick.`}>
      <h3 className="label mb-2 mt-2">Per sens level</h3>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse">
          <thead className="bg-s2">
            <tr>
              <th className={th} scope="col">cm/360</th><th className={th} scope="col">Sens</th><th className={th} scope="col">Flicks</th>
              <th className={th} scope="col">Over</th><th className={th} scope="col">Under</th><th className={th} scope="col">Balance</th>
              {hasShake && <th className={th} scope="col">Shake</th>}{hasScore && <th className={th} scope="col">Score</th>}
            </tr>
          </thead>
          <tbody>
            {[...v.levels].sort((a, b) => a.cm360 - b.cm360).map((l) => {
              const inZone = l.cm360 >= v.lo_cm && l.cm360 <= v.hi_cm;
              return (
                <tr key={l.cm360} className={cx("border-t border-line", inZone && "bg-accent/10")}>
                  <td className={td}>{fmtCm(l.cm360)}{inZone && <span className="ml-2 font-sans text-xs text-accent-soft">in range</span>}</td>
                  <td className={td}>{fmtSens(l.sens)}</td><td className={td}>{l.n}</td>
                  <td className={td}>{fmtPct(l.over_rate)}</td><td className={td}>{fmtPct(l.under_rate)}</td>
                  <td className={td}>{Math.round(l.balance * 100) > 0 ? "+" : Math.round(l.balance * 100) < 0 ? "−" : ""}{Math.abs(Math.round(l.balance * 100))}</td>
                  {hasShake && <td className={td}>{l.shake == null ? "–" : l.shake.toFixed(2)}</td>}
                  {hasScore && <td className={td}>{l.score == null ? "–" : Math.round(l.score).toLocaleString("en-US")}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-muted">Balance is overflick rate minus underflick rate. The pick sits where it crosses zero.</p>

      <h3 className="label mb-3 mt-8">Confirm against your current sens</h3>
      {v.confirm ? (
        <div>
          <p className="mb-4 flex items-center gap-2 text-base text-text">
            {v.confirm.accept ? <CheckCircle2 size={16} className="text-good" aria-hidden /> : <AlertTriangle size={16} className="text-warn" aria-hidden />}
            {v.confirm.accept ? "The pick held up against your current sens." : `The pick was worse on ${v.confirm.worse.join(" and ") || "some measures"}, so the range was widened back toward your current sens.`}
          </p>
          <div className="grid grid-cols-2 gap-6">
            <StatDelta label="Flick error at the pick" value={fmtPct(v.confirm.pick_error)} delta={v.confirm.current_error ? v.confirm.pick_error / v.confirm.current_error - 1 : null} />
            <StatDelta label="Corrections per flick" value={v.confirm.pick_corrections.toFixed(2)} delta={v.confirm.current_corrections ? v.confirm.pick_corrections / v.confirm.current_corrections - 1 : null} />
          </div>
          <p className="mt-2 text-sm text-muted">Compared with your current sens ({fmtSens(v.start_sens)}).</p>
        </div>
      ) : <p className="text-base text-muted">This session didn't include a confirm stage, so the pick hasn't been checked head-to-head against {fmtSens(v.start_sens)}.</p>}

      <h3 className="label mb-3 mt-8">Notes</h3>
      <ul className="space-y-2 text-base text-muted">
        {v.notes.map((n, i) => <li key={i}>{n}</li>)}
        {v.fatigue.flag && <li>You slowed down over the session, so later runs count a little less.</li>}
        {v.notes.length === 0 && !v.fatigue.flag && <li>Nothing unusual.</li>}
      </ul>

      <h3 className="label mb-3 mt-8">Session</h3>
      <dl className="grid grid-cols-4 gap-4 text-sm">
        {[["Runs", String(v.runs)], ["Flicks", v.flicks.toLocaleString("en-US")], ["Time", `${fmtClock(v.elapsed_s)} of ${fmtClock(v.budget_s)}`],
          ["Drift", v.drift == null ? "–" : `${(v.drift * 100).toFixed(1)}%`]].map(([k, val]) => (
          <div key={k}><dt className="text-muted">{k}</dt><dd className="num mt-1 text-base text-text">{val}</dd></div>
        ))}
      </dl>
    </Modal>
  );
}

export default function VerdictScreen() {
  const qc = useQueryClient();
  const route = useApp((s) => s.route), nav = useApp((s) => s.nav), toast = useApp((s) => s.toast);
  const { data: session } = useSession();
  const id = route.param ? Number(route.param) : null;
  const fromSession = !id && session?.active && session.finished && session.verdict ? session : null;
  const byId = useQuery({ queryKey: ["verdict", id], queryFn: () => api.verdict(id!), enabled: !!id });
  const latest = useQuery({ queryKey: ["verdict-latest"], queryFn: api.latestVerdict, enabled: !id && !fromSession });
  const [why, setWhy] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [hero, setHero] = React.useState<HeroClass>("hitscan");
  const [cfg, setCfg] = React.useState<CfgResult | null>(null);
  const [copied, setCopied] = React.useState(false);

  const v: Verdict | undefined = id ? byId.data?.verdict : fromSession ? fromSession.verdict! : latest.data?.verdict;
  const vid = id ?? (fromSession ? fromSession.verdict_id : latest.data?.id) ?? null;
  const created = id ? byId.data?.created_at : fromSession ? undefined : latest.data?.created_at;
  const loading = id ? byId.isLoading : !fromSession && latest.isLoading;

  if (loading) return null;
  if (!v) {
    return <EmptyState icon={<Trophy size={20} aria-hidden />} title="No result yet"
      body="Finish a session and your best pick and range show up here. Demo mode works too if you just want to see it."
      action={<Button variant="primary" size="lg" onClick={() => nav("home")}>Go to Home</Button>} />;
  }
  const chart = curveFor(v.levels);
  const copy = async () => {
    if (await copyText(fmtSens(v.pick_sens))) { setCopied(true); setTimeout(() => setCopied(false), 1500); toast("good", `Copied ${fmtSens(v.pick_sens)}. Paste it into the game's sens box.`); }
    else toast("warn", `Couldn't reach the clipboard. Type ${fmtSens(v.pick_sens)} by hand.`);
  };
  const saveProfile = async () => {
    if (vid == null) return;
    try {
      await api.saveProfile(vid, name.trim() || `${GAMES[v.game].name} ${fmtSens(v.pick_sens)}`, v.game === "rivals" ? hero : null);
      setSaveOpen(false); toast("good", "Profile saved. It's in History.");
      qc.invalidateQueries({ queryKey: ["verdicts"] });
    } catch (e) { reportError(e); }
  };
  const makeCfg = async () => { if (vid == null) return; try { setCfg(await api.cfg(vid)); } catch (e) { reportError(e); } };
  const done = async () => { try { await api.closeSession(); qc.setQueryData(["session"], { active: false }); qc.invalidateQueries({ queryKey: ["verdict-latest"] }); nav("home"); } catch (e) { reportError(e); } };

  return (
    <Page>
      <div className="flex items-center gap-2">
        <span className="label mr-2">Result · {GAMES[v.game].name} · {tierInfo(v.tier).label}{created ? ` · ${fmtDate(created)}` : ""}</span>
        <Chip>{v.method}</Chip>
        {v.demo && <Chip tone="accent" icon={<Bot size={12} aria-hidden />}>Demo mode: simulated player</Chip>}
        {fromSession && <Button size="sm" className="ml-auto" onClick={done}>Done</Button>}
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3" data-testid="verdict-hero">
        <CountUp value={v.pick_sens} format={fmtSens} className="text-hero font-medium tracking-[-0.04em] text-text" />
        <div className="pb-2">
          <div className="num text-xl text-muted"><span className="text-text">{fmtCm(v.pick_cm)}</span> cm/360</div>
          <div className="num mt-1 text-base text-muted">range <span className="text-text" data-testid="verdict-range">{fmtRange(v.lo_cm, v.hi_cm)}</span> cm/360 · sens <span className="text-text">{fmtSens(v.lo_sens)}–{fmtSens(v.hi_sens)}</span></div>
        </div>
        <div className="pb-3"><ConfidenceChip label={v.confidence} /></div>
      </div>
      <p className="mt-3 max-w-[640px] text-base text-muted">
        {v.trend
          ? "Best pick, with the range it sits in. Anywhere inside the range is a reasonable choice; the differences in there are small."
          : <span className="flex items-start gap-2"><AlertTriangle size={16} className="mt-1 shrink-0 text-warn" aria-hidden /><span className="text-text">No clear balance point was found, so the range is wide. Your over and underflicks look about even across what was tested. Staying where you are is a fair call.</span></span>}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" icon={copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
        <Button size="lg" icon={<Save size={16} aria-hidden />} disabled={vid == null} onClick={() => { setName(""); setSaveOpen(true); }}>Save profile</Button>
        {v.game === "cs2" && <Button size="lg" icon={<FileCode2 size={16} aria-hidden />} disabled={vid == null} onClick={makeCfg}>Generate CS2 cfg</Button>}
        <Button size="lg" variant="ghost" icon={<HelpCircle size={16} aria-hidden />} onClick={() => setWhy(true)}>Why this?</Button>
      </div>

      <Section title="Curve" className="mt-10" aside={<span className="text-sm text-muted">Balance above the line means more overflicks, below means more underflicks.</span>}>
        <CurveChart rows={chart.rows} series={chart.series} band={{ lo: v.lo_cm, hi: v.hi_cm }} bandLabel={v.trend ? "best zone" : "range (no clear best zone)"} picks={[{ cm: v.pick_cm, label: `pick ${fmtCm(v.pick_cm)}` }]}
          ariaLabel={`Balance per sens level. Best zone ${fmtRange(v.lo_cm, v.hi_cm)} cm/360, pick ${fmtCm(v.pick_cm)}.`} />
      </Section>

      <Section title="What we saw" aside={<Chip>suggested</Chip>}>
        <div className="grid grid-cols-2 gap-x-12 gap-y-6">
          <div className="space-y-5">
            {v.diagnosis.length === 0 && <p className="text-base text-muted">Nothing stood out. Your flicks were balanced at the pick.</p>}
            {v.diagnosis.map((d) => (
              <div key={d}>
                <div className="text-base font-medium text-text">{DIAGNOSIS[d].title}</div>
                <p className="mt-1 text-sm text-muted">{DIAGNOSIS[d].body}</p>
              </div>
            ))}
          </div>
          <div>
            <ul className="divide-y divide-line border-y border-line">
              {v.plan.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="text-base font-medium text-text">{c.title}</div>
                    <div className="truncate text-sm text-muted">{c.items.map((i) => i.text.split(" · ")[0]).join(", ")}</div>
                  </div>
                  <span className="num shrink-0 text-sm text-muted">{c.minutes} min</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-sm text-muted">Task picks are our suggestion, not Aimlabs' own labels.</p>
              <Button size="sm" onClick={() => nav("plan")}>Open training plan<ArrowRight size={14} aria-hidden /></Button>
            </div>
          </div>
        </div>
      </Section>

      <WhyDrawer v={v} open={why} onClose={() => setWhy(false)} />

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save as a profile" description="Saved profiles are pinned in History so you can find them again.">
        <form onSubmit={(e) => { e.preventDefault(); saveProfile(); }} className="space-y-5">
          <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`${GAMES[v.game].name} ${fmtSens(v.pick_sens)}`} /></Field>
          {v.game === "rivals" && <Field label="Hero class"><Segmented label="Hero class" value={hero} onChange={setHero} options={HERO_CLASSES.map((h) => ({ value: h, label: h }))} /></Field>}
          <div className="flex justify-end gap-3"><Button onClick={() => setSaveOpen(false)}>Cancel</Button><Button variant="primary" type="submit">Save profile</Button></div>
        </form>
      </Modal>

      <Modal open={!!cfg} onClose={() => setCfg(null)} title="CS2 cfg" width={560}
        description="Sensfinder never writes into the game. This file is in Sensfinder's own data folder; you move it and run it.">
        {cfg && (
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between"><span className="label">{cfg.filename}</span>
                <Button size="sm" icon={<Copy size={14} aria-hidden />} onClick={async () => { if (await copyText(cfg.content)) toast("good", "Copied the file contents."); }}>Copy</Button></div>
              <pre className="num overflow-x-auto rounded-sm border border-line bg-canvas p-4 text-sm leading-6 text-text">{cfg.content}</pre>
            </div>
            <ol className="space-y-2 text-sm text-muted">
              <li><span className="num mr-2 text-text">1</span>Copy <span className="num text-text">{cfg.filename}</span> into <span className="num break-all text-text">...\Counter-Strike Global Offensive\game\csgo\cfg\</span></li>
              <li className="flex flex-wrap items-center gap-2"><span><span className="num mr-2 text-text">2</span>Open the CS2 console and run</span>
                <code className="num rounded-sm border border-line bg-canvas px-2 py-1 text-text">{cfg.command}</code>
                <Button size="sm" variant="ghost" icon={<Copy size={14} aria-hidden />} onClick={async () => { if (await copyText(cfg.command)) toast("good", `Copied ${cfg.command}`); }}>Copy command</Button></li>
            </ol>
            <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
              <span className="selectable num min-w-0 truncate text-xs text-muted" title={cfg.path}>{cfg.path}</span>
              <Button size="sm" icon={<FolderOpen size={14} aria-hidden />} onClick={() => api.open("cfg").catch(reportError)}>Open folder</Button>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
}
