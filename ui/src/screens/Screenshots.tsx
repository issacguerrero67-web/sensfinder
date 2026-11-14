import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy as Dup, FolderOpen, Trash2, XCircle } from "lucide-react";
import { Page } from "../components/shell";
import { Button, Chip, IconButton, Input, PageHeader, Section, Switch } from "../components/ui";
import { DropZone, HotkeyBadge } from "../components/widgets";
import { api } from "../lib/api";
import { reportError, useApp, useSaveSettings, useSettings } from "../lib/store";
import { fmtDate } from "../lib/units";
import type { Shot } from "../lib/types";

const FIELDS: { key: keyof Shot["fields"]; label: string; width: string; text?: boolean }[] = [
  { key: "task", label: "Task", width: "flex-1 min-w-[180px]", text: true },
  { key: "score", label: "Score", width: "w-28" },
  { key: "accuracy", label: "Accuracy", width: "w-24" },
  { key: "hits", label: "Hits", width: "w-20" },
  { key: "shots", label: "Shots", width: "w-20" },
  { key: "sens", label: "Sens", width: "w-20" },
];

function ShotRow({ shot, onChanged, onRetry }: { shot: Shot; onChanged: () => void; onRetry: () => void }) {
  const [typing, setTyping] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, shot.fields[f.key] == null ? "" : String(shot.fields[f.key])])));
  const editable = shot.status === "pending" || typing;
  const confirm = async () => {
    const fields = Object.fromEntries(FIELDS.map((f) => [f.key, draft[f.key] === "" ? null : f.text ? draft[f.key] : Number(draft[f.key])])) as Shot["fields"];
    try { await api.shotConfirm(shot.id, fields); setTyping(false); onChanged(); } catch (e) { reportError(e); }
  };
  const remove = async () => { try { await api.shotDelete(shot.id); onChanged(); } catch (e) { reportError(e); } };
  const f = shot.fields;
  return (
    <li className="py-4 first:pt-0">
      <div className="flex items-center gap-3">
        {shot.status === "saved" && <CheckCircle2 size={16} className="shrink-0 text-good" aria-hidden />}
        {shot.status === "pending" && <AlertTriangle size={16} className="shrink-0 text-warn" aria-hidden />}
        {shot.status === "rejected" && <XCircle size={16} className="shrink-0 text-danger" aria-hidden />}
        {shot.status === "duplicate" && <Dup size={16} className="shrink-0 text-muted" aria-hidden />}
        <div className="min-w-0 flex-1 text-base">
          {shot.status === "saved" && <span className="text-text">{f.task ?? "Unknown task"} <span className="num text-muted">· score {f.score?.toLocaleString("en-US") ?? "–"} · {f.accuracy == null ? "–" : `${Math.round(f.accuracy * 100)}%`} · sens {f.sens ?? "–"}</span></span>}
          {shot.status === "pending" && <span className="text-text">Not sure about this one. Check the numbers, then save. <span className="text-muted">{shot.warnings.join(" ")}</span></span>}
          {shot.status === "rejected" && <span className="text-text">Couldn't read that. Make sure the results screen is fully visible.</span>}
          {shot.status === "duplicate" && <span className="text-muted">Already saved, so this copy was skipped.</span>}
        </div>
        <span className="shrink-0 text-sm text-muted">{fmtDate(shot.created_at)}</span>
        {shot.status === "rejected" && !typing && <>
          <Button size="sm" onClick={onRetry}>Try again</Button>
          <Button size="sm" onClick={() => setTyping(true)}>Type it in</Button>
        </>}
        <IconButton label="Remove this screenshot" onClick={remove}><Trash2 size={15} aria-hidden /></IconButton>
      </div>
      {editable && (
        <div className="mt-3 flex flex-wrap items-end gap-3 pl-7">
          {FIELDS.map((fd) => (
            <label key={fd.key} className={`flex flex-col gap-1.5 ${fd.width}`}>
              <span className="text-xs text-muted">{fd.label}</span>
              <Input mono={!fd.text} className="h-9 text-sm" inputMode={fd.text ? "text" : "decimal"} value={draft[fd.key]} onChange={(e) => setDraft({ ...draft, [fd.key]: e.target.value })} />
            </label>
          ))}
          <Button variant="primary" className="h-9" onClick={confirm}>Save</Button>
        </div>
      )}
    </li>
  );
}

