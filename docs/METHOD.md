# Method (v1.0 beta method)

Read this before trusting a number. Sensfinder is **inspired by** the idea of reading over- and
underflicks from play. It does not reproduce Aimlabs' Sensitivity Finder; that algorithm is not public.

## The idea

The beta fitted a curve to one score per run. Score has about 5% run-to-run noise and the curve is flat, so
no number of runs finds a peak. v1.0 measures every flick instead.

During a 60 second run the app records raw mouse movement and left clicks. For each click it finds the
flick that led to it and asks one question: after the first big movement stopped, which way did the hand
have to correct?

- Came back toward where it started: the first movement went too far. **Overflick.**
- Kept going: the first movement stopped short. **Underflick.**
- Barely moved: **on target.**

A sens that is too fast produces more overflicks, one that is too slow produces more underflicks. Somewhere
between, the two balance. That balance point is what the session looks for. One run gives roughly 80 to 120
flicks, so each sens needs one run, not ten.

## Definitions

All thresholds are in `engine/config/metrics.toml`. They are starting values and are not validated. The Lab
view exists so you can see them on your own runs and change them.

- Counts become centimetres with your DPI. Deltas are summed into 1 ms windows, because Raw Input has no
  hardware timestamp and single-packet timing is not trustworthy. Speed is smoothed over 20 ms.
- A flick ends at a click. It needs at least 120 ms since the previous click. Its start is where speed
  crosses 15 cm/s after the hand was last still before the fastest burst.
- P, the end of the primary movement, is the first speed minimum below max(10% of peak speed, 3 cm/s).
  F is where the click landed.
- Signed correction `s = ((F - P) . u) / |P - start|`, with `u` the direction of the primary movement.
  `s < -0.03` is an overflick, `s > +0.03` an underflick.
- Dropped: primary travel under 1.5 cm, or still moving faster than 30% of peak speed at the click.
- Tracking shakiness (compared only within one task): direction reversals per second, share of speed power
  in 6-14 Hz, normalized jerk, and 500 ms path efficiency, combined as a mean z-score across the levels.

## The estimate

Two trends are fitted against ln(cm/360): overflick rate minus underflick rate, which should fall as
cm/360 rises, and the median signed correction, which should rise. Where they cross zero is the balance
point. The interval comes from resampling the flicks inside each sens level 400 times.

Tracking shakiness is supporting evidence only. It can pull the pick toward the calmer side, by at most
30% of the way, and only inside the flick-derived range. Screenshot scores are shown next to the result and
never enter the fit.

## What the output means

- You get a **recommended range and a best pick**, never one "perfect" number. The best published evidence
  (Nvidia, arXiv 2203.12050, 13 players, one flick task) found the optimum is a broad plateau of roughly
  20-80 cm/360 with neighbouring levels not significantly different.
- The displayed range is never narrower than +/-10% of the pick, even when the bootstrap says it could be.
- Confidence (Low / OK / Locked in) describes how tight and well-sampled the measurement was. It does not
  say the method is right.

## How well it works: simulator only

The estimator is tested against a synthetic player with a known optimum (`engine/sim/`): minimum-jerk flicks
whose first movement overshoots when the sens is too fast and undershoots when too slow, endpoint noise of
10% of flick distance, corrective submovements, 4% rushed clicks, hand tremor, 1000 Hz or 4000 Hz packets.
Each test session uses the real scheduler with randomised level order, a true optimum drawn from
25-70 cm/360, and a starting sens off by up to about 1.5x.

| Tier | Seeds | Pick within +/-15% of the true optimum | Bias | Spread (SD) | Over budget |
|---|---|---|---|---|---|
| Standard (30 at 1000 Hz + 15 at 4000 Hz + 20 at 125 Hz) | 65 | **98.5%** | +3.3% | 4.5% | 0 |
| Quick | 40 | 95% | +5.4% | 5.4% | 0 |
| Precision | 40 | 97% | +5.2% | 4.3% | 0 |

The Standard row is `test_standard_session_recovers_the_optimum_within_15_percent` (the spec's >=90% bar).
The Quick and Precision rows are from a 40-seed probe run during the build; their tests assert >=80% and
>=90% on 30 seeds.

Read these numbers for what they are:

- **They show the maths works on the model it was built around.** The simulator's over/undershoot rule is
  my assumption about how a hand behaves. It is not data from a person.
- **There is a consistent +5% bias** toward a slower sens (higher cm/360) in the simulator. I did not tune
  it away, because tuning against my own model would only hide it.
- **Nothing here has been validated on a human.** The honest expectation for a real Standard session is
  about +/-12-15% (1 SD) in cm/360, and that figure is itself an estimate from the research, not a
  measurement.

## Known weaknesses

- **Windows gives Sensfinder about 125 mouse updates a second, not 1000.** Windows 11 slows raw mouse input
  to apps in the background, and Sensfinder is always in the background while you play (measured
  2026-11-14 on the owner's PC: 988/s in front, 122-130/s behind; power-throttling opt-outs made no
  difference). Movement isn't lost, just delivered in bigger chunks every ~8 ms. In the simulator that costs
  nothing measurable (25/25 Standard sessions within ±15% at 125 Hz), but a real flick at 125 Hz is only
  a dozen or so samples, so check the Lab view on a real run.
- **Balance may not be the optimum.** People often undershoot slightly on purpose. If you do, your best sens
  sits where underflicks are a bit more common than overflicks, and this method will read slightly fast.
  `estimator.balance_target` exists for that; it is 0 until there is evidence for another value.
- **No target positions.** Direction of correction is inferred from movement shape. An overshoot corrected
  sideways reads as on-target.
- **Clicking while still moving** hides the correction; those flicks are dropped, which thins the data for
  players who click early.
- **Task dependence.** Flick distance in centimetres changes with sens, so the 1.5 cm minimum filters
  different flicks at different levels. Use the same task for the whole session.
- **Tracking tasks with few clicks** produce no flick data; they only feed the shakiness panel.
- **Fatigue and warm-up drift** are handled by randomised order, a re-test of the starting sens, and
  alternating refine order, not removed.
- **The demo analyzer** sees 64 samples a second. It reports endpoint error only and is shown as supporting
  evidence.

## Checking it on yourself

1. Do the three checks in FIRST_RUN_CHECKS.md.
2. Run one Standard session, then open a run in the Lab view and look at whether the markers sit on your
   real flicks. If they do not, move the sliders until they do and save.
3. Run a second session on another day. Two sessions that land in overlapping ranges mean more than one
   "Locked in".
