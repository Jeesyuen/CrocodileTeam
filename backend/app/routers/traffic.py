from datetime import datetime, timedelta
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import TrafficModelVersion, TrafficObservation
from ..schemas import BestDepartureIn, TrafficRouteIn
from ..security import get_current_user
from ..services.graph import get_network, get_traffic_segments
from ..services.planner import build_hazard_index, traffic_context, traffic_incident_segments
from ..services.routing import RouteRequest, RoutingError, compute_routes
from ..services.traffic_model import MODEL_VERSION, get_forecaster, load_metrics
from ..services.traffic_sim import MYT, congestion_level, floor_slot

router = APIRouter(prefix="/api/traffic", tags=["traffic"], dependencies=[Depends(get_current_user)])
DATA_SOURCE = {"type": "synthetic", "label": "Synthetic demonstration data",
               "note": "No live traffic feed is connected. Speeds come from a reproducible synthetic generator "
                       "and forecasts from a model trained on that synthetic history."}


@lru_cache
def _segment_geometry():
    net = get_network("drive")
    out: dict[str, list] = {}
    seen = set()
    for e in net.edges.values():
        if e.traffic_segment and e.seg not in seen:
            seen.add(e.seg)
            out.setdefault(e.traffic_segment, []).append(e.geom)
    return out


@router.get("/segments")
def segments():
    geo = _segment_geometry()
    return [{**s, "geometry": geo.get(s["id"], [])} for s in get_traffic_segments()]


def _ref(depart_at: datetime | None) -> tuple[datetime, datetime]:
    now = datetime.now(MYT)
    ref = (depart_at or now).astimezone(MYT)
    if ref < now:
        ref = now
    if ref > now + timedelta(hours=24):
        raise HTTPException(422, "Forecasts are available for the next 24 hours only")
    return now, ref


@router.get("/forecast")
def forecast(depart_at: datetime | None = None, weather: str = Query("auto", pattern="^(auto|clear|rain)$"),
             db: Session = Depends(get_db)):
    now, ref = _ref(depart_at)
    fc = get_forecaster()
    inc = traffic_incident_segments(db)
    targets = [ref, ref + timedelta(minutes=15), ref + timedelta(minutes=30), ref + timedelta(minutes=60)]
    res = fc.forecast(targets, now, weather, inc)
    segs = {s["id"]: s for s in get_traffic_segments()}
    seg_out = []
    for sid, lst in res.items():
        s = segs[sid]
        ff_tt = s["length_m"] / (s["free_flow_kmh"] / 3.6)
        seg_out.append({"id": sid, "name": s["name"], "highway": s["highway"], "free_flow_kmh": s["free_flow_kmh"],
                        "length_m": s["length_m"], "incident": sid in inc,
                        "forecasts": [{"horizon_min": f.horizon_min, "target_time": f.target_time, "ratio": f.ratio,
                                       "speed_kmh": f.speed_kmh, "travel_time_s": f.travel_time_s,
                                       "delay_s": round(max(0.0, f.travel_time_s - ff_tt)), "level": f.level,
                                       "uncertainty": f.std, "method": f.method} for f in lst]})

    # city-wide outlook for the next 8 h (30-min steps), length weighted
    steps = [floor_slot(ref) + timedelta(minutes=30 * i) for i in range(0, 17)]
    outlook_raw = fc.forecast(steps, now, weather, inc)
    total_len = sum(s["length_m"] for s in segs.values())
    outlook = []
    for i, t in enumerate(steps):
        avg = sum(outlook_raw[sid][i].ratio * segs[sid]["length_m"] for sid in segs) / total_len
        congested = sum(1 for sid in segs if outlook_raw[sid][i].level in ("high", "severe"))
        delay = sum(max(0, outlook_raw[sid][i].travel_time_s - segs[sid]["length_m"] / (segs[sid]["free_flow_kmh"] / 3.6))
                    for sid in segs)
        outlook.append({"time": t, "avg_ratio": round(avg, 3), "level": congestion_level(avg),
                        "congested_segments": congested, "total_delay_s": round(delay)})
    peak = min(outlook, key=lambda o: o["avg_ratio"])
    cur = outlook[0]
    at30 = [s["forecasts"][2] for s in seg_out]
    return {
        "generated_at": now, "reference_time": ref, "weather": weather, "model_version": MODEL_VERSION,
        "data_source": DATA_SOURCE,
        "summary": {
            "current_level": cur["level"], "current_avg_ratio": cur["avg_ratio"],
            "predicted_peak": {"time": peak["time"], "level": peak["level"], "avg_ratio": peak["avg_ratio"]},
            "avg_forecast_delay_s": round(sum(f["delay_s"] for f in at30) / max(1, len(at30))),
            "congested_segments_30": sum(1 for f in at30 if f["level"] in ("high", "severe")),
            "segments_total": len(seg_out), "incident_segments": sorted(inc),
        },
        "outlook": outlook,
        "segments": sorted(seg_out, key=lambda s: s["forecasts"][2]["ratio"]),
    }


