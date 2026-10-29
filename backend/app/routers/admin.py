from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import RouteSession, User
from ..security import report_limiter, require_roles
from ..services.graph import get_network
from ..services.realtime import manager

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/reset-demo")
def reset_demo(user: User = Depends(require_roles("operator"))):
    """Restore the synthetic demo dataset. Only in demo mode, only for operators."""
    if not get_settings().demo_mode:
        raise HTTPException(404, "Not available")
    from ..seed import run
    stats = run(include_static=False)
    report_limiter.reset()
    manager.publish("demo.reset", stats)
    return stats


@router.get("/sessions")
def active_sessions(db: Session = Depends(get_db), user: User = Depends(require_roles("operator"))):
    """Active navigation sessions (route geometry only — no personal details) for the operations map."""
    out = []
    for s in db.scalars(select(RouteSession).where(RouteSession.active.is_(True))):
        net = get_network(s.mode)
        geom = []
        for eid in s.active_edge_ids:
            e = net.edges.get(eid)
            if e:
                geom.extend(e.geom if not geom else e.geom[1:])
        out.append({"id": s.id, "mode": s.mode, "preference": s.preference, "geometry": geom})
    return out
