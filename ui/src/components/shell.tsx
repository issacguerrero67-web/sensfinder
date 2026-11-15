// App chrome: title bar, nav rail, global banners, command palette, toasts.
import * as React from "react";
import { Dialog as RDialog } from "radix-ui";
import {
  Camera, ClipboardList, Crosshair, Film, FlaskConical, FolderOpen, History as HistoryIcon, Home as HomeIcon, Pause, Play,
  Search, Settings as SettingsIcon, Timer, Trophy, X, Download, RefreshCw,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Banner, Button, IconButton, TONE_ICON, cx } from "./ui";
import { api } from "../lib/api";
import { reportError, useApp, useSaveSettings, type RouteName } from "../lib/store";
import { RIVALS_BANNER, dpiMismatch } from "../lib/units";
import type { SessionPoll, Settings, Status } from "../lib/types";

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("screen-in mx-auto w-full px-10 pb-12 pt-8", !/max-w-/.test(className ?? "") && "max-w-[1040px]", className)}>{children}</div>;
}

// Status strip under the native Windows title bar (the shell uses a real frame so Snap works).
export function TitleBar({ status }: { status?: Status }) {
  const cap = status?.capture;
  const state = !cap ? "Connecting" : !cap.available || cap.error ? "Capture unavailable" : cap.paused ? "Capture paused" : "Capture ready";
  const dot = !cap ? "bg-faint" : !cap.available || cap.error || cap.paused ? "bg-danger" : "bg-good";
  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-line bg-canvas">
      <div className="flex flex-1 items-center gap-2.5 pl-4">
        <Crosshair size={15} className="text-accent-soft" aria-hidden />
        <span className="text-sm font-semibold tracking-[-0.01em] text-text">Sensfinder</span>
        {status && <span className="num text-xs text-muted">v{status.version}</span>}
      </div>
      <div className="flex items-center gap-2 px-4 text-xs text-muted" role="status" aria-label={`Mouse capture: ${state}`}>
        <span className={cx("size-2 rounded-full", dot, cap?.paused && "pulse")} aria-hidden />
        <span>{state}</span>
        {cap && cap.packet_rate > 0 && !cap.paused && <span className="num">· {Math.round(cap.packet_rate)}/s</span>}
      </div>
    </div>
  );
}

export const NAV: { name: RouteName; label: string; icon: React.ComponentType<any>; tag?: string; group: 0 | 1 | 2 }[] = [
  { name: "home", label: "Home", icon: HomeIcon, group: 0 },
  { name: "session", label: "Session", icon: Timer, group: 0 },
  { name: "verdict", label: "Verdict", icon: Trophy, group: 0 },
  { name: "history", label: "History", icon: HistoryIcon, group: 0 },
  { name: "plan", label: "Plan", icon: ClipboardList, group: 0 },
  { name: "lab", label: "Lab", icon: FlaskConical, group: 1 },
  { name: "demo", label: "Demo Analyzer", icon: Film, tag: "beta", group: 1 },
  { name: "shots", label: "Screenshots", icon: Camera, tag: "optional", group: 1 },
  { name: "settings", label: "Settings", icon: SettingsIcon, group: 2 },
];

