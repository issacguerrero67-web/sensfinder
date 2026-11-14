# PyInstaller spec: --onedir build of the shell + engine + built UI.
# Run from the repo root:  pyinstaller packaging/sensfinder.spec --noconfirm
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = Path(SPECPATH).parent

datas = [(str(ROOT / "ui" / "dist"), "ui"),
         (str(ROOT / "engine" / "config" / "metrics.toml"), "engine/config")]
binaries = []
hidden = collect_submodules("uvicorn") + ["engine.capture.rawinput", "engine.ocr.ingest", "engine.demos.analyzer"]
for pkg in ("rapidocr_onnxruntime", "webview", "demoparser2", "pystray"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hidden += h

a = Analysis(
    [str(ROOT / "shell" / "main.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden,
    excludes=["streamlit", "sklearn", "matplotlib", "tkinter", "pytest", "hypothesis", "IPython", "notebook",
              "PyInstaller", "altair", "pydeck"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Sensfinder", console=False,
          icon=str(ROOT / "packaging" / "icon.ico"))
coll = COLLECT(exe, a.binaries, a.datas, name="Sensfinder")
