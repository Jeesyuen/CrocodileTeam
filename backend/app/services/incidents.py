"""Incident lifecycle: path matching, impacts, history, targeted alerts and rerouting."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    HazardReport, Incident, IncidentHistory, IncidentPathImpact, Notification, Restriction, RouteSession, Status, User,
)
from .graph import get_network, haversine
from .planner import plan
from .realtime import manager
from .routing import RoutingError

log = logging.getLogger("saferoute.incidents")

CATEGORY_LABELS = {
    "fallen_tree": "Fallen Tree", "flooding": "Flooding", "pothole": "Pothole",
    "damaged_pavement": "Damaged Pavement", "construction": "Construction", "road_debris": "Road Debris",
    "poor_lighting": "Poor Lighting", "slippery_surface": "Slippery Surface", "road_accident": "Road Accident",
    "other": "Other Hazard",
}
DEFAULT_RELEVANCE = {
    "fallen_tree": "both", "flooding": "both", "pothole": "drive", "damaged_pavement": "walk",
    "construction": "both", "road_debris": "both", "poor_lighting": "walk", "slippery_surface": "both",
    "road_accident": "drive", "other": "both",
}
RELIABLE_M, APPROX_M = 12.0, 25.0
DUPLICATE_RADIUS_M, DUPLICATE_HOURS = 40.0, 48
EXPIRE_HOURS = 72
SEVERITY_PRIORITY = {"low": "low", "medium": "medium", "high": "high", "critical": "critical"}
IMPACT_FOR = {Restriction.ADVISORY: "warning", Restriction.CAUTION: "caution", Restriction.CLOSED: "closure"}


def networks_for(relevance: str) -> list[str]:
    return ["walk", "drive"] if relevance == "both" else [relevance]


def match_location(lat: float, lon: float, relevance: str = "both") -> dict:
    """Match a reported point to the nearest mapped path segment in each relevant network."""
    out = {}
    for net_name in networks_for(relevance):
        near = get_network(net_name).edges_near(lat, lon, APPROX_M)
        if near:
            e, d = near[0]
            out[net_name] = {"segment_id": e.seg, "edge_id": e.id, "distance_m": round(d, 1), "road": e.name,
                             "highway": e.highway, "quality": "reliable" if d <= RELIABLE_M else "approximate"}
        else:
            out[net_name] = None
    return out


def location_label(lat: float, lon: float) -> str:
    for net_name in ("drive", "walk"):
        for e, _ in get_network(net_name).edges_near(lat, lon, 60):
            if e.name:
                return e.name
    return "Cyberjaya"


def recompute_impacts(db: Session, inc: Incident) -> dict:
    """Link the incident to real path segments. A pin that matches no mapped path creates no impact."""
    for imp in list(inc.impacts):
        db.delete(imp)
    db.flush()
    matches = match_location(inc.latitude, inc.longitude, inc.mode_relevance)
    qualities = [m["quality"] for m in matches.values() if m]
    inc.match_quality = "reliable" if "reliable" in qualities else ("approximate" if qualities else "none")
    active = inc.verification_status not in Status.CLOSED and inc.restriction_status != Restriction.NONE
    impact_type = IMPACT_FOR.get(inc.restriction_status)
    if inc.verification_status == Status.RESOLVED and inc.restriction_status == Restriction.CLOSED:
        active = True  # a confirmed closure stays until an operator explicitly reopens the path
    for net_name, m in matches.items():
        if not m or impact_type is None:
            continue
        # closures are only ever set by an operator, who confirms the location when doing so
        db.add(IncidentPathImpact(incident_id=inc.id, network=net_name, segment_id=m["segment_id"],
                                  distance_m=m["distance_m"], impact_type=impact_type, active=active))
    db.flush()
    return matches


def log_history(db: Session, inc: Incident, action: str, actor: User | None, from_status: str | None = None,
                to_status: str | None = None, note: str = ""):
    db.add(IncidentHistory(incident_id=inc.id, action=action, actor_id=actor.id if actor else None,
                           from_status=from_status, to_status=to_status, note=note))


def find_duplicate(db: Session, category: str, lat: float, lon: float) -> Incident | None:
    since = datetime.now(timezone.utc) - timedelta(hours=DUPLICATE_HOURS)
    cands = db.scalars(select(Incident).where(
        Incident.category == category, Incident.created_at >= since,
        Incident.verification_status.in_(Status.ACTIVE))).all()
    best = None
    for c in cands:
        d = haversine((lat, lon), (c.latitude, c.longitude))
        if d <= DUPLICATE_RADIUS_M and (best is None or d < best[1]):
            best = (c, d)
    return best[0] if best else None


def expire_stale(db: Session) -> int:
    """Unverified reports older than EXPIRE_HOURS need review. Confirmed closures are never auto-reopened."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=EXPIRE_HOURS)
    stale = db.scalars(select(Incident).where(
        Incident.verification_status.in_([Status.SUBMITTED, Status.PENDING]), Incident.created_at < cutoff)).all()
    for inc in stale:
        log_history(db, inc, "expired", None, inc.verification_status, Status.EXPIRED,
                    "No verification within 72 h — review required.")
        inc.verification_status = Status.EXPIRED
    if stale:
        db.commit()
    return len(stale)


