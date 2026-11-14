# Compliance: what you must verify yourself

Sensfinder is built to the safest design the research found: a separate process that listens to the mouse
through Windows Raw Input and nothing else. That design is an inference about what is acceptable, not a
clearance from any publisher. Nobody at Valve, NetEase or Aimlabs has approved this tool.

## Not verified by research. Check before relying on it

- [ ] **Aim Lab ToS / EULA.** The research could not retrieve the document at all. Read it yourself and look
      for clauses about third-party tools, companion software, or data collection while the game runs. If in
      doubt, ask Aimlabs support. Until you have, treat Aim Lab's position as unknown.
- [ ] **Valve / VAC and raw-input listeners.** Inferred, not official. Valve's public statements are about
      code that hooks into the game process (the AMD Anti-Lag+ case). No official text was found about an
      outside process that only reads mouse input. Sensfinder does not hook, inject, or read game memory, but
      "VAC is fine with this" is our inference.
- [ ] **NetEase / Marvel Rivals.** Inferred, and the strictest of the three. NetEase has told PC players to
      avoid third-party add-ons, overlays and plugins, and its penalties cover "unauthorized third-party
      tools". Sensfinder never touches the game or its files, but NetEase has not said that a mouse listener
      is allowed. The app shows a standing warning for Rivals. If you are worried, use a throwaway account,
      or use Sensfinder with Aim Lab only and type the converted value into Rivals afterwards.
- [ ] **Marvel Rivals yaw constant.** Not verified, so it is not hard-coded. The Calibrate game wizard
      measures your cm/360 directly.
- [ ] **CS2 cfg folder path.** `...\Counter-Strike Global Offensive\game\csgo\cfg\` comes from general
      knowledge, not a fetched source. Sensfinder never writes there; it writes `sensfinder_sens.cfg` to its
      own data folder and you copy it.

## What the app does and does not do (enforced by a test)

`engine/tests/test_capture.py::test_no_forbidden_apis_in_shipped_code` fails the build if any of these
appear in shipped code.

| Never | Instead |
|---|---|
| Read game memory, inject DLLs, hook DirectX/Vulkan/Present | Separate process, Raw Input only |
| Low-level mouse or keyboard hooks (`SetWindowsHookEx`) | `RegisterRawInputDevices` with `RIDEV_INPUTSINK` |
| Keyboard hooks for hotkeys | `RegisterHotKey` |
| Synthesize input (`SendInput`) | Nothing is ever sent to the game |
| Draw an overlay in the game, capture the game screen | A separate window; v1.0 reads only screenshot files you create |
| Capture keystrokes, window titles, screen contents | Mouse deltas and left clicks only |
| Write game files (Rivals `.ini`, Aim Lab settings) | Shows the value with a Copy button |
| Telemetry or uploads | No network calls. "Check for updates" opens the Releases page in your browser |

The only network traffic the app can make is to `127.0.0.1`: its own UI, and Ollama if you turn the
optional vision fallback on (off by default).