def _drive_plan(db, origin, destination, depart, weather, now, hz, prefs=("fastest", "safest", "balanced"),
                include_usual=False):
    ctx = traffic_context(db, now, depart, weather)
    req = RouteRequest(mode="drive", origin=origin, destination=destination, depart=depart, now=now, weather=weather)
    return compute_routes(get_network("drive"), req, hz, ctx, preferences=prefs, include_usual=include_usual)


def _routing_guard(fn):
    try:
        return fn()
    except RoutingError as e:
        raise HTTPException(422 if e.code in ("outside_area", "same_point") else 409,
                            {"code": e.code, "message": str(e)})


@router.post("/predict")
def predict(body: TrafficRouteIn, db: Session = Depends(get_db)):
    now, ref = _ref(body.depart_at)
    o, d = (body.origin.lat, body.origin.lon), (body.destination.lat, body.destination.lon)
    hz = build_hazard_index(db, "drive")
    result = _routing_guard(lambda: _drive_plan(db, o, d, ref, body.weather, now, hz, include_usual=True))
    timeline = []
    for i in range(0, 9):
        t = floor_slot(ref) + timedelta(minutes=15 * i)
        if t < now - timedelta(minutes=1):
            t = now
        r = _drive_plan(db, o, d, t, body.weather, now, hz, prefs=("fastest",))["routes"][0]
        timeline.append({"depart": t, "duration_s": r["duration_s"], "free_flow_s": r["free_flow_duration_s"],
                         "delay_s": r["delay_s"]})
    result.update(depart=ref, timeline=timeline, data_source=DATA_SOURCE, model_version=MODEL_VERSION,
                  insights=_insights(result, timeline))
    return result


@router.post("/best-departure")
def best_departure(body: BestDepartureIn, db: Session = Depends(get_db)):
    now = datetime.now(MYT)
    o, d = (body.origin.lat, body.origin.lon), (body.destination.lat, body.destination.lon)
    arrive_by = body.arrive_by.astimezone(MYT) if body.arrive_by else None
    if arrive_by and arrive_by <= now + timedelta(minutes=5):
        raise HTTPException(422, "Desired arrival time must be in the future")
    if arrive_by and arrive_by > now + timedelta(hours=24):
        raise HTTPException(422, "Arrival time must be within the next 24 hours")
    start = max(now, (arrive_by - timedelta(minutes=body.window_minutes)) if arrive_by else now)
    end = arrive_by if arrive_by else now + timedelta(minutes=body.window_minutes)
    hz = build_hazard_index(db, "drive")
    options = []
    t = start
    while t <= end:
        res = _routing_guard(lambda: _drive_plan(db, o, d, t, body.weather, now, hz, prefs=("fastest",)))
        r = res["routes"][0]
        arrival = t + timedelta(seconds=r["duration_s"])
        options.append({"depart": t, "arrival": arrival, "duration_s": r["duration_s"], "delay_s": r["delay_s"],
                        "on_time": arrive_by is None or arrival <= arrive_by - timedelta(minutes=3),
                        "via": r["via"][:3]})
        t = floor_slot(t) + timedelta(minutes=15)
    if not options:
        raise HTTPException(422, "No departure window to evaluate")
    feasible = [x for x in options if x["on_time"]]
    quickest = None
    if arrive_by and not feasible:
        rec = options[0]
        verdict = "late"
    elif arrive_by:
        # latest departure that still arrives on time (with a 3-min buffer)
        rec = feasible[-1]
        verdict = "ok"
        q = min(feasible, key=lambda x: x["duration_s"])
        if rec["duration_s"] - q["duration_s"] >= 180:
            quickest = q
    else:
        best_dur = min(x["duration_s"] for x in options)
        # earliest departure within 1 min of the quickest forecast journey
        rec = next(x for x in options if x["duration_s"] <= best_dur + 60)
        verdict = "ok"
    leave_now = options[0]
    saving = leave_now["duration_s"] - rec["duration_s"]
    if verdict == "late":
        text = (f"Even leaving now, the forecast arrival is {options[0]['arrival']:%H:%M}, after your target "
                f"{arrive_by:%H:%M}. Leave as soon as possible.")
    elif arrive_by:
        text = (f"Leave by {rec['depart']:%H:%M} to arrive around {rec['arrival']:%H:%M} "
                f"(journey ≈ {round(rec['duration_s'] / 60)} min, forecast).")
        if quickest:
            text += (f" Leaving at {quickest['depart']:%H:%M} avoids the peak and is about "
                     f"{round((rec['duration_s'] - quickest['duration_s']) / 60)} min quicker.")
    elif saving >= 120:
        text = (f"Leaving at {rec['depart']:%H:%M} instead of now is forecast to save about "
                f"{round(saving / 60)} min.")
    else:
        text = "Forecast journey times stay similar over this window — leaving now is fine."
    return {"options": options, "recommended": rec, "quickest": quickest, "verdict": verdict, "saving_vs_now_s": max(0, saving),
            "insight": text, "arrive_by": arrive_by, "data_source": DATA_SOURCE, "model_version": MODEL_VERSION}