def serialize_incident(inc: Incident, detail: bool = False) -> dict:
    primary = next((r for r in inc.reports if r.id == inc.primary_report_id), inc.reports[0] if inc.reports else None)
    images = [f"/uploads/{img.storage_path}" for r in inc.reports for img in r.images]
    d = {
        "id": inc.id, "category": inc.category, "category_label": CATEGORY_LABELS.get(inc.category, inc.category),
        "title": inc.title, "description": inc.description, "severity": inc.severity,
        "status": inc.verification_status, "restriction": inc.restriction_status, "obstruction": inc.obstruction,
        "lat": inc.latitude, "lon": inc.longitude, "location_label": inc.location_label,
        "mode_relevance": inc.mode_relevance, "match_quality": inc.match_quality, "report_count": inc.report_count,
        "is_synthetic": inc.is_synthetic, "created_at": inc.created_at, "updated_at": inc.updated_at,
        "resolved_at": inc.resolved_at, "image_url": images[0] if images else None,
        "reporter_id": primary.reporter_id if primary else None,
        "certainty": certainty_label(inc),
    }
    if detail:
        d["images"] = images
        d["impacts"] = [{"network": i.network, "segment_id": i.segment_id, "impact_type": i.impact_type,
                         "distance_m": i.distance_m, "active": i.active} for i in inc.impacts]
        d["affected_paths"] = incident_paths(inc)
        d["history"] = [{"action": h.action, "from": h.from_status, "to": h.to_status, "note": h.note,
                         "actor": h.actor.name if h.actor else "System", "actor_role": h.actor.role if h.actor else None,
                         "at": h.created_at} for h in inc.history]
        d["reports"] = [{"id": r.id, "reporter": r.reporter.name if r.reporter else None, "category": r.category,
                         "severity": r.severity, "description": r.description, "created_at": r.created_at,
                         "images": [f"/uploads/{i.storage_path}" for i in r.images],
                         "ai": [{"model": a.model_name, "status": a.status, "output": a.output,
                                 "confidence": a.confidence, "created_at": a.created_at} for a in r.analyses]}
                        for r in inc.reports]
    return d


def incident_paths(inc: Incident, active_only: bool = False, network: str | None = None) -> list[dict]:
    """Mapped path geometry each impact applies to (one edge per segment, i.e. a real network edge)."""
    out = []
    for i in inc.impacts:
        if (active_only and not i.active) or (network and i.network != network):
            continue
        for e in get_network(i.network).seg_edges.get(i.segment_id, ())[:1]:
            out.append({"network": i.network, "impact_type": i.impact_type, "active": i.active,
                        "road": e.name, "geometry": e.geom})
    return out


