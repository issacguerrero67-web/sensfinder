// The only file that calls fetch. Everything else goes through `api`.
import { createMockEngine, MockHttpError } from "./mockEngine";
import type {
  BetaInfo, CaptureLive, CaptureTest, CfgResult, DemoResult, HeroClass, Lab, Overrides, PlanState, RunRow,
  SessionPoll, Settings, Shot, ShotList, Status, Tier, VerdictFull, VerdictRow, Game,
} from "./types";

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
export const isMock = params.get("mock") === "1" || import.meta.env.VITE_MOCK === "1";
export const mockFlags = (params.get("flags") ?? "").split(",").filter(Boolean);

const mock = isMock ? createMockEngine({ flags: mockFlags, speed: Number(params.get("speed")) || undefined }) : null;

export class ApiError extends Error {
  constructor(public status: number, public detail: string, public network = false) { super(detail); }
}

/** Set by the store: called with true when the engine can't be reached, false when it answers again. */
export const apiEvents: { onHealth: (down: boolean) => void } = { onHealth: () => {} };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    let out: T;
    if (mock) out = await mock.request(method, path, body);
    else {
      const isForm = typeof FormData !== "undefined" && body instanceof FormData;
      const res = await fetch(path, {
        method,
        headers: { "X-Sensfinder-Token": window.__SF__?.token ?? "", ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}) },
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = `The engine answered ${res.status}.`;
        try { const j = await res.json(); if (typeof j?.detail === "string") detail = j.detail; } catch { /* not JSON */ }
        if (res.status >= 502) { apiEvents.onHealth(true); throw new ApiError(res.status, detail, true); }
        apiEvents.onHealth(false);
        throw new ApiError(res.status, detail);
      }
      out = (await res.json()) as T;
    }
    apiEvents.onHealth(false);
    return out;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof MockHttpError) { apiEvents.onHealth(false); throw new ApiError(e.status, e.detail); }
    apiEvents.onHealth(true);
    throw new ApiError(0, "Analysis engine restarting...", true);
  }
}
const get = <T>(p: string) => request<T>("GET", p);
const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b);
const file = (f: File) => { const fd = new FormData(); fd.append("file", f); return fd; };

export const api = {
  status: () => get<Status>("/api/status"),
  settings: () => get<Settings>("/api/settings"),
  saveSettings: (patch: Partial<Settings>) => request<Settings>("PUT", "/api/settings", patch),
  open: (what: "data" | "screenshots" | "releases" | "cfg") => post<{ ok: true }>("/api/open", { what }),
  exportDiagnostics: () => post<{ path: string }>("/api/diagnostics/export"),

  captureLive: () => get<CaptureLive>("/api/capture/live"),
  capturePause: (paused: boolean) => post<{ paused: boolean }>("/api/capture/pause", { paused }),
  captureTestStart: (seconds = 5) => post<CaptureTest>("/api/capture/test", { seconds }),
  captureTest: () => get<CaptureTest>("/api/capture/test"),
  measureStart: () => post<{ ok: true }>("/api/measure/start"),
  measureDpi: (distance_cm = 10) => post<{ counts: number; dpi: number; suggested: number }>("/api/measure/stop", { mode: "dpi", distance_cm }),
  measureYaw: (sens: number) => post<{ counts: number; yaw: number; cm360: number }>("/api/measure/stop", { mode: "yaw", sens }),

  session: () => get<SessionPoll>("/api/session"),
  sessionStart: (tier: Tier, demo = false) => post<SessionPoll>("/api/session/start", { tier, demo }),
  runStart: () => post<SessionPoll>("/api/session/run/start"),
  runStop: () => post<SessionPoll>("/api/session/run/stop"),
  skip: () => post<SessionPoll>("/api/session/skip"),
  pause: (paused: boolean) => post<SessionPoll>("/api/session/pause", { paused }),
  end: () => post<SessionPoll>("/api/session/end"),
  closeSession: () => request<SessionPoll>("DELETE", "/api/session"),

  verdicts: (game?: Game, hero?: HeroClass | null) =>
    get<VerdictRow[]>(`/api/verdicts?game=${game ?? ""}&hero_class=${hero ?? ""}`),
  latestVerdict: () => get<VerdictFull | null>("/api/verdicts/latest"),
  verdict: (id: number) => get<VerdictFull>(`/api/verdicts/${id}`),
  saveProfile: (id: number, name: string, hero_class?: HeroClass | null) =>
    post<VerdictRow>(`/api/verdicts/${id}/save`, hero_class ? { name, hero_class } : { name }),
  deleteVerdict: (id: number) => request<{ ok: true }>("DELETE", `/api/verdicts/${id}`),
  cfg: (id: number) => post<CfgResult>(`/api/verdicts/${id}/cfg`),
  plan: () => get<PlanState | null>("/api/plan"),
  planCheck: (item_id: string, checked: boolean) => post<PlanState | null>("/api/plan/check", { item_id, checked }),

  runs: (limit = 100) => get<RunRow[]>(`/api/runs?limit=${limit}`),
  lab: (id: number, overrides?: Overrides) => post<Lab>(`/api/runs/${id}/lab`, overrides ? { overrides } : {}),
  labSaveDefault: (overrides: Overrides) => post<{ path: string }>("/api/lab/save-default", { overrides }),

  beta: () => get<BetaInfo>("/api/beta"),
  betaImport: () => post<{ imported: number; skipped: number; total: number }>("/api/beta/import"),
  screenshots: () => get<ShotList>("/api/screenshots"),
  shotUpload: (f: File) => post<Shot>("/api/screenshots/upload", file(f)),
  shotIngestLatest: () => post<Shot>("/api/screenshots/ingest-latest"),
  shotConfirm: (id: number, fields: Shot["fields"]) => post<Shot>(`/api/screenshots/${id}/confirm`, { fields }),
  shotDelete: (id: number) => request<{ ok: true }>("DELETE", `/api/screenshots/${id}`),
  demos: () => get<DemoResult[]>("/api/demos"),
  demoAnalyze: (path: string) => post<DemoResult>("/api/demos/analyze", { path }),
  demoUpload: (f: File) => post<DemoResult>("/api/demos/analyze", file(f)),
};