export function NavRail({ sessionLive }: { sessionLive: boolean }) {
  const route = useApp((s) => s.route.name), nav = useApp((s) => s.nav);
  const item = (n: (typeof NAV)[number]) => {
    const active = route === n.name;
    return (
      <a key={n.name} href={`#/${n.name}`} aria-current={active ? "page" : undefined}
        onClick={(e) => { e.preventDefault(); nav(n.name); }}
        className={cx("group flex h-9 items-center gap-3 rounded-sm px-3 text-sm font-medium", active ? "bg-s2 text-text" : "text-muted hover:bg-s1 hover:text-text")}>
        <n.icon size={16} aria-hidden className={active ? "text-accent-soft" : ""} />
        <span className="flex-1 truncate">{n.label}</span>
        {n.tag && <span className="text-[11px] font-normal text-muted">{n.tag}</span>}
        {n.name === "session" && sessionLive && <span className="size-1.5 rounded-full bg-good" aria-label="session in progress" />}
      </a>
    );
  };
  return (
    <nav aria-label="Main" className="flex w-[216px] shrink-0 flex-col border-r border-line bg-canvas px-3 py-4">
      <div className="flex flex-col gap-0.5">{NAV.filter((n) => n.group === 0).map(item)}</div>
      <div className="label mb-2 mt-6 px-3">Tools</div>
      <div className="flex flex-col gap-0.5">{NAV.filter((n) => n.group === 1).map(item)}</div>
      <div className="mt-auto flex flex-col gap-0.5">
        <button type="button" onClick={() => useApp.setState({ paletteOpen: true })}
          className="flex h-9 items-center gap-3 rounded-sm px-3 text-sm font-medium text-muted hover:bg-s1 hover:text-text">
          <Search size={16} aria-hidden />
          <span className="flex-1 text-left">Search</span>
          <kbd className="num text-[11px] text-muted">Ctrl K</kbd>
        </button>
        {NAV.filter((n) => n.group === 2).map(item)}
      </div>
    </nav>
  );
}

export function GlobalBanners({ status, settings, session }: { status?: Status; settings?: Settings; session?: SessionPoll }) {
  const engineDown = useApp((s) => s.engineDown), detected = useApp((s) => s.detectedDpi);
  const save = useSaveSettings();
  const qc = useQueryClient();
  const paused = status?.capture.paused || (session?.active && session.capture_paused);
  const resume = async () => {
    try { await api.capturePause(false); qc.invalidateQueries({ queryKey: ["status"] }); qc.invalidateQueries({ queryKey: ["session"] }); } catch (e) { reportError(e); }
  };
  return (
    <div className="shrink-0">
      {engineDown && (
        <Banner tone="warn" action={<span className="flex items-center gap-2 text-xs text-muted"><RefreshCw size={13} className="animate-spin" aria-hidden />retrying</span>}>
          <strong className="font-semibold">Analysis engine restarting...</strong> <span className="text-muted">Trying again every couple of seconds. Your runs stay safe on disk.</span>
        </Banner>
      )}
      {!engineDown && status?.capture.error && (
        <Banner tone="danger"><strong className="font-semibold">Mouse capture isn't working.</strong> <span className="text-muted">{status.capture.error}</span></Banner>
      )}
      {!engineDown && paused && (
        <Banner tone="danger" dot action={<Button size="sm" onClick={resume}>Resume capture</Button>}>
          <strong className="font-semibold">Capture paused.</strong> Click the game window or press {settings?.hotkeys.pause ?? "Ctrl+Alt+P"}.
          {session?.active && session.running && <span className="text-muted"> This run is marked partial. Nothing is thrown away.</span>}
        </Banner>
      )}
      {!engineDown && status?.capture.low_rate && (
        <Banner tone="warn">
          <strong className="font-semibold">Packet rate looks low.</strong>{" "}
          <span className="text-muted">Seeing about <span className="num text-text">{Math.round(status.capture.packet_rate)}/s</span> but the mouse is set to <span className="num text-text">{settings?.polling_hz ?? 1000} Hz</span>. Check the mouse software, or correct the polling rate in Settings.</span>
        </Banner>
      )}
      {settings && dpiMismatch(detected, settings.dpi) && (
        <Banner tone="warn" action={<>
          <Button size="sm" onClick={() => save.mutate({ dpi: detected! }, { onSuccess: () => useApp.setState({ detectedDpi: null }) })}>Use {detected}</Button>
          <Button size="sm" variant="ghost" onClick={() => useApp.setState({ detectedDpi: null })}>Keep {settings.dpi}</Button>
        </>}>
          <strong className="font-semibold">DPI doesn't match.</strong>{" "}
          <span className="text-muted">Your swipe measured about <span className="num text-text">{detected}</span> DPI, but the setting is <span className="num text-text">{settings.dpi}</span>. Every cm/360 number is off until they agree.</span>
        </Banner>
      )}
      {settings?.game === "rivals" && settings.first_run_done && <Banner tone="warn"><span className="text-muted">{RIVALS_BANNER}</span></Banner>}
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts), dismiss = useApp((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-[360px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role="status" className="pop-in pointer-events-auto flex items-start gap-3 rounded-md border border-line bg-s2 py-3 pl-4 pr-2 shadow-xl shadow-black/50">
          <span className={cx("mt-0.5 shrink-0", t.kind === "good" ? "text-good" : t.kind === "warn" ? "text-warn" : t.kind === "danger" ? "text-danger" : "text-muted")}>{TONE_ICON[t.kind]}</span>
          <span className="selectable min-w-0 flex-1 break-words text-sm text-text">{t.text}</span>
          <IconButton label="Dismiss" className="-my-1.5" onClick={() => dismiss(t.id)}><X size={14} aria-hidden /></IconButton>
        </div>
      ))}
    </div>
  );
}

