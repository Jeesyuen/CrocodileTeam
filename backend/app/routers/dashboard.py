from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AIAnalysis, HazardReport, Incident, IncidentHistory, MaintenanceTask, RouteSession, Status, User
from ..security import get_current_user, require_roles
from ..services.incidents import CATEGORY_LABELS, expire_stale, serialize_incident
from ..services.traffic_model import load_metrics

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    expire_stale(db)
    incs = db.scalars(select(Incident).where(Incident.verification_status.notin_([Status.REJECTED,
                                                                                    Status.DUPLICATE]))).all()
    active = [i for i in incs if i.verification_status in Status.ACTIVE]
    mine = db.scalar(select(func.count(HazardReport.id)).where(HazardReport.reporter_id == user.id))
    recent = sorted(incs, key=lambda i: i.created_at, reverse=True)[:6]
    return {
        "total": len(incs),
        "active": len(active),
        "pending": sum(1 for i in incs if i.verification_status in (Status.SUBMITTED, Status.PENDING, Status.EXPIRED)),
        "resolved": sum(1 for i in incs if i.verification_status == Status.RESOLVED),
        "critical": sum(1 for i in active if i.severity == "critical"),
        "closures": sum(1 for i in incs if i.restriction_status == "closed"),
        "in_progress": sum(1 for i in incs if i.verification_status in (Status.IN_PROGRESS, Status.AWAITING_CLEARANCE)),
        "my_reports": mine,
        "by_category": [{"category": c, "label": CATEGORY_LABELS.get(c, c), "count": n}
                        for c, n in Counter(i.category for i in active).most_common()],
        "recent": [serialize_incident(i) for i in recent],
    }


def _hours(a, b):
    if a.tzinfo is None:
        a = a.replace(tzinfo=timezone.utc)
    if b.tzinfo is None:
        b = b.replace(tzinfo=timezone.utc)
    return (b - a).total_seconds() / 3600


@router.get("/analytics")
def analytics(db: Session = Depends(get_db), user: User = Depends(require_roles("operator"))):
    since = datetime.now(timezone.utc) - timedelta(days=30)
    incs = db.scalars(select(Incident)).all()
    days = {}
    for i in incs:
        ca = i.created_at if i.created_at.tzinfo else i.created_at.replace(tzinfo=timezone.utc)
        if ca >= since:
            k = ca.date().isoformat()
            days.setdefault(k, {"date": k, "reported": 0, "resolved": 0})["reported"] += 1
        if i.resolved_at:
            ra = i.resolved_at if i.resolved_at.tzinfo else i.resolved_at.replace(tzinfo=timezone.utc)
            if ra >= since:
                k = ra.date().isoformat()
                days.setdefault(k, {"date": k, "reported": 0, "resolved": 0})["resolved"] += 1
    timeline = []
    for d in range(30, -1, -1):
        k = (datetime.now(timezone.utc) - timedelta(days=d)).date().isoformat()
        timeline.append(days.get(k, {"date": k, "reported": 0, "resolved": 0}))

    verify_times, resolve_times = [], []
    hist = db.scalars(select(IncidentHistory).where(IncidentHistory.action.in_(["verified", "resolved"]))).all()
    by_inc = {i.id: i for i in incs}
    for h in hist:
        inc = by_inc.get(h.incident_id)
        if not inc:
            continue
        (verify_times if h.action == "verified" else resolve_times).append(_hours(inc.created_at, h.created_at))
    analyses = db.scalars(select(AIAnalysis)).all()
    ai_status = Counter(a.status for a in analyses)
    hotspots = Counter(i.location_label for i in incs if i.verification_status not in (Status.REJECTED, Status.DUPLICATE))
    tasks = db.scalars(select(MaintenanceTask)).all()
    return {
        "timeline": timeline,
        "by_category": [{"category": c, "label": CATEGORY_LABELS.get(c, c), "count": n}
                        for c, n in Counter(i.category for i in incs).most_common()],
        "by_status": [{"status": s, "count": n} for s, n in Counter(i.verification_status for i in incs).most_common()],
        "by_severity": [{"severity": s, "count": n} for s, n in Counter(i.severity for i in incs).most_common()],
        "mean_hours_to_verify": round(sum(verify_times) / len(verify_times), 1) if verify_times else None,
        "mean_hours_to_resolve": round(sum(resolve_times) / len(resolve_times), 1) if resolve_times else None,
        "hotspots": [{"location": loc, "count": n} for loc, n in hotspots.most_common(6)],
        "ai": {"analyses": len(analyses), "by_status": dict(ai_status)},
        "maintenance": {"open": sum(1 for t in tasks if t.status != "closed"),
                        "awaiting_clearance": sum(1 for t in tasks if t.status == "awaiting_clearance"),
                        "closed": sum(1 for t in tasks if t.status == "closed")},
        "active_navigation_sessions": db.scalar(select(func.count(RouteSession.id))
                                                .where(RouteSession.active.is_(True))),
        "rejected_share": round(sum(1 for i in incs if i.verification_status == Status.REJECTED) / max(1, len(incs)), 2),
        "traffic_model": load_metrics(),
        "synthetic_share": round(sum(1 for i in incs if i.is_synthetic) / max(1, len(incs)), 2),
    }
