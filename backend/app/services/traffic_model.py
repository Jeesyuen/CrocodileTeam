"""Traffic congestion forecasting.

Two models are trained on the (synthetic) corridor history and compared on a held-out
final week:
  * baseline — historical average speed ratio by corridor × weekday/weekend × 15-min slot
  * ml       — RandomForestRegressor using time-of-day, day-of-week, weather, incidents,
               the current observed speed ratio and the forecast horizon

Forecasts are expressed as a ratio of free-flow speed and converted to km/h and
travel time per corridor. Everything trained here is on SYNTHETIC data and is
labelled as such in every API response.
"""
from __future__ import annotations

import json
import math
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache

import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor

from ..config import get_settings
from .graph import get_traffic_segments
from .traffic_sim import (
    HIGHWAY_RANK, MYT, SLOT_MIN, congestion_level, floor_slot, has_incident, is_raining, speed_ratio,
)

HORIZONS = (15, 30, 60, 120, 240)
EVAL_HORIZONS = (15, 30, 60)
MODEL_VERSION = "rf-v1"
FEATURES = ["seg_idx", "hw_rank", "free_flow", "tod_sin", "tod_cos", "dow", "weekend", "rain_t", "incident_t",
            "current_ratio", "current_rain", "horizon", "baseline_t"]
SLOTS_PER_DAY = 24 * 60 // SLOT_MIN
LEVELS = ["low", "moderate", "high", "severe"]


def _slot_index(t: datetime) -> int:
    t = t.astimezone(MYT)
    return (t.hour * 60 + t.minute) // SLOT_MIN


class Baseline:
    def __init__(self, table: dict):
        self.table = table  # key f"{seg}|{weekend}|{slot}" -> mean ratio

    @classmethod
    def fit(cls, seg_ids, times, ratios):
        acc: dict[str, list[float]] = {}
        for si, sid in enumerate(seg_ids):
            for ti, t in enumerate(times):
                key = f"{sid}|{int(t.weekday() >= 5)}|{_slot_index(t)}"
                acc.setdefault(key, []).append(ratios[si, ti])
        return cls({k: float(np.mean(v)) for k, v in acc.items()})

    def get(self, sid: str, t: datetime) -> float:
        return self.table.get(f"{sid}|{int(t.astimezone(MYT).weekday() >= 5)}|{_slot_index(t)}", 0.85)


def _row(si, seg, target: datetime, rain_t, inc_t, cur_ratio, cur_rain, horizon, base):
    t = target.astimezone(MYT)
    tod = (t.hour * 60 + t.minute) / 1440 * 2 * math.pi
    return [si, HIGHWAY_RANK.get(seg["highway"], 4), seg["free_flow_kmh"], math.sin(tod), math.cos(tod),
            t.weekday(), int(t.weekday() >= 5), int(rain_t), int(inc_t), cur_ratio, int(cur_rain), horizon, base]


def generate_history(end: datetime, days: int):
    segs = get_traffic_segments()
    end = floor_slot(end)
    times = [end - timedelta(minutes=SLOT_MIN * i) for i in range(days * SLOTS_PER_DAY, -1, -1)]
    rain = np.array([is_raining(t) for t in times])
    inc = np.array([[has_incident(s["id"], t) for t in times] for s in segs])
    ratios = np.array([[speed_ratio(s, t, rain=bool(rain[ti]), incident=bool(inc[si, ti]))
                        for ti, t in enumerate(times)] for si, s in enumerate(segs)])
    return segs, times, rain, inc, ratios


def _build_xy(segs, times, rain, inc, ratios, start_idx, end_idx, baseline, horizons, stride=1):
    X, y = [], []
    for si, seg in enumerate(segs):
        for ti in range(start_idx, end_idx, stride):
            for h in horizons:
                tj = ti + h // SLOT_MIN
                if tj >= end_idx:
                    continue
                X.append(_row(si, seg, times[tj], rain[tj], inc[si, tj], ratios[si, ti], rain[ti], h,
                              baseline.get(seg["id"], times[tj])))
                y.append(ratios[si, tj])
    return np.array(X, dtype=float), np.array(y)