export default function Screenshots() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const toast = useApp((s) => s.toast);
  const shots = useQuery({ queryKey: ["shots"], queryFn: api.screenshots, refetchInterval: 4000 });
  const [busy, setBusy] = React.useState(false);
  const retryInput = React.useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["shots"] });
  const upload = React.useCallback(async (file: File) => {
    setBusy(true);
    try {
      const s = await api.shotUpload(file);
      if (s.status === "saved") toast("good", "Screenshot saved.");
      qc.invalidateQueries({ queryKey: ["shots"] });
    } catch (e) { reportError(e); } finally { setBusy(false); }
  }, [qc, toast]);
  const ingest = async () => { try { await api.shotIngestLatest(); refresh(); } catch (e) { reportError(e); } };
  if (!settings) return null;
  const items = shots.data?.items ?? [];

  return (
    <Page>
      <PageHeader title="Screenshots" right={<Chip>optional</Chip>}
        sub="Add Aim Lab results screens if you want score and accuracy next to your result. They're a side panel only and never change the main fit." />

      <DropZone onFile={upload} accept="image/*" paste busy={busy} title="Drop a results screenshot here" hint="Or paste one with Ctrl+V. PNG or JPG of the full results screen." />
      <div className="mt-4 flex items-center gap-3 text-sm text-muted">
        <Button size="sm" onClick={ingest}>Read the newest file in the folder</Button>
        <span className="flex items-center gap-2">or press <HotkeyBadge combo={settings.hotkeys.shot} /> in-game</span>
      </div>
      <input ref={retryInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />

      <Section title="Parsed results" className="mt-8">
        {shots.data?.error && <p className="mb-3 flex items-center gap-2 text-sm text-warn" role="alert"><AlertTriangle size={15} aria-hidden /><span className="text-text">{shots.data.error}</span></p>}
        {items.length === 0 ? <p className="text-base text-muted">Nothing here yet. Drop a screenshot above and the parsed numbers show up in this list.</p>
          : <ul className="divide-y divide-line">{items.map((s) => <ShotRow key={`${s.id}-${s.status}`} shot={s} onChanged={refresh} onRetry={() => retryInput.current?.click()} />)}</ul>}
      </Section>

      <Section title="Folder watcher">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-base text-text">Pick up new screenshots by themselves</div>
            <p className="selectable num mt-1 truncate text-sm text-muted" title={settings.screenshots_dir}>{settings.screenshots_dir}</p>
          </div>
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} aria-hidden />} onClick={() => api.open("screenshots").catch(reportError)}>Open folder</Button>
          <Switch label="Watch the screenshots folder" checked={settings.watch_screenshots} onChange={(v) => save.mutate({ watch_screenshots: v }, { onSuccess: refresh })} />
        </div>
        <p className="mt-3 text-sm text-muted">Sensfinder only reads image files you create yourself (Win+PrintScreen, drag and drop, paste). It never captures the screen.</p>
      </Section>

      <Section title="Ollama fallback">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-base text-text">Use a local vision model when the normal reader gives up</div>
            <p className="mt-1 text-sm text-muted">Off by default. Runs only when you opt in, on your own PC, and unloads straight after.</p>
          </div>
          <Switch label="Ollama fallback" checked={settings.ollama.enabled} onChange={(v) => save.mutate({ ollama: { ...settings.ollama, enabled: v } })} />
        </div>
        {settings.ollama.enabled && (
          <div className="mt-4 flex items-end gap-6 border-t border-line pt-4">
            <label className="flex w-56 flex-col gap-2"><span className="label">Model</span>
              <Input mono className="text-sm" defaultValue={settings.ollama.model} placeholder="qwen3-vl:8b" onBlur={(e) => e.target.value !== settings.ollama.model && save.mutate({ ollama: { ...settings.ollama, model: e.target.value } })} /></label>
            <div className="flex flex-1 items-center gap-4 pb-2">
              <span className="flex-1 text-sm text-muted">Allow it while a fullscreen game is running (it will fight the game for the GPU)</span>
              <Switch label="Allow Ollama while gaming" checked={settings.ollama.allow_while_gaming} onChange={(v) => save.mutate({ ollama: { ...settings.ollama, allow_while_gaming: v } })} />
            </div>
          </div>
        )}
      </Section>
    </Page>
  );
}
