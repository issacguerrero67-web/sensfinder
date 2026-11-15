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

If the rate is far below your polling rate, the app shows a warning. Analysis still works at 500-1000 Hz.
If no packets arrive in fullscreen, try borderless windowed and note which one worked.

## (b) Does CS2 `record` work in your offline practice, and do the demos contain bot positions?

1. In CS2: Settings > Game > Enable Developer Console.
2. Load your workshop map or an offline bot match. Open the console and type `record sftest`.
3. Shoot bots for a minute. Type `stop`.
4. The file should be `...\steamapps\common\Counter-Strike Global Offensive\game\csgo\sftest.dem`.
5. In Sensfinder open Demo Analyzer, paste that path, Analyze.

Write down:
- [ ] `record` produced a file in offline/workshop play: yes / no
- [ ] The analyzer found other players or bots in it: yes / no (if no, it says so plainly)

If the POV demo has no bot positions, record a GOTV demo on a local server instead: `tv_enable 1`, restart
the map, `tv_record sftest`, play, `tv_stoprecord`. That guide is from CS:GO and is unverified for CS2.
Also unverified: the `demoparser2` column names for your demo type. A wrong guess shows as "no usable data",
never a crash. If that happens, send the diagnostics zip.

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
      `Get-FileHash .\Sensfinder-1.0.0-setup.exe -Algorithm SHA256`

## The repo

Done on 2026-11-14: the private repo is https://github.com/issacguerrero67-web/sensfinder and `v1.0.0` is
released there with the portable zip, the installer and `SHA256SUMS.txt`.

`gh` on this PC holds two accounts. Anything for this repo must run as the personal one:

```powershell
gh api user --jq .login                          # must print issacguerrero67-web
gh auth switch --user issacguerrero67-web        # if it doesn't
```

Inviting a tester (private repo, so they need to be a collaborator and signed in to download):

```powershell
gh api -X PUT repos/issacguerrero67-web/sensfinder/collaborators/<their-username>
```