def _class_acc(pred, true):
    return float(np.mean([congestion_level(a) == congestion_level(b) for a, b in zip(pred, true)]))


def train(end: datetime | None = None, days: int = 35, test_days: int = 7, n_estimators: int = 60,
          train_stride: int = 2) -> dict:
    """Train baseline + RandomForest, evaluate both on the final `test_days`, save artifacts."""
    settings = get_settings()
    end = end or datetime.now(MYT)
    t0 = time.perf_counter()
    segs, times, rain, inc, ratios = generate_history(end, days)
    split = len(times) - test_days * SLOTS_PER_DAY
    baseline = Baseline.fit([s["id"] for s in segs], times[:split], ratios[:, :split])

    Xtr, ytr = _build_xy(segs, times, rain, inc, ratios, 0, split, baseline, HORIZONS, stride=train_stride)
    model = RandomForestRegressor(n_estimators=n_estimators, max_depth=18, min_samples_leaf=4,
                                  n_jobs=-1, random_state=42)
    model.fit(Xtr, ytr)
    train_s = time.perf_counter() - t0

    metrics: dict = {"horizons": {}, "data_source": "synthetic", "train_rows": int(len(ytr)),
                     "train_days": days - test_days, "test_days": test_days, "segments": len(segs),
                     "train_seconds": round(train_s, 1), "features": FEATURES}
    ff = {i: s["free_flow_kmh"] for i, s in enumerate(segs)}
    lengths = {i: s["length_m"] for i, s in enumerate(segs)}
    for h in EVAL_HORIZONS:
        Xte, yte = _build_xy(segs, times, rain, inc, ratios, split, len(times), baseline, (h,), stride=1)
        t1 = time.perf_counter()
        pred = model.predict(Xte)
        latency_ms = (time.perf_counter() - t1) / max(1, len(yte)) * 1000
        base = Xte[:, FEATURES.index("baseline_t")]
        seg_idx = Xte[:, 0].astype(int)
        f = np.array([ff[i] for i in seg_idx])
        L = np.array([lengths[i] for i in seg_idx])

        def stats(p):
            sp_err = (p - yte) * f
            tt_true = L / (yte * f / 3.6)
            tt_pred = L / (np.clip(p, 0.05, None) * f / 3.6)
            return {"mae_kmh": round(float(np.mean(np.abs(sp_err))), 2),
                    "rmse_kmh": round(float(np.sqrt(np.mean(sp_err ** 2))), 2),
                    "travel_time_mae_s": round(float(np.mean(np.abs(tt_pred - tt_true))), 1),
                    "congestion_accuracy": round(_class_acc(p, yte), 3)}
        metrics["horizons"][str(h)] = {"ml": stats(pred), "baseline": stats(base), "test_rows": int(len(yte)),
                                       "latency_ms_per_row": round(latency_ms, 4)}

    settings.model_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "baseline": baseline.table, "segments": [s["id"] for s in segs],
                 "version": MODEL_VERSION, "trained_at": end.isoformat()}, settings.model_dir / "traffic_rf.joblib")
    (settings.model_dir / "traffic_metrics.json").write_text(json.dumps(metrics, indent=1))
    get_forecaster.cache_clear()
    return metrics


@dataclass
class SegmentForecast:
    segment_id: str
    target_time: datetime
    horizon_min: int
    ratio: float
    std: float
    speed_kmh: float
    travel_time_s: float
    level: str
    method: str


