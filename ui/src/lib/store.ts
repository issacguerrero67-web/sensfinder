// App state (tiny hash router, toasts, UI flags) and the shared engine queries.
import { create } from "zustand";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiEvents, ApiError } from "./api";
import type { Settings, Tier, ToastKind } from "./types";

export type RouteName = "home" | "session" | "verdict" | "history" | "plan" | "lab" | "demo" | "shots" | "settings";
const ROUTES: RouteName[] = ["home", "session", "verdict", "history", "plan", "lab", "demo", "shots", "settings"];
export interface Route { name: RouteName; param: string | null }

function parseHash(): Route {
  const [name, param] = (typeof location === "undefined" ? "" : location.hash).replace(/^#\/?/, "").split("/");
  return { name: ROUTES.includes(name as RouteName) ? (name as RouteName) : "home", param: param || null };
}

export interface ToastItem { id: string; kind: ToastKind; text: string }

interface AppState {
  route: Route;
  nav: (name: RouteName, param?: string | number | null) => void;
  toasts: ToastItem[];
  toast: (kind: ToastKind, text: string, id?: string) => void;
  dismiss: (id: string) => void;
  seenEngineToasts: Set<number>;
  engineDown: boolean;
  detectedDpi: number | null;
  paletteOpen: boolean;
  tier: Tier;
}

let toastSeq = 0;
export const useApp = create<AppState>((set, get) => ({
  route: parseHash(),
  nav: (name, param = null) => {
    const hash = `#/${name}${param != null ? `/${param}` : ""}`;
    if (typeof location !== "undefined" && location.hash !== hash) location.hash = hash;
    set({ route: { name, param: param != null ? String(param) : null } });
  },
  toasts: [],
  toast: (kind, text, id) => {
    const tid = id ?? `local-${++toastSeq}`;
    if (get().toasts.some((t) => t.id === tid)) return;
    set({ toasts: [...get().toasts.slice(-3), { id: tid, kind, text }] });
    setTimeout(() => get().dismiss(tid), kind === "danger" ? 8000 : 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  seenEngineToasts: new Set(),
  engineDown: false,
  detectedDpi: null,
  paletteOpen: false,
  tier: "standard",
}));

if (typeof window !== "undefined") window.addEventListener("hashchange", () => useApp.setState({ route: parseHash() }));
apiEvents.onHealth = (down) => { if (useApp.getState().engineDown !== down) useApp.setState({ engineDown: down }); };

/** Show an API failure as a toast. Network failures are covered by the engine banner instead. */
export function reportError(e: unknown) {
  if (e instanceof ApiError && e.network) return;
  useApp.getState().toast("danger", e instanceof Error ? e.message : "Something went wrong.");
}

export const useStatus = () => useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 2000 });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: api.settings });
export const useSession = () =>
  useQuery({ queryKey: ["session"], queryFn: api.session, refetchInterval: (q) => (q.state.data?.active ? 250 : 2000) });

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.saveSettings(patch),
    onSuccess: (s) => { qc.setQueryData(["settings"], s); qc.invalidateQueries({ queryKey: ["status"] }); },
    onError: reportError,
  });
}

/** Session actions all return the new SessionState, so write it straight into the cache. */
export function useSessionAction() {
  const qc = useQueryClient();
  return async (fn: () => Promise<unknown>) => {
    try {
      const s = await fn();
      qc.setQueryData(["session"], s);
      qc.invalidateQueries({ queryKey: ["status"] });
      return s;
    } catch (e) { reportError(e); return null; }
  };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch { return false; }
  }
}
