import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, ClipboardList, Target } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Chip, PageHeader, cx } from "../components/ui";
import { EmptyState } from "../components/widgets";
import { api } from "../lib/api";
import { reportError, useApp } from "../lib/store";
import { fmtDate } from "../lib/units";

export default function Plan() {
  const qc = useQueryClient();
  const nav = useApp((s) => s.nav);
  const plan = useQuery({ queryKey: ["plan"], queryFn: api.plan });
  const p = plan.data;
  if (plan.isLoading) return null;
  if (!p) {
    return <EmptyState icon={<ClipboardList size={20} aria-hidden />} title="No plan yet"
      body="The plan is built from your last result. Finish a session and three short drills show up here."
      action={<Button variant="primary" size="lg" onClick={() => nav("home")}>Start a session</Button>} />;
  }
  const check = async (item_id: string, checked: boolean) => {
    try { qc.setQueryData(["plan"], await api.planCheck(item_id, checked)); } catch (e) { reportError(e); }
  };
  const due = new Date(p.retest_on + "T00:00:00").getTime() <= Date.now();
  const total = p.cards.reduce((a, c) => a + c.items.length, 0), done = p.cards.reduce((a, c) => a + c.items.filter((i) => i.checked).length, 0);

  return (
    <Page>
      <PageHeader title="Training plan" sub={<>Built from your result on {fmtDate(p.created_at)}. <span className="num text-text">{done}</span> of <span className="num text-text">{total}</span> done.</>}
        right={<Chip>suggested</Chip>} />

      <div className="grid grid-cols-3 gap-5">
        {p.cards.map((c) => {
          const n = c.items.filter((i) => i.checked).length;
          return (
            <section key={c.id} aria-label={c.title} className="flex flex-col rounded-md border border-line bg-s1 p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold text-text">{c.title}</h2>
                <span className="num shrink-0 text-sm text-muted">{c.minutes} min</span>
              </div>
              <p className="mt-2 min-h-[60px] text-sm text-muted">{c.why}</p>
              <div className="mt-4 flex items-start gap-2 text-sm text-muted">
                <Target size={14} className="mt-[3px] shrink-0 text-faint" aria-hidden />
                <span>Should move <span className="block text-text">{c.metric}</span></span>
              </div>
              <ul className="mt-5 flex-1 border-t border-line pt-3">
                {c.items.map((i) => (
                  <li key={i.id}>
                    <button type="button" role="checkbox" aria-checked={!!i.checked} onClick={() => check(i.id, !i.checked)}
                      className="flex min-h-10 w-full items-center gap-3 rounded-sm py-1.5 text-left text-sm hover:bg-s2">
                      <span className={cx("flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-200",
                        i.checked ? "border-accent-strong bg-accent-strong text-white" : "border-[#3a414b]")}>
                        {i.checked && <Check size={13} strokeWidth={3} aria-hidden />}
                      </span>
                      <span className={i.checked ? "text-muted line-through" : "text-text"}>{i.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-1 flex-1 rounded-full bg-line" aria-hidden><div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${(n / c.items.length) * 100}%` }} /></div>
                <span className="num text-xs text-muted">{n}/{c.items.length}</span>
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-4 border-t border-line pt-6">
        <CalendarClock size={18} className={cx("shrink-0", due ? "text-warn" : "text-faint")} aria-hidden />
        <p className="flex-1 text-base text-muted">
          {due ? <><span className="text-text">Time to re-test.</span> It's been {p.cards[0]?.retest_days ?? 7} days since this plan was made. Run a session and see what moved.</>
            : <>Re-test on <span className="text-text">{fmtDate(p.retest_on + "T00:00:00")}</span>, {p.cards[0]?.retest_days ?? 7} days after the result. One session is enough to see what moved.</>}
        </p>
        <Button variant={due ? "primary" : "secondary"} onClick={() => nav("home")}>{due ? "Start a re-test" : "Re-test early"}</Button>
      </div>
      <p className="mt-4 text-sm text-muted">Which task helps which problem is our judgment, not Aimlabs' own labelling. Treat it as a starting point.</p>
    </Page>
  );
}
