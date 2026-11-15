# First-run checks

Three things could not be verified from a desk and decide whether the real-hardware path works for you.
Do them before your first real session. They take about fifteen minutes.

## (a) Does Raw Input see your mouse while Aim Lab is focused?

1. Start Sensfinder. First run, step 4, "5-second capture test": move the mouse. You should see the trail
   and a line like "Raw Input is working. Measured about 1000 packets per second."
2. Now the part that matters. Start Aim Lab, go fullscreen, and load any task. Alt-tab is not needed.
3. Press `Ctrl+Alt+Enter` in Aim Lab to start a run from the hotkey (start a Quick session in Sensfinder
   first, and skip past the warmup). Play 20 seconds. Press `Ctrl+Alt+Enter` again.
4. Back in Sensfinder, the run should show a flick count above zero and a packet rate.

Write down:
- [ ] Packets arrived while Aim Lab had focus: yes / no
- [ ] Measured packet rate: ______ per second (compare with your Synapse polling rate)
- [ ] Hotkeys worked inside Aim Lab: yes / no

**Expect about 125/s, not your mouse's 1000 Hz.** Measured on this PC on 2026-11-14: a Raw Input listener
got 988 packets/s with its window in front but 122-130/s behind another window, with the mouse at 1000 Hz
the whole time. Windows 11 slows mouse input to apps in the background, and opting out of power throttling
(EcoQoS), raising timer resolution and high process priority did not change it. Sensfinder always listens
from the background, so ~125/s is normal. In the simulator a Standard session recovers the optimum as well at
125 Hz as at 1000 Hz (see METHOD.md). The app only warns if the rate drops below about 100/s.
If no packets arrive in fullscreen, try borderless windowed and note which one worked.

## (b) Can CS2 demos be used? Answered on 2026-11-14

- [x] **`record` in an offline match: no.** CS2 printed `SV: Cheat command 'record' ignored.`, and it still
      produced no file after `sv_cheats 1`. Offline POV recording isn't a usable source.
- [x] **Matchmaking replays: yes.** A replay from `...\Counter-Strike Global Offensive\game\csgo\replays\` read
      in about 13 s with all 10 players, 4,441 shots, and every player's position and team on every tick.

How to use one: watch a match from your CS2 match history so the replay downloads, then paste its path into
Demo Analyzer and pick your name in the Player list (Sensfinder remembers it). Only enemies count as targets.
Expect a few dozen flicks per match; on the test replay, 56 of 356 shots counted, with a median miss of 3.5°.
That includes sprays and tracking moments that happen to pass the filters, so it stays supporting evidence.

Not tried: workshop maps (for example Aim Botz) and a local GOTV server (`tv_enable 1`, `tv_record`).

## (c) Does the Lab view's segmentation look right on one of your real runs?

1. After any real flick run, open Lab and pick it.
2. Zoom into a few flicks. For each: the start marker should sit where you began the flick, P where your
   first movement stopped, and the click marker on the click.
3. Check a flick you remember overshooting. It should be coloured as an overflick.

Write down:
- [ ] Markers sit on real flicks: yes / mostly / no
- [ ] Share of clicks dropped, and the most common reason: ______

If "clicked mid-motion" dominates, raise "Drop if still moving at click". If slow flicks are missed, lower
"Flick starts above". Then "Save as default".

## Also check once

- [ ] Read the Aim Lab ToS/EULA (see COMPLIANCE_TODO.md). Research could not retrieve it.
- [ ] Unsigned build: Windows SmartScreen will say "Windows protected your PC". Click **More info**, then
      **Run anyway**. Compare the file's SHA-256 with `SHA256SUMS.txt` first:
      `Get-FileHash .\Sensfinder-<version>-setup.exe -Algorithm SHA256`

## The repo

Public at https://github.com/issacguerrero67-web/sensfinder. Anyone can download the latest release
(installer, portable zip, `SHA256SUMS.txt`) without a GitHub account.
