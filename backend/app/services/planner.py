"""Glue between the database (incidents), traffic forecasts and the routing engine."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Incident, IncidentPathImpact, Status
from .graph import get_network
from .routing import RouteRequest, compute_routes
from .safety import HazardIndex
from .traffic_model import TrafficContext
from .traffic_sim import MYT

HISTORY_RADIUS_M = 60
HISTORY_DAYS = 180
TRAFFIC_DISRUPTING = {"road_accident", "flooding", "fallen_tree", "construction", "road_debris"}


def build_hazard_index(db: Session, network: str) -> HazardIndex:
    net = get_network(network)
    hz = HazardIndex(active={}, historical={}, closed=set())
    rows = db.execute(
        select(IncidentPathImpact, Incident).join(Incident)
        .where(IncidentPathImpact.active.is_(True), IncidentPathImpact.network == network)
    ).all()
    for imp, inc in rows:
        hz.active.setdefault(imp.segment_id, []).append(
            {"incident_id": inc.id, "severity": inc.severity, "impact_type": imp.impact_type,
             "category": inc.category, "status": inc.verification_status})
        if imp.impact_type == "closure":
            hz.closed.add(imp.segment_id)
    since = datetime.now(timezone.utc) - timedelta(days=HISTORY_DAYS)
    past = db.scalars(select(Incident).where(
        Incident.created_at >= since,
        Incident.verification_status.notin_([Status.REJECTED, Status.DUPLICATE]))).all()
    for inc in past:
        # count each segment once per incident (both directions share a segment id)
        for seg in {e.seg for e, _ in net.edges_near(inc.latitude, inc.longitude, HISTORY_RADIUS_M)}:
            hz.historical[seg] = hz.historical.get(seg, 0) + 1
    return hz


def traffic_incident_segments(db: Session) -> frozenset[str]:
    """Traffic corridors with an active disruptive incident — fed into the congestion model."""
    net = get_network("drive")
    rows = db.execute(
        select(IncidentPathImpact.segment_id, Incident.category).join(Incident)
        .where(IncidentPathImpact.active.is_(True), IncidentPathImpact.network == "drive",
               Incident.verification_status.in_(Status.ACTIVE))
    ).all()
    out = set()
    for seg, cat in rows:
        if cat in TRAFFIC_DISRUPTING:
            for e in net.seg_edges.get(seg, ()):
                if e.traffic_segment:
                    out.add(e.traffic_segment)
    return frozenset(out)


_ctx_cache: dict[tuple, TrafficContext] = {}


def traffic_context(db: Session, now: datetime, depart: datetime, weather: str) -> TrafficContext:
    inc = traffic_incident_segments(db)
    key = (now.replace(second=0, microsecond=0, minute=now.minute // 5 * 5), depart.replace(second=0, microsecond=0),
           weather, inc)
    ctx = _ctx_cache.get(key)
    if ctx is None:
        if len(_ctx_cache) > 64:
            _ctx_cache.clear()
        ctx = _ctx_cache[key] = TrafficContext(now, depart, weather, inc)
    return ctx


def plan(db: Session, mode: str, origin, destination, depart: datetime | None = None, weather: str = "auto",
         include_usual: bool = False, preferences=("fastest", "safest", "balanced")) -> dict:
    now = datetime.now(MYT)
    depart = (depart or now).astimezone(MYT)
    if depart < now - timedelta(minutes=5):
        depart = now
    net = get_network(mode)
    hz = build_hazard_index(db, mode)
    ctx = traffic_context(db, now, depart, weather) if mode == "drive" else None
    req = RouteRequest(mode=mode, origin=tuple(origin), destination=tuple(destination), depart=depart, now=now,
                       weather=weather)
    result = compute_routes(net, req, hz, ctx, preferences=preferences, include_usual=include_usual)
    result["depart"] = depart.isoformat()
    result["traffic_data"] = ("synthetic forecast (demo data)" if mode == "drive" else None)
    return result
