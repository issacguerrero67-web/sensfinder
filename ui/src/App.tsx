import * as React from "react";
import { Loader2 } from "lucide-react";
import { CommandPalette, GlobalBanners, NavRail, TitleBar, Toasts } from "./components/shell";
import { useApp, useSession, useSettings, useStatus } from "./lib/store";
import { shade } from "./lib/units";
import FirstRun from "./screens/FirstRun";
import Home from "./screens/Home";
import Coach from "./screens/Coach";
import VerdictScreen from "./screens/Verdict";
import History from "./screens/History";
import Plan from "./screens/Plan";
import Lab from "./screens/Lab";
import Demo from "./screens/Demo";
import Screenshots from "./screens/Screenshots";
import Settings from "./screens/Settings";

const SCREENS = { home: Home, session: Coach, verdict: VerdictScreen, history: History, plan: Plan, lab: Lab, demo: Demo, shots: Screenshots, settings: Settings };

export default function App() {
  const { data: status } = useStatus();
  const { data: settings, refetch: refetchSettings } = useSettings();
  const { data: session } = useSession();
  const route = useApp((s) => s.route), engineDown = useApp((s) => s.engineDown);

  // accent + reduce motion come from settings and land on <html> as CSS variables / a class
  React.useEffect(() => {
    const root = document.documentElement, a = /^#[0-9a-f]{6}$/i.test(settings?.accent ?? "") ? settings!.accent : "#7C5CFF";
    root.style.setProperty("--accent", a);
    root.style.setProperty("--accent-strong", shade(a, -0.14));
    root.style.setProperty("--accent-soft", shade(a, 0.32));
    root.classList.toggle("reduce-motion", !!settings?.reduce_motion);
  }, [settings?.accent, settings?.reduce_motion]);

  // engine toasts: each id shown once
  React.useEffect(() => {
    const { seenEngineToasts: seen, toast } = useApp.getState();
    for (const t of status?.toasts ?? []) if (!seen.has(t.id)) { seen.add(t.id); toast(t.kind, t.text, `engine-${t.id}`); }
  }, [status?.toasts]);

  // settings failed while the engine was down: fetch them as soon as it answers again
  React.useEffect(() => { if (status && !settings) refetchSettings(); }, [status, settings, refetchSettings]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); useApp.setState((s) => ({ paletteOpen: !s.paletteOpen })); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const Screen = SCREENS[route.name];
  const ready = !!settings;
  const firstRun = ready && !settings.first_run_done;
  return (
    <div className="flex h-full flex-col bg-canvas text-text">
      <TitleBar status={status} />
      <div className="flex min-h-0 flex-1">
        {ready && !firstRun && <NavRail sessionLive={!!session?.active && !session.finished} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <GlobalBanners status={status} settings={settings} session={session} />
          <main className="min-h-0 flex-1 overflow-y-auto" key={firstRun ? "first-run" : route.name}>
            {!ready ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-muted" role="status">
                <Loader2 size={22} className="animate-spin" aria-hidden />
                <p className="text-base">{engineDown ? "Waiting for the analysis engine." : "Starting up."}</p>
              </div>
            ) : firstRun ? <FirstRun settings={settings} /> : <Screen />}
          </main>
        </div>
      </div>
      {ready && !firstRun && <CommandPalette status={status} />}
      <Toasts />
    </div>
  );
}
