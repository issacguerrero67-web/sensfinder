"""metrics.toml loader/writer. The shipped file is the default; a user copy in the data dir overrides it."""
from __future__ import annotations

import copy
import tomllib
from pathlib import Path

DEFAULT_PATH = Path(__file__).with_name("metrics.toml")


def load(user_path: Path | None = None) -> dict:
    cfg = tomllib.loads(DEFAULT_PATH.read_text(encoding="utf-8"))
    if user_path and Path(user_path).exists():
        for section, values in tomllib.loads(Path(user_path).read_text(encoding="utf-8")).items():
            cfg.setdefault(section, {}).update(values)
    return cfg


def merged(cfg: dict, overrides: dict | None) -> dict:
    """cfg with {section: {key: value}} overrides applied (Lab sliders). Unknown keys are ignored."""
    out = copy.deepcopy(cfg)
    for section, values in (overrides or {}).items():
        if section in out:
            for k, v in values.items():
                if k in out[section]:
                    out[section][k] = type(out[section][k])(v)
    return out


def dump(cfg: dict, path: Path) -> None:
    """Flat sections of numbers only, so a hand writer is enough."""
    lines = ["# Sensfinder metrics (saved from the Lab view). Starting values, not validated.", ""]
    for section, values in cfg.items():
        lines.append(f"[{section}]")
        lines += [f"{k} = {v!r}" for k, v in values.items()]
        lines.append("")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8")