interface Command { id: string; label: string; hint?: string; icon: React.ComponentType<any>; run: () => void | Promise<unknown> }

export function CommandPalette({ status }: { status?: Status }) {
  const open = useApp((s) => s.paletteOpen), nav = useApp((s) => s.nav), toast = useApp((s) => s.toast);
  const [q, setQ] = React.useState(""), [sel, setSel] = React.useState(0);
  const close = () => useApp.setState({ paletteOpen: false });
  React.useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);
  const commands = React.useMemo<Command[]>(() => [
    ...NAV.map((n) => ({ id: `go-${n.name}`, label: `Go to ${n.label}`, icon: n.icon, run: () => nav(n.name) })),
    { id: "start", label: "Start a session", hint: "opens Home", icon: Play, run: () => nav("home") },
    { id: "pause", label: status?.capture.paused ? "Resume mouse capture" : "Pause mouse capture", icon: Pause, run: () => api.capturePause(!status?.capture.paused) },
    { id: "data", label: "Open data folder", icon: FolderOpen, run: () => api.open("data") },
    { id: "diag", label: "Export diagnostics", icon: Download, run: async () => toast("good", `Saved ${(await api.exportDiagnostics()).path}`) },
    { id: "update", label: "Check for updates", hint: "opens the Releases page", icon: RefreshCw, run: () => api.open("releases") },
  ], [nav, status?.capture.paused, toast]);
  const shown = commands.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));
  const run = async (c?: Command) => { if (!c) return; close(); try { await c.run(); } catch (e) { reportError(e); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(shown[sel]); }
  };
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fade-in fixed inset-0 z-40 bg-black/60" />
        <RDialog.Content aria-describedby={undefined} onKeyDown={onKey}
          className="pop-in fixed left-1/2 top-[18%] z-50 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-s1 shadow-2xl shadow-black/60">
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search size={16} className="text-muted" aria-hidden />
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Type a command or a screen"
              aria-label="Search commands" role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={shown[sel] ? `cmd-${shown[sel].id}` : undefined}
              className="h-12 flex-1 bg-transparent text-base text-text placeholder:text-muted focus:outline-none focus-visible:outline-none" />
            <kbd className="num text-[11px] text-muted">Esc</kbd>
          </div>
          <div id="palette-list" role="listbox" aria-label="Commands" className="max-h-[340px] overflow-y-auto p-2">
            {shown.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted">Nothing matches "{q}".</div>}
            {shown.map((c, i) => (
              <div key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(c)}
                className={cx("flex h-10 cursor-pointer items-center gap-3 rounded-sm px-3 text-sm", i === sel ? "bg-s2 text-text" : "text-muted")}>
                <c.icon size={16} aria-hidden />
                <span className="flex-1">{c.label}</span>
                {c.hint && <span className="text-xs text-muted">{c.hint}</span>}
              </div>
            ))}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