def certainty_label(inc: Incident) -> str:
    if inc.verification_status in Status.CLOSED:
        return {Status.RESOLVED: "resolved", Status.REJECTED: "rejected", Status.DUPLICATE: "duplicate"}[
            inc.verification_status] if inc.restriction_status != Restriction.CLOSED else "confirmed_closure"
    if inc.restriction_status == Restriction.CLOSED:
        return "confirmed_closure"
    if inc.verification_status in (Status.VERIFIED, Status.IN_PROGRESS, Status.AWAITING_CLEARANCE):
        return "verified"
    return "reported"


def notify_affected_sessions(db: Session, inc: Incident, reason: str) -> int:
    """Find active navigation sessions crossing the incident's segments, reroute them, and alert the user."""
    impacts = [i for i in inc.impacts if i.active]
    if not impacts:
        return 0
    sessions = db.scalars(select(RouteSession).where(RouteSession.active.is_(True))).all()
    sent = 0
    for s in sessions:
        segs = {i.segment_id for i in impacts if i.network == s.mode}
        if not segs or not segs.intersection(s.active_segment_ids or []):
            continue
        key = f"inc{inc.id}:s{s.id}:{inc.restriction_status}:{inc.verification_status}"
        if db.scalar(select(Notification.id).where(Notification.dedupe_key == key)):
            continue  # duplicate alert suppression
        new_route, alt_msg = None, "No alternative route is available — proceed with caution."
        try:
            result = plan(db, s.mode, (s.origin["lat"], s.origin["lon"]), (s.destination["lat"], s.destination["lon"]),
                          preferences=(s.preference, "safest", "fastest"))
            cand = next((r for r in result["routes"] if not segs.intersection(r["segment_ids"])), None)
            if cand:
                new_route = cand
                alt_msg = "An alternative route is available."
        except RoutingError as e:
            alt_msg = str(e)
        label = CATEGORY_LABELS.get(inc.category, "hazard").lower()
        closure = inc.restriction_status == Restriction.CLOSED
        title = "Path closed on your route" if closure else "Hazard reported on your route"
        if reason == "verified" and not closure:
            title = "Hazard on your route verified"
        where = f" near {inc.location_label}" if inc.location_label else ""
        status_txt = {"reported": "Unverified community report.", "verified": "Verified by a safety operator.",
                      "confirmed_closure": "Closure confirmed by a safety operator."}.get(certainty_label(inc), "")
        message = f"A {label} has been reported{where}. {status_txt} {alt_msg}"
        priority = "critical" if closure else SEVERITY_PRIORITY.get(inc.severity, "medium")
        n = Notification(user_id=s.user_id, incident_id=inc.id, kind="route.affected", priority=priority, title=title,
                         message=message, dedupe_key=key,
                         data={"session_id": s.id, "incident_id": inc.id, "has_alternative": new_route is not None,
                               "lat": inc.latitude, "lon": inc.longitude},
                         delivered_at=datetime.now(timezone.utc) if s.user_id in manager.online_users else None)
        db.add(n)
        if new_route:
            s.active_edge_ids = new_route["edge_ids"]
            s.active_segment_ids = new_route["segment_ids"]
        db.flush()
        manager.publish("route.affected", {"notification": serialize_notification(n),
                                           "incident": serialize_incident(inc),
                                           "session_id": s.id, "alternative": new_route}, [s.user_id])
        if new_route:
            manager.publish("route.recalculated", {"session_id": s.id, "route": new_route}, [s.user_id])
        sent += 1
    return sent


def serialize_notification(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "priority": n.priority, "title": n.title, "message": n.message,
            "incident_id": n.incident_id, "data": n.data, "created_at": n.created_at, "read_at": n.read_at}


def notify_operators(db: Session, inc: Incident, title: str, message: str, priority: str = "medium"):
    ops = db.scalars(select(User).where(User.role == "operator")).all()
    for op in ops:
        n = Notification(user_id=op.id, incident_id=inc.id, kind="admin.queue", priority=priority, title=title,
                         message=message, dedupe_key=f"op{op.id}:inc{inc.id}:{title}")
        if db.scalar(select(Notification.id).where(Notification.dedupe_key == n.dedupe_key)):
            continue
        db.add(n)
        db.flush()
        manager.publish("notification.created", {"notification": serialize_notification(n)}, [op.id])


