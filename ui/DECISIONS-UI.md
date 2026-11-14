# UI decisions (Sensfinder v1.0)

Non-obvious choices made while building `ui/`. SPEC.md wins over the research file; docs/API.md is the contract.

## Stack and structure
- Pinned exactly (npm registry, 2026-11-14): react 19.3.1, react-dom 19.3.1, vite 8.3.8, typescript 7.0.2, tailwindcss 4.3.5,
  @tailwindcss/vite 4.3.5, @vitejs/plugin-react 6.3.0, radix-ui 1.8.1, lucide-react 1.73.0, motion 14.14.0, zustand 5.1.0,
  @tanstack/react-query 5.107.1, recharts 3.10.1, uplot 1.6.32, clsx 2.1.1, @fontsource-variable/inter 5.3.0,
  @fontsource-variable/jetbrains-mono 5.3.0, vitest 5.1.0, jsdom 31.0.1, @testing-library/react 16.3.3,
  @testing-library/jest-dom 7.0.1, @playwright/test 1.65.1, @axe-core/playwright 4.14.0.
- shadcn/ui: components are copy-in, hand-written in the shadcn style on Radix primitives (`src/components/ui.tsx`) instead of
  running the shadcn CLI. Same pattern, far fewer files, no generator config to maintain.
- `motion` is installed (it is in the decided stack) but nothing imports it yet: every animation here is a CSS
  transition/keyframe driven by the token durations, plus one rAF count-up. Remove the dependency or use it in v1.1.
- Router: a tiny hash router inside the zustand store (`#/home`, `#/verdict/12`). No router dependency.
- Command palette: Radix Dialog + a filtered list (no `cmdk`).
- Fonts are bundled by @fontsource; the build makes no network calls. `index.html` has `<!--SF_BOOT-->` in `<head>` before any script.

