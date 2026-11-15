# Decisions

Non-obvious choices made while building v1.0, newest area last. The spec (`kit/SPEC.md`) is the source of
truth; these are the places where it left a choice open or two instructions pulled in different directions.

## Data and safety

1. **v1 data lives in `%LOCALAPPDATA%\Sensfinder\data`, not in the repo's `data\` folder.** The spec puts run
   traces in `data/runs/*.npz`, but the build instruction was "do not delete or modify the existing `data\`
   folder". Writing new files into it would modify it, and an installed app cannot write next to its exe
   anyway. So the beta's `data\` is strictly read-only to v1 and everything new (SQLite db, `runs\*.npz`,
   logs, cfg, diagnostics) goes to the per-user folder. Override with `SENSFINDER_DATA_DIR`. "Open data
   folder" opens it. A test checks the beta folder's file list, hash and mtime are unchanged after import.
2. **Beta import copies rows, not images.** Every line of `data/trials.csv` (adds, edits, deletes) is stored
   in `beta_trials` keyed by its line number, with the full original row as JSON, source `beta`. Re-running
   only adds lines appended since. The 81 screenshot PNGs stay where they are; their hashes are in the rows.
3. **Screenshots are not stored.** The optional OCR panel keeps the parsed numbers and a pixel hash only.
4. **A test enforces the safety list.** `test_no_forbidden_apis_in_shipped_code` greps shipped code for
   hook/injection/input-synthesis/screen-capture/window-title APIs and game settings file names.
5. **Fullscreen detection uses `SHQueryUserNotificationState`.** It answers "is a fullscreen app in front"
   without reading window titles or the process list. Used only to keep the optional Ollama fallback off
   the GPU while a game is up.
