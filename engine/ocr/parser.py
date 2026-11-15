"""Aimlabs results screenshot -> ParsedRun. Ported from the earlier beta.

Layout-robust: locate label text boxes, take the value box directly above (stats row)
or below (SCORE). No fixed pixel coordinates. RapidOCR on CPU; nothing leaves the machine.
The beta's cloud fallback is gone: the only fallback in v1.0 is the optional local Ollama model
(see ingest.py), off by default.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

CRITICAL = ("task", "score", "accuracy", "hits", "shots", "sens")
MIN_CONF = 0.85
FIELDS = ("task", "score", "accuracy", "hits", "shots", "sens", "targets_killed", "total_targets", "total_shots")

_engine = None


@dataclass
class Box:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    conf: float

    @property
    def h(self):
        return self.y1 - self.y0

    @property
    def key(self):
        return re.sub(r"[^a-z0-9/]", "", self.text.lower())


@dataclass
class ParsedRun:
    task: str | None = None
    score: int | None = None
    accuracy: float | None = None
    hits: int | None = None
    shots: int | None = None
    sens: float | None = None
    targets_killed: int | None = None
    total_targets: int | None = None
    total_shots: int | None = None
    confidence: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)
    source: str = "ocr"
    notes: list = field(default_factory=list)          # informational, saved in the run's `note` column
    score_box: "Box | None" = field(default=None, repr=False)  # where the SCORE value was read

    @property
    def needs_review(self) -> bool:
        if any(getattr(self, f) is None for f in CRITICAL):
            return True
        if any(self.confidence.get(f, 0) < MIN_CONF for f in CRITICAL):
            return True
        return bool(self.warnings)

    def fields(self) -> dict:
        return {f: getattr(self, f) for f in
                ("task", "score", "accuracy", "hits", "shots", "sens",
                 "targets_killed", "total_targets", "total_shots")}


def task_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _ocr(img: Image.Image) -> list[Box]:
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR()
    arr = np.array(img.convert("RGB"))[:, :, ::-1]  # BGR like cv2
    res, _ = _engine(arr)
    out = []
    for pts, text, conf in res or []:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        out.append(Box(min(xs), min(ys), max(xs), max(ys), str(text).strip(), float(conf)))
    return out


def _x_aligned(a: Box, b: Box) -> bool:
    overlap = min(a.x1, b.x1) - max(a.x0, b.x0)
    return overlap > 0 or abs(a.x0 - b.x0) < 2 * b.h


def _value_near(label: Box, boxes: list[Box], pattern: str, above: bool) -> Box | None:
    best, best_gap = None, None
    for b in boxes:
        if b is label or not re.fullmatch(pattern, b.text.replace(" ", "").replace(",", "")):
            continue
        if not _x_aligned(b, label):
            continue
        gap = (label.y0 - b.y1) if above else (b.y0 - label.y1)
        if -0.5 * label.h <= gap <= (1.5 if above else 3) * label.h:
            if best is None or gap < best_gap:
                best, best_gap = b, gap
    return best


STAT_LABELS = {  # field -> (label key predicate, value regex)
    "sens": (lambda k: k == "sensitivity", r"\d+(\.\d+)?"),
    "accuracy": (lambda k: k == "accuracy", r"\d{1,3}(\.\d+)?%"),
    "hits_shots": (lambda k: "hits" in k and "shots" in k, r"\d+/\d+"),
    "targets_killed": (lambda k: k == "targetskilled", r"\d+"),
    "total_targets": (lambda k: k == "totaltargets", r"\d+"),
    "total_shots": (lambda k: k == "totalshots", r"\d+"),
}


def _parse_boxes(boxes: list[Box], known_tasks: list[str]) -> ParsedRun | None:
    run = ParsedRun()
    found_labels = 0
    for name, (is_label, pat) in STAT_LABELS.items():
        labels = [b for b in boxes if is_label(b.key)]
        found_labels += bool(labels)
        for lab in labels:
            v = _value_near(lab, boxes, pat, above=True)
            if not v:
                continue
            t = v.text.replace(" ", "").replace(",", "")
            conf = min(v.conf, lab.conf)
            if name == "hits_shots":
                h, s = t.split("/")
                run.hits, run.shots = int(h), int(s)
                run.confidence["hits"] = run.confidence["shots"] = conf
            elif name == "accuracy":
                run.accuracy, run.confidence["accuracy"] = float(t.rstrip("%")), conf
            elif name == "sens":
                run.sens, run.confidence["sens"] = float(t), conf
            else:
                setattr(run, name, int(t))
                run.confidence[name] = conf
            break
    # "Looks like Aimlabs results" = most of the stats-row labels are present.
    if found_labels < 4:
        return None

    # "SCORE" header (an icon glyph may be glued on, e.g. "WSCORE"); value is the big number below it.
    score_labels = [b for b in boxes if re.search(r"SCORE$", b.text.strip()) and len(b.key) <= 7]
    for lab in score_labels + [b for b in boxes if b.key == "score"]:
        v = _value_near(lab, boxes, r"\d{1,7}", above=False)
        if v:
            run.score, run.confidence["score"] = int(v.text.replace(",", "").replace(" ", "")), min(v.conf, lab.conf)
            run.score_box = v
            break
    if run.score is None:  # e.g. ".279": the leading digit was lost and the rest didn't parse
        for lab in score_labels + [b for b in boxes if b.key == "score"]:
            v = _value_near(lab, boxes, r"[.,]\d{1,7}", above=False)
            if v:
                run.score_box = v
                run.confidence["score"] = 0.0
                break

    run.task, run.confidence["task"] = _find_task(boxes, known_tasks)
    _check(run)
    return run


def _find_task(boxes: list[Box], known_tasks: list[str]) -> tuple[str | None, float]:
    cands = []
    for ex in (b for b in boxes if b.key == "exit"):  # title sits right of the Exit button
        cands += [b for b in boxes if b.x0 > ex.x1 and b.x0 - ex.x1 < 8 * ex.h
                  and b.y1 > ex.y0 - ex.h and b.y0 < ex.y1 and b.key not in ("aimlabs", "")]
    for al in (b for b in boxes if b.key == "aimlabs"):  # title sits above the "Aimlabs" author line
        cands += [b for b in boxes if b is not al and 0 <= al.y0 - b.y1 < 1.5 * al.h and _x_aligned(b, al)
                  and not b.key.isdigit()]
    if not cands:
        return None, 0.0
    known = {task_key(t): t for t in known_tasks}
    for c in cands:
        if task_key(c.text) in known:
            return known[task_key(c.text)], c.conf
    best = max(cands, key=lambda b: (b.text.count(" "), b.conf))
    return best.text, 0.5  # unknown task: force a one-time confirm


def _check(run: ParsedRun) -> None:
    w = run.warnings
    if run.hits is not None and run.shots:
        if run.hits > run.shots:
            w.append(f"hits {run.hits} > shots {run.shots}")
        if run.accuracy is not None and abs(100 * run.hits / run.shots - run.accuracy) > 0.06:
            w.append(f"accuracy {run.accuracy}% != hits/shots {100 * run.hits / run.shots:.2f}%")
    if run.accuracy is not None and not 0 <= run.accuracy <= 100:
        w.append(f"accuracy {run.accuracy} out of range")
    if run.total_shots is not None and run.shots is not None and run.total_shots != run.shots:
        w.append(f"Total Shots {run.total_shots} != shots {run.shots}")
    # Secondary fields: drop if implausible instead of blocking the save.
    if run.total_targets is not None and run.targets_killed is not None and run.total_targets < run.targets_killed:
        run.total_targets = None


# ---------------- score close-up check ----------------
# The big SCORE number uses a thin "1" that the full-screen OCR pass sometimes drops: on the user's real
# screenshots "1,442" was read as ",442" or "444" (11 of 50 runs, all with confidence > 0.9, so they were saved
# silently). Re-reading a 2x close-up of just that number recovered all 11 and changed none of the other 39.
CROP_MIN_CONF = 0.90
_THOUSANDS = re.compile(r"\d{1,3}(,\d{3})+|\d{1,7}")


def reconcile_score(full_text: str, crop_text: str | None, crop_conf: float = 1.0) -> tuple[int | None, str | None, str | None]:
    """Combine the full-screen read and the close-up read of the SCORE number.

    Returns (score, note, warning). A warning means the run must be checked by a person before it counts.
    """
    full = (full_text or "").strip()
    lead_sep = full[:1] in (",", ".")
    d1 = re.sub(r"[,.\s]", "", full)
    d1 = d1 if d1.isdigit() else ""
    crop = (crop_text or "").strip().replace(" ", "")
    ok2 = crop_conf >= CROP_MIN_CONF and bool(_THOUSANDS.fullmatch(crop))
    d2 = crop.replace(",", "") if ok2 else ""
    if ok2 and d1 and d2 == d1 and not lead_sep:
        return int(d1), None, None
    if ok2 and d1 and len(d2) > len(d1) and d2.endswith(d1):
        return int(d2), f"score re-read from close-up: '{full}' -> {int(d2)}", None
    if lead_sep:
        return (int(d1) if d1 else None), None, (f"Score looks cut off (read '{full}'): the first digit may be "
                                                 "missing. Please type the score from the screenshot.")
    if ok2 and d1 and d2 != d1:
        return int(d1), None, f"Score unclear: read {int(d1)} on the full screenshot but {int(d2)} in a close-up."
    return (int(d1) if d1 else None), None, None  # close-up unreadable: keep the full read


def verify_score(img: Image.Image, run: ParsedRun, ocr=None) -> None:
    """Re-read the SCORE number from an upscaled crop and fix/flag a dropped leading digit (in place)."""
    v = run.score_box
    if v is None:
        return
    ocr = ocr or _ocr
    h = v.y1 - v.y0
    rgb = img.convert("RGB")
    box = (max(0, int(v.x0 - 1.2 * h)), max(0, int(v.y0 - 0.15 * h)),
           min(rgb.width, int(v.x1 + 0.3 * h)), min(rgb.height, int(v.y1 + 0.15 * h)))
    crop_text, crop_conf = None, 0.0
    try:
        crop = rgb.crop(box)
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
        from PIL import ImageOps
        crop = ImageOps.expand(crop, border=40, fill=crop.getpixel((1, 1)))
        digit_boxes = [b for b in ocr(crop) if re.search(r"\d", b.text)]
        if digit_boxes:
            best = max(digit_boxes, key=lambda b: (b.x1 - b.x0) * (b.y1 - b.y0))
            crop_text, crop_conf = best.text, best.conf
    except Exception as e:  # never let the check break ingest
        run.notes.append(f"score close-up failed: {e}")
    score, note, warning = reconcile_score(v.text, crop_text, crop_conf)
    run.score = score
    if note:
        run.notes.append(note)
        run.confidence["score"] = min(run.confidence.get("score", 1.0) or 1.0, crop_conf)
    if warning:
        run.warnings.append(warning)
        run.confidence["score"] = min(run.confidence.get("score", 0.5), 0.5)  # lets the fallback replace it


def parse_image(src, known_tasks: list[str] | None = None, fallback=None) -> ParsedRun | None:
    """Return ParsedRun, or None if the image doesn't look like an Aimlabs results screen.

    fallback: optional callable(image) -> dict of fields (the local vision model). It only fills fields
    the OCR pass missed or was unsure about, and its values are re-checked like any other.
    """
    img = src if isinstance(src, Image.Image) else Image.open(io.BytesIO(src) if isinstance(src, bytes) else Path(src))
    known_tasks = known_tasks or []
    run = _parse_boxes(_ocr(img), known_tasks)
    if run is not None:
        verify_score(img, run)
    if (run is None or run.needs_review) and fallback is not None:
        data = fallback(img)
        if data and data.get("is_aimlabs_results"):
            run = run or ParsedRun()
            for f in FIELDS:
                if data.get(f) is not None and (getattr(run, f) is None or run.confidence.get(f, 0) < MIN_CONF):
                    val = data[f]
                    if f == "task":
                        val = {task_key(t): t for t in known_tasks}.get(task_key(str(val)), str(val))
                    setattr(run, f, val)
                    run.confidence[f] = 0.86 if f != "task" or val in known_tasks else 0.5
            run.warnings.clear()
            _check(run)
            run.source = "ocr+vision"
    return run