## Tokens and accessibility
- `faint #6B7380` is 4.1:1 on the canvas, below 4.5:1, so it is used for icons, rules and placeholders only. All label text uses `muted`.
- The accent as a button fill does not give white text 4.5:1 (#7C5CFF is 4.35:1). Two derived shades are computed from
  `settings.accent` and set as CSS variables: `--accent-strong` (14% darker, button fill) and `--accent-soft` (32% lighter,
  accent-colored text). `--accent` itself is used for focus rings, borders, chart lines.
- Status is never color-only: banners, chips, the confidence meter and Lab flick labels all carry an icon or words.
- Reduce motion: `prefers-reduced-motion` and `settings.reduce_motion` (class on `<html>`) both zero out transitions; the ring and
  count-ups become instant.

## Behaviour
- Session Coach set-sens step is ONE screen: title "Set 1.40 in-game", the copy chip, the line "Set 1.40 in-game, then hit
  start." and the primary button "Start run". A separate "I've set it" click was dropped: it added a click per sens and the
  spec's own microcopy describes a single step. When the sens does not change the title is "Stay at 1.40".
- Rest blocks start by themselves (the UI calls `run/start` once per rest block) so the user is not asked to press "start rest".
  "Skip rest" and "Skip warm-up" call `run/stop`.
- "Got it, +1 data point" shows for 2 s after a flick/tracking block ends (detected from `running` going false / block id
  changing), with a WebAudio two-note chime. Warm-up and rest ends chime only.
- Hotkeys are registered by the engine (RegisterHotKey). The UI only displays and rebinds them (PUT /api/settings); it never
  listens for global keys itself. `Ctrl+K` is the only in-window shortcut.
- Verdict source: `#/verdict/<id>` -> GET /api/verdicts/{id}; otherwise a finished open session's `verdict`; otherwise
  /api/verdicts/latest. The session is closed (DELETE /api/session) by the "Done" button or when the next session starts.
- "End session" asks for confirmation (it cannot be undone).
- DPI mismatch: the detected DPI comes from POST /api/measure/stop `{mode:"dpi"}`. The UI compares `suggested` to
  `settings.dpi` (more than 8% apart) and shows an inline warning plus a global banner with "Use 1600" / "Keep 800".
  The detected value lives in UI memory only.
- Engine down: any network failure or 502+ from `api.ts` flips a banner ("Analysis engine restarting..."); the 2 s status poll
  clears it on the first good answer.
- The word "perfect" is not shown anywhere. The research line "Shoot for steady, not perfect." was dropped for that reason.
- Demo mode drives the same buttons; nothing auto-advances except rest.
- The Home "Last result" is the latest verdict for any game (the API's /latest has no game filter).
- `LevelRow.score` (optional): drawn as a third, dashed series on the Verdict chart only when at least one level has a
  non-null score; missing is treated as null. Same rule adds a Score column to the "Why this?" table.

## Charts
- Recharts: verdict curve, compare overlay, coach sparkline. x axis is cm/360 on a log scale (levels are geometric).
  Direct end-of-line labels are nudged apart in code so they never overlap. Shakiness and score use hidden y axes
  (their units differ); the tooltip shows the real values.
- uPlot: first-run trail, coach live speed trace, Lab trace. The trail is not monotonic in x, so it is drawn by hand in a
  uPlot `draw` hook; Lab flick markers (band, P line, click dot, dropped ✕) are drawn the same way.

## Mock engine (`src/lib/mockEngine.ts`)
- On with `?mock=1` or `VITE_MOCK=1`. Extra URL params: `flags=` (comma list: ready, empty, rivals, beta, notrend,
  engine-down, capture-paused, low-rate, dpi-mismatch) and `speed=` (session seconds per real second, default 30, so a 60 s
  run lasts 2 s). State is in memory and resets on reload.
- `engine-down` answers for 1.5 s, then every request fails, so the banner can be seen over a loaded app.
- In the mock, `elapsed_s` only advances during blocks plus the sens-change overhead, so demo time stays inside the budget
  no matter how long a screen is left open. The real engine uses the real clock.

## Assumptions about docs/API.md (please confirm)
- POST /api/verdicts/{id}/save without `hero_class` for CS2 (field omitted, not null).
- `SessionState.block` is `null` only when `finished`. A finished session keeps answering GET /api/session until DELETE.
- `retest_on` is a date (`YYYY-MM-DD`) or full ISO timestamp; the UI appends `T00:00:00` to it. TODO(engine): if it is a
  full timestamp, tell me and I will drop the suffix.
- `status.toasts` may still contain old toasts after a UI reload; the UI shows every id it has not seen in this window once.
- Demo upload by multipart is implemented in `api.ts` (`demoUpload`) but the screen only uses the path form, because a
  browser file picker cannot give the engine a path and .dem files are large.

## TODO for the engine side
- There is no endpoint for the watcher's fullscreen-game detection state, so the Screenshots screen only exposes the
  `ollama.allow_while_gaming` toggle.
- There is no endpoint that lists hotkey registration errors beyond `status.hotkeys[].ok`; the UI shows a generic
  "Couldn't register" line.
- The CS2 cfg dialog shows a generic target folder (`...\Counter-Strike Global Offensive\game\csgo\cfg\`); the API does not
  return the user's actual install path.

## Self-review passes (screenshots in docs/screens/)
Pass 1 (looked at 48 of 58 PNGs, fixed):
- Removed "Shoot for steady, not perfect." from the running screen (the word "perfect" must never appear).
- Mock history was oldest-first, so Home's "Last result" showed the oldest session; now newest first.
- Home empty state was a tall centered block that pushed the beta-import prompt below the fold; now a compact row.
- First-run capture test said "Capture works." twice (title and body).
- Verdict chart: "best zone" label sat on top of the pick line (moved to the band's top-left); end labels "balance" /
  "shakiness" overlapped (now nudged apart); score dots inherited the dash pattern; with no trend the band is labelled
  "range (no clear best zone)" instead of "best zone".
- Compare overlay: the two pick labels crossed each other and the two end labels overlapped.
- "Why this?" table showed "+0" for a zero balance.
- Settings: inputs ignored their width and the page ignored its narrower max width (Tailwind class order); fixed in
  `Input` and `Page`.
- Segmented control upper-cased every word ("6 S", "Whole Run"); now first letter only.
- Page header chips were bottom-aligned against wrapped subtitles; now top-aligned.
- Plan card "Should move:" wrapped awkwardly in the third card; label and metric are stacked.
- Command palette input drew a heavy focus box inside the dialog.
- Native checkboxes/selects rendered light; `color-scheme: dark` added.
- Calibrate dialog label wrapped onto two lines.
- Empty states sat at the top of the pane; now vertically centred.

Pass 2 (looked at the changed screens plus the 10 not seen in pass 1, fixed):
- Coach copy chip said 31.1 cm/360 while the ring said 31.2 (chip recomputed from the rounded sens); the chip now uses the
  engine's `block.cm360`.
- Mock "leaning toward" sens (1.20) disagreed with the verdict (1.21); same rounding now.
- Lab packet chip read "987 /s packets".
- Compare screenshot picked two sessions with identical picks; the script now picks the newest and the oldest.

Known rough edges left as they are:
- During "Got it" the ring already shows the next sens while the centre still talks about the run that just ended.
- A finished-session toast can sit over the bottom-right corner of the Verdict screen for a few seconds.
- The JS bundle is one 888 kB chunk (272 kB gzip). It is served from localhost, so it was not split.
