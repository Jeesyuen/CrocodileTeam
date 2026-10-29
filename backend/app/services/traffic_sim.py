"""Reproducible SYNTHETIC traffic generator for the Cyberjaya demo corridors.

No live traffic feed is connected. Every speed produced here is synthetic and is
labelled `data_source="synthetic"` wherever it is stored or shown. The generator
encodes plausible patterns (weekday AM/PM commute peaks, lunch bump, lighter
weekends, afternoon thunderstorms, occasional incidents) so the forecasting model
has realistic structure to learn.
"""
from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta, timezone

MYT = timezone(timedelta(hours=8))  # Malaysia has no DST
SLOT_MIN = 15
HIGHWAY_RANK = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4}


def _u(*key) -> float:
    """Deterministic uniform [0,1) from a key."""
    h = hashlib.blake2b("|".join(map(str, key)).encode(), digest_size=8).digest()
    return int.from_bytes(h, "big") / 2**64


def _gauss(*key) -> float:
    u1, u2 = max(_u(*key, "a"), 1e-12), _u(*key, "b")
    return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


def floor_slot(t: datetime) -> datetime:
    t = t.astimezone(MYT)
    return t.replace(minute=(t.minute // SLOT_MIN) * SLOT_MIN, second=0, microsecond=0)


def segment_sensitivity(seg: dict) -> tuple[float, float]:
    """How strongly a corridor reacts to the AM and PM peaks."""
    base = {0: 0.45, 1: 0.5, 2: 0.55, 3: 0.45, 4: 0.35}.get(HIGHWAY_RANK.get(seg["highway"], 4), 0.35)
    am = base * (0.7 + 0.6 * _u(seg["id"], "am"))
    pm = base * (0.8 + 0.6 * _u(seg["id"], "pm"))
    return min(am, 0.72), min(pm, 0.75)


def is_raining(t: datetime) -> bool:
    """Synthetic weather: afternoon/evening thunderstorms on ~35% of days, rare morning rain."""
    t = t.astimezone(MYT)
    day = t.date().isoformat()
    h = t.hour + t.minute / 60
    if _u("storm", day) < 0.35:
        start = 14.5 + 3 * _u("storm-start", day)
        if start <= h < start + 1 + 1.5 * _u("storm-len", day):
            return True
    if _u("mrain", day) < 0.08 and 6.5 <= h < 8.5:
        return True
    return False


def has_incident(seg_id: str, t: datetime) -> bool:
    """Synthetic historical incidents: ~4% of segment-days get one 60–120 min disruption."""
    t = t.astimezone(MYT)
    day = t.date().isoformat()
    if _u("inc", seg_id, day) >= 0.04:
        return False
    start = 7 + 12 * _u("inc-start", seg_id, day)
    dur = 1 + _u("inc-dur", seg_id, day)
    h = t.hour + t.minute / 60
    return start <= h < start + dur


def peak_profile(t: datetime) -> tuple[float, float, float]:
    t = t.astimezone(MYT)
    h = t.hour + t.minute / 60
    am = math.exp(-((h - 8.25) ** 2) / (2 * 0.75**2))
    pm = math.exp(-((h - 17.9) ** 2) / (2 * 0.95**2))
    lunch = math.exp(-((h - 12.9) ** 2) / (2 * 0.6**2))
    return am, pm, lunch


def speed_ratio(seg: dict, t: datetime, rain: bool | None = None, incident: bool | None = None) -> float:
    """Synthetic observed speed as a fraction of free-flow speed."""
    t = t.astimezone(MYT)
    rain = is_raining(t) if rain is None else rain
    incident = has_incident(seg["id"], t) if incident is None else incident
    am_s, pm_s = segment_sensitivity(seg)
    am, pm, lunch = peak_profile(t)
    weekend = t.weekday() >= 5
    if weekend:
        load = 0.12 * am + 0.25 * pm + 0.22 * lunch
        load *= 0.9 + 0.3 * _u(seg["id"], "wk")
    else:
        friday = 1.08 if t.weekday() == 4 else 1.0
        load = am_s * am + pm_s * pm * friday + 0.12 * lunch
    ratio = 1.0 - load
    if rain:
        ratio *= 0.8 - 0.08 * am - 0.08 * pm
    if incident:
        ratio *= 0.62
    slot = floor_slot(t).isoformat()
    ratio *= 1 + 0.05 * _gauss("noise", seg["id"], slot)
    return float(max(0.12, min(1.05, ratio)))


def congestion_level(ratio: float) -> str:
    if ratio >= 0.75:
        return "low"
    if ratio >= 0.55:
        return "moderate"
    if ratio >= 0.38:
        return "high"
    return "severe"


def local_road_ratio(t: datetime) -> float:
    """Minor roads have no forecast model; they get a mild synthetic time-of-day profile."""
    am, pm, lunch = peak_profile(t)
    weekend = t.astimezone(MYT).weekday() >= 5
    load = (0.06 * am + 0.1 * pm + 0.05 * lunch) if weekend else (0.18 * am + 0.22 * pm + 0.06 * lunch)
    return 1.0 - load


def history_times(end: datetime, days: int):
    end = floor_slot(end)
    t = end - timedelta(days=days)
    while t <= end:
        yield t
        t += timedelta(minutes=SLOT_MIN)