6. **The CS2 cfg is written to our own `cfg\` folder.** The user copies it into the game. The app never
   writes into a game directory, including for CS2.
7. **The beta's cloud OCR fallback was removed** in the port. v1.0 makes no network calls; the only fallback
   is local Ollama, off by default, `keep_alive: 0`.

## Method

8. **Flick start = last rest before the peak, then the 15 cm/s crossing.** The spec says a flick "starts when
   speed exceeds ~15 cm/s". Taken literally, any twitch after the previous click would start the flick.
   The segmenter finds the fastest burst before the click, walks back to where the hand was last below the
   rest speed, and starts at the 15 cm/s crossing after that.
9. **Travel is measured on the primary movement** (`|P - start|`), which is also the denominator of `s`.
10. **Monotone model = two weighted lines in ln(cm/360).** `atanh(overflick rate - underflick rate)` must
    fall and median signed correction must rise as cm/360 rises; a fit with the wrong sign or a slope near
    zero is rejected. The balance point is the weighted mean of the two zero crossings (0.6 / 0.4). With
    five levels, isotonic regression only uses the two levels around the crossing and was noisier.
11. **"No trend" is a real outcome.** If fewer than half of the bootstrap fits are valid, the verdict says
    there is no clear balance point, keeps the current sens as the pick, shows the whole tested range, and
    is marked Low.
12. **Range = bootstrap 5th-95th percentile, floored at +/-10%.** The floor is applied to what is displayed
    and to what is stored. Extrapolation is capped at 25% beyond the tested levels.
13. **Confidence labels.** Locked in: interval half-width <= 12%, at least 3 levels with 60+ flicks, balance
    inside the tested range, 90%+ valid bootstrap fits. OK: half-width <= 25%. Otherwise Low.
14. **Tracking shakiness can only nudge.** It moves the pick toward the calmer side by 30% of the distance,
    and only inside the flick-derived 16th-84th percentile interval.
15. **Normalized jerk is differentiated at 100 Hz.** At the full 1 kHz grid the second difference of
    velocity is count-quantisation noise and went the wrong way in a hand-built test.
16. **Fatigue needs both signals.** Speed down 3% per 10 min *and* error up 3% per 10 min, fitted with
    ln(cm/360) as a covariate so slow sens levels are not mistaken for tiredness. Later runs are then
    down-weighted, to a floor of 0.5.
17. **Stage 3 "no worse" = within 5%** on mean |signed correction| and on corrections per flick.
18. **The final pick uses all scored runs**, including the confirm runs. The confirm comparison can only
    widen the range back toward the current sens, never move the pick.
19. **`balance_target = 0`.** People may habitually undershoot a little even at their best sens. If so the
    true optimum sits at a slightly positive underflick balance. That is unknown, so it is a config value,
    not a guess baked into code. See METHOD.md.

## Session and tiers

20. **Plans are a wish list trimmed to fit.** The scheduler builds the full plan and drops blocks until it
    fits: extra reps, then tracking, then refine neighbors, then (last resort) the tail of the plan. It
    re-fits after every block using the sens-change time it has actually measured, so dropped blocks come
    back if you are quick.
21. **Standard at the default 60 s sens-change time runs two confirm pairs, not three.** The full Standard
    plan is 48 min at that overhead; the third pair is the first "extra rep" to go. Change sens faster and
    it comes back.
22. **Quick has no separate confirm of the pick.** Its single refine run at the balance point stands in for
    the pick, followed by one run at the current sens. Its drift re-test and rest are optional blocks.
23. **Precision = Standard plus a second half refine cycle and a final drift check.** A full second cycle
    did not fit in 60:00 with the drift check.
24. **Early finish needs three refine runs** (one in Quick) and "Locked in".
25. **"One more at this sens" only happens in Stage 2**, once per sens, when a run gave fewer than 25 usable
    flicks. Stage 1 never repeats a sens (the x1.0 drift re-test is the spec's one exception).
26. **Pause stops the session clock.** A paused session does not burn budget. Pausing during a run pauses
    capture and marks that run partial.
27. **Sessions are not resumed after an engine restart.** Finished runs are already on disk and in the db;
    the open session is lost. Resume is a v1.1 item.
28. **Demo mode runs 20x faster than real time** against a simulated player whose optimum is drawn within
    -25%/+30% of the current sens. It uses the same scheduler, estimator and storage as a real session and
    is labelled as simulated everywhere, including in History.

## App and packaging

29. **pywebview shell, per the spec.** The UI talks only to `http://127.0.0.1:<port>` with a per-launch
    token injected into `index.html`, so a Tauri shell can replace `shell/main.py` in v1.1 with no UI change.
30. **One process.** The shell imports the engine and runs uvicorn on a thread. A separate sidecar process
    is what caused the Tauri reinstall bug in the research; there is nothing to leave behind here.
31. **Per-user install** (`%LOCALAPPDATA%\Programs\Sensfinder`, no admin prompt). User data is left alone
    on uninstall.
32. **Lab "Save as default" writes `metrics.toml` in the data folder**, which overrides the shipped file. The
    shipped one is read-only once installed.
33. **Score on the verdict chart** comes from screenshots saved during that session at each sens. It is a
    side series only and never enters the fit.
34. **App icon is drawn in code** (`shell.main.make_icon`). Good enough
    for v1.0 and no licence question.
35. **The UI was built against `docs/API.md`** with a browser-side mock engine, in parallel with
    the engine. UI-specific decisions are in `ui/DECISIONS-UI.md`.

## Repo

37. **The repo step waited for the right GitHub login.** `gh` was signed in as a different account, so the
    step was stopped and documented as the spec says. Once `issacguerrero67-web` was signed in, the private
    repo was created, `main` and `v1.0.0` pushed, and the release published by hand from the local build.
    The release workflow now leaves an existing release alone, so a hand-published tag and CI don't collide.
38. **Beta OCR fixtures are not committed.** They are your Aim Lab results screenshots; `.gitignore` excludes
    them and the OCR test skips when they are absent.
