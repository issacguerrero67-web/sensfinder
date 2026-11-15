# Testing Sensfinder

Thanks for trying it. It's an early version, so feedback on real sessions is the most useful thing you can send.

## Sending feedback

1. In the app, open **Settings > Export diagnostics**. It writes a zip with the logs and your settings.
   Your Windows user name and home path are scrubbed. It contains no mouse traces and no screenshots.
2. Open an issue with the **Bug report** form and drag the zip into the last field.
3. Say what you were doing, what you expected, and what happened. A sentence each is fine.

If a recommendation looked wrong, open the **Lab** tab, pick one of the runs from that session, and tell us
whether the flick markers sit where your flicks actually were. That is the single most useful thing a tester
can report, because the thresholds in v1.0 are starting values.

## What not to send

- Screenshots or clips that show account names you would not want in an issue.
- Anything from a game's install folder.

## Building from source

```powershell
py -3.12 -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
cd ui; npm ci; npm run build; cd ..
.venv\Scripts\python -m pytest
.venv\Scripts\python shell\main.py
powershell -File packaging\build.ps1     # exe, portable zip, installer, SHA-256
```

Commits are small and conventional (`feat:`, `fix:`, `docs:`, `chore:`). `main` stays releasable; releases
are tags of the form `vMAJOR.MINOR.PATCH` that match the version in `pyproject.toml`.