def _insights(result: dict, timeline: list[dict]) -> list[dict]:
    """Only statements that follow directly from the forecast numbers."""
    out = []
    routes = {r["preference"]: r for r in result["routes"]}
    fastest = routes.get("fastest")
    usual = result.get("usual")
    if usual and fastest and usual["duration_s"] - fastest["duration_s"] >= 60 and fastest["edge_ids"] != usual["edge_ids"]:
        save = round((usual["duration_s"] - fastest["duration_s"]) / 60)
        via = ", ".join(fastest["via"][:2]) or "an alternative"
        out.append({"type": "route", "text": f"The forecast-fastest route via {via} is about {save} min quicker "
                                             f"than the usual route at this departure time."})
    if timeline:
        worst = max(timeline, key=lambda x: x["duration_s"])
        best = min(timeline, key=lambda x: x["duration_s"])
        first = timeline[0]
        if worst["duration_s"] - first["duration_s"] >= 120:
            out.append({"type": "peak", "text": f"Journey time is forecast to rise to about "
                                                f"{round(worst['duration_s'] / 60)} min if you leave at "
                                                f"{worst['depart']:%H:%M}. Consider departing earlier."})
        if first["duration_s"] - best["duration_s"] >= 120:
            out.append({"type": "departure", "text": f"Leaving at {best['depart']:%H:%M} is forecast to take "
                                                     f"{round(best['duration_s'] / 60)} min — about "
                                                     f"{round((first['duration_s'] - best['duration_s']) / 60)} min "
                                                     f"less than leaving at {first['depart']:%H:%M}."})
    if fastest and fastest.get("delay_s", 0) and fastest["delay_s"] >= 120:
        out.append({"type": "delay", "text": f"Expect about {round(fastest['delay_s'] / 60)} min of congestion "
                                             f"delay on the fastest route compared with free-flow traffic."})
    if not out:
        out.append({"type": "clear", "text": "Traffic is forecast to stay light for this trip — no change needed."})
    return out


@router.get("/observations")
def observations(segment_id: str, hours: int = Query(24, ge=1, le=24 * 14), db: Session = Depends(get_db)):
    since = datetime.now(MYT) - timedelta(hours=hours)
    rows = db.scalars(select(TrafficObservation).where(TrafficObservation.road_segment_id == segment_id,
                                                       TrafficObservation.timestamp >= since)
                      .order_by(TrafficObservation.timestamp)).all()
    return {"segment_id": segment_id, "data_source": DATA_SOURCE,
            "observations": [{"t": r.timestamp, "speed_kmh": r.average_speed, "travel_time_s": r.travel_time,
                              "rain": r.rain, "incident": r.incident} for r in rows]}


@router.get("/model")
def model_info(db: Session = Depends(get_db)):
    versions = db.scalars(select(TrafficModelVersion).order_by(TrafficModelVersion.created_at.desc())).all()
    return {"current": MODEL_VERSION, "metrics": load_metrics(), "data_source": DATA_SOURCE,
            "versions": [{"model_name": v.model_name, "version": v.version, "created_at": v.created_at,
                          "evaluation_metrics": v.evaluation_metrics} for v in versions]}