class Forecaster:
    def __init__(self, bundle: dict):
        self.model: RandomForestRegressor = bundle["model"]
        self.baseline = Baseline(bundle["baseline"])
        self.segs = get_traffic_segments()
        self.idx = {s["id"]: i for i, s in enumerate(self.segs)}
        self.version = bundle["version"]
        self._lock = threading.Lock()

    def observed_ratio(self, seg: dict, t: datetime) -> float:
        """Current (synthetic) observation from the demo sensor feed."""
        return speed_ratio(seg, floor_slot(t))

    def forecast(self, targets: list[datetime], now: datetime, weather: str = "auto",
                 incident_segments: frozenset[str] = frozenset(), seg_ids: list[str] | None = None
                 ) -> dict[str, list[SegmentForecast]]:
        now = now.astimezone(MYT)
        segs = [self.segs[self.idx[s]] for s in seg_ids] if seg_ids else self.segs
        cur_rain = is_raining(now) if weather == "auto" else weather == "rain"
        rows, meta = [], []
        out: dict[str, list[SegmentForecast]] = {s["id"]: [] for s in segs}
        for seg in segs:
            si = self.idx[seg["id"]]
            cur = self.observed_ratio(seg, now)
            for t in targets:
                h = (t - now).total_seconds() / 60
                rain_t = is_raining(t) if weather == "auto" else weather == "rain"
                inc_t = seg["id"] in incident_segments
                if h <= 7.5:
                    r = speed_ratio(seg, floor_slot(now), rain=cur_rain, incident=inc_t or None)
                    out[seg["id"]].append(self._mk(seg, t, 0, r, 0.0, "observed"))
                    continue
                hc = min(max(h, 15), HORIZONS[-1])
                rows.append(_row(si, seg, t, rain_t, inc_t, cur, cur_rain, hc, self.baseline.get(seg["id"], t)))
                meta.append((seg, t, int(round(h)), "ml" if h <= 60 else "ml-extended"))
        if rows:
            X = np.array(rows, dtype=float)
            with self._lock:
                per_tree = np.stack([est.predict(X) for est in self.model.estimators_])
            mean, std = per_tree.mean(axis=0), per_tree.std(axis=0)
            for (seg, t, h, method), m, s in zip(meta, mean, std):
                out[seg["id"]].append(self._mk(seg, t, h, float(m), float(s), method))
        for v in out.values():
            v.sort(key=lambda f: f.target_time)
        return out

    @staticmethod
    def _mk(seg, t, h, ratio, std, method):
        ratio = max(0.08, min(1.05, ratio))
        sp = ratio * seg["free_flow_kmh"]
        return SegmentForecast(seg["id"], t, h, round(ratio, 3), round(std, 3), round(sp, 1),
                               round(seg["length_m"] / (sp / 3.6), 1), congestion_level(ratio), method)


@lru_cache
def get_forecaster() -> Forecaster:
    path = get_settings().model_dir / "traffic_rf.joblib"
    if not path.exists():
        train()
    return Forecaster(joblib.load(path))


def load_metrics() -> dict | None:
    p = get_settings().model_dir / "traffic_metrics.json"
    return json.loads(p.read_text()) if p.exists() else None


class TrafficContext:
    """Per-request speed lookup for congestion-aware routing.

    Speeds are looked up at the time the vehicle is expected to *enter* each edge,
    not at a single departure timestamp.
    """

    def __init__(self, now: datetime, depart: datetime, weather: str, incident_segments: frozenset[str]):
        self.now, self.depart, self.weather = now, depart, weather
        start = floor_slot(depart)
        self.slots = [start + timedelta(minutes=SLOT_MIN * i) for i in range(0, 13)]
        fc = get_forecaster().forecast(self.slots, now, weather, incident_segments)
        self.ratios = {sid: [f.ratio for f in lst] for sid, lst in fc.items()}
        self.forecasts = fc
        self.start = start
        self.local = [None] * len(self.slots)

    def ratio(self, traffic_segment: str | None, t: datetime) -> float:
        i = int((t - self.start).total_seconds() // (SLOT_MIN * 60))
        i = max(0, min(len(self.slots) - 1, i))
        if traffic_segment and traffic_segment in self.ratios:
            return self.ratios[traffic_segment][i]
        if self.local[i] is None:
            from .traffic_sim import local_road_ratio
            self.local[i] = local_road_ratio(self.slots[i]) * (0.85 if self._rain(self.slots[i]) else 1.0)
        return self.local[i]

    def _rain(self, t):
        return is_raining(t) if self.weather == "auto" else self.weather == "rain"
