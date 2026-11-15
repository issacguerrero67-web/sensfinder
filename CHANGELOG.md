# Changelog

All notable changes to Sensfinder are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2026-11-14

### Changed
- The repository is public. Releases can be downloaded without a GitHub account or an invite.
- The old Streamlit beta and the original planning notes are no longer included in the repository.

## [1.0.2] - 2026-11-14

### Fixed
- The window couldn't be resized and didn't support Windows Snap (drag to a screen edge, Win+arrow keys,
  snap layouts). The app now uses the native Windows frame, tinted dark to match, instead of a borderless
  window with a custom title bar.
- A false "Packet rate looks low" warning. Windows 11 gives background apps about 125 mouse updates a second
  even from a 1000 Hz mouse (measured: 988/s in front, 122-130/s behind), and Sensfinder always listens from
  the background. The rate is now measured only during fast movement, a 125 Hz mouse no longer reads as 150,
  and the warning only appears below about 100/s.
- Demo Analyzer measured aim against teammates' heads too. Only enemies count now.

### Added
- Demo Analyzer: pick which player to analyze (it used to take whoever fired most), and it remembers you.
- The simulator recovery test now includes 125 Hz sessions, the rate Windows actually delivers while you play.

### Changed
- Demo Analyzer guide: use matchmaking replays. Recording offline practice with `record` was refused as a
  cheat command in testing, even with `sv_cheats 1`.

## [1.0.1] - 2026-11-14

### Fixed
- The app window froze on "Starting up." and never loaded. The title-bar bridge exposed a reference to the
  window, which made the WebView bridge recurse into it and lock the whole process. **1.0.0 does not start;
  use this version.**
- `pip install ".[dev]"` failed from a clean checkout (no package discovery in `pyproject.toml`).

### Added
- The build now opens the real window and waits for a screen to render before it will produce artifacts.

## [1.0.0] - 2026-11-14

First desktop release. Replaces the earlier Streamlit beta (not part of this repo).

### Added
- Per-flick measurement: passive Raw Input mouse capture, flick segmentation from movement shape, overflick
  and underflick rates, tracking shakiness, and a balance-point estimate with a bootstrap range.
- Three tiers with enforced time budgets: Quick (~20 min), Standard (~45 min), Precision (up to 60 min).
  One run per sens in the bracket stage, early finish when the result is locked in, hard cap at 60:00.
- Session Coach with global hotkeys, a live countdown, a confidence meter and plain-language prompts.
- Verdict with a best pick, a recommended range (never narrower than +/-10%), a confidence label, the
  diagnosis and a three-card training plan. CS2 cfg generator (`exec sensfinder_sens`).
- Demo mode: a full session against a simulated player, so the whole flow can be tried without playing.
- Lab view: replay any stored run with detected flicks drawn on, and tune the thresholds live.
- CS2 Demo Analyzer (beta) and the optional screenshot OCR panel carried over from the beta.
- Marvel Rivals support behind a Calibrate game wizard, with a standing third-party-tools warning.
- DPI wizard, first-run capture test, history and profiles, command palette, tray icon.
- "Import beta data": reads the beta's `trials.csv` into the new database without touching the original.
- Windows installer (Inno Setup), portable zip, SHA-256 file, and a tag-driven release workflow.

### Changed
- The recommendation is a range plus a best pick. The beta's single score-curve optimum is gone.
- Data moved to `%LOCALAPPDATA%\Sensfinder\data`. The beta's `data\` folder is only read.

### Removed
- The beta's cloud OCR fallback. The app makes no network calls.

### Known limitations
- The method and its thresholds are not validated on people ("v1.0 beta method"). See `docs/METHOD.md`.
- Builds are unsigned. Windows SmartScreen needs "More info" then "Run anyway".
- Not verified: the Aim Lab ToS, Valve's and NetEase's position on raw-input listeners, whether CS2
  `record` works offline and whether POV demos contain bot positions. See `docs/COMPLIANCE_TODO.md`.