def publish_incident(event: str, inc: Incident):
    manager.publish(event, {"incident": serialize_incident(inc)})


def create_report(db: Session, user: User, *, category: str, severity: str, description: str, lat: float, lon: float,
                  obstruction: str, relevance: str | None, image_ids: list[int], ai_used: bool) -> tuple[Incident, bool]:
    from ..models import HazardImage  # local import to avoid cycle in type checkers

    relevance = relevance or DEFAULT_RELEVANCE.get(category, "both")
    dup = find_duplicate(db, category, lat, lon)
    report = HazardReport(reporter_id=user.id, category=category, description=description, latitude=lat,
                          longitude=lon, severity=severity, obstruction=obstruction,
                          status=Status.SUBMITTED, ai_suggestion_used=ai_used)
    db.add(report)
    db.flush()
    for img in db.scalars(select(HazardImage).where(HazardImage.id.in_(image_ids or [-1]),
                                                    HazardImage.uploader_id == user.id)):
        img.report_id = report.id
    from ..models import AIAnalysis
    for a in db.scalars(select(AIAnalysis).where(AIAnalysis.image_id.in_(image_ids or [-1]),
                                                 AIAnalysis.report_id.is_(None))):
        a.report_id = report.id

    if dup:
        report.incident_id = dup.id
        report.status = Status.DUPLICATE
        dup.report_count += 1
        rank = ["low", "medium", "high", "critical"]
        if rank.index(severity) > rank.index(dup.severity) and dup.verification_status in (Status.SUBMITTED, Status.PENDING):
            dup.severity = severity
        log_history(db, dup, "report_merged", user, note=f"Report #{report.id} merged automatically (nearby duplicate).")
        db.commit()
        db.refresh(dup)
        publish_incident("hazard.updated", dup)
        return dup, True

    inc = Incident(primary_report_id=None, category=category, severity=severity,
                   title=f"{CATEGORY_LABELS.get(category, 'Hazard')} reported", description=description,
                   verification_status=Status.PENDING, restriction_status=Restriction.ADVISORY,
                   obstruction=obstruction, latitude=lat, longitude=lon, location_label=location_label(lat, lon),
                   mode_relevance=relevance)
    db.add(inc)
    db.flush()
    inc.primary_report_id = report.id
    report.incident_id = inc.id
    report.status = Status.PENDING
    log_history(db, inc, "submitted", user, None, Status.SUBMITTED, "Community report submitted.")
    log_history(db, inc, "queued", None, Status.SUBMITTED, Status.PENDING, "Awaiting operator verification.")
    recompute_impacts(db, inc)
    db.flush()
    db.refresh(inc)
    notify_affected_sessions(db, inc, "reported")
    notify_operators(db, inc, "New hazard awaiting verification",
                     f"{CATEGORY_LABELS.get(category)} ({severity}) near {inc.location_label}.",
                     "high" if severity in ("high", "critical") else "medium")
    db.commit()
    db.refresh(inc)
    publish_incident("hazard.created", inc)
    return inc, False


def transition(db: Session, inc: Incident, actor: User, to_status: str, action: str, note: str = "",
               restriction: str | None = None, reason: str = "updated"):
    old = inc.verification_status
    inc.verification_status = to_status
    if restriction is not None:
        inc.restriction_status = restriction
    if to_status == Status.RESOLVED:
        inc.resolved_at = datetime.now(timezone.utc)
    log_history(db, inc, action, actor, old, to_status, note)
    for r in inc.reports:
        if r.status != Status.DUPLICATE:
            r.status = to_status
    recompute_impacts(db, inc)
    db.flush()
    db.refresh(inc)
    notify_affected_sessions(db, inc, reason)
    db.commit()
    db.refresh(inc)
    publish_incident(f"hazard.{reason}", inc)
